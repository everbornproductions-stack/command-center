// 0.4.21 dogfood 07: a real PDF for document tasks, a Download PDF that exports only the document, steps that say
// they could not do the job show as not done, and credit lights that stay honest after a 402/403/429.
// No network, no real accounts: PDFs are made by a stand-in renderer, Chrome on this machine if present, or the built-in writer.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, startServer } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-pdf-");
process.env.CC_STATUS_PAGES = "off";
const D = await import("../server/doc-pdf.js");
const { attachPdf, stepNotDone } = await import("../server/mission-pdf.js");
const card = await import("../web/pdf-card.js");

// what the dogfood 07 run handed back: chat lead-in, the copy, a "render" step that said it could not, a script, QA
const RUN = `Here is your one-pager:

## Write the copy
# Listing videos that sell the home and the agent

Short **video** tours help brokers and agents *win* listings.

## How it works
1. Send the address
2. We shoot the tour
3. You post it
4. Leads come in

## FAQ
**Does it cost extra?** Ask us for a quote.

## Render PDF layout
I can't run a renderer here, so save this as make_pdf.py and run this script on your computer:

\`\`\`python
import weasyprint
weasyprint.HTML("a.html").write_pdf("a.pdf")
\`\`\`

## QA
Score 2/10`;
const TASKS = [{ id: "t1", title: "Write the copy", status: "done", output: "# Listing videos\n\ncopy" }, { id: "t2", title: "Render PDF layout", status: "done", output: "I can't run a renderer here, so run this script:\n```python\nprint(1)\n```" }, { id: "t3", title: "QA", status: "done", output: "Score 2/10" }];

function fakePdf(pages) { return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n${Array.from({ length: pages }, () => "<< /Type /Page >>").join("\n")}\n%%EOF`); }

test("the task decides the file name, never a random one", () => {
  assert.equal(D.pdfFileName("Make a one-page PDF saved as everborn-onepager.pdf and .md"), "everborn-onepager.pdf");
  assert.equal(D.pdfFileName("Make a PDF about home videos", "Home videos for agents"), "home-videos-agents.pdf");
  assert.doesNotMatch(D.pdfFileName("anything at all", ""), /tmp|random/);
  assert.equal(D.wantsPdf("a one-page letter-size PDF for brokers"), true);
  assert.equal(D.wantsPdf("explain how pdf files work"), false);
  assert.equal(D.pageLimit("one-page PDF"), 1);
  assert.equal(D.pageLimit("a 2 page report"), 2);
  assert.equal(D.pageLimit("write a poem"), null);
});

test("only the requested document is kept: no script, no chat lead-in, no step headings, no QA", () => {
  const doc = D.extractDocument({ deliverable: RUN, tasks: TASKS, goal: "one-page PDF" });
  assert.match(doc.markdown, /^# Listing videos that sell the home/);
  assert.match(doc.markdown, /FAQ/);
  for (const bad of [/weasyprint/, /renderer/, /Here is your/, /Write the copy/, /Score 2\/10/, /make_pdf/]) assert.doesNotMatch(doc.markdown, bad);
  const withHtml = D.extractDocument({ deliverable: "Done.\n```html\n<html><body><h1>Hi</h1><script>alert(1)</script><p onclick=\"x()\">Body</p></body></html>\n```\nrun python make.py" });
  assert.equal(withHtml.from, "html");
  assert.doesNotMatch(withHtml.html, /<script|onclick/);
  assert.match(withHtml.markdown, /# Hi/);
});

test("markdown becomes real HTML: no raw # or ** reach the page", () => {
  const html = D.markdownToHtml("# Title\n\nSome **bold** and *soft* text.\n\n- a\n- b\n\n1. one\n2. two\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n<script>bad()</script>");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /(^|>)\s*#|\*\*/);
  assert.doesNotMatch(html, /<script>/);
});

test("a step that says it could not do the job is flagged, and ordinary steps are not", () => {
  assert.equal(stepNotDone(TASKS[1]), true);
  for (const said of ["I'm unable to render a PDF in this chat.", "You will need to run the script below on your computer.", "I cannot create files here."]) assert.equal(D.saysCouldNot(said), true, said);
  assert.equal(stepNotDone(TASKS[0]), false);
  assert.equal(stepNotDone({ status: "failed", output: "I can't run" }), false, "an already failed step stays failed, not double counted");
  assert.equal(D.saysCouldNot("Video tours help agents win listings."), false);
});

