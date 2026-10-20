// Proprietary licence, third-party notices, and the packaged-app hardening.
// Packaging itself runs in Windows CI (`npm run dist`). These checks stay on the source tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, tmpDir } from "./helpers.js";
import { minifyWeb } from "../scripts/minify-renderer.mjs";
import { collectProduction, copyleftKind, renderNotices } from "../scripts/third-party-notices.mjs";

const COPYRIGHT = "Copyright (c) 2026 Everborn Productions. All rights reserved.";
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("LICENSE is proprietary and package.json stays UNLICENSED at the current version", () => {
  const license = read("LICENSE");
  assert.ok(license.includes(COPYRIGHT));
  assert.match(license, /proprietary/i);
  assert.match(license, /use, copy, modify, or distribute/);
  assert.match(license, /written permission/);
  assert.doesNotMatch(license, /\u2014/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.license, "UNLICENSED");
  assert.equal(pkg.author, "Everborn Productions");
  assert.equal(pkg.version, "0.4.5");
  assert.equal(pkg.private, true);
});

test("main entry files and the About line carry the copyright", () => {
  for (const file of ["electron/main.cjs", "server/index.js", "web/app.js", "web/index.html", "worker/index.js"]) {
    assert.ok(read(file).includes(COPYRIGHT), file);
  }
  const main = read("electron/main.cjs");
  assert.match(main, /About Meldmind/);
  assert.match(main, /an Everborn product\\nTake command of all your AIs\.\\nCopyright \(c\) 2026 Everborn Productions\. All rights reserved\./);
  const app = read("web/app.js");
  assert.match(app, /id="about-line"/);
  assert.ok(app.includes(COPYRIGHT));
  assert.doesNotMatch(app, /\u2014/);
});

