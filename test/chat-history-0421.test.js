// 0.4.21 L-hist: chat history and reuse. Pure helpers, then the real server in practice mode (no real key),
// including a restart on the same data folder. Nothing is sent anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, waitBudget } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-hh-unit-");
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(process.env.CC_DATA_DIR)));
const H = await import("../server/chat-history.js");

const NOW = Date.UTC(2026, 9, 26, 12);
const runs = [
  { id: "s-1", kind: "single", prompt: "Please write three taglines for my sourdough bakery Crumb & Co.", status: "done", startedAt: NOW - 5000, deliverable: "1. Slow dough, fast smiles." },
  { id: "s-2", kind: "single", prompt: "Please write three taglines for my sourdough bakery Crumb & Co.", status: "done", startedAt: NOW - 4000, deliverable: "Wild yeast, warm hearts." },
  { id: "m-1", kind: "mission", goal: "Build a one page site for a roofing company", status: "done", startedAt: NOW - 3000, deliverable: "<html>roofing</html>" },
  { id: "c-1", kind: "council", prompt: "Should I raise my prices in January?", status: "done", startedAt: NOW - 2000, verdict: { text: "Yes, a small raise." } },
  { id: "p-1", kind: "single", prompt: "My secret client plan", private: true, status: "done", startedAt: NOW - 1000, deliverable: "Private plan about bakery" },
  { id: "w-1", kind: "single", prompt: "WALKTHROUGH_PLAN_STEP one", status: "done", startedAt: NOW },
  { id: "e-1", kind: "single", prompt: "x", status: "failed", startedAt: NOW - 9000, deliverable: "" },
];

test("titles are plain words, short, and never empty", () => {
  assert.equal(H.plainTitle("Please write three taglines for my sourdough bakery Crumb & Co."), "Write three taglines for my sourdough bakery Crumb & Co");
  assert.match(H.plainTitle("a".repeat(30) + " " + "b".repeat(80)), /\.\.\.$/);
  assert.equal(H.plainTitle(""), "Untitled chat");
  assert.equal(H.plainTitle("```js\nlet x\n``` https://x.test/very/long"), "Untitled chat");
  assert.equal(/[–—]/.test(H.plainTitle("Make it – now — fast")), true, "titles keep what the person typed");
});

test("list is newest first, searchable, hides internal prompts, and keeps pinned on top", () => {
  const all = H.listRows(runs);
  assert.deepEqual(all.map((r) => r.id), ["p-1", "c-1", "m-1", "s-2", "s-1", "e-1"]);
  assert.equal(all.find((r) => r.id === "c-1").preview, "Yes, a small raise");
  assert.deepEqual(H.listRows(runs, { q: "roofing" }).map((r) => r.id), ["m-1"]);
  assert.deepEqual(H.listRows(runs, { q: "bakery taglines" }).map((r) => r.id), ["s-2", "s-1"]);
  assert.deepEqual(H.listRows(runs, { q: "nothing like this" }), []);
  assert.equal(H.listRows(runs, { limit: 2 }).length, 2);
});

test("pin, rename and hide are saved in one versioned document", () => {
  H.pin("s-1"); H.rename("m-1", "Roofing site"); H.hide("e-1");
  const d = H.extras();
  assert.equal(d.format, "meldmind-chat-history");
  assert.equal(d.version, 1);
  const rows = H.listRows(runs);
  assert.equal(rows[0].id, "s-1");
  assert.equal(rows.find((r) => r.id === "m-1").title, "Roofing site");
  assert.ok(!rows.some((r) => r.id === "e-1"));
  assert.ok(H.listRows(runs, { includeHidden: true }).some((r) => r.id === "e-1"));
  // a newer or damaged document is repaired, never thrown on, and unknown fields survive
  const n = H.normalizeDoc({ version: 9, pinned: "oops", titles: { a: 5, b: " ok " }, future: { keep: 1 } });
  assert.equal(n.version, 9); assert.deepEqual(n.pinned, []); assert.deepEqual(n.titles, { b: "ok" }); assert.deepEqual(n.future, { keep: 1 });
  assert.equal(H.normalizeDoc(null).version, 1);
  H.pin("s-1", false); H.hide("e-1", false); H.rename("m-1", "");
});

