// Phase 28: the learning router. Pure checks on server/brain.js with simulated job histories (council
// scores and wins, thumbs, QA scores, cost, latency, failures, reset, learning off, what is stored), then
// the running server against local mock providers: single, council and mission jobs are recorded, a thumb
// lands on the run's task type, account trouble is not held against a model, a seeded track record
// changes who the router picks and a reset puts the built-in order back, export / share preview / switch.
// No real URL or key is ever used; no prompt text, note text or key may appear in the stored record.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-brain-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const B = await import("../server/brain.js");

const BASE = { writing: 80, analysis: 80, fast: 70 };
const fresh = () => { B.resetBrain(); B.saveBrainSettings({ on: true, shareOptIn: false }); };
const q = (model, mode = "balanced", estCost = 0.01, diff = 2) => B.adjust({ model, baseCaps: BASE, capability: "writing", difficulty: diff, mode, estCost });

test("first-run setup shares anonymous track records until the person clears the box", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const note = "Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share.";
  assert.match(app, /I am willing to share anonymous track records/);
  assert.match(app, /shareOptIn: true/);
  assert.match(app, /id="su-share-note"/);
  assert.match(app, /id="su-share-what">What we share/);
  assert.match(app, /Meldmind learns from every job you run/);
  assert.match(app, /pick the best AI for everyone/);
  assert.match(app, /the task type, which AI, and the score/);
  assert.match(app, /never share prompts, content, or keys/);
  assert.match(app, /any time in Settings/);
  assert.match(app, new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(B.DEFAULTS.shareOptIn, true);
  const same = [
    "web/app.js",
    "web/features/brain.js",
    "docs/legal/privacy.md",
    "docs/legal/shared-learning.md",
    "docs/help/getting-started.md",
    "docs/USER-GUIDE.md",
  ];
  for (const rel of same) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(text, /Meldmind learns from every job you run/, rel);
    assert.match(text, /pick the best AI for everyone/, rel);
    assert.match(text, /any time in Settings/, rel);
    assert.match(text, /What we share/, rel);
    assert.match(text, /the task type, which AI, and the score/, rel);
    assert.match(text, /never share prompts, content, or keys/, rel);
    assert.match(text, /Meldmind learns from the community/, rel);
    assert.equal(text.includes("\u2014"), false, rel);
  }
  assert.match(app, /shareOptIn: on/);
});

test("no record means no change: the router starts from the registry exactly", () => {
  fresh();
  assert.equal(q("m-none"), null);
  assert.deepEqual(B.bestAtWhat().capabilities, []);
});

test("simulated council history changes the ranking: high scores and wins lift a model, low scores pull one down", () => {
  fresh();
  for (let i = 0; i < 6; i++) {
    B.observe({ provider: "p1", model: "m-good", capability: "writing", difficulty: 2, runId: `c-g${i}`, score: 9, won: true, cost: 0.01, ms: 4000 });
    B.observe({ provider: "p2", model: "m-poor", capability: "writing", difficulty: 2, runId: `c-g${i}`, score: 4, won: false, cost: 0.01, ms: 4000 });
  }
  const good = q("m-good"), poor = q("m-poor");
  assert.ok(good.quality > BASE.writing, `good ${good.quality} above base`);
  assert.ok(poor.quality < BASE.writing, `poor ${poor.quality} below base`);
  assert.equal(good.jobs, 6); assert.ok(good.confidence > 0.5 && good.confidence < 1);
  // the record grows into the score: more jobs, more weight
  const before = q("m-good").quality;
  for (let i = 0; i < 10; i++) B.observe({ provider: "p1", model: "m-good", capability: "writing", difficulty: 2, score: 10, won: true });
  assert.ok(q("m-good").quality > before);
  // the other capability is untouched
  assert.equal(B.adjust({ model: "m-good", baseCaps: BASE, capability: "analysis", difficulty: 2 }), null);
  // other difficulties of the same capability count, but half
  const hard = q("m-good", "balanced", 0.01, 3);
  assert.ok(hard && hard.confidence < q("m-good").confidence);
  const view = B.bestAtWhat();
  const w = view.capabilities.find((c) => c.capability === "writing");
  assert.equal(w.models[0].model, "m-good"); assert.equal(w.models[1].model, "m-poor");
  assert.equal(w.models[0].winRate, 1); assert.equal(w.models[1].winRate, 0);
  assert.equal(w.models[1].avgScore, 4); assert.equal(w.models[0].jobs, 16); assert.equal(w.jobs, 22);
});

