// 0.4.29 (Oct 31 2026): installing 0.4.28 on Chris's PC, Windows held the installer for two minutes and then said
// "spawn EPERM" (antivirus), and the app quit and stayed closed. Now the updater tells the app, which stays open,
// takes its one-copy lock back, cancels the updater's quit once and offers Download.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createUpdateController } = require("../electron/updater.cjs");
const tick = () => new Promise((r) => setImmediate(r));

function fake() {
  const u = new EventEmitter();
  u.checkForUpdates = async () => { const info = { version: "9.9.9" }; u.emit("update-available", info); return { updateInfo: info }; };
  u.downloadUpdate = async () => { u.emit("update-downloaded", {}); };
  u.quitAndInstall = () => { u.emit("error", new Error("Error: spawn EPERM")); };
  return u;
}

test("a blocked installer (spawn EPERM) is reported to the app once, and only while installing", async () => {
  const au = fake();
  const seen = { failed: [], quit: 0 };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: async () => ({ version: "0.3.2" }), ui: { beforeQuit: () => seen.quit++, installFailed: (m) => seen.failed.push(m) } });
  await c.check({ prompt: false });
  // an error that is not about starting the installer, outside an install: not reported
  au.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"));
  assert.equal(seen.failed.length, 0);
  await au.downloadUpdate();
  c.install();
  await tick(); await tick();
  assert.equal(seen.quit, 1);
  assert.equal(seen.failed.length, 1);
  assert.match(seen.failed[0], /EPERM/);
  // the same error later (not installing any more) is not reported again
  au.emit("error", new Error("spawn EPERM"));
  assert.equal(seen.failed.length, 1);
});

test("the app stays open, takes its lock back, cancels one quit and offers Download in plain words", () => {
  const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(main, /installFailed: \(message\) => \{[\s\S]*?quittingForUpdate = false;[\s\S]*?installBlocked = true;[\s\S]*?app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /if \(installBlocked\) \{ installBlocked = false; event\.preventDefault\(\);/);
  assert.match(main, /The update could not start/);
  assert.match(main, /Meldmind is still open and nothing changed\. Download the installer and run it yourself, or try again later\./);
  assert.ok(!main.includes(String.fromCharCode(0x2014)));
});