test("the built-in writer makes a real PDF and a one-page limit is checked", async () => {
  const keep = process.env.CC_PDF_ENGINE; process.env.CC_PDF_ENGINE = "builtin";
  try {
    const short = await D.renderDocumentPdf({ markdown: "# Hello\n\nA short **one**.", limit: 1 });
    assert.equal(short.engine, "builtin");
    assert.equal(short.buf.subarray(0, 4).toString(), "%PDF");
    assert.equal(short.pages, 1);
    assert.equal(short.fits, true);
    const long = await D.renderDocumentPdf({ markdown: Array.from({ length: 150 }, (_, i) => `Line ${i} words words words words`).join("\n\n"), limit: 1 });
    assert.ok(long.pages > 1);
    assert.equal(long.fits, false);
    assert.match(long.warning, /asked for one page/);
  } finally { if (keep === undefined) delete process.env.CC_PDF_ENGINE; else process.env.CC_PDF_ENGINE = keep; }
});

test("the app's own renderer is used first, and a one-pager is shrunk until it fits", async () => {
  const seen = [];
  D.hooks.electron = async (html) => { const z = Number(/zoom:([\d.]+)/.exec(html)?.[1] || 1); seen.push(z); return fakePdf(z > 0.8 ? 2 : 1); };
  try {
    const r = await D.renderDocumentPdf({ markdown: "# Doc\n\ntext", limit: 1 });
    assert.equal(r.engine, "electron");
    assert.equal(r.pages, 1);
    assert.equal(r.fits, true);
    assert.deepEqual(seen, [1, 0.92, 0.85, 0.78]);
    D.hooks.electron = async () => fakePdf(3);
    const big = await D.renderDocumentPdf({ markdown: "# Doc", limit: 1 });
    assert.equal(big.pages, 3);
    assert.equal(big.fits, false);
    assert.match(big.warning, /3 pages/);
  } finally { delete D.hooks.electron; }
});