test("thumbs weigh double, a second thumb on the same run replaces the first, the run's task type wins", () => {
  fresh();
  B.observe({ provider: "p", model: "m-a", capability: "writing", difficulty: 2, runId: "s-1", score: 7 });
  B.observe({ provider: "p", model: "m-b", capability: "writing", difficulty: 2, runId: "s-2", score: 7 });
  const even = q("m-a").quality;
  assert.equal(q("m-b").quality, even);
  // one thumb down moves m-a more than one more council score of 3 moves m-b
  B.rate({ runId: "s-1", model: "m-a", capability: "creative", up: false });
  B.observe({ provider: "p", model: "m-b", capability: "writing", difficulty: 2, score: 3 });
  const dropA = even - q("m-a").quality, dropB = even - q("m-b").quality;
  assert.ok(dropA > dropB, `thumb drop ${dropA} > score drop ${dropB}`);
  // the thumb landed on the run's task type (writing), not the capability the caller guessed (creative)
  assert.equal(B.adjust({ model: "m-a", baseCaps: BASE, capability: "creative" }), null);
  let row = B.bestAtWhat().capabilities.find((c) => c.capability === "writing").models.find((m) => m.model === "m-a");
  assert.equal(row.up, 0); assert.equal(row.down, 1);
  // changing the mind on the same run replaces the thumb
  B.rate({ runId: "s-1", model: "m-a", up: true });
  row = B.bestAtWhat().capabilities.find((c) => c.capability === "writing").models.find((m) => m.model === "m-a");
  assert.equal(row.up, 1); assert.equal(row.down, 0);
  assert.ok(q("m-a").quality > even, "a thumb up lifts it above where it started");
  // a thumb on a run the brain never saw still counts, on the capability given
  B.rate({ runId: "x-unknown", model: "m-c", capability: "analysis", up: true });
  assert.ok(B.adjust({ model: "m-c", baseCaps: BASE, capability: "analysis" }).quality > BASE.analysis);
});

test("cost and latency are in the score: dear and slow models lose ground, economy cares most about cost", () => {
  fresh();
  for (let i = 0; i < 5; i++) {
    B.observe({ provider: "p", model: "m-cheap-fast", capability: "writing", difficulty: 2, score: 8, cost: 0.0005, ms: 1500 });
    B.observe({ provider: "p", model: "m-dear-slow", capability: "writing", difficulty: 2, score: 8, cost: 0.08, ms: 45000 });
  }
  const cf = q("m-cheap-fast", "balanced", 0.01), ds = q("m-dear-slow", "balanced", 0.01);
  assert.equal(cf.quality, ds.quality, "same scores, same quality");
  assert.ok(ds.cost > 0.01 && cf.cost < 0.01, "observed cost per job pulls the estimate toward it");
  assert.equal(ds.avgCost, 0.08); assert.equal(ds.avgSec, 45);
  assert.ok(ds.latencyPenalty > 0, "slower than its registry speed loses points");
  assert.ok(cf.latencyPenalty < 0, "faster than its registry speed gains points");
  assert.ok(q("m-dear-slow", "quality").latencyPenalty < q("m-dear-slow", "balanced").latencyPenalty, "quality mode cares less about speed");
  for (const mode of ["quality", "balanced", "economy"]) {
    const w = B.bestAtWhat({ mode }).capabilities.find((c) => c.capability === "writing");
    assert.equal(w.models[0].model, "m-cheap-fast", mode);
  }
  const gap = (mode) => { const w = B.bestAtWhat({ mode }).capabilities[0].models; return w[0].score - w[1].score; };
  assert.ok(gap("economy") > gap("quality"), "economy puts more weight on price");
  // free-tier calls do not make a model look cheap for normal jobs
  B.observe({ provider: "p", model: "m-free", capability: "writing", difficulty: 2, cost: 0, ms: 1000, free: true });
  assert.equal(q("m-free").avgCost, null);
});

