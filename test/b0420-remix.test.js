// 0.4.20 area B item 4 and 5: Remix writes what the AIs made into its folder, a real test run, a zip,
// license names, and a copy guard that names the blocked words. Fixtures only. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { extractFiles, standardFiles, finishRemix, testRun, zipStore } from "../server/remix-output.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const { checkLicense, noCopyGuard } = await import("../server/remix.js");

test("long license names are accepted, and non-free ones still are not", () => {
  for (const n of ["Apache License 2.0", "Apache License, Version 2.0", "MIT License", "The MIT License", "BSD 3-Clause License", "Mozilla Public License 2.0", "ISC License"]) {
    const hit = checkLicense({ name: "x", license: n });
    assert.equal(hit.ok, true, n);
  }
  assert.equal(checkLicense({ name: "x", license: "Apache License 2.0" }).spdx, "Apache-2.0");
  assert.equal(checkLicense({ name: "x", license: "GPL-3.0" }).ok, false);
  assert.equal(checkLicense({ name: "x", license: "Proprietary License" }).ok, false);
  assert.equal(checkLicense({ name: "x", license: "" }).ok, false);
});

test("the copy guard names the words and lets ordinary unpacking through", () => {
  const bad = noCopyGuard("please decompile the game");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /The words "decompile" stopped this/);
  assert.equal(noCopyGuard("unpack the apk and take the art").ok, false);
  assert.equal(noCopyGuard("A calm game about unpacking boxes in a new flat").ok, true);
  assert.equal(noCopyGuard("The hero is unpacking after a trip").ok, true);
});

test("answers are split into named files", () => {
  const files = extractFiles("Here you go.\n```html index.html\n<h1>Hi</h1>\n```\n```js\nlet a = 1;\n```\n```css style.css\nbody{}\n```\n```text ../evil.txt\nx\n```");
  assert.deepEqual(Object.keys(files).sort(), ["index.html", "script.js", "style.css"]);
});

test("a finished remix gets the files a project has, a characters file and a real test run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b0420-remix-"));
  try {
    const plan = { projectName: "Luma Tiles", summary: "A calm puzzle", own: { name: "Luma Co", characters: "Luma the fox", look: "night blue" } };
    const answer = "```html index.html\n<!doctype html><html lang=\"en\"><head><title>Luma</title></head><body><h1>Luma Tiles</h1><p>A calm puzzle about lamps and a fox named Luma.</p><script src=\"script.js\"></script></body></html>\n```\n```js script.js\ndocument.title = 'Luma';\n```";
    const out = finishRemix(dir, plan, answer);
    for (const f of ["index.html", "script.js", "package.json", "playwright.config.js", "README.md", "LICENSE", ".gitignore", "characters.md", "OUTPUT.md", "TESTRUN.json"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
    assert.match(fs.readFileSync(path.join(dir, "characters.md"), "utf8"), /Luma the fox/);
    assert.equal(out.test.grade, "Passed");
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name, "luma-tiles");
    // break the page: a missing script and a script with a syntax error are caught
    fs.writeFileSync(path.join(dir, "index.html"), "<html><head><title>T</title></head><body><h1>H</h1><p>Some words here that are long enough.</p><script src=\"gone.js\"></script><script>let = ;</script></body></html>");
    const bad = testRun(dir);
    assert.equal(bad.grade, "Needs a look");
    assert.ok(bad.checks.some((c) => !c.ok && /file the page uses/.test(c.name)));
    assert.ok(bad.checks.some((c) => !c.ok && /scripts read/.test(c.name)));
    for (const f of Object.values(standardFiles(plan))) assert.doesNotMatch(f, /[–—]/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the zip writer makes a valid archive", () => {
  const z = zipStore({ "a/one.txt": "hello", "a/two.txt": Buffer.from("world!") });
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 2);
});

test("the server reports what was made and serves a zip", async () => {
  const s = await startServer({ seed(dir) { fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "TEST-KEY", tier: "extreme", status: "active", lastOkAt: Date.now(), checkedAt: Date.now() })); } });
  try {
    const body = { source: "screenshots", looks: "A bright board with large round tiles.", plays: "Tap a tile to swap it.", works: "Levels speed up.", appType: "game", own: { name: "Luma Tiles", characters: "Luma the fox" }, engineId: "scratch-page", start: "description", confirm: true };
    const prev = await s.api("/remix/preview", { method: "POST", body });
    assert.equal(prev.status, 200);
    assert.ok(Array.isArray(prev.json.proChoices));
    const run = await s.api("/remix/run", { method: "POST", body });
    assert.equal(run.status, 200, run.json?.error);
    const id = run.json.projectId;
    const res = await s.api(`/remix/result/${id}`);
    assert.equal(res.status, 200);
    assert.ok(res.json.files.includes("package.json") && res.json.files.includes("characters.md") && res.json.files.includes("LICENSE"));
    assert.equal(res.json.folder, `projects/${id}`);
    const test = await s.api("/remix/test", { method: "POST", body: { confirm: true, projectId: id } });
    assert.equal(test.status, 200);
    assert.equal(test.json.run?.ran, true, "a real run, not the accessibility check alone");
    const zip = await s.raw({ path: `/api/remix/zip/${id}`, headers: { "x-cc-token": s.token } });
    assert.equal(zip.status, 200);
  } finally { await s.stop(); }
});

test("the last step shows where it was saved, and the hub call is guarded", () => {
  const ui = read("web", "features", "remix.js");
  assert.match(ui, /Saved at <code>/);
  assert.match(ui, /id="remix-open-folder"/);
  assert.match(ui, /id="remix-zip"/);
  assert.match(ui, /if \(window\.CC\.saveToMindMedia && /);
  assert.match(ui, /step = "published";\n\s+await showMade/);
  assert.match(ui, /Paid choices in this build/);
});
