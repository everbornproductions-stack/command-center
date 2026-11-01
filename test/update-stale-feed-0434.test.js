// 0.4.34 (Nov 1 2026): Install refused with "Please check update first" because the updater's copy of the release list
// still showed the old version while Meldmind's own check already saw the new one. The updater now looks again before
// downloading, and waits for the list to catch up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createUpdateController } = require("../electron/updater.cjs");

function staleFeed(staleLooks) {
  const u = new EventEmitter();
  u.looks = 0; u.downloads = 0; u.known = null;
  u.checkForUpdates = async () => {
    u.looks++;
    const version = u.looks <= staleLooks ? "0.3.2" : "0.3.3";
    const info = { version };
    if (version === "0.3.3") { u.known = version; u.emit("update-available", info); } else u.emit("update-not-available", info);
    return { updateInfo: info };
  };
  u.downloadUpdate = async () => { if (u.known !== "0.3.3") throw new Error("Please check update first"); u.downloads++; u.emit("update-downloaded", {}); };
  u.quitAndInstall = () => {};
  return u;
}

test("download looks again first, waits while the list is stale, then downloads", async () => {
  const au = staleFeed(2); // the first two looks still see the old version
  const logs = [];
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: async () => ({ version: "0.3.3" }), retryMs: 10, log: (...a) => logs.push(a.join(" ")) });
  await c.bridge.download();
  assert.equal(au.downloads, 1, "downloaded once the list caught up");
  assert.ok(au.looks >= 3);
  assert.ok(logs.some((l) => /has not caught up yet/.test(l)));
});

test("a list that is already current downloads at once, with a single look", async () => {
  const au = staleFeed(0);
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: async () => ({ version: "0.3.3" }), retryMs: 10 });
  await c.bridge.download();
  assert.equal(au.looks, 1); assert.equal(au.downloads, 1);
});

test("a list that never catches up still ends with the updater's own plain error, after three looks", async () => {
  const au = staleFeed(99);
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: async () => ({ version: "0.3.3" }), retryMs: 10 });
  await assert.rejects(() => c.bridge.download(), /Please check update first/);
  assert.equal(au.looks, 3);
});

// 0.4.36 (panel 0434 item 1): "Update and restart" on the card, the tray item and the engine dialog go through install()
test("install() waits for a stale list too, then downloads and restarts", async () => {
  const au = staleFeed(2);
  let quit = 0; au.quitAndInstall = () => { quit++; };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: async () => ({ version: "0.3.3" }), retryMs: 10 });
  await c.check();
  await c.install();
  await new Promise((r) => setImmediate(r));
  assert.equal(au.downloads, 1, "downloaded once the list caught up");
  assert.ok(au.looks >= 3, `looked ${au.looks} times`);
  assert.equal(quit, 1, "restarted into the installer");
  assert.equal(c.state.waiting, false, "the waiting note is cleared");
});

test("install() on a list that never catches up ends with the plain error and stays open", async () => {
  const au = staleFeed(99);
  let quit = 0; au.quitAndInstall = () => { quit++; };
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", readLatest: async () => ({ version: "0.3.3" }), retryMs: 10 });
  await c.check();
  await assert.rejects(() => c.install(), /Please check update first/);
  assert.equal(quit, 0);
  assert.equal(c.state.phase, "available");
  assert.equal(c.state.waiting, false);
});
