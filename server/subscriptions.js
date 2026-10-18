// Subscription tracker: what you pay, when it renews, how many credits are left, burn rate,
// and a plain-English keep / watch / cancel signal. Prices marked estimated until confirmed.
import { HOSTED, doc, putDoc } from "./store.js";
import { allStatus } from "./health.js";
import { summary as ledgerSummary } from "./ledger.js";

// Seeded from what the history and HQ files show is actually in use. Prices are UNKNOWN until
// Chris confirms them; listPrice is the public list price for reference only.
const SEED = [
  { id: "claude", provider: "anthropic", name: "Claude", plan: "UNKNOWN (Pro or Max)", monthly: null, listPrice: 20, renews: null, unit: "messages", credits: null, creditsTotal: null, notes: "Claude.ai + Claude Code. API usage is metered separately and tracked in the ledger.", url: "https://claude.ai/settings/billing" },
  { id: "chatgpt", provider: "openai", name: "ChatGPT", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "messages", credits: null, creditsTotal: null, notes: "Codex access seen in history.", url: "https://chatgpt.com/#settings" },
  { id: "grok", provider: "xai", name: "Grok (SuperGrok)", plan: "UNKNOWN", monthly: null, listPrice: 30, renews: null, unit: "credits", credits: null, creditsTotal: null, notes: "Grok bots run the Everborn/SCF reels; Claude Studio is the backup when Grok is out.", url: "https://grok.com" },
  { id: "kling", provider: "kling", name: "Kling AI Premier", plan: "Premier", monthly: null, listPrice: 92, renews: "2026-11-13", unit: "credits", credits: null, creditsTotal: 8000, notes: "About 8,000 credits per 31 days, shared with Grok's bots. Log every generation.", url: "https://app.klingai.com/global/membership" },
  { id: "suno", provider: "suno", name: "Suno", plan: "UNKNOWN", monthly: null, listPrice: 10, renews: null, unit: "credits", credits: null, creditsTotal: null, notes: "Jake Stien songs.", url: "https://suno.com/account" },
  { id: "flow", provider: "flow", name: "Google AI (Flow / Veo)", plan: "UNKNOWN (AI Pro or Ultra)", monthly: null, listPrice: 20, renews: null, unit: "AI credits", credits: null, creditsTotal: null, notes: "Veo 3.1 Quality ≈100 credits per clip, Nano Banana stills ≈1. Usage is in studio/credit-log.csv.", url: "https://one.google.com/ai" },
  { id: "syncso", provider: "syncso", name: "Sync.so", plan: "UNKNOWN", monthly: null, listPrice: null, renews: null, unit: "credits", credits: null, creditsTotal: null, notes: "Lip sync. Fallback: Kling lip sync.", url: "https://sync.so" },
  { id: "hedra", provider: "hedra", name: "Hedra", plan: "UNKNOWN", monthly: null, listPrice: null, renews: null, unit: "credits", credits: null, creditsTotal: null, notes: "", url: "https://www.hedra.com/app" },
  { id: "cursor", provider: "cursor", name: "Cursor", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "requests", credits: null, creditsTotal: null, notes: "", url: "https://cursor.com/settings" },
  { id: "capcut", provider: "capcut", name: "CapCut", plan: "UNKNOWN", monthly: null, listPrice: null, renews: null, unit: null, credits: null, creditsTotal: null, notes: "", url: "https://www.capcut.com" },
  { id: "ghl", provider: null, name: "GoHighLevel", plan: "UNKNOWN", monthly: null, listPrice: 97, renews: null, unit: null, credits: null, creditsTotal: null, notes: "CRM hub for SCF and clients. See hq/finance/subscriptions.csv.", url: "https://app.gohighlevel.com" },
  { id: "zapier", provider: null, name: "Zapier", plan: "UNKNOWN", monthly: null, listPrice: 20, renews: null, unit: "tasks", credits: null, creditsTotal: null, notes: "", url: "https://zapier.com/app/billing" },
  { id: "cloudflare", provider: null, name: "Cloudflare", plan: "UNKNOWN", monthly: null, listPrice: 0, renews: null, unit: null, credits: null, creditsTotal: null, notes: "Pages hosting for everbornproductions.com, capitalcitylife.com.", url: "https://dash.cloudflare.com" },
  { id: "distrokid", provider: null, name: "DistroKid", plan: "UNKNOWN (annual)", monthly: null, listPrice: 2, renews: null, unit: null, credits: null, creditsTotal: null, notes: "Music distribution for Jake Stien.", url: "https://distrokid.com" },
  { id: "1password", provider: null, name: "1Password", plan: "UNKNOWN", monthly: null, listPrice: 3, renews: null, unit: null, credits: null, creditsTotal: null, notes: "", url: "https://my.1password.com" },
];

// The seed lists the owner's own tools; a hosted user starts with the generic chat subscriptions only.
const HOSTED_SEED = SEED.filter((s) => ["claude", "chatgpt", "grok"].includes(s.id)).map((s) => ({ ...s, notes: "" }));
const subs = () => doc("subscriptions", () => structuredClone(HOSTED ? HOSTED_SEED : SEED));
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
