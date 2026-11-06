import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], {
    stdio: "inherit",
  }),
  spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/vite/bin/vite.js", import.meta.url),
      ),
    ],
    { stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
for (const child of children) child.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