test("Do this again and Change and redo build the right request", () => {
  const same = H.redoSpec(runs[0]);
  assert.equal(same.kind, "single");
  assert.equal(same.body.prompt, runs[0].prompt);
  const changed = H.redoSpec(runs[2], "Use green and add a phone number");
  assert.equal(changed.kind, "mission");
  assert.match(changed.body.goal, /^Build a one page site for a roofing company\n\nChange this time: Use green and add a phone number$/);
  assert.equal(H.redoSpec(null).status, 404);
  assert.equal(H.redoSpec({ id: "i", kind: "imported", prompt: "x" }).status, 400);
});

test("quick picks: recent asks without repeats, private and imported left out, saved prompts first", () => {
  const p = H.quickPicks(runs, [{ id: "pr1", name: "Weekly update", prompt: "Write my weekly update" }, { id: "pr2", name: "Empty", prompt: "" }]);
  assert.deepEqual(p.recent.map((r) => r.id), ["c-1", "m-1", "s-2", "e-1"]);
  assert.equal(p.recent.filter((r) => r.text.includes("sourdough")).length, 1);
  assert.ok(!p.recent.some((r) => r.id === "p-1" || r.id === "w-1"));
  assert.deepEqual(p.saved.map((s) => s.id), ["pr1"]);
});

test("recall finds past work, skips private chats and failed runs, and works without Memories", async () => {
  const hits = H.recallPast("taglines for the bakery brand", runs);
  assert.deepEqual(hits.map((h) => h.id).sort(), ["s-1", "s-2"]);
  assert.ok(!H.recallPast("bakery", runs).some((h) => h.id === "p-1"));
  assert.deepEqual(H.recallPast("the and", runs), []);
  const all = await H.recallAll("roofing site", runs);
  assert.match(all.past, /^Earlier work that may help:/);
  assert.equal(typeof all.memories, "string");
  assert.match(all.text, /Roofing|roofing/i);
});

test("source: no em dashes in the new user-facing files, registry knows the module", () => {
  const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, "..", ...p), "utf8");
  for (const f of [["web", "features", "chat-history.js"], ["server", "chat-history.js"]]) assert.equal(/[–—]/.test(read(...f).replace(/^\s*\/\/.*$/gm, "")), false, f.join("/"));
  assert.match(read("web", "perf", "registry.js"), /\{ id: "chat-history", home: true, deliverable: true \}/);
  assert.match(read("web", "features", "layout.js"), /side-search/);
});

const until = async (fn, ms) => { const end = Date.now() + waitBudget(ms); while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return null; };

