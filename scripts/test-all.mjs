// npm test.
// A hang must fail the test, not hold the job: every run sets a per-test
// timeout and force-exits so an open socket cannot keep the process alive.
// Files that start a helper process (the app server) run one at a time on
// Windows, after the stdio and demo file. A finished file does not share
// its children with the next one.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serialName = "mcp.test.js";
const flags = ["--test-timeout=480000", "--test-force-exit"];
const testEnv = { CC_TEST_RUN: "1", CC_DEMO_INSTANT: "1" };
const files = fs.readdirSync(path.join(root, "test")).filter((f) => f.endsWith(".test.js")).sort();
if (!files.includes(serialName)) {
  console.error(`npm test stopped: test/${serialName} is missing.`);
  process.exit(1);
}

function isHelper(name) {
  return fs.readFileSync(path.join(root, "test", name), "utf8").includes("startServer(");
}

function run(names, extra, env) {
  if (!names.length) return 0;
  const args = ["--test", ...flags, ...extra, ...names.map((f) => path.join("test", f))];
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, ...testEnv, ...env },
  });
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
  // One helper-process file at a time. Two servers on one Windows runner
  // leave a keep-alive socket that the next chat waits on forever.
  for (const name of helpers) {
    const code = run([name], ["--test-concurrency=1"], { CC_TEST_SERIAL: "1" });
    if (code !== 0) process.exit(code);
  }
  process.exit(run(pure, []));
}

process.exit(run(rest, []));
