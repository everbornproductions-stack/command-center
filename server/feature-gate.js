// Free, Pro, and Extreme limits. One place for the comparison table and the server gates.
// A Studio licence uses Pro limits. Owner uses Extreme limits. Nothing here calls Stripe.
// Features marked built: false have a gate and no screen yet.
import {
  extremeMonthlyLabel, extremeYearlyLabel, proMonthlyLabel, proYearlyLabel,
} from "./price-config.js";
import { ctx, doc } from "./store.js";
import { isTrusted as isTrustedLicense } from "./license-seal.js";

export const PRO_AIS = 4;
export const EXTREME_AIS = 8;
export const FREE_AIS = 4;
export const FREE_CONCURRENT = 1;
export const PRO_CONCURRENT = 3;
export const EXTREME_CONCURRENT = 8;
export const PRO_DEEP_RESEARCH_PER_MONTH = 8;
export const PRO_INDUSTRY_PACKS = 1;
// 5 people total, counting the owner (the owner plus 4 invited). The gate count is the headcount before an invite.
export const EXTREME_TEAM_SEATS = 5;
export const PRO_DESKTOP_APPS = 3;
export const PRO_RECIPES = 5;

const TAIL = " Add a licence key in Settings.";
export const PRO_PRICE = proMonthlyLabel;

export const FEATURES = {
  missions: { kind: "bool", built: true },
  scheduler: { kind: "bool", built: true },
  councilsPerMonth: { kind: "cap", built: true },
  projects: { kind: "cap", built: true },
  subscriptionsTab: { kind: "bool", built: true },
  connectedServices: { kind: "cap", built: true },
  emailAccounts: { kind: "cap", built: true },
  phone: { kind: "bool", built: true },
  historySearch: { kind: "bool", built: true },
  sharedLearning: { kind: "bool", built: true },
  scores: { kind: "bool", built: true },
  aisPerCouncil: { kind: "cap", built: true },
  concurrentRuns: { kind: "cap", built: true },
  hostedBackground: { kind: "bool", built: false },
  hostedSchedules: { kind: "bool", built: false },
  teamSeats: { kind: "cap", built: true },
  desktopApps: { kind: "cap", built: false },
  recipes: { kind: "cap", built: false },
  industryPacks: { kind: "cap", built: true },
  auditLog: { kind: "bool", built: false },
  budgetCap: { kind: "bool", built: false },
  prioritySupport: { kind: "bool", built: true },
  deepResearchPerMonth: { kind: "cap", built: false },
  earlyAccess: { kind: "bool", built: true },
  maxQuality: { kind: "bool", built: true },
};

// New features reach Extreme first. Unset means on. "0" turns the flag off.
export function earlyAccessEnabled(env = process.env) {
  const v = env?.CC_EARLY_ACCESS;
  if (v == null || String(v).trim() === "") return true;
  return String(v).trim() !== "0";
}

const ALIAS = {
  subscriptions: "subscriptionsTab",
  council: "councilsPerMonth",
  connectedService: "connectedServices",
  deepResearch: "deepResearchPerMonth",
  concurrent: "concurrentRuns",
};

// Flags the older routes still read by name. Caps stay numeric on the objects above.
const FREE_FLAGS = {
  shareLinks: false, desktop: false, programScan: false, appScan: false, repeats: false,
  exportDocs: false, backgroundRuns: false, pauseMissions: false, missionPause: false,
  learnedFromRatings: true,
  publicShare: false, documentExport: false,
  tryItNow: true, simpleMode: true, safety: true, backup: true, doubleCheck: true,
  learningRouter: true, privateMode: true,
  byoMcp: false, byoWebhook: false,
};
const PRO_FLAGS = {
  shareLinks: true, desktop: true, programScan: true, appScan: true, repeats: true,
  exportDocs: true, backgroundRuns: true, pauseMissions: true, missionPause: true,
  learnedFromRatings: true,
  publicShare: true, documentExport: true,
  tryItNow: true, simpleMode: true, safety: true, backup: true, doubleCheck: true,
  learningRouter: true, privateMode: true,
  byoMcp: true, byoWebhook: true,
};

const FREE = {
  missions: false, scheduler: false, councilsPerMonth: 5, projects: 3, subscriptionsTab: false,
  connectedServices: 1, emailAccounts: 1, phone: false, historySearch: false, sharedLearning: false, scores: false,
  aisPerCouncil: FREE_AIS, concurrentRuns: FREE_CONCURRENT,
  hostedBackground: false, hostedSchedules: false, teamSeats: 0,
  desktopApps: 0, recipes: 0, industryPacks: 0, auditLog: false, budgetCap: false, prioritySupport: false,
  deepResearchPerMonth: 0,
  earlyAccess: false, maxQuality: false,
  ...FREE_FLAGS,
  label: "Free",
};

const PRO = {
  missions: true, scheduler: true, councilsPerMonth: Infinity, projects: Infinity, subscriptionsTab: true,
  connectedServices: Infinity, emailAccounts: 8, phone: true, historySearch: true, sharedLearning: true, scores: true,
  aisPerCouncil: PRO_AIS, concurrentRuns: PRO_CONCURRENT,
  hostedBackground: false, hostedSchedules: false, teamSeats: 0,
  desktopApps: PRO_DESKTOP_APPS, recipes: PRO_RECIPES, industryPacks: PRO_INDUSTRY_PACKS,
  auditLog: false, budgetCap: false, prioritySupport: true,
  deepResearchPerMonth: PRO_DEEP_RESEARCH_PER_MONTH,
  earlyAccess: false, maxQuality: false,
  ...PRO_FLAGS,
  label: "Pro",
};

