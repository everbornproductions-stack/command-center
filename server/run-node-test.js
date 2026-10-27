// Run a node test the task asks for (0.4.21, dogfood 12). Only `node <file>` and `node --test <file>`, with the file
// inside the project folder. No shell, a time limit, the real output kept. Anything else is not run, and the answer says so.
// spawn is injectable so tests need no real process.
import fs from "node:fs";
import path from "node:path";
import { spawn as realSpawn, spawnSync } from "node:child_process";

export const NOT_RUN_LINE = "Not run: Meldmind only runs node tests in your project folder.";
export const RUN_TIMEOUT_MS = 30000;
export const MAX_OUTPUT = 4000;

const FILE_RE = /^[\w][\w./-]{0,120}\.(?:js|mjs|cjs)$/;

// "node cronwords.test.js" or "node --test test/a.test.js" out of free text, else null
export function findNodeCommand(text) {
  const t = String(text || "").replace(/`/g, " ");
  const m = /\bnode\s+(--test\s+)?([\w][\w./\\-]{0,120}\.(?:js|mjs|cjs))\b/i.exec(t);
  if (!m) return null;
  return { test: !!m[1], file: m[2].replace(/\\/g, "/") };
}
// does the text ask for some other command (npm test, python x.py, bash ...)?
export function asksOtherCommand(text) {
  return /\b(npm|npx|yarn|pnpm|python3?|pytest|bash|sh|powershell|pwsh|cmd|make|cargo|go test|dotnet|java|mvn|gradle|deno|bun)\b\s+[\w./-]/i.test(String(text || "").replace(/`/g, " "));
}

// the argv for a plain node command, or { error } when it is anything else
export function parseNodeCommand(cmd) {
  const parts = String(cmd || "").trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== "node") return { error: NOT_RUN_LINE };
  let i = 1, test = false;
  if (parts[i] === "--test") { test = true; i++; }
  const files = parts.slice(i);
  if (files.length !== 1 || !FILE_RE.test(files[0].replace(/\\/g, "/")) || files[0].startsWith("-")) return { error: NOT_RUN_LINE };
  const file = files[0].replace(/\\/g, "/");
  if (path.isAbsolute(file) || file.split("/").includes("..")) return { error: NOT_RUN_LINE };
  return { test, file, cmd: `node ${test ? "--test " : ""}${file}` };
}

// 0.4.23 (audit C1): AI-written code runs fenced in. Node's permission model lets the file read and write
// ONLY inside the project folder, and start no other program, no worker and no native add-on. "node --test x"
// runs the file directly (a node:test file runs its tests in-process and exits non-zero on a failure), because
// the test runner would need to start a child process. When this Node cannot fence
// the code in (too old, or a build without the permission model), nothing runs and the answer says so.
export const SANDBOX_NOT_RUN_LINE = "Not run: this computer's Node cannot fence the test in to your project folder, so Meldmind did not run AI-written code.";
let sandboxProbe = null;
export function sandboxFlags(root, { test = false } = {}) {
  const flags = ["--permission", `--allow-fs-read=${root}`, `--allow-fs-write=${root}`];
  return flags;
}
const childEnv = () => ({ PATH: process.env.PATH || "", SystemRoot: process.env.SystemRoot || "", HOME: process.env.HOME || "", TMPDIR: process.env.TMPDIR || "", TEMP: process.env.TEMP || "", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) });
export function sandboxSupported(exec = process.execPath, run = spawnSync) {
  if (sandboxProbe && sandboxProbe.exec === exec) return sandboxProbe.ok;
  let ok = false;
  try {
    const r = run(exec, ["--permission", "-e", "process.exit(process.permission && !process.permission.has('child') ? 0 : 3)"], { env: childEnv(), windowsHide: true, timeout: 15000, stdio: "ignore" });
    ok = r.status === 0;
  } catch { ok = false; }
  sandboxProbe = { exec, ok };
  return ok;
}
export const resetSandboxProbe = () => { sandboxProbe = null; };

const trim = (s) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n... (cut at ${MAX_OUTPUT} characters)` : s);

/**
 * Run it. Returns { ran: false, line } when it is not allowed or the file is missing, else
 * { ran: true, cmd, exit, output, timedOut, ms }. Never throws.
 */
export function runNodeTest({ cmd, cwd, spawn = realSpawn, timeoutMs = RUN_TIMEOUT_MS, exec = process.execPath, sandboxOk = sandboxSupported } = {}) {
  const p = parseNodeCommand(cmd);
  if (p.error) return Promise.resolve({ ran: false, line: p.error });
  if (!cwd || !fs.existsSync(cwd)) return Promise.resolve({ ran: false, line: "Not run: the project folder is not known." });
  const root = path.resolve(cwd);
  const file = path.resolve(root, p.file);
  if (!file.startsWith(root + path.sep)) return Promise.resolve({ ran: false, line: NOT_RUN_LINE });
  if (!fs.existsSync(file)) return Promise.resolve({ ran: false, line: `Not run: ${p.file} was not found in your project folder.` });
  if (!sandboxOk(exec)) return Promise.resolve({ ran: false, line: SANDBOX_NOT_RUN_LINE });
  const argv = [...sandboxFlags(root, { test: p.test }), file];
  const t0 = Date.now();
  return new Promise((resolve) => {
    let out = "", done = false, timedOut = false, child;
    const finish = (exit) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ran: true, cmd: p.cmd, exit, output: trim(out.replace(/\r\n/g, "\n").trim()), timedOut, ms: Date.now() - t0 });
    };
    const timer = setTimeout(() => { timedOut = true; out += `\nStopped after ${Math.round(timeoutMs / 1000)} seconds.`; try { child?.kill("SIGKILL"); } catch { /* already gone */ } finish(null); }, timeoutMs);
    try {
      child = spawn(exec, argv, { cwd: root, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: childEnv() });
    } catch (err) { out += String(err.message || err); return finish(null); }
    child.stdout?.on("data", (d) => { if (out.length < MAX_OUTPUT * 4) out += d; });
    child.stderr?.on("data", (d) => { if (out.length < MAX_OUTPUT * 4) out += d; });
    child.on("error", (err) => { out += String(err.message || err); finish(null); });
    child.on("close", (code) => finish(code));
  });
}

// the text a following step and the final answer see
export function runReport(r) {
  if (!r?.ran) return r?.line || NOT_RUN_LINE;
  return `Ran: ${r.cmd}\nExit code: ${r.exit === null ? "none (it did not finish)" : r.exit}\n\n${r.output || "(no output)"}`;
}

// Is this plan step "run the tests"? Decided by the title (a step that writes or fixes code is not a run step).
export function isRunStep(t) {
  const title = String(t?.title || "");
  if (!/\b(run|execute|rerun)\b/i.test(title)) return false;
  if (/\b(write|create|add|fix|build|make|draft|edit|update|design|plan)\b/i.test(title)) return false;
  const all = `${title}\n${t?.instructions || ""}`;
  return /\b(tests?|node|npm|command|suite|script)\b/i.test(title) || !!findNodeCommand(all);
}
