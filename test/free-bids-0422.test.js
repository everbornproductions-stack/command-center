// 0.4.22 free AIs bid first: bids and winner, the daily limit tracker, the parallel split, saved versus paid, the labels.
// Fake rows and fake runners only. No key, no network, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-freebids-");
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(process.env.CC_DATA_DIR)));
const B = await import("../server/free-bids.js");
const L = await import("../server/free-limits.js");
const FB = await import("../server/fallback.js");
const UI = await import("../web/features/free-bids-ui.js");

const NOON = new Date(2026, 9, 26, 12, 0, 0).getTime();
const row = (provider, quality, extra = {}) => ({ provider, providerName: provider, model: `${provider}-m`, quality, estCost: 0.01, ...extra });
const free = (provider, quality, extra = {}) => row(provider, quality, { free: true, estCost: 0, runnable: true, ...extra });
const wait = async (cond, ms = 20000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };

test("a free AI with room wins over a paid one", () => {
  const bids = B.collectBids({ now: NOON, candidates: [row("anthropic", 90), free("groq", 80), free("local", 70)] });
  assert.equal(bids.find((b) => b.id === "groq").free, true);
  assert.equal(bids.find((b) => b.id === "anthropic").free, false);
  assert.equal(bids.find((b) => b.id === "groq").quality, 4);
  const w = B.pickWinner(bids);
  assert.equal(w.winner.id, "groq");
  assert.equal(w.free, true);
  assert.match(w.why, /^Chose a free AI: it had room and rated well/);
});

test("a paid AI wins when no free AI is ready", () => {
  const w = B.pickWinner(B.collectBids({ now: NOON, candidates: [row("anthropic", 90)] }));
  assert.equal(w.winner.id, "anthropic");
  assert.match(w.why, /^Chose a paid AI: no free AI was ready/);
});

test("a paid AI wins when every free AI failed", () => {
  const bids = B.collectBids({ now: NOON, candidates: [row("anthropic", 90), free("groq", 80), free("google", 75)], failed: ["groq", "google"] });
  const w = B.pickWinner(bids);
  assert.equal(w.winner.id, "anthropic");
  assert.match(w.why, /every free AI had a problem/);
});

test("a paid AI wins when every free AI is out of its daily limit", () => {
  L.markOut("groq", "test", { now: NOON });
  const bids = B.collectBids({ now: NOON, candidates: [row("anthropic", 90), free("groq", 80)] });
  assert.equal(bids.find((b) => b.id === "groq").limitLeft, 0);
  const w = B.pickWinner(bids);
  assert.equal(w.winner.id, "anthropic");
  assert.match(w.why, /every free AI was out of its daily limit/);
});

test("a paid AI wins when the best free AI is clearly worse, and says so", () => {
  const bids = B.collectBids({ now: NOON, candidates: [row("anthropic", 95), free("google", 60)] });
  assert.equal(95 / 20 - 60 / 20 >= B.QUALITY_GAP, true);
  const w = B.pickWinner(bids, { kind: "code" });
  assert.equal(w.winner.id, "anthropic");
  assert.match(w.why, /rated clearly lower for code/);
  // just under the gap, the free AI still wins
  const close = B.pickWinner(B.collectBids({ now: NOON, candidates: [row("anthropic", 90), free("google", 62)] }));
  assert.equal(close.winner.id, "google");
});

test("Freebuff counts as a free bidder only when its hook says ready", () => {
  const cands = () => [row("anthropic", 70)];
  assert.equal(B.collectBids({ now: NOON, candidates: cands() }).some((b) => b.id === "freebuff"), false);
  B.setFreeBuffHooks({ ready: () => true, quality: () => 4.5 });
  try {
    const bids = B.collectBids({ now: NOON, candidates: cands() });
    const fb = bids.find((b) => b.id === "freebuff");
    assert.equal(fb.free, true);
    assert.equal(B.pickWinner(bids).winner.id, "freebuff");
  } finally { B.setFreeBuffHooks({ ready: () => false, quality: () => 3 }); }
});

