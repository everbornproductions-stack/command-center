// Builds the unpacked Windows app and starts it the way an install does.
// v0.4.5 shipped with a missing runtime import. Unit tests passed, then the
// packaged engine crashed before it listened. This waits (up to 60 seconds)
// for /api/health, rejects a log that contains "server failed", then stops
// the process tree and removes the temporary user-data folder.
//
// No publishable key is written. No real provider is called. The repo data
// folder is never read.
import { spawn, execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportRuntimeDeps } from "./check-runtime-deps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HEALTH_BUDGET_MS = 60000;
export const HEALTH_POLL_MS = 1000;
export const CLEANUP_GRACE_MS = 2000;

const SECRET_NAME = /(_KEY|_TOKEN|_SECRET|_PASSWORD)$/i;
const SECRET_VALUE = /sb_secret_|sb_publishable_|service_role|ghp_|github_pat_|eyJ[A-Za-z0-9_-]{20,}/;
const SECRET_TEXT = /(?:sb_secret_|sb_publishable_|service_role|sk-ant-|sk-proj-|sk-or-|ghp_|github_pat_|xai-|gsk_|AIza)[A-Za-z0-9._-]*/g;

export function redact(text) {
  return String(text ?? "").replace(SECRET_TEXT, "[redacted]");
}

export function sanitizeEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (value == null) continue;
    if (SECRET_NAME.test(key)) continue;
    if (typeof value === "string" && SECRET_VALUE.test(value)) continue;
    env[key] = value;
  }
  env.CC_PACK_UNPUBLISHED = "1";
  env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

export function launchEnv(base, port) {
  const env = sanitizeEnv(base);
  // The app would otherwise write under its real user-data folder, check GitHub
  // for an update, and fetch the public OpenRouter price list. None of that is
  // needed to prove the engine started, and this smoke must not call a real URL.
  delete env.CC_DATA_DIR;
  delete env.CC_HQ_DIR;
  delete env.CC_DEV_OWNER;
  env.CC_PORT = String(port);
  env.CC_NO_AUTO_UPDATE = "1";
  env.CC_LIVE_PRICING = "off";
  return env;
}

export function launchArgs(userData) {
  return [`--user-data-dir=${userData}`, "--headless", "--disable-gpu"];
}

export function assertTempUserData(dir, root = ROOT) {
  const resolved = path.resolve(dir);
  const tmp = path.resolve(os.tmpdir());
  const repo = path.resolve(root);
  const data = path.resolve(root, "data");
  if (resolved === data || resolved.startsWith(data + path.sep)) {
    throw new Error("Packaged app smoke refused to use the repo data folder.");
  }
  if (resolved === repo || resolved.startsWith(repo + path.sep)) {
    throw new Error("Packaged app smoke refused to put user data inside the repo.");
  }
  if (!(resolved === tmp || resolved.startsWith(tmp + path.sep))) {
    throw new Error("Packaged app smoke user-data folder must be under the temporary directory.");
  }
}

export function serverFailed(log) {
  return String(log || "").includes("server failed");
}

export function portFromLog(log) {
  const match = String(log || "").match(/server ready on (\d+)/);
  return match ? Number(match[1]) : null;
}

export function expectedDataDir(userData) {
  return path.join(userData, "data");
}

// Windows CI often hands out an 8.3 temp path. Electron may log the long path.
// realpath makes those the same folder. A missing leaf (the data dir is created
// after the first log line) still compares through the parent that does exist.
function normalizePath(p) {
  let current = path.resolve(String(p || ""));
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.push(path.basename(current));
    current = parent;
  }
  try { current = fs.realpathSync(current); } catch { /* keep the resolved path */ }
  const full = path.join(current, ...missing.reverse());
  return process.platform === "win32" ? full.toLowerCase() : full;
}

function dataLine(log) {
  const match = String(log || "").match(/ data=([^\r\n]*)/);
  return match ? match[1].trim() : "";
}

export function foreignDataDir(log, userData) {
  const logged = dataLine(log);
  if (!logged) return null;
  const loggedNorm = normalizePath(logged);
  const userNorm = normalizePath(userData);
  if (loggedNorm === normalizePath(expectedDataDir(userData))) return null;
  if (loggedNorm === userNorm || loggedNorm.startsWith(userNorm + path.sep)) return null;
  return logged;
}

