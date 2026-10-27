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

// ---- items 3 and 4: removed APIs, AI-written save lines, the disk check ----
test("step-guard flags .textsize( with a plain note, and the code-writing instructions forbid it", () => {
  assert.equal(G.removedApiNotes("w, h = draw.textsize(text, font=font)").length, 1);
  assert.match(G.removedApiNotes("w, h = draw.textsize(text)")[0], /Pillow 10 removed.*textbbox/);
  assert.deepEqual(G.removedApiNotes("l, t, r, b = draw.textbbox((0, 0), text, font=font)"), []);
  assert.match(G.NO_REMOVED_APIS_LINE, /textsize/); assert.match(G.NO_REMOVED_APIS_LINE, /textbbox/);
  assert.doesNotMatch(G.NO_REMOVED_APIS_LINE, /—|–/);
});

test("lines an AI wrote about saving a file are stripped; the app's own lines stay", () => {
  const text = "Here is the card.\nFile saved: scratch-13/quote-card.png\n**Saved as** quote-card.png\nI saved the file to disk at C:/x/quote-card.png\nFile has been saved.\nSaved to MindMedia\nThe design is navy and gold.\nWrote cronwords.js (120 bytes)";
  const out = G.stripSaveClaims(text);
  assert.doesNotMatch(out, /File saved|Saved as|saved the file|has been saved|Saved to MindMedia/i);
  assert.match(out, /Here is the card\./); assert.match(out, /navy and gold/);
  assert.match(out, /Wrote cronwords\.js \(120 bytes\)/);
});

test("diskCheck: a file the app wrote reads 'exists, N bytes'; one that is not on disk reads 'missing'", () => {
  const f = path.join(DIR, "page.html"); fs.writeFileSync(f, "<html></html>");
  const ok = G.diskCheck(["page.html"], [{ name: "page.html", path: f }]);
  assert.deepEqual(ok.lines, ["page.html: exists, 13 bytes"]); assert.equal(ok.ok, true);
  const gone = G.diskCheck(["page.html", "style.css"], [{ name: "page.html", path: f }, { name: "style.css", path: path.join(DIR, "style.css") }]);
  assert.deepEqual(gone.missing, ["style.css"]); assert.equal(gone.lines[1], "style.css: missing");
  assert.equal(G.diskCheck(["a.js"], []).ok, false);
});

