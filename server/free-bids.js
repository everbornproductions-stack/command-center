// 0.4.22 free-first bidding. Every connected AI bids on a step. Free AIs bid first: the best-rated free AI that still
// has room wins. A paid AI wins only when no free AI is ready, every free one failed or is out of its daily limit, or
// the best free one rates clearly worse for this kind of step. The result says why in plain words.
// Also here: the parallel split (independent steps go to different free AIs at the same time) and the "saved versus
// paid" sum. Nothing here calls an AI or spends money.
import { PROVIDERS } from "./registry.js";
import { doc } from "./store.js";
import { rank } from "./router.js";
import { isFreeModel, isLocalProvider } from "./free-first.js";
import { trouble } from "./fallback.js";
import { limitLeft } from "./free-limits.js";
import { snapshotCall } from "./receipt-math.js";

// A paid AI beats the best free one only when it rates this many points higher (of 5) for the step's kind.
export const QUALITY_GAP = 1.5;
export const DEFAULT_PARALLEL = 3;
export const DEFAULT_TOKENS = { in: 1500, out: 800 };

// Freebuff and Qwen are not API providers. Another worker wires the real "ready" check; until then they say not ready.
const hooks = { freebuff: { ready: () => false, quality: () => 3 }, qwen: { ready: () => false, quality: () => 3 } };
export function setFreeBuffHooks(h = {}) { Object.assign(hooks.freebuff, h); }
export function setQwenHooks(h = {}) { Object.assign(hooks.qwen, h); }
const NAMES = { freebuff: "Freebuff", qwen: "Qwen" };

export function bidSettings() {
  let s = {};
  try { s = doc("settings", () => ({})) || {}; } catch { s = {}; }
  const n = Math.floor(Number(s.freeParallel));
  return { on: s.freeBidsFirst !== false, parallel: n >= 1 && n <= 8 ? n : DEFAULT_PARALLEL };
}

const nameOf = (id) => PROVIDERS[id]?.name || NAMES[id] || id;
const outOf5 = (q) => +(Math.max(0, Math.min(100, Number(q) || 0)) / 20).toFixed(2);

export function isFreeBidder(row) {
  if (!row) return false;
  if (row.free || row.localFree) return true;
  if (isLocalProvider(row.provider) || isFreeModel(row.provider, row.model)) return true;
  return /:free$/.test(String(row.model || "")); // OpenRouter free models, Qwen among them
}

// One bid per connected AI. `candidates` are router rows ({ provider, model, quality 0-100 from the learned
// ratings, estCost, free, learned.avgSec }); with none given the router is asked. `failed` lists AI ids that already
// failed this step. Freebuff and Qwen bid too when their hooks say ready.
export function collectBids({ step = {}, candidates = null, now = Date.now(), failed = [] } = {}) {
  const rows = Array.isArray(candidates) ? candidates : safeRank(step);
  const failedSet = new Set([...(step.failed || []), ...failed]);
  const bids = rows.filter(Boolean).map((r) => {
    const id = r.provider || r.id;
    const free = isFreeBidder(r);
    const left = free ? limitLeft(id, { now }) : Infinity;
    let down = null; // a trouble mark made by the daily limit is "out of limit", not a failure
    try { down = left > 0 ? trouble(id) : null; } catch { down = null; }
    return {
      id, model: r.model || null, name: r.providerName || nameOf(id), free,
      estCost: free ? 0 : Number(r.estCost) || 0,
      estSeconds: Number(r.learned?.avgSec) || Math.round(60 / Math.max(10, Number(r.caps?.fast ?? r.baseCaps?.fast) || 60) * 10),
      quality: r.quality5 ?? outOf5(r.quality),
      limitLeft: left,
      failed: failedSet.has(id) || !!down,
      runnable: r.runnable ?? !!PROVIDERS[id],
    };
  });
  for (const id of Object.keys(hooks)) {
    if (bids.some((b) => b.id === id)) continue;
    let ready = false;
    try { ready = !!hooks[id].ready(); } catch { ready = false; }
    if (!ready) continue;
    bids.push({ id, model: id, name: NAMES[id], free: true, estCost: 0, estSeconds: 20, quality: Number(hooks[id].quality?.()) || 3, limitLeft: limitLeft(id, { now }), failed: failedSet.has(id), runnable: !!PROVIDERS[id] });
  }
  return bids;
}
function safeRank(step) {
  try { return rank({ capability: step.capability || "reasoning", difficulty: Number(step.difficulty) || 2, mode: step.mode || "balanced", needWeb: !!step.needWeb }); } catch { return []; }
}

