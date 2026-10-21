// Subscription tracker: what you pay, when it renews, how many credits are left, burn rate,
// and a plain-English keep / watch / cancel signal. Prices marked estimated until confirmed.
// Phase 25: price per billing cycle (monthly / yearly / weekly), a reminder lead time per row
// (remindDays, default 3), and where every field came from (origin: "user" | "email" | "api",
// with a confidence for auto-detected values) so the UI can label each one.
import { doc, putDoc } from "./store.js";
import { allStatus } from "./health.js";
import { summary as ledgerSummary } from "./ledger.js";
import { CYCLES, monthlyOf, addCycle, vendorOf } from "./receipts.js";

// Every new user (desktop or hosted) starts with the three generic chat subscriptions, prices
// UNKNOWN until confirmed; listPrice is the public list price for reference only. The owner's own
// tool list is not shipped with the app (import example: docs/owner-seed.example.json, not bundled).
const SEED = [
  { id: "claude", provider: "anthropic", name: "Claude", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "messages", credits: null, creditsTotal: null, notes: "", url: "https://claude.ai/settings/billing" },
  { id: "chatgpt", provider: "openai", name: "ChatGPT", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "messages", credits: null, creditsTotal: null, notes: "", url: "https://chatgpt.com/#settings" },
  { id: "grok", provider: "xai", name: "Grok", plan: "UNKNOWN", monthly: null, listPrice: 30, renews: null, unit: "credits", credits: null, creditsTotal: null, notes: "", url: "https://grok.com" },
];
export const DEFAULT_REMIND_DAYS = 3;
// fields whose origin is tracked (what the person sees labelled "you entered" or "auto-detected")
export const TRACKED = ["name", "plan", "price", "cycle", "monthly", "renews", "credits", "creditsTotal", "remindDays", "url", "notes"];
// fields the email scan fills on an auto-detected row; a hand edit to any of them sets the row's `edited` flag
export const SCANNED = ["name", "plan", "price", "cycle", "renews"];
const subs = () => doc("subscriptions", () => structuredClone(SEED));
export function loadSubscriptions() { return subs(); }
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// Clean one incoming row. Throws a 400 for values that cannot be right.
function clean(s, prev) {
  const o = { ...s };
  for (const k of ["monthly", "price", "credits", "creditsTotal", "listPrice"]) if (k in o) {
    if (o[k] === "" || o[k] == null) o[k] = null;
    else if (!Number.isFinite(Number(o[k])) || Number(o[k]) < 0) throw bad(`${k} must be a number of 0 or more`);
    else o[k] = Number(o[k]);
  }
  if ("cycle" in o) { if (o.cycle === "" || o.cycle == null) o.cycle = null; else if (!CYCLES.includes(o.cycle)) throw bad("cycle must be monthly, yearly or weekly"); }
  if ("renews" in o) { if (o.renews === "" || o.renews == null) o.renews = null; else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.renews))) throw bad("renews must be a date (YYYY-MM-DD)"); }
  if ("remindDays" in o) { if (o.remindDays === "" || o.remindDays == null) o.remindDays = null; else { const n = Number(o.remindDays); if (!Number.isInteger(n) || n < 0 || n > 60) throw bad("remind days must be a whole number from 0 to 60"); o.remindDays = n; } }
  for (const k of ["name", "plan", "notes", "url", "vendor", "currency"]) if (k in o && o[k] != null) o[k] = String(o[k]).slice(0, k === "notes" ? 500 : 200);
  if ("url" in o && o.url && !/^https?:\/\//i.test(o.url)) o.url = null;
  // price and cycle drive the monthly figure; a bare monthly (older clients, the old table) means price per month
  const cyc = o.cycle !== undefined ? o.cycle : prev?.cycle;
  if ("price" in o) o.monthly = monthlyOf(o.price, cyc || "monthly");
  else if ("cycle" in o && prev?.price != null) o.monthly = monthlyOf(prev.price, cyc || "monthly");
  else if ("monthly" in o) { o.price = o.monthly; o.cycle = "monthly"; }
  return o;
}

