// npm test. The MCP file starts the demo stdio server and the app together.
// It runs alone, before every other file. On Windows every other file that
// starts a helper process (the app, Electron, or a spawned child) also runs
// one at a time, so those processes are not sharing ports or the runner.
// Files that only read source still run two at a time. A file that passes
// still finishes as soon as its own tests do. Every test has a timeout so a
// hang fails instead of holding the job.
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

const HELPER = /\bstartServer\b|\bspawn\s*\(/;
function isHelper(name) {
  return HELPER.test(fs.readFileSync(path.join(root, "test", name), "utf8"));
}

function run(names, extra) {
  if (!names.length) return 0;
  const args = ["--test", "--test-timeout=180000", ...extra, ...names.map((f) => path.join("test", f))];
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: root, windowsHide: true });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

const serialCode = run([serialName], ["--test-concurrency=1"]);
if (serialCode !== 0) process.exit(serialCode);

const rest = files.filter((f) => f !== serialName);
if (process.platform === "win32") {
  const helpers = rest.filter(isHelper);
  const pure = rest.filter((f) => !isHelper(f));
  const helperCode = run(helpers, ["--test-concurrency=1"]);
  if (helperCode !== 0) process.exit(helperCode);
  process.exit(run(pure, ["--test-concurrency=2"]));
}
process.exit(run(rest, []));