const haveChrome = fs.existsSync("/usr/bin/google-chrome") || !!process.env.CC_PDF_CHROME;
test("Chrome on this computer makes a real one-page Letter PDF", { skip: !haveChrome && "no Chrome here" }, async () => {
  const r = await D.renderDocumentPdf({ markdown: "# Listing videos\n\nIntro **bold**.\n\n- one\n- two", limit: 1 });
  assert.ok(["chrome", "builtin"].includes(r.engine));
  assert.equal(r.buf.subarray(0, 4).toString(), "%PDF");
  assert.equal(r.pages, 1);
  if (r.engine === "chrome") assert.match(r.buf.toString("latin1"), /\/MediaBox\s*\[\s*0\s+0\s+612(?:\.0+)?\s+792/);
});

test("the .pdf and the .md are saved in the project folder, with the path said plainly", async () => {
  D.hooks.electron = async () => fakePdf(1);
  const dir = tmpDir("cc-pdf-proj-");
  const saved = [];
  const deps = { projectMediaDir: () => dir, saveToMindMedia: (o) => { saved.push(o); return { items: [{ id: "a1" }], where: "MindMedia" }; } };
  try {
    const goal = "Make a one-page letter-size PDF for brokers, saved as everborn-onepager.pdf and everborn-onepager.md";
    const r = await D.makeAndSavePdf({ goal, title: "Listing videos", deliverable: RUN, tasks: TASKS, projectId: "p1", missionId: "m1" }, deps);
    assert.equal(r.ok, true);
    assert.equal(r.pdf.name, "everborn-onepager.pdf");
    assert.equal(r.md.name, "everborn-onepager.md");
    assert.ok(fs.existsSync(path.join(dir, "everborn-onepager.pdf")));
    const md = fs.readFileSync(path.join(dir, "everborn-onepager.md"), "utf8");
    assert.match(md, /^# Listing videos that sell/);
    assert.doesNotMatch(md, /weasyprint/);
    assert.equal(saved[0].files.length, 2);
    assert.match(D.savedLine(r), /Saved everborn-onepager\.pdf \(1 page\) and everborn-onepager\.md in the project folder/);
    // a second run never overwrites the first
    const r2 = await D.makeAndSavePdf({ goal, title: "x", deliverable: RUN, tasks: TASKS, projectId: "p1", missionId: "m2" }, deps);
    assert.equal(r2.pdf.name, "everborn-onepager-2.pdf");
    // nothing to put in a PDF is said plainly, not faked
    const none = await D.makeAndSavePdf({ goal, deliverable: "```python\nprint(1)\n```", projectId: "p1" }, deps);
    assert.equal(none.ok, false);
    assert.match(none.error, /^Not saved/);
  } finally { delete D.hooks.electron; }
});

test("a mission that asked for a PDF gets one; one that did not is left alone", async () => {
  D.hooks.electron = async () => fakePdf(2);
  const dir = tmpDir("cc-pdf-proj2-");
  const deps = { projectMediaDir: () => dir, saveToMindMedia: () => ({ items: [{ id: "z" }] }) };
  try {
    const m = { id: "m9", title: "Listing videos", deliverable: RUN, tasks: TASKS, projectId: "p2" };
    const logs = [];
    const r = await attachPdf(m, { goal: "one-page PDF named everborn-onepager.pdf", log: (t, o) => logs.push([t, o]), deps });
    assert.equal(r.ok, true);
    assert.equal(m.savedPdf.pdf.pages, 2);
    assert.match(m.savedPdf.warning, /2 pages, but you asked for one page/);
    assert.equal(logs[0][1].level, "error", "a page-limit miss is logged as a problem");
    const plain = { id: "m10", deliverable: "just text", tasks: [] };
    assert.equal(await attachPdf(plain, { goal: "explain dogs", deps }), null);
    assert.equal(plain.savedPdf, undefined);
  } finally { delete D.hooks.electron; }
});

test("the PDF box says what was and was not saved", () => {
  const ok = card.pdfBoxHtml({ savedPdf: { ok: true, pdf: { name: "a.pdf", path: "/p/a.pdf", pages: 1 }, md: { name: "a.md" }, fits: true } });
  assert.match(ok, /Saved a\.pdf/);
  assert.match(ok, /1 page/);
  assert.match(ok, /data-pdf-open/);
  const over = card.pdfBoxHtml({ savedPdf: { ok: true, pdf: { name: "a.pdf", path: "/p/a.pdf", pages: 4 }, md: { name: "a.md" }, fits: false, warning: "This came out at 4 pages, but you asked for one page." } });
  assert.match(over, /Check the length/);
  const no = card.pdfBoxHtml({ savedPdf: { ok: false, error: "Not saved: there was no document text to put in a PDF." } });
  assert.match(no, /PDF not saved/);
  assert.doesNotMatch(no, /data-pdf-open/);
  assert.equal(card.pdfBoxHtml({}), "");
  const line = card.notDoneLine({ tasks: [{ title: "Render PDF layout", notDone: true }], savedPdf: { ok: true } });
  assert.match(line, /1 step did not do its job/);
  assert.match(line, /made the PDF itself/);
  for (const t of [ok, over, no, line]) assert.doesNotMatch(t, /—/);
});

test("credit lights stay honest after a real 402/403/429 (no green, no stale balance)", async () => {
  process.env.GROQ_API_KEY = "gsk_" + "x".repeat(24); // fake, never leaves this process
  const H = await import("../server/health.js");
  const { newContext, setDefaultContext } = await import("../server/store.js");
  setDefaultContext(newContext("pdf-lights", { putDoc() {} }));
  for (const status of [402, 403, 429]) {
    H.noteCall("groq", true, 10); // a working AI with a balance on record
    H.getStatus("groq").balance = { left: 50, unit: "USD" };
    H.noteCall("groq", false, 10, { status, body: { error: status === 429 ? "slow down" : "You have run out of credits" } });
    const s = H.getStatus("groq");
    assert.notEqual(s.status, "green", String(status));
    assert.equal(s.balance, null, "the old $ left is dropped");
    assert.equal(H.heldByRealFailure("groq"), true);
    assert.equal(H.isDeadNow("groq"), status !== 403 || s.status === "red" || /credits/i.test(s.detail));
    // a background models-list check cannot turn it green
    const after = await H.checkProvider("groq", { auto: true });
    assert.notEqual(after.status, "green", `${status} stays down after a background check`);
  }
  H.noteCall("groq", true, 10);
  assert.equal(H.getStatus("groq").status, "green", "a real call that works clears it");
  assert.equal(H.heldByRealFailure("groq"), false);
});

test("the receipt baseline and the 'now prefers' line never name an AI that is out of credit or never ran", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-" + "x".repeat(30); process.env.OPENAI_API_KEY = "sk-" + "y".repeat(30);
  const H = await import("../server/health.js");
  const R = await import("../server/receipt-math.js");
  const { newContext, setDefaultContext } = await import("../server/store.js");
  setDefaultContext(newContext("pdf-ref", { putDoc() {} }));
  const first = R.defaultReference();
  assert.ok(first);
  H.noteCall(first.provider, false, 5, { status: 402, body: { error: "You have no credits" } });
  const second = R.defaultReference();
  assert.notEqual(second.provider, first.provider, "saved vs an AI that is out of credit is not offered");
  assert.equal(H.isDeadNow(first.provider), true);
  assert.equal(H.isDeadNow(second.provider), false);
  const src = fs.readFileSync(new URL("../web/features/ratings.js", import.meta.url), "utf8");
  assert.match(src, /didRun/, "the preference line needs an AI that ran in this job");
  assert.match(src, /!t\.notDone/, "a step that said it could not do the job is not rated as good work");
  const desk = fs.readFileSync(new URL("../server/plugins/desk.js", import.meta.url), "utf8");
  assert.match(desk, /isDeadNow\(m\.provider\)/, "who will read this skips AIs that cannot run");
});

test("Download PDF exports the document under a real name and says where it saved; Open file works", { timeout: 120000 }, async () => {
  const dir = tmpDir("cc-pdf-srv-");
  const s = await startServer({ dataDir: dir, env: { CC_DEV_OWNER: "1" } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const chat = await s.api("/chat", { method: "POST", body: { prompt: "Make a one-page PDF named bakery-onepager.pdf about a bakery.", provider: "demo-nova", model: "nova-lite" } });
    assert.equal(chat.status, 202);
    let run = null;
    for (let i = 0; i < 120 && !(run && ["done", "done-with-errors", "failed"].includes(run.status)); i++) { run = (await s.api(`/missions/${chat.json.runId}`)).json; await new Promise((r) => setTimeout(r, 250)); }
    assert.ok(run?.deliverable);
    const pdf = await s.api("/export/pdf", { method: "POST", body: { missionId: run.id } });
    assert.equal(pdf.status, 200, pdf.text);
    assert.equal(pdf.json.filename, "bakery-onepager.pdf");
    assert.doesNotMatch(pdf.json.filename, /tmp/);
    assert.ok(fs.existsSync(pdf.json.savedAs), "saved in the project folder");
    assert.ok(fs.existsSync(pdf.json.mdPath));
    assert.ok(pdf.json.savedAs.startsWith(dir), "inside the data folder of this run");
    assert.equal(Buffer.from(pdf.json.base64, "base64").subarray(0, 4).toString(), "%PDF");
    assert.match(pdf.json.line, /Saved bakery-onepager\.pdf/);
    // make, find and open
    const made = await s.api("/docpdf/make", { method: "POST", body: { missionId: run.id } });
    assert.equal(made.status, 200, made.text);
    assert.equal(made.json.ok, true);
    const file = await s.api(`/docpdf/file?mission=${run.id}`);
    assert.equal(file.status, 200, file.text);
    assert.match(file.json.filename, /\.pdf$/);
    const open = await s.api("/docpdf/open", { method: "POST", body: { missionId: run.id, dryRun: true } });
    assert.equal(open.status, 200, open.text);
    assert.equal(open.json.dryRun, true);
    assert.equal((await s.api("/docpdf/make", { method: "POST", body: { missionId: "missing-run" } })).status, 404);
    assert.equal((await s.api("/docpdf/open", { method: "POST", body: { missionId: run.id, dryRun: true } })).json.ok, true);
  } finally { await s.stop(); }
});