const EXTREME = {
  ...PRO,
  aisPerCouncil: EXTREME_AIS,
  concurrentRuns: EXTREME_CONCURRENT,
  hostedBackground: true,
  hostedSchedules: true,
  teamSeats: EXTREME_TEAM_SEATS,
  desktopApps: Infinity,
  recipes: Infinity,
  industryPacks: Infinity,
  auditLog: true,
  budgetCap: true,
  prioritySupport: true,
  deepResearchPerMonth: Infinity,
  earlyAccess: true,
  maxQuality: true,
  label: "Extreme",
};

export const LIMITS = {
  free: FREE,
  pro: PRO,
  extreme: EXTREME,
  // A Studio licence is Pro. It is not a fourth public price and it is not Extreme.
  studio: { ...PRO, label: "Studio" },
  owner: { ...EXTREME, label: "Owner" },
};

export const featureKey = (feature) => ALIAS[feature] || feature;
export const featureBuilt = (feature) => FEATURES[featureKey(feature)]?.built !== false;

function isHigher(a, b) {
  if (a === true && b !== true) return true;
  if (a === Infinity && b !== Infinity) return true;
  if (typeof a === "number" && typeof b === "number" && a > b) return true;
  return false;
}

export function sellingTier(limits, key) {
  if (isHigher(LIMITS.pro[key], limits[key])) return "pro";
  if (isHigher(LIMITS.extreme[key], limits[key])) return "extreme";
  return "pro";
}

