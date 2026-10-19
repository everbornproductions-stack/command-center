// Subscription tracker: what you pay, when it renews, how many credits are left, burn rate,
// and a plain-English keep / watch / cancel signal. Prices marked estimated until confirmed.
import { doc, putDoc } from "./store.js";
import { allStatus } from "./health.js";
import { summary as ledgerSummary } from "./ledger.js";

// Every new user (desktop or hosted) starts with the three generic chat subscriptions, prices
// UNKNOWN until confirmed; listPrice is the public list price for reference only. The owner's own
// tool list is not shipped with the app (import example: docs/owner-seed.example.json, not bundled).
const SEED = [
  { id: "claude", provider: "anthropic", name: "Claude", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "messages", credits: null, creditsTotal: null, notes: "", url: "https://claude.ai/settings/billing" },
  { id: "chatgpt", provider: "openai", name: "ChatGPT", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "messages", credits: null, creditsTotal: null, notes: "", url: "https://chatgpt.com/#settings" },
  { id: "grok", provider: "xai", name: "Grok", plan: "UNKNOWN", monthly: null, listPrice: 30, renews: null, unit: "credits", credits: null, creditsTotal: null, notes: "", url: "https://grok.com" },
];
const subs = () => doc("subscriptions", () => structuredClone(SEED));
export function loadSubscriptions() { return subs(); }
export function saveSubscription(s) {
  const list = subs();
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = { ...list[i], ...s, updatedAt: Date.now() };
  else list.push({ ...s, id: s.id || s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), updatedAt: Date.now() });
  return putDoc("subscriptions", list);
}
export function deleteSubscription(id) {
  return putDoc("subscriptions", subs().filter((s) => s.id !== id));
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
    let credits = s.credits, creditsTotal = s.creditsTotal, resetAt = null;
    if (live?.balance?.limit != null && live.balance.used != null) { credits = live.balance.limit - live.balance.used; creditsTotal = live.balance.limit; resetAt = live.balance.resetAt || null; }
    else if (live?.balance?.left != null) { credits = live.balance.left; }
    if (credits == null && creditsTotal != null && unitsMonth) credits = Math.max(0, creditsTotal - unitsMonth);
    const daysLeft = s.renews ? Math.ceil((new Date(s.renews) - today) / 86400000) : null;
    const pctLeft = credits != null && creditsTotal ? Math.round((credits / creditsTotal) * 100) : null;
    const burnPerDay = unitsMonth ? +(unitsMonth / Math.max(1, today.getDate())).toFixed(1) : null;
    const runway = burnPerDay && credits != null ? Math.floor(credits / burnPerDay) : null;
    let signal = "ok", why = "";
    if (daysLeft != null && daysLeft <= 3) { signal = "renewing"; why = `renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`; }
    if (pctLeft != null && pctLeft <= 15) { signal = "low"; why = `${pctLeft}% of credits left`; }
    if (runway != null && daysLeft != null && runway < daysLeft) { signal = "low"; why = `at this pace credits run out in ${runway} days, before renewal`; }
    if (live?.status === "red") { signal = "attention"; why = live.detail; }
    if (s.monthly == null) why = why || "price not confirmed";
    return { ...s, live: live ? { status: live.status, detail: live.detail } : null, apiSpendMonth: +apiSpend.toFixed(2), unitsMonth, credits, creditsTotal, pctLeft, daysLeft, burnPerDay, runway, resetAt, signal, why };
  });
}
export function totals() {
  const v = subscriptionView();
  const known = v.filter((s) => s.monthly != null).reduce((a, s) => a + Number(s.monthly), 0);
  const estimated = v.filter((s) => s.monthly == null && s.listPrice != null).reduce((a, s) => a + Number(s.listPrice), 0);
  return { known: +known.toFixed(2), estimated: +estimated.toFixed(2), count: v.length, unconfirmed: v.filter((s) => s.monthly == null).length };
}
