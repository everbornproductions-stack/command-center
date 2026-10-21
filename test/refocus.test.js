// Refocus: timeline order, status labels, Pro / Extreme gates, and the "who will read this" preview.
// Temp data dir only. Demo AIs only. No real key. data/ is not read.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { resolveTier } from "../server/license.js";
import { refocusGate, assertRefocusFind, assertRefocusRebuild } from "../server/feature-gate.js";
import { whoWillRead } from "../server/readers.js";
import {
  byDate, statusOf, assemble, buildPlan, mergeWorked, decorate, fromDrive, publicItem,
} from "../server/refocus.js";
import { loadHelp } from "../server/help.js";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const EM = "\u2014";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedLicense(dir, tier) {
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
    key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier, status: "active",
    lastOkAt: now, checkedAt: now, lastError: null, email: "t@example.com",
  }));
}

function writeMission(dir, m) {
  fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
  fs.writeFileSync(path.join(dir, "missions", m.id + ".json"), JSON.stringify(m));
}

function seedChats(dir) {
  writeMission(dir, {
    id: "old", kind: "imported", source: "chatgpt", title: "Music videos outline",
    prompt: "A finished outline of the music videos.", status: "done", updatedAt: 1000, startedAt: 1000,
    messages: [{ role: "assistant", text: "A finished outline of the music videos." }],
  });
  writeMission(dir, {
    id: "mid", kind: "single", title: "Music videos pass", provider: "openai",
    prompt: "These music videos are half-done.", status: "done", updatedAt: 2000, startedAt: 2000,
    messages: [{ role: "assistant", text: "These music videos are half-done." }],
  });
  writeMission(dir, {
    id: "new", kind: "mission", title: "Music videos attempt",
    goal: "Music videos that were cancelled.", status: "cancelled", updatedAt: 3000, startedAt: 3000,
  });
  writeMission(dir, {
    id: "secret", kind: "single", title: "Music videos private", private: true,
    prompt: "Secret music videos private notes that must stay out.", status: "done", updatedAt: 1500, startedAt: 1500,
    messages: [{ role: "assistant", text: "Secret music videos private notes that must stay out." }],
  });
}

function missionNames(dir) {
  return fs.readdirSync(path.join(dir, "missions")).filter((f) => f.endsWith(".json")).sort();
}

const sample = [
  { id: "old", title: "Music videos storyboard", text: "Music videos storyboard locked for the channel.", status: "done", date: 1000, source: "ChatGPT", sourceKind: "import:chatgpt" },
  { id: "mid", title: "Music videos storyboard pass", text: "Music videos storyboard added shots that are half-done.", status: "done", date: 2000, source: "Saved chat", sourceKind: "chat:openai" },
  { id: "new", title: "Music videos drawer", text: "Music videos left in a drawer with no ending.", status: "cancelled", date: 3000, source: "Mission", sourceKind: "mission" },
  { id: "late", title: "Music videos storyboard final", text: "Music videos storyboard final cut delivered cleanly.", status: "done", date: 4000, source: "Mission", sourceKind: "mission" },
  { id: "secret", title: "Music videos", text: "Secret music videos private notes", status: "done", date: 1500, source: "Saved chat", sourceKind: "chat", private: true },
  { id: "nodate", title: "Music videos someday", text: "Music videos with no date yet.", status: "running", date: 0, source: "Saved chat", sourceKind: "chat" },
];

test("timeline is oldest to newest and undated items sort last", () => {
  const ordered = byDate([
    { id: "b", date: 5 },
    { id: "a", date: 1 },
    { id: "z", date: 0 },
    { id: "y" },
  ]);
  assert.deepEqual(ordered.map((i) => i.id), ["a", "b", "y", "z"]);
  const found = assemble({ runs: sample, topic: "music videos" });
  assert.deepEqual(found.items.map((i) => i.id), ["old", "mid", "new", "late", "nodate"]);
  assert.equal(found.skippedPrivate, 1);
  assert.equal(JSON.stringify(found).includes("Secret"), false);
});