export function ownsData(log, userData) {
  if (foreignDataDir(log, userData)) return false;
  if (String(log || "").includes(expectedDataDir(userData))) return true;
  const logged = dataLine(log);
  return !!logged && normalizePath(logged) === normalizePath(expectedDataDir(userData));
}

function judgeLog(log, userData) {
  if (serverFailed(log)) return { ok: false, reason: "server-failed" };
  if (foreignDataDir(log, userData)) return { ok: false, reason: "user-data" };
  return null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function probeHealth(port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: "/api/health",
      agent: false,
      headers: { host: `127.0.0.1:${port}`, connection: "close", accept: "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        res.destroy();
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
        const ok = res.statusCode === 200 && !!body && body.ok === true && body.app === "command-ai";
        done({ ok, status: res.statusCode, body });
      });
      res.on("error", () => { res.destroy(); done({ ok: false }); });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); done({ ok: false, error: "timeout" }); });
    req.on("error", () => done({ ok: false }));
    req.end();
  });
}

export async function waitForEngine({
  budgetMs = HEALTH_BUDGET_MS,
  pollMs = HEALTH_POLL_MS,
  userData,
  readLog,
  probe = probeHealth,
  alive = () => true,
  sleepFn = sleep,
}) {
  const started = Date.now();
  let log = "";
  const finish = (extra) => ({ ...extra, log });

  while (Date.now() - started < budgetMs) {
    log = readLog() || "";
    const early = judgeLog(log, userData);
    if (early) return finish(early);
    const port = portFromLog(log);
    if (port && ownsData(log, userData)) {
      const left = budgetMs - (Date.now() - started);
      if (left <= 0) break;
      const health = await probe(port, Math.min(5000, left));
      log = readLog() || log;
      const after = judgeLog(log, userData);
      if (after) return finish(after);
      if (health && health.ok && ownsData(log, userData) && portFromLog(log) === port) return finish({ ok: true, port });
    }
    if (!alive()) {
      log = readLog() || log;
      const after = judgeLog(log, userData);
      if (after) return finish(after);
      return finish({ ok: false, reason: "exited" });
    }
    const left = budgetMs - (Date.now() - started);
    if (left <= 0) break;
    await sleepFn(Math.min(pollMs, left));
  }

  log = readLog() || log;
  const after = judgeLog(log, userData);
  if (after) return finish(after);
  const port = portFromLog(log);
  if (port && ownsData(log, userData)) {
    const health = await probe(port, 1000);
    log = readLog() || log;
    const late = judgeLog(log, userData);
    if (late) return finish(late);
    if (health && health.ok) return finish({ ok: true, port });
  }
  return finish({ ok: false, reason: "timeout" });
}

export function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function signalTree(pid, force) {
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    return new Promise((resolve) => {
      execFile("taskkill", args, { windowsHide: true, timeout: 8000 }, () => resolve());
    });
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  try { process.kill(-pid, signal); } catch { /* already gone, or not a group leader */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
  return Promise.resolve();
}

function whenExited(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
  });
}

export async function stopProcessTree(child, graceMs = CLEANUP_GRACE_MS) {
  if (!child) return;
  const pid = child.pid;
  const dropPipes = () => {
    for (const stream of [child.stdout, child.stderr, child.stdin]) {
      try { stream?.destroy(); } catch { /* already closed */ }
    }
  };
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (!pid || exited()) {
    dropPipes();
    try { child.unref(); } catch { /* already settled */ }
    return;
  }
  await signalTree(pid, false);
  await Promise.race([whenExited(child), sleep(graceMs)]);
  // Force the group after the graceful signal. A grandchild can still be
  // exiting when the parent has already reported exit, so wait once more.
  await signalTree(pid, true);
  await Promise.race([whenExited(child), sleep(graceMs)]);
  await sleep(200);
  dropPipes();
  try { child.unref(); } catch { /* already settled */ }
}

async function removeUserData(dir) {
  assertTempUserData(dir);
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows can keep the folder locked for a moment */ }
    if (!fs.existsSync(dir)) return;
    await sleep(500);
  }
  if (fs.existsSync(dir)) throw new Error("Packaged app smoke could not remove the temporary user-data folder.");
}