const hasRoom = (b) => b.free && !b.failed && b.limitLeft > 0;
const bestBy = (list) => [...list].sort((a, b) => b.quality - a.quality || b.limitLeft - a.limitLeft || a.estSeconds - b.estSeconds)[0] || null;
const bestPaid = (list) => [...list].sort((a, b) => b.quality - a.quality || a.estCost - b.estCost)[0] || null;

// Pick the winner. Returns { winner, free, why }.
export function pickWinner(bids, { gap = QUALITY_GAP, kind = "", freeFirst = true } = {}) {
  const all = (bids || []).filter(Boolean);
  const free = all.filter((b) => b.free), paid = all.filter((b) => !b.free && !b.failed);
  const room = free.filter(hasRoom);
  const topFree = bestBy(room), topPaid = bestPaid(paid);
  const done = (w, why) => ({ winner: w, free: !!w?.free, why });
  if (!freeFirst) {
    const any = bestBy(all.filter((b) => !b.failed && (!b.free || b.limitLeft > 0)));
    return done(any, any ? "Free AIs bid first is off, so the best-rated AI was chosen." : "No AI is ready.");
  }
  if (topFree) {
    const lead = topPaid ? topPaid.quality - topFree.quality : 0;
    if (!topPaid || lead < gap) return done(topFree, "Chose a free AI: it had room and rated well");
    const forKind = kind ? ` for ${kind}` : "";
    return done(topPaid, `Chose a paid AI: the best free AI rated clearly lower${forKind} (${topFree.quality} of 5 against ${topPaid.quality} of 5)`);
  }
  if (!topPaid) return done(null, "No AI is ready.");
  let why;
  if (!free.length) why = "Chose a paid AI: no free AI was ready";
  else if (free.every((b) => b.failed)) why = "Chose a paid AI: every free AI had a problem on this step";
  else if (free.every((b) => b.failed || b.limitLeft <= 0)) why = "Chose a paid AI: every free AI was out of its daily limit";
  else why = "Chose a paid AI: no free AI was ready";
  return done(topPaid, why);
}

// ---------- the parallel split ----------
// Pure: give each independent step its own free AI. `bidsFor(step)` returns the bids for a step. At most `limit`
// steps get a free AI in one go, and no AI is given two steps. Steps with no free winner are left alone.
export function planSplit(steps, { bidsFor, limit = DEFAULT_PARALLEL, gap = QUALITY_GAP } = {}) {
  const list = (steps || []).filter(Boolean);
  if (list.length < 2 || typeof bidsFor !== "function") return [];
  const taken = new Set(), out = [];
  for (const s of list) {
    if (out.length >= limit) break;
    const bids = bidsFor(s).filter((b) => !taken.has(b.id) && (b.runnable !== false));
    const w = pickWinner(bids, { gap, kind: s.capability });
    if (!w.winner || !w.winner.free) continue; // a paid or missing winner is the mission's own choice to make
    taken.add(w.winner.id);
    out.push({ id: s.id, provider: w.winner.id, model: w.winner.model, name: w.winner.name, why: w.why });
  }
  return out;
}

