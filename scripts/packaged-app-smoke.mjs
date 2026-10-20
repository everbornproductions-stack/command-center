// Builds the unpacked Windows app and starts it headless. The engine must answer
// /api/health within 60 seconds, and the log must not contain "server failed".
// v0.4.5 imported undici without shipping it: unit tests passed, and the packaged
// process crashed before anything listened. This runs before a release is published.
//
// The app is given a temp user-data directory. The repo data/ folder is never used.
// No API key is printed. The process tree is killed and the temp directory removed.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRuntimeDeps, formatMissing } from "./check-runtime-deps.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HEALTH_BUDGET_MS = 60000;
export const POLL_MS = 500;
export const REQUEST_TIMEOUT_MS = 2000;
export const BUILD_ARGS = ["--win", "--x64", "--dir", "--publish", "never"];

const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE)/i;

export function redact(text) {
  return String(text || "")
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "sb_secret_[redacted]")
    .replace(/sb_publishable_[A-Za-z0-9._-]+/g, "sb_publishable_[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}/g, "[redacted-token]")
    .replace(/\b(?:xox[baprs]-[A-Za-z0-9-]+)/g, "[redacted-token]");
}

export function launchArgs(userData) {
  return [
    `--user-data-dir=${userData}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
  ];
}

export function launchEnv(base, { port, userData }) {
  const env = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (v == null || v === "") continue;
    if (SECRET_NAME.test(k)) continue;
    if (k === "NODE_OPTIONS" || k === "CC_DEV_OWNER" || k === "CC_HQ_DIR" || k === "CC_DATA_DIR" || k === "ELECTRON_RUN_AS_NODE") continue;
    env[k] = String(v);
  }
  env.CC_PORT = String(port);
  env.CC_NO_AUTO_UPDATE = "1";
  env.CC_USER_DATA = userData;
  env.CC_DATA_DIR = path.join(userData, "data");
  return env;
}

export function unpackedExecutable(distDir, platform = process.platform) {
  if (platform === "win32") return path.join(distDir, "win-unpacked", "Meldmind.exe");
  const name = platform === "darwin" ? "Meldmind.app" : "meldmind";
  return path.join(distDir, `${platform}-unpacked`, name);
}

export function serverReadyPort(log) {
  const m = /server ready on (\d+)/.exec(log || "");
  return m ? Number(m[1]) : null;
}

export function logFailed(log) {
  return /server failed/.test(log || "");
}

export function engineGaveUp(log) {
  return /server did not answer/.test(log || "");
}

export function healthOk(result) {
  return !!(result && result.status === 200 && result.json && result.json.ok === true && result.json.app === "command-ai");
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function fetchHealth(port, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    const req = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/api/health",
      headers: { connection: "close", accept: "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { res.destroy(); } catch {}
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
        finish({ status: res.statusCode, json });
      });
      res.on("error", () => finish(null));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); finish(null); });
    req.on("error", () => finish(null));
  });
}

export function readEngineLog(userData) {
  try { return fs.readFileSync(path.join(userData, "everborn-command.log"), "utf8"); }
  catch { return ""; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let activeChild = null;
let activeUserData = null;

// Polls until the engine answers, the log records a startup failure, the process
// exits, or the budget ends. The budget is the ceiling. A live engine returns
// on the next poll. One request that does not answer is abandoned and the loop
// continues, so a single tight timeout cannot decide the result.
export async function waitForEngine({
  budgetMs = HEALTH_BUDGET_MS,
  pollMs = POLL_MS,
  preferredPort = null,
  readLog,
  fetchHealth: getHealth,
  processAlive = () => true,
  now = Date.now,
  sleepFn = sleep,
} = {}) {
  const start = now();
  let lastLog = "";
  let port = preferredPort || null;
  while (now() - start < budgetMs) {
    lastLog = (readLog ? readLog() : "") || "";
    if (logFailed(lastLog)) return { ok: false, reason: "server failed", log: lastLog, port: serverReadyPort(lastLog) || port };
    if (engineGaveUp(lastLog)) return { ok: false, reason: "server did not answer", log: lastLog, port: serverReadyPort(lastLog) || port };
    port = serverReadyPort(lastLog) || port;
    if (port && getHealth) {
      let health = null;
      try { health = await getHealth(port); } catch { health = null; }
      if (healthOk(health)) {
        const again = (readLog ? readLog() : lastLog) || lastLog;
        if (logFailed(again)) return { ok: false, reason: "server failed", log: again, port };
        return { ok: true, port, log: again };
      }
    }
    if (!processAlive()) return { ok: false, reason: "app exited before the engine answered", log: lastLog, port };
    const left = budgetMs - (now() - start);
    if (left <= 0) break;
    await sleepFn(Math.min(pollMs, left));
  }
  lastLog = (readLog ? readLog() : lastLog) || lastLog;
  if (logFailed(lastLog)) return { ok: false, reason: "server failed", log: lastLog, port: serverReadyPort(lastLog) || port };
  if (engineGaveUp(lastLog)) return { ok: false, reason: "server did not answer", log: lastLog, port: serverReadyPort(lastLog) || port };
  return { ok: false, reason: "engine did not answer", log: lastLog, port: serverReadyPort(lastLog) || port };
}

export function windowsKillArgs(pid) {
  return ["/PID", String(pid), "/T", "/F"];
}

export function killProcessTree(pid, { graceMs = 1000, platform = process.platform, execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (platform === "win32") {
      execFileImpl("taskkill", windowsKillArgs(pid), { windowsHide: true }, () => resolve());
      return;
    }
    const signal = (sig) => {
      try { process.kill(-pid, sig); }
      catch { try { process.kill(pid, sig); } catch {} }
    };
    signal("SIGTERM");
    setTimeout(() => { signal("SIGKILL"); resolve(); }, graceMs);
  });
}

function waitExit(child, budgetMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(resolve, budgetMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

function destroyPipes(child) {
  for (const stream of [child?.stdout, child?.stderr, child?.stdin]) {
    try { stream?.destroy(); } catch {}
  }
}

export function assertSafeUserData(dir, root = ROOT) {
  const real = fs.realpathSync(dir);
  const tmp = fs.realpathSync(os.tmpdir());
  if (real !== tmp && !real.startsWith(tmp + path.sep)) {
    throw new Error("Packaged app smoke refused to start: the user data dir is not in the temp directory.");
  }
  const data = path.resolve(root, "data");
  let dataReal = data;
  try { dataReal = fs.realpathSync(data); } catch { /* the repo data folder is not created here */ }
  if (real === dataReal || real.startsWith(dataReal + path.sep) || dataReal.startsWith(real + path.sep)) {
    throw new Error("Packaged app smoke refused to start: the user data dir overlaps the repo data folder.");
  }
  return real;
}

export function makeUserDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meldmind-pack-smoke-"));
  return assertSafeUserData(dir);
}

export async function removeDir(dir, root = ROOT) {
  if (!fs.existsSync(dir)) return;
  assertSafeUserData(dir, root);
  let lastErr = null;
  for (let i = 0; i < 8; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      if (!fs.existsSync(dir)) return;
    } catch (e) { lastErr = e; }
    await sleep(250);
  }
  if (fs.existsSync(dir)) {
    throw new Error(`Packaged app smoke could not remove the temp user data dir${lastErr ? `: ${lastErr.message}` : "."}`);
  }
}

function drain(stream, bucket) {
  if (!stream) return;
  stream.on("error", () => {});
  stream.on("data", (chunk) => {
    bucket.push(chunk);
    let size = bucket.reduce((n, c) => n + c.length, 0);
    while (size > 64 * 1024 && bucket.length > 1) size -= bucket.shift().length;
  });
}

function buildEnv(base) {
  const env = { ...base };
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.RELEASES_TOKEN;
  return env;
}

function runBuilder() {
  return new Promise((resolve) => {
    const script = path.join(ROOT, "scripts", "inject-cloud-key.mjs");
    const child = spawn(process.execPath, [script, "--", "electron-builder", ...BUILD_ARGS], {
      cwd: ROOT,
      env: buildEnv(process.env),
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (e) => {
      console.error(e.message);
      resolve(1);
    });
    child.once("exit", (code) => resolve(code === 0 ? 0 : code ?? 1));
  });
}

export async function launchPackagedApp({ exe, env = process.env, budgetMs = HEALTH_BUDGET_MS, pollMs = POLL_MS } = {}) {
  if (!exe || !fs.existsSync(exe)) {
    return { ok: false, reason: `unpacked app not found${exe ? ` at ${exe}` : ""}` };
  }
  const userData = makeUserDataDir();
  const port = await freePort();
  const childEnv = launchEnv(env, { port, userData });
  const output = [];
  const child = spawn(exe, launchArgs(userData), {
    cwd: path.dirname(exe),
    env: childEnv,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  drain(child.stdout, output);
  drain(child.stderr, output);
  activeChild = child;
  activeUserData = userData;
  let stopped = false;
  child.once("error", () => { stopped = true; });
  child.once("exit", () => { stopped = true; });
  let result = { ok: false, reason: "engine did not answer", log: "", port };
  try {
    result = await waitForEngine({
      budgetMs,
      pollMs,
      preferredPort: port,
      readLog: () => readEngineLog(userData),
      fetchHealth: (p) => fetchHealth(p),
      processAlive: () => !stopped,
    });
  } finally {
    const pid = child.pid;
    activeChild = null;
    await killProcessTree(pid);
    await waitExit(child, 8000);
    destroyPipes(child);
    try { await removeDir(userData); }
    catch (e) {
      const extra = e.message || "could not remove the temp user data dir";
      result = { ...result, ok: false, reason: result.ok ? extra : `${result.reason} (${extra})` };
    } finally {
      if (activeUserData === userData) activeUserData = null;
    }
  }
  const tail = redact(Buffer.concat(output).toString("utf8")).trim();
  return { ...result, output: tail, userDataRemoved: !fs.existsSync(userData) };
}

function failureText(result) {
  const bits = [`Packaged app smoke failed: ${result.reason || "the engine did not answer"}.`];
  if (result.port) bits.push(`Port ${result.port}.`);
  const log = redact(result.log || "").trim();
  if (log) {
    const lines = log.split(/\r?\n/).slice(-30);
    bits.push("Log:");
    bits.push(lines.join("\n"));
  }
  if (result.output) {
    bits.push("Process output:");
    bits.push(result.output.split(/\r?\n/).slice(-30).join("\n"));
  }
  return bits.join("\n");
}

async function main() {
  const deps = checkRuntimeDeps();
  if (!deps.ok) {
    console.error(formatMissing(deps.missing));
    return 1;
  }
  console.log("Building the unpacked app (electron-builder --win --x64 --dir). Nothing is published.");
  const built = await runBuilder();
  if (built !== 0) {
    console.error("Packaged app smoke failed: electron-builder --dir did not finish.");
    return built || 1;
  }
  const exe = unpackedExecutable(path.join(ROOT, "dist"));
  console.log(`Starting ${exe} headless with a temp user-data dir. Waiting up to ${HEALTH_BUDGET_MS / 1000}s for /api/health.`);
  const result = await launchPackagedApp({ exe });
  if (!result.ok) {
    console.error(failureText(result));
    return 1;
  }
  if (logFailed(result.log)) {
    console.error(failureText({ ...result, reason: "server failed" }));
    return 1;
  }
  console.log(`Packaged app smoke: engine answered on port ${result.port}. Log has no "server failed". Process tree stopped and the temp user-data dir was removed.`);
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    const pid = activeChild && activeChild.pid;
    const dir = activeUserData;
    const finish = () => {
      if (dir) {
        try { assertSafeUserData(dir); fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      process.exit(code);
    };
    if (!pid) return finish();
    killProcessTree(pid, { graceMs: 200 }).then(finish, finish);
  };
  process.on("SIGINT", () => stop(1));
  process.on("SIGTERM", () => stop(1));
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(redact(e && e.stack || e));
    process.exit(1);
  });
}