test("status labels are finished, partial, or abandoned", () => {
  assert.equal(statusOf({ status: "done", text: "A finished outline of the music videos." }), "finished");
  assert.equal(statusOf({ status: "completed", text: "The music videos are ready." }), "finished");
  assert.equal(statusOf({ status: "done", text: "These music videos are half-done." }), "partial");
  assert.equal(statusOf({ status: "done", text: "Draft music videos.", title: "WIP" }), "partial");
  assert.equal(statusOf({ status: "done", text: "Music videos answer.", openQuestion: true }), "partial");
  assert.equal(statusOf({ status: "running", text: "Still working on the music videos." }), "partial");
  assert.equal(statusOf({ status: "cancelled", text: "Music videos that were cancelled." }), "abandoned");
  assert.equal(statusOf({ status: "aborted", text: "stopped" }), "abandoned");
  assert.equal(statusOf({ status: "failed", text: "nope" }), "abandoned");
  assert.equal(statusOf({ status: "failed", text: "x".repeat(40) }), "partial");
  assert.equal(statusOf({ title: "Empty", text: "" }), "abandoned");
  const draft = decorate(fromDrive({ id: "d1", name: "music videos draft.gdoc", modified: "2020-01-02T00:00:00.000Z", text: "shots" }));
  assert.equal(draft.status, "partial");
  assert.equal(draft.source, "Google Drive");
  assert.equal(draft.sourceKind, "drive");
});

test("the complete version plan keeps finished work, marks later passes, and lists what is missing", () => {
  const found = assemble({ runs: sample, topic: "music videos" });
  assert.deepEqual(found.plan.kept.map((k) => k.id), ["old", "late"]);
  assert.ok(found.plan.improved.some((row) => row.id === "mid"));
  assert.ok(found.plan.missing.some((row) => row.id === "new" && row.status === "abandoned"));
  assert.ok(found.plan.missing.some((row) => row.id === "mid" && row.status === "partial"));
  const ranked = buildPlan(found.items, { worked: [{ source: "mission", n: 2 }] });
  assert.deepEqual(ranked.kept.map((k) => k.id), ["late", "old"], "a source kind that worked sorts first in Kept");
  assert.deepEqual(found.items.map((i) => i.id), ["old", "mid", "new", "late", "nodate"], "the timeline stays in date order");
  assert.match(found.plan.note, /Nothing is sent until you click/);
  const next = mergeWorked({ worked: [{ source: "drive", n: 1 }], ais: [] }, { sources: ["import:chatgpt"], ais: ["demo-nova"] });
  assert.equal(next.worked.find((w) => w.source === "import:chatgpt").n, 1);
  assert.equal(next.worked.find((w) => w.source === "drive").n, 1);
  assert.equal(next.ais[0].id, "demo-nova");
  assert.equal(JSON.stringify(next).includes("Secret"), false);
});

test("who will read this is stable, and a past win ranks that AI first", () => {
  const rankFn = () => [
    { provider: "openai", providerName: "OpenAI", model: "gpt" },
    { provider: "anthropic", providerName: "Anthropic", model: "claude" },
  ];
  const quiet = { rankFn, search: false, agent: { use: false } };
  const first = whoWillRead({ prompt: "music videos", ...quiet });
  const second = whoWillRead({ prompt: "music videos", ...quiet });
  assert.equal(first.heading, "Who will read this");
  assert.deepEqual(first.readers.map((r) => r.id), second.readers.map((r) => r.id));
  assert.deepEqual(first.readers.map((r) => r.id), ["openai", "anthropic"]);
  for (const row of first.readers) {
    assert.equal(typeof row.name, "string");
    assert.equal(row.kind, "ai");
    assert.equal(row.receives, "the orders and the short excerpts");
    assert.equal(row.mission, true);
  }
  assert.match(first.note, /Nothing is sent until you click/);
  const boosted = whoWillRead({
    prompt: "Build one complete version of this work: music videos.",
    rankFn,
    search: { council: true, mission: true, id: "search:tavily", name: "Web search" },
    agent: { use: true, agent: { id: "grokbot", name: "Grok Bot" } },
    record: { ais: [{ id: "anthropic", n: 3 }] },
  });
  assert.equal(boosted.readers[0].id, "anthropic");
  assert.equal(boosted.readers[0].name, "Anthropic");
  const search = boosted.readers.find((r) => r.id === "search:tavily");
  const bot = boosted.readers.find((r) => r.id === "grokbot");
  assert.ok(search, "search is listed when a council or mission would use it");
  assert.equal(search.kind, "service");
  assert.equal(search.council, true);
  assert.equal(search.mission, true);
  assert.ok(bot, "Grok Bot is listed when a step would use it");
  assert.equal(bot.kind, "service");
  assert.match(bot.receives, /signed-in service/);
});