// The small hook mission.js calls once per wave: independent steps (the wave) get different free AIs.
// A wave of one step, or "Free AIs bid first" off, changes nothing. Returns what it changed.
export function splitWave(wave, { rankFn = null, mode = "balanced", needsWeb = () => false, now = Date.now(), settings = bidSettings() } = {}) {
  const steps = (wave || []).filter((t) => t && !t.agent && !t.media && !t.app && !t.save && !t.run && !t.workaround && t.status !== "failed");
  if (!settings.on || steps.length < 2) return [];
  const bidsFor = (t) => collectBids({ step: t, now, candidates: rankFn ? rankFn({ capability: t.capability || "reasoning", difficulty: Number(t.difficulty) || 2, mode, needWeb: needsWeb(t) }) : null });
  const plan = planSplit(steps, { bidsFor, limit: settings.parallel });
  const changed = [];
  for (const a of plan) {
    const t = steps.find((x) => x.id === a.id);
    if (!t || (t.provider === a.provider && t.model === a.model)) { if (t) t.bidWhy = a.why; continue; }
    t.provider = a.provider; t.model = a.model; t.estCost = 0; t.bidWhy = a.why; t.agentName = `${a.name} · ${t.capability}`;
    changed.push(a);
  }
  return changed;
}

// Layers of steps by dependency: every step in a layer is independent of the others in it.
export function layers(steps) {
  const left = [...steps], done = new Set(), out = [];
  while (left.length) {
    const wave = left.filter((s) => (s.deps || []).every((d) => done.has(d) || !steps.some((x) => x.id === d)));
    if (!wave.length) { out.push([...left]); break; } // a cycle: run the rest as one layer, as the mission does
    out.push(wave);
    for (const s of wave) { done.add(s.id); left.splice(left.indexOf(s), 1); }
  }
  return out;
}

// Run a step list: layers in order, and inside a layer up to `limit` steps at once, each on a different free AI.
// `run(step, assignment)` does the work. Strictly sequential steps (each depends on the one before) run one by one.
export async function runSplit(steps, run, { bidsFor, limit = DEFAULT_PARALLEL } = {}) {
  const results = new Map();
  for (const layer of layers(steps)) {
    const plan = layer.length > 1 ? planSplit(layer, { bidsFor, limit }) : [];
    const by = new Map(plan.map((a) => [a.id, a]));
    let next = 0;
    const lanes = Math.max(1, Math.min(limit, layer.length));
    await Promise.all(Array.from({ length: lanes }, async () => {
      while (next < layer.length) {
        const s = layer[next++];
        results.set(s.id, await run(s, by.get(s.id) || null));
      }
    }));
  }
  return results;
}

// ---------- saved versus paid ----------
// What a paid AI would have cost for the same work, from the app's own price table (the reference model in
// receipt-math). Always an estimate, so the words say "about".
export function paidEstimate(step = {}) {
  const inTok = Number(step.inTok) || DEFAULT_TOKENS.in, outTok = Number(step.outTok) || DEFAULT_TOKENS.out;
  try { return +snapshotCall({ free: true, inTok, outTok }).baseline || 0; } catch { return 0; }
}
export function savedVersusPaid(steps) {
  const free = (steps || []).filter((s) => s && s.free);
  const usd = +free.reduce((a, s) => a + (Number(s.paidEst) >= 0 && s.paidEst != null ? Number(s.paidEst) : paidEstimate(s)), 0).toFixed(4);
  return { usd, steps: free.length, text: savedText(usd) };
}
export function savedText(usd) {
  const v = Number(usd) || 0;
  if (!(v > 0)) return "";
  return `Saved about ${v < 0.01 ? "less than 1 cent" : `$${v.toFixed(2)}`} versus paid AIs`;
}

// Tag the step rows the result card shows: free or not, which AI, and what a paid AI would have cost.
export function decorateSteps(tasks, rows) {
  return (rows || []).map((r) => {
    const t = (tasks || []).find((x) => x.id === r.id) || {};
    const free = !(Number(r.cost) > 0) && (!!t.work?.free || isFreeBidder({ provider: t.provider, model: t.model }) || /^\$0 \((free|this PC):/.test(r.costText || ""));
    return { ...r, free, freeAi: free ? r.ai : null, paidEst: free ? paidEstimate({ inTok: t.work?.inTok, outTok: t.work?.outTok }) : 0, bidWhy: t.bidWhy || null };
  });
}
