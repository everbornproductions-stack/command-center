// Usage ledger: every model call and every manual media-credit entry, one JSON line each
// (local: data/ledger.jsonl; hosted: user_ledger rows). Entries live in the user's context.
import { ctx } from "./store.js";
import { estimateCostAt, PROVIDERS } from "./registry.js";
import { cachedCallCost } from "./savings.js";
import { emit } from "./events.js";
import { isManaged } from "./vault.js";
import { snapshotCall } from "./receipt-math.js";
import { isUsageJob, windowStart } from "../web/graph-usage.js";

// Freeze the savings receipt on the call itself (actual, baseline, difference, price-table date)
// before the line is written, so a later price change cannot rewrite it.
function withSavings(entry) {
  try { entry.savings = snapshotCall(entry); } catch { entry.savings = null; }
  return entry;
}

// Local mode reads the file through the store at startup; this just returns the loaded entries.
export function loadLedger() {
  return ctx().ledger;
}

function append(e) {
  const c = ctx();
  // managed plan (Phase 9): a call made with Everborn's pool key is tagged so it is metered (server/growth.js)
  try { if (e.provider && PROVIDERS[e.provider] && isManaged(e.provider, PROVIDERS[e.provider].keyEnv)) e.managed = true; } catch {}
  c.ledger.push(e);
  c.store.appendLedger(e);
  emit("ledger.entry", { entry: e });
  return e;
}

export function recordCall({ provider, model, usage, missionId, taskId, role, ms, estimated }) {
  // A manual handoff is not a provider call. usage.manual forces a $0 line and keeps the target name.
  const manual = usage?.manual === true;
  const exact = !manual && typeof usage.cost === "number";
  // Phase 26: a call within a free-tier allowance costs nothing; a model reached through OpenRouter
  // without an exact bill is priced as the model it stands in for (usage.priceModel)
  const free = !manual && !!usage.free;
  const cacheRead = !manual && !free && !exact ? Math.max(0, Number(usage.cacheRead) || 0) : 0;
  const cost = manual || free ? 0 : exact ? usage.cost : cacheRead > 0 ? cachedCallCost(usage.priceModel || model, usage) : estimateCostAt(usage.priceModel || model, usage.input, usage.output);
  const entry = {
    ts: Date.now(), kind: "call", provider, model, actualModel: usage.actualModel || null,
    inTok: usage.input, outTok: usage.output, cost: +cost.toFixed(6), exact: exact && !free,
    estimated: !manual && !exact && !free && (!!estimated || !!usage.estimated), missionId: missionId || null, taskId: taskId || null, role: role || null, ms: ms || null,
    free, fallback: usage.fallback || null,
  };
  if (cacheRead > 0) entry.cacheRead = cacheRead;
  if (manual) {
    entry.manual = true;
    entry.usage = { manual: true };
    entry.handoff = String(usage.handoff || model || "").slice(0, 80);
    entry.cost = 0;
  }
  return append(withSavings(entry));
}

// Manual media credit spend (Kling, Suno, Flow...). units = credits, cost = optional USD.
export function recordCredits({ provider, units, note, project, cost }) {
  return append({ ts: Date.now(), kind: "credits", provider, units: Number(units), cost: cost ? Number(cost) : null, note: note || "", project: project || null });
}

// One web search (Phase 15): provider is "search-<engine>" (or the text provider for built-in search,
// or "demo-search"). cost = the per-search price at the time; no query text is stored.
export function recordSearch({ provider, engine, results, cost, missionId, taskId, ms, role, native }) {
  return append({ ts: Date.now(), kind: "search", provider, engine: engine || null, results: Number(results) || 0, cost: +Number(cost || 0).toFixed(6), native: !!native, missionId: missionId || null, taskId: taskId || null, role: role || "search", ms: ms || null });
}

