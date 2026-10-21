// Free, Pro, and Extreme limits. One place for the comparison table and the server gates.
// Features marked built: false have a gate and no screen.
import {
  extremeMonthlyLabel, extremeYearlyLabel, proMonthlyLabel, proYearlyLabel,
} from "./price-config.js";

export const PRO_AIS = 4;
export const EXTREME_AIS = 8;
export const FREE_AIS = 4;
export const FREE_CONCURRENT = 1;
export const PRO_CONCURRENT = 3;
export const EXTREME_CONCURRENT = 8;
export const PRO_DEEP_RESEARCH_PER_MONTH = 8;
export const PRO_INDUSTRY_PACKS = 1;
export const EXTREME_TEAM_SEATS = 5;
export const PRO_DESKTOP_APPS = 3;
export const PRO_RECIPES = 5;

const TAIL = " Add a licence key in Settings.";

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
  teamSeats: { kind: "cap", built: false },
  desktopApps: { kind: "cap", built: false },
  recipes: { kind: "cap", built: false },
  industryPacks: { kind: "cap", built: false },
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

const FREE = {
  missions: false, scheduler: false, councilsPerMonth: 5, projects: 3, subscriptionsTab: false,
  connectedServices: 1, emailAccounts: 1, phone: false, historySearch: false, sharedLearning: false, scores: false,
  aisPerCouncil: FREE_AIS, concurrentRuns: FREE_CONCURRENT,
  hostedBackground: false, hostedSchedules: false, teamSeats: 0,
  desktopApps: 0, recipes: 0, industryPacks: 0, auditLog: false, budgetCap: false, prioritySupport: false,
  deepResearchPerMonth: 0,
  earlyAccess: false, maxQuality: false,
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
  studio: { ...EXTREME, label: "Studio" },
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
  if (key === "teamSeats") return `Team spaces are part of Extreme (${extremeMonthlyLabel}). Extreme includes ${EXTREME_TEAM_SEATS} seats.${TAIL}`;
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

const COMPARE_ROWS = [
  { id: "councils", label: "Councils", key: "councilsPerMonth", monthly: true },
  { id: "ais", label: "AIs per council", key: "aisPerCouncil" },
  { id: "runs", label: "Runs at once", key: "concurrentRuns" },
  { id: "missions", label: "Missions", key: "missions", bool: true },
  { id: "deep", label: "Deep Research", key: "deepResearchPerMonth", monthly: true },
  { id: "packs", label: "Industry packs", key: "industryPacks", packs: true },
  { id: "audit", label: "Compliance audit log", key: "auditLog", bool: true },
  { id: "team", label: "Team seats", key: "teamSeats" },
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
  if (row.key === "teamSeats" && !value) return "No";
  if ((row.key === "desktopApps" || row.key === "recipes") && value === Infinity) return "Unlimited";
  return cellCap(value, row.monthly);
}

export function publicCompare(env = process.env) {
  const columns = [
    { id: "free", name: "Free", price: "$0" },
    { id: "pro", name: "Pro", price: `${proMonthlyLabel} or ${proYearlyLabel}` },
    { id: "extreme", name: "Extreme", price: `${extremeMonthlyLabel} or ${extremeYearlyLabel}` },
  ];
  const rows = COMPARE_ROWS.map((row) => ({
    id: row.id,
    label: row.label,
    cells: columns.map((col) => compareCell(col.id, row, env)),
  }));
  return { columns, rows, minWidth: 390 };
}
