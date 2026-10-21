// One map for Free, Pro, Extreme, and Owner.
// Pro is $18.99/month. A Studio licence is treated as Pro. Extreme is $29.99/month.
// Owner is issued by hand. Caps that already exist stay on TIERS in server/license.js.
// A later feature calls registerFeature and then guardFeature(id, tier).
// landed: false means the screen is not in the app yet. The tier is still recorded.

const PRO_PRICE = "$18.99/month";
const PAID = new Set(["pro", "studio", "extreme", "owner"]);

const rows = [];

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
  const at = rows.findIndex((r) => r.id === id);
  if (at >= 0) rows[at] = row;
  else rows.push(row);
  return { ...row };
}

export function unregisterFeature(id) {
  const at = rows.findIndex((r) => r.id === id);
  if (at >= 0) rows.splice(at, 1);
}

export function featureById(id) {
  const row = rows.find((r) => r.id === id);
  return row ? { ...row } : null;
}

export function features() {
  return rows.map((r) => ({ ...r }));
}

// Rows for the Free vs Pro table. Not-yet-built items stay in the list so the
// promise matches the gate. Order is the order they were registered.
export function compareRows() {
  return rows.map((r) => [r.label, r.free, r.pro]);
}

export function tierPaid(tier) {
  return PAID.has(String(tier || "free").toLowerCase());
}

// Pro rows throw 402 on the Free tier. Free rows always pass.
// Studio is Pro. Extreme and Owner pass a Pro row. An Extreme-only row needs Extreme or Owner.
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
    const e = new Error(`${row.label} is part of Extreme ($29.99/month).`);
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
add({ id: "industryPacks", tier: "pro", label: "Industry packs", landed: false });
add({ id: "shareLinks", tier: "pro", label: "Public share links" });
add({ id: "exportDocs", tier: "pro", label: "PDF and Word export", landed: false });
add({ id: "backgroundRuns", tier: "pro", label: "Background runs", landed: false });
add({ id: "pauseMissions", tier: "pro", label: "Pause missions", landed: false });
add({ id: "sharedLearning", tier: "pro", label: "Shared learning", cap: "sharedLearning" });
add({ id: "scores", tier: "pro", label: "Scores dashboard", cap: "scores" });
add({ id: "phone", tier: "pro", label: "Phone pairing", cap: "phone" });
add({ id: "historySearch", tier: "pro", label: "Full history search", cap: "historySearch" });
add({ id: "subscriptions", tier: "pro", label: "Subscriptions tracker", cap: "subscriptionsTab" });
