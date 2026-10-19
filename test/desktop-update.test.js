// v0.3.2: the updater lives in the Electron main process (works with no engine and no UI), the
// launch prompt, the engine watchdog, the single-instance lock, the tray items and the web UI's
// "Restart engine" panel. electron-updater is replaced by a fake; nothing touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { ROOT } from "./helpers.js";

const require = createRequire(import.meta.url);
const { createUpdateController } = require("../electron/updater.cjs");
const { createWatchdog, describeProbeError } = require("../electron/watchdog.cjs");
const tick = () => new Promise((r) => setImmediate(r));

function fakeUpdater({ latest = "9.9.9", failDownload = false } = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => { u.calls.push("check"); const info = { version: latest, releaseNotes: "<p>Faster &amp; safer</p>" }; if (latest !== "0.0.0") u.emit("update-available", info); else u.emit("update-not-available", info); return { updateInfo: info }; };
  u.downloadUpdate = async () => { u.calls.push("download"); if (failDownload) throw new Error("network dropped\nstack"); for (const p of [10, 55, 100]) u.emit("download-progress", { percent: p }); u.emit("update-downloaded", {}); };
  u.quitAndInstall = (...a) => u.calls.push(["quitAndInstall", ...a]);
  return u;
}
function harness(opts) {
  const au = fakeUpdater(opts);
  const seen = { prompts: 0, results: 0, states: [], quit: 0 };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", ui: { prompt: () => seen.prompts++, result: () => seen.results++, state: (s) => seen.states.push(s), beforeQuit: () => seen.quit++ } });
  return { au, c, seen };
}

test("launch check prompts 'vX is ready' once, never downloads, and Later holds until the next launch", async () => {
  const { au, c, seen } = harness();
  assert.equal(au.autoDownload, false); assert.equal(au.autoInstallOnAppQuit, false);
  const s = await c.check({ prompt: true });
  assert.equal(s.phase, "available"); assert.equal(s.version, "9.9.9"); assert.equal(s.notes, "Faster & safer");
  assert.equal(seen.prompts, 1);
  assert.deepEqual(au.calls, ["check"], "a check never downloads");
  c.later();
  await c.check({ prompt: true });
  assert.equal(seen.prompts, 1, "Later: the periodic check stays quiet for this version");
  await c.check({ manual: true });
  assert.equal(seen.prompts, 2, "the tray's Check for updates always shows it");
});

test("Install now: downloads with progress, then quits and installs silently and relaunches", async () => {
  const { au, c, seen } = harness();
  await c.check({ prompt: true });
  await c.install();
  await tick();
  assert.deepEqual(au.calls.slice(0, 2), ["check", "download"]);
  assert.deepEqual(au.calls[2], ["quitAndInstall", true, true]);
  assert.ok(seen.states.some((s) => s.phase === "downloading" && s.percent === 55), "progress reaches the UI");
  assert.equal(c.state.phase, "downloaded");
  assert.equal(seen.quit, 1, "the window is told the app is quitting for the update");
});

test("a failed download is reported and can be retried; no update means a 'newest version' result", async () => {
  const { au, c } = harness({ failDownload: true });
  await c.check();
  await assert.rejects(c.install(), /network dropped/);
  assert.equal(c.state.phase, "available"); assert.equal(c.state.error, "network dropped");
  assert.ok(!au.calls.some((x) => Array.isArray(x)), "never installs a failed download");
  const none = harness({ latest: "0.0.0" });
  const s = await none.c.check({ manual: true });
  assert.equal(s.phase, "idle"); assert.equal(none.seen.prompts, 0); assert.equal(none.seen.results, 1);
});

test("an older or equal release is never offered; the server bridge keeps working", async () => {
  const { c, seen } = harness({ latest: "0.3.2" });
  assert.equal((await c.check({ prompt: true })).version, null); assert.equal(seen.prompts, 0);
  const r = await c.bridge.check();
  assert.equal(r.version, "0.3.2");
  assert.equal(typeof c.bridge.download, "function"); assert.equal(typeof c.bridge.install, "function"); assert.equal(typeof c.bridge.onEvent, "function");
});

test("engine watchdog: stuck after 15 s, offered once per outage, recovers", async () => {
  let t = 0, up = true, stuck = [], rec = 0;
  const w = createWatchdog({ now: () => t, thresholdMs: 15000, probe: async () => (up ? true : { ok: false, reason: "nothing is listening on port 4747" }), onStuck: (r) => stuck.push(r), onRecovered: () => rec++ });
  await w.tick(); assert.equal(w.stuck, false);
  up = false;
  t = 5000; await w.tick(); assert.equal(w.stuck, false, "a short blip is not an outage");
  t = 16000; await w.tick(); assert.equal(w.stuck, true);
  t = 30000; await w.tick();
  assert.deepEqual(stuck, ["nothing is listening on port 4747"], "the dialog is offered once, with the reason");
  up = true; t = 31000; await w.tick();
  assert.equal(w.stuck, false); assert.equal(rec, 1);
  const thrower = createWatchdog({ now: () => t, thresholdMs: 0, probe: async () => { throw new Error("boom"); }, onStuck: (r) => stuck.push(r) });
  await thrower.tick(); assert.equal(stuck.at(-1), "boom");
});

test("probe errors become plain reasons", () => {
  assert.match(describeProbeError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }), 4747), /nothing is listening on port 4747/);
  assert.match(describeProbeError(Object.assign(new Error("x"), { name: "TimeoutError" }), 4748), /not responding \(timed out\)/);
});

test("main process: updater set up before the engine, single instance, tray items, engine-down page", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  const ready = main.slice(main.indexOf("app.whenReady()"));
  assert.ok(ready.indexOf("setupUpdater()") > -1 && ready.indexOf("setupUpdater()") < ready.indexOf("startServer()"), "updates are set up before the engine starts");
  assert.ok(ready.indexOf("updater.check({ prompt: true })") < ready.indexOf("startServer()"), "the launch check runs alongside, not after, the engine");
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\("second-instance", \(\) => \{[^}]*focusWindow\(\)/);
  assert.match(main, /label: "Check for updates"/);
  assert.match(main, /Install update v\$\{st\.version\}/);
  assert.match(main, /label: watchdog && watchdog\.stuck \? "Restart app/);
  assert.match(main, /thresholdMs: 15000/);
  assert.match(main, /offline\.html/);
  assert.doesNotMatch(main, /require\(["']\.\.\/server/, "the main process never needs the server to update");
  const upd = fs.readFileSync(path.join(ROOT, "electron", "updater.cjs"), "utf8");
  assert.doesNotMatch(upd, /require\(["'][^"']*server/);
  for (const f of ["update.html", "offline.html"]) {
    const html = fs.readFileSync(path.join(ROOT, "electron", f), "utf8");
    assert.match(html, /Content-Security-Policy/); assert.doesNotMatch(html, /https?:\/\//, `${f} loads nothing remote`); assert.doesNotMatch(html, /\u2014/, "no em-dashes");
  }
  assert.match(fs.readFileSync(path.join(ROOT, "electron", "update.html"), "utf8"), /is ready/);
  assert.match(fs.readFileSync(path.join(ROOT, "electron", "update.html"), "utf8"), /Install now/);
});

test("web UI: 'reconnecting' turns into a Restart engine panel with a reason after about 15 s", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /const ENGINE_TIMEOUT_MS = 15000;/);
  assert.match(app, /Restart engine/);
  assert.match(app, /Reason: /);
  assert.match(app, /window\.ccDesktop\.restart\(\)/);
});
