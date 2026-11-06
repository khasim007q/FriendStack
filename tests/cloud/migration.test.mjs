import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { Database } from "../../server/cloud/database.mjs";
import { CloudStore } from "../../server/cloud/store.mjs";
import {
  copyRegion,
  inspectCopy,
  thawSource,
  TABLES,
} from "../../server/cloud/region-copy.mjs";

async function fixture(t) {
  const url = process.env.FRIENDSTACK_TEST_DATABASE_URL;
  assert.ok(url, "Use the isolated cloud test runner.");
  const sourceSchema = `copy_${randomUUID().replaceAll("-", "")}`;
  const targetSchema = `copy_${randomUUID().replaceAll("-", "")}`;
  const db = new Database(url, { schema: sourceSchema });
  await db.migrate();
  const store = new CloudStore(db);
  await store.init();
  const user = await store.register({
    username: `copy_${randomUUID().slice(0, 8)}`,
    name: "Migration tester",
    password: "Local-only-test-123",
  });
  const source = new pg.Client({ connectionString: url }),
    target = new pg.Client({ connectionString: url });
  await source.connect();
  await target.connect();
  t.after(async () => {
    await Promise.allSettled([source.end(), target.end(), db.close()]);
  });
  return { source, target, sourceSchema, targetSchema, user, db, store };
}

test("region copy preserves all tables, JSON arrays, private data, sessions and deck identity; old source rejects writes", async (t) => {
  const f = await fixture(t);
  await f.db.query(
    "INSERT INTO __SCHEMA__.revisions VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      "revision-test",
      "trait-test",
      "Quoted ' friend",
      "Private 💛 description",
      { effect: "draw", choices: [1, { a: true }] },
      "approved",
      1793963053375,
      null,
    ],
  );
  await f.db.query("INSERT INTO __SCHEMA__.rooms VALUES($1,$2,$3,$4,$5)", [
    "COPYTEST",
    { phase: "results", cards: [{ health: 3 }] },
    "9007199254740993",
    1793963053375,
    1794963053375,
  ]);
  let backup;
  const report = await copyRegion({
    ...f,
    backup: async (s) => {
      backup = s;
    },
  });
  assert.equal(Object.keys(report).length, TABLES.length);
  assert.equal(report.accounts.count, 1);
  assert.ok(report.revisions.count > 1); // Includes approved fictional starter traits.
  const before = await inspectCopy(f.source, f.sourceSchema),
    after = await inspectCopy(f.target, f.targetSchema);
  assert.deepEqual(before.tables, after.tables);
  assert.deepEqual(backup.tables, before.tables);
  assert.match(after.tables.rooms.rows[0], /9007199254740993/);
  assert.ok(
    after.tables.revisions.rows.some((row) =>
      row.includes("Private 💛 description"),
    ),
  );
  await assert.rejects(
    f.db.query("UPDATE __SCHEMA__.accounts SET name='lost write'"),
    { code: "55000" },
  );
  const targetDb = new Database(process.env.FRIENDSTACK_TEST_DATABASE_URL, {
    schema: f.targetSchema,
  });
  t.after(() => targetDb.close());
  const targetStore = new CloudStore(targetDb);
  const authenticated = await targetStore.auth(f.user.token);
  assert.equal(authenticated.id, f.user.user.id);
  const restored = await targetStore.bootstrap(authenticated);
  assert.ok(restored.decks[0].cards.length);
  await thawSource(f.source, f.sourceSchema);
  await f.db.query("UPDATE __SCHEMA__.accounts SET name='rollback restored'");
});

test("region copy refuses active connections without freezing players", async (t) => {
  const f = await fixture(t);
  await f.db.query("INSERT INTO __SCHEMA__.connections VALUES($1,$2,$3,$4)", [
    f.user.user.id,
    "live",
    Date.now(),
    Date.now() + 60000,
  ]);
  await assert.rejects(
    copyRegion({ ...f, backup: async () => {} }),
    /Players are connected/,
  );
  await f.db.query("UPDATE __SCHEMA__.accounts SET name='still writable'");
});

test("failed private backup rolls back destination and restores source writes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    copyRegion({
      ...f,
      backup: async () => {
        throw Error("Disk unavailable");
      },
    }),
    /Disk unavailable/,
  );
  await f.db.query("UPDATE __SCHEMA__.accounts SET name='still writable'");
  assert.equal(
    (
      await f.target.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1",
        [f.targetSchema],
      )
    ).rows[0].n,
    0,
  );
});

test("region copy refuses an occupied destination and the same source database", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    copyRegion({ ...f, targetSchema: f.sourceSchema, backup: async () => {} }),
    /different databases/,
  );
  await copyRegion({ ...f, backup: async () => {} });
  await thawSource(f.source, f.sourceSchema);
  await assert.rejects(
    copyRegion({ ...f, backup: async () => {} }),
    /Destination is not empty/,
  );
  await f.db.query("UPDATE __SCHEMA__.accounts SET name='still writable'");
});

test("an uncertain destination commit keeps the source frozen until an operator verifies it", async (t) => {
  const f = await fixture(t);
  const target = {
    connectionParameters: f.target.connectionParameters,
    query: async (...args) => {
      const result = await f.target.query(...args);
      if (args[0] === "COMMIT") throw Error("Connection lost after commit");
      return result;
    },
  };
  await assert.rejects(
    copyRegion({ ...f, target, backup: async () => {} }),
    /Connection lost after commit/,
  );
  await assert.rejects(
    f.db.query("UPDATE __SCHEMA__.accounts SET name='divergent write'"),
    { code: "55000" },
  );
  assert.deepEqual(
    (await inspectCopy(f.source, f.sourceSchema)).tables,
    (await inspectCopy(f.target, f.targetSchema)).tables,
  );
});
