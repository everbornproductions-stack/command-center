// 0.4.28 (dogfood batch 3, slides): "save it as pitch.pptx" must give a real PowerPoint deck built from the AI's
// markdown (one "## " heading per slide), not a python-pptx script and not text with a .pptx name. Temp folders only,
// nothing sent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pptx0428-"));
process.env.CC_DATA_DIR = DATA;
const office = await import("../server/office-files.js");
const named = await import("../server/named-file.js");
const guard = await import("../server/step-guard.js");
const { saveEveryNamedFile } = await import("../server/save-named-files.js");
test.after(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

// read one entry out of a zip written by office-files.js (deflate or stored)
function unzipEntry(buf, want) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, "zip has an end record");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    names.push(name);
    if (name === want) {
      const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
      const data = buf.slice(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8");
    }
    p += 46 + nlen + elen + clen;
  }
  if (want === null) return names;
  throw new Error(`${want} not in zip: ${names.join(", ")}`);
}

const python = (() => {
  for (const cmd of ["python", "python3", "py"]) {
    const r = spawnSync(cmd, ["-I", "-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 30000 });
    if (r.status === 0 && r.stdout.trim() === "3") return cmd;
  }
  return null;
})();
const hasPythonPptx = python ? spawnSync(python, ["-I", "-c", "import pptx"], { timeout: 30000 }).status === 0 : false;
// the script reads the path from argv: nothing is run from the temp folder
function py(code, file) {
  const r = spawnSync(python, ["-I", "-c", code, file], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `python failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const ZIP_CHECK = "import zipfile,sys,json,re; z=zipfile.ZipFile(sys.argv[1]); n=z.namelist(); print(json.dumps({'bad': z.testzip(), 'names': n, 'slides': len([x for x in n if re.match(r'ppt/slides/slide[0-9]+[.]xml$', x)])}))";

// six slides: a title slide, bullets with nesting, a table, a numbered list, a paragraph, and notes
const DECK = [
  "Here is your deck:",
  "",
  "# Bright Bakery Pitch",
  "",
  "Fresh bread, delivered by 7am",
  "",
  "## The Problem",
  "",
  "- Cafes run out of bread by noon",
  "  - Two deliveries cost too much",
  "- Supermarket bread is **stale**",
  "",
  "Notes: Open with the cafe owner story.",
  "",
  "## Slide 3: Our Numbers",
  "",
  "| Month | Orders | Revenue |",
  "|---|---:|---:|",
  "| January | 120 | $4,800 |",
  "| February | 150 | $6,000 |",
  "",
  "## How It Works",
  "",
  "1. Order by 9pm",
  "2. We bake overnight",
  "3. Delivered by 7am",
  "",
  "**Notes:** Keep this slide short.",
  "Point at the van photo.",
  "",
  "## Why Now",
  "",
  "Cafe openings in Sacramento grew this year, and none of them bake their own bread.",
  "",
  "## The Ask",
  "",
  "- $50,000 for a second oven",
  "- One more van",
  "",
  "Notes: Pause, then ask for questions.",
].join("\n");

test("markdownSlides: a title slide, one slide per ## heading, nesting, a table and notes", () => {
  const s = office.markdownSlides(DECK);
  assert.equal(s.length, 6);
  assert.deepEqual(s.map((x) => x.kind), ["title", "content", "content", "content", "content", "content"]);
  assert.equal(s[0].title, "Bright Bakery Pitch");
  assert.deepEqual(s[0].subtitle, ["Fresh bread, delivered by 7am"]);
  assert.equal(s[2].title, "Our Numbers", "the Slide 3: prefix is dropped");
  assert.deepEqual(s[1].items.map((i) => i.level), [0, 1, 0]);
  assert.equal(s[1].notes, "Open with the cafe owner story.");
  assert.deepEqual(s[2].table[0], ["Month", "Orders", "Revenue"]);
  assert.deepEqual(s[3].items.map((i) => i.type), ["number", "number", "number"]);
  assert.equal(s[3].notes, "Keep this slide short.\nPoint at the van photo.");
  assert.equal(s[4].items[0].type, "text");
  // the intro line before the deck is not a slide; prose with no headings is no deck
  assert.ok(!JSON.stringify(s).includes("Here is your deck"));
  assert.deepEqual(office.markdownSlides("Sure, I can help with a deck about bread."), []);
  // a long slide continues on the next one
  const long = office.markdownSlides("## Menu\n\n" + Array.from({ length: 11 }, (_, i) => `- Item ${i + 1}`).join("\n"));
  assert.deepEqual(long.map((x) => x.title), ["Menu", "Menu (continued)"]);
  // a python-pptx script is not the deck
  assert.deepEqual(office.markdownSlides("```python\nfrom pptx import Presentation\nprs = Presentation()\nprs.save('pitch.pptx')\n```"), []);
});

test("pptxFromMarkdown builds a 16:9 deck with six slides, the slide text, a table and speaker notes", () => {
  const buf = office.pptxFromMarkdown(DECK, { title: "pitch" });
  assert.equal(buf.slice(0, 2).toString("latin1"), "PK");
  const names = unzipEntry(buf, null);
  for (let i = 1; i <= 6; i++) assert.ok(names.includes(`ppt/slides/slide${i}.xml`), `slide ${i}`);
  assert.ok(!names.includes("ppt/slides/slide7.xml"));
  assert.ok(names.includes("ppt/presentation.xml") && names.includes("ppt/notesSlides/notesSlide2.xml") && names.includes("ppt/notesMasters/notesMaster1.xml"));
  const pres = unzipEntry(buf, "ppt/presentation.xml");
  assert.match(pres, /<p:sldSz cx="12192000" cy="6858000"\/>/);
  assert.equal((pres.match(/<p:sldId /g) || []).length, 6);
  const s1 = unzipEntry(buf, "ppt/slides/slide1.xml");
  assert.match(s1, /type="ctrTitle"/);
  assert.match(s1, /sz="4000" b="1"[^>]*>.*Bright Bakery Pitch/);
  const s2 = unzipEntry(buf, "ppt/slides/slide2.xml");
  assert.match(s2, /Cafes run out of bread by noon/);
  assert.match(s2, /lvl="1"[^>]*>.*Two deliveries cost too much/);
  assert.match(s2, /sz="2400" b="1"[^>]*><a:solidFill><a:srgbClr val="1F2937"\/><\/a:solidFill><\/a:rPr><a:t>stale/);
  assert.match(s2, /sz="3600"/);
  const s3 = unzipEntry(buf, "ppt/slides/slide3.xml");
  assert.match(s3, /<a:tbl>/);
  assert.match(s3, /February/);
  assert.match(unzipEntry(buf, "ppt/slides/slide4.xml"), /buAutoNum type="arabicPeriod"/);
  assert.match(unzipEntry(buf, "ppt/notesSlides/notesSlide2.xml"), /Open with the cafe owner story\./);
  assert.match(unzipEntry(buf, "ppt/slides/_rels/slide2.xml.rels"), /notesSlide2\.xml/);
  assert.match(unzipEntry(buf, "[Content_Types].xml"), /presentationml\.presentation\.main\+xml/);
  assert.match(unzipEntry(buf, "ppt/slideMasters/slideMaster1.xml"), /<a:srgbClr val="FFFFFF"\/>/);
});

test("Python opens the deck: zipfile counts six slides, python-pptx reads titles, bullets, the table and notes", { skip: !python && "python is not installed" }, () => {
  const file = path.join(DATA, "pitch-direct.pptx");
  fs.writeFileSync(file, office.pptxFromMarkdown(DECK, { title: "pitch" }));
  const z = py(ZIP_CHECK, file);
  assert.equal(z.bad, null, "every entry passes its CRC check");
  assert.equal(z.slides, 6);
  assert.ok(z.names.includes("ppt/presentation.xml"));
  if (!hasPythonPptx) return;
  const r = py([
    "import sys,json",
    "from pptx import Presentation",
    "p=Presentation(sys.argv[1])",
    "out={'w': p.slide_width, 'h': p.slide_height, 'slides': []}",
    "for s in p.slides:",
    "  d={'layout': s.slide_layout.name, 'title': s.shapes.title.text if s.shapes.title is not None else None, 'text': [], 'table': None, 'notes': s.notes_slide.notes_text_frame.text if s.has_notes_slide else ''}",
    "  for sh in s.shapes:",
    "    if sh.has_text_frame and sh.text_frame.text: d['text'].append(sh.text_frame.text)",
    "    if sh.has_table: d['table']=[[c.text for c in row.cells] for row in sh.table.rows]",
    "  out['slides'].append(d)",
    "print(json.dumps(out))",
  ].join("\n"), file);
  assert.equal(r.w, 12192000);
  assert.equal(r.h, 6858000);
  assert.equal(r.slides.length, 6);
  assert.deepEqual(r.slides.map((s) => s.title), ["Bright Bakery Pitch", "The Problem", "Our Numbers", "How It Works", "Why Now", "The Ask"]);
  assert.equal(r.slides[0].layout, "Title Slide");
  assert.ok(r.slides[0].text.includes("Fresh bread, delivered by 7am"));
  assert.ok(r.slides[1].text.includes("Cafes run out of bread by noon\nTwo deliveries cost too much\nSupermarket bread is stale"), JSON.stringify(r.slides[1].text));
  assert.deepEqual(r.slides[2].table, [["Month", "Orders", "Revenue"], ["January", "120", "$4,800"], ["February", "150", "$6,000"]]);
  assert.equal(r.slides[1].notes, "Open with the cafe owner story.");
  assert.equal(r.slides[3].notes, "Keep this slide short.\nPoint at the van photo.");
  assert.equal(r.slides[5].notes, "Pause, then ask for questions.");
  assert.equal(r.slides[4].notes, "");
});

test("pitch.pptx in a full Windows path is a named file, and the prompt asks for markdown slides, not code", () => {
  const goal = "Make a 6-slide pitch deck for my bakery. Save it as C:\\Users\\pat\\Desktop\\x\\pitch.pptx";
  assert.deepEqual(guard.namedFiles(goal), ["pitch.pptx"]);
  assert.equal(guard.isSavableName("pitch.pptx", { office: true }), true);
  assert.equal(guard.isSavableName("pitch.pptx"), false);
  assert.equal(named.wantedFile(goal), "pitch.pptx");
  const note = named.officeNote(goal);
  assert.match(note, /one "## " heading per slide/);
  assert.match(note, /short bullets/);
  assert.match(note, /"Notes:"/);
  assert.match(note, /Do not write code to build the file/);
  assert.ok(!/\u2014/.test(note + named.NO_SLIDES_LINE), "no em-dashes in user-facing text");
});

test("saveNamedFile builds pitch.pptx from a fake answer and writes real bytes; no slides is a plain Not saved line", { skip: !python && "python is not installed" }, () => {
  const goal = "Make a 6-slide pitch deck for my bakery. Save it as C:\\Users\\pat\\Desktop\\x\\pitch.pptx";
  const answer = "```markdown\n" + DECK + "\n```\n\nLet me know if you want changes.";
  const r = named.saveNamedFile({ goal, text: answer, projectId: "p-pptx" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, "pitch.pptx");
  assert.equal(r.readable, false);
  assert.equal(fs.statSync(r.path).size, r.bytes);
  assert.equal(named.readSavedFile(r), "", "a binary file has no preview text");
  const z = py(ZIP_CHECK, r.path);
  assert.equal(z.bad, null);
  assert.equal(z.slides, 6);
  assert.ok(!/Let me know/.test(unzipEntry(fs.readFileSync(r.path), "ppt/slides/slide6.xml")), "the closing line to the person is not on a slide");
  // never overwrite: a second save is pitch-2.pptx
  const again = named.saveNamedFile({ goal, text: DECK, projectId: "p-pptx" });
  assert.equal(again.name, "pitch-2.pptx");
  // nothing usable, or only a script that would build the deck
  const none = named.saveNamedFile({ goal, text: "Sure! A bakery pitch should be short and friendly.", projectId: "p-pptx" });
  assert.deepEqual({ ok: none.ok, error: none.error }, { ok: false, error: "Not saved: there were no slides to put in the deck." });
  const script = named.saveNamedFile({ goal, text: "```python\nfrom pptx import Presentation\nprs = Presentation()\nprs.save('pitch.pptx')\n```", projectId: "p-pptx" });
  assert.equal(script.ok, false);
  assert.equal(script.error, named.NO_SLIDES_LINE);
});

test("saveEveryNamedFile takes the deck from the final answer, like a Word file", () => {
  const goal = "Make a pitch deck and save it as pitch.pptx";
  const out = saveEveryNamedFile({ goal, names: guard.namedFiles(goal), deliverable: DECK, tasks: [{ id: "t1", status: "done", output: "| a | b |\n|---|---|\n| 1 | 2 |" }], projectId: "p-pptx-all", missionId: "m1", office: true });
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, true, JSON.stringify(out[0]));
  const names = unzipEntry(fs.readFileSync(out[0].path), null);
  assert.equal(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, 6);
  const cut = saveEveryNamedFile({ goal, names: ["pitch.pptx"], deliverable: DECK, tasks: [], projectId: "p-pptx-all", truncated: "The AI hit its output limit and stopped mid-answer.", office: true });
  assert.equal(cut[0].ok, false);
  assert.match(cut[0].error, /was cut off/);
});
