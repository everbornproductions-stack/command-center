// Pause a provider that is out of credits, at its spending limit, payment required, or rate limited.
// Health lights stay in server/health.js. This module only reads them and decides who sits out.
// A paused provider is left out of auto-picks. A health recheck for that provider waits 15 minutes.
// Saving the key again checks immediately. The provider is not shown as working while it is paused.
import { PROVIDERS } from "./registry.js";
import { getStatus, checkProvider } from "./health.js";
import { allContexts, runAs, currentUserId } from "./store.js";
import { scheduler } from "./perf/scheduler.js";

export const RECHECK_MS = 15 * 60 * 1000;
export const HEALTH_MS = 5 * 60 * 1000;
export const PAUSE_LABEL = "Paused: no credits";

const CREDIT_RE = /out of credits|spending limit|spend limit|payment required|no credits|rate limited/;
const KEY_RE = /key rejected|invalid api key|incorrect api key/;

const lastPaused = new Map();
const lastHealthy = new Map();

export function isCreditStatus(status, detail = "") {
  const d = String(detail || "").toLowerCase();
  if (!CREDIT_RE.test(d) || KEY_RE.test(d)) return false;
  return status === "amber" || status === "red";
}

function stampKey(id) {
  return `${currentUserId() || "local"}:${id}`;
}

export function describePause(id) {
  const st = getStatus(id);
  if (!isCreditStatus(st?.status, st?.detail)) return null;
  const p = PROVIDERS[id];
  const name = p?.name || id;
  const billing = p?.links?.billing || null;
  const detail = String(st.detail || "");
  const d = detail.toLowerCase();
  const rate = /rate limited/.test(d) && !/credit|spending limit|payment required|no credits/.test(d);
  const message = billing
    ? `${name} is paused: no credits. Add credits to use it. Billing: ${billing}`
    : `${name} is paused: no credits. Add credits to use it.`;
  return { provider: id, label: PAUSE_LABEL, billing, detail, rate, message };
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

export function noteKeySaved(id) {
  const key = stampKey(id);
  lastPaused.delete(key);
  lastHealthy.delete(key);
}

export function stampAfterCheck(id) {
  const key = stampKey(id);
  if (describePause(id)) lastPaused.set(key, Date.now());
  else {
    lastPaused.delete(key);
    lastHealthy.set(key, Date.now());
  }
}

export async function checkRespectingPause() {
  const now = Date.now();
  for (const id of Object.keys(PROVIDERS)) {
    const key = stampKey(id);
    if (describePause(id)) {
      const prev = lastPaused.get(key) || 0;
      if (prev && now - prev < RECHECK_MS) continue;
      await checkProvider(id);
      if (describePause(id)) lastPaused.set(key, now);
      else lastPaused.delete(key);
    } else {
      const prev = lastHealthy.get(key) || 0;
      if (prev && now - prev < HEALTH_MS) continue;
      await checkProvider(id);
      lastHealthy.set(key, now);
      if (describePause(id)) lastPaused.set(key, now);
    }
  }
}

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
