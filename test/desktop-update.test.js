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
const { createUpdateController, CHECK_EVERY_MS, CHECK_FAILED, DOWNLOAD_PAGE, GITHUB_FEED, GENERIC_FEED, buttonLabel, promptButtons, quitInstallAction, cleanError, parseLatestYml } = require("../electron/updater.cjs");
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
function harness(opts = {}) {
  const au = fakeUpdater(opts);
  const seen = { prompts: 0, results: 0, states: [], quit: 0 };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: opts.readLatest || (async () => ({ version: "0.3.2" })), ui: { prompt: () => seen.prompts++, result: () => seen.results++, state: (s) => seen.states.push(s), beforeQuit: () => seen.quit++, failed: () => seen.failed = (seen.failed || 0) + 1 } });
  return { au, c, seen };
}

test("launch check prompts 'vX is ready' once, never downloads, and Later holds until the next launch", async () => {
  const { au, c, seen } = harness();
  assert.equal(au.autoDownload, false); assert.equal(au.autoInstallOnAppQuit, false);
  const s = await c.check({ prompt: true });
  assert.equal(s.phase, "available"); assert.equal(s.version, "9.9.9"); assert.equal(s.notes, "Faster & safer");
  assert.equal(s.offer, "launch");
  assert.equal(promptButtons(s).primary, "Install now");
  assert.equal(promptButtons(s).secondary, "Later");
  assert.equal(seen.prompts, 1);
  assert.deepEqual(au.calls, ["check"], "a check never downloads");
  c.later();
  assert.equal(c.state.installOnQuit, false);
  assert.equal(au.autoInstallOnAppQuit, false);
  assert.deepEqual(au.calls, ["check"], "launch Later does not download");
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

test("while the app is running, Later downloads and installs on quit", async () => {
  const au = fakeUpdater();
  let release;
  const gate = new Promise((r) => { release = r; });
  au.downloadUpdate = async () => {
    au.calls.push("download");
    await gate;
    au.emit("download-progress", { percent: 40 });
    au.emit("update-downloaded", {});
  };
  const seen = { prompts: 0 };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", ui: { prompt: () => seen.prompts++ } });
  const s = await c.check({ prompt: true, running: true });
  assert.equal(s.offer, "running");
  assert.equal(promptButtons(s).primary, "Restart and update");
  assert.equal(promptButtons(s).secondary, "Later");
  assert.equal(quitInstallAction(s), "skip");
  assert.equal(quitInstallAction({ installOnQuit: true, phase: "downloading" }), "wait");
  assert.equal(quitInstallAction({ installOnQuit: true, phase: "downloaded" }), "install");
  assert.equal(quitInstallAction({ installOnQuit: false, phase: "downloaded" }), "skip");
  const pending = c.later();
  assert.equal(c.state.phase, "downloading");
  assert.equal(quitInstallAction(c.state), "wait");
  const ready = c.whenQuitInstallReady();
  release();
  assert.equal(await ready, true);
  await pending;
  assert.equal(au.autoInstallOnAppQuit, false, "quit install is the app's before-quit path");
  assert.ok(au.calls.includes("download"));
  assert.equal(c.state.phase, "downloaded");
  assert.equal(c.state.installOnQuit, true);
  assert.equal(quitInstallAction(c.state), "install");
  assert.ok(!au.calls.some((x) => Array.isArray(x) && x[0] === "quitAndInstall"), "Later does not restart now");
  await c.check({ prompt: true, running: true });
  assert.equal(c.state.phase, "downloaded", "a later check keeps the downloaded update");
  assert.equal(seen.prompts, 1, "Later keeps the hourly prompt quiet for this version");
  c.installDownloaded();
  await tick();
  assert.deepEqual(au.calls.at(-1), ["quitAndInstall", true, true]);
});

test("an unsigned Mac build does not download on Later", async () => {
  const au = fakeUpdater();
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", manualInstall: true });
  const s = await c.check({ prompt: true, running: true });
  assert.equal(s.offer, "launch");
  assert.equal(promptButtons(s).primary, "Install now");
  await c.later();
  assert.deepEqual(au.calls, ["check"]);
  assert.equal(c.state.installOnQuit, false);
});

test("public feed is the releases repo, latest.yml, and a failed GitHub check retries that file", async () => {
  assert.equal(CHECK_EVERY_MS, 60 * 60 * 1000);
  assert.equal(GITHUB_FEED.provider, "github");
  assert.equal(GITHUB_FEED.owner, "everbornproductions-stack");
  assert.equal(GITHUB_FEED.repo, "command-center-releases");
  assert.equal(GITHUB_FEED.private, false);
  assert.equal(GENERIC_FEED.channel, "latest");
  assert.ok(GENERIC_FEED.url.endsWith("/"), "latest.yml must be appended, not substituted");
  assert.match(GENERIC_FEED.url, /command-center-releases\/releases\/latest\/download\/$/);
  const logs = [];
  const au = new EventEmitter();
  au.calls = [];
  au.setFeedURL = (feed) => { au.feed = feed; };
  au.checkForUpdates = async () => {
    au.calls.push(au.feed.provider);
    if (au.feed.provider === "github") throw new Error("Cannot parse releases feed\nhttps://github.com/everbornproductions-stack/command-center-releases/releases/latest?jwt=secret");
    const info = { version: "0.4.2", releaseNotes: "Meldmind" };
    au.emit("update-available", info);
    return { updateInfo: info };
  };
  au.downloadUpdate = async () => {};
  au.quitAndInstall = () => {};
  const seen = { prompts: 0 };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.4.0", log: (...a) => logs.push(a.join(" ")), ui: { prompt: () => seen.prompts++ } });
  assert.equal(au.feed, GITHUB_FEED);
  assert.equal(au.channel, "latest");
  assert.equal(au.disableDifferentialDownload, true, "renamed installer must not use the old blockmap name");
  const s = await c.check({ prompt: true });
  assert.deepEqual(au.calls, ["github", "generic"]);
  assert.equal(au.feed, GENERIC_FEED);
  assert.equal(s.phase, "available");
  assert.equal(s.version, "0.4.2");
  assert.equal(seen.prompts, 1);
  assert.equal(buttonLabel(s), "Update ready, restart");
  assert.equal(buttonLabel({ phase: "downloaded", version: "0.4.2" }), "Update ready, restart");
  assert.equal(buttonLabel({ phase: "downloading", percent: 40 }), "Downloading 40%");
  assert.equal(buttonLabel({ phase: "idle" }), null);
  const joined = logs.join("\n");
  assert.match(joined, /retrying public latest\.yml/);
  assert.match(joined, /update available: v0\.4\.2/);
  assert.doesNotMatch(joined, /jwt=/);
  assert.equal(cleanError(new Error("nope token ghp_FAKEvalue and Bearer abc.def")), "nope token redacted and Bearer redacted");

  const ok = new EventEmitter();
  ok.setFeedURL = (feed) => { ok.feed = feed; };
  ok.calls = [];
  ok.checkForUpdates = async () => { ok.calls.push(ok.feed.provider); const info = { version: "0.4.1" }; ok.emit("update-available", info); return { updateInfo: info }; };
  const quiet = createUpdateController({ autoUpdater: ok, currentVersion: "0.4.0" });
  assert.equal((await quiet.check()).version, "0.4.1");
  assert.deepEqual(ok.calls, ["github"], "a working GitHub check does not fall back");
});

test("a check that fails on both feeds is logged and the server bridge keeps the error", async () => {
  const logs = [];
  const seen = { failed: 0 };
  const au = new EventEmitter();
  au.setFeedURL = (feed) => { au.feed = feed; };
  au.checkForUpdates = async () => { throw new Error("latest.yml HTTP 404"); };
  const c = createUpdateController({
    autoUpdater: au, currentVersion: "0.4.1", log: (...a) => logs.push(a.join(" ")),
    readLatest: async () => { throw new Error("latest.yml HTTP 404"); },
    ui: { failed: () => seen.failed++ },
  });
  const s = await c.check({ prompt: true });
  assert.equal(s.phase, "failed");
  assert.equal(s.version, null);
  assert.equal(s.error, CHECK_FAILED);
  assert.match(s.detail, /latest\.yml HTTP 404/);
  assert.equal(s.downloadUrl, DOWNLOAD_PAGE);
  assert.equal(seen.failed, 0, "0.4.23.1: a check nobody asked for opens no window; the in-page strip and the log carry it");
  assert.ok(logs.some((l) => /update check failed quietly/.test(l)), "it is logged");
  assert.match(logs.join("\n"), /update check failed: latest\.yml HTTP 404/);
  const again = await c.check({ prompt: true });
  assert.equal(again.phase, "failed");
  assert.equal(seen.failed, 0, "the same failure never opens a window on an hourly check");
  const r = await c.bridge.check();
  assert.equal(r.version, "0.4.1");
  assert.equal(r.error, CHECK_FAILED);
  assert.equal(r.downloadUrl, DOWNLOAD_PAGE);
});

test("public latest.yml is the version even when the GitHub provider says there is no update", async () => {
  const yml = "version: 0.4.8\nfiles:\n  - url: Meldmind-Setup-0.4.8.exe\npath: Meldmind-Setup-0.4.8.exe\nsha512: abc\n";
  assert.deepEqual(parseLatestYml(yml), { version: "0.4.8", file: "Meldmind-Setup-0.4.8.exe" });
  assert.equal(parseLatestYml("version: '0.4.7'\npath: Meldmind-Setup-0.4.7.exe\n").version, "0.4.7");
  const au = new EventEmitter();
  au.calls = [];
  au.setFeedURL = (feed) => { au.feed = feed; };
  au.checkForUpdates = async () => {
    au.calls.push("check");
    const info = { version: "0.4.7" };
    au.emit("update-not-available", info);
    return { updateInfo: info };
  };
  au.downloadUpdate = async () => { au.calls.push("download"); };
  const seen = { prompts: 0 };
  const c = createUpdateController({
    autoUpdater: au, currentVersion: "0.4.7",
    readLatest: async () => ({ version: "0.4.8", file: "Meldmind-Setup-0.4.8.exe" }),
    ui: { prompt: () => seen.prompts++ },
  });
  const s = await c.check({ prompt: true });
  assert.equal(s.phase, "available");
  assert.equal(s.version, "0.4.8");
  assert.equal(s.file, "Meldmind-Setup-0.4.8.exe");
  assert.equal(seen.prompts, 1);
  assert.equal(buttonLabel(s), "Update ready, restart");
  assert.deepEqual(au.calls, ["check"], "finding the version does not download");
  au.emit("update-not-available", { version: "0.4.7" });
  assert.equal(c.state.version, "0.4.8", "a later not-available event does not hide the newer build");
});

test("a provider error still offers the version from public latest.yml", async () => {
  const au = new EventEmitter();
  au.setFeedURL = () => {};
  au.checkForUpdates = async () => { throw new Error("Cannot parse releases feed"); };
  const seen = { prompts: 0, failed: 0 };
  const c = createUpdateController({
    autoUpdater: au, currentVersion: "0.4.7",
    readLatest: async () => ({ version: "0.4.8", file: "Meldmind-Setup-0.4.8.exe" }),
    ui: { prompt: () => seen.prompts++, failed: () => seen.failed++ },
  });
  const s = await c.check({ prompt: true });
  assert.equal(s.version, "0.4.8");
  assert.equal(s.phase, "available");
  assert.equal(seen.prompts, 1);
  assert.equal(seen.failed, 0);
  assert.equal(buttonLabel(s), "Update ready, restart");
});

test("main process: updater set up before the engine, single instance, tray items, engine-down page", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  const ready = main.slice(main.indexOf("app.whenReady()"));
  assert.ok(ready.indexOf("setupUpdater()") > -1 && ready.indexOf("setupUpdater()") < ready.indexOf("startServer()"), "updates are set up before the engine starts");
  assert.ok(ready.indexOf("updater.check({ prompt: true })") < ready.indexOf("startServer()"), "the launch check runs alongside, not after, the engine");
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\("second-instance", \(\) => \{[^}]*focusWindow\(\)/);
  assert.match(main, /label: "Check for updates"/);
  assert.match(main, /CHECK_EVERY_MS/);
  assert.match(main, /prompt: true, running: true/);
  assert.match(main, /quitInstallAction/);
  assert.match(main, /before-quit/);
  assert.match(main, /periodic update check failed/);
  assert.doesNotMatch(main, /updater\.check\(\{ prompt: true \}\)\.catch\(\(\) => \{\}\)/);
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "updates.js"), "utf8");
  assert.match(ui, /id = "upd-top"/);
  assert.match(ui, /Update ready, restart/);
  assert.match(ui, /Couldn't check for updates/);
  assert.match(ui, /Download/);
  assert.match(main, /Couldn't check for updates/);
  assert.match(main, /second launch update check failed/);
  assert.match(main, /buttons: \["Download", "Later"\]/);
  assert.match(ui, /data-action='updates'/);
  assert.match(fs.readFileSync(path.join(ROOT, "web", "perf", "registry.js"), "utf8"), /"updates"/);
  assert.match(fs.readFileSync(path.join(ROOT, "server", "update.js"), "utf8"), /60 \* 60 \* 1000/);
  assert.doesNotMatch(ui, /\u2014/);
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
  const updatePage = fs.readFileSync(path.join(ROOT, "electron", "update.html"), "utf8");
  assert.match(updatePage, /Install now/);
  assert.match(updatePage, /Restart and update/);
  assert.match(updatePage, /installs it when you quit/);
});

test("web UI: 'reconnecting' turns into a Restart engine panel with a reason after about 15 s", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /const ENGINE_TIMEOUT_MS = 15000;/);
  assert.match(app, /Restart engine/);
  assert.match(app, /Reason: /);
  assert.match(app, /window\.ccDesktop\.restart\(\)/);
});
