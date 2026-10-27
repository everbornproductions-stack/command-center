// Pause a provider that is out of credits, at its spending limit, payment required, or rate limited.
// Health lights stay in server/health.js. This module only reads them and decides who sits out.
// A paused AI is left out of routing and shows red "Out of credits". It comes back on its own:
//  1. a live balance (OpenRouter credits, DeepSeek, xAI prepaid) above zero, no completion call at all;
//  2. a tracked balance (server/credit-tracker.js) raised after the failure;
//  3. a plain rate limit: after its short window (retry-after, else about a minute);
//  4. an AI with a free route (OpenRouter free, Gemini free tier, Groq free): a 1 token probe on the free model;
//  5. every other AI: only the free models-list key check. It stays red until a real call works or the person
//     presses "Check again" (one 1 token test).
// Automatic rechecks wait 5 min, 15 min, 1 h, then hourly. A saved key, a raised tracked balance or
// "Check again" start over at once. Nothing here ever makes a billable call on its own.
import { PROVIDERS } from "./registry.js";
import { getStatus, checkProvider, clearRealFailure, markRecovered, probeCompletion, FREE_PROBE } from "./health.js";
import { getSecret } from "./vault.js";
import { checkLive, ADAPTERS } from "./provider-balance.js";
import { trackedRaw, trackedView } from "./credit-tracker.js";
import { allEntries } from "./ledger.js";
import { bus } from "./events.js";
import { allContexts, runAs, currentUserId, getContext } from "./store.js";
import { scheduler } from "./perf/scheduler.js";

export const BACKOFF_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
// kept for older callers: the second step of the backoff
export const RECHECK_MS = BACKOFF_MS[1];
export const HEALTH_MS = 5 * 60 * 1000;
export const RATE_PAUSE_MS = 60 * 1000;
export const PAUSE_LABEL = "Out of credits";
export const RATE_LABEL = "Rate limited";
export const CHECK_AGAIN_TITLE = "A one word test. If you have no credits it costs nothing.";

const CREDIT_RE = /out of credits|spending limit|spend limit|payment required|no credits|rate limited|rate or quota limit/;
const KEY_RE = /key rejected|invalid api key|incorrect api key/;

// 5 min, 15 min, 1 h, then every hour
export const backoffMs = (step) => BACKOFF_MS[Math.min(Math.max(0, step | 0), BACKOFF_MS.length - 1)];

// Midnight in Pacific time after `now`: when the Gemini free tier daily quota starts over.
export function nextPacificMidnight(now = Date.now()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const since = (t) => { const q = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return ((+q.hour * 60 + +q.minute) * 60 + +q.second) * 1000 + (t % 1000); };
  let t = now - since(now) + 24 * 3600 * 1000;
  for (let i = 0; i < 2; i++) { const s = since(t); if (s === 0) break; t += s >= 12 * 3600 * 1000 ? 24 * 3600 * 1000 - s : -s; }
  return t;
}
// Free tiers with a known reset time: the next recheck is never later than the reset.
const RESETS = { google: nextPacificMidnight };

const sched = new Map(); // user:provider -> { step, nextAt }
const lastHealthy = new Map();

export function isCreditStatus(status, detail = "") {
  const d = String(detail || "").toLowerCase();
  if (!CREDIT_RE.test(d) || KEY_RE.test(d)) return false;
  return status === "amber" || status === "red";
}

function stampKey(id) {
  return `${currentUserId() || "local"}:${id}`;
}

const isRate = (detail) => /rate limited|rate or quota limit/.test(String(detail || "").toLowerCase()) && !/credit|spending limit|payment required|no credits/i.test(String(detail || ""));
const pauseSince = (st, now) => st?.realFailAt || st?.checkedAt || now;

