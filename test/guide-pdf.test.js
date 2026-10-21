// The downloadable guide is built from the same list as the tour.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { guidePages } from "../web/features/guide.js";
import { readAppProbe } from "../scripts/app-probe.mjs";
import { writeGuidePdf } from "../scripts/guide-pdf.mjs";
import { ROOT } from "./helpers.js";

const EM = "\u2014";
const EN = "\u2013";

function pdfText(buf) {
  const src = buf.toString("latin1");
  let out = "";
  const re = /<([0-9A-Fa-f]+)>|\((?:\\.|[^\\)])*\)/g;
  for (const m of src.matchAll(re)) {
    if (m[1]) {
      const hex = m[1];
      for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    } else {
      out += m[0].slice(1, -1).replace(/\\([()\\])/g, "$1");
    }
  }
  return out.replace(/\s+/g, " ");
}

function pageCount(buf) {
  const src = buf.toString("latin1");
  return (src.match(/\/Type \/Page(?!s)/g) || []).length;
}

test("the guide builds from this app and lists every enabled feature", async () => {
  const probe = readAppProbe(ROOT);
  const pages = guidePages(probe);
  assert.deepEqual(pages.map((p) => p.id), ["hub", "missions", "remix", "builders", "research", "connect", "safety", "teams", "whats-new"]);
  for (const page of pages) {
    assert.ok(page.steps.length >= 2, page.id);
    assert.ok(page.start, page.id);
    assert.equal(page.body.includes(EM) || page.start.includes(EN), false, page.id);
  }
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const date = "October 21, 2026";
  const file = path.join(os.tmpdir(), `meldmind-guide-${process.pid}.pdf`);
  const built = await writeGuidePdf({ file, probe, version, date });
  const buf = fs.readFileSync(file);
  assert.ok(buf.subarray(0, 5).toString() === "%PDF-");
  const text = pdfText(buf);
  assert.equal(pageCount(buf), pages.length + 2, "cover, one overview, then one page per area");
  assert.match(text, /What Meldmind/);
  assert.match(text, /an Everborn product/);
  assert.match(text, new RegExp(`Version ${version.replace(".", "\\.")}`));
  assert.match(text, /October 21, 2026/);
  assert.match(text, /How to start/);
  assert.match(text, /\$18\.99 a month/);
  assert.match(text, /\$29\.99 a month/);
  assert.match(text, /\$0/);
  for (const page of pages) {
    assert.ok(text.includes(page.title), page.title);
    assert.ok(text.includes(page.body), page.body);
    assert.ok(text.includes(page.start), page.start);
    for (const step of page.steps) assert.ok(text.includes(step), step);
    for (const part of page.parts) assert.ok(text.includes(part.name), `${page.id} missing ${part.name}`);
  }
  assert.equal(built.pages.length, pages.length);
  // Remix, Zapier, and HighLevel ship in this build, so the guide names them.
  assert.ok(text.includes("Remix"));
  assert.ok(text.includes("Zapier"));
  assert.ok(text.includes("HighLevel"));
  const shipped = fs.readFileSync(path.join(ROOT, "web", "what-meldmind-can-do.pdf"));
  const shippedText = pdfText(shipped);
  assert.ok(shipped.subarray(0, 5).toString() === "%PDF-");
  for (const page of pages) {
    assert.ok(shippedText.includes(page.title), `bundled pdf missing ${page.title}`);
    for (const part of page.parts) assert.ok(shippedText.includes(part.name), `bundled pdf missing ${part.name}`);
  }
  assert.match(shippedText, new RegExp(version.replace(".", "\\.")));
  assert.match(shippedText, /an Everborn product/);

  const help = fs.readFileSync(path.join(ROOT, "web", "features", "help.js"), "utf8");
  const buttons = help.match(/Download the guide \(PDF\)/g) || [];
  assert.equal(buttons.length, 2);
  assert.match(help, /what-meldmind-can-do\.pdf/);
  const server = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
  assert.match(server, /"\.pdf": "application\/pdf"/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["build:guide"], "node scripts/build-guide.mjs");
  assert.match(pkg.scripts.dist, /^npm run build:guide && /);
  assert.match(pkg.scripts["dist:mac"], /^npm run build:guide && /);
  for (const rel of ["web/features/guide.js", "web/features/help.js", "scripts/guide-pdf.mjs", "scripts/build-guide.mjs"]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(src.includes(EM) || src.includes(EN), false, rel);
  }
});
