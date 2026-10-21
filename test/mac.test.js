// Phase 14: the Mac build. What can be checked on the Windows PC: the CI workflow and builder config,
// the macOS wiring in electron/main.cjs (app menu, tray, data folder name), unsigned-build updates
// (Install now opens the download page, never downloads or quits) and the Keychain vault path
// (server/vault.js run as "darwin" with a stand-in for Electron safeStorage). Running the real app on
// a Mac is not covered here; see docs/BUILD-LOG.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ROOT, tmpDir } from "./helpers.js";

const require = createRequire(import.meta.url);
const { createUpdateController } = require("../electron/updater.cjs");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const tick = () => new Promise((r) => setImmediate(r));

test("Mac workflow: unsigned dmg and zip for x64 and arm64, one token secret, never publishes a release", () => {
  const release = read(".github/workflows/release-windows.yml");
  const wf = release.slice(release.indexOf("  mac-release:"));
  assert.ok(wf.startsWith("  mac-release:"), "unsigned dmg and zip live in the release workflow");
  assert.match(wf, /runs-on: macos-latest/);
  assert.match(release, /workflow_dispatch:/); assert.match(release, /tags: \["v\*"\]/);
  assert.match(wf, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/, "unsigned until the Apple account exists");
  assert.match(wf, /run: npm test/); assert.match(wf, /run: npm run smoke/);
  assert.match(wf, /run: npm run dist:mac/);
  assert.match(wf, /CC_SUPABASE_ANON_KEY: \$\{\{ secrets\.CC_SUPABASE_ANON_KEY/);
  assert.match(wf, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["dist:mac"], "node scripts/inject-cloud-key.mjs -- electron-builder --mac dmg zip --x64 --arm64 --publish never");
  assert.equal(pkg.scripts.dist, "node scripts/inject-cloud-key.mjs -- electron-builder --win --publish never");
  const secrets = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(secrets)].sort(), ["CC_SUPABASE_ANON_KEY", "RELEASES_TOKEN", "SUPABASE_PUBLISHABLE_KEY"]);
  assert.equal(secrets.some((s) => /SERVICE|SECRET_KEY|SB_SECRET/.test(s)), false);
  assert.match(wf, /gh release create "v\$V" --repo "\$R" --draft /, "a missing release is created as a draft");
  assert.doesNotMatch(wf, /--draft=false|--latest|gh release edit/, "the Mac job never publishes");
  assert.match(wf, /dist\/latest-mac\.yml/, "uploads the Mac update feed");
  assert.doesNotMatch(wf, /—/, "no em-dashes");
  const ci = read(".github/workflows/mac-ci.yml");
  assert.match(ci, /runs-on: macos-latest/);
  assert.match(ci, /workflow_dispatch:/);
  assert.doesNotMatch(ci, /pull_request:/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /run: npm run smoke/);
  assert.doesNotMatch(ci, /dist:mac|RELEASES_TOKEN/);
  assert.match(read("docs/ci/mac-build.yml"), /mac-release/);
});

