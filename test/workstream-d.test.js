// Workstream D: public share links, PDF and Word export, industry packs,
// text size / high contrast, and naming an imported chat. Demo AIs only.
// Temp data dirs. No real key, no Square, no hub.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT, waitBudget } from "./helpers.js";
import { docxText } from "../server/library-extract.js";

const DIR = tmpDir("cc-wsd-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;

const { checkPublicBase, reachOf, buildSnapshot } = await import("../server/plugins/share.js");
const { parseDocument, toPdf, toDocx, pdfPageCount, fileSlug, docxDocumentXml } = await import("../server/doc-export.js");
const { normalize, SIZES } = await import("../server/plugins/a11y.js");
const { referenceBlock, matchImported } = await import("../server/history-refs.js");
const { annotateOutput } = await import("../server/prompts/safety.js");
const { INDUSTRY_IDS } = await import("../server/prompts/industry.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXTURE = path.join(ROOT, "test", "fixtures", "history", "chatgpt", "conversations.json");
const FAKE_KEY = "sk-ant-abcdefghijklmnop1234";

test("public address: https origin only, loopback stays on this computer", () => {
  assert.equal(checkPublicBase("https://share.example.test/extra"), "https://share.example.test");
  assert.equal(checkPublicBase("  "), "");
  assert.equal(checkPublicBase("http://127.0.0.1:9/share"), "http://127.0.0.1:9");
  assert.throws(() => checkPublicBase("http://evil.example"), /https/);
  assert.throws(() => checkPublicBase("https://user:pass@share.example.test"), /password/);
  assert.equal(reachOf("https://share.example.test"), "public");
  assert.equal(reachOf("http://127.0.0.1:9"), "this-computer");
  assert.equal(reachOf(""), "this-computer");
});

test("public snapshot hides costs and key-shaped text", () => {
  const snap = buildSnapshot({
    id: "m1", kind: "single", title: "Plan", status: "done",
    deliverable: `spent $12 and ${FAKE_KEY}`, cost: 4, estimatedCost: 9,
  }, false);
  assert.equal(snap.deliverable.includes("$"), false);
  assert.match(snap.deliverable, /\[cost hidden\]/);
  assert.equal(snap.deliverable.includes(FAKE_KEY), false);
  assert.match(snap.deliverable, /\[hidden\]/);
  assert.equal(snap.cost, undefined);
  assert.equal(snap.estimatedCost, undefined);
});

test("PDF and Word keep headings, bold, and lists", () => {
  const markdown = "# Bakery plan\n\n**Crumb** is ready.\n\n- ovens\n\n1. mix\n\n```\nprint(1)\n```\n";
  const blocks = parseDocument(markdown);
  assert.ok(blocks.some((b) => b.type === "h1" && b.text === "Bakery plan"));
  assert.ok(blocks.some((b) => b.type === "li" && b.text === "ovens"));
  const pdf = toPdf({ title: "Bakery plan", markdown });
  const pdfText = pdf.toString("latin1");
  assert.match(pdfText, /^%PDF-1\.4/);
  assert.match(pdfText, /\(Bakery\) Tj \( \) Tj \(plan\)/);
  assert.match(pdfText, /\/F2 /);
  assert.match(pdfText, /\(Crumb\)/);
  assert.match(pdfText, /\(ovens\)/);
  assert.equal(pdfText.includes(FAKE_KEY), false);
  const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} stays on its own line with enough words to wrap.`).join("\n\n");
  assert.ok(pdfPageCount(toPdf({ title: "Long", markdown: long })) > 1);
  const docx = toDocx({ title: "Bakery plan", markdown: `# Bakery plan\n\n**Crumb** is ready.\n\n- ovens\n` });
  const xml = docxDocumentXml(docx);
  assert.match(xml, /Heading1/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /ListBullet/);
  const plain = docxText(docx);
  assert.match(plain, /Bakery plan/);
  assert.match(plain, /Crumb/);
  assert.match(plain, /ovens/);
  assert.equal(fileSlug("Bakery plan!"), "bakery-plan");
});

test("industry answers mark a promised result, and a named import is the only excerpt", () => {
  const estate = annotateOutput("This home is guaranteed to sell.", "facts", { industry: "real-estate" });
  assert.match(estate, /\[NO PROMISE\]/);
  const credit = annotateOutput("The item will be deleted.", "item", { industry: "credit-repair", scf: true });
  assert.match(credit, /\[CROA\]/);
  const creator = annotateOutput("This is guaranteed views.", "brief", { industry: "creator" });
  assert.match(creator, /\[NO PROMISE\]/);
  const chats = [
    { id: "a", title: "Tagline ideas for a bakery", source: "chatgpt", text: `Slow dough, fast smiles. ${FAKE_KEY} SSN 000-00-0000` },
    { id: "b", title: "Fix a Python loop", source: "chatgpt", text: "enumerate the items" },
    { id: "c", title: "Oven notes", source: "claude", text: "heat the deck" },
  ];
  const named = referenceBlock('Please use "Tagline ideas for a bakery"', chats);
  assert.match(named.block, /Slow dough/);
  assert.equal(named.block.includes("enumerate"), false);
  assert.equal(named.block.includes(FAKE_KEY), false);
  assert.match(named.block, /\[hidden\]/);
  assert.equal(named.block.includes("000-00-0000"), false);
  assert.match(named.block, /\[REDACTED\]/);
  assert.equal(named.used[0].title, "Tagline ideas for a bakery");
  assert.equal(referenceBlock("Oven notes please", chats).block, "");
  assert.match(referenceBlock('"Oven notes"', chats).block, /heat the deck/);
  const many = ["Alpha title one", "Beta title two", "Gamma title three", "Delta title four"].map((title, i) => ({
    id: "t" + i, title, source: "chatgpt", text: "body " + title,
  }));
  const quoted = many.map((c) => `"${c.title}"`).join(" ");
  assert.equal(matchImported(quoted, many).length, 3);
});

test("reading prefs reject a bad size and keep the previous one", () => {
  assert.deepEqual(SIZES, ["small", "default", "large", "xlarge"]);
  const next = normalize({ textSize: "large", contrast: true }, { textSize: "default", contrast: false });
  assert.equal(next.textSize, "large");
  assert.equal(next.contrast, true);
  assert.throws(() => normalize({ textSize: "huge" }), /text size/);
  assert.equal(normalize({ contrast: false }, next).textSize, "large");
});

test("workstream sources: no em dash, Mac CI runs tests, release is 0.4.16", () => {
  const files = [
    "server/feature-gate.js", "server/doc-export.js", "server/history-refs.js",
    "server/plugins/a11y.js", "server/plugins/export.js", "server/plugins/share.js",
    "server/prompts/industry.js", "web/features/a11y.js", "web/features/export.js",
    "web/features/share.js", "web/features/history.js", "docs/help/share-export.md",
    ".github/workflows/mac-ci.yml",
  ];
  for (const f of files) assert.equal(fs.readFileSync(path.join(ROOT, f), "utf8").includes("\u2014"), false, f);
  const a11y = fs.readFileSync(path.join(ROOT, "web/features/a11y.js"), "utf8");
  assert.match(a11y, /speechSynthesis/);
  assert.match(a11y, /Read aloud/);
  assert.match(a11y, /a11y-panel/);
  const mac = fs.readFileSync(path.join(ROOT, ".github/workflows/mac-ci.yml"), "utf8");
  assert.match(mac, /macos-latest/);
  assert.match(mac, /workflow_dispatch/);
  assert.doesNotMatch(mac, /pull_request/);
  assert.match(mac, /npm test/);
  assert.match(mac, /npm run smoke/);
  assert.equal(mac.includes("dist:mac"), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.4.21");
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/prompts.js"), "utf8"), /Industry packs are part of Pro/);
});

test("free tier: public link, export, and industry packs stay closed; live share stays open", async () => {
  const s = await startServer();
  try {
    const pub = await s.api("/share/public", { method: "POST", body: { missionId: "none" } });
    assert.equal(pub.status, 402);
    assert.equal(pub.json.code, "pro_required");
    const live = await s.api("/share/create", { method: "POST", body: { missionId: "still-free" } });
    assert.equal(live.status, 200);
    assert.match(live.json.url, /^\/share\.html\?t=/);
    const exp = await s.api("/export/pdf", { method: "POST", body: { title: "Note", markdown: "Hello" } });
    assert.equal(exp.status, 402);
    assert.equal(exp.json.code, "pro_required");
    const word = await s.api("/export/docx", { method: "POST", body: { title: "Note", markdown: "Hello" } });
    assert.equal(word.status, 402);
    const rendered = await s.api("/prompts/render", { method: "POST", body: { id: "re-listing-brief", inputs: { facts: "3 bedrooms" } } });
    assert.equal(rendered.status, 402);
    assert.equal(rendered.json.code, "pro_required");
    const list = await s.api("/prompts");
    const industry = list.json.templates.filter((t) => INDUSTRY_IDS.includes(t.id));
    assert.equal(industry.length, INDUSTRY_IDS.length);
    assert.ok(industry.every((t) => t.locked === true && t.shelf === "industry"));
    assert.equal(list.json.industryOpen, false);
    const detect = await s.api("/prompts/detect", { method: "POST", body: { text: "property listing description", llm: false } });
    assert.equal(INDUSTRY_IDS.includes(detect.json.match?.id), false);
    const prefs = await s.api("/a11y", { method: "POST", body: { textSize: "xlarge", contrast: true } });
    assert.equal(prefs.status, 200);
    assert.equal(prefs.json.textSize, "xlarge");
    assert.equal(prefs.json.contrast, true);
  } finally { await s.stop(); }
});

async function waitRun(s, runId) {
  const budget = waitBudget(60000);
  const t0 = Date.now();
  let m = null;
  while (Date.now() - t0 < budget) {
    const r = await s.api(`/missions/${runId}`);
    m = r.json;
    if (m && (m.status === "done" || m.status === "failed")) return m;
    await sleep(250);
  }
  return m;
}

test("owner: public link, export, industry pack, and a named imported chat", { timeout: 180000 }, async () => {
  const dir = tmpDir("cc-wsd-owner-");
  let s = await startServer({ dataDir: dir, env: { CC_DEV_OWNER: "1" } });
  let s2 = null;
  try {
    const bad = await s.api("/share/settings", { method: "POST", body: { publicBase: "http://evil.example" } });
    assert.equal(bad.status, 400);
    const secret = await s.api("/share/settings", { method: "POST", body: { publicBase: "https://user:pass@share.example.test" } });
    assert.equal(secret.status, 400);
    const local = await s.api("/share/settings", { method: "POST", body: { publicBase: "http://127.0.0.1:9/path" } });
    assert.equal(local.status, 200);
    assert.equal(local.json.reach, "this-computer");
    const saved = await s.api("/share/settings", { method: "POST", body: { publicBase: "https://share.example.test/extra" } });
    assert.equal(saved.json.publicBase, "https://share.example.test");
    assert.equal(saved.json.reach, "public");

    await s.api("/demo", { method: "POST", body: { on: true } });
    const chat = await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a bakery.", provider: "demo-nova", model: "nova-lite" } });
    assert.equal(chat.status, 202);
    const run = await waitRun(s, chat.json.runId);
    assert.equal(run?.status, "done");

    assert.equal((await s.api("/share/public", { method: "POST", body: {} })).status, 400);
    const link = await s.api("/share/public", { method: "POST", body: { missionId: run.id } });
    assert.equal(link.status, 200, link.text);
    assert.equal(link.json.reach, "public");
    assert.match(link.json.publicUrl, new RegExp(`^https://share\\.example\\.test/share\\.html\\?t=${link.json.token}$`));
    assert.match(link.json.note, /Nothing was posted/);
    const view = await s.api(`/share/t/${link.json.token}`, { noToken: true });
    assert.equal(view.status, 200);
    assert.equal(view.json.public, true);
    assert.equal(view.json.showCosts, false);
    assert.equal(view.json.mission.id, run.id);
    assert.ok(view.json.mission.deliverable);
    assert.equal(/"(cost|estCost|estimatedCost|budgetUsd)"/.test(view.text), false);

    const pdf = await s.api("/export/pdf", { method: "POST", body: { missionId: run.id } });
    assert.equal(pdf.status, 200, pdf.text);
    assert.match(pdf.json.filename, /\.pdf$/);
    const pdfBytes = Buffer.from(pdf.json.base64, "base64");
    assert.match(pdfBytes.toString("latin1"), /^%PDF-1\.4/);
    const docx = await s.api("/export/docx", { method: "POST", body: { title: "Bakery plan", markdown: `# Bakery plan\n\n**Crumb** is ready.\n\n- ovens\n\n${FAKE_KEY}` } });
    assert.equal(docx.status, 200, docx.text);
    const xml = docxDocumentXml(Buffer.from(docx.json.base64, "base64"));
    assert.match(xml, /Heading1/);
    assert.match(xml, /<w:b\/>/);
    assert.match(xml, /ListBullet/);
    assert.equal(xml.includes(FAKE_KEY), false);
    assert.match(xml, /\[hidden\]/);
    assert.equal((await s.api("/export/pdf", { method: "POST", body: { missionId: "missing-run" } })).status, 404);
    assert.equal((await s.api("/export/pdf", { method: "POST", body: { markdown: "   " } })).status, 400);

    const rendered = await s.api("/prompts/render", { method: "POST", body: { id: "cr-dispute-draft", inputs: { item: "a late mark", bureau: "one bureau" } } });
    assert.equal(rendered.status, 200, rendered.text);
    assert.equal(rendered.json.industry, "credit-repair");
    assert.match(rendered.json.prompt, /COMPLIANCE:/);
    assert.match(rendered.json.prompt, /CROA/);
    assert.match(rendered.json.prompt, /Do not promise results/);
    const detect = await s.api("/prompts/detect", { method: "POST", body: { text: "property listing description", llm: false } });
    assert.equal(detect.json.match.id, "re-listing-brief");
    assert.equal(detect.json.match.autoApply, true);

    const pv = await s.api("/history/preview", { method: "POST", body: { path: FIXTURE } });
    assert.equal(pv.status, 200, pv.text);
    const imp = await s.api("/history/import", { method: "POST", body: { token: pv.json.token, projectId: "" } });
    assert.equal(imp.status, 200, imp.text);
    assert.ok(imp.json.added >= 1);
    const named = await s.api("/chat", { method: "POST", body: { prompt: 'Use "Tagline ideas for a bakery" and write one line.', provider: "demo-nova", model: "nova-lite" } });
    const namedRun = await waitRun(s, named.json.runId);
    assert.equal(namedRun?.status, "done");
    assert.equal(namedRun.importedRefs?.[0]?.title, "Tagline ideas for a bakery");
    assert.equal(namedRun.importedRefs[0].source, "chatgpt");
    const plain = await s.api("/chat", { method: "POST", body: { prompt: "Write one line about bread.", provider: "demo-nova", model: "nova-lite" } });
    const plainRun = await waitRun(s, plain.json.runId);
    assert.equal(plainRun?.status, "done");
    assert.equal(plainRun.importedRefs, undefined);

    const missionFile = path.join(dir, "missions", `${run.id}.json`);
    fs.rmSync(missionFile, { force: true });
    s.child.kill();
    await new Promise((r) => { s.child.once("exit", r); setTimeout(r, 2000); });
    await s.stub.close();
    s = null;
    s2 = await startServer({ dataDir: dir, env: { CC_DEV_OWNER: "1" } });
    const again = await s2.api(`/share/t/${link.json.token}`, { noToken: true });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.public, true);
    assert.equal(again.json.mission.id, run.id);
    assert.ok(again.json.mission.deliverable);
    assert.equal((await s2.api(`/share/t/${link.json.token}`, { method: "DELETE" })).status, 200);
    assert.equal((await s2.api(`/share/t/${link.json.token}`, { noToken: true })).status, 404);
  } finally {
    if (s) await s.stop();
    if (s2) await s2.stop();
  }
});
