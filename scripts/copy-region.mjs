import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { copyRegion } from "../server/cloud/region-copy.mjs";

// Explicit manual operation. Neither CI nor the normal build invokes this.
if (!process.argv.includes("--copy-and-freeze-source"))
  throw Error(
    "Supply --copy-and-freeze-source after provisioning an empty destination and draining players.",
  );
const sourceUrl = new URL(process.env.SOURCE_DATABASE_URL);
const targetUrl = new URL(process.env.TARGET_DATABASE_URL);
for (const url of [sourceUrl, targetUrl]) {
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname.includes("-pooler.")
  )
    throw Error("Use direct, unpooled Postgres URLs for the copy.");
  url.searchParams.set("sslmode", "verify-full");
}
if (
  sourceUrl.host === targetUrl.host &&
  sourceUrl.pathname === targetUrl.pathname
)
  throw Error("Source and destination must be different databases.");
const source = new pg.Client({
  connectionString: sourceUrl.href,
  application_name: "friendstack-region-copy",
});
const target = new pg.Client({
  connectionString: targetUrl.href,
  application_name: "friendstack-region-copy",
});
try {
  await source.connect();
  await target.connect();
  const root = resolve("data/region-migration");
  await mkdir(root, { recursive: true });
  const stamp = Date.now();
  const report = await copyRegion({
    source,
    target,
    backup: (snapshot) =>
      writeFile(
        resolve(root, `backup-${stamp}.json`),
        JSON.stringify(snapshot),
        { mode: 0o600, flag: "wx" },
      ),
  });
  await writeFile(
    resolve(root, `verified-${stamp}.json`),
    JSON.stringify(report, null, 2),
    { flag: "wx" },
  );
  console.log(
    "Copy verified. Source is frozen; deploy Singapore using the destination URL.",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Connection failures can include credentials or row contents in their message.
  console.error("Region copy stopped:", error.code || error.name);
  console.error(
    "Inspect both databases before retrying or thawing the source.",
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled([source.end(), target.end()]);
}
