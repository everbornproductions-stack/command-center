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
  return /\b(tests?|node|npm|command|suite|script|python)\b/i.test(title) || /\.py\b/i.test(title) || !!findNodeCommand(all);
}

// ---- Python scripts the mission saved (0.4.27, dogfood batch 2) ----
// "Not run: Meldmind only runs node tests in your project folder." for "Run invoice_totals.py and verify totals".
// A step that asks to run a Python script that this mission saved runs it with the system Python: isolated mode
// (python -I, so no user site or PYTHON* variables), in the saved file's folder, no shell, a 60 s limit, the
// whole process tree stopped on a timeout, and the real output kept. No Python on this PC: the step says so plainly.
export const PY_TIMEOUT_MS = 60000;
export const pyMissingLine = (file) => `Not run: Python is not installed on this computer, so Meldmind could not run ${file || "the script"}. Install Python 3 from python.org, then press Try again.`;

/** { file } when the text asks to run a Python script ("python invoice_totals.py", "run roof_estimate.py"), { file: "" } when it only says Python, else null. */
export function findPythonCommand(text) {
  const t = String(text || "").replace(/`/g, " ");
  const m = /\b(?:python3?|py(?:\s+-3)?)(?:\s+-[\w]+)*\s+([\w][\w.\\/-]{0,120}\.py)\b/i.exec(t) || /\b([\w][\w.-]{0,120}\.py)\b/i.exec(t);
  if (m) return { file: m[1].replace(/\\/g, "/").split("/").pop() };
  return /\bpython\b/i.test(t) ? { file: "" } : null;
}

let pyProbe = null;
/** The system Python 3 as { exe, pre }, or null. The Windows Store stand-in (exit 9009, no version) does not count. */
export function findPython({ run = spawnSync, platform = process.platform, fresh = false } = {}) {
  if (pyProbe && !fresh) return pyProbe.found;
  const tries = platform === "win32" ? [["python", []], ["py", ["-3"]], ["python3", []]] : [["python3", []], ["python", []]];
  let found = null;
  for (const [exe, pre] of tries) {
    try {
      const r = run(exe, [...pre, "--version"], { windowsHide: true, timeout: 15000, shell: false, encoding: "utf8" });
      if (r && r.status === 0 && /Python 3\.\d+/.test(`${r.stdout || ""}${r.stderr || ""}`)) { found = { exe, pre }; break; }
    } catch { /* not this one */ }
  }
  pyProbe = { found };
  return found;
}
export const resetPythonProbe = () => { pyProbe = null; };

const pyEnv = () => {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "WINDIR"];
  const env = {};
  for (const k of keep) if (process.env[k] != null) env[k] = process.env[k];
  return env;
};
function stopTree(child, platform = process.platform) {
  if (!child) return;
  if (platform === "win32" && child.pid) { try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10000 }); return; } catch { /* fall back to kill */ } }
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

/**
 * Run one saved .py file. Returns { ran: false, line } when it cannot run, else { ran: true, cmd, exit, output, timedOut, ms }.
 * Never throws. python: { exe, pre } to skip the probe (tests), or null to say Python is missing.
 */
export function runPython({ file, timeoutMs = PY_TIMEOUT_MS, spawn = realSpawn, python } = {}) {
  const name = path.basename(String(file || ""));
  if (!file || !/\.py$/i.test(name)) return Promise.resolve({ ran: false, line: "Not run: there was no Python script to run." });
  if (!fs.existsSync(file)) return Promise.resolve({ ran: false, line: `Not run: ${name} was not saved, so there was nothing to run.` });
  const py = python === undefined ? findPython() : python;
  if (!py) return Promise.resolve({ ran: false, line: pyMissingLine(name) });
  const cwd = path.dirname(path.resolve(file));
  const argv = [...(py.pre || []), "-I", "-X", "utf8", name];
  const cmd = `python -I ${name}`;
  const t0 = Date.now();
  return new Promise((resolve) => {
    let out = "", done = false, timedOut = false, child;
    const finish = (exit) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ ran: true, cmd, exit, output: trim(out.replace(/\r\n/g, "\n").trim()), timedOut, ms: Date.now() - t0 });
    };
    const timer = setTimeout(() => { timedOut = true; out += `\nStopped after ${Math.round(timeoutMs / 1000)} seconds.`; stopTree(child); finish(null); }, timeoutMs);
    try {
      child = spawn(py.exe, argv, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: pyEnv() });
    } catch (err) { out += String(err.message || err); return finish(null); }
    child.stdout?.setEncoding?.("utf8"); child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (d) => { if (out.length < MAX_OUTPUT * 4) out += d; });
    child.stderr?.on("data", (d) => { if (out.length < MAX_OUTPUT * 4) out += d; });
    child.on("error", (err) => { if (/ENOENT/.test(String(err.code || err.message))) { done = true; clearTimeout(timer); return resolve({ ran: false, line: pyMissingLine(name) }); } out += String(err.message || err); finish(null); });
    child.on("close", (code) => finish(code));
  });
}
