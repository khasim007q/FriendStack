import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";

pg.types.setTypeParser(20, Number);
export class Database {
  context = new AsyncLocalStorage();
  constructor(url, { schema = "friendstack", max = 3 } = {}) {
    if (!url)
      throw new Error("DATABASE_URL is required for shared online storage.");
    if (!/^[a-z][a-z0-9_]{0,60}$/.test(schema))
      throw new Error("Invalid database schema.");
    this.schema = schema;
    this.pool = new pg.Pool({
      connectionString: url,
      max,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      application_name: "friendstack",
    });
    this.pool.on("error", () =>
      console.error("Database connection interrupted."),
    );
  }
  query(sql, args = []) {
    // Qualify every relation explicitly: transaction poolers do not preserve
    // session search_path. The namespace is validated above, never user input.
    return (this.context.getStore() || this.pool).query(
      sql.replaceAll("__SCHEMA__", `"${this.schema}"`),
      args,
    );
  }
  async all(sql, ...args) {
    return (await this.query(sql, args)).rows;
  }
  async get(sql, ...args) {
    return (await this.all(sql, ...args))[0];
  }
  async transaction(fn, retries = 3) {
    if (this.context.getStore()) return fn();
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '8000ms'");
        await client.query("SET LOCAL lock_timeout = '4000ms'");
        const result = await this.context.run(client, fn);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (!["40001", "40P01"].includes(e.code) || attempt >= retries) throw e;
      } finally {
        client.release();
      }
    }
  }
  async migrate() {
    await this.transaction(async () => {
      await this.query(
        "SELECT pg_advisory_xact_lock(hashtext('friendstack:migrate:' || $1))",
        [this.schema],
      );
      await this.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await this.query(
        await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
      );
    });
  }
  async rate(key, limit, windowMs = 60000) {
    const now = Date.now();
    const r = await this.get(
      `INSERT INTO __SCHEMA__.rate_limits(key,until_ms,count) VALUES($1,$2,1)
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.until_ms<$3 THEN 1 ELSE rate_limits.count+1 END,
      until_ms=CASE WHEN rate_limits.until_ms<$3 THEN $2 ELSE rate_limits.until_ms END RETURNING count`,
      key,
      now + windowMs,
      now,
    );
    if (r.count > limit) {
      const e = new Error("Too many requests. Wait a minute and try again.");
      e.status = 429;
      throw e;
    }
  }
  close() {
    return this.pool.end();
  }
}
