// Free and Pro for features this release owns.
// A later table can register more rows. Do this again is Pro.
// landed: false means the screen is not in the app yet.

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

// Pro rows throw 402 on the Free tier. Free rows always pass.
// tier is the current licence tier (free, pro, studio, owner, or a trial that already resolved to pro).
export function guardFeature(id, tier = "free") {
  const row = featureById(id);
  if (!row) {
    const e = new Error("Unknown feature.");
    e.status = 400;
    e.code = "feature";
    throw e;
  }
  if (row.tier !== "pro") return row;
  if (String(tier || "free") === "free") {
    const e = new Error(`${row.label} is part of Pro ($15.99/month). Add a licence key in Settings.`);
    e.status = 402;
    e.code = "pro_required";
    throw e;
  }
  return row;
}

function add(spec) { registerFeature(spec); }

add({ id: "privateMode", tier: "free", label: "Private mode", free: "Yes", pro: "Yes" });
add({ id: "backup", tier: "free", label: "Backup and restore", free: "Yes", pro: "Yes" });
add({ id: "doubleCheck", tier: "free", label: "Double-check this", free: "Yes", pro: "Yes" });
add({ id: "repeats", tier: "pro", label: "Do this again" });
