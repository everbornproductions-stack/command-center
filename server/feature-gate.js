// One map for Free and Pro. A later feature calls registerFeature and then guard(id).
// Caps that already exist (councils, projects, email, connected services) stay on TIERS.
// landed: false means the screen is not in the app yet. The tier is still recorded.

const rows = [];

export function registerFeature(spec) {
  const id = String(spec?.id || "").trim();
  if (!/^[a-z][a-zA-Z0-9]{1,40}$/.test(id)) throw new Error("feature id required");
  const tier = spec.tier === "free" ? "free" : "pro";
  const row = {
    id,
    tier,
    label: String(spec.label || id).slice(0, 80),
    free: String(spec.free ?? (tier === "free" ? "Yes" : "No")),
    pro: String(spec.pro ?? "Yes"),
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

function add(spec) { registerFeature(spec); }

add({ id: "tryItNow", tier: "free", label: "Try it now", free: "Yes", pro: "Yes" });
add({ id: "simpleMode", tier: "free", label: "Simple mode", free: "Yes", pro: "Yes" });
add({ id: "learningRouter", tier: "free", label: "Learning router", free: "Yes", pro: "Yes" });
add({ id: "safety", tier: "free", label: "Safety checks", free: "Yes", pro: "Yes", landed: false });
add({ id: "backup", tier: "free", label: "Backup and restore", free: "Yes", pro: "Yes", landed: false });
add({ id: "doubleCheck", tier: "free", label: "Double-check this", free: "Yes", pro: "Yes", landed: false });
add({ id: "connectedServices", tier: "free", label: "Connected services", free: "1", pro: "Unlimited", cap: "connectedServices" });
add({ id: "emailAccounts", tier: "free", label: "Email accounts per provider", free: "1", pro: "8", cap: "emailAccounts" });
add({ id: "projects", tier: "free", label: "Projects", free: "3", pro: "Unlimited", cap: "projects" });
add({ id: "councils", tier: "free", label: "Councils", free: "5 a month", pro: "Unlimited", cap: "councilsPerMonth" });
add({ id: "missions", tier: "pro", label: "Missions", cap: "missions" });
add({ id: "scheduler", tier: "pro", label: "Schedules", cap: "scheduler" });
add({ id: "repeats", tier: "pro", label: "Do this again", landed: false });
add({ id: "desktop", tier: "pro", label: "Desktop control", landed: false });
add({ id: "programScan", tier: "pro", label: "Program scan", landed: false });
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
