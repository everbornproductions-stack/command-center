// Phase 14: the Mac build. What can be checked without a Mac: the CI workflow and builder config,
// the macOS wiring in electron/main.cjs (app menu, tray, data folder name), the unsigned-build
// download notice (mocked platform and CPU), and the Keychain vault path (server/vault.js run as
// "darwin" with a stand-in for Electron safeStorage). Running the real app on a Mac is not covered
// here; see docs/BUILD-LOG.md.
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
const { createUpdateController, promptButtons, macDmgName, macReadyLine, MAC_SOON } = require("../electron/updater.cjs");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const tick = () => new Promise((r) => setImmediate(r));

test("Mac workflow: unsigned dmg and zip for x64 and arm64, one token secret, never publishes a release", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "docs/ci/mac-build.yml")), false, "the parked copy is gone");
  const wf = read(".github/workflows/mac-build.yml");
  assert.match(wf, /runs-on: macos-latest/);
  assert.match(wf, /workflow_dispatch:/); assert.match(wf, /tags: \["v\*"\]/);
  assert.match(wf, /pull_request:/); assert.match(wf, /branches: \["main"\]/);
  assert.match(wf, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/, "unsigned until the Apple account exists");
  assert.match(wf, /run: npm test/); assert.match(wf, /run: npm run smoke/);
  assert.match(wf, /run: npm run dist:mac/);
  assert.match(wf, /CC_SUPABASE_ANON_KEY: \$\{\{ secrets\.CC_SUPABASE_ANON_KEY \}\}/);
  assert.match(wf, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.match(wf, /secrets\.RELEASES_TOKEN/, "same token secret the Windows release uses");
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["dist:mac"], "node scripts/inject-cloud-key.mjs -- electron-builder --mac dmg zip --x64 --arm64 --publish never");
  assert.equal(pkg.scripts.dist, "node scripts/inject-cloud-key.mjs -- electron-builder --win --publish never");
  const secrets = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(secrets)].sort(), ["CC_SUPABASE_ANON_KEY", "RELEASES_TOKEN", "SUPABASE_PUBLISHABLE_KEY"]);
  assert.equal(secrets.some((s) => /SERVICE|SECRET_KEY|SB_SECRET/.test(s)), false);
  assert.match(wf, /gh release create "v\$V" --repo "\$R" --draft /, "a missing release is created as a draft");
  assert.doesNotMatch(wf, /--draft=false|--latest|gh release edit/, "never publishes");
  assert.match(wf, /dist\/latest-mac\.yml/, "uploads the Mac update feed");
  assert.match(wf, /right-click > Open/);
  assert.doesNotMatch(wf, /—/, "no em-dashes");
  const testJob = wf.slice(wf.indexOf("\n  test:"), wf.indexOf("\n  release:"));
  assert.match(testJob, /pull_request|refs\/heads\/main/);
  assert.match(testJob, /runs-on: macos-latest/);
  assert.match(testJob, /run: npm test/);
  assert.match(testJob, /run: npm run smoke/);
  assert.doesNotMatch(testJob, /dist:mac|RELEASES_TOKEN|gh release/, "pull requests run tests only");
  const releaseJob = wf.slice(wf.indexOf("\n  release:"));
  assert.match(releaseJob, /refs\/tags\/v/);
  assert.match(releaseJob, /run: npm run dist:mac/);
  assert.match(releaseJob, /RELEASES_TOKEN/);
});