function firstDue(id, st, step, base, now) {
  if (isRate(st.detail)) return base + (Number(st.retryAfterMs) > 0 ? st.retryAfterMs : RATE_PAUSE_MS);
  let at = base + backoffMs(step);
  const reset = RESETS[id]?.(base);
  if (reset && reset > now - 1 && reset < at) at = reset;
  return at;
}
function entryFor(id, st, now, create = true) {
  const key = stampKey(id);
  let e = sched.get(key);
  if (!e) {
    e = { step: 0, nextAt: firstDue(id, st, 0, pauseSince(st, now), now) };
    if (create) sched.set(key, e);
  }
  return e;
}
function bump(id, now, { restart = false } = {}) {
  const st = getStatus(id);
  const e = sched.get(stampKey(id));
  const step = restart ? 0 : (e?.step ?? -1) + 1;
  sched.set(stampKey(id), { step, nextAt: firstDue(id, st, step, now, now) });
}

export function checkAgainText(ms) {
  if (ms <= 30 * 1000) return "Checks again soon";
  if (ms < 90 * 1000) return "Checks again in 1 min";
  if (ms < 59.5 * 60 * 1000) return `Checks again in ${Math.round(ms / 60000)} min`;
  const h = Math.round(ms / 3600000);
  return `Checks again in ${h} ${h === 1 ? "hour" : "hours"}`;
}

export function describePause(id, now = Date.now()) {
  const st = getStatus(id);
  if (!isCreditStatus(st?.status, st?.detail)) return null;
  const p = PROVIDERS[id];
  const name = p?.name || id;
  const billing = p?.links?.billing || null;
  const detail = String(st.detail || "");
  const rate = isRate(detail);
  const message = billing
    ? `${name} is paused: no credits. Add credits to use it. Billing: ${billing}`
    : `${name} is paused: no credits. Add credits to use it.`;
  const nextCheckAt = entryFor(id, st, now, false).nextAt;
  return { provider: id, label: rate ? RATE_LABEL : PAUSE_LABEL, kind: rate ? "rate" : "credits", billing, detail, rate, message, nextCheckAt, nextCheckText: checkAgainText(nextCheckAt - now) };
}

// "$3.20 left", "Tracked: $5.00 left", "Free tier, resets at midnight Pacific": what is known about credits, or null.
export function creditLine(id) {
  const money = (n) => `$${Number(n).toFixed(2)}`;
  const st = getStatus(id);
  const b = st?.balance;
  if (b && b.left != null && !b.noCredits) return { text: `${b.unit === "USD" || !b.unit ? money(b.left) : `${b.left} ${b.unit}`} left`, source: "live" };
  if (b?.noCredits) return { text: "No credits bought", source: "live" };
  let t = null;
  try { t = trackedView(id, { entries: allEntries() }); } catch { t = null; }
  if (t) return { text: `Tracked: ${money(t.value)} left`, source: "tracked" };
  if (RESETS[id] && getSecret(id, PROVIDERS[id]?.keyEnv)) return { text: "Free tier, resets at midnight Pacific", source: "free", resetAt: RESETS[id](Date.now()) };
  return null;
}

export function pauseNotice(hop) {
  if (!hop) return null;
  const id = hop.from?.provider;
  const info = id ? describePause(id) : null;
  const name = hop.from?.name || (id && PROVIDERS[id]?.name) || "That AI";
  const billing = info?.billing || (id && PROVIDERS[id]?.links?.billing) || null;
  return {
    kind: "paused",
    provider: id || null,
    billing,
    text: info?.message || (billing ? `${name} is paused: no credits. Add credits to use it. Billing: ${billing}` : `${name} is paused: no credits. Add credits to use it.`),
  };
}

// A saved (or removed) key starts the backoff over; the key route then checks the provider at once.
export function noteKeySaved(id) {
  clearRealFailure(id);
  const key = stampKey(id);
  sched.delete(key);
  lastHealthy.delete(key);
}

export function stampAfterCheck(id) {
  const key = stampKey(id);
  if (describePause(id)) entryFor(id, getStatus(id), Date.now());
  else {
    sched.delete(key);
    lastHealthy.set(key, Date.now());
  }
}

// The live balance, only where the provider has a balance adapter we can read with a saved key.
// { left } or null when unknown (no adapter, no key, an error).
async function readBalance(id) {
  const A = ADAPTERS[id];
  if (!A) return null;
  try {
    const { liveSecret } = await import("./services.js");
    const secret = liveSecret(id);
    if (!secret?.key) return null;
    const r = await checkLive(id, secret);
    if (r.noCredits) return { left: 0 };
    if (r.creditsLeft == null || !Number.isFinite(Number(r.creditsLeft))) return null;
    return { left: Number(r.creditsLeft), unit: r.creditsUnit || "USD" };
  } catch { return null; }
}