test("the limit tracker marks an AI out on a 429 and resets the next day", () => {
  const t0 = new Date(2026, 9, 27, 9, 0, 0).getTime();
  assert.equal(L.limitLeft("openrouter", { now: t0 }), 50);
  L.noteUse("openrouter", { now: t0, count: 5 });
  assert.equal(L.limitLeft("openrouter", { now: t0 }), 45);
  assert.equal(L.noteReply("openrouter", { status: 200, text: "fine" }, { now: t0 }), false);
  // 0.4.23 (audit X8): a plain 429 benches for about 15 minutes; "quota" words bench until the next day
  assert.equal(L.noteReply("openrouter", { status: 429, text: "" }, { now: t0 }), true);
  assert.equal(L.limitLeft("openrouter", { now: t0 }), 0);
  assert.equal(L.limitLeft("openrouter", { now: t0 + 16 * 60 * 1000 }), 45, "back after about 15 minutes");
  assert.equal(L.noteReply("openrouter", { status: 429, text: "You exceeded your current quota" }, { now: t0 }), true);
  assert.equal(L.limitLeft("openrouter", { now: t0 + 16 * 60 * 1000 }), 0);
  assert.equal(L.limitLeft("openrouter", { now: new Date(2026, 9, 27, 23, 59, 0).getTime() }), 0);
  const view = L.limitsView({ now: t0 }).find((v) => v.id === "openrouter");
  assert.equal(view.out, true);
  assert.match(view.reason, /daily limit/);
  // next local day: used and out are cleared
  const next = new Date(2026, 9, 28, 0, 1, 0).getTime();
  assert.equal(L.limitLeft("openrouter", { now: next }), 50);
  assert.equal(L.limitsView({ now: next }).find((v) => v.id === "openrouter").used, 0);
});

test("quota and daily limit words mark an AI out; a paid AI is left to the trouble table", () => {
  const t = new Date(2026, 9, 29, 8, 0, 0).getTime();
  assert.equal(L.noteReply("groq", { status: 400, text: "You exceeded your current quota" }, { now: t }), true);
  assert.equal(L.limitLeft("groq", { now: t }), 0);
  assert.equal(L.noteReply("google", { status: 403, text: "Daily limit reached" }, { now: t }), true);
  assert.equal(L.noteReply("anthropic", { status: 429, text: "" }, { now: t }), false);
});

test("when one free AI runs out the next free bid wins with no paid AI", () => {
  const t = new Date(2026, 9, 30, 8, 0, 0).getTime();
  for (const p of ["groq", "google", "openrouter"]) FB.clearTrouble(p); // earlier tests marked them
  L.markOut("groq", "daily limit", { now: t });
  const w = B.pickWinner(B.collectBids({ now: t, candidates: [free("groq", 90), free("google", 70), row("anthropic", 92)] }));
  assert.equal(w.winner.id, "google");
  assert.equal(w.free, true);
});

test("the split gives independent steps different free AIs, capped at the limit", () => {
  const steps = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, capability: "writing", deps: [] }));
  const bidsFor = () => B.collectBids({ now: NOON, candidates: [free("local-a", 80), free("local-b", 78), free("local-c", 76), free("local-d", 74), row("anthropic", 85)] });
  const plan = B.planSplit(steps, { bidsFor, limit: 3 });
  assert.equal(plan.length, 3);
  assert.equal(new Set(plan.map((a) => a.provider)).size, 3);
  assert.deepEqual(B.planSplit([steps[0]], { bidsFor, limit: 3 }), []);
});

test("runSplit runs independent steps at the same time and sequential steps in order", async () => {
  const bidsFor = () => B.collectBids({ now: NOON, candidates: [free("a", 80), free("b", 78), free("c", 76)] });
  // independent: all three start before any finishes
  const gates = {}; const started = []; let active = 0, peak = 0; const used = [];
  const run = (s, a) => new Promise((resolve) => { started.push(s.id); used.push(a?.provider); active++; peak = Math.max(peak, active); gates[s.id] = () => { active--; resolve(s.id); }; });
  const steps = [{ id: "i1", deps: [] }, { id: "i2", deps: [] }, { id: "i3", deps: [] }];
  const done = B.runSplit(steps, run, { bidsFor, limit: 3 });
  await wait(() => started.length === 3);
  assert.equal(peak, 3);
  assert.equal(new Set(used).size, 3);
  for (const id of ["i1", "i2", "i3"]) gates[id]();
  assert.equal((await done).size, 3);

  // strictly sequential: one at a time, in order, no AI assignment
  const order = []; let live = 0, top = 0;
  const seq = async (s, a) => { live++; top = Math.max(top, live); order.push(`start ${s.id}${a ? " split" : ""}`); await new Promise((r) => setTimeout(r, 5)); order.push(`end ${s.id}`); live--; return s.id; };
  await B.runSplit([{ id: "s1", deps: [] }, { id: "s2", deps: ["s1"] }, { id: "s3", deps: ["s2"] }], seq, { bidsFor, limit: 3 });
  assert.equal(top, 1);
  assert.deepEqual(order, ["start s1", "end s1", "start s2", "end s2", "start s3", "end s3"]);

  // mixed: s4 waits for its dependency, the two roots run together
  const log = [];
  const mixed = async (s) => { log.push(`start ${s.id}`); await new Promise((r) => setTimeout(r, 5)); log.push(`end ${s.id}`); };
  await B.runSplit([{ id: "r1", deps: [] }, { id: "r2", deps: [] }, { id: "r3", deps: ["r1", "r2"] }], mixed, { bidsFor, limit: 3 });
  assert.ok(log.indexOf("start r3") > log.indexOf("end r1") && log.indexOf("start r3") > log.indexOf("end r2"));
  assert.ok(log.indexOf("start r2") < log.indexOf("end r1"));
});

