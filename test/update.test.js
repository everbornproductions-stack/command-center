// In-app updates: the desktop bridge (electron-updater) only downloads and installs when asked,
// web / hosted copies refuse the install route, and the service worker is stamped with the version.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-upd-");
const upd = await import("../server/update.js");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const bump = (v) => { const [a, b] = v.split(".").map(Number); return `${a}.${b + 1}.0`; };

test("newer() compares versions and ignores a leading v", () => {
  assert.equal(upd.newer("1.2.0", "1.1.9"), true);
  assert.equal(upd.newer("v1.10.0", "1.9.0"), true);
  assert.equal(upd.newer("1.0.0", "1.0.0"), false);
  assert.equal(upd.newer("0.9.9", "1.0.0"), false);
});

test("no desktop bridge: install is refused with not_desktop", async () => {
  delete globalThis.__ccUpdater;
  assert.equal(upd.updateState().desktop, false);
  await assert.rejects(upd.installUpdate(), (e) => e.code === "not_desktop" && e.status === 400);
});

test("desktop bridge: check never downloads; install downloads once then installs", async () => {
  const calls = [];
  const next = bump(pkg.version);
  globalThis.__ccUpdater = {
    onEvent() {},
    async check() { calls.push("check"); return { version: next, notes: "test notes" }; },
    async download() { calls.push("download"); },
    install() { calls.push("install"); },
  };
  try {
    const s = await upd.checkForUpdate();
    assert.equal(s.desktop, true); assert.equal(s.available, true); assert.equal(s.latest, next); assert.equal(s.phase, "available");
    assert.deepEqual(calls, ["check"], "a check must not download anything");
    const r = await upd.installUpdate();
    assert.equal(r.phase, "downloading");
    await new Promise((res) => setTimeout(res, 20));
    assert.deepEqual(calls, ["check", "download", "install"]);
    assert.equal(upd.updateState().phase, "installing");
  } finally { delete globalThis.__ccUpdater; }
});

test("desktop bridge: download error is reported and the update stays available", async () => {
  const next = bump(pkg.version);
  globalThis.__ccUpdater = { onEvent() {}, async check() { return { version: next }; }, async download() { throw new Error("network dropped"); }, install() { throw new Error("must not install"); } };
  try {
    await upd.checkForUpdate();
    await upd.installUpdate();
    await new Promise((res) => setTimeout(res, 20));
    const s = upd.updateState();
    assert.equal(s.phase, "available"); assert.match(s.error, /network dropped/);
  } finally { delete globalThis.__ccUpdater; }
});

test("desktop bridge: same version is not an update; install is refused", async () => {
  globalThis.__ccUpdater = { onEvent() {}, async check() { return { version: pkg.version }; }, async download() { throw new Error("no"); }, install() {} };
  try {
    const s = await upd.checkForUpdate();
    assert.equal(s.available, false); assert.equal(s.phase, "idle");
    await assert.rejects(upd.installUpdate(), (e) => e.code === "no_update");
  } finally { delete globalThis.__ccUpdater; }
});

test("server: /update state, install refused outside the desktop app, sw.js stamped with the version", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/update", { noToken: true })).status, 401);
    const g = await s.api("/update");
    assert.equal(g.status, 200); assert.equal(g.json.current, pkg.version); assert.equal(g.json.desktop, false);
    const c = await s.api("/update/check", { method: "POST" });
    assert.equal(c.status, 200); assert.equal(c.json.available, false, "stub feed says 0.0.1");
    const i = await s.api("/update/install", { method: "POST" });
    assert.equal(i.status, 400); assert.equal(i.json.code, "not_desktop");
    const sw = await s.raw({ path: "/sw.js" });
    assert.equal(sw.status, 200);
    assert.ok(sw.text.includes(pkg.version), "sw.js carries the app version");
    assert.ok(!sw.text.includes("__CC_VERSION__"));
  } finally { await s.stop(); }
});

test("installer config keeps user data and publishes to a public releases feed", () => {
  const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
  assert.match(yml, /perMachine:\s*false/);
  assert.match(yml, /deleteAppDataOnUninstall:\s*false/);
  assert.match(yml, /provider:\s*github/);
  assert.match(yml, /repo:\s*command-center-releases/);
  assert.doesNotMatch(yml, /^\s*(token|private)\s*:/im, "never embed a token");
  assert.ok(pkg.dependencies["electron-updater"], "electron-updater ships with the app");
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  assert.match(main, /autoDownload = false/);
  assert.match(main, /autoInstallOnAppQuit = false/);
});

test("branding: Command AI everywhere users look, appId and data folder unchanged so updates keep data", () => {
  const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
  assert.match(yml, /^productName: Command AI$/m);
  assert.match(yml, /^appId: com\.everborn\.command\b/m, "appId must never change");
  assert.match(yml, /Command-AI-Setup-\$\{version\}/);
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  assert.match(main, /app\.setName\("Everborn Command"\)/, "user-data folder name stays the same");
  assert.match(main, /title: "Command AI"/);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "Command AI");
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  assert.match(html, /<title>Command AI<\/title>/);
  assert.match(html, /an Everborn product/);
  for (const f of ["web/index.html", "web/app.js", "web/manifest.webmanifest", "web/share.html", "web/features/workspaces.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("\u2014"), `no em-dash in ${f}`);
});
