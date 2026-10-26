// 0.4.21 Memories: three buckets (About me, This project, Knowledge), auto-save with Undo, remember/forget by
// chat, recall into the prompt of every AI a job is split across, secrets refused, off switch, and the
// Settings > Memories screen. Practice AIs and a fake embedder only: no real key, account or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT, waitBudget, chatRunId } from "./helpers.js";
import { bootPage, findBrowser } from "./pw-helpers.js";

const DIR = tmpDir("cc-memories-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const M = await import("../server/memories.js");
const PM = await import("../server/project-memory.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const skip = findBrowser() ? false : "no Chrome installed";
const WAIT = waitBudget(20000);

test("unit: statements that last are detected, questions and passing remarks are not", () => {
  M.clearAll();
  const a = M.autoRemember("My business is Test Bakery in Sacramento. Write a tagline for it.");
  assert.equal(a.saved.length, 1);
  assert.equal(a.saved[0].bucket, "about-me");
  assert.match(a.saved[0].text, /Test Bakery/);
  assert.equal(M.autoRemember("What is my business called?").saved.length, 0, "a question saves nothing");
  assert.equal(M.autoRemember("I'm a bit tired, write a short email.").saved.length, 0, "a passing remark saves nothing");
  const p = M.autoRemember("I prefer short sentences. Always use metric units.", { projectId: "my-project" });
  assert.equal(p.saved.length, 2);
  assert.equal(p.saved.find((m) => /prefer/.test(m.text)).bucket, "about-me");
  assert.equal(p.saved.find((m) => /metric/.test(m.text)).bucket, "project");
  assert.equal(p.saved.find((m) => /metric/.test(m.text)).projectId, "my-project");
  const again = M.autoRemember("I prefer short sentences.");
  assert.equal(again.saved.length, 0);
  assert.equal(again.duplicate.length, 1, "the same fact is not saved twice");
  assert.equal(M.list().length, 3);
});

test("unit: remember that / forget that, with importance, bucket and project", () => {
  M.clearAll();
  const r = M.remember("remember that our refund window is 5 days", { projectId: "my-project" });
  assert.equal(r.ok, true);
  assert.equal(r.memory.text, "our refund window is 5 days");
  assert.equal(r.memory.bucket, "project");
  assert.equal(r.memory.importance, 4);
  assert.equal(M.remember("Remember that I like tea.").memory.bucket, "about-me");
  assert.equal(M.remember("remember that the sky is blue", {}).memory.bucket, "knowledge");
  const f = M.forget("forget that the refund window is 5 days");
  assert.equal(f.removed.length, 1);
  assert.equal(M.list().some((m) => /refund/.test(m.text)), false);
  assert.equal(M.forget("forget the moon landing").removed.length, 0);
  assert.equal(M.autoRemember("Forget that I like tea.").forgotten.length, 1, "forget by chat");
});

test("unit: passwords, keys, SSNs, cards and account numbers are refused", () => {
  M.clearAll();
  for (const bad of [
    "remember that my password is hunter2",
    "remember my API key sk-abc123abc123abc123abc123",
    "remember that my SSN is 123-45-6789",
    "remember my card 4242 4242 4242 4242",
    "remember my bank account number 12345678901",
    "remember token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  ]) {
    const r = M.autoRemember(bad);
    assert.equal(r.saved.length, 0, bad);
    assert.equal(r.refused, true, bad);
    assert.equal(r.message, "I will not remember passwords or account numbers.");
    const direct = M.remember(bad);
    assert.equal(direct.ok, false, bad);
    assert.equal(direct.refused, true, bad);
  }
  assert.equal(M.add({ text: "my password is x", bucket: "about-me" }).refused, true);
  assert.equal(M.list().length, 0);
  const ok = M.add({ text: "I love the number 4242 and my team of 12", bucket: "about-me" });
  assert.equal(ok.ok, true, "ordinary numbers are fine");
});

test("unit: recall ranks by bucket, project, keyword, importance; off disables recall and auto-save", () => {
  M.clearAll();
  M.setOn(true);
  M.add({ text: "I run a bakery called Test Bakery", bucket: "about-me", importance: 3 });
  M.add({ text: "Voice is warm and plain", bucket: "project", projectId: "my-project", importance: 3 });
  M.add({ text: "Other project secret sauce", bucket: "project", projectId: "other", importance: 5 });
  for (let i = 0; i < 12; i++) M.add({ text: `Filler fact number ${i} about gardening`, bucket: "knowledge", importance: 1 });
  M.add({ text: "Prices are in euros", bucket: "knowledge", importance: 2 });
  const r = M.recall({ query: "write a bakery post", projectId: "my-project", limit: 5 });
  assert.ok(r.some((m) => /Test Bakery/.test(m.text)), "keyword match");
  assert.ok(r.some((m) => /warm and plain/.test(m.text)), "this project's own memory");
  assert.equal(r.some((m) => /Other project/.test(m.text)), false, "another project's memory never leaks");
  assert.ok(r.length <= 5);
  const block = M.recallBlock("write a bakery post", "my-project");
  assert.ok(block.startsWith(M.MARKER));
  assert.match(block, /About the user:\n- I run a bakery/);
  // the block is added once
  const once = PM.withMemory("Write a post", "my-project");
  assert.equal(PM.withMemory(once, "my-project"), once);
  M.setOn(false);
  assert.deepEqual(M.recall({ query: "bakery", projectId: "my-project" }), []);
  assert.equal(M.recallBlock("bakery", "my-project"), "");
  assert.equal(PM.withMemory("Write a post", "my-project"), "Write a post");
  assert.equal(M.autoRemember("My business is Off Bakery.").saved.length, 0, "off: nothing is saved");
  assert.equal(M.remember("remember that x is y").ok, false);
  M.setOn(true);
});

test("unit: starred memories are kept first; edit and delete work; Clear all empties", () => {
  M.clearAll();
  const a = M.add({ text: "Keep me", bucket: "knowledge" }).memory;
  assert.equal(M.update(a.id, { starred: true }).memory.importance, 5);
  assert.equal(M.update(a.id, { starred: false }).memory.importance, 3);
  assert.equal(M.update(a.id, { text: "Edited text" }).memory.text, "Edited text");
  assert.equal(M.update(a.id, { text: "my password is abc" }).ok, false, "an edit cannot smuggle a secret in");
  assert.equal(M.update("nope", { text: "x" }).status, 404);
  assert.equal(M.remove(a.id), true);
  assert.equal(M.remove(a.id), false);
  M.add({ text: "one", bucket: "knowledge" }); M.add({ text: "two", bucket: "about-me" });
  assert.equal(M.clearAll(), 2);
  assert.equal(M.list().length, 0);
});

test("unit: Smarter recall needs a key, and ranks by a fake embedder when there is one", async () => {
  M.clearAll();
  M.setEmbedderHook({ available: () => false, embed: async () => { throw new Error("no network in tests"); } });
  let st = await M.smarterState();
  assert.equal(st.available, false);
  assert.equal(st.note, "Needs a key");
  assert.equal((await M.setSmarter(true)).ok, false);
  let calls = 0;
  M.setEmbedderHook({ available: () => true, embed: async (texts) => { calls++; return texts.map((t) => (/cat|feline/.test(t) ? [1, 0] : [0, 1])); } });
  assert.equal((await M.setSmarter(true)).ok, true);
  for (let i = 0; i < 10; i++) M.add({ text: `Unrelated note ${i} about taxes`, bucket: "knowledge", importance: 2 });
  M.add({ text: "The user owns a feline rescue", bucket: "knowledge", importance: 2 });
  assert.equal(await M.warm("my cat needs a post", null), true);
  assert.ok(calls >= 1);
  const top = M.recall({ query: "my cat needs a post", limit: 3 });
  assert.match(top[0].text, /feline rescue/, "meaning match without a shared word");
  M.setEmbedderHook(null);
  await M.setSmarter(false);
});

test("server: a fact stated in chat 1 reaches the AI in chat 2, a Mission step, a Council; delete, undo and off work", { timeout: 300000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const proj = await s.api("/projects", { method: "POST", body: { name: "Test Bakery" } });
    const pid = proj.json.id;
    const waitFor = async (pred) => { for (let i = 0; i < 600; i++) { const m = (await s.api("/missions")).json.find(pred); if (m && ["done", "done-with-errors", "failed", "aborted"].includes(m.status)) return m; await sleep(250); } return null; };
    const deliverable = async (id) => (await s.api(`/missions/${id}`)).json.deliverable || "";

    assert.equal((await s.api("/memories", { noToken: true })).status, 401);
    // chat 1 states a lasting fact
    const id1 = await chatRunId(s.api, { prompt: "My business is Test Bakery in Sacramento. Write a tagline.", provider: "demo-nova", model: "nova-lite", projectId: pid });
    const c1 = await waitFor((x) => x.id === id1);
    assert.ok(c1);
    const list1 = (await s.api("/memories")).json;
    assert.equal(list1.items.length, 1);
    assert.match(list1.items[0].text, /Test Bakery/);
    assert.equal(list1.items[0].bucket, "about-me");
    // the page is told, so it can show "Remembered: ..." with Undo
    const ev = (await s.api("/state")).json.recent?.find((e) => e.type === "memory.saved");
    assert.ok(ev, "a memory.saved event was sent");
    assert.match(ev.saved[0].text, /Test Bakery/);

    // chat 2 (another chat, no project): the AI got the memory in its prompt
    const idc2 = await chatRunId(s.api, { prompt: "Name a colour for the shop sign.", provider: "demo-nova", model: "nova-lite" });
    const c2 = await waitFor((x) => x.id === idc2);
    assert.ok(c2);
    assert.equal((await s.api(`/missions/${c2.id}`)).json.memory, true);
    assert.match(await deliverable(c2.id), /Remembering: My business is Test Bakery in Sacramento/);

    // a council: every member and the chair
    await s.api("/council", { method: "POST", body: { prompt: "Pick a name for the spring menu.", projectId: pid, qa: false, lite: true } });
    const council = await waitFor((x) => x.kind === "council" && x.projectId === pid);
    assert.ok(council && council.status === "done");
    const cFull = (await s.api(`/missions/${council.id}`)).json;
    assert.equal(cFull.memory, true);
    assert.match(cFull.verdict.text, /Remembering: My business is Test Bakery/);
    assert.ok(Object.values(cFull.answers).every((a) => !a.text || /Remembering: My business is Test Bakery/.test(a.text)), "every Council member saw it");

    // a Mission: the memory rides in the context of every step
    const run = await s.api("/pipelines/run", { method: "POST", body: { id: "client-proposal", values: { client: "Test Bakery", need: "a website" }, projectId: pid } });
    assert.equal(run.status, 202, run.text);
    const mission = await waitFor((x) => x.kind === "mission" && x.projectId === pid);
    assert.ok(mission && ["done", "done-with-errors"].includes(mission.status));
    const mFull = (await s.api(`/missions/${mission.id}`)).json;
    assert.equal(mFull.memory, true);
    assert.match(mFull.deliverable, /Remembering: My business is Test Bakery/);
    // each worker step is sent that same context (checked in the source below; the practice AI only echoes it in the assembly and QA)

    // remember / forget by chat through the routes the voice worker uses
    const rem = await s.api("/memories/remember", { method: "POST", body: { text: "remember that our brand voice is warm", projectId: pid } });
    assert.equal(rem.status, 200, rem.text);
    assert.equal(rem.json.line, "Remembered: our brand voice is warm");
    assert.equal(rem.json.memory.bucket, "project");
    const fg = await s.api("/memories/forget", { method: "POST", body: { text: "forget that our brand voice is warm" } });
    assert.equal(fg.json.removed.length, 1);
    const back = await s.api("/memories/restore", { method: "POST", body: { memory: fg.json.removed[0] } });
    assert.equal(back.status, 200, "undo of a forget puts it back");
    assert.equal((await s.api("/memories")).json.items.length, 2);

    // secrets are refused with the plain line
    const bad = await s.api("/memories/remember", { method: "POST", body: { text: "remember my password is hunter2" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, "I will not remember passwords or account numbers.");

    // edit, star, delete (Undo of a save is a delete)
    const first = (await s.api("/memories")).json.items.find((m) => /Test Bakery/.test(m.text));
    assert.equal((await s.api(`/memories/${first.id}`, { method: "POST", body: { starred: true } })).json.memory.importance, 5);
    assert.equal((await s.api(`/memories/${first.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api("/memories")).json.items.some((m) => m.id === first.id), false);
    const idc3 = await chatRunId(s.api, { prompt: "Name another colour.", provider: "demo-nova", model: "nova-lite" });
    const c3 = await waitFor((x) => x.id === idc3);
    assert.doesNotMatch(await deliverable(c3.id), /Test Bakery in Sacramento/, "a deleted memory is no longer used");

    // off: no recall and no auto-save
    assert.equal((await s.api("/memories/enabled", { method: "POST", body: { on: false } })).json.enabled, false);
    const idc4 = await chatRunId(s.api, { prompt: "My favorite colour is green. Name a colour.", provider: "demo-nova", model: "nova-lite" });
    const c4 = await waitFor((x) => x.id === idc4);
    assert.doesNotMatch(await deliverable(c4.id), /Remembering/);
    assert.equal((await s.api("/memories")).json.items.some((m) => /green/.test(m.text)), false, "off: not saved");
    await s.api("/memories/enabled", { method: "POST", body: { on: true } });
    assert.equal((await s.api("/memories/clear", { method: "POST", body: {} })).status, 400, "Clear all needs a confirm");
    assert.equal((await s.api("/memories/clear", { method: "POST", body: { confirm: true } })).status, 200);
    assert.equal((await s.api("/memories")).json.items.length, 0);
    // Smarter recall shows Needs a key with no OpenAI or Gemini key
    const sm = (await s.api("/memories")).json.smarter;
    assert.equal(sm.available, false);
    assert.equal(sm.note, "Needs a key");
    assert.equal((await s.api("/memories/smarter", { method: "POST", body: { on: true } })).status, 400);
  } finally { await s.stop(); }
});

test("browser: Settings > Memories lists by group, edits, stars, deletes, turns memory off; Remembered line has Undo", { skip, timeout: 240000 }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 900 });
  try {
    await t.api("/memories", { method: "POST", body: { text: "I run a bakery", bucket: "about-me" } });
    await t.api("/memories", { method: "POST", body: { text: "Brand voice is warm", bucket: "project", projectId: (await t.api("/projects")).json.projects?.[0]?.id || "my-project" } });
    await t.api("/memories", { method: "POST", body: { text: "Prices are in euros", bucket: "knowledge" } });
    await t.page.evaluate(() => window.CC.go("settings"));
    await t.page.waitForSelector("#mem2-panel [data-mem-bucket]", { timeout: WAIT });
    const groups = await t.page.$$eval("#mem2-panel [data-mem-bucket]", (els) => els.map((e) => e.dataset.memBucket));
    assert.deepEqual(groups, ["about-me", "project", "knowledge"]);
    assert.match(await t.page.textContent('[data-mem-bucket="about-me"]'), /I run a bakery/);
    assert.match(await t.page.textContent("#mem2-panel"), /Needs a key/);
    assert.equal(await t.page.isDisabled("#mem-smarter"), true);
    // edit
    await t.page.locator('[data-mem-bucket="about-me"] [data-mem-edit]').evaluate((b) => b.click());
    await t.page.fill('[data-mem-bucket="about-me"] textarea', "I run a flower shop");
    await t.page.locator("[data-mem-save]").evaluate((b) => b.click());
    await t.page.waitForFunction(() => /flower shop/.test(document.querySelector('[data-mem-bucket="about-me"]')?.textContent || ""), null, { timeout: WAIT });
    assert.equal((await t.api("/memories")).json.items.some((m) => /flower shop/.test(m.text)), true);
    // star
    await t.page.click('[data-mem-bucket="knowledge"] [data-mem-star]');
    await t.page.waitForFunction(() => document.querySelector('[data-mem-bucket="knowledge"] [data-mem-star]')?.getAttribute("aria-pressed") === "true", null, { timeout: WAIT });
    // a secret typed into Add is refused in plain words
    await t.page.fill("#mem-add-text", "my password is hunter2");
    await t.page.click("#mem-add");
    await t.page.waitForFunction(() => /will not remember passwords/.test(document.querySelector("#mem-add-note")?.textContent || ""), null, { timeout: WAIT });
    // delete
    await t.page.click('[data-mem-bucket="knowledge"] [data-mem-del]');
    await t.page.waitForFunction(() => !/euros/.test(document.querySelector('[data-mem-bucket="knowledge"]')?.textContent || ""), null, { timeout: WAIT });
    // off
    await t.page.uncheck("#mem-on");
    await t.page.waitForFunction(() => /Memory is off/.test(document.querySelector("#mem-on-note")?.textContent || ""), null, { timeout: WAIT });
    assert.equal((await t.api("/memories")).json.enabled, false);
    await t.page.check("#mem-on");
    await t.page.waitForFunction(() => /saves lasting things/.test(document.querySelector("#mem-on-note")?.textContent || ""), null, { timeout: WAIT });
    // the Remembered line with Undo
    const id = (await t.api("/memories", { method: "POST", body: { text: "Undo me please", bucket: "knowledge" } })).json.memory.id;
    await t.page.evaluate((i) => window.CC.features.find((f) => f.id === "memories").onEvent({ type: "memory.saved", saved: [{ id: i, text: "Undo me please" }] }), id);
    await t.page.waitForSelector("#mem-line #mem-undo", { timeout: WAIT });
    assert.match(await t.page.textContent("#mem-line"), /Remembered: Undo me please/);
    await t.page.click("#mem-undo");
    await t.page.waitForFunction(async () => !(await (await fetch("/api/memories", { headers: { "x-cc-token": window.__tok || "" } })).text().catch(() => "")).includes("Undo me please") || true, null, { timeout: WAIT });
    await t.page.waitForSelector("#mem-line", { state: "detached", timeout: WAIT });
    assert.equal((await t.api("/memories")).json.items.some((m) => m.id === id), false, "Undo removed it");
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test("source: plain words and no dashes in the Memories screen", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "memories.js"), "utf8");
  const srv = fs.readFileSync(path.join(ROOT, "server", "memories.js"), "utf8");
  assert.equal(/[–—]/.test(ui), false);
  for (const needle of ["About me", "This project", "Knowledge", "Memory on", "Clear all", "Smarter recall (uses your OpenAI or Gemini key)", "Needs a key"]) assert.ok((ui + srv).includes(needle), needle);
  assert.match(fs.readFileSync(path.join(ROOT, "web", "perf", "registry.js"), "utf8"), /"memories"/);
});

test("source: every Mission worker, the QA reviewer and the Council chair get the recalled memories", () => {
  const mission = fs.readFileSync(path.join(ROOT, "server", "mission.js"), "utf8");
  assert.match(mission, /context = withMemory\(context, projectId, `\$\{goal\}\\n\$\{context\}`\)/);
  assert.match(mission, /TASK: \$\{t\.title\}\\nINSTRUCTIONS: \$\{t\.instructions\}\\nDELIVERABLE: \$\{t\.deliverable\}\$\{inputs \? `\\n\\n\$\{inputs\}` : ""\}\$\{context \? `\\n\\nCONTEXT:\\n\$\{context\}`/, "workers get CONTEXT");
  assert.match(mission, /DELIVERABLE REQUIRED: \$\{t\.deliverable\}\$\{memNote\}/, "QA reviewer gets memNote");
  const council = fs.readFileSync(path.join(ROOT, "server", "council.js"), "utf8");
  assert.match(council, /contextFor\(projectId, prompt\)/);
  assert.match(council, /QUESTION:\\n\$\{prompt\}\$\{memNote\}/, "reviewers and chair get memNote");
});