test("splitWave changes a wave of independent steps, and leaves one step and a switched-off setting alone", () => {
  const rankFn = () => [free("local-a", 80, { model: "ma" }), free("local-b", 78, { model: "mb" }), row("anthropic", 85, { model: "mc" })];
  const mk = () => [1, 2].map((n) => ({ id: `t${n}`, capability: "writing", status: "queued", provider: "anthropic", model: "mc", deps: [] }));
  const wave = mk();
  const changed = B.splitWave(wave, { rankFn, settings: { on: true, parallel: 3 } });
  assert.equal(changed.length, 2);
  assert.notEqual(wave[0].provider, wave[1].provider);
  assert.ok(wave.every((t) => t.provider.startsWith("local-")));
  assert.match(wave[0].bidWhy, /free AI/);
  const one = mk().slice(0, 1);
  assert.deepEqual(B.splitWave(one, { rankFn, settings: { on: true, parallel: 3 } }), []);
  assert.equal(one[0].provider, "anthropic");
  const off = mk();
  assert.deepEqual(B.splitWave(off, { rankFn, settings: { on: false, parallel: 3 } }), []);
  assert.equal(off[0].provider, "anthropic");
});

test("Free AIs bid first is on by default and the parallel count defaults to 3", () => {
  const s = B.bidSettings();
  assert.equal(s.on, true);
  assert.equal(s.parallel, 3);
});

test("saved versus paid adds up what a paid AI would have cost, and says about", () => {
  const steps = [{ id: "a", free: true, paidEst: 0.05 }, { id: "b", free: false, paidEst: 0.9 }, { id: "c", free: true, paidEst: 0.0725 }];
  const s = B.savedVersusPaid(steps);
  assert.equal(s.usd, 0.1225);
  assert.equal(s.steps, 2);
  assert.equal(s.text, "Saved about $0.12 versus paid AIs");
  assert.equal(B.savedVersusPaid([{ free: false }]).text, "");
  assert.ok(B.paidEstimate({ inTok: 1000, outTok: 1000 }) >= 0);
  const rows = B.decorateSteps([{ id: "a", provider: "local-a", model: "m", work: { free: true } }, { id: "b", provider: "anthropic", model: "claude-sonnet-5-5" }], [{ id: "a", ai: "Local A", cost: 0, costText: "$0 (free: Local A)" }, { id: "b", ai: "Claude", cost: 0.04, costText: "$0.04 (Claude)" }]);
  assert.equal(rows[0].free, true);
  assert.equal(rows[0].freeAi, "Local A");
  assert.equal(rows[1].free, false);
});

test("the Free label and the saved header read in plain words", () => {
  assert.equal(UI.freeLabel({ free: true, ai: "Groq" }), "Free: Groq");
  assert.equal(UI.freeLabel({ free: true }), "Free");
  assert.equal(UI.freeLabel({ free: false, ai: "Claude" }), "");
  assert.equal(UI.savedHeader([{ free: true, paidEst: 0.1 }, { free: true, paidEst: 0.05 }, { free: false, paidEst: 1 }]), "Saved about $0.15 versus paid AIs");
  assert.equal(UI.savedHeader([{ free: true, paidEst: 0.001 }]), "Saved about less than 1 cent versus paid AIs");
  assert.equal(UI.savedHeader([]), "");
  assert.match(UI.stepBadgeHtml({ free: true, ai: "Groq" }), />Free: Groq</);
  assert.equal(UI.limitLine({ name: "Groq free tier", used: 120, left: 880, limit: 1000, out: false }), "Groq free tier: 120 used, 880 left today");
  assert.match(UI.limitLine({ name: "Groq free tier", out: true, reason: "hit its daily limit (429)" }), /out for today/);
  for (const t of [UI.limitLine({ name: "X", out: true, reason: "r" }), B.pickWinner([]).why]) assert.doesNotMatch(t, /[–—]/);
});
