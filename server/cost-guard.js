// Phase 59. A monthly budget for the whole account. Extreme includes it.
// Anyone else can turn it on. At 80% the strip is amber. At 100% a new paid run waits.
// Free, demo, and local runs still go through. The You saved estimate stays as it is.

import { summary, loadLedger } from "./ledger.js";
import { doc, putDoc } from "./store.js";
import { limitsFor, gate } from "./feature-gate.js";
import { PROVIDERS } from "./registry.js";
import { isLocalFree } from "./savings.js";
import { hasSecret } from "./vault.js";

const DOC = "cost.guard";

function load() {
  const saved = doc(DOC, () => ({ optedIn: false, cap: null, paused: false }));
  return {
    optedIn: !!saved?.optedIn,
    cap: saved?.cap == null ? null : Number(saved.cap),
    paused: !!saved?.paused,
  };
}

function save(next) {
  putDoc(DOC, next);
  return next;
}

function monthStart(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function savedThisMonth(now = Date.now()) {
  const start = monthStart(now);
  let saved = 0;
  for (const entry of loadLedger()) {
    if (!entry || entry.ts < start) continue;
    const n = Number(entry.savings?.saved);
    if (Number.isFinite(n) && n > 0) saved += n;
  }
  return +saved.toFixed(4);
}

export function activeCap() {
  const limits = limitsFor();
  const state = load();
  if (state.paused) return null;
  const included = limits.budgetIncluded;
  if (!included && !state.optedIn) return null;
  const settingsCap = Number(doc("settings", () => ({}))?.budgetMonthly);
  const cap = state.cap != null && state.cap > 0 ? state.cap : (settingsCap > 0 ? settingsCap : 100);
  return cap;
}

export function snapshot(now = Date.now()) {
  const cap = activeCap();
  const spent = Number(summary().month) || 0;
  const pct = cap ? Math.round((spent / cap) * 100) : 0;
  const level = cap == null ? "off" : pct >= 100 ? "stop" : pct >= 80 ? "amber" : "ok";
  return { cap, spent: +spent.toFixed(4), pct, level, saved: savedThisMonth(now) };
}

export function publicState() {
  const limits = limitsFor();
  const state = load();
  const snap = snapshot();
  let plain = "The monthly budget cap is off.";
  if (snap.level === "amber") plain = `You have used ${snap.pct}% of this month's budget. Paid runs still start.`;
  if (snap.level === "stop") plain = "This month's budget is used up. Raise the cap, or wait until next month. Free runs still work.";
  if (snap.level === "ok") plain = `This month's budget is $${snap.cap}. You have used $${snap.spent.toFixed(2)}.`;
  return {
    included: limits.budgetIncluded,
    optedIn: state.optedIn || limits.budgetIncluded,
    paused: state.paused,
    ...snap,
    savedPlain: `You saved $${snap.saved.toFixed(2)} by smart routing. Estimate.`,
    plain,
  };
}

export function saveGuard(body = {}) {
  const limits = limitsFor();
  const state = load();
  if (body.optedIn === false || body.on === false) {
    if (limits.budgetIncluded && body.on === false) {
      state.paused = true;
    } else {
      state.optedIn = false;
      state.paused = false;
    }
  }
  if (body.optedIn === true || body.on === true) {
    if (!limits.budgetIncluded) gate("budgetCap", { optedIn: true });
    state.optedIn = true;
    state.paused = false;
  }
  if (body.cap != null) {
    const cap = Number(body.cap);
    if (!Number.isFinite(cap) || cap < 0.01 || cap > 1000000) {
      const err = new Error("Type a monthly budget of at least $0.01.");
      err.status = 400;
      throw err;
    }
    if (!limits.budgetIncluded) {
      gate("budgetCap", { optedIn: true });
      state.optedIn = true;
      state.paused = false;
    }
    state.cap = +cap.toFixed(2);
  }
  save(state);
  // read the cap back so what the screen shows is what the stop really uses
  if (body.cap != null) {
    const back = load().cap;
    if (back == null || Math.abs(back - Number(state.cap)) > 1e-9) {
      const err = new Error("The budget did not save. Try again.");
      err.status = 500;
      throw err;
    }
  }
  return publicState();
}

// 0.4.21: parallel paid runs each hold a small reservation until they finish, so five chats started
// together cannot all pass a nearly used-up budget (spend is only written to the ledger when a run ends).
const RESERVE_EACH = 0.003;
const reservations = new Map();
let reserveSeq = 0;
function reservedTotal() {
  const now = Date.now();
  let sum = 0;
  for (const [k, r] of reservations) { if (r.until < now) reservations.delete(k); else sum += r.amount; }
  return sum;
}
function reserve(amount) {
  const key = ++reserveSeq;
  reservations.set(key, { amount, until: Date.now() + 120000 });
  return () => { reservations.delete(key); };
}

export function assertSpendAllowed({ provider, estimate = 0, free = false, hold = false } = {}) {
  const cap = activeCap();
  if (cap == null) return { ok: true, level: "off" };
  const id = String(provider || "");
  const meta = PROVIDERS[provider];
  const local = meta ? isLocalFree({ provider }, meta) : false;
  const demo = !!meta?.demo || id.startsWith("demo-");
  if (free || local || demo) return { ok: true, level: snapshot().level };
  const snap = snapshot();
  // With no estimate the call is still stopped once the month's budget is used up.
  const held = reservedTotal();
  const hold1 = hold ? RESERVE_EACH : 0;
  if (snap.spent >= cap || (Number(estimate) > 0 && snap.spent + Number(estimate) > cap) || (hold && snap.spent + held + hold1 > cap)) {
    const err = new Error("This month's budget is used up. Raise the cap, or wait until next month. Free runs still work.");
    err.status = 402;
    err.code = "budget_cap";
    throw err;
  }
  return { ok: true, level: snap.level, release: hold ? reserve(RESERVE_EACH) : () => {} };
}

// A practice check for the Settings button "Test my budget" (0.4.21). It asks the same question a paid call asks,
// with a typical small cost, and calls no AI and spends nothing.
export function budgetTest({ estimate = 0.006 } = {}) {
  const snap = snapshot();
  const next = +Math.max(0.0001, Number(estimate) || 0.006).toFixed(4);
  if (snap.cap == null) return { cap: null, spent: snap.spent, next, wouldStop: false, plain: `The monthly cap is off, so paid calls are not stopped by a cap. You have spent $${snap.spent.toFixed(2)} this month.` };
  let wouldStop = false;
  try { assertSpendAllowed({ provider: "openai", estimate: next }); } catch (e) { if (e.code === "budget_cap") wouldStop = true; else throw e; }
  const plain = `Your cap is $${snap.cap.toFixed(2)}, spent $${snap.spent.toFixed(2)}. The next paid call needs about $${next.toFixed(3)}, so it ${wouldStop ? "would be stopped" : "would go ahead"}. This check spent nothing.`;
  return { cap: snap.cap, spent: snap.spent, next, wouldStop, plain };
}

// 0.4.20: when the month's budget stops a paid run the person gets two local choices, never a charge.
// "plus": raise the local budget cap by a little (default $1) and run again. This only edits the
// number in this app. It does not buy anything or touch billing.
export function continuePlus(amount = 1) {
  const add = Number(amount);
  if (!Number.isFinite(add) || add <= 0 || add > 100) {
    const err = new Error("Pick an amount between $0.01 and $100.");
    err.status = 400;
    throw err;
  }
  const limits = limitsFor();
  const state = load();
  const snap = snapshot();
  const base = Math.max(Number(snap.cap) || 0, Number(snap.spent) || 0);
  state.cap = +(base + add).toFixed(2);
  state.paused = false;
  if (!limits.budgetIncluded) state.optedIn = true;
  save(state);
  return publicState();
}

// "free": the AIs that cost nothing and still run when the budget is used up (practice AIs and
// local models). The page re-sends the same words to one of them.
export function freeChoices() {
  const out = [];
  for (const p of Object.values(PROVIDERS)) {
    if (!p || p.kind !== "text") continue;
    const demo = !!p.demo || String(p.id).startsWith("demo-");
    const local = isLocalFree({ provider: p.id }, p);
    if (!demo && !local) continue;
    if (!p.noKey && !hasSecret(p.id, p.keyEnv)) continue;
    const models = Array.isArray(p.models) ? p.models : [];
    const model = (models.find((m) => m.default) || models[0])?.id;
    if (!model) continue;
    out.push({ provider: p.id, name: p.name, model, practice: demo });
  }
  // a local model first, practice AIs last
  return out.sort((a, b) => Number(a.practice) - Number(b.practice));
}

export function continueChoices() {
  const snap = snapshot();
  return { level: snap.level, spent: snap.spent, cap: snap.cap, plus: { amount: 1, newCap: +((Math.max(Number(snap.cap) || 0, snap.spent)) + 1).toFixed(2) }, free: freeChoices() };
}