test("gates: find is Pro, rebuild is Extreme with no cap, owner can do both", () => {
  const now = Date.now();
  assert.equal(resolveTier({ lic: { tier: "extreme", status: "active", lastOkAt: now }, now }).tier, "extreme");
  assert.equal(refocusGate({ tier: "free" }).find, false);
  assert.equal(refocusGate({ tier: "free" }).rebuild, false);
  assert.match(refocusGate({ tier: "free" }).upgrade, /Pro \(\$18\.99\/month\)/);
  assert.equal(refocusGate({ tier: "pro" }).find, true);
  assert.equal(refocusGate({ tier: "pro" }).timeline, true);
  assert.equal(refocusGate({ tier: "pro" }).status, true);
  assert.equal(refocusGate({ tier: "pro" }).rebuild, false);
  assert.match(refocusGate({ tier: "pro" }).rebuildUpgrade, /Extreme/);
  assert.equal(refocusGate({ tier: "studio" }).find, true);
  assert.equal(refocusGate({ tier: "studio" }).rebuild, false);
  for (const tier of ["extreme", "owner"]) {
    const gate = refocusGate({ tier });
    assert.equal(gate.find, true);
    assert.equal(gate.rebuild, true);
    assert.equal(gate.unlimited, true);
    assert.equal(gate.upgrade, null);
    assert.doesNotThrow(() => assertRefocusRebuild({ tier }));
    assert.doesNotThrow(() => assertRefocusRebuild({ tier }));
  }
  assert.throws(() => assertRefocusFind({ tier: "free" }), (e) => e.status === 402 && e.code === "pro_required");
  assert.throws(() => assertRefocusRebuild({ tier: "pro" }), (e) => e.status === 402 && e.code === "extreme_required");
  assert.throws(() => assertRefocusRebuild({ tier: "free" }), (e) => e.status === 402 && e.code === "pro_required");
  const gateSrc = read("server/feature-gate.js");
  assert.equal(/square\.link|squareup|square\.com/i.test(gateSrc), false);
  assert.equal(gateSrc.includes(EM), false);
  for (const rel of ["server/refocus.js", "server/readers.js", "server/plugins/refocus.js", "web/features/refocus.js", "docs/help/refocus.md"]) {
    assert.equal(read(rel).includes(EM), false, rel);
  }
  const plugin = read("server/plugins/refocus.js");
  const index = read("server/index.js");
  const app = read("web/app.js");
  assert.match(plugin, /assertRefocusRebuild/);
  assert.match(plugin, /feature-gate\.js/);
  assert.match(plugin, /whoWillRead/);
  assert.match(index, /whoWillRead\(\{ prompt, mode, classification: cls \}\)/);
  assert.match(app, /Who will read this/);
  assert.match(read("web/features/refocus.js"), /Rebuild it/);
  const help = loadHelp();
  const article = help.articles.find((a) => a.id === "refocus");
  assert.ok(article, "help article");
  assert.equal(article.lastUpdatedVersion, "0.4.8");
  assert.match(article.body, /finished, partial, or abandoned/);
  const pub = publicItem({ id: "x", source: "ChatGPT", date: 1000, title: "T", status: "finished", summary: "S", text: "Secret raw" });
  assert.equal(pub.text, undefined);
});

test("free: the page shows the upgrade note and find does not search", async () => {
  const s = await startServer();
  try {
    const g = await s.api("/refocus");
    assert.equal(g.status, 200);
    assert.equal(g.json.find, false);
    assert.equal(g.json.rebuild, false);
    assert.equal(g.json.sent, false);
    assert.match(g.json.upgrade, /Pro/);
    const before = missionNames(s.dir);
    const find = await s.api("/refocus/find", { method: "POST", body: { topic: "music videos" } });
    assert.equal(find.status, 402);
    assert.equal(find.json.code, "pro_required");
    const rebuild = await s.api("/refocus/rebuild", { method: "POST", body: { topic: "music videos" } });
    assert.equal(rebuild.status, 402);
    assert.equal(rebuild.json.code, "pro_required");
    assert.deepEqual(missionNames(s.dir), before);
    assert.equal((await s.api("/state")).json.plugins.includes("refocus"), true);
  } finally { await s.stop(); }
});

