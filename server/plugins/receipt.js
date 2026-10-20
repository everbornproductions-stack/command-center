// Savings receipt: each run stores what it cost, what the same tokens would have cost on the
// reference model, the difference, and the date of the price table. Old totals stay put when
// prices change. The reference model defaults to the most expensive flagship with a key.
import { allEntries } from "../ledger.js";
import { ctx } from "../store.js";
import { listProjects } from "../projects.js";
import {
  ESTIMATE_LABEL, describeModel, referenceModel, referenceView, savingsOf, setReferenceModel,
} from "../receipt-math.js";

export const id = "receipt";
export { ESTIMATE_LABEL, referenceModel, referenceView, setReferenceModel } from "../receipt-math.js";
export { BUILTIN_PRICE_DATE } from "../receipt-math.js";

const round = (n) => Math.round((Number(n) || 0) * 1e9) / 1e9;
const show5 = (n) => +round(n).toFixed(5);
const show4 = (n) => +round(n).toFixed(4);

function bounds() {
  const now = new Date();
  return {
    startMonth: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    startDay: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
  };
}

function calls() {
  const rows = [];
  allEntries().forEach((e, i) => { if (e.kind === "call") rows.push({ e, i, s: savingsOf(e, i) }); });
  return rows;
}

export function receiptFor(missionId) {
  const rows = calls().filter((r) => r.e.missionId === missionId);
  if (!rows.length) return null;
  const actual = rows.reduce((a, r) => a + (r.s.actual || 0), 0);
  const baseline = rows.reduce((a, r) => a + (r.s.baseline || 0), 0);
  const saved = rows.reduce((a, r) => a + (r.s.saved || 0), 0);
  const inTok = rows.reduce((a, r) => a + (r.e.inTok || 0), 0);
  const outTok = rows.reduce((a, r) => a + (r.e.outTok || 0), 0);
  const refId = [...rows].reverse().find((r) => r.s.reference)?.s.reference || referenceModel()?.id || null;
  const fl = describeModel(refId);
  const dates = [...new Set(rows.map((r) => r.s.priceAsOf).filter(Boolean))];
  const byModel = {};
  let manual = 0, free = 0;
  for (const r of rows) {
    if (r.s.manual || r.e.manual) manual++;
    if (r.s.free || r.e.free) free++;
    const b = (byModel[r.e.model] ||= { provider: r.e.provider, calls: 0, cost: 0, inTok: 0, outTok: 0, manual: 0, free: 0 });
    b.calls++;
    b.cost += r.s.actual || 0;
    b.inTok += r.e.inTok || 0;
    b.outTok += r.e.outTok || 0;
    if (r.s.manual || r.e.manual) b.manual++;
    if (r.s.free || r.e.free) b.free++;
  }
  for (const b of Object.values(byModel)) b.cost = show5(b.cost);
  const flagshipCost = show5(baseline);
  const actualShow = show5(actual);
  const savedShow = show5(saved);
  return {
    missionId, calls: rows.length, inTok, outTok,
    actual: actualShow,
    baseline: flagshipCost,
    difference: savedShow,
    priceAsOf: dates.join(", "),
    label: ESTIMATE_LABEL,
    flagship: fl ? { model: fl.model, name: fl.name, provider: fl.provider } : null,
    flagshipCost,
    saved: savedShow,
    savedPct: flagshipCost > 0 ? Math.round((1 - actualShow / flagshipCost) * 100) : 0,
    byModel,
    exact: rows.every((r) => r.e.exact),
    estimated: rows.some((r) => r.e.estimated),
    manual, free,
  };
}

function add(bucket, s) {
  bucket.actual += s.actual || 0;
  bucket.baseline += s.baseline || 0;
  bucket.saved += s.saved || 0;
}
function finish(b) {
  const actual = show4(b.actual), baseline = show4(b.baseline), saved = show4(b.saved);
  return { actual, baseline, flagship: baseline, saved };
}

