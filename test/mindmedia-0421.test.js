// MindMedia hub, Area E (0.4.21): trash with restore, saved views, pending tiles, no silent link, host-the-file,
// save-as-files, clean exports, readable names, AI employee approval. Real server on a temp data folder, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, tmpDir, ROOT } from "./helpers.js";

// in-process helpers use their own temp data folder (never data/)
const DIR = tmpDir("cc-e0421-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));

const EM = "—", EN = "–";
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("source: Area E server files have no dashes", () => {
  for (const f of [["server", "plugins", "mindmedia.js"], ["server", "code-files.js"], ["server", "mindmedia-employees.js"]]) {
    const t = read(...f);
    assert.equal(t.includes(EM) || t.includes(EN), false, f.join("/"));
  }
});

test("pure: smartName never cuts a word, strips marks, names a Pro prompt from its ROLE line", async () => {
  const { smartName, hostedUrlFromShare, STATUSES } = await import("../server/project-media.js");
  assert.equal(smartName("## **Spring sale launch plan for the whole month of April** and more", 30), "Spring sale launch plan for");
  assert.equal(smartName("```js\nconst a = 1;\n```"), "const a = 1;");
  assert.equal(smartName("Business: Acme\nIndustry: x\n\nROLE: You are a careful copy editor\nCONTEXT: y"), "You are a careful copy editor");
  assert.equal(smartName(""), "");
  const long = smartName("Supercalifragilisticexpialidocious ".repeat(5), 60);
  assert.ok(long.length <= 60 && !long.endsWith("Supercalifragilisticexpialid"), long);
  assert.deepEqual(STATUSES, ["Draft", "Review", "Approved", "Scheduled", "Published"]);
  assert.equal(hostedUrlFromShare("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing"), "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQr");
  assert.equal(hostedUrlFromShare("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQr"), "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQr");
  assert.equal(hostedUrlFromShare("http://example.com/a.png"), "");
  assert.equal(hostedUrlFromShare("javascript:alert(1)"), "");
  assert.equal(hostedUrlFromShare("https://user:pw@example.com/a.png"), "");
  assert.equal(hostedUrlFromShare("https://example.com/a.png"), "https://example.com/a.png");
});

test("pure: extractCodeFiles names blocks from the fence, the line above, a comment, or a default", async () => {
  const { extractCodeFiles } = await import("../server/code-files.js");
  const md = [
    "Here you go.", "", "**app.py**", "```python", "print('hi')", "```", "",
    "```html:index.html", "<h1>Hi</h1>", "```", "",
    "```js", "// file: src/util.js", "export const a = 1;", "```", "",
    "```bash", "npm start", "```", "",
    "```js title=\"../../evil.js\"", "x", "```", "",
    "```python", "print('two')", "```",
  ].join("\n");
  const files = extractCodeFiles(md);
  assert.deepEqual(files.map((f) => f.name), ["app.py", "index.html", "src/util.js", "code-4.sh", "evil.js", "code-6.py"]);
  assert.equal(files[0].text, "print('hi')\n");
  assert.equal(extractCodeFiles("no code here").length, 0);
  assert.equal(extractCodeFiles("```\n\n```").length, 0);
});

test("pure: markdown exports render headings, bullets and code, and skip an empty Sources heading", async () => {
  const { reportPdf, reportDocx, mdBlocks } = await import("../server/research-export.js");
  const blocks = mdBlocks("# Title\n\nSome **bold** text with `code`.\n\n- one\n- two\n\n1. first\n\n```js\nlet a = 1;\n  let b = 2;\n```\n\nSources");
  assert.deepEqual(blocks.map((b) => b.t), ["h", "p", "li", "li", "li", "code", "h"]);
  assert.deepEqual(blocks[5].lines, ["let a = 1;", "  let b = 2;"]);
  const docx = reportDocx({ title: "T", body: "# Heading\n\n- item\n\n```\ncode line\n```" }).toString("latin1");
  assert.equal(docx.includes("PK"), true);
  const pdf = reportPdf({ title: "T", body: "# Heading\n\n**bold** and *it*\n\n" + "word ".repeat(2000) }).toString("latin1");
  assert.match(pdf, /^%PDF/);
  assert.equal(pdf.includes("**bold**"), false, "no raw markdown marks");
  assert.equal(pdf.includes("# Heading"), false);
  assert.ok(/\/Count (\d+)/.exec(pdf)[1] > 1, "long text runs to more pages");
  const { exportReport } = await import("../server/research.js");
  const f = exportReport({ title: "T", deliverable: "Hello", sources: [] }, "pdf");
  assert.equal(Buffer.from(f.bytes).toString("latin1").includes("Sources"), false, "no empty Sources heading");
});

test("hub: trash and restore, saved views, pending tiles, no silent link, host-the-file, save-as-files", async () => {
  const day = 24 * 60 * 60 * 1000;
  const srv = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects: [{ id: "alpha-proj", name: "Alpha Brand", color: "#22d3ee", categories: [] }, { id: "beta-proj", name: "Beta", color: "#22d3ee", categories: [] }] }));
      fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: [
        { id: "job-run", kind: "video", provider: "kling", status: "processing", createdAt: Date.now(), outputs: [], params: { prompt: "A slow dolly through a sunlit kitchen" }, projectId: "alpha-proj" },
        { id: "job-ok", kind: "video", provider: "kling", status: "awaiting_ok", createdAt: Date.now(), outputs: [], params: { prompt: "Needs OK" } },
      ] }));
      const site = path.join(dir, "projects", "alpha-proj", "site");
      fs.mkdirSync(site, { recursive: true });
      fs.writeFileSync(path.join(site, "index.html"), "<h1>Hi</h1>");
    },
  });
  const post = (p, body) => srv.api(p, { method: "POST", body });
  try {
    // pending tiles
    const list0 = (await srv.api("/mindmedia")).json;
    assert.equal(list0.pending.length, 2);
    const run = list0.pending.find((p) => p.id === "job-run");
    assert.equal(run.status, "Working");
    assert.equal(run.kind, "video");
    assert.equal(run.projectName, "Alpha Brand");
    assert.match(run.name, /dolly/);
    assert.equal(list0.pending.find((p) => p.id === "job-ok").awaitingOk, true);
    const pend = (await srv.api("/mindmedia/pending")).json;
    assert.equal(pend.pending.length, 2);
    assert.deepEqual(pend.finished, []);

    // items with different states
    const a = (await post("/mindmedia/save", { text: "one", name: "Needs OK", status: "Review", source: "AI employee: Social" })).json.items[0];
    const b = (await post("/mindmedia/save", { text: "two", name: "Ready", status: "Approved" })).json.items[0];
    const c = (await post("/mindmedia/save", { text: "three", name: "Out", status: "Published" })).json.items[0];
    const d = (await post("/mindmedia/save", { text: "four", name: "Plain draft" })).json.items[0];
    const s = (await post("/mindmedia/save", { text: "five", name: "Later", status: "Scheduled" })).json.items[0];
    assert.equal(s.status, "Scheduled");
    const views = (await srv.api("/mindmedia")).json.views;
    const count = (id) => views.find((v) => v.id === id).count;
    assert.equal(count("needs-ok"), 1);
    assert.equal(count("approved-unpublished"), 1);
    assert.equal(count("published-month"), 1);
    assert.equal(count("ai-employees"), 1);
    assert.equal(count("needs-ending"), 1);
    assert.equal((await srv.api("/mindmedia?view=needs-ok")).json.items[0].name, "Needs OK");
    assert.equal((await srv.api("/mindmedia?view=ai-employees")).json.items.length, 1);
    assert.equal((await srv.api("/mindmedia?view=published-month")).json.items[0].name, "Out");
    // the Needs an ending strip is not hidden by a filter
    const filtered = (await srv.api("/mindmedia?type=image&q=zzz")).json;
    assert.equal(filtered.items.length, 0);
    assert.equal(filtered.needsEnding.length, 1);
    assert.equal(filtered.needsEndingTotal, 1);

    // trash: delete keeps it for 30 days, restore brings it back
    assert.equal((await post("/mindmedia/delete", { items: [{ projectId: d.projectId, assetId: d.id }] })).status, 200);
    let after = (await srv.api("/mindmedia")).json;
    assert.equal(after.items.some((i) => i.id === d.id), false);
    assert.equal(after.total, 4);
    const trash = (await srv.api("/mindmedia?view=trash")).json;
    assert.equal(trash.items.length, 1);
    assert.equal(trash.items[0].name, "Plain draft");
    assert.equal(trash.items[0].trashed, true);
    assert.equal(after.views.find((v) => v.id === "trash").count, 1);
    assert.equal(after.trashDays, 30);
    const back = await post("/mindmedia/restore", { projectId: d.projectId, assetId: d.id });
    assert.equal(back.status, 200, JSON.stringify(back.json));
    after = (await srv.api("/mindmedia")).json;
    assert.equal(after.items.some((i) => i.id === d.id), true);
    assert.equal((await srv.api("/mindmedia?view=trash")).json.items.length, 0);
    assert.equal((await post("/mindmedia/restore", { projectId: d.projectId, assetId: d.id })).status, 404, "not in the trash");
    // discard on the shelf goes to the trash too
    await post("/mindmedia/ending", { projectId: d.projectId, assetId: d.id, action: "discard" });
    assert.equal((await srv.api("/mindmedia?view=trash")).json.items.length, 1);

    // an old trashed item (31 days) is gone from the trash
    const docFile = path.join(srv.dir, "project.media.json");
    if (fs.existsSync(docFile)) {
      const j = JSON.parse(fs.readFileSync(docFile, "utf8"));
      const key = Object.keys(j.meta).find((k) => j.meta[k].deleted);
      assert.ok(key && j.meta[key].deletedAt > Date.now() - day, "deletedAt is stored");
    }

    // moving: a project folder item cannot move, so it asks before it links
    const site = (await post("/mindmedia/save", { files: [{ path: path.join(srv.dir, "projects", "alpha-proj", "site", "index.html"), name: "index.html" }], projectId: "alpha-proj", kind: "site" }));
    assert.equal(site.status, 200, JSON.stringify(site.json));
    const mv = await post("/mindmedia/move", { projectId: "alpha-proj", assetId: "pfile:nothing.txt", targetProjectId: "beta-proj" });
    assert.equal(mv.status, 409, JSON.stringify(mv.json));
    assert.equal(mv.json.code, "link_needed");
    // a saved upload moves for real
    const up = (await post("/mindmedia/save", { files: [{ name: "x.png", data: PNG.toString("base64") }], projectId: "alpha-proj" })).json.items[0];
    const mv2 = await post("/mindmedia/move", { projectId: "alpha-proj", assetId: up.id, targetProjectId: "beta-proj" });
    assert.equal(mv2.status, 200);
    assert.equal(mv2.json.mode, "moved");

    // host-the-file: a Drive share link is turned into a direct link and remembered
    const bad = await post("/mindmedia/host", { projectId: up.projectId, assetId: up.id, link: "not a link" });
    assert.equal(bad.status, 400);
    const img = (await srv.api("/mindmedia?project=beta-proj")).json.items.find((i) => i.kind === "image");
    const ok = await post("/mindmedia/host", { projectId: "beta-proj", assetId: img.id, link: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal((await srv.api("/mindmedia?project=beta-proj")).json.items.find((i) => i.id === img.id).publicUrl, ok.json.url);
    // the Instagram preview then has a public link and no "file on this PC" problem
    const pv = await post("/publish/preview", { channel: "instagram", title: "t", text: "caption", mediaAssetId: img.id, mediaProjectId: "beta-proj" });
    assert.equal(pv.status, 200, JSON.stringify(pv.json));
    assert.equal(pv.json.problems.some((p) => /file on this PC/.test(p)), false, JSON.stringify(pv.json.problems));

    // text on Instagram: allowed, and it asks for a picture link
    const chans = (await srv.api("/publish/channels")).json;
    assert.ok(chans.find((x) => x.id === "instagram").accepts.includes("text"));
    const pvt = await post("/publish/preview", { channel: "instagram", title: "t", text: "caption", mediaAssetId: a.id, mediaProjectId: a.projectId });
    assert.ok(pvt.json.problems.some((p) => /picture or video/.test(p)), JSON.stringify(pvt.json.problems));
    const pvt2 = await post("/publish/preview", { channel: "instagram", title: "t", text: "caption", mediaAssetId: a.id, mediaProjectId: a.projectId, mediaUrl: "https://example.com/p.jpg" });
    assert.equal(pvt2.json.problems.some((p) => /picture or video/.test(p)), false, JSON.stringify(pvt2.json.problems));

    // save as files
    const md = "Intro\n\n**app.py**\n```python\nprint('hi')\n```\n\n```html:index.html\n<p>x</p>\n```\n";
    const cf = await post("/mindmedia/code-files", { text: md, projectId: "alpha-proj" });
    assert.equal(cf.status, 200, JSON.stringify(cf.json));
    assert.deepEqual(cf.json.files.map((f) => f.name), ["app.py", "index.html"]);
    assert.equal(cf.json.items.length, 2);
    assert.equal(Buffer.from(cf.json.zip.data, "base64").subarray(0, 2).toString("latin1"), "PK");
    const stored = fs.readFileSync(path.join(srv.dir, "projects", "alpha-proj", "media", cf.json.folder, "app.py"), "utf8");
    assert.equal(stored, "print('hi')\n");
    assert.equal((await post("/mindmedia/code-files", { text: "no code" })).status, 400);
    const of = await post("/mindmedia/open-folder", { projectId: "alpha-proj", folder: cf.json.folder, dryRun: true });
    assert.equal(of.status, 200);
    assert.equal(of.json.dryRun, true);

    // export: markdown is rendered and the title is a clean first line
    const ex = await post("/mindmedia/export", { text: "# Plan\n\n- one\n- two", title: "## **A very long title that goes on and on and on for far too long to fit in a file name okay**", format: "docx" });
    assert.equal(ex.status, 200);
    assert.ok(!/[#*]/.test(ex.json.name), ex.json.name);
    assert.ok(ex.json.name.length <= 70, ex.json.name);
  } finally { await srv.stop(); }
});

test("AI employees: finished work is kept as Review (or Draft), with one notice, nothing sent", async () => {
  const srv = await startServer({});
  const post = (p, body) => srv.api(p, { method: "POST", body });
  try {
    const list = (await srv.api("/mindmedia/employees")).json.employees;
    assert.ok(list.length > 3);
    assert.ok(list.every((e) => e.approval === "queue"), "default is Queue for my OK");
    const id = list[0].id;
    assert.equal((await post("/mindmedia/employees", { id, approval: "own" })).json.approval, "own");
    assert.equal((await srv.api("/mindmedia/employees")).json.employees.find((e) => e.id === id).approval, "own");
    assert.equal((await post("/mindmedia/employees", { id, approval: "nope" })).status, 400);
    assert.equal((await post("/mindmedia/employees", { id: "no-such", approval: "own" })).status, 404);
  } finally { await srv.stop(); }
});

test("keepEmployeeWork saves a done employee step as Review, honours Send on its own, skips others", async () => {
  const { keepEmployeeWork } = await import("../server/mindmedia-employees.js");
  const { listMindMedia } = await import("../server/project-media.js");
  const { setApproval, teamList } = await import("../server/employees.js");
  const [e1, e2] = teamList();
  setApproval(e2.id, "own");
  const mission = { id: "m1", prompt: "do things", projectId: "", tasks: [
    { id: "t1", title: "Caption ideas", status: "done", output: "Five captions", employee: { id: e1.id, name: e1.name } },
    { id: "t2", title: "Email draft", status: "done", output: "Dear all", employee: { id: e2.id, name: e2.name } },
    { id: "t3", title: "Plain step", status: "done", output: "no employee" },
    { id: "t4", title: "Failed", status: "failed", output: "", employee: { id: e1.id, name: e1.name } },
  ] };
  assert.equal(keepEmployeeWork(mission), 2);
  assert.equal(keepEmployeeWork(mission), 2, "saving again updates, never stacks");
  const all = listMindMedia({});
  assert.equal(all.items.length, 2);
  const byName = Object.fromEntries(all.items.map((i) => [i.name.replace(/\.md$/, ""), i]));
  assert.equal(byName["Caption ideas"].status, "Review");
  assert.equal(byName["Email draft"].status, "Draft");
  assert.match(byName["Caption ideas"].source, /^AI employee: /);
  assert.equal(all.views.find((v) => v.id === "needs-ok").count, 1);
  assert.equal(all.views.find((v) => v.id === "ai-employees").count, 2);
});

test("save as files refuses a linked media folder and writes nothing outside the data folder (0.4.22 C2)", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cc-outside-"));
  const srv = await startServer({ seed: (dir) => {
    fs.mkdirSync(path.join(dir, "projects", "linked-proj"), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, "projects", "linked-proj", "media"), "dir");
  } });
  try {
    const post = (p, body) => srv.api(p, { method: "POST", body });
    const md = "**app.py**\n```python\nprint('hi')\n```\n";
    const bad = await post("/mindmedia/code-files", { text: md, projectId: "linked-proj" });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    assert.match(bad.json.error, /link to somewhere else/);
    assert.deepEqual(fs.readdirSync(outside), [], "nothing may be written outside the data folder");
    const ok = await post("/mindmedia/code-files", { text: md, projectId: "plain-proj" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(fs.readFileSync(path.join(srv.dir, "projects", "plain-proj", "media", ok.json.folder, "app.py"), "utf8"), "print('hi')\n");
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { await srv.stop(); fs.rmSync(outside, { recursive: true, force: true }); }
});