test("packaged Electron build keeps asar, fuses, and DevTools off", () => {
  const yml = read("electron-builder.yml");
  assert.match(yml, /^asar: true$/m);
  assert.match(yml, /runAsNode: false/);
  assert.match(yml, /enableNodeCliInspectArguments: false/);
  assert.match(yml, /enableEmbeddedAsarIntegrityValidation: true/);
  assert.match(yml, /onlyLoadAppFromAsar: true/);
  assert.match(yml, /bytenode is not used/);
  assert.match(yml, /^ {2}- LICENSE$/m);
  assert.match(yml, /^ {2}- THIRD-PARTY-NOTICES$/m);
  assert.match(yml, /asarUnpack:\s*\n\s*- extension\/\*\*/);
  const main = read("electron/main.cjs");
  assert.match(main, /devTools: !isPackaged/);
  assert.match(main, /devtools-opened/);
  assert.match(main, /key === "f12"/);
  assert.equal((main.match(/webPreferences: windowPrefs\(/g) || []).length, 3);
  const menu = main.slice(main.indexOf("function macMenuTemplate"), main.indexOf("function rebuildTrayMenu"));
  assert.doesNotMatch(menu, /role: "(reload|forceReload|toggleDevTools)"/);
  assert.match(read("electron/browser-helper.cjs"), /devTools: process\.env\.CC_PACKAGED !== "1"|const devTools = process\.env\.CC_PACKAGED !== "1"/);
  assert.match(read("scripts/minify-renderer.mjs"), /bytenode is not used/);
  assert.match(read("scripts/inject-cloud-key.mjs"), /minifyWeb\(path\.join\(ROOT, "web"\)\)/);
});

test("renderer minify shrinks app.js, still parses, and restore puts the copy back", () => {
  const dir = tmpDir("cc-minify-");
  const web = path.join(dir, "web");
  try {
    fs.cpSync(path.join(ROOT, "web"), web, { recursive: true });
    const before = fs.readFileSync(path.join(web, "app.js"));
    const restore = minifyWeb(web);
    const after = fs.readFileSync(path.join(web, "app.js"));
    assert.ok(after.length < before.length, "app.js should shrink");
    assert.ok(restore.count > 10);
    const jsFiles = [];
    for (const rel of fs.readdirSync(web, { recursive: true })) {
      const file = path.join(web, rel.toString());
      if (file.endsWith(".js")) jsFiles.push(file);
    }
    for (const file of jsFiles) {
      const ran = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(ran.status, 0, `${path.relative(web, file)}\n${ran.stderr || ""}`);
    }
    assert.match(fs.readFileSync(path.join(web, "styles.css"), "utf8"), /\.topbar/);
    restore();
    assert.equal(fs.readFileSync(path.join(web, "app.js")).equals(before), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("minified shared modules keep the exports the server imports", async () => {
  const dir = tmpDir("cc-minify-exports-");
  const web = path.join(dir, "web");
  try {
    fs.cpSync(path.join(ROOT, "web"), web, { recursive: true });
    minifyWeb(web);
    const mode = await import(pathToFileURL(path.join(web, "mode.js")).href);
    const picker = await import(pathToFileURL(path.join(web, "project-picker.js")).href);
    const usage = await import(pathToFileURL(path.join(web, "graph-usage.js")).href);
    const cryptoMod = await import(pathToFileURL(path.join(web, "sync-crypto.js")).href);
    const board = await import(pathToFileURL(path.join(web, "features", "prompt-board.js")).href);
    const voice = await import(pathToFileURL(path.join(web, "features", "voice-mode.js")).href);
    assert.equal(typeof mode.isFreshInstall, "function");
    assert.equal(typeof picker.projectSlug, "function");
    assert.equal(typeof usage.isUsageJob, "function");
    assert.equal(typeof cryptoMod.MIN_PASSPHRASE, "number");
    assert.ok(Array.isArray(board.SHELVES));
    assert.ok(Array.isArray(voice.MODES));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("THIRD-PARTY-NOTICES matches the production tree and names copyleft", () => {
  assert.equal(copyleftKind("MIT"), null);
  assert.equal(copyleftKind("MIT OR GPL-3.0"), null);
  assert.equal(copyleftKind("GPL-3.0"), "strong");
  assert.equal(copyleftKind("AGPL-3.0-only"), "strong");
  assert.equal(copyleftKind("LGPL-2.1"), "weak");
  assert.equal(copyleftKind("MPL-2.0"), "weak");
  const report = collectProduction();
  const text = read("THIRD-PARTY-NOTICES");
  assert.equal(text, renderNotices(report));
  for (const name of ["@anthropic-ai/sdk", "electron-updater", "qrcode-generator", "ws", "Electron"]) {
    assert.ok(text.includes(name), name);
  }
  assert.match(text, /Strong copyleft \(GPL, AGPL, SSPL, EUPL, OSL\): none/);
  assert.match(text, /Weak copyleft \(LGPL, MPL, EPL, CDDL, CC-BY-SA\): none/);
  assert.equal(report.strong.length, 0);
  assert.equal(report.weak.length, 0);
});

test("legal templates say to have an attorney review, and the secrets plan does not deploy", () => {
  for (const file of ["docs/legal/contributor-ip-assignment.md", "docs/legal/nda-template.md"]) {
    const text = read(file);
    assert.match(text, /Have an attorney review/);
    assert.match(text, /not legal advice/i);
    assert.match(text, /Everborn Productions/);
    assert.match(text, /Meldmind/);
    assert.doesNotMatch(text, /\u2014/);
  }
  const plan = read("docs/plans/server-side-secrets.md");
  assert.match(plan, /Plan only/);
  assert.match(plan, /Do not deploy/);
  assert.match(plan, /learning-rank/);
  assert.match(plan, /community-scores/);
  assert.match(plan, /license-check/);
  assert.match(plan, /server\/brain\.js/);
  assert.match(plan, /server\/community\.js/);
  assert.match(plan, /server\/license\.js/);
  assert.match(plan, /square-webhook/);
  assert.match(plan, /bytenode/);
  assert.doesNotMatch(plan, /\u2014/);
  assert.equal(fs.existsSync(path.join(ROOT, "supabase/functions/learning-rank")), false);
});
