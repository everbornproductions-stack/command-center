// The packaged smoke waits for a real /api/health answer, treats "server failed"
// as a failed launch, and always kills the process tree and the temp directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  BUILD_ARGS,
  HEALTH_BUDGET_MS,
  assertSafeUserData,
  fetchHealth,
  healthOk,
  killProcessTree,
  launchArgs,
  launchEnv,
  logFailed,
  makeUserDataDir,
  redact,
  removeDir,
  serverReadyPort,
  waitForEngine,
  windowsKillArgs,
} from "../scripts/packaged-app-smoke.mjs";
import { ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function closeServer(server) {
  try { server.closeAllConnections(); } catch {}
  await new Promise((resolve) => server.close(() => resolve()));
}

test("health wait returns when the engine answers and uses the whole budget when it does not", async () => {
  assert.equal(HEALTH_BUDGET_MS, 60000);
  const server = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ ok: true, app: "command-ai" }));
  });
  const port = server.address().port;
  try {
    const quick = Date.now();
    const ok = await waitForEngine({
      budgetMs: 5000,
      pollMs: 50,
      preferredPort: port,
      readLog: () => "starting\n",
      fetchHealth: (p) => fetchHealth(p, 1000),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.port, port);
    assert.ok(Date.now() - quick < 4000, "a live engine returns on a poll, not at the end of the budget");

    const slowStart = Date.now();
    const missed = await waitForEngine({
      budgetMs: 450,
      pollMs: 50,
      preferredPort: port + 1,
      readLog: () => "",
      fetchHealth: async () => null,
      processAlive: () => true,
    });
    const elapsed = Date.now() - slowStart;
    assert.equal(missed.ok, false);
    assert.equal(missed.reason, "engine did not answer");
    assert.ok(elapsed >= 450, `waited ${elapsed}ms, short of the 450ms budget`);
    assert.ok(elapsed < 2000, `waited ${elapsed}ms, which is past a normal poll`);
  } finally {
    await closeServer(server);
  }
});

