import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Deliberately limited to FriendStack's small trial schema. No account, role,
// extension, or unrelated provider schema is copied or removed.
export const TABLES = [
  "accounts",
  "sessions",
  "people",
  "relationships",
  "traits",
  "revisions",
  "invites",
  "decks",
  "card_versions",
  "matches",
  "rooms",
  "memberships",
  "connections",
  "rate_limits",
  "social_refresh",
];
const namespace = (schema) => {
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(schema)) throw Error("Invalid schema.");
  return `"${schema}"`;
};
const fingerprint = (rows) =>
  createHash("sha256").update(rows.join("\n")).digest("hex");

export async function inspectCopy(client, schema = "friendstack") {
  const ns = namespace(schema),
    tables = {};
  for (const name of TABLES) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(t)::text AS row FROM ${ns}."${name}" t`,
      )
    ).rows
      .map((r) => r.row)
      .sort();
    tables[name] = { rows, count: rows.length, sha256: fingerprint(rows) };
  }
  return { schema, tables };
}

export async function thawSource(client, schema = "friendstack") {
  const ns = namespace(schema);
  await client.query("BEGIN");
  try {
    for (const name of TABLES)
      await client.query(
        `DROP TRIGGER IF EXISTS region_migration_freeze ON ${ns}."${name}"`,
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function copyRegion({
  source,
  target,
  sourceSchema = "friendstack",
  targetSchema = "friendstack",
  backup,
}) {
  const src = namespace(sourceSchema),
    dst = namespace(targetSchema);
  const sourceIdentity = (
    await source.query(
      "SELECT current_database() AS db, inet_server_addr()::text AS host",
    )
  ).rows[0];
  const targetIdentity = (
    await target.query(
      "SELECT current_database() AS db, inet_server_addr()::text AS host",
    )
  ).rows[0];
  if (
    sourceSchema === targetSchema &&
    sourceIdentity.db === targetIdentity.db &&
    sourceIdentity.host === targetIdentity.host
  )
    throw Error("Source and destination must be different databases.");
  if (typeof backup !== "function")
    throw Error("A private backup writer is required.");
  let frozen = false,
    targetCommitted = false,
    commitAttempted = false;
  await target.query("BEGIN");
  try {
    await target.query("SET LOCAL lock_timeout = '5000ms'");
    await target.query("SET LOCAL statement_timeout = '60000ms'");
    await target.query(`CREATE SCHEMA IF NOT EXISTS ${dst}`);
    await target.query(
      (
        await readFile(new URL("./schema.sql", import.meta.url), "utf8")
      ).replaceAll("__SCHEMA__", dst),
    );
    await target.query(
      `LOCK TABLE ${TABLES.map((n) => `${dst}."${n}"`).join(",")} IN ACCESS EXCLUSIVE MODE`,
    );
    const existing = await inspectCopy(target, targetSchema);
    if (Object.values(existing.tables).some((t) => t.count))
      throw Error("Destination is not empty; refusing to overwrite data.");

    await source.query("BEGIN");
    try {
      await source.query("SET LOCAL lock_timeout = '5000ms'");
      await source.query(
        `LOCK TABLE ${TABLES.map((n) => `${src}."${n}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`,
      );
      const tables = (
        await source.query(
          "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
          [sourceSchema],
        )
      ).rows.map((r) => r.tablename);
      if (JSON.stringify(tables) !== JSON.stringify([...TABLES].sort()))
        throw Error(
          "Unexpected source tables; update the migration before copying.",
        );
      const active = (
        await source.query(
          `SELECT count(*)::int AS n FROM ${src}.connections WHERE expires > extract(epoch FROM clock_timestamp())*1000`,
        )
      ).rows[0].n;
      if (active)
        throw Error("Players are connected; wait until sessions have drained.");
      const playing = (
        await source.query(
          `SELECT count(*)::int AS n FROM ${src}.rooms WHERE state->>'phase'='playing' AND expires > extract(epoch FROM clock_timestamp())*1000`,
        )
      ).rows[0].n;
      if (playing)
        throw Error("A duel is still in progress; wait for it to finish.");
      await source.query(
        `CREATE OR REPLACE FUNCTION ${src}.region_migration_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FriendStack is moving regions. Please reconnect shortly.' USING ERRCODE='55000'; END $$`,
      );
      for (const name of TABLES)
        await source.query(
          `CREATE OR REPLACE TRIGGER region_migration_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON ${src}."${name}" FOR EACH STATEMENT EXECUTE FUNCTION ${src}.region_migration_write_guard()`,
        );
      await source.query("COMMIT");
      frozen = true;
    } catch (error) {
      await source.query("ROLLBACK");
      throw error;
    }
    const snapshot = await inspectCopy(source, sourceSchema);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024 * 1024)
      throw Error(
        "Trial migration exceeds 64 MiB; use streamed pg_dump/restore.",
      );
    await backup(snapshot);
    for (const name of TABLES) {
      const rows = snapshot.tables[name].rows;
      if (rows.length)
        await target.query(
          `INSERT INTO ${dst}."${name}" SELECT * FROM jsonb_populate_recordset(NULL::${dst}."${name}", $1::jsonb)`,
          ["[" + rows.join(",") + "]"],
        );
    }
    const restored = await inspectCopy(target, targetSchema);
    for (const name of TABLES)
      if (snapshot.tables[name].sha256 !== restored.tables[name].sha256)
        throw Error(`Verification failed for ${name}.`);
    commitAttempted = true;
    await target.query("COMMIT");
    targetCommitted = true;
    // Keep the source frozen through deployment. Old function instances and
    // cached deployment URLs cannot write data that would be lost at cutover.
    return Object.fromEntries(
      TABLES.map((name) => [
        name,
        {
          count: restored.tables[name].count,
          sha256: restored.tables[name].sha256,
        },
      ]),
    );
  } catch (error) {
    if (!targetCommitted) {
      await target.query("ROLLBACK");
      // A broken connection during COMMIT has an unknown outcome. Keep the
      // source frozen until the destination is inspected; never create two
      // writable copies after a possibly successful commit.
      if (frozen && !commitAttempted) await thawSource(source, sourceSchema);
    }
    throw error;
  }
}