import http from "node:http";
import os from "node:os";
import { startServer, waitBudget } from "./helpers.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mocks(script) {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const title = (/TASK: (.*)/.exec(user) || [])[1] || "";
    seen.push({ sys, user, title });
    const out = script({ sys, user, title });
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}
// groq and mistral are text AIs only: no image maker is connected
async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "" } });
  for (const [pid, key] of [["groq", "gsk_fakefakefakefakefake"], ["mistral", "fakemistralkeyfakemistralkey0000"]]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key } })).json.status.status, "green", pid);
  await s.api("/fallback/settings", { method: "POST", body: { on: false } }).catch(() => {});
  return s;
}
async function runMission(s, body, ms = 90000) {
  const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
  const posted = await s.api("/mission", { method: "POST", body });
  assert.equal(posted.status, 202, posted.text);
  const t0 = Date.now();
  while (Date.now() - t0 < waitBudget(ms)) {
    const m = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${m.id}`)).json;
    await sleep(250);
  }
  throw new Error("mission did not finish\n" + s.log.slice(-600));
}

test("mission: no image key and a quote card: no Pillow step, no web search, the SVG is on disk, the PNG step says Not made", { timeout: 300000 }, async () => {
  const PLAN = JSON.stringify({ title: "Quote card", assembly: "Report the file.", tasks: [
    { id: "t1", title: "Render quote card PNG with Python Pillow", capability: "code", difficulty: 2, needWeb: true, deps: [], instructions: "Use Pillow to draw the card and save the PNG", deliverable: "quote-card.png" },
    { id: "t2", title: "Verify PNG matches the design spec", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t1"], instructions: "Check the PNG", deliverable: "A verdict" },
  ] });
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"creative","difficulty":2,"needWeb":true,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return PLAN;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    return "File saved: scratch-13/quote-card.png\nThe card is done.";
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: GOAL, mode: "economy", qa: true, budgetUsd: 2 });
    assert.equal(run.searched, false, "no web search for a drawing job");
    assert.ok(!m.seen.some((x) => /search results|SEARCH RESULTS/i.test(x.user)));
    assert.equal(run.tasks.length, 1, JSON.stringify(run.tasks.map((t) => t.title)));
    assert.doesNotMatch(JSON.stringify(run.tasks), /Pillow/);
    assert.match(run.planNote, /draws this flat graphic itself/);
    const t = run.tasks[0];
    assert.equal(t.media.local, true); assert.equal(t.status, "failed");
    assert.match(t.output, /^Not made: quote-card\.png\. Saved as SVG, PNG needs the desktop app\./);
    const svg = t.media.files.find((f) => /\.svg$/.test(f.name));
    assert.ok(svg && fs.existsSync(svg.path) && fs.statSync(svg.path).size === svg.bytes, "the SVG is on disk");
    assert.equal(run.savedFile.ok, false);
    assert.doesNotMatch(run.deliverable, /File saved/i);
    assert.notEqual(run.status, "done");
  } finally { await s.stop(); await m.close(); }
});

test("mission: no image key and a photo job: the plan says at planning time that it cannot be made, and what to add", { timeout: 300000 }, async () => {
  const PLAN = JSON.stringify({ title: "Kitchen photo", assembly: "Show it.", tasks: [
    { id: "t1", title: "Make the kitchen photo", capability: "media", difficulty: 2, needWeb: false, deps: [], instructions: "A realistic photo of a modern kitchen", deliverable: "The photo", media: { kind: "image", prompt: "a realistic photo of a modern kitchen" } },
  ] });
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"creative","difficulty":2,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return PLAN;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    return "ok";
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Make a realistic photo of a modern kitchen for my listing", mode: "economy", qa: true, budgetUsd: 2 });
    assert.match(run.planNote, /^I can't make this image/);
    assert.match(run.planNote, /Add your fal\.ai key/);
  } finally { await s.stop(); await m.close(); }
});

test("mission: a code step whose file is not on disk fails QA with the plain reason, and the AI reviewer sees the disk check", { timeout: 300000 }, async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "imgq-")));
  const PLAN = JSON.stringify({ title: "Make helper", assembly: "Report.", tasks: [
    { id: "t1", title: "Write helper.js", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: "Save as helper.js", deliverable: "helper.js" },
  ] });
  const m = await mocks(({ sys, user }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return PLAN;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    if (/You assemble/.test(sys)) return "Done.";
    return "File saved: helper.js\nThere is no code block here, only words.";
  });
  const s = await boot(m);
  try {
    const r = await s.api("/projects", { method: "POST", body: { name: "Helper", categories: [{ id: "files", name: "Files", links: [{ title: "Folder", url: dir }] }] } });
    const run = await runMission(s, { goal: "Write helper.js and save it in place", projectId: r.json.id, mode: "economy", qa: true, budgetUsd: 2 });
    const t = run.tasks.find((x) => x.id === "t1");
    assert.ok(!fs.existsSync(path.join(dir, "helper.js")));
    assert.equal(t.review.pass, false); assert.equal(t.qaFailed, true);
    assert.match(t.review.issues[0], /helper\.js was not found on disk/);
    assert.notEqual(run.status, "done");
    assert.doesNotMatch(run.deliverable, /File saved/i);
  } finally { await s.stop(); await m.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("mission: when the file is written the AI reviewer is shown 'exists, N bytes'", { timeout: 300000 }, async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "imgq-")));
  const CODE = "module.exports = function helper() { return 1; };\n";
  const PLAN = JSON.stringify({ title: "Make helper", assembly: "Report.", tasks: [
    { id: "t1", title: "Write helper.js", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: "Save as helper.js", deliverable: "helper.js" },
  ] });
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return PLAN;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    if (/You assemble/.test(sys)) return "Done.";
    return `**helper.js**\n\`\`\`js\n${CODE}\`\`\``;
  });
  const s = await boot(m);
  try {
    const r = await s.api("/projects", { method: "POST", body: { name: "Helper", categories: [{ id: "files", name: "Files", links: [{ title: "Folder", url: dir }] }] } });
    const run = await runMission(s, { goal: "Write helper.js and save it in place", projectId: r.json.id, mode: "economy", qa: true, budgetUsd: 2 });
    assert.equal(fs.readFileSync(path.join(dir, "helper.js"), "utf8"), CODE);
    const qa = m.seen.find((x) => /You QA another AI/.test(x.sys));
    assert.ok(qa, "a reviewer was asked");
    assert.match(qa.user, new RegExp(`helper\\.js: exists, ${Buffer.byteLength(CODE)} bytes`));
    assert.equal(run.tasks.find((x) => x.id === "t1").review.pass, true);
  } finally { await s.stop(); await m.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