test("server failed in the log fails the launch without waiting out the budget", async () => {
  const t0 = Date.now();
  const failed = await waitForEngine({
    budgetMs: 10000,
    pollMs: 500,
    preferredPort: 9,
    readLog: () => "server failed: Cannot find package 'undici'",
    fetchHealth: async () => ({ status: 200, json: { ok: true, app: "command-ai" } }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "server failed");
  assert.equal(logFailed(failed.log), true);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(serverReadyPort("server ready on 4751 (demo 4803)"), 4751);
  assert.equal(healthOk({ status: 200, json: { ok: true, app: "command-ai" } }), true);
  assert.equal(healthOk({ status: 200, json: { ok: true, app: "other" } }), false);
});

test("one health request that never answers is closed and the caller can poll again", async () => {
  const server = await listen(() => {});
  const port = server.address().port;
  const t0 = Date.now();
  try {
    const result = await fetchHealth(port, 400);
    const elapsed = Date.now() - t0;
    assert.equal(result, null);
    assert.ok(elapsed >= 350, `closed in ${elapsed}ms`);
    assert.ok(elapsed < 2000, `hung for ${elapsed}ms`);
  } finally {
    await closeServer(server);
  }
});

test("launch env keeps the temp dir and drops secrets", () => {
  const secret = "sb_publishable_notarealkey0001";
  const userData = path.join(os.tmpdir(), "meldmind-pack-smoke-env");
  const env = launchEnv({
    PATH: "/usr/bin",
    CC_SUPABASE_ANON_KEY: secret,
    GH_TOKEN: "ghp_notarealtokenvalue",
    CC_DEV_OWNER: "1",
    CC_DATA_DIR: path.join(ROOT, "data"),
    CC_PORT: "1",
  }, { port: 4747, userData });
  assert.equal(env.CC_PORT, "4747");
  assert.equal(env.CC_NO_AUTO_UPDATE, "1");
  assert.equal(env.CC_USER_DATA, userData);
  assert.equal(env.CC_DATA_DIR, path.join(userData, "data"));
  assert.equal(env.CC_DEV_OWNER, undefined);
  assert.equal(env.CC_SUPABASE_ANON_KEY, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(JSON.stringify(env).includes(secret), false);
  assert.equal(JSON.stringify(env).includes("ghp_notarealtokenvalue"), false);
  assert.equal(JSON.stringify(env).includes(path.join(ROOT, "data")), false);
  assert.deepEqual(launchArgs(userData), [
    `--user-data-dir=${userData}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
  ]);
  assert.equal(redact(`key ${secret} and sk-abcdefghijklmnopqrst`).includes(secret), false);
});

test("temp user data stays in the temp directory and is removed", async () => {
  const dir = makeUserDataDir();
  fs.writeFileSync(path.join(dir, "everborn-command.log"), "server ready on 4747\n");
  assert.equal(assertSafeUserData(dir), fs.realpathSync(dir));
  assert.throws(() => assertSafeUserData(ROOT));
  await removeDir(dir);
  assert.equal(fs.existsSync(dir), false);
  await removeDir(dir);
});

test("killProcessTree stops the process and a child it started", async () => {
  assert.deepEqual(windowsKillArgs(4242), ["/PID", "4242", "/T", "/F"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-kill-"));
  const pidFile = path.join(dir, "grand.pid");
  const child = spawn(process.execPath, ["-e", `
    const { spawn } = require("child_process");
    const fs = require("fs");
    const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9);"], { stdio: "ignore" });
    fs.writeFileSync(process.env.PID_FILE, String(grand.pid));
    setInterval(() => {}, 1e9);
  `], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PID_FILE: pidFile },
  });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const deadline = Date.now() + 4000;
    while (!fs.existsSync(pidFile) && Date.now() < deadline) await sleep(50);
    const grand = Number(fs.readFileSync(pidFile, "utf8"));
    assert.ok(grand > 0);
    await killProcessTree(child.pid, { graceMs: 200 });
    const gone = Date.now() + 4000;
    while ((alive(child.pid) || alive(grand)) && Date.now() < gone) await sleep(50);
    assert.equal(alive(child.pid), false);
    assert.equal(alive(grand), false);
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    try { child.kill("SIGKILL"); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("packaged smoke is wired before publish, and the unpacked build does not publish", () => {
  assert.deepEqual(BUILD_ARGS, ["--win", "--x64", "--dir", "--publish", "never"]);
  const smoke = fs.readFileSync(path.join(ROOT, "scripts", "packaged-app-smoke.mjs"), "utf8");
  assert.match(smoke, /inject-cloud-key\.mjs/);
  assert.match(smoke, /checkRuntimeDeps/);
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  const setName = main.indexOf('app.setName("Everborn Command")');
  const override = main.indexOf("CC_USER_DATA");
  const getPath = main.indexOf('app.getPath("userData")');
  assert.ok(setName >= 0 && override > setName && getPath > override);
  assert.match(main, /app\.setPath\("userData", process\.env\.CC_USER_DATA\)/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["smoke:packaged"], "node scripts/packaged-app-smoke.mjs");
  const release = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release-windows.yml"), "utf8");
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "windows-ci.yml"), "utf8");
  const key = release.indexOf("name: Require the publishable key");
  const pack = release.indexOf("name: Packaged app smoke");
  const dist = release.indexOf("name: Build the Windows installer");
  const publish = release.indexOf("name: Publish the normal release");
  assert.ok(key < pack && pack < dist && dist < publish);
  assert.match(release, /npm run smoke:packaged/);
  assert.doesNotMatch(release, /CC_PACK_UNPUBLISHED/);
  const demo = ci.indexOf("name: Smoke\n");
  const ciPack = ci.indexOf("name: Packaged app smoke");
  const ciDist = ci.indexOf("name: Package the Windows app");
  assert.ok(demo < ciPack && ciPack < ciDist);
  assert.match(ci.slice(ciPack, ciDist), /CC_PACK_UNPUBLISHED: "1"/);
  assert.match(ci, /npm run smoke:packaged/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs", "RELEASING.md"), "utf8"), /smoke:packaged/);
});