export function openPackagedApp({
  command,
  args,
  env,
  userData,
  budgetMs = HEALTH_BUDGET_MS,
  pollMs = HEALTH_POLL_MS,
  graceMs = CLEANUP_GRACE_MS,
  root = ROOT,
  cwd,
}) {
  assertTempUserData(userData, root);
  fs.mkdirSync(userData, { recursive: true });
  let output = "";
  const child = spawn(command, args, {
    cwd: cwd || path.dirname(command),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const take = (buf) => {
    if (output.length >= 1_000_000) return;
    output += buf.toString("utf8").slice(0, 1_000_000 - output.length);
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("error", (err) => { output += `\n${err && err.message ? err.message : err}\n`; });
  let cleaned = false;

  function readLog() {
    let file = "";
    try { file = fs.readFileSync(path.join(userData, "everborn-command.log"), "utf8"); } catch { file = ""; }
    return `${file}\n${output}`;
  }

  return {
    pid: child.pid,
    readLog,
    wait: () => waitForEngine({
      budgetMs,
      pollMs,
      userData,
      readLog,
      alive: () => child.exitCode === null && child.signalCode === null,
    }),
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await stopProcessTree(child, graceMs);
      await removeUserData(userData);
    },
  };
}

export function builderCommand(root = ROOT) {
  return {
    args: [path.join(root, "scripts", "inject-cloud-key.mjs"), "--", "electron-builder", "--win", "--dir", "--publish", "never"],
  };
}

export function unpackedExe(root = ROOT) {
  return path.join(root, "dist", "win-unpacked", "Meldmind.exe");
}

export function buildUnpackedApp({ spawnImpl = spawnSync, env = process.env, root = ROOT } = {}) {
  const buildEnv = sanitizeEnv(env);
  const { args } = builderCommand(root);
  const result = spawnImpl(process.execPath, args, { cwd: root, env: buildEnv, stdio: "inherit" });
  if (!result || result.status !== 0) {
    const status = result && result.status != null ? result.status : "no status";
    throw new Error(`Unpacked app build stopped: electron-builder --dir exited ${status}.`);
  }
  const exe = unpackedExe(root);
  if (!fs.existsSync(exe)) throw new Error(`Unpacked app build stopped: ${exe} was not produced.`);
  return exe;
}

export function failureMessage(result) {
  if (result.reason === "server-failed") return "Packaged app smoke failed: the log contains \"server failed\".";
  if (result.reason === "user-data") return "Packaged app smoke failed: the engine did not use the temporary user-data folder.";
  if (result.reason === "exited") return "Packaged app smoke failed: the app exited before the engine answered /api/health.";
  return `Packaged app smoke failed: the engine did not answer /api/health within ${HEALTH_BUDGET_MS / 1000} seconds.`;
}

export function logTail(log, lines = 80) {
  return redact(String(log || "")).split(/\r?\n/).slice(-lines).join("\n").trim();
}

async function main() {
  let code = 0;
  let session = null;
  try {
    if (reportRuntimeDeps() !== 0) return 1;
    console.log("Building the unpacked app (electron-builder --win --dir).");
    const exe = buildUnpackedApp();
    const port = await freePort();
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-smoke-"));
    assertTempUserData(userData);
    console.log(`Starting the unpacked app headless. Waiting up to ${HEALTH_BUDGET_MS / 1000} seconds for /api/health.`);
    session = openPackagedApp({
      command: exe,
      args: launchArgs(userData),
      env: launchEnv(process.env, port),
      userData,
      cwd: path.dirname(exe),
    });
    const result = await session.wait();
    if (!result.ok) {
      console.error(failureMessage(result));
      const tail = logTail(result.log);
      if (tail) console.error(tail);
      code = 1;
    } else {
      console.log(`Packaged app smoke passed: the engine answered on port ${result.port}.`);
    }
  } catch (err) {
    console.error(redact(err && err.message ? err.message : String(err)));
    code = 1;
  } finally {
    if (session) {
      try { await session.cleanup(); }
      catch (err) {
        console.error(redact(err && err.message ? err.message : String(err)));
        code = 1;
      }
    }
  }
  return code;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((code) => process.exit(code));
}
