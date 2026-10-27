// 0.4.21 Q-image (dogfood 13 and 14): no image AI gives a local drawing route or an honest planning line, a file is
// only reported after a disk check, drawing and page jobs skip web search, .textsize( is flagged, and an AI-written
// "File saved" line is stripped. Fake keys only, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-imgq-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
for (const k of ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "REPLICATE_API_TOKEN", "FAL_KEY", "KLING_ACCESS_KEY", "RUNWAY_API_KEY", "ELEVENLABS_API_KEY"]) delete process.env[k];
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const L = await import("../server/local-draw.js");
const PF = await import("../server/media-preflight.js");

const GOAL = 'Make a 1080x1080 PNG Instagram quote card (dark navy, thin gold frame, white serif quote "Every home has a story. We film it.", small gold caps "EVERBORN PRODUCTIONS" at the bottom), save to scratch-13\\quote-card.png';
// a real 1x1 PNG, padded past the minimum size the checker accepts
const PNG = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")]);

test("the task's own words become the SVG: headline, footer, size, colors", () => {
  const made = L.svgForGoal(GOAL);
  assert.equal(made.w, 1080); assert.equal(made.h, 1080);
  assert.equal(made.svg.match(/<text [^>]*Georgia[^>]*>([^<]*)</g).map((x) => x.replace(/^.*>/, "").replace("<", "")).join(" "), "Every home has a story. We film it.");
  assert.match(made.svg, /EVERBORN PRODUCTIONS/);
  assert.match(made.svg, /#0b1f3a/); assert.match(made.svg, /#c9a227/);
  assert.equal(L.namedImage(GOAL), "scratch-13/quote-card.png");
  assert.equal(L.svgForGoal("make a picture of a dog"), null);
});

test("no image key: a quote card is drawn locally, a photo gets an honest I-can't line at planning time", () => {
  const flat = PF.mediaStatus("image", GOAL);
  assert.equal(flat.ok, true); assert.equal(flat.local, true);
  assert.match(flat.message, /draws this flat graphic itself/);
  assert.doesNotMatch(flat.message, /placeholder/);
  const pf = PF.preflight(GOAL);
  assert.equal(pf.blocked, false);
  const photo = PF.mediaStatus("image", "Make a realistic photo of a modern kitchen");
  assert.equal(photo.ok, false);
  assert.match(photo.message, /^I can't make this image/);
  assert.match(photo.message, /Add your fal\.ai key/);
  assert.doesNotMatch(photo.message, /—|–/);
  assert.equal(L.isFlatGraphic("a banner for the sale"), true);
  assert.equal(L.isFlatGraphic("a realistic photo banner"), false);
});

test("a plan that renders the card with Pillow becomes one local drawing step; the verify step is dropped", () => {
  const plan = { title: "Quote card", tasks: [
    { id: "t1", title: "Render quote card PNG with Python Pillow", capability: "code", deps: [], instructions: "Use Pillow ImageDraw to draw the card", deliverable: "quote-card.png" },
    { id: "t2", title: "Verify PNG matches the design spec", capability: "analysis", deps: ["t1"], instructions: "Check it", deliverable: "A verdict" },
  ] };
  const r = L.localizeImagePlan(plan, GOAL);
  assert.equal(r.changed, true);
  assert.equal(r.plan.tasks.length, 1);
  assert.equal(r.plan.tasks[0].capability, "media");
  assert.equal(r.plan.tasks[0].media.kind, "image");
  assert.doesNotMatch(JSON.stringify(r.plan), /Pillow/);
});

test("with a PNG renderer: the PNG is written, read back with stat, and reported with its real size", async () => {
  const proj = path.join(DIR, "proj-a");
  fs.mkdirSync(proj, { recursive: true });
  const png = Buffer.concat([PNG, Buffer.alloc(80)]); // past 67 bytes; the signature is real
  let seen = null;
  const r = await L.drawLocally({ goal: GOAL, projectId: "q-a", hooks: { render: async (svg, o) => { seen = { svg, o }; return png; } } });
  assert.equal(r.ok, true); assert.equal(r.pngMade, true);
  assert.equal(seen.o.width, 1080);
  assert.match(seen.svg, /Every home has/);
  const st = fs.statSync(r.png.path);
  assert.equal(st.size, png.length);
  assert.equal(r.png.bytes, st.size);
  assert.match(r.line, new RegExp(`Saved quote-card\\.png \\(${st.size} bytes\\)`));
  assert.match(r.disk, /exists, \d+ bytes/);
});

test("without the desktop app: the SVG is saved, the PNG is Not made, and the line says so", async () => {
  const r = await L.drawLocally({ goal: GOAL, projectId: "q-b" });
  assert.equal(r.ok, false); assert.equal(r.pngMade, false);
  assert.match(r.line, /^Not made: quote-card\.png\. Saved as SVG, PNG needs the desktop app\./);
  assert.ok(fs.existsSync(r.svg.path)); assert.equal(fs.statSync(r.svg.path).size, r.svg.bytes);
  assert.match(r.disk, /quote-card\.png: missing/);
  assert.ok(!fs.existsSync(r.svg.path.replace(/\.svg$/, ".png")));
});

test("a renderer that returns junk is not trusted: no PNG is claimed", async () => {
  const r = await L.drawLocally({ goal: GOAL, projectId: "q-c", hooks: { render: async () => Buffer.from("not a png at all, just words") } });
  assert.equal(r.ok, false); assert.match(r.line, /^Not made/);
  assert.equal(r.png, null);
});

test("diskLine: exists with bytes, or missing", () => {
  const f = path.join(DIR, "x.txt"); fs.writeFileSync(f, "hello");
  assert.equal(L.diskLine(f), "x.txt: exists, 5 bytes");
  assert.equal(L.diskLine(path.join(DIR, "nope.html")), "nope.html: missing");
});

// ---- item 2: no web search for drawing and page-build jobs ----
const G = await import("../server/step-guard.js");
test("a drawing job or a page build does not search unless the person asked", () => {
  assert.equal(G.wantsSearch(GOAL), false);
  assert.equal(G.wantsSearch("Build a one-page landing page for our latest listings, current prices and competitors, save as index.html"), false);
  assert.equal(G.wantsSearch("Make a poster for today's open house"), false);
  assert.equal(G.wantsSearch("Build a landing page for Meldmind. Search the web for the best layouts first."), true);
  assert.equal(G.wantsSearch("Design a banner, look up our competitors' colors"), true);
  // other jobs keep their old behavior
  assert.equal(G.wantsSearch("What is the latest news on mortgage rates?"), true);
  assert.equal(G.wantsSearch("Write a welcome email"), false);
  assert.equal(G.isDrawingOrPageJob("Create a website for my bakery"), true);
});
