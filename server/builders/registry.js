// Shared builder registry.
// Guided builders A and Guided builders B both use this file.
// Keep this API stable:
//   register({ id, title, tier, detect(ctx) })
// detect(ctx) returns false, true, or { why: "a plain sentence" }.
// ctx is a plain object. This app passes { text, connected }.
// A second register() with the same id replaces that one builder.
// Do not clear the registry when a plugin starts. The other branch's
// builders have to stay registered across a merge.

const builders = new Map();

function publicView(row) {
  const out = {};
  if (!row || typeof row !== "object") return out;
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "function") continue;
    out[k] = v;
  }
  return out;
}

export function register(spec) {
  if (!spec || typeof spec !== "object") throw new TypeError("register({ id, title, tier, detect }) needs an object");
  const id = String(spec.id || "").trim();
  if (!id) throw new TypeError("register needs an id");
  if (typeof spec.detect !== "function") throw new TypeError("register needs detect(ctx)");
  const row = { ...spec, id, title: String(spec.title || id), tier: String(spec.tier || "free").toLowerCase(), detect: spec.detect };
  builders.set(id, row);
  return publicView(row);
}

export function get(id) {
  return builders.get(String(id || "")) || null;
}

export function list() {
  return [...builders.values()].map(publicView);
}

export function detect(ctx) {
  const found = [];
  for (const row of builders.values()) {
    let hit = false;
    try { hit = row.detect(ctx || {}); } catch { hit = false; }
    if (!hit) continue;
    const why = typeof hit === "string" ? hit : (hit && hit.why) || "";
    found.push({ ...publicView(row), why });
  }
  return found;
}

// Tests only. App startup must not call this, or a sibling builder set would disappear.
export function _resetForTests() {
  builders.clear();
}

export { publicView };