test("failures on the job pull a model down; successes do not", () => {
  fresh();
  for (let i = 0; i < 4; i++) {
    B.observe({ provider: "p", model: "m-flaky", capability: "writing", difficulty: 2, ok: i % 2 === 0, score: i % 2 === 0 ? 8 : null });
    B.observe({ provider: "p", model: "m-solid", capability: "writing", difficulty: 2, ok: true, score: 8 });
  }
  const f = q("m-flaky"), s = q("m-solid");
  assert.equal(f.failRate, 0.5); assert.equal(s.failRate, 0);
  assert.ok(f.quality < s.quality);
  assert.equal(B.bestAtWhat().capabilities[0].models.find((m) => m.model === "m-flaky").successRate, 0.5);
});

test("reset clears the record and the older skills table; learning off records and uses nothing", () => {
  fresh();
  store.putDoc("skills", { "m-x": { writing: { wins: 3, total: 3 } } });
  B.observe({ provider: "p", model: "m-x", capability: "writing", difficulty: 2, score: 9 });
  assert.ok(q("m-x"));
  B.saveBrainSettings({ shareOptIn: true });
  B.resetBrain();
  assert.equal(q("m-x"), null);
  assert.deepEqual(store.doc("skills", () => ({})), {});
  assert.equal(B.brain().jobs, 0); assert.ok(B.brain().resetAt);
  assert.equal(B.brainSettings().shareOptIn, true, "settings survive a reset");
  B.saveBrainSettings({ on: false });
  assert.equal(B.observe({ provider: "p", model: "m-x", capability: "writing", score: 9 }), null);
  assert.equal(B.rate({ runId: "s-9", model: "m-x", up: true }), null);
  assert.equal(B.brain().jobs, 0);
  B.saveBrainSettings({ on: true });
  B.observe({ provider: "p", model: "m-x", capability: "writing", score: 9 });
  B.saveBrainSettings({ on: false });
  assert.equal(q("m-x"), null, "off: the router ignores the record");
  B.saveBrainSettings({ on: true });
  assert.ok(q("m-x"));
});