// One recheck of a paused AI. Returns { recovered, via, paused, nextCheckAt }.
// byUser: the person pressed "Check again" (may send one 1 token test). Otherwise nothing billable is sent.
export async function recheckProvider(id, { byUser = false, now = Date.now() } = {}) {
  const p = PROVIDERS[id];
  if (!p || p.kind !== "text") return { recovered: false, paused: false, via: null };
  const before = describePause(id, now);
  if (!before && !byUser) return { recovered: false, paused: false, via: null };
  const st = getStatus(id);
  const since = pauseSince(st, now);
  const good = (via, detail) => { markRecovered(id, detail); sched.delete(stampKey(id)); return { recovered: true, paused: false, via }; };

  // 1. a live balance
  const bal = await readBalance(id);
  if (bal) {
    if (bal.left > 0) return good("balance", `${bal.unit === "USD" ? `$${bal.left.toFixed(2)}` : `${bal.left} ${bal.unit}`} left`);
  } else {
    // 2. a tracked balance raised after the failure
    const tr = trackedRaw(id);
    if (tr && tr.amount != null && tr.sourceAt > since) { // strictly after: a balance typed in the same ms as the failure is an old one
      let v = null;
      try { v = trackedView(id, { entries: allEntries(), now }); } catch { v = null; }
      if (v && v.value > 0) return good("tracked", `Tracked: $${v.value.toFixed(2)} left`);
    }
    // 3. a plain rate limit whose window has passed
    if (before?.rate && !byUser && now >= entryFor(id, st, now).nextAt) return good("rate", "ok");
    // 4. a free route: a 1 token probe on a free model can not cost money
    if (getSecret(id, p.keyEnv)) {
      if (FREE_PROBE[id]) {
        const pr = await probeCompletion(p, null, { free: true, maxTokens: 1 });
        if (pr.ok) return good("probe", "ok");
      } else if (byUser) {
        // the person's own click: one 1 token test through the normal check
        await checkProvider(id, { auto: false });
        if (!describePause(id) && getStatus(id).status === "green") { sched.delete(stampKey(id)); return { recovered: true, paused: false, via: "check" }; }
      } else {
        // 5. paid only: see that the key still works, send nothing
        await checkProvider(id, { auto: true, keyOnly: true });
      }
    }
  }
  bump(id, now, { restart: byUser });
  const e = sched.get(stampKey(id));
  return { recovered: false, paused: !!describePause(id, now), via: null, nextCheckAt: e?.nextAt ?? null };
}

export async function checkRespectingPause({ now = Date.now() } = {}) {
  for (const id of Object.keys(PROVIDERS)) {
    const key = stampKey(id);
    if (describePause(id, now)) {
      if (now < entryFor(id, getStatus(id), now).nextAt) continue;
      await recheckProvider(id, { now });
    } else {
      sched.delete(key);
      const prev = lastHealthy.get(key) || 0;
      if (prev && now - prev < HEALTH_MS) continue;
      await checkProvider(id, { auto: true });
      lastHealthy.set(key, now);
      if (describePause(id, now)) entryFor(id, getStatus(id), now);
    }
  }
}

// A tracked balance that was just raised: look at the paused AI at once.
bus.on("event", (ev) => {
  if (ev.type !== "credits.raised" || !PROVIDERS[ev.provider]) return;
  const c = getContext(ev.user);
  if (!c) return;
  runAs(c, () => { if (describePause(ev.provider)) recheckProvider(ev.provider).catch(() => {}); });
});

export function startCreditHealthLoop() {
  const tick = () => {
    for (const c of allContexts()) runAs(c, () => checkRespectingPause().catch(() => {}));
  };
  tick();
  scheduler.register({
    id: "credits",
    everyMs: 60 * 1000,
    lightEveryMs: 5 * 60 * 1000,
    pause: true,
    run: tick,
  });
}