// One embedding call (Phase 18 knowledge libraries): tokens in, nothing out; cost = tokens x the library's
// price per 1M tokens, kept to 9 decimals (a short question costs well under a millionth of a dollar). `estimated` when the provider did not report the token count. No text is stored.
export function recordEmbedding({ provider, model, tokens, cost, estimated, missionId, role, ms, inputs }) {
  return append(withSavings({ ts: Date.now(), kind: "call", provider, model, actualModel: null, inTok: Number(tokens) || 0, outTok: 0, cost: +Number(cost || 0).toFixed(9), exact: false, estimated: !!estimated, missionId: missionId || null, taskId: null, role: role || "embed", ms: ms || null, free: false, manual: false, fallback: null, inputs: Number(inputs) || 0 }));
}

// One generated image (Phase 21): provider = the image provider's id, cost = the per-image price shown in
// the estimate, op = generate | edit | variation. No prompt text is stored.
export function recordImage({ provider, model, op, cost, ms, missionId, project }) {
  return append({ ts: Date.now(), kind: "image", provider, model: model || null, op: op || "generate", images: 1, cost: +Number(cost || 0).toFixed(6), missionId: missionId || null, project: project || null, role: "image", ms: ms || null });
}

// 0.4.24: the 15 s UI tick and every /api/state rebuilt this from the whole ledger on the main thread. Reuse the
// answer while the ledger has the same length and the same last entry, for up to 5 s (it also rolls over at midnight).
const summaryCache = new WeakMap();
export function summary() {
  const entries = ctx().ledger;
  const last = entries[entries.length - 1];
  const key = `${entries.length}:${last ? last.ts : 0}:${new Date().toDateString()}`;
  const hit = summaryCache.get(entries);
  if (hit && hit.key === key && Date.now() - hit.at < 5000) return hit.value;
  const value = buildSummary(entries);
  summaryCache.set(entries, { key, at: Date.now(), value });
  return value;
}
function buildSummary(entries) {
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const start30 = windowStart(now.getTime());
  const byProvider = {};
  for (const p of Object.values(PROVIDERS)) byProvider[p.id] = { month: 0, today: 0, calls: 0, calls30: 0, inTok: 0, outTok: 0, units: 0, unitsMonth: 0 };
  let month = 0, today = 0, calls = 0, searches = 0, searchMonth = 0;
  const days = {};
  // demo AI calls are pretend money: once demo mode is off they leave the totals and filters,
  // and stay visible in history tagged demo
  const isDemo = (e) => String(e.provider || "").startsWith("demo-");
  let demoCalls = 0;
  for (const e of entries) {
    if (isDemo(e) && !PROVIDERS[e.provider]) { demoCalls++; continue; }
    const b = byProvider[e.provider] || (byProvider[e.provider] = { month: 0, today: 0, calls: 0, calls30: 0, inTok: 0, outTok: 0, units: 0, unitsMonth: 0 });
    // 0.4.20: practice AIs are pretend money, so demo runs always add $0 (the app says "Nothing was spent")
    const c = isDemo(e) ? 0 : (e.cost || 0);
    if (e.kind === "call") {
      b.calls++; b.inTok += e.inTok || 0; b.outTok += e.outTok || 0;
    }
    if (e.ts >= start30 && isUsageJob(e)) b.calls30 = (b.calls30 || 0) + 1;
    if (e.kind === "credits") {
      b.units += e.units || 0;
      if (e.ts >= startMonth) b.unitsMonth += e.units || 0;
    }
    if (e.kind === "search") { b.searches = (b.searches || 0) + 1; }
    if (e.ts >= startMonth) { b.month += c; month += c; if (e.kind === "call") calls++; if (e.kind === "search") { searches++; searchMonth += c; } }
    if (e.ts >= startDay) { b.today += c; today += c; }
    const d = new Date(e.ts).toISOString().slice(0, 10);
    days[d] = (days[d] || 0) + c;
  }
  // last 30 days series
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).toISOString().slice(0, 10);
    series.push({ d, v: +(days[d] || 0).toFixed(4) });
  }
  return { month: +month.toFixed(4), today: +today.toFixed(4), calls, searches, searchMonth: +searchMonth.toFixed(4), byProvider, series, recent: entries.slice(-40).reverse().map((e) => (isDemo(e) ? { ...e, demo: true } : e)), demoCalls };
}

export const allEntries = () => ctx().ledger;