test("only the task type and numbers are stored: extra fields, prompt text and odd ids never reach the record", () => {
  fresh();
  B.observe({ provider: "p<script>", model: "m-ok\n<b>x</b>", capability: "not-a-cap", difficulty: 9, runId: "s-1", score: 99, prompt: "ZEBRAFINCH secret prompt", text: "ZEBRAFINCH answer", key: "sk-ant-ZEBRAFINCH", email: "a@b.example", ms: 10, cost: 0.001 });
  B.rate({ runId: "s-1", model: "m-ok", up: true, note: "ZEBRAFINCH note" });
  const raw = fs.readFileSync(path.join(DIR, "brain.json"), "utf8");
  assert.doesNotMatch(raw, /ZEBRAFINCH|secret|answer|note|sk-ant|<script>|<b>|a@b/i);
  const b = JSON.parse(raw);
  for (const k of Object.keys(b)) assert.ok(["v", "since", "settings", "jobs", "stats", "runs", "resetAt"].includes(k), `top-level ${k}`);
  assert.deepEqual(Object.keys(b.settings).sort(), ["on", "shareOptIn"]);
  for (const [model, m] of Object.entries(b.stats)) {
    assert.match(model, /^[A-Za-z0-9._:/@+-]+$/);
    assert.deepEqual(Object.keys(m).sort(), ["provider", "t"]);
    for (const [k, s] of Object.entries(m.t)) {
      assert.match(k, /^(reasoning|code|writing|research|creative|analysis|math|fast):[123]$/);
      for (const v of Object.values(s)) assert.equal(typeof v, "number");
    }
  }
  assert.equal(Object.values(b.stats)[0].t["reasoning:3"].scoreSum, 10, "unknown capability is reasoning, difficulty is clamped, score capped at 10");
  for (const r of Object.values(b.runs)) assert.deepEqual(Object.keys(r).sort(), ["m", "ts"]);
  const share = B.sharePreview();
  assert.equal(share.sent, false); assert.equal(share.optedIn, false);
  assert.doesNotMatch(JSON.stringify(share), /"s-1"|"runs"|"since"|"ts"|"last"/);
  for (const r of share.rows) assert.deepEqual(Object.keys(r).sort(), ["avgScore", "avgSec", "capability", "costPerJob", "jobs", "model", "successRate", "thumbsDown", "thumbsUp", "winRate"]);
  const ex = B.exportBrain();
  assert.equal(ex.kind, "learning-router"); assert.ok(ex.stats); assert.equal(ex.runs, undefined, "export carries the record, not the run ids");
});

