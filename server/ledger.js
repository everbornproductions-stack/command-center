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
  const cost = exact ? usage.cost : estimateCostAt(model, usage.input, usage.output);
  return append({
    ts: Date.now(), kind: "call", provider, model, actualModel: usage.actualModel || null,
    inTok: usage.input, outTok: usage.output, cost: +cost.toFixed(6), exact,
    estimated: !exact && (!!estimated || !!usage.estimated), missionId: missionId || null, taskId: taskId || null, role: role || null, ms: ms || null,
  });
}

// Manual media credit spend (Kling, Suno, Flow...). units = credits, cost = optional USD.
export function recordCredits({ provider, units, note, project, cost }) {
  return append({ ts: Date.now(), kind: "credits", provider, units: Number(units), cost: cost ? Number(cost) : null, note: note || "", project: project || null });
}

export function summary() {
  const entries = ctx().ledger;
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const byProvider = {};
  for (const p of Object.values(PROVIDERS)) byProvider[p.id] = { month: 0, today: 0, calls: 0, inTok: 0, outTok: 0, units: 0, unitsMonth: 0 };
  let month = 0, today = 0, calls = 0;
  const days = {};
  for (const e of entries) {
    const b = byProvider[e.provider] || (byProvider[e.provider] = { month: 0, today: 0, calls: 0, inTok: 0, outTok: 0, units: 0, unitsMonth: 0 });
    const c = e.cost || 0;
    if (e.kind === "call") {
      b.calls++; b.inTok += e.inTok || 0; b.outTok += e.outTok || 0;
    }
    if (e.kind === "credits") {
      b.units += e.units || 0;
      if (e.ts >= startMonth) b.unitsMonth += e.units || 0;
    }
    if (e.ts >= startMonth) { b.month += c; month += c; if (e.kind === "call") calls++; }
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
  return { month: +month.toFixed(4), today: +today.toFixed(4), calls, byProvider, series, recent: entries.slice(-40).reverse() };
}

export const allEntries = () => ctx().ledger;