async function projectIdOf(missionId, cache) {
  if (!missionId) return null;
  if (cache.has(missionId)) return cache.get(missionId);
  let pid = null;
  try { pid = (await ctx().store.getMission(missionId))?.projectId || null; } catch { pid = null; }
  cache.set(missionId, pid);
  return pid;
}

export async function totals() {
  const rows = calls();
  const { startMonth, startDay } = bounds();
  const day = { actual: 0, baseline: 0, saved: 0 };
  const month = { actual: 0, baseline: 0, saved: 0 };
  const allTime = { actual: 0, baseline: 0, saved: 0 };
  const byProvider = new Map();
  const byProject = new Map();
  const projects = (() => { try { return listProjects(); } catch { return []; } })();
  const projectName = (id) => (id ? projects.find((p) => p.id === id)?.name || id : "No project");
  const cache = new Map();
  let manualCalls = 0, freeCalls = 0, freeSaved = 0;
  for (const r of rows) {
    add(allTime, r.s);
    if ((r.e.ts || 0) >= startMonth) add(month, r.s);
    if ((r.e.ts || 0) >= startDay) add(day, r.s);
    const isManual = !!(r.s.manual || r.e.manual);
    const isFree = !!(r.s.free || r.e.free);
    if (isManual) manualCalls++;
    if (isFree) { freeCalls++; freeSaved += r.s.saved || 0; }
    const pk = r.e.provider || "unknown";
    const pb = byProvider.get(pk) || { provider: pk, actual: 0, baseline: 0, saved: 0, calls: 0, manual: 0, free: 0 };
    add(pb, r.s); pb.calls++; if (isManual) pb.manual++; if (isFree) pb.free++;
    byProvider.set(pk, pb);
    const proj = await projectIdOf(r.e.missionId, cache);
    const key = proj || "";
    const jb = byProject.get(key) || { projectId: proj, name: projectName(proj), actual: 0, baseline: 0, saved: 0, calls: 0, manual: 0, free: 0 };
    add(jb, r.s); jb.calls++; if (isManual) jb.manual++; if (isFree) jb.free++;
    byProject.set(key, jb);
  }
  const ref = referenceModel();
  const runs = new Set(rows.map((r) => r.e.missionId).filter(Boolean)).size;
  const group = (b) => ({ ...b, ...finish(b) });
  return {
    label: ESTIMATE_LABEL,
    flagship: ref?.name || null,
    reference: ref ? { model: ref.id, name: ref.name, provider: ref.provider, auto: !!ref.auto, priceAsOf: ref.priceAsOf } : null,
    priceAsOf: ref?.priceAsOf || null,
    allTime: finish(allTime),
    month: finish(month),
    day: finish(day),
    runs,
    byProvider: [...byProvider.values()].map(group).sort((a, b) => b.saved - a.saved || a.provider.localeCompare(b.provider)),
    byProject: [...byProject.values()].map(group).sort((a, b) => b.saved - a.saved || String(a.name).localeCompare(String(b.name))),
    manual: { calls: manualCalls, actual: 0 },
    free: { calls: freeCalls, actual: 0, saved: show4(freeSaved) },
  };
}

export function recent(limit = 10) {
  const last = new Map();
  for (const e of allEntries()) if (e.kind === "call" && e.missionId) last.set(e.missionId, Math.max(last.get(e.missionId) || 0, e.ts || 0));
  return [...last.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([rid, ts]) => ({ ...receiptFor(rid), ts }));
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/receipt/, "");
  if (req.method === "GET" && p === "/totals") return h.json(res, 200, await totals());
  if (req.method === "GET" && p === "/recent") return h.json(res, 200, recent(Math.min(50, Number(url.searchParams.get("limit")) || 10)));
  if (req.method === "GET" && p === "/reference") return h.json(res, 200, referenceView());
  if (req.method === "POST" && p === "/reference") {
    try { setReferenceModel(body?.model); return h.json(res, 200, referenceView()); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message }); }
  }
  if (req.method === "GET" && p.startsWith("/")) {
    const r = receiptFor(decodeURIComponent(p.slice(1)));
    return r ? h.json(res, 200, r) : h.json(res, 404, { error: "no calls logged for that run" });
  }
  return false;
}