// ---------- the running server against mock providers ----------
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
function sse(res, chunks) {
  // One body with a length, then close the socket. Windows CI reuses a keep-alive
  // socket after a chunked stream and the next model call waits until this test gives up.
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  res.writeHead(200, { "content-type": "text/event-stream", "content-length": Buffer.byteLength(body), connection: "close" });
  res.end(body);
}
function answerFor(j) {
  const sys = j.messages.find((m) => m.role === "system")?.content || "";
  const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":2,"needWeb":false,"summary":"mock"}`;
  if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Mock plan", tasks: [{ id: "t1", title: "Draft it", capability: "writing", difficulty: 2, needWeb: false, deps: [], instructions: "Write it.", deliverable: "Draft" }, { id: "t2", title: "Check it", capability: "analysis", difficulty: 1, needWeb: false, deps: ["t1"], instructions: "Check it.", deliverable: "Notes" }], assembly: "One doc." });
  if (/strict judge/.test(sys)) { const letters = [...user.matchAll(/### Answer ([A-J])/g)].map((m) => m[1]); return JSON.stringify({ scores: Object.fromEntries(letters.map((l, i) => [l, 6 + i])), best: letters[letters.length - 1], notes: {}, disagreement: "none" }); }
  if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
  return `Answer from ${j.model}.`;
}
async function mocks() {
  const behave = { xai: "ok", groq: "ok", mistral: "ok" };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { const body = JSON.stringify(j); res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" }); res.end(body); };
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: `mock: no route ${url.pathname}` });
    const j = JSON.parse(body);
    const b = behave[prefix];
    if (b === 402) return send(402, { error: { message: "Payment required: your prepaid balance is empty." } });
    if (b === 400) return send(400, { error: { message: "messages must not be empty" } });
    return sse(res, [{ model: j.model, choices: [{ delta: { content: answerFor(j) } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 10 } }]);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, behave, close: () => new Promise((r) => srv.close(r)) };
}
const envFor = (m) => ({
  CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off",
  CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`,
  XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitRun(s, pred, label, ms = 60000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  let lastError = "";
  while (Date.now() - t0 < budget) {
    try {
      const st = (await s.api("/state")).json;
      const hit = pred(st);
      if (hit) return hit;
    } catch (e) { lastError = e?.message || String(e); }
    await sleep(250);
  }
  const trace = (s?.log || "").split("\n").filter((l) => l.includes("NETTRACE")).slice(-30).join("\n");
  throw new Error(`timed out waiting for ${label}${lastError ? `\npoll: ${lastError}` : ""}${trace ? `\n${trace}` : ""}\n--- server log tail ---\n${s.log.slice(-800)}`);
}
const finished = (kind, after) => (st) => st.missions.find((m) => m.kind === kind && m.startedAt > after && ["done", "done-with-errors", "failed"].includes(m.status));
const readBrain = (s) => JSON.parse(fs.readFileSync(path.join(s.dir, "brain.json"), "utf8"));
const statsOf = (b, model) => Object.values(b.stats[model]?.t || {}).reduce((a, x) => { for (const [k, v] of Object.entries(x)) a[k] = (a[k] || 0) + v; return a; }, {});
async function keys(s) { for (const pid of Object.keys(KEYS)) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid); }

test("server: jobs are recorded per model and task type, thumbs land, account trouble is not held against a model, a track record changes the pick and reset restores it", async () => {
  const m = await mocks();
  const s = await startServer({ env: envFor(m) });
  let s2 = null;
  try {
    assert.equal((await s.api("/brain", { noToken: true })).status, 401, "session token required");
    assert.ok((await s.api("/state")).json.plugins.includes("brain"), "the plugin is mounted");
    await keys(s);
    // free tiers off so nothing here is priced at $0
    await s.api("/fallback/settings", { method: "POST", body: { freeTiers: { google: { on: false }, openrouter: { on: false }, groq: { on: false } } } });
    let v = (await s.api("/brain")).json;
    assert.equal(v.jobs, 0); assert.deepEqual(v.capabilities, []); assert.equal(v.settings.on, true); assert.equal(v.settings.shareOptIn, true, "new setups share");
    const baseline = (await s.api("/brain/pick?capability=writing&difficulty=2&mode=balanced")).json.ranked;
    assert.ok(baseline.length >= 3);
    for (const r of baseline) assert.equal(r.learned, null, "no record yet");

    // 1. a pinned single chat: one job, with cost and speed, on the keyword task type (writing)
    let t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Write a tagline for ZEBRAFINCH bakery.", provider: "xai", model: "grok-4.3" } });
    let run = await waitRun(s, finished("single", t0 - 1), "single");
    assert.equal(run.status, "done");
    let b = readBrain(s), g = statsOf(b, "grok-4.3");
    assert.equal(g.jobs, 1); assert.equal(g.ok, 1); assert.equal(g.msN, 1); assert.equal(g.costN, 1);
    assert.ok(Object.keys(b.stats["grok-4.3"].t)[0].startsWith("writing:"));

    // 2. a council of three: each member's peer score, the winner, and the chair
    t0 = Date.now();
    const members = [{ provider: "xai", model: "grok-4.3" }, { provider: "groq", model: "openai/gpt-oss-120b" }, { provider: "mistral", model: "mistral-large-latest" }];
    await s.api("/council", { method: "POST", body: { prompt: "Write a ZEBRAFINCH launch email.", members, chair: members[0] } });
    run = await waitRun(s, finished("council", t0 - 1), "council");
    const council = (await s.api(`/missions/${run.id}`)).json;
    assert.ok(council.winner, "the council named a winner");
    b = readBrain(s);
    for (const mm of members) {
      const st = statsOf(b, mm.model);
      assert.ok(st.scoreN >= 1, `${mm.model} has a peer score`); assert.ok(st.rounds >= 1, `${mm.model} has a round`);
      assert.equal(st.wins, mm.model === council.winner ? 1 : 0, `${mm.model} wins`);
    }
    assert.ok(b.stats["grok-4.3"].t["writing:3"], "the chair's job is recorded as a hard one");
    assert.deepEqual(Object.keys(b.runs[run.id].m).sort(), members.map((x) => x.model).sort());

    // 3. thumbs: down, then changed to up, on the council's task type
    const loser = members.find((x) => x.model !== council.winner);
    assert.equal((await s.api("/ratings", { method: "POST", body: { missionId: run.id, kind: "council", provider: loser.provider, model: loser.model, capability: "creative", up: false, note: "ZEBRAFINCH was off" } })).status, 200);
    assert.equal(statsOf(readBrain(s), loser.model).down, 1);
    await s.api("/ratings", { method: "POST", body: { missionId: run.id, kind: "council", provider: loser.provider, model: loser.model, capability: "creative", up: true } });
    let st = statsOf(readBrain(s), loser.model);
    assert.equal(st.up, 1); assert.equal(st.down, 0);
    assert.ok(!Object.keys(readBrain(s).stats[loser.model].t).some((k) => k.startsWith("creative:")), "the thumb went to the run's task type");

    // 4. a mission: each task with its QA score, and the assembler
    t0 = Date.now();
    await s.api("/mission", { method: "POST", body: { goal: "Plan a ZEBRAFINCH week of posts.", mode: "balanced" } });
    run = await waitRun(s, finished("mission", t0 - 1), "mission");
    const mission = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(mission.status, "done");
    b = readBrain(s);
    for (const t of mission.tasks) assert.ok(b.stats[t.model].t[`${t.capability}:${t.difficulty}`]?.qaN >= 1, `task ${t.id} QA score recorded`);
    assert.ok(b.stats[mission.assembler.model].t["writing:3"], "assembler recorded");

    // 5. account trouble (402) is smart fallback's business: no failure for the model, the stand-in gets the job
    const before = statsOf(readBrain(s), "grok-4.3");
    m.behave.xai = 402; t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Write a short thank-you note.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "single after 402");
    assert.equal(run.status, "done");
    assert.equal(statsOf(readBrain(s), "grok-4.3").fail || 0, before.fail || 0, "402 is not held against the model");
    await s.api("/fallback/clear", { method: "POST", body: {} });
    // ...but a model that errors on the job itself is marked
    m.behave.xai = 400; t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Write a short thank-you note.", provider: "xai", model: "grok-4.3" } });
    run = await waitRun(s, finished("single", t0 - 1), "single after 400");
    assert.equal(run.status, "failed");
    assert.equal(statsOf(readBrain(s), "grok-4.3").fail, (before.fail || 0) + 1);
    m.behave.xai = "ok";

    // 6. the view: per task type, top models with the numbers and how many jobs they rest on
    v = (await s.api("/brain?mode=balanced")).json;
    const w = v.capabilities.find((c) => c.capability === "writing");
    assert.ok(w && w.models.length >= 3);
    for (const r of w.models) { assert.ok(r.jobs >= 1); for (const f of ["winRate", "avgScore", "costPerJob", "avgSec", "successRate", "up", "down", "confidence", "score"]) assert.ok(f in r, f); }
    assert.ok(v.jobs >= 8);
    const pickNow = (await s.api("/brain/pick?capability=writing&difficulty=2&mode=balanced")).json.ranked;
    assert.ok(pickNow.some((r) => r.learned && r.learned.jobs >= 1), "the router's pick now carries the record");

    // 7. nothing but task types and numbers: no prompt, note or key in the stored record
    const raw = fs.readFileSync(path.join(s.dir, "brain.json"), "utf8");
    assert.doesNotMatch(raw, /ZEBRAFINCH|tagline|launch email|thank-you/i);
    for (const k of Object.values(KEYS)) assert.ok(!raw.includes(k), "no key in the record");
    for (const k of Object.values(KEYS)) assert.ok(!s.log.includes(k), "no key in the log");

    // 8. export, share preview, learning off
    const ex = await s.api("/brain/export");
    assert.equal(ex.status, 200); assert.match(ex.headers["content-disposition"], /attachment; filename="command-ai-learning-router-/);
    assert.ok(ex.json.stats["grok-4.3"]); assert.doesNotMatch(ex.text, /ZEBRAFINCH/);
    const sp = (await s.api("/brain/share-preview")).json;
    assert.equal(sp.sent, false); assert.equal(sp.optedIn, true, "new setups share"); assert.ok(sp.rows.length >= 3);
    assert.equal((await s.api("/brain/settings", { method: "POST", body: { shareOptIn: false } })).json.settings.shareOptIn, false);
    assert.equal((await s.api("/brain/share-preview")).json.optedIn, false);
    assert.equal((await s.api("/brain/settings", { method: "POST", body: { shareOptIn: true } })).json.settings.shareOptIn, true);
    assert.equal((await s.api("/brain/share-preview")).json.sent, false, "opting in sends nothing in this build");
    await s.api("/brain/settings", { method: "POST", body: { on: false } });
    const jobsOff = readBrain(s).jobs;
    t0 = Date.now();
    await s.api("/chat", { method: "POST", body: { prompt: "Write a haiku.", provider: "xai", model: "grok-4.3" } });
    await waitRun(s, finished("single", t0 - 1), "single with learning off");
    assert.equal(readBrain(s).jobs, jobsOff, "off: nothing new recorded");
    for (const r of (await s.api("/brain/pick?capability=writing&difficulty=2")).json.ranked) assert.equal(r.learned, null, "off: picks ignore the record");
    await s.api("/brain/settings", { method: "POST", body: { on: true } });

    // 9. a simulated track record changes who the router picks: the baseline favourite does badly, the third does well
    const fav = baseline[0].model, dark = baseline[2].model;
    const stat = (o) => ({ jobs: 0, ok: 0, fail: 0, rounds: 0, wins: 0, scoreSum: 0, scoreN: 0, qaSum: 0, qaN: 0, up: 0, down: 0, cost: 0, costN: 0, ms: 0, msN: 0, last: Date.now(), ...o });
    const seeded = { v: 1, since: Date.now(), settings: { on: true, shareOptIn: false }, jobs: 24, runs: {}, stats: {
      [fav]: { provider: baseline[0].provider, t: { "writing:2": stat({ jobs: 12, ok: 9, fail: 3, rounds: 9, wins: 0, scoreSum: 36, scoreN: 9, down: 4 }) } },
      [dark]: { provider: baseline[2].provider, t: { "writing:2": stat({ jobs: 12, ok: 12, rounds: 9, wins: 9, scoreSum: 85, scoreN: 9, up: 4 }) } },
    } };
    s2 = await startServer({ env: envFor(m), seed: (dir) => fs.writeFileSync(path.join(dir, "brain.json"), JSON.stringify(seeded)) });
    await keys(s2);
    let ranked = (await s2.api("/brain/pick?capability=writing&difficulty=2&mode=balanced")).json.ranked;
    assert.equal(ranked[0].model, dark, `the record lifts ${dark} to the top`);
    const favAt = ranked.findIndex((r) => r.model === fav);
    assert.ok(favAt === -1 || favAt > 1, `the baseline favourite drops (now ${favAt === -1 ? "out of the top 6" : `#${favAt + 1}`})`);
    assert.equal(ranked[0].learned.jobs, 12);
    const view2 = (await s2.api("/brain")).json.capabilities.find((c) => c.capability === "writing");
    assert.equal(view2.models[0].model, dark); assert.equal(view2.models[0].winRate, 1); assert.equal(view2.models[1].winRate, 0);
    // reset: confirm required, then the built-in order is back
    assert.equal((await s2.api("/brain/reset", { method: "POST", body: {} })).status, 400);
    assert.equal((await s2.api("/brain/reset", { method: "POST", body: { confirm: true } })).json.jobs, 0);
    ranked = (await s2.api("/brain/pick?capability=writing&difficulty=2&mode=balanced")).json.ranked;
    assert.deepEqual(ranked.map((r) => r.model), baseline.map((r) => r.model), "after reset the router picks exactly as the registry does");
    assert.deepEqual((await s2.api("/brain")).json.capabilities, []);
  } finally {
    await s.stop(); if (s2) await s2.stop(); await m.close();
  }
});
