// Research limits. This is not billing and it does not call Square.
// Free: live web search, with a daily limit.
// Pro and Studio: Pro search, and Deep Research up to a monthly limit.
// Extreme and Owner: Deep Research with no monthly limit.
// A packaged build ignores the CC_RESEARCH_* test overrides.
import { licenseState, monthStartUtc } from "./license.js";
import { ctx } from "./store.js";

export const FREE_DAILY_SEARCHES = 20;
export const PRO_DEEP_PER_MONTH = 30;

const EXTREME = new Set(["extreme", "owner"]);
const PRO = new Set(["pro", "studio", "extreme", "owner"]);

export function activeTier() {
  if (process.env.CC_PACKAGED !== "1") {
    const t = String(process.env.CC_RESEARCH_TIER || "");
    if (["free", "pro", "studio", "extreme", "owner"].includes(t)) return t;
  }
  return licenseState().tier || "free";
}

function envNumber(name) {
  if (process.env.CC_PACKAGED === "1") return null;
  const raw = process.env[name];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function researchPlan(tier = activeTier()) {
  const extreme = EXTREME.has(tier);
  const pro = PRO.has(tier);
  return {
    tier,
    label: extreme ? (tier === "owner" ? "Owner" : "Extreme") : tier === "studio" ? "Studio" : pro ? "Pro" : "Free",
    webSearch: true,
    dailySearches: pro ? null : (envNumber("CC_RESEARCH_FREE_DAILY") ?? FREE_DAILY_SEARCHES),
    proSearch: pro,
    deepResearch: pro,
    deepMonthly: extreme ? null : pro ? (envNumber("CC_RESEARCH_DEEP_MONTHLY") ?? PRO_DEEP_PER_MONTH) : 0,
    extreme,
  };
}

const dayStartUtc = (now) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export function searchesToday(now = Date.now()) {
  const start = dayStartUtc(now);
  return (ctx().ledger || []).filter((e) => e.kind === "search" && e.engine !== "demo" && e.provider !== "demo-search" && Number(e.ts) >= start).length;
}

export function deepUsedThisMonth(now = Date.now()) {
  const since = monthStartUtc(now);
  try {
    return ctx().store.listMissions((m) => m).filter((m) => m && m.kind === "research" && Number(m.startedAt) >= since).length;
  } catch {
    return 0;
  }
}

export function researchSnapshot(now = Date.now()) {
  const plan = researchPlan();
  const usedToday = searchesToday(now);
  const deepUsed = deepUsedThisMonth(now);
  return {
    ...plan,
    usedToday,
    leftToday: plan.dailySearches == null ? null : Math.max(0, plan.dailySearches - usedToday),
    deepUsed,
    deepLeft: plan.deepMonthly == null ? null : Math.max(0, plan.deepMonthly - deepUsed),
  };
}

// Null when another search is allowed. A sentence when the Free daily limit is spent.
export function freeSearchBlock(now = Date.now()) {
  const plan = researchPlan();
  if (plan.dailySearches == null) return null;
  const used = searchesToday(now);
  if (used < plan.dailySearches) return null;
  return `Free includes ${plan.dailySearches} web searches a day (${used} used). This answer goes on without another search. It resets at midnight UTC.`;
}

export function requireResearch(feature, now = Date.now()) {
  const plan = researchPlan();
  const deny = (message, code) => ({ ok: false, plan, message, code, status: 402 });
  if (feature === "webSearch") {
    const block = freeSearchBlock(now);
    return block ? deny(block, "search_daily") : { ok: true, plan };
  }
  if (feature === "proSearch") {
    if (!plan.proSearch) return deny("Pro search is part of Pro ($15.99/month). It runs a few searches and folds them into one cited answer. Add a licence key in Settings.", "pro_required");
    return { ok: true, plan };
  }
  if (feature === "deepResearch") {
    if (!plan.deepResearch) return deny("Deep research is part of Pro ($15.99/month). It reads sources, writes a cited report, and a second AI from another company cross-checks it. Add a licence key in Settings.", "pro_required");
    if (plan.deepMonthly == null) return { ok: true, plan, limit: null };
    const used = deepUsedThisMonth(now);
    if (used >= plan.deepMonthly) return deny(`Pro includes ${plan.deepMonthly} deep research runs a month (${used} used). Extreme is unlimited. This one waits until next month, or run a Pro search instead.`, "deep_limit");
    return { ok: true, plan, limit: plan.deepMonthly, used };
  }
  return deny("This feature is not on your plan.", "pro_required");
}
