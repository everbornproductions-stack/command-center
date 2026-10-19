// Phase 3: project memory and brand voice (R5). Pure checks on server/project-memory.js (sections sorted
// from an HQ brief, the memory block added once, past winners), then the running server in a temp data dir
// with demo AIs only (local mock, no real key or URL): memory saves per project, the server adds it to a
// single chat, a council and a pipeline mission (the pretend AI says when it arrived), the HQ importer fills
// empty sections and keeps the person's edits, and a thumbs-up can be kept as a past winner.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-memory-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const PM = await import("../server/project-memory.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BRIEF = `# Test Bakery

Family bakery in Sacramento, open since 2019.

## Brand voice and tone
Warm, plain words, no hype.

## Offers
Free tasting box with the first order.

## Never say
No "best in the world". No invented prices.

## What worked
The flour-dust reel did well.

## Contacts
Owner handles approvals.
`;

test("an HQ brief is sorted into the memory sections by its headings", () => {
  const s = PM.sortSections(BRIEF);
  assert.match(s.voice, /Warm, plain words/);
  assert.match(s.offers, /tasting box/);
  assert.match(s.never, /best in the world/);
  assert.match(s.winners, /flour-dust reel/);
  assert.match(s.facts, /Family bakery/);
  assert.match(s.facts, /Owner handles approvals/, "unknown headings are facts");
  assert.doesNotMatch(s.facts, /tasting box/);
  assert.equal(PM.sortSections("").voice, "");
});

test("the memory block is added once, and only for a project that has memory", () => {
  const pid = "my-project";
  assert.equal(PM.contextFor(pid), "");
  assert.equal(PM.withMemory("hello", pid), "hello", "no memory, no change");
  PM.saveMemory(pid, { voice: "Short and direct.", never: "No hype.", bogus: "ignored" });
  const block = PM.contextFor(pid);
  assert.ok(block.startsWith(PM.MARKER + "My project"));
  assert.match(block, /BRAND VOICE:\nShort and direct\./);
  assert.match(block, /NEVER SAY \/ NEVER DO:\nNo hype\./);
  assert.doesNotMatch(block, /ignored/);
  const once = PM.withMemory("hello", pid);
  assert.equal(once, `hello\n\n${block}`);
  assert.equal(PM.withMemory(once, pid), once, "a prompt that already carries it is not given a second copy");
  assert.equal(PM.withMemory("", pid), block);
  assert.equal(PM.withMemory("hello", null), "hello");
  assert.equal(PM.contextFor("no-such-project"), "");
});

test("past winners: one dated line each, newest first, no repeats, within the limit", () => {
  const pid = "my-project";
  PM.saveMemory(pid, { winners: "" });
  PM.addWinner(pid, "  The rain reel\n by Nova  ");
  PM.addWinner(pid, "Carousel of three before and after");
  PM.addWinner(pid, "The rain reel by Nova");
  const lines = PM.memoryOf(pid).winners.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- \d{4}-\d{2}-\d{2}: Carousel of three/);
  assert.match(lines[1], /The rain reel by Nova$/);
  for (let i = 0; i < 40; i++) PM.addWinner(pid, `winner ${i} ${"x".repeat(150)}`);
  assert.ok(PM.memoryOf(pid).winners.length <= PM.MAX_FIELD);
  assert.equal(PM.addWinner(pid, "   "), null);
});

test("HQ file paths: only a plain slug, and the company brief only for the everborn project", () => {
  assert.deepEqual(PM.hqFilesFor("/hq", { id: "../../etc" }), []);
  assert.deepEqual(PM.hqFilesFor("/hq", { id: "x", hqClient: "a/b" }), []);
  assert.deepEqual(PM.hqFilesFor("/hq", { id: "bakery" }).map((f) => path.basename(f)), ["bakery.md"]);
  assert.deepEqual(PM.hqFilesFor("/hq", { id: "everborn" }).map((f) => path.basename(f)), ["everborn.md", "everborn.md"]);
  assert.deepEqual(PM.hqFilesFor(null, { id: "bakery" }), []);
});

test("project memory on the server: saved per project, added to chats, councils and pipeline missions, HQ import, past winners", { timeout: 300000 }, async () => {
  const hq = tmpDir("cc-memory-hq-");
  fs.mkdirSync(path.join(hq, "company", "clients"), { recursive: true });
  fs.writeFileSync(path.join(hq, "company", "clients", "test-bakery.md"), BRIEF);
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_HQ_DIR: hq } });
  try {
    assert.equal((await s.api("/memory/project/test-bakery", { noToken: true })).status, 401);
    await s.api("/demo", { method: "POST", body: { on: true } });
    const proj = await s.api("/projects", { method: "POST", body: { name: "Test Bakery" } });
    assert.equal(proj.status, 200, proj.text);
    const pid = proj.json.id;
    assert.equal(pid, "test-bakery");
    assert.equal((await s.api("/memory/project/nope", { method: "POST", body: { voice: "x" } })).status, 404);

    // HQ import fills the empty sections from the client file
    const imp = await s.api("/memory/import-hq", { method: "POST", body: { projectId: pid } });
    assert.equal(imp.status, 200, imp.text);
    assert.deepEqual(imp.json.importedFrom, ["test-bakery.md"]);
    assert.deepEqual(imp.json.filled.sort(), ["facts", "never", "offers", "voice", "winners"]);
    assert.equal(imp.json.importedText, undefined, "the import bookkeeping is not sent to the page");
    // the person edits the voice; a second import keeps the edit and refreshes the rest
    await s.api(`/memory/project/${pid}`, { method: "POST", body: { voice: "Cheeky, short sentences." } });
    fs.writeFileSync(path.join(hq, "company", "clients", "test-bakery.md"), BRIEF.replace("Free tasting box", "Half-price tasting box"));
    const again = (await s.api("/memory/import-hq", { method: "POST", body: { projectId: pid } })).json;
    assert.deepEqual(again.kept, ["voice"]);
    assert.match(again.offers, /Half-price tasting box/, "an untouched imported section is refreshed");
    const mem = (await s.api(`/memory/project/${pid}`)).json;
    assert.equal(mem.voice, "Cheeky, short sentences.");
    assert.equal((await s.api("/memory/import-hq", { method: "POST", body: { projectId: "my-project" } })).status, 404, "no HQ file for that project");
    assert.deepEqual(Object.keys((await s.api("/memory/summary")).json), [pid]);
    const ctxText = (await s.api(`/memory/context?projectId=${pid}`)).json.context;
    assert.match(ctxText, /^PROJECT MEMORY for Test Bakery/);

    const waitFor = async (pred) => { for (let i = 0; i < 600; i++) { const m = (await s.api("/missions")).json.find(pred); if (m && ["done", "done-with-errors", "failed", "aborted"].includes(m.status)) return m; await sleep(250); } return null; };

    // a single chat for the project: the server adds the memory, the client does not have to
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline.", provider: "demo-nova", model: "nova-lite", projectId: pid } })).status, 202);
    const chat = await waitFor((x) => x.kind === "single" && x.projectId === pid);
    assert.ok(chat, "the chat finished");
    const chatFull = (await s.api(`/missions/${chat.id}`)).json;
    assert.equal(chatFull.memory, true);
    assert.match(chatFull.deliverable, /Following the project memory for \*\*Test Bakery\*\*/);
    assert.equal(chatFull.prompt, "Write a two-line tagline.", "the stored prompt is what the person typed");
    // a chat with no project gets no memory
    await s.api("/chat", { method: "POST", body: { prompt: "Name a colour.", provider: "demo-nova", model: "nova-lite" } });
    const plain = await waitFor((x) => x.kind === "single" && !x.projectId);
    assert.doesNotMatch((await s.api(`/missions/${plain.id}`)).json.deliverable, /project memory/);

    // a council: the chair's verdict follows it too
    assert.equal((await s.api("/council", { method: "POST", body: { prompt: "Pick a name for the spring menu.", projectId: pid, qa: false, lite: true } })).status, 202);
    const council = await waitFor((x) => x.kind === "council" && x.projectId === pid);
    assert.ok(council && council.status === "done", "the council finished");
    const cFull = (await s.api(`/missions/${council.id}`)).json;
    assert.equal(cFull.memory, true);
    assert.match(cFull.verdict.text, /Following the project memory for \*\*Test Bakery\*\*/);
    assert.ok(Object.values(cFull.answers).every((a) => !a.text || /Following the project memory/.test(a.text)), "every member saw it");

    // a pipeline mission (no memory sent by the client): every step and the assembled deliverable get it
    const run = await s.api("/pipelines/run", { method: "POST", body: { id: "client-proposal", values: { client: "Test Bakery", need: "a website" }, projectId: pid } });
    assert.equal(run.status, 202, run.text);
    const mission = await waitFor((x) => x.kind === "mission" && x.projectId === pid);
    assert.ok(mission && ["done", "done-with-errors"].includes(mission.status), "the pipeline mission finished");
    const mFull = (await s.api(`/missions/${mission.id}`)).json;
    assert.equal(mFull.memory, true);
    assert.match(mFull.deliverable, /Following the project memory for \*\*Test Bakery\*\*/);

    // keep a rated result as a past winner
    assert.equal((await s.api("/memory/winner", { method: "POST", body: { projectId: pid, text: "" } })).status, 400);
    assert.equal((await s.api("/memory/winner", { method: "POST", body: { projectId: "nope", text: "x" } })).status, 404);
    const w = (await s.api("/memory/winner", { method: "POST", body: { projectId: pid, text: '"Spring menu name" by Nova (demo)' } })).json;
    assert.match(w.winners.split("\n")[0], /Spring menu name/);
    assert.match(w.winners, /flour-dust reel/, "earlier winners are kept");
  } finally { await s.stop(); fs.rmSync(hq, { recursive: true, force: true }); }
});

test("browser code: the client no longer pastes memory into prompts; the editor reports what the import filled and kept", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.doesNotMatch(app, /\/memory\/context/, "Command sends the raw prompt; the server adds memory");
  const mem = fs.readFileSync(path.join(ROOT, "web", "features", "memory.js"), "utf8");
  assert.match(mem, /r\.filled/); assert.match(mem, /r\.kept/);
  const rt = fs.readFileSync(path.join(ROOT, "web", "features", "ratings.js"), "utf8");
  assert.match(rt, /\/memory\/winner/);
  for (const f of [app, mem, rt]) assert.doesNotMatch(f, /—/, "no em-dashes in user-facing text");
});
