// Money saved: price one ledger call against the reference model and freeze the numbers.
// The dollars and the price-table date are stored on the call, so a later price change
// does not move old totals. List prices only (no time-of-day discount).
import { TEXT_PROVIDERS, estimateCost, findModel, modelPrice, priceSource, providerOfModel } from "./registry.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc } from "./store.js";
import { view as livePricingView } from "./live-pricing.js";

export const ESTIMATE_LABEL = "Estimated, based on token counts and list prices.";
// The built-in table in server/registry.js has no fetch date. Runs priced from it keep this day.
export const BUILTIN_PRICE_DATE = "2026-10-18";
const SETTINGS = "receipt.settings";
const FROZEN = "receipt.frozen";

const round = (n) => Math.round((Number(n) || 0) * 1e9) / 1e9;

function candidates() {
  const out = [];
  for (const p of TEXT_PROVIDERS) {
    if (!p || p.kind !== "text") continue;
    let keyed = false;
    try { keyed = !!hasSecret(p.id, p.keyEnv); } catch { keyed = false; }
    for (const m of p.models || []) {
      if (!m || m.variable) continue;
      const pr = modelPrice(m.id);
      out.push({
        id: m.id, name: m.name, tier: m.tier || "", provider: p.id, providerName: p.name,
        in: pr.in, out: pr.out, keyed, flagship: m.tier === "flagship",
      });
    }
  }
  return out;
}

// The most expensive flagship the user has a key for. With no key at all, the most expensive flagship
// in the registry, so a receipt still has a baseline (demo mode with no real keys uses the demo flagship).
export function defaultReference() {
  const flagships = candidates().filter((m) => m.flagship);
  const pool = flagships.some((m) => m.keyed) ? flagships.filter((m) => m.keyed) : flagships;
  pool.sort((a, b) => (b.in + b.out) - (a.in + a.out) || a.id.localeCompare(b.id));
  return pool[0] || null;
}

function referenceChoice() {
  try {
    const d = doc(SETTINGS, () => ({ model: null }));
    return d?.model ? String(d.model) : null;
  } catch { return null; }
}

export function priceTableDate(modelId) {
  let source = "built-in";
  try { if (modelId) source = priceSource(modelId); } catch { source = "built-in"; }
  if (source === "live") {
    try {
      const at = livePricingView().fetchedAt;
      if (at) return { priceAsOf: new Date(at).toISOString().slice(0, 10), priceSource: "live" };
    } catch { /* keep the built-in day */ }
  }
  if (source === "override") return { priceAsOf: new Date().toISOString().slice(0, 10), priceSource: "override" };
  return { priceAsOf: BUILTIN_PRICE_DATE, priceSource: "built-in" };
}

export function referenceModel() {
  const chosen = referenceChoice();
  const list = candidates();
  const hit = chosen ? list.find((m) => m.id === chosen) : null;
  const picked = hit || defaultReference();
  if (!picked) return null;
  return { ...picked, auto: !hit, ...priceTableDate(picked.id) };
}

export function setReferenceModel(modelId) {
  const id = modelId == null ? "" : String(modelId);
  if (!id || id === "auto") {
    putDoc(SETTINGS, { model: null });
    return referenceModel();
  }
  const m = findModel(id);
  if (!m || m.variable) {
    const err = new Error("Pick a model from the list.");
    err.status = 400;
    throw err;
  }
  putDoc(SETTINGS, { model: m.id });
  return referenceModel();
}

export function referenceView() {
  const raw = referenceModel();
  const current = raw ? { ...raw, model: raw.id } : null;
  const choices = candidates().sort((a, b) => (b.flagship - a.flagship) || (b.in + b.out) - (a.in + a.out) || a.name.localeCompare(b.name));
  return { label: ESTIMATE_LABEL, current, choices };
}

export function describeModel(id) {
  if (!id) return null;
  const m = findModel(id);
  const p = providerOfModel(id);
  if (!m) return { model: id, name: id, provider: p?.id || null };
  return { model: m.id, name: m.name, provider: p?.id || null };
}

// Freeze one call. Manual relay rows are $0 (they are not an API bill). Free rows cost $0 and keep
// the reference-model baseline, so the free allowance still counts as money saved.
export function snapshotCall(entry) {
  const ref = referenceModel();
  const table = ref ? { priceAsOf: ref.priceAsOf, priceSource: ref.priceSource } : priceTableDate(null);
  const reference = ref?.id || null;
  const rates = ref ? { in: ref.in, out: ref.out } : null;
  if (entry?.manual) {
    return { actual: 0, baseline: 0, saved: 0, difference: 0, priceAsOf: table.priceAsOf, priceSource: table.priceSource, reference, rates, manual: true, free: false };
  }
  const actual = entry?.free ? 0 : round(entry?.cost || 0);
  const baseline = ref ? round(estimateCost(ref.id, entry?.inTok || 0, entry?.outTok || 0)) : actual;
  const saved = round(Math.max(0, baseline - actual));
  return { actual, baseline, saved, difference: saved, priceAsOf: table.priceAsOf, priceSource: table.priceSource, reference, rates, manual: false, free: !!entry?.free };
}

export function lineKey(entry, index) {
  return [entry?.ts, index, entry?.missionId || "", entry?.provider || "", entry?.model || "", entry?.role || "", entry?.inTok || 0, entry?.outTok || 0].join("|");
}

// A call written before snapshots existed is frozen on first read, then left alone.
export function savingsOf(entry, index) {
  const s = entry?.savings;
  if (s && Number.isFinite(Number(s.actual)) && Number.isFinite(Number(s.baseline)) && Number.isFinite(Number(s.saved))) return s;
  const key = lineKey(entry, index);
  const bag = doc(FROZEN, () => ({ lines: {} }));
  if (!bag.lines) bag.lines = {};
  if (bag.lines[key]) return bag.lines[key];
  const snap = snapshotCall(entry);
  bag.lines[key] = snap;
  putDoc(FROZEN, bag);
  return snap;
}
