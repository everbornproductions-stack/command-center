// Look (0.4.19, flag_look): the glass look setting and the saved graphics check.
//   GET  /api/look   -> { flag, choice, check }
//   POST /api/look   -> { choice?: auto|glass|classic, check?: { tier, fps, sig } }
// The flag is off unless CC_FLAG_LOOK=1. LOOK_FLAG_DEFAULT is switched to true in the 0.4.19 build once reviewed.
// Scoring and the choice rules are in web/look-core.js (pure, shared with the page).
import { normalizeChoice, TIERS } from "../../web/look-core.js";

export const id = "look";
export const LOOK_FLAG_DEFAULT = false;
const KIND = "look.prefs";

export function lookFlag(env = process.env) {
  const v = String(env.CC_FLAG_LOOK ?? "").trim();
  if (v === "1") return true;
  if (v === "0") return false;
  return LOOK_FLAG_DEFAULT;
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "look_invalid" });

export function normalizeCheck(c) {
  if (c === null) return null;
  if (!c || typeof c !== "object" || Array.isArray(c)) throw bad("check must be an object");
  if (!TIERS.includes(c.tier)) throw bad(`tier must be one of ${TIERS.join(", ")}`);
  const fps = Number(c.fps);
  return { tier: c.tier, fps: Number.isFinite(fps) ? Math.max(0, Math.min(1000, Math.round(fps))) : 0, sig: String(c.sig || "").slice(0, 300), at: Date.now() };
}

export function normalize(input, prev = { choice: "auto", check: null }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const out = { choice: prev.choice || "auto", check: prev.check || null };
  if (input.choice !== undefined) {
    const c = String(input.choice).trim().toLowerCase();
    if (c !== normalizeChoice(c)) throw bad("choice must be auto, glass or classic");
    out.choice = c;
  }
  if (input.check !== undefined) out.check = normalizeCheck(input.check);
  out.updatedAt = Date.now();
  return out;
}

const current = (h) => ({ choice: "auto", check: null, ...h.doc(KIND, () => ({ choice: "auto", check: null })) });
const view = (d) => ({ flag: lookFlag(), choice: normalizeChoice(d.choice), check: d.check || null });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/look/, "");
  if (p !== "" && p !== "/") return false;
  if (req.method === "GET") return h.json(res, 200, view(current(h)));
  if (req.method === "POST" || req.method === "PUT") {
    if (!lookFlag()) return h.json(res, 404, { error: "The new look is turned off on this install.", code: "flag_off" });
    let next;
    try { next = normalize(body, current(h)); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    h.putDoc(KIND, next);
    return h.json(res, 200, view(next));
  }
  return false;
}