test("pro: timeline, statuses, private chats left out, preview, and no rebuild", async () => {
  const s = await startServer({ seed: (dir) => { seedLicense(dir, "pro"); seedChats(dir); } });
  try {
    const st = await s.api("/state");
    assert.equal(st.json.license.tier, "pro", JSON.stringify(st.json.license));
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const before = missionNames(s.dir);
    const found = await s.api("/refocus/find", { method: "POST", body: { topic: "music videos" } });
    assert.equal(found.status, 200, found.text);
    assert.equal(found.json.sent, false);
    assert.deepEqual(found.json.items.map((i) => i.id), ["old", "mid", "new"]);
    assert.deepEqual(found.json.items.map((i) => i.status), ["finished", "partial", "abandoned"]);
    for (const item of found.json.items) {
      assert.equal(typeof item.source, "string");
      assert.ok(item.date > 0);
      assert.ok(item.summary.length > 0);
      assert.equal(item.text, undefined);
    }
    assert.equal(found.json.skippedPrivate, 1);
    assert.equal(found.text.includes("Secret"), false);
    assert.equal(found.json.plan.title, "Complete version");
    assert.deepEqual(found.json.plan.kept.map((k) => k.id), ["old"]);
    assert.equal(found.json.whoWillRead.heading, "Who will read this");
    assert.ok(found.json.whoWillRead.readers.length > 0);
    for (const row of found.json.whoWillRead.readers) {
      assert.equal(typeof row.name, "string");
      assert.ok(row.kind === "ai" || row.kind === "service");
      assert.equal(typeof row.receives, "string");
    }
    assert.match(found.json.whoWillRead.note, /Nothing is sent until you click/);
    assert.equal(found.json.drive.receives, false);
    assert.deepEqual(missionNames(s.dir), before, "find does not start a mission");
    const route = await s.api("/route?prompt=" + encodeURIComponent("music videos"));
    assert.equal(route.status, 200, route.text);
    assert.equal(route.json.whoWillRead.heading, "Who will read this");
    assert.ok(Array.isArray(route.json.whoWillRead.readers));
    const rebuild = await s.api("/refocus/rebuild", { method: "POST", body: { topic: "music videos" } });
    assert.equal(rebuild.status, 402);
    assert.equal(rebuild.json.code, "extreme_required");
    assert.match(rebuild.json.upgrade, /Extreme/);
    assert.deepEqual(missionNames(s.dir), before, "a refused rebuild does not start a mission");
    assert.equal(fs.existsSync(path.join(s.dir, "refocus.record.json")), false);
  } finally { await s.stop(); }
});

test("extreme: Rebuild it starts one mission and records source kinds, not chat text", { timeout: 60000 }, async () => {
  const s = await startServer({ seed: (dir) => { seedLicense(dir, "extreme"); seedChats(dir); } });
  let started = null;
  try {
    assert.equal((await s.api("/state")).json.license.tier, "extreme");
    await s.api("/demo", { method: "POST", body: { on: true } });
    const before = missionNames(s.dir);
    const rebuild = await s.api("/refocus/rebuild", { method: "POST", body: { topic: "music videos" } });
    assert.equal(rebuild.status, 202, rebuild.text);
    assert.equal(rebuild.json.started, true);
    assert.equal(rebuild.json.sent, true);
    assert.equal(rebuild.json.whoWillRead.heading, "Who will read this");
    assert.ok(rebuild.json.chosen.sources.includes("import:chatgpt"));
    assert.equal(rebuild.text.includes("Secret"), false);
    const rec = JSON.parse(fs.readFileSync(path.join(s.dir, "refocus.record.json"), "utf8"));
    assert.ok(rec.chosen.sources.includes("import:chatgpt"));
    const saved = JSON.stringify(rec);
    assert.equal(saved.includes("Secret"), false);
    assert.equal(saved.includes("finished outline"), false);
    assert.deepEqual(rec.worked, []);
    for (let i = 0; i < 50 && !started; i++) {
      started = (await s.api("/missions")).json.find((m) => m.kind === "mission" && String(m.id).startsWith("m-"));
      if (!started) await sleep(100);
    }
    assert.ok(started, "a rebuild mission appeared");
    assert.ok(missionNames(s.dir).length > before.length);
    await s.api(`/mission/${started.id}/abort`, { method: "POST" });
  } finally {
    if (started) { try { await s.api(`/mission/${started.id}/abort`, { method: "POST" }); } catch {} }
    await s.stop();
  }
});
