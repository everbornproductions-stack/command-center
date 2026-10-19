// Colour themes (Phase 1): light / dark / follow-the-system plus an accent colour, saved per user
// in the "themes.prefs" document (local: data/themes.prefs.json; hosted: a user_docs row), so every
// device of one user sees the same look. The browser module (web/features/themes.js) applies the
// values; this side only validates and stores them. Nothing here touches keys or the ledger.
export const id = "themes";

const KIND = "themes.prefs";
export const MODES = ["dark", "light", "system"];
// Named presets the picker shows; any other #rrggbb value is accepted as a custom accent.
export const ACCENTS = { cyan: "#22d3ee", violet: "#a78bfa", green: "#34d399", amber: "#fbbf24", rose: "#fb7185", blue: "#60a5fa", orange: "#fb923c", lime: "#a3e635" };
export const DEFAULTS = { mode: "dark", accent: ACCENTS.cyan };
const HEX = /^#[0-9a-f]{6}$/;

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "theme_invalid" });

// Pure: merge a partial update into the previous prefs, rejecting anything that is not a theme.
export function normalize(input = {}, prev = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const out = { mode: prev.mode || DEFAULTS.mode, accent: prev.accent || DEFAULTS.accent };
  if (input.mode !== undefined) {
    if (!MODES.includes(input.mode)) throw bad(`mode must be one of ${MODES.join(", ")}`);
    out.mode = input.mode;
  }
  if (input.accent !== undefined) {
    const a = String(input.accent ?? "").trim().toLowerCase();
    const named = ACCENTS[a];
    const hex = named || (a.length === 4 && a[0] === "#" ? `#${a[1]}${a[1]}${a[2]}${a[2]}${a[3]}${a[3]}` : a);
    if (!HEX.test(hex)) throw bad("accent must be a #rrggbb colour or a preset name");
    out.accent = hex;
  }
  out.updatedAt = Date.now();
  return out;
}

const current = (h) => ({ ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) });
const view = (h) => ({ ...current(h), presets: ACCENTS, modes: MODES });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/themes/, "");
  if (p !== "" && p !== "/") return false;
  if (req.method === "GET") return h.json(res, 200, view(h));
  if (req.method === "POST" || req.method === "PUT") {
    let next;
    try { next = normalize(body, current(h)); } catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    h.putDoc(KIND, next);
    return h.json(res, 200, view(h));
  }
  if (req.method === "DELETE") { h.putDoc(KIND, { ...DEFAULTS, updatedAt: Date.now() }); return h.json(res, 200, view(h)); }
  return false;
}