test("server: chats are saved, listed, searched, redone, and survive a restart on the same folder", { timeout: 120000 }, async () => {
  const a = await startServer();
  let keep = null;
  try {
    assert.equal((await a.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const sent = await a.api("/chat", { method: "POST", body: { prompt: "Write a short note about my sourdough bakery opening." } });
    assert.equal(sent.status, 202);
    const done = await until(async () => { const r = await a.api(`/missions/${sent.json.runId}`); return r.json?.status && r.json.status !== "running" && r.json.status !== "waiting" ? r.json : null; }, 30000);
    assert.ok(done, "the chat finished");
    const list = await a.api("/chathist");
    assert.equal(list.status, 200);
    assert.equal(list.json.version, 1);
    const row = list.json.items.find((i) => i.id === sent.json.runId);
    assert.ok(row, "saved without any save step");
    assert.match(row.title, /^Write a short note about my sourdough bakery opening/);
    assert.equal((await a.api("/chathist?q=sourdough")).json.items.length, 1);
    assert.equal((await a.api("/chathist?q=zebra")).json.items.length, 0);
    assert.equal((await a.api("/chathist/picks")).json.recent[0].text.startsWith("Write a short note"), true);
    assert.equal((await a.api("/chathist/recall?q=bakery")).json.hits[0].id, sent.json.runId);
    assert.ok(typeof (await a.api("/chathist/recall-all?q=bakery")).json.text === "string");

    const again = await a.api("/chathist/redo", { method: "POST", body: { id: sent.json.runId, change: "Make it funny" } });
    assert.equal(again.status, 202);
    assert.equal(again.json.changed, true);
    assert.equal((await a.api("/chathist/redo", { method: "POST", body: { id: "s-missing" } })).status, 404);
    const two = await until(async () => { const r = await a.api("/chathist?q=funny"); return r.json.items.find((i) => i.status && i.status !== "running" && i.status !== "waiting"); }, 30000);
    assert.ok(two, "the changed request ran as its own chat");
    assert.match(two.title, /Change this time|funny|Write a short note/i);

    assert.equal((await a.api("/chathist/pin", { method: "POST", body: { id: sent.json.runId } })).status, 200);
    assert.equal((await a.api("/chathist/rename", { method: "POST", body: { id: sent.json.runId, title: "Bakery opening note" } })).status, 200);
    keep = tmpDir("cc-hh-keep-");
    fs.cpSync(a.dir, keep, { recursive: true });
    var firstId = sent.json.runId;
  } finally { await a.stop(); }

  const b = await startServer({ dataDir: keep });
  try {
    const list = await b.api("/chathist");
    const row = list.json.items.find((i) => i.id === firstId);
    assert.ok(row, "history is still there after a restart");
    assert.equal(row.title, "Bakery opening note");
    assert.equal(row.pinned, true);
    assert.equal(list.json.items[0].id, firstId, "pinned stays on top");
    const doc = JSON.parse(fs.readFileSync(path.join(b.dir, "chathist.json"), "utf8"));
    assert.equal(doc.format, "meldmind-chat-history");
    assert.equal(doc.version, 1);
  } finally { await b.stop(); fs.rmSync(keep, { recursive: true, force: true }); }
});

// ---------- the page ----------
import { bootPage, findBrowser, goChat } from "./pw-helpers.js";
const skip = findBrowser() ? false : "no Chrome installed";

test("page: History in the sidebar lists a finished chat, search narrows it, a quick pick fills the box without sending", { skip, timeout: 120000 }, async () => {
  const t = await bootPage({ mode: "simple", width: 1280, height: 800 });
  try {
    assert.equal((await t.api("/demo", { body: { on: true } })).json.demo, true);
    const sent = await t.api("/chat", { method: "POST", body: { prompt: "Write a welcome line for my sourdough bakery." } });
    await until(async () => { const r = await t.api(`/missions/${sent.json.runId}`); return r.json?.status === "done"; }, 30000);
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.addStyleTag({ content: "#cc-startup,#cc-look-offer,#demo-bar,#cc-desktop-prompt,.cc-tour-invite{display:none!important}" });
    await goChat(t.page);
    await t.page.waitForSelector("#side-search", { timeout: waitBudget(20000) });
    await t.page.waitForSelector("#side-recent .side-chat", { timeout: waitBudget(20000) });
    assert.match(await t.page.textContent("#side-recent-h"), /History/);
    assert.match(await t.page.textContent("#side-recent .side-chat"), /Write a welcome line for my sourdough bakery/);
    await t.page.fill("#side-search", "zebra");
    await t.page.waitForSelector("#side-recent .side-empty", { timeout: waitBudget(10000) });
    await t.page.fill("#side-search", "sourdough");
    await t.page.waitForSelector("#side-recent .side-chat", { timeout: waitBudget(10000) });
    await t.page.waitForSelector("#hh-picks .hh-pick", { timeout: waitBudget(20000) });
    await t.page.click("#hh-picks .hh-pick");
    assert.equal(await t.page.inputValue("#orders"), "Write a welcome line for my sourdough bakery.");
    const stillOne = await t.api("/chathist");
    assert.equal(stillOne.json.items.length, 1, "picking did not send anything");
  } finally { await t.close(); }
});
