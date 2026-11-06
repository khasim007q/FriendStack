import EmbeddedPostgres from "embedded-postgres";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { resolve, sep } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Always create an isolated database. This runner never reads DATABASE_URL and
// cannot run a destructive/load suite against the user's deployment by accident.
const workspace = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(workspace, "test-results"),
  directory = resolve(root, `postgres-${Date.now()}`);
if (!directory.startsWith(root + sep))
  throw new Error("Test database escaped its workspace.");
await mkdir(root, { recursive: true });
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const password = randomBytes(20).toString("hex");
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: "postgres",
  password,
  port,
  persistent: true,
  initdbFlags: ["--locale=C"],
  postgresFlags: ["-h", "127.0.0.1", "-c", "max_connections=150"],
  onLog: () => {},
  onError: (message) => {
    if (String(message).includes("FATAL"))
      console.error("Postgres test database reported a fatal error.");
  },
});
let exit = 1;
try {
  await pg.initialise();
  await pg.start();
  const load = process.argv.includes("--load");
  const args = load
    ? [
        "scripts/cloud-load.mjs",
        ...process.argv.slice(2).filter((x) => x !== "--load"),
      ]
    : [
        "--test",
        "--test-concurrency=1",
        ...process.argv.slice(2),
        "tests/cloud/shared.test.mjs",
        "tests/cloud/migration.test.mjs",
      ];
  const child = spawn(process.execPath, args, {
    cwd: workspace,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      FRIENDSTACK_TEST_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
    },
  });
  exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await pg.stop();
  // This is the verified, uniquely created test-only directory above.
  if (directory.startsWith(root + sep) && resolve(directory) === directory)
    await rm(directory, { recursive: true, force: true });
}
// embedded-postgres installs a beforeExit hook that exits with 0, overriding
// process.exitCode. Cleanup is complete above; explicitly preserve suite failure.
process.exit(exit);