test("builder config: Mac targets and names, same appId and public releases feed", () => {
  const y = read("electron-builder.yml");
  assert.match(y, /^appId: com\.everborn\.command/m);
  const mac = y.slice(y.indexOf("\nmac:"), y.indexOf("\ndmg:"));
  assert.match(mac, /target: \[dmg, zip\]/, "zip is what Mac updates use");
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
  assert.match(m, /platform: process\.platform/);
  assert.match(m, /arch: process\.arch/);
  assert.match(m, /fetchDmg: \(info\) => saveMacDmg\(info\)/);
  assert.match(m, /openDownload: \(info\) => openMacDownload\(info\)/);
  assert.match(m, /hostname !== "github.com"/);
  assert.match(m, /Library\/Application Support\/Everborn Command/);
  assert.match(m, /height: macNotice \? 420 : 300/);
  assert.match(m, /RELEASES_PAGE = "https:\/\/github\.com\/everbornproductions-stack\/command-center-releases\/releases"/);
  assert.match(m, /updater\.check\(\{ prompt: true \}\)/);
  assert.match(m, /prompt: true, running: true/);
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

test("unsigned Mac: Download fetches the CPU dmg and never auto-installs or quits", async () => {
  for (const arch of ["arm64", "x64"]) {
    const au = fakeUpdater(); const fetched = []; const files = []; const browsers = []; let quit = 0;
    const c = createUpdateController({
      autoUpdater: au, currentVersion: "0.4.7", manualInstall: true, platform: "darwin", arch,
      ui: {
        fetchDmg: async (info) => { fetched.push(info); return `/tmp/${info.name}`; },
        openFile: async (file) => { files.push(file); return ""; },
        openDownload: async (info) => { browsers.push(info); },
        beforeQuit: () => quit++,
      },
    });
    assert.equal(c.state.platform, "darwin");
    assert.equal(c.state.arch, arch);
    const prompted = await c.check({ prompt: true });
    assert.equal(prompted.readyLine, "Meldmind 9.9.9 is ready. Download and install it to update; your data stays.");
    assert.equal(prompted.soon, "Automatic updates for Mac are coming soon.");
    assert.match(prompted.howto, /Drag Meldmind to Applications/);
    assert.match(prompted.howto, /Replace/);
    assert.match(prompted.howto, /~\/Library\/Application Support\/Everborn Command/);
    assert.deepEqual(promptButtons(prompted), { primary: "Download", secondary: "Remind me later" });
    await c.later();
    assert.equal(fetched.length, 0, "Remind me later does not download");
    assert.equal(c.state.installOnQuit, false);
    const s = await c.install(); await tick();
    assert.equal(fetched.length, 1);
    assert.equal(fetched[0].name, macDmgName("9.9.9", arch));
    assert.equal(fetched[0].arch, arch);
    assert.equal(fetched[0].url, `https://github.com/everbornproductions-stack/command-center-releases/releases/download/v9.9.9/Meldmind-9.9.9-${arch}.dmg`);
    assert.deepEqual(files, [`/tmp/Meldmind-9.9.9-${arch}.dmg`]);
    assert.equal(browsers.length, 0);
    assert.equal(s.phase, "available");
    assert.equal(s.opened, "file");
    assert.equal(s.error, null);
    await assert.rejects(c.bridge.download(), (e) => e.code === "manual_install" && /not signed/.test(e.message) && /Automatic updates for Mac are coming soon/.test(e.message));
    c.bridge.install(); await tick();
    assert.deepEqual(au.calls, ["check"], "electron-updater never downloads or installs");
    assert.equal(quit, 0, "the app never quits for an update it cannot install");
  }
  const au = fakeUpdater(); const browsers = [];
  const c = createUpdateController({
    autoUpdater: au, currentVersion: "0.4.7", manualInstall: true, platform: "darwin", arch: "x64",
    ui: { fetchDmg: async () => { throw new Error("offline"); }, openDownload: async (info) => { browsers.push(info.url); } },
  });
  await c.check({ prompt: true });
  const s = await c.install();
  assert.equal(s.opened, "browser");
  assert.deepEqual(browsers, ["https://github.com/everbornproductions-stack/command-center-releases/releases/download/v9.9.9/Meldmind-9.9.9-x64.dmg"]);
  assert.deepEqual(au.calls, ["check"]);
  const hourlyAu = fakeUpdater();
  const hourly = createUpdateController({ autoUpdater: hourlyAu, currentVersion: "0.4.7", manualInstall: true, platform: "darwin", arch: "arm64" });
  const hourlyState = await hourly.check({ prompt: true, running: true });
  assert.equal(hourlyState.offer, "launch", "an unsigned Mac check does not offer install on quit");
  assert.equal(hourlyState.readyLine, macReadyLine("9.9.9"));
  assert.equal(promptButtons(hourlyState).secondary, "Remind me later");
  await hourly.later();
  assert.deepEqual(hourlyAu.calls, ["check"]);
  assert.equal(hourly.state.installOnQuit, false);
  const win = createUpdateController({ autoUpdater: fakeUpdater(), platform: "win32", arch: "x64" });
  assert.equal(win.manualInstall, false);
  assert.equal(promptButtons({ offer: "launch", manualInstall: false }).primary, "Install now");
  assert.equal(promptButtons({ offer: "running", manualInstall: false }).primary, "Restart and update");
});

test("mocked darwin platform: the notice names the arm64 dmg and the Gatekeeper tip is in help", () => {
  const script = `
    const { createUpdateController, promptButtons, macDmgName, macDmgUrl, macReadyLine, MAC_SOON } = require(${JSON.stringify(path.join(ROOT, "electron", "updater.cjs"))});
    const { EventEmitter } = require("node:events");
    const u = new EventEmitter();
    u.checkForUpdates = async () => { const info = { version: "0.4.10" }; u.emit("update-available", info); return { updateInfo: info }; };
    u.downloadUpdate = async () => { throw new Error("updater download"); };
    u.quitAndInstall = () => { throw new Error("quit"); };
    const c = createUpdateController({ autoUpdater: u, currentVersion: "0.4.7", manualInstall: process.platform === "darwin", arch: "arm64" });
    c.check({ prompt: true }).then((s) => {
      console.log(JSON.stringify({
        platform: process.platform,
        statePlatform: c.state.platform,
        arch: c.state.arch,
        line: s.readyLine,
        soon: s.soon,
        primary: promptButtons(s).primary,
        secondary: promptButtons(s).secondary,
        name: macDmgName("0.4.10", "arm64"),
        intel: macDmgUrl("0.4.10", "x64"),
        ready: macReadyLine("v0.4.10"),
        constant: MAC_SOON,
      }));
    }).catch((e) => { console.error(e); process.exit(1); });
  `;
  const r = spawnSync(process.execPath, ["--require", path.join(ROOT, "test", "fixtures", "as-darwin.cjs"), "-e", script], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(j.platform, "darwin");
  assert.equal(j.statePlatform, "darwin");
  assert.equal(j.arch, "arm64");
  assert.equal(j.line, "Meldmind 0.4.10 is ready. Download and install it to update; your data stays.");
  assert.equal(j.soon, MAC_SOON);
  assert.equal(j.primary, "Download");
  assert.equal(j.secondary, "Remind me later");
  assert.equal(j.name, "Meldmind-0.4.10-arm64.dmg");
  assert.match(j.intel, /Meldmind-0\.4\.10-x64\.dmg$/);
  assert.equal(j.ready, j.line);
  const help = read("docs/help/getting-started.md");
  assert.match(help, /right-click > Open/);
  assert.match(help, /Library\/Application Support\/Everborn Command/);
  const updates = read("docs/help/updates.md");
  assert.match(updates, /Meldmind X is ready\. Download and install it to update; your data stays\./);
  assert.match(updates, /Automatic updates for Mac are coming soon\./);
  assert.match(updates, /Remind me later/);
  assert.match(updates, /right-click > Open/);
  const page = read("electron/update.html");
  assert.match(page, /Meldmind \$\{s\.version\} is ready\. Download and install it to update; your data stays\./);
  assert.match(page, /Automatic updates for Mac are coming soon\./);
  assert.match(page, /Remind me later/);
  assert.match(page, /Drag Meldmind to Applications and choose Replace/);
  assert.match(page, /Install now/);
  assert.doesNotMatch(help + updates + page + read("electron/updater.cjs") + read("electron/main.cjs"), /—/);
  assert.equal(macReadyLine("1.2.3"), "Meldmind 1.2.3 is ready. Download and install it to update; your data stays.");
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
