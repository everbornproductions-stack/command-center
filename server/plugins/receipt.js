// Savings receipt: for every run, what it cost versus doing all of it on the single most expensive
// available flagship. Totals on the Credits tab; shareable as an image from the browser.
import { allEntries } from "../ledger.js";
import { TEXT_PROVIDERS, estimateCost, modelPrice } from "../registry.js";
export const id = "receipt";

function flagshipPrice() {
  // the priciest text model the registry knows (the "manual way": everything on the big model), at the
  // price in use: your own, else the live OpenRouter list price (Phase 24), else the built-in one
  let best = null;
  for (const p of TEXT_PROVIDERS) for (const m of p.models) { if (m.variable) continue; const pr = modelPrice(m.id); if (!best || pr.in + pr.out > best.in + best.out) best = { ...m, in: pr.in, out: pr.out, provider: p.id, providerName: p.name }; }
  return best;
}

export function receiptFor(missionId) {
  const rows = allEntries().filter((e) => e.kind === "call" && e.missionId === missionId);
  if (!rows.length) return null;
  const fl = flagshipPrice();
  const actual = rows.reduce((a, e) => a + (e.cost || 0), 0);
  const inTok = rows.reduce((a, e) => a + (e.inTok || 0), 0), outTok = rows.reduce((a, e) => a + (e.outTok || 0), 0);
  const flagshipCost = fl ? estimateCost(fl.id, inTok, outTok) : actual;
  const byModel = {};
  for (const e of rows) { const b = (byModel[e.model] ||= { provider: e.provider, calls: 0, cost: 0, inTok: 0, outTok: 0 }); b.calls++; b.cost += e.cost || 0; b.inTok += e.inTok || 0; b.outTok += e.outTok || 0; }
  return { missionId, calls: rows.length, inTok, outTok, actual: +actual.toFixed(5), flagship: fl ? { model: fl.id, name: fl.name, provider: fl.provider } : null, flagshipCost: +flagshipCost.toFixed(5), saved: +Math.max(0, flagshipCost - actual).toFixed(5), savedPct: flagshipCost > 0 ? Math.round((1 - actual / flagshipCost) * 100) : 0, byModel, exact: rows.every((e) => e.exact), estimated: rows.some((e) => e.estimated) };
}

export function totals() {
  const rows = allEntries().filter((e) => e.kind === "call");
  const fl = flagshipPrice();
  const now = new Date(); const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let actual = 0, flag = 0, actualM = 0, flagM = 0;
  for (const e of rows) { const f = fl ? estimateCost(fl.id, e.inTok || 0, e.outTok || 0) : e.cost || 0; actual += e.cost || 0; flag += f; if (e.ts >= startMonth) { actualM += e.cost || 0; flagM += f; } }
  const runs = new Set(rows.map((e) => e.missionId).filter(Boolean)).size;
  return { flagship: fl ? fl.name : null, allTime: { actual: +actual.toFixed(4), flagship: +flag.toFixed(4), saved: +Math.max(0, flag - actual).toFixed(4) }, month: { actual: +actualM.toFixed(4), flagship: +flagM.toFixed(4), saved: +Math.max(0, flagM - actualM).toFixed(4) }, runs };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/receipt/, "");
  if (req.method === "GET" && p === "/totals") return h.json(res, 200, totals());
  if (req.method === "GET" && p.startsWith("/")) { const r = receiptFor(p.slice(1)); return r ? h.json(res, 200, r) : h.json(res, 404, { error: "no calls logged for that run" }); }
  return false;
}
