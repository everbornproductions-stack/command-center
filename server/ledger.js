// Usage ledger: every model call and every manual media-credit entry, one JSON line each
// (local: data/ledger.jsonl; hosted: user_ledger rows). Entries live in the user's context.
import { ctx } from "./store.js";
import { estimateCostAt, PROVIDERS } from "./registry.js";
import { emit } from "./events.js";

// Local mode reads the file through the store at startup; this just returns the loaded entries.
export function loadLedger() {
  return ctx().ledger;
}

function append(e) {
  const c = ctx();
  c.ledger.push(e);
  c.store.appendLedger(e);
  emit("ledger.entry", { entry: e });
  return e;
}

export function recordCall({ provider, model, usage, missionId, taskId, role, ms, estimated }) {
  const exact = typeof usage.cost === "number";
  // Phase 26: a call within a free-tier allowance costs nothing; a model reached through OpenRouter
  // without an exact bill is priced as the model it stands in for (usage.priceModel)
  const free = !!usage.free;
  const cost = free ? 0 : exact ? usage.cost : estimateCostAt(usage.priceModel || model, usage.input, usage.output);
  return append({
    ts: Date.now(), kind: "call", provider, model, actualModel: usage.actualModel || null,
    inTok: usage.input, outTok: usage.output, cost: +cost.toFixed(6), exact: exact && !free,
    estimated: !exact && !free && (!!estimated || !!usage.estimated), missionId: missionId || null, taskId: taskId || null, role: role || null, ms: ms || null,
    free, fallback: usage.fallback || null,
  });
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
  return append({ ts: Date.now(), kind: "call", provider, model, actualModel: null, inTok: Number(tokens) || 0, outTok: 0, cost: +Number(cost || 0).toFixed(9), exact: false, estimated: !!estimated, missionId: missionId || null, taskId: null, role: role || "embed", ms: ms || null, free: false, fallback: null, inputs: Number(inputs) || 0 });
}

// One generated image (Phase 21): provider = the image provider's id, cost = the per-image price shown in
// the estimate, op = generate | edit | variation. No prompt text is stored.
export function recordImage({ provider, model, op, cost, ms, missionId, project }) {
  return append({ ts: Date.now(), kind: "image", provider, model: model || null, op: op || "generate", images: 1, cost: +Number(cost || 0).toFixed(6), missionId: missionId || null, project: project || null, role: "image", ms: ms || null });
}

export function summary() {
  const entries = ctx().ledger;
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const byProvider = {};
  for (const p of Object.values(PROVIDERS)) byProvider[p.id] = { month: 0, today: 0, calls: 0, inTok: 0, outTok: 0, units: 0, unitsMonth: 0 };
  let month = 0, today = 0, calls = 0, searches = 0, searchMonth = 0;
  const days = {};
  // demo AI calls are pretend money: once demo mode is off they leave the totals and filters,
  // and stay visible in history tagged demo
  const isDemo = (e) => String(e.provider || "").startsWith("demo-");
  let demoCalls = 0;
  for (const e of entries) {
    if (isDemo(e) && !PROVIDERS[e.provider]) { demoCalls++; continue; }
    const b = byProvider[e.provider] || (byProvider[e.provider] = { month: 0, today: 0, calls: 0, inTok: 0, outTok: 0, units: 0, unitsMonth: 0 });
    const c = e.cost || 0;
    if (e.kind === "call") {
      b.calls++; b.inTok += e.inTok || 0; b.outTok += e.outTok || 0;
    }
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
