// The packaged smoke builds an unpacked app, starts it headless, and waits for
// the engine. These tests cover the wait, the log check, and the cleanup with a
// stand-in process so they do not download Electron or call a real URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLEANUP_GRACE_MS,
  HEALTH_BUDGET_MS,
  HEALTH_POLL_MS,
  assertTempUserData,
  buildUnpackedApp,
  failureMessage,
  foreignDataDir,
  freePort,
  launchArgs,
  launchEnv,
  logTail,
  openPackagedApp,
  ownsData,
  probeHealth,
  processAlive,
  redact,
  serverFailed,
  waitForEngine,
} from "../scripts/packaged-smoke.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FAKE = `
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const arg = process.argv.find((item) => item.startsWith("--user-data-dir="));
const userData = arg.slice("--user-data-dir=".length);
const dataDir = path.join(userData, "data");
const port = Number(process.env.CC_PORT);
const mode = process.env.FAKE_MODE || "ok";
fs.mkdirSync(userData, { recursive: true });
const logPath = path.join(userData, "everborn-command.log");
const foreign = path.join(os.tmpdir(), "cc-not-the-smoke-dir");
function log(line) {
  fs.appendFileSync(logPath, line + "\\n");
  console.log(line);
}
log("starting v0 packaged=1 preferred port=" + port + " data=" + (mode === "foreign" ? foreign : dataDir));
if (mode === "fail" || mode === "exit") log("server failed: Cannot find package 'undici'");
if (mode === "exit") process.exit(1);
if (mode === "ok" || mode === "fail") {
  log("server ready on " + port + " (demo 1)");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000000000)"], { stdio: "ignore" });
  fs.writeFileSync(path.join(userData, "child.pid"), String(child.pid));
  http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ ok: true, app: "command-ai" }));
  }).listen(port, "127.0.0.1");
}
if (mode === "hang") setInterval(() => {}, 1000000000);
`;

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-smoke-"));
}

async function launchFake(mode, { budgetMs = 8000, pollMs = 200, graceMs = 500, port } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-fake-"));
  const userData = tempUserData();
  const script = path.join(scratch, "fake-app.mjs");
  fs.writeFileSync(script, FAKE);
  const chosen = port || await freePort();
  const session = openPackagedApp({
    command: process.execPath,
    args: [script, ...launchArgs(userData)],
    env: launchEnv({ ...process.env, FAKE_MODE: mode }, chosen),
    userData,
    budgetMs,
    pollMs,
    graceMs,
    cwd: scratch,
  });
  return { scratch, userData, port: chosen, session };
}

test("health wait, log check, and defaults are real budgets", () => {
  assert.equal(HEALTH_BUDGET_MS, 60000);
  assert.equal(HEALTH_POLL_MS, 1000);
  assert.ok(CLEANUP_GRACE_MS >= 1000);
  assert.equal(serverFailed("2026 server failed: ERR_MODULE_NOT_FOUND"), true);
  assert.equal(serverFailed("server ready on 4747"), false);
  const userData = tempUserData();
  const dataDir = path.join(userData, "data");
  const good = `starting v0 packaged=1 preferred port=9 data=${dataDir}\nserver ready on 4321 (demo 1)\n`;
  assert.equal(ownsData(good, userData), true);
  assert.equal(foreignDataDir(good, userData), null);
  assert.equal(foreignDataDir(`starting v0 packaged=1 preferred port=9 data=${path.join(ROOT, "data")}\n`, userData), path.join(ROOT, "data"));
  fs.rmSync(userData, { recursive: true, force: true });
});

test("a symlink and its real path count as the same temporary folder", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-link-"));
  const real = path.join(parent, "real");
  const link = path.join(parent, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, "dir");
  const logged = path.join(real, "data");
  const log = `starting v0 packaged=1 preferred port=9 data=${logged}\nserver ready on 1 (demo 1)\n`;
  try {
    assert.equal(foreignDataDir(log, link), null);
    assert.equal(ownsData(log, link), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("launch env drops secrets and never points at the repo data folder", () => {
  const env = launchEnv({
    PATH: process.env.PATH || "",
    HELLO: "world",
    CC_DATA_DIR: path.join(ROOT, "data"),
    CC_HQ_DIR: path.join(ROOT, "hq"),
    CC_SUPABASE_ANON_KEY: "sb_publishable_testdummyvalue",
    GH_TOKEN: "ghp_testdummyvalue",
    CUSTOM_TOKEN: "plain",
    RANDOM_PATH: "sb_publishable_anotherdummy",
  }, 5555);
  const packed = JSON.stringify(env);
  assert.equal(env.CC_PORT, "5555");
  assert.equal(env.CC_NO_AUTO_UPDATE, "1");
  assert.equal(env.CC_LIVE_PRICING, "off");
  assert.equal(env.CC_PACK_UNPUBLISHED, "1");
  assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  assert.equal(env.HELLO, "world");
  assert.equal(env.CC_DATA_DIR, undefined);
  assert.equal(env.CC_HQ_DIR, undefined);
  assert.equal(env.CC_SUPABASE_ANON_KEY, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.CUSTOM_TOKEN, undefined);
  assert.equal(packed.includes("testdummyvalue"), false);
  assert.equal(packed.includes("anotherdummy"), false);
  assert.equal(packed.includes("ghp_"), false);
  assert.equal(packed.includes(path.join(ROOT, "data")), false);
  assert.deepEqual(launchArgs(path.join(os.tmpdir(), "cc-pack-smoke-x")).slice(1), ["--headless", "--disable-gpu"]);
});

test("the unpacked build is electron-builder --dir and does not receive a key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pack-build-"));
  const exe = path.join(root, "dist", "win-unpacked", "Meldmind.exe");
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  const calls = [];
  try {
    const got = buildUnpackedApp({
      root,
      env: {
        PATH: process.env.PATH || "",
        CC_SUPABASE_ANON_KEY: "sb_publishable_testdummyvalue",
        GH_TOKEN: "ghp_testdummyvalue",
      },
      spawnImpl(cmd, args, opts) {
        calls.push({ cmd, args, env: opts.env, cwd: opts.cwd });
        fs.writeFileSync(exe, "");
        return { status: 0 };
      },
    });
    assert.equal(got, exe);
    assert.equal(calls[0].cmd, process.execPath);
    assert.equal(calls[0].cwd, root);
    assert.ok(calls[0].args.includes("--dir"));
    assert.ok(calls[0].args.includes("--win"));
    assert.deepEqual(calls[0].args.slice(-4), ["--win", "--dir", "--publish", "never"]);
    assert.equal(calls[0].env.CC_PACK_UNPUBLISHED, "1");
    assert.equal(calls[0].env.CC_SUPABASE_ANON_KEY, undefined);
    assert.equal(JSON.stringify(calls[0].env).includes("testdummyvalue"), false);
    assert.throws(() => buildUnpackedApp({
      root,
      env: { PATH: process.env.PATH || "" },
      spawnImpl() { return { status: 1 }; },
    }), /electron-builder --dir exited 1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a ready engine passes, then the process tree and user-data folder are removed", async () => {
  const { scratch, userData, port, session } = await launchFake("ok");
  try {
    const result = await session.wait();
    assert.equal(result.ok, true, result.log);
    assert.equal(result.port, port);
    assert.equal(result.log.includes("server failed"), false);
    const grand = Number(fs.readFileSync(path.join(userData, "child.pid"), "utf8"));
    assert.equal(processAlive(grand), true);
    await session.cleanup();
    assert.equal(processAlive(session.pid), false);
    assert.equal(processAlive(grand), false);
    assert.equal(fs.existsSync(userData), false);
  } finally {
    await session.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("server failed fails the smoke even when a port answers, and the process is stopped", async () => {
  const { scratch, userData, session } = await launchFake("fail");
  try {
    const started = Date.now();
    const result = await session.wait();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "server-failed");
    assert.ok(Date.now() - started < 5000, "a server failed log returns without waiting out the whole budget");
    assert.match(failureMessage(result), /server failed/);
    const grand = Number(fs.readFileSync(path.join(userData, "child.pid"), "utf8"));
    await session.cleanup();
    assert.equal(processAlive(session.pid), false);
    assert.equal(processAlive(grand), false);
    assert.equal(fs.existsSync(userData), false);
    assert.equal(logTail(`token sb_publishable_testdummyvalue\nserver failed`).includes("testdummyvalue"), false);
    assert.match(logTail("server failed: missing undici"), /server failed/);
  } finally {
    await session.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("an engine that never answers waits out the budget, then cleanup runs", async () => {
  const { scratch, session } = await launchFake("hang", { budgetMs: 900, pollMs: 300, graceMs: 400 });
  try {
    const started = Date.now();
    const result = await session.wait();
    const elapsed = Date.now() - started;
    assert.equal(result.ok, false);
    assert.equal(result.reason, "timeout");
    assert.ok(elapsed >= 800, `waited ${elapsed}ms, which is less than the budget`);
    assert.match(failureMessage(result), /60 seconds/);
    await session.cleanup();
    assert.equal(processAlive(session.pid), false);
  } finally {
    await session.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("a log that names another data folder is a failure and that folder is not read", async () => {
  const { scratch, session } = await launchFake("foreign");
  const outsider = path.join(os.tmpdir(), "cc-not-the-smoke-dir");
  try {
    const result = await session.wait();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "user-data");
    assert.equal(fs.existsSync(outsider), false);
    assert.match(failureMessage(result), /temporary user-data folder/);
  } finally {
    await session.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("an early exit is a failure and the temporary folder is removed", async () => {
  const { scratch, userData, session } = await launchFake("exit");
  try {
    const result = await session.wait();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "server-failed");
    await session.cleanup();
    assert.equal(fs.existsSync(userData), false);
    assert.equal(processAlive(session.pid), false);
  } finally {
    await session.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test("the health probe closes its socket", async () => {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/api/health");
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ ok: true, app: "command-ai" }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  try {
    const health = await probeHealth(port, 2000);
    assert.equal(health.ok, true);
    const wrong = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ ok: true, app: "other" }));
    });
    const otherPort = await freePort();
    await new Promise((resolve) => wrong.listen(otherPort, "127.0.0.1", resolve));
    try {
      assert.equal((await probeHealth(otherPort, 2000)).ok, false);
    } finally {
      wrong.closeAllConnections?.();
      await new Promise((resolve) => wrong.close(() => resolve()));
    }
    await Promise.race([
      new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
      new Promise((_, reject) => setTimeout(() => reject(new Error("health socket stayed open")), 2000)),
    ]);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("the wait returns on the next poll after the engine is ready", async () => {
  const userData = tempUserData();
  const dataDir = path.join(userData, "data");
  let reads = 0;
  try {
    const started = Date.now();
    const result = await waitForEngine({
      budgetMs: 5000,
      pollMs: 250,
      userData,
      readLog: () => {
        reads += 1;
        if (reads < 3) return `starting v0 packaged=1 preferred port=1 data=${dataDir}\n`;
        return `starting v0 packaged=1 preferred port=1 data=${dataDir}\nserver ready on 4242 (demo 1)\n`;
      },
      probe: async () => ({ ok: true }),
      alive: () => true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.port, 4242);
    assert.ok(Date.now() - started >= 400, "two polls elapsed before the engine was ready");
    assert.equal(redact("server failed").includes("server failed"), true);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("user data inside the repo is refused", () => {
  assert.throws(() => assertTempUserData(path.join(ROOT, "data", "pack-smoke")), /repo data folder/);
  assert.throws(() => assertTempUserData(path.join(ROOT, "tmp-pack")), /inside the repo/);
  assert.throws(() => openPackagedApp({
    command: process.execPath,
    args: [],
    env: process.env,
    userData: path.join(ROOT, "data", "pack-smoke"),
  }), /repo data folder/);
});