function usedCount(key, info) {
  if (key === "concurrentRuns") return Number(info.running ?? 0);
  if (key === "councilsPerMonth" || key === "deepResearchPerMonth") return Number(info.used ?? info.count ?? 0);
  return Number(info.count ?? info.used ?? info.seats ?? 0);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function messageFor(limits, key, info, sell) {
  const price = sell === "extreme" ? extremeMonthlyLabel : proMonthlyLabel;
  const who = sell === "extreme" ? "Extreme" : "Pro";
  const n = usedCount(key, info);
  const limit = limits[key];
  const part = (what) => `${what} is part of ${who} (${price}).${TAIL}`;

  if (key === "councilsPerMonth") {
    return `You have used ${n} of ${limit} councils this month on ${limits.label}. Unlimited councils is part of Pro (${proMonthlyLabel}).${TAIL}`;
  }
  if (key === "projects") {
    return `${limits.label} includes ${plural(limit, "project")}. Unlimited projects is part of Pro (${proMonthlyLabel}).${TAIL}`;
  }
  if (key === "connectedServices") {
    return `${limits.label} includes ${plural(limit, "connected service")}. Every connected service is part of Pro (${proMonthlyLabel}).${TAIL}`;
  }
  if (key === "emailAccounts") {
    return `${limits.label} includes ${plural(limit, "email account")} per provider. More email accounts is part of Pro (${proMonthlyLabel}).${TAIL}`;
  }
  if (key === "missions") return part("Mission mode");
  if (key === "scheduler") return part("The off-peak scheduler");
  if (key === "subscriptionsTab") return part("The Subscriptions tracker");
  if (key === "phone") return part("Phone pairing");
  if (key === "historySearch") return part("Full history search");
  if (key === "sharedLearning") return part("Shared learning");
  if (key === "scores") return part("The scores dashboard");
  if (key === "prioritySupport") return part("Priority support");
  if (key === "desktop") return part("Desktop control");
  if (key === "appScan" || key === "programScan") return part("Program scan");
  if (key === "publicShare" || key === "shareLinks") return part("Public share links");
  if (key === "documentExport" || key === "exportDocs") return part("PDF and Word export");
  if (key === "repeats") return part("Do this again");
  if (key === "byoMcp") return part("An MCP server by URL");
  if (key === "byoWebhook") return part("A custom webhook tool");
  if (key === "backgroundRuns") return part("Background runs");
  if (key === "pauseMissions" || key === "missionPause") return part("Pause, edit and resume");
  if (key === "deepResearchPerMonth") {
    if (!limit) return `Deep Research is part of Pro (${proMonthlyLabel}). Unlimited Deep Research is part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
    return `You have used ${n} of ${limit} Deep Research runs this month on ${limits.label}. Unlimited Deep Research is part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
  }
  if (key === "industryPacks") {
    if (!limit) return `An industry pack is part of Pro (${proMonthlyLabel}). All industry packs are part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
    return `${limits.label} includes ${plural(limit, "industry pack")}. All industry packs are part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
  }
  if (key === "aisPerCouncil") {
    return `${limits.label} includes ${plural(limit, "AI")} per council. More AIs per council is part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
  }
  if (key === "concurrentRuns") {
    return `${limits.label} includes ${plural(limit, "run")} at once. More runs at once is part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
  }
  if (key === "teamSeats") return `Team spaces are part of Extreme (${extremeMonthlyLabel}). Extreme includes ${EXTREME_TEAM_SEATS} people total, counting the owner. That is the owner plus 4 invited.${TAIL}`;
  if (key === "earlyAccess") return `Early access is part of Extreme (${extremeMonthlyLabel}). New features reach Extreme first, behind a flag.${TAIL}`;
  if (key === "maxQuality") return `Max quality is part of Extreme (${extremeMonthlyLabel}). It uses the best model each connected AI offers, with more reasoning and a longer context, inside the budget cap.${TAIL}`;
  if (key === "desktopApps") {
    if (!limit) return `Desktop control apps are part of Pro (${proMonthlyLabel}), with a limit. Unlimited desktop control apps are part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
    return `${limits.label} includes ${plural(limit, "desktop control app")}. Unlimited desktop control apps are part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
  }
  if (key === "recipes") {
    if (!limit) return `Recipes are part of Pro (${proMonthlyLabel}), with a limit. Unlimited recipes are part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
    return `${limits.label} includes ${plural(limit, "recipe")}. Unlimited recipes are part of Extreme (${extremeMonthlyLabel}).${TAIL}`;
  }
  if (key === "hostedBackground") return part("Hosted background runs");
  if (key === "hostedSchedules") return part("Hosted schedules");
  if (key === "auditLog") return part("The compliance audit log");
  if (key === "budgetCap") return part("A monthly budget cap");
  return part("This feature");
}

export function evaluateGate(limits, feature, info = {}) {
  const key = featureKey(feature);
  const meta = FEATURES[key];
  const built = meta ? meta.built !== false : true;
  const current = limits || FREE;
  if (!meta) {
    if (current[key]) return { ok: true, feature: key, built };
    const sell = "pro";
    return { ok: false, feature: key, built, code: "pro_required", message: messageFor(current, key, info, sell) };
  }
  const value = current[key];
  if (meta.kind === "bool") {
    if (value && key === "earlyAccess" && !earlyAccessEnabled(info.env)) {
      return { ok: false, feature: key, built, code: "early_access_off", message: "Early access is off. New features reach Extreme first when the flag is on." };
    }
    if (value) return { ok: true, feature: key, built };
    const sell = sellingTier(current, key);
    return { ok: false, feature: key, built, code: sell === "extreme" ? "extreme_required" : "pro_required", message: messageFor(current, key, info, sell) };
  }
  const n = usedCount(key, info);
  if (n < value) return { ok: true, feature: key, built, limit: value === Infinity ? null : value };
  const sell = sellingTier(current, key);
  return {
    ok: false, feature: key, built,
    code: sell === "extreme" ? "extreme_required" : "pro_required",
    message: messageFor(current, key, info, sell),
  };
}

function cellCap(value, monthly) {
  if (value === Infinity) return "Unlimited";
  if (!value) return "No";
  return monthly ? `${value} a month` : String(value);
}

function cellBool(value) {
  return value ? "Yes" : "No";
}

const PUBLIC_ROWS = [
  { id: "councils", label: "Councils", key: "councilsPerMonth", monthly: true },
  { id: "ais", label: "AIs per council", key: "aisPerCouncil" },
  { id: "runs", label: "Runs at once", key: "concurrentRuns" },
  { id: "missions", label: "Missions", key: "missions", bool: true },
  { id: "deep", label: "Deep Research", key: "deepResearchPerMonth", monthly: true },
  { id: "packs", label: "Industry packs", key: "industryPacks", packs: true },
  { id: "audit", label: "Compliance audit log", key: "auditLog", bool: true },
  { id: "team", label: "Team", key: "teamSeats" },
  { id: "apps", label: "Desktop control apps", key: "desktopApps" },
  { id: "recipes", label: "Recipes", key: "recipes" },
  { id: "hostedRuns", label: "Hosted background runs", key: "hostedBackground", bool: true },
  { id: "hostedSchedules", label: "Hosted schedules", key: "hostedSchedules", bool: true },
  { id: "budget", label: "Monthly budget cap", key: "budgetCap", bool: true },
  { id: "support", label: "Priority support", key: "prioritySupport", bool: true },
  { id: "early", label: "Early access", key: "earlyAccess", bool: true },
  { id: "max", label: "Max quality", key: "maxQuality", bool: true },
];

function compareCell(tier, row, env) {
  const value = LIMITS[tier][row.key];
  if (row.key === "earlyAccess") {
    if (!value) return "No";
    return earlyAccessEnabled(env) ? "Yes" : "Flag off";
  }
  if (row.key === "maxQuality") return value ? "Yes, inside the budget cap" : "No";
  if (row.packs) {
    if (value === Infinity) return "All packs";
    if (!value) return "No";
    return value === 1 ? "1 pack" : `${value} packs`;
  }
  if (row.bool) return cellBool(value);
  if (row.key === "teamSeats") return value ? `${value} people total` : "No";
  if ((row.key === "desktopApps" || row.key === "recipes") && value === Infinity) return "Unlimited";
  return cellCap(value, row.monthly);
}

export function publicCompare(env = process.env) {
  const columns = [
    { id: "free", name: "Free", price: "$0" },
    { id: "pro", name: "Pro", price: `${proMonthlyLabel} or ${proYearlyLabel}` },
    { id: "extreme", name: "Extreme", price: `${extremeMonthlyLabel} or ${extremeYearlyLabel}` },
  ];
  const rows = PUBLIC_ROWS.map((row) => ({
    id: row.id,
    label: row.label,
    cells: columns.map((col) => compareCell(col.id, row, env)),
  }));
  return { columns, rows, minWidth: 390 };
}

// Older Free vs Pro rows. The words match web/compare.js.
const PAID = new Set(["pro", "studio", "extreme", "owner"]);
const registry = [];

export function registerFeature(spec) {
  const id = String(spec?.id || "").trim();
  if (!/^[a-z][a-zA-Z0-9]{1,40}$/.test(id)) throw new Error("feature id required");
  const tier = spec.tier === "free" ? "free" : spec.tier === "extreme" ? "extreme" : "pro";
  const row = {
    id,
    tier,
    label: String(spec.label || id).slice(0, 80),
    free: String(spec.free ?? (tier === "free" ? "Yes" : "No")),
    pro: String(spec.pro ?? (tier === "extreme" ? "No" : "Yes")),
    extreme: String(spec.extreme ?? "Yes"),
    landed: spec.landed !== false,
    cap: spec.cap || null,
  };
  const at = registry.findIndex((r) => r.id === id);
  if (at >= 0) registry[at] = row;
  else registry.push(row);
  return { ...row };
}

export function unregisterFeature(id) {
  const at = registry.findIndex((r) => r.id === id);
  if (at >= 0) registry.splice(at, 1);
}

export function featureById(id) {
  const row = registry.find((r) => r.id === id);
  return row ? { ...row } : null;
}

export function features() {
  return registry.map((r) => ({ ...r }));
}

export function compareRows() {
  return registry.map((r) => [r.label, r.free, r.pro]);
}

export function tierPaid(tier) {
  return PAID.has(String(tier || "free").toLowerCase());
}

export function guardFeature(id, tier = "free") {
  const row = featureById(id);
  if (!row) {
    const e = new Error("Unknown feature.");
    e.status = 400;
    e.code = "feature";
    throw e;
  }
  const name = String(tier || "free").toLowerCase();
  if (row.tier === "free") return row;
  if (row.tier === "extreme") {
    if (name === "extreme" || name === "owner") return row;
    const e = new Error(`${row.label} is part of Extreme (${extremeMonthlyLabel}).`);
    e.status = 402;
    e.code = "extreme_required";
    throw e;
  }
  if (name === "free" || !tierPaid(name)) {
    const e = new Error(`${row.label} is part of Pro (${PRO_PRICE}). Add a licence key in Settings.`);
    e.status = 402;
    e.code = "pro_required";
    throw e;
  }
  return row;
}

function add(spec) { registerFeature(spec); }

add({ id: "tryItNow", tier: "free", label: "Try it now", free: "Yes", pro: "Yes" });
add({ id: "simpleMode", tier: "free", label: "Simple mode", free: "Yes", pro: "Yes" });
add({ id: "learningRouter", tier: "free", label: "Learning router", free: "Yes", pro: "Yes" });
add({ id: "safety", tier: "free", label: "Safety checks", free: "Yes", pro: "Yes", landed: false });
add({ id: "privateMode", tier: "free", label: "Private mode", free: "Yes", pro: "Yes" });
add({ id: "backup", tier: "free", label: "Backup and restore", free: "Yes", pro: "Yes" });
add({ id: "doubleCheck", tier: "free", label: "Double-check this", free: "Yes", pro: "Yes" });
add({ id: "connectedServices", tier: "free", label: "Connected services", free: "1", pro: "Unlimited", cap: "connectedServices" });
add({ id: "emailAccounts", tier: "free", label: "Email accounts per provider", free: "1", pro: "8", cap: "emailAccounts" });
add({ id: "projects", tier: "free", label: "Projects", free: "3", pro: "Unlimited", cap: "projects" });
add({ id: "councils", tier: "free", label: "Councils", free: "5 a month", pro: "Unlimited", cap: "councilsPerMonth" });
add({ id: "missions", tier: "pro", label: "Missions", cap: "missions" });
add({ id: "scheduler", tier: "pro", label: "Schedules", cap: "scheduler" });
add({ id: "repeats", tier: "pro", label: "Do this again" });
add({ id: "desktop", tier: "pro", label: "Desktop control" });
add({ id: "programScan", tier: "pro", label: "Program scan" });
add({ id: "industryPacks", tier: "pro", label: "Industry packs" });
add({ id: "shareLinks", tier: "pro", label: "Public share links" });
add({ id: "exportDocs", tier: "pro", label: "PDF and Word export" });
add({ id: "backgroundRuns", tier: "pro", label: "Background runs", landed: false });
add({ id: "pauseMissions", tier: "pro", label: "Pause missions", landed: false });
add({ id: "sharedLearning", tier: "pro", label: "Shared learning", cap: "sharedLearning" });
add({ id: "scores", tier: "pro", label: "Scores dashboard", cap: "scores" });
add({ id: "phone", tier: "pro", label: "Phone pairing", cap: "phone" });
add({ id: "historySearch", tier: "pro", label: "Full history search", cap: "historySearch" });
add({ id: "subscriptions", tier: "pro", label: "Subscriptions tracker", cap: "subscriptionsTab" });

const ROUTE_LABELS = {
  publicShare: "Public share links",
  documentExport: "PDF and Word export",
  industryPacks: "Industry packs",
};
const FEATURE_FLAG = {
  publicShare: "publicShare",
  documentExport: "documentExport",
  industryPacks: "industryPacks",
};

// license.js registers licenseState after both modules finish loading.
let readLicense = () => ({ tier: "free" });
export function bindLicenseState(fn) {
  if (typeof fn === "function") readLicense = fn;
}

export function featureOpen(id) {
  const label = ROUTE_LABELS[id] || featureById(id)?.label || "This feature";
  const s = readLicense();
  const T = LIMITS[s.tier] || LIMITS.free;
  const flag = FEATURE_FLAG[id];
  const row = featureById(id);
  const ok = flag ? !!T[flag] : ((row?.tier !== "pro" && row?.tier !== "extreme") || tierPaid(s.tier));
  return { ok: !!ok, tier: s.tier, feature: id, label, code: ok ? "open" : "pro_required" };
}

export function requirePro(id) {
  const r = featureOpen(id);
  if (r.ok) return r;
  const err = new Error(`${r.label} is part of Pro (${PRO_PRICE}). Add a licence key in Settings.`);
  err.status = 402;
  err.code = "pro_required";
  err.feature = id;
  throw err;
}

// Research limits. This is not billing and it does not call Stripe.
// Free: live web search, with a daily limit.
// Pro and Studio: Pro search, and Deep Research up to the Pro monthly cap.
// Extreme and Owner: Deep Research with no monthly limit.
// A packaged build ignores the CC_RESEARCH_* test overrides.
export const FREE_DAILY_SEARCHES = 20;
export const PRO_DEEP_PER_MONTH = PRO_DEEP_RESEARCH_PER_MONTH;

const RESEARCH_EXTREME = new Set(["extreme", "owner"]);
const RESEARCH_PRO = new Set(["pro", "studio", "extreme", "owner"]);

export function activeTier() {
  if (process.env.CC_PACKAGED !== "1") {
    const t = String(process.env.CC_RESEARCH_TIER || "");
    if (["free", "pro", "studio", "extreme", "owner"].includes(t)) return t;
  }
  return readLicense().tier || "free";
}

function envNumber(name) {
  if (process.env.CC_PACKAGED === "1") return null;
  const raw = process.env[name];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function researchPlan(tier = activeTier()) {
  const extreme = RESEARCH_EXTREME.has(tier);
  const pro = RESEARCH_PRO.has(tier);
  const cap = LIMITS[tier]?.deepResearchPerMonth;
  const monthly = cap === Infinity ? null : (typeof cap === "number" ? cap : 0);
  return {
    tier,
    label: extreme ? (tier === "owner" ? "Owner" : "Extreme") : tier === "studio" ? "Studio" : pro ? "Pro" : "Free",
    webSearch: true,
    dailySearches: pro ? null : (envNumber("CC_RESEARCH_FREE_DAILY") ?? FREE_DAILY_SEARCHES),
    proSearch: pro,
    deepResearch: pro,
    deepMonthly: extreme ? null : pro ? (envNumber("CC_RESEARCH_DEEP_MONTHLY") ?? (monthly ?? PRO_DEEP_PER_MONTH)) : 0,
    extreme,
  };
}

const dayStartUtc = (now) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const monthStartUtcLocal = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

export function searchesToday(now = Date.now()) {
  const start = dayStartUtc(now);
  return (ctx().ledger || []).filter((e) => e.kind === "search" && e.engine !== "demo" && e.provider !== "demo-search" && Number(e.ts) >= start).length;
}

export function deepUsedThisMonth(now = Date.now()) {
  const since = monthStartUtcLocal(now);
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
    flag_agents: Boolean((() => { try { const s = doc("settings", () => ({})) || {}; if (typeof s.flag_agents === "boolean") return s.flag_agents; } catch {} return process.env.CC_FLAG_AGENTS !== "0" && process.env.flag_agents !== "0"; })()),
    costWarning: "Deep research runs parallel agents and uses about 15 times the tokens of a normal chat.",
  };
}

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
    if (!plan.proSearch) return deny(`Pro search is part of Pro (${proMonthlyLabel}). It runs a few searches and folds them into one cited answer. Add a licence key in Settings.`, "pro_required");
    return { ok: true, plan };
  }
  if (feature === "deepResearch") {
    if (!plan.deepResearch) return deny(`Deep research is part of Pro (${proMonthlyLabel}). It reads sources, writes a cited report, and a second AI from another company cross-checks it. Add a licence key in Settings.`, "pro_required");
    if (plan.deepMonthly == null) return { ok: true, plan, limit: null };
    const used = deepUsedThisMonth(now);
    if (used >= plan.deepMonthly) return deny(`Pro includes ${plan.deepMonthly} deep research runs a month (${used} used). Extreme is unlimited. This one waits until next month, or run a Pro search instead.`, "deep_limit");
    return { ok: true, plan, limit: plan.deepMonthly, used };
  }
  return deny("This feature is not on your plan.", "pro_required");
}

// Named product gates. The limit objects above are the source of truth, so Extreme
// and Owner keep Pro flags, and Studio stays Pro. license.js guard() reads the same table.
export const GATES = {
  backgroundRuns: { min: "pro", label: "Background runs" },
  missionPause: { min: "pro", label: "Pause, edit and resume" },
  learnedFromRatings: { min: "free", label: "What ratings taught" },
};

export function gateAllows(tier, name) {
  if (!GATES[name]) return false;
  const limits = LIMITS[tier] || LIMITS.free;
  return !!limits[name];
}

export function flagsFor(tier) {
  const out = {};
  for (const name of Object.keys(GATES)) out[name] = gateAllows(tier, name);
  return out;
}

export function gateError(name) {
  const label = GATES[name]?.label || "This feature";
  return Object.assign(
    new Error(`${label} is part of Pro (${proMonthlyLabel}). Add a licence key in Settings.`),
    { status: 402, code: "pro_required" },
  );
}

export function assertGate(tier, name) {
  if (!GATES[name] || !gateAllows(tier, name)) throw gateError(name);
}

// Refocus. Find, the timeline, and the status labels are Pro (Studio counts as Pro).
// The rebuild mission is Extreme and has no cap. Owner can do both.
// Nothing here calls Stripe.
export const FIND = "refocus";
export const REBUILD = "refocusRebuild";

const FIND_TIERS = new Set(["pro", "studio", "owner", "extreme"]);
const REBUILD_TIERS = new Set(["extreme", "owner"]);

function refocusNotes() {
  return {
    pro: `Refocus is part of Pro (${proMonthlyLabel}). Add a licence key in Settings.`,
    extreme: "The full rebuild is part of Extreme. Your plan can find the work and list it. It does not start the rebuild.",
  };
}

export function tierName(state = readLicense()) {
  const tier = String(state?.tier || "free");
  if (FIND_TIERS.has(tier) || tier === "free") return tier;
  return "free";
}

export function refocusGate(state = readLicense()) {
  const tier = tierName(state);
  const find = FIND_TIERS.has(tier);
  const rebuild = REBUILD_TIERS.has(tier);
  const notes = refocusNotes();
  return {
    tier,
    find,
    timeline: find,
    status: find,
    rebuild,
    unlimited: rebuild,
    upgrade: find ? null : notes.pro,
    rebuildUpgrade: rebuild ? null : (find ? notes.extreme : notes.pro),
  };
}

function refocusDeny(message, code) {
  return Object.assign(new Error(message), { status: 402, code, upgrade: message });
}

export function assertRefocusFind(state = readLicense()) {
  const gate = refocusGate(state);
  if (!gate.find) throw refocusDeny(gate.upgrade, "pro_required");
  return gate;
}

export function assertRefocusRebuild(state = readLicense()) {
  const gate = refocusGate(state);
  if (!gate.rebuild) throw refocusDeny(gate.rebuildUpgrade, gate.find ? "extreme_required" : "pro_required");
  return gate;
}

const TIER_GRACE_MS = 7 * 24 * 3600 * 1000;

// Reads the stored licence without importing license.js. A bound licence state wins when it
// already names a paid tier. A unit test can write the licence doc before that module loads.
export function currentTier(now = Date.now()) {
  const live = readLicense();
  const named = String(live.tier || "").toLowerCase();
  if (named === "owner" || named === "studio" || named === "extreme" || named === "pro") return named;
  let stored = {};
  try { stored = doc("license", () => ({})) || {}; } catch { stored = {}; }
  const raw = String(stored.tier || "").toLowerCase();
  const seen = Number(stored.lastOkAt || stored.checkedAt || 0);
  const fresh = isTrustedLicense(stored) && stored.status === "active" && seen > 0 && now <= seen + TIER_GRACE_MS;
  if (fresh && (raw === "extreme" || raw === "owner" || raw === "pro" || raw === "studio")) return raw;
  if (live.reason === "trial") return "pro";
  return "free";
}

export function limitsFor(tier = currentTier()) {
  const band = tier === "extreme" || tier === "owner" ? "extreme" : (tier === "pro" || tier === "studio" ? "pro" : "free");
  const row = LIMITS[tier] || LIMITS[band] || LIMITS.free;
  return {
    tier,
    band,
    learnTune: true,
    desktop: !!row.desktop,
    desktopApps: row.desktopApps,
    recipes: row.recipes,
    budgetIncluded: !!row.budgetCap,
    phone: !!row.phone,
  };
}

function paidFail(message, code) {
  const err = new Error(message);
  err.status = 402;
  err.code = code;
  return err;
}

// Phone pairing, bring-your-own MCP, custom webhooks, desktop apps, recipes, and the budget cap.
// Trial is already Pro on the licence state. This does not import license.js.
export function gate(feature, info = {}) {
  if (PHASE_GATES[feature]) {
    const row = access(feature, info);
    if (!row.ok) throw Object.assign(paidFail(row.message, row.code), { feature });
    return row;
  }
  if (feature === "learnTune" || feature === "phoneApprovals") return limitsFor();
  if (feature === "desktop" || feature === "desktopApps") {
    const limits = limitsFor();
    if (!limits.desktop) throw paidFail(`Desktop control is part of Pro (${proMonthlyLabel}). Add a licence key in Settings.`, "pro_required");
    const n = Number(info.count ?? 0);
    if (Number.isFinite(limits.desktopApps) && n >= limits.desktopApps) {
      throw paidFail(`Pro includes ${PRO_DESKTOP_APPS} desktop control apps. Unlimited desktop control apps are part of Extreme.`, "extreme_required");
    }
    return limits;
  }
  if (feature === "recipes") {
    const limits = limitsFor();
    if (!limits.recipes) throw paidFail(`Recipes are part of Pro (${proMonthlyLabel}), with a limit. Unlimited recipes are part of Extreme.`, "pro_required");
    const n = Number(info.count ?? 0);
    if (Number.isFinite(limits.recipes) && n >= limits.recipes) {
      throw paidFail(`Pro includes ${PRO_RECIPES} recipes. Unlimited recipes are part of Extreme.`, "extreme_required");
    }
    return limits;
  }
  if (feature === "budgetCap") {
    const limits = limitsFor();
    if (limits.budgetIncluded || info.optedIn) return limits;
    throw paidFail("A monthly budget cap is part of Extreme. Anyone else can turn it on in Settings.", "extreme_required");
  }
  const s = readLicense();
  const T = LIMITS[s.tier] || LIMITS.free;
  const spec = { ...info };
  delete spec.env;
  const result = evaluateGate(T, feature, spec);
  if (!result.ok) {
    const err = new Error(result.message);
    err.status = 402;
    err.code = result.code;
    throw err;
  }
  return s;
}

// App connections. Free includes 1. Pro and Studio include 5. Extreme and Owner are unlimited.
// Studio is Pro. An active Extreme licence is Extreme for the whole product.
export const PRO_APP_CONNECTIONS = 5;

export function connectionLimit(tier) {
  const t = String(tier || "free").toLowerCase();
  if (t === "extreme" || t === "owner") return Infinity;
  if (t === "pro" || t === "studio") return PRO_APP_CONNECTIONS;
  return 1;
}

export function limitMessage(limit) {
  if (limit === 1) return "Free includes 1 app connection. Pro includes several (5). Extreme is unlimited.";
  return `This plan includes ${limit} app connections. Extreme is unlimited.`;
}

export function gateTier() {
  const tier = String(readLicense().tier || "free").toLowerCase();
  if (tier === "owner" || tier === "pro" || tier === "studio" || tier === "extreme") return tier;
  return "free";
}

export function assertRoom(count, tier = gateTier()) {
  const limit = connectionLimit(tier);
  if (count >= limit) {
    const err = new Error(limitMessage(limit));
    err.status = 402;
    err.code = "app_connection_limit";
    err.limit = limit;
    throw err;
  }
  return { tier, limit, used: count };
}

export function gateView(used) {
  const tier = gateTier();
  const limit = connectionLimit(tier);
  return {
    tier,
    limit: limit === Infinity ? null : limit,
    unlimited: limit === Infinity,
    used,
    remaining: limit === Infinity ? null : Math.max(0, limit - used),
  };
}

// Extreme and Owner only. Free, Pro, and Studio stay on this computer.
// This does not set a price and it does not call Stripe. It does not import license.js.
export const HOSTED_RUNS = "hostedRuns";

export function hostedRunsAllowed(tier) {
  const name = String(tier || "").toLowerCase();
  return name === "extreme" || name === "owner";
}

export function gateHostedRuns(tier) {
  const name = tier === undefined ? readLicense().tier : tier;
  if (hostedRunsAllowed(name)) return { tier: String(name || "free").toLowerCase(), feature: HOSTED_RUNS, allowed: true };
  throw Object.assign(
    new Error("Running while this PC is off is part of Extreme. A schedule or mission stays on this computer until then."),
    { status: 402, code: "extreme_required" }
  );
}

// Remix is a Pro mission. Studio is Pro, so it uses the Pro cap. Extreme and Owner have no monthly cap.
// The Pro cap is a placeholder. It is not a price. This does not import license.js.
export const REMIX_PRO_CAP = 8;

export function countRemixMonth(items, now = Date.now()) {
  const since = monthStartUtcLocal(now);
  return (items || []).filter((r) => Number(r?.ts) >= since).length;
}

export function remixPolicy(tier) {
  const t = String(tier || "free").toLowerCase();
  if (t === "extreme" || t === "owner") {
    return { tier: t, allowed: true, unlimited: true, cap: null, label: LIMITS[t]?.label || (t === "extreme" ? "Extreme" : "Owner") };
  }
  if (t === "pro" || t === "studio") {
    return { tier: t, allowed: true, unlimited: false, cap: REMIX_PRO_CAP, label: LIMITS[t]?.label || "Pro" };
  }
  return { tier: "free", allowed: false, unlimited: false, cap: 0, label: LIMITS.free.label };
}

export function remixGate({ tier = "free", used = 0 } = {}) {
  const policy = remixPolicy(tier);
  const n = Math.max(0, Number(used) || 0);
  if (!policy.allowed) {
    return {
      ...policy, used: n, remaining: 0, ok: false, status: 402, code: "pro_required",
      message: "Remix is a Pro mission. Extreme has no monthly cap.",
    };
  }
  if (!policy.unlimited && n >= policy.cap) {
    return {
      ...policy, used: n, remaining: 0, ok: false, status: 402, code: "remix_cap",
      message: `You have used ${n} of ${policy.cap} Remix missions this month on ${policy.label}. Extreme has no monthly cap.`,
    };
  }
  const remaining = policy.unlimited ? null : policy.cap - n;
  return {
    ...policy, used: n, remaining, ok: true, status: 200, code: null,
    message: policy.unlimited
      ? "Remix has no monthly cap on this plan."
      : `${remaining} Remix mission${remaining === 1 ? "" : "s"} left this month.`,
  };
}

export function assertRemix({ tier, used } = {}) {
  const g = remixGate({ tier: tier ?? readLicense().tier, used });
  if (!g.ok) throw Object.assign(new Error(g.message), { status: g.status, code: g.code });
  return g;
}

// Second opinion, industry packs, shared team recipes, HighLevel tools, and Use your own Supabase.
// Studio is Pro. Team spaces are Extreme, 5 people total counting the owner. Nothing here charges.
export const TEAM_SEATS = EXTREME_TEAM_SEATS;
export const PHASE_GATES = {
  secondOpinion: { tier: "free", label: "Second opinion" },
  industryPacks: { tier: "pro", label: "Industry packs" },
  teamSpaces: { tier: "extreme", label: "Team spaces" },
  teamSeats: { tier: "extreme", label: "Team spaces", cap: TEAM_SEATS },
  highlevelTools: { tier: "free", label: "HighLevel tools" },
  ownSupabase: { tier: "free", label: "Use your own Supabase" },
};
const PRO_AND_UP = new Set(["pro", "studio", "owner", "extreme"]);
const EXTREME_AND_UP = new Set(["owner", "extreme"]);

// Pure check. `tier` is free, pro, studio, owner, or extreme.
export function decide(tier, feature, info = {}) {
  const meta = PHASE_GATES[feature];
  const name = meta?.label || "This feature";
  const proMessage = `${name} is part of Pro (${proMonthlyLabel}).${TAIL}`;
  if (!meta) return { ok: false, tier, feature, code: "pro_required", message: `This feature is part of Pro (${proMonthlyLabel}).${TAIL}` };
  if (meta.tier === "free") return { ok: true, tier, feature, code: "open" };
  if (meta.tier === "pro") {
    if (PRO_AND_UP.has(tier)) return { ok: true, tier, feature, code: "open" };
    return { ok: false, tier, feature, code: "pro_required", message: proMessage };
  }
  if (!EXTREME_AND_UP.has(tier)) {
    return { ok: false, tier, feature, code: "extreme_required", message: `Team spaces are part of Extreme (${extremeMonthlyLabel}). Extreme includes ${TEAM_SEATS} people total, counting the owner.${TAIL}` };
  }
  if (feature === "teamSeats" && Number(info.count ?? 0) > TEAM_SEATS) {
    return { ok: false, tier, feature, code: "seat_cap", message: `Team spaces include ${TEAM_SEATS} people total, counting the owner. This space is over that cap.` };
  }
  return { ok: true, tier, feature, code: "open", limit: TEAM_SEATS };
}

export function access(feature, info = {}) {
  return decide(currentTier(), feature, info);
}

// Remix 2 choices. Pro includes Studio. Extreme includes Owner. Free includes none.
// Publish to a website is Pro. A phone build is Extreme. A two-idea blend is Extreme.
export const REMIX_PART_TIER = {
  "screenshot-ui": "pro",
  "recording-prototype": "extreme",
  "penpot-design": "pro",
  "godot-kenney": "pro",
  "phaser-create": "pro",
  "bevy-starter": "extreme",
  "cc0-art": "pro",
  "level-maker": "extreme",
  "voices": "extreme",
  "smoke-test": "pro",
  "access-report": "pro",
  "publish-web": "pro",
  "publish-phone": "extreme",
  installer: "extreme",
  multiplayer: "extreme",
  "style-only": "pro",
  blend: "extreme",
  forks: "pro",
};

const PART_RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 2 };

export function remixAbilityAllowed(tier, ability) {
  const need = REMIX_PART_TIER[ability];
  if (!need) return false;
  const have = PART_RANK[String(tier || "free").toLowerCase()] ?? 0;
  const want = need === "extreme" ? 2 : 1;
  return have >= want;
}

export function remixAbilityGate({ tier = "free", ability } = {}) {
  const id = String(ability || "");
  const need = REMIX_PART_TIER[id];
  if (!need) return { ok: false, status: 400, code: "ability", ability: id, message: "That choice is not available." };
  if (!remixAbilityAllowed(tier, id)) {
    return {
      ok: false, status: 402, code: "ability_tier", ability: id, need, tier: String(tier || "free").toLowerCase(),
      message: need === "extreme" ? "That choice is on Extreme." : "That choice is on Pro.",
    };
  }
  return { ok: true, status: 200, code: null, ability: id, need, message: "" };
}

// Guided builders use Free, Pro, and Extreme. Studio follows Pro. Owner follows Extreme.
// This does not set a price and does not import license.js.
const BUILDER_RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 3 };

export function normalizeBuilderTier(tier) {
  const t = String(tier || "free").toLowerCase();
  return Object.prototype.hasOwnProperty.call(BUILDER_RANK, t) ? t : "free";
}

export function builderTierRank(tier) {
  return BUILDER_RANK[normalizeBuilderTier(tier)] ?? 0;
}

function builderNeedRank(need) {
  const name = normalizeBuilderTier(need);
  if (name === "extreme" || name === "owner") return BUILDER_RANK.extreme;
  if (name === "pro" || name === "studio") return BUILDER_RANK.pro;
  return BUILDER_RANK.free;
}

export function builderGate({ tier = "free", need = "free" } = {}) {
  const haveName = normalizeBuilderTier(tier);
  const needName = normalizeBuilderTier(need);
  const have = builderTierRank(haveName);
  const want = builderNeedRank(needName);
  const haveLabel = LIMITS[haveName]?.label || "Free";
  const asked = want >= BUILDER_RANK.extreme ? "extreme" : want >= BUILDER_RANK.pro ? "pro" : "free";
  if (have >= want) {
    return {
      ok: true, tier: haveName, need: asked, status: 200, code: null,
      message: asked === "free" ? "This builder is included." : `This builder is included on ${haveLabel}.`,
    };
  }
  if (asked === "extreme") {
    return { ok: false, tier: haveName, need: "extreme", status: 402, code: "extreme_required", message: "This builder is part of Extreme." };
  }
  return { ok: false, tier: haveName, need: "pro", status: 402, code: "pro_required", message: "This builder is part of Pro." };
}

export function assertBuilder(opts = {}) {
  const g = builderGate({ ...opts, tier: opts.tier ?? currentTier() });
  if (!g.ok) throw Object.assign(new Error(g.message), { status: g.status, code: g.code });
  return g;
}

// Guided builders for websites and marketing (builders A). Studio counts as Pro. Owner counts as every tier.
// need is "free", "pro", or "extreme". This does not set a price and does not import license.js.
const WEB_RANK = { free: 0, pro: 1, studio: 1, extreme: 2, owner: 3 };

export function tierRank(tier) {
  const t = String(tier || "free").toLowerCase();
  return Object.prototype.hasOwnProperty.call(WEB_RANK, t) ? WEB_RANK[t] : 0;
}

export function planLabel(tier) {
  const t = String(tier || "free").toLowerCase();
  return LIMITS[t]?.label || "Free";
}

export function webBuilderGate(need, tier = currentTier()) {
  const want = String(need || "free").toLowerCase();
  const have = String(tier || "free").toLowerCase();
  const ok = tierRank(have) >= tierRank(want === "studio" ? "pro" : want);
  const needLabel = planLabel(want);
  const haveLabel = planLabel(have);
  if (ok) {
    return {
      ok: true, status: 200, code: null, tier: have, need: want,
      message: `${needLabel} tools are included on ${haveLabel}.`,
    };
  }
  return {
    ok: false, status: 402, code: "plan_required", tier: have, need: want,
    message: `This is part of ${needLabel}. You are on ${haveLabel}.`,
    // 0.4.20: the page shows the plan and price before the form, not after the work
    priceNote: `${needLabel} is ${proMonthlyLabel} or ${proYearlyLabel}. You can fill this in and look first; building needs ${needLabel}.`,
  };
}

export const PUBLISH_NEEDS = {
  local: "free",
  netlify: "pro",
  vercel: "pro",
  postiz: "pro",
  listmonk: "pro",
  mautic: "pro",
  highlevel: "pro",
};

export function publishGate(target, tier = currentTier()) {
  const key = String(target || "local").toLowerCase();
  const need = Object.prototype.hasOwnProperty.call(PUBLISH_NEEDS, key) ? PUBLISH_NEEDS[key] : "pro";
  const gate = webBuilderGate(need, tier);
  if (gate.ok) return { ...gate, target: key };
  return {
    ...gate,
    target: key,
    message: key === "local"
      ? gate.message
      : `Publishing to ${key} is part of ${planLabel(need)}. You are on ${planLabel(tier)}. Nothing was sent.`,
  };
}