test("Mac CI workflow: test and smoke on a release tag or by hand, never on a pull request", () => {
  const wf = read(".github/workflows/mac-ci.yml");
  assert.match(wf, /runs-on: macos-latest/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /tags: \["v\*"\]/);
  assert.match(wf, /cancel-in-progress: true/);
  assert.doesNotMatch(wf, /pull_request:/);
  assert.doesNotMatch(wf, /branches: \["main"\]/);
  assert.match(wf, /run: npm ci/);
  assert.match(wf, /run: npm test/);
  assert.match(wf, /run: npm run smoke/);
  assert.doesNotMatch(wf, /dist:mac/);
  assert.doesNotMatch(wf, /\$\{\{ secrets\./, "no signing or release secrets");
  assert.doesNotMatch(wf, /gh release/);
  assert.doesNotMatch(wf, /RELEASES_TOKEN|CSC_LINK|CSC_KEY_PASSWORD/);
  assert.doesNotMatch(wf, /—/);
  assert.equal((wf.match(/npm test/g) || []).length, 1, "the Mac job runs the suite once");
});

test("Mac CI does not run on a pull request, and Windows CI does", () => {
  const wf = read(".github/workflows/mac-ci.yml");
  const win = read(".github/workflows/windows-ci.yml");
  assert.match(wf, /runs-on: macos-latest/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /tags: \["v\*"\]/);
  assert.doesNotMatch(wf, /pull_request:/);
  assert.match(win, /pull_request:/);
  assert.match(wf, /run: npm ci/);
  assert.match(wf, /run: npm test/);
  assert.match(wf, /run: npm run smoke/);
  assert.doesNotMatch(wf, /run: npm run dist:mac/);
  assert.doesNotMatch(wf, /secrets\./);
  assert.doesNotMatch(wf, /gh release/);
  assert.doesNotMatch(wf, /—/);
  assert.match(read("docs/ci/mac-build.yml"), /not a workflow/);
});

test("pull requests run Windows tests only; Mac runs on a v* tag or a manual start", () => {
  const macCi = read(".github/workflows/mac-ci.yml");
  const win = read(".github/workflows/windows-ci.yml");
  assert.match(macCi, /workflow_dispatch:/);
  assert.match(macCi, /tags: \["v\*"\]/);
  assert.doesNotMatch(macCi, /pull_request:/);
  assert.match(win, /pull_request:/);
  assert.match(win, /runs-on: windows-latest/);
  assert.doesNotMatch(win, /macos-latest/);
  const dir = path.join(ROOT, ".github", "workflows");
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const wf = read(path.join(".github", "workflows", name));
    if (/pull_request:/.test(wf)) assert.doesNotMatch(wf, /macos-latest/, `${name} must not run on Mac for a pull request`);
  }
  assert.match(read("docs/ci/mac-build.yml"), /not a workflow/);
});

test("builder config: Mac targets and names, same appId and public releases feed", () => {
  const y = read("electron-builder.yml");
  assert.match(y, /^appId: com\.everborn\.command/m);
  const mac = y.slice(y.indexOf("\nmac:"), y.indexOf("\ndmg:"));
  assert.match(mac, /target: \[dmg, zip\]/, "zip is what Mac updates use");
  assert.match(mac, /identity: null/, "no Apple signing");
  assert.match(mac, /artifactName: "Meldmind-\$\{version\}-\$\{arch\}\.\$\{ext\}"/, "x64 and arm64 files do not overwrite each other");
  assert.match(y, /artifactName: "Meldmind-Setup-\$\{version\}\.\$\{ext\}"/, "Windows installer is Meldmind-Setup");
  assert.match(y, /repo: command-center-releases/);
  assert.ok(fs.existsSync(path.join(ROOT, "web", "icons", "icon-512.png")), "Mac icon (512 px minimum)");
});

test("main process on macOS: app menu with Edit (copy / paste), tray size, data folder name, unsigned updates", () => {
  const m = read("electron/main.cjs");
  assert.match(m, /app\.setName\("Everborn Command"\)/, "~/Library/Application Support/Everborn Command");
  assert.match(m, /Menu\.setApplicationMenu\(IS_MAC \? Menu\.buildFromTemplate\(macMenuTemplate\(\)\) : null\)/, "Windows keeps no menu bar");
  const tpl = m.slice(m.indexOf("function macMenuTemplate"), m.indexOf("function rebuildTrayMenu"));
  for (const want of [/role: "editMenu"/, /role: "windowMenu"/, /accelerator: "Command\+Q"/, /role: "hide"/]) assert.match(tpl, want);
  assert.doesNotMatch(tpl, /role: "(reload|forceReload|toggleDevTools)"/, "no reload item (reloads go through safeReload)");
  assert.doesNotMatch(tpl, /—/);
  assert.match(m, /const size = IS_MAC \? 18 : 16;/);
  assert.match(m, /pathToFileURL\(path\.join\(ROOT, "server", "index\.js"\)\)\.href/, "bundle path with a space imports as a file URL");
  assert.match(m, /const MAC_SELF_UPDATE = false;/);
  assert.match(m, /manualInstall: IS_MAC && !MAC_SELF_UPDATE/);
  assert.match(m, /openDownload: \(version\) => shell\.openExternal\(`\$\{RELEASES_PAGE\}\/tag\/v\$\{version\}`\)/);
  assert.match(m, /right-click, then Open/);
  assert.match(m, /Automatic updates for Mac are coming soon/);
  assert.match(m, /RELEASES_PAGE = "https:\/\/github\.com\/everbornproductions-stack\/command-center-releases\/releases"/);
  assert.match(m, /app\.on\("activate", \(\) => \{ if \(!win\) createWindow\(\); \}\)/, "Dock click reopens the window");
  // the Windows-style import produced a broken URL for Mac paths; the new one is a valid file URL everywhere
  assert.equal(pathToFileURL("/Applications/Command AI.app/Contents/Resources/app.asar/server/index.js", { windows: false }).href.startsWith("file:///Applications/Command%20AI.app/"), true);
});

function fakeUpdater() {
  const u = new EventEmitter(); u.calls = [];
  u.checkForUpdates = async () => { u.calls.push("check"); const info = { version: "9.9.9" }; u.emit("update-available", info); return { updateInfo: info }; };
  u.downloadUpdate = async () => { u.calls.push("download"); };
  u.quitAndInstall = () => u.calls.push("quitAndInstall");
  return u;
}

test("unsigned Mac: Install now opens the release page and never downloads or quits", async () => {
  const au = fakeUpdater(); const opened = []; let quit = 0;
  const c = createUpdateController({ autoUpdater: au, currentVersion: "0.3.2", manualInstall: true, ui: { openDownload: (v) => opened.push(v), beforeQuit: () => quit++ } });
  assert.equal(c.manualInstall, true);
  await c.check({ prompt: true });
  const s = await c.install(); await tick();
  assert.deepEqual(opened, ["9.9.9"]);
  assert.equal(s.phase, "available");
  assert.match(s.error, /Automatic updates for Mac are coming soon/);
  assert.match(s.error, /right-click, then Open/);
  assert.match(s.error, /not signed/);
  assert.equal(s.manual, true);
  // Settings path (server/update.js: download, then install)
  await assert.rejects(c.bridge.download(), (e) => e.code === "manual_install");
  c.bridge.install(); await tick();
  assert.deepEqual(au.calls, ["check"], "nothing downloaded, nothing installed");
  assert.equal(quit, 0, "the app never quits for an update it cannot install");
  assert.deepEqual(opened, ["9.9.9", "9.9.9"]);
  // the default (Windows) is unchanged
  assert.equal(createUpdateController({ autoUpdater: fakeUpdater() }).manualInstall, false);
});

// run server/vault.js in a child Node that reports "darwin"
function asMac(script, dataDir) {
  const url = (f) => JSON.stringify(pathToFileURL(path.join(ROOT, "server", f)).href);
  const head = `const S = await import(${url("store.js")}); S.setDefaultContext(S.newContext("local"));\nconst V = await import(${url("vault.js")});\n`;
  const r = spawnSync(process.execPath, ["--require", path.join(ROOT, "test", "fixtures", "as-darwin.cjs"), "--input-type=module", "-e", head + script], {
    env: { ...process.env, CC_DATA_DIR: dataDir, CC_HOSTED: "", NODE_OPTIONS: "" }, encoding: "utf8", timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

test("Keychain vault on macOS: sealed by safeStorage (ss1:), refused without the desktop app, no plain fallback", () => {
  const dir = tmpDir("cc-mac-");
  const FAKE_SS = `globalThis.__ccSafeStorage = { backend: "macOS Keychain", available: () => true,
    encrypt: (s) => Buffer.from(s).reverse().toString("base64"), decrypt: (b) => Buffer.from(b, "base64").reverse().toString() };`;
  const saved = asMac(`${FAKE_SS}
    const m = V.vaultMethod(); await V.setSecret("openai", " sk-test-mac-fake ");
    console.log(JSON.stringify({ m, platform: process.platform }));`, dir);
  assert.equal(saved.platform, "darwin");
  assert.equal(saved.m.method, "safeStorage"); assert.match(saved.m.label, /OS keychain via the desktop app \(macOS Keychain\)/);
  const file = fs.readFileSync(path.join(dir, "vault.bin"), "utf8");
  assert.ok(file.startsWith("ss1:"), "marked as a safeStorage blob");
  assert.ok(!file.includes("sk-test-mac-fake") && !Buffer.from(file.slice(4), "base64").toString().includes("sk-test-mac-fake"), "no plain or base64 key on disk");
  const back = asMac(`${FAKE_SS}
    await V.loadVault(); console.log(JSON.stringify({ key: V.getOwnSecret("openai")?.key }));`, dir);
  assert.equal(back.key, "sk-test-mac-fake", "read back on the next launch (trimmed)");
  // plain Node on a Mac (no desktop app): refuses to save, and does not read the Keychain blob
  const plain = asMac(`let err = null; try { await V.setSecret("anthropic", "sk-ant-fake"); } catch (e) { err = e.code; }
    await V.loadVault(); console.log(JSON.stringify({ m: V.vaultMethod().method, err, key: V.getOwnSecret("openai")?.key || null }));`, dir);
  assert.deepEqual(plain, { m: "none", err: "vault_unavailable", key: null });
  assert.ok(fs.readFileSync(path.join(dir, "vault.bin"), "utf8").startsWith("ss1:"), "the refused save did not overwrite the vault");
  fs.rmSync(dir, { recursive: true, force: true });
});