// meta.origin: "user" (default) | "email" | "api", or a per-field map. meta.confidence: { field: 0..1 }.
// A field whose value changes gets that origin; editing an auto-detected value turns it into "user".
// meta.autoDetected: the email scan added or refreshed this row with no confirm step (labelled
// "auto-detected"). Once the person edits a scanned field by hand the row gets `edited: true`, and
// that field (origin "user") is never overwritten by a later scan. Neither flag comes from a request body.
export function saveSubscription(s, meta = {}) {
  const list = subs();
  const i = s.id ? list.findIndex((x) => x.id === s.id) : -1;
  const prev = i >= 0 ? list[i] : null;
  if (!prev && !String(s.name || "").trim()) throw bad("name required");
  const { origin: _o, confidence: _c, autoDetected: _a, edited: _e, ...rest } = s; // origin labels and flags are never taken from the request body
  const row = clean(rest, prev);
  const origin = { ...(prev?.origin || {}) }, confidence = { ...(prev?.confidence || {}) };
  let handEdit = false;
  for (const k of TRACKED) {
    if (!(k in row)) continue;
    if (prev && JSON.stringify(prev[k] ?? null) === JSON.stringify(row[k] ?? null)) continue;
    const o = typeof meta.origin === "object" && meta.origin ? meta.origin[k] || "user" : meta.origin || "user";
    origin[k] = o;
    if (o === "user" && SCANNED.includes(k)) handEdit = true;
    if (o !== "user" && meta.confidence?.[k] != null) confidence[k] = meta.confidence[k]; else delete confidence[k];
  }
  if ("price" in row && !("monthly" in rest)) { origin.monthly = origin.price; if (confidence.price != null) confidence.monthly = confidence.price; else delete confidence.monthly; }
  if (meta.autoDetected) row.autoDetected = true;
  if (prev?.autoDetected && !meta.autoDetected && handEdit) row.edited = true;
  const now = Date.now();
  const creditsMoved = prev && "credits" in row && row.credits !== prev.credits;
  if (prev) list[i] = { ...prev, ...row, origin, confidence, updatedAt: now, ...(creditsMoved ? { creditsUpdatedAt: now } : {}) };
  else list.push({ unit: "credits", ...row, id: s.id || slug(s.name) || `sub-${now.toString(36)}`, origin, confidence, addedAt: now, updatedAt: now, ...(row.credits != null ? { creditsUpdatedAt: now } : {}) });
  putDoc("subscriptions", list);
  return prev ? list[i] : list[list.length - 1];
}
export function deleteSubscription(id) {
  return putDoc("subscriptions", subs().filter((s) => s.id !== id));
}

// The next renewal on or after today: a past date rolls forward by its billing cycle (labelled as rolled).
export function nextRenewal(s, today = new Date()) {
  if (!s.renews) return { date: null, rolled: false };
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`; // local date, like daysLeft
  let d = s.renews, rolled = false;
  if (d < t && s.cycle) { for (let n = 0; d < t && n < 600; n++) { d = addCycle(d, s.cycle); rolled = true; } }
  return { date: d, rolled };
}

// Enrich with live data: provider balance from health checks, API spend from the ledger,
// burn rate from credit history, and a keep/watch/cancel signal.
export function subscriptionView() {
  const st = allStatus();
  const led = ledgerSummary();
  const today = new Date();
  return subs().map((s) => {
    const live = s.provider ? st[s.provider] : null;
    const apiSpend = s.provider ? led.byProvider[s.provider]?.month || 0 : 0;
    const unitsMonth = s.provider ? led.byProvider[s.provider]?.unitsMonth || 0 : 0;
    let credits = s.credits, creditsTotal = s.creditsTotal, resetAt = null, creditsFrom = s.credits != null ? s.origin?.credits || "user" : null;
    if (live?.balance?.limit != null && live.balance.used != null) { credits = live.balance.limit - live.balance.used; creditsTotal = live.balance.limit; resetAt = live.balance.resetAt || null; creditsFrom = "api"; }
    else if (live?.balance?.left != null) { credits = live.balance.left; creditsFrom = "api"; }
    if (credits == null && creditsTotal != null && unitsMonth) { credits = Math.max(0, creditsTotal - unitsMonth); creditsFrom = "ledger"; }
    const remindDays = s.remindDays ?? DEFAULT_REMIND_DAYS;
    const nr = nextRenewal(s, today);
    const daysLeft = nr.date ? Math.ceil((new Date(nr.date + "T00:00:00") - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000) : null;
    const pctLeft = credits != null && creditsTotal ? Math.round((credits / creditsTotal) * 100) : null;
    const burnPerDay = unitsMonth ? +(unitsMonth / Math.max(1, today.getDate())).toFixed(1) : null;
    const runway = burnPerDay && credits != null ? Math.floor(credits / burnPerDay) : null;
    let signal = "ok", why = "";
    if (daysLeft != null && daysLeft >= 0 && daysLeft <= remindDays) { signal = "renewing"; why = daysLeft === 0 ? "renews today" : `renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`; }
    if (pctLeft != null && pctLeft <= 15) { signal = "low"; why = `${pctLeft}% of credits left`; }
    if (runway != null && daysLeft != null && runway < daysLeft) { signal = "low"; why = `at this pace credits run out in ${runway} days, before renewal`; }
    if (live?.status === "red") { signal = "attention"; why = live.detail; }
    if (s.monthly == null) why = why || "price not confirmed";
    return { ...s, vendor: vendorOf(s), cycle: s.cycle || (s.monthly != null ? "monthly" : null), price: s.price ?? s.monthly ?? null, remindDays, nextRenewal: nr.date, renewsRolled: nr.rolled, origin: s.origin || {}, confidence: s.confidence || {}, creditsFrom, live: live ? { status: live.status, detail: live.detail } : null, apiSpendMonth: +apiSpend.toFixed(2), unitsMonth, credits, creditsTotal, pctLeft, daysLeft, burnPerDay, runway, resetAt, signal, why };
  });
}
export function totals() {
  const v = subscriptionView();
  const known = v.filter((s) => s.monthly != null).reduce((a, s) => a + Number(s.monthly), 0);
  const estimated = v.filter((s) => s.monthly == null && s.listPrice != null).reduce((a, s) => a + Number(s.listPrice), 0);
  return { known: +known.toFixed(2), estimated: +estimated.toFixed(2), count: v.length, unconfirmed: v.filter((s) => s.monthly == null).length };
}
