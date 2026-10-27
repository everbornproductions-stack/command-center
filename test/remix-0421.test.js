// Remix (M34, Top 10 #7): a play preview folds the page into one document, and the test run catches leftovers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { inlinePage } from "../server/remix-play.js";
import { testRun } from "../server/remix-output.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cc-remix0421-"));

test("inlinePage folds local script, style and picture in, and leaves outside links alone", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "game.js"), "window.x = 1;");
    fs.writeFileSync(path.join(dir, "style.css"), "body{color:red}");
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(dir, "index.html"), '<html><head><link rel="stylesheet" href="style.css"><script src="https://cdn.example.com/x.js"></script></head><body><h1>Hi</h1><img src="a.png"><img src="../secret.png"><script src="game.js"></script></body></html>');
    const r = inlinePage(dir);
    assert.equal(r.ok, true);
    assert.match(r.html, /<style>\s*body\{color:red\}/);
    assert.match(r.html, /window\.x = 1;/);
    assert.match(r.html, /src="data:image\/png;base64,/);
    assert.match(r.html, /src="https:\/\/cdn\.example\.com\/x\.js"/);
    assert.match(r.html, /src="\.\.\/secret\.png"/);
    assert.deepEqual(r.files.sort(), ["a.png", "game.js", "index.html", "style.css"]);
    assert.equal(inlinePage(path.join(dir, "nope")).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("inlinePage will not follow a symlink out of the folder", { skip: process.platform === "win32" }, () => {
  const dir = tmp(), out = tmp();
  try {
    fs.writeFileSync(path.join(out, "secret.js"), "SECRET");
    fs.symlinkSync(path.join(out, "secret.js"), path.join(dir, "s.js"));
    fs.writeFileSync(path.join(dir, "index.html"), '<h1>Hi there</h1><script src="s.js"></script>');
    assert.doesNotMatch(inlinePage(dir).html, /SECRET/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

test("testRun: a short real page passes, a left-over 'Not described.' fails, and the note says it was not opened", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "index.html"), "<title>T</title><h1>Pong</h1><p>Play now</p>");
    const ok = testRun(dir);
    assert.equal(ok.grade, "Passed", JSON.stringify(ok.checks.filter((c) => !c.ok)));
    assert.match(ok.note, /not opened in a browser/);
    fs.writeFileSync(path.join(dir, "README.md"), "Looks: Not described.");
    const bad = testRun(dir);
    assert.equal(bad.grade, "Needs a look");
    assert.match(bad.checks.find((c) => !c.ok).detail, /README\.md/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("source: Remix has a sandboxed Play preview", () => {
  const ui = read("web", "features", "remix.js");
  assert.match(ui, /id="remix-play"/);
  assert.match(ui, /sandbox", "allow-scripts"/);
  assert.equal(/allow-same-origin/.test(ui), false);
  assert.match(read("server", "plugins", "remix.js"), /p\.startsWith\("\/play\/"\)/);
});
