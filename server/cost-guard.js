// Phase 59. A monthly budget for the whole account. Extreme includes it.
// Anyone else can turn it on. At 80% the strip is amber. At 100% a new paid run waits.
// Free, demo, and local runs still go through. The You saved estimate stays as it is.

import { summary, loadLedger } from "./ledger.js";
import { doc, putDoc } from "./store.js";
import { limitsFor, gate } from "./feature-gate.js";
import { PROVIDERS } from "./registry.js";
import { isLocalFree } from "./savings.js";

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
    if (!Number.isFinite(cap) || cap <= 0 || cap > 1000000) {
      const err = new Error("Type a monthly budget above zero.");
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
  return publicState();
}

export function assertSpendAllowed({ provider, estimate = 0, free = false } = {}) {
  const cap = activeCap();
  if (cap == null) return { ok: true, level: "off" };
  const id = String(provider || "");
  const meta = PROVIDERS[provider];
  const local = meta ? isLocalFree({ provider }, meta) : false;
  const demo = !!meta?.demo || id.startsWith("demo-");
  if (free || local || demo || !(Number(estimate) > 0)) return { ok: true, level: snapshot().level };
  const snap = snapshot();
  if (snap.spent >= cap || snap.spent + Number(estimate) > cap) {
    const err = new Error("This month's budget is used up. Raise the cap, or wait until next month. Free runs still work.");
    err.status = 402;
    err.code = "budget_cap";
    throw err;
  }
  return { ok: true, level: snap.level };
}
