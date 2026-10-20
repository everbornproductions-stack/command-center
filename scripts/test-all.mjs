// npm test. The MCP file starts the demo stdio server and the app together.
// It runs alone, before every other file, so those processes are not sharing
// the machine with the rest of the suite. On Windows the other files run two
// at a time. A file that passes still finishes as soon as its own tests do.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serialName = "mcp.test.js";
const files = fs.readdirSync(path.join(root, "test")).filter((f) => f.endsWith(".test.js")).sort();
if (!files.includes(serialName)) {
  console.error(`npm test stopped: test/${serialName} is missing.`);
  process.exit(1);
}

function run(names, extra) {
  const args = ["--test", ...extra, ...names.map((f) => path.join("test", f))];
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

const serialCode = run([serialName], ["--test-concurrency=1"]);
if (serialCode !== 0) process.exit(serialCode);

const rest = files.filter((f) => f !== serialName);
const extra = process.platform === "win32" ? ["--test-concurrency=2"] : [];
process.exit(run(rest, extra));
