// Text size and high contrast, saved per person. Read aloud is a browser control
// and does not speak until they click it.
export const id = "a11y";

const KIND = "a11y.prefs";
export const SIZES = ["small", "default", "large", "xlarge"];
export const DEFAULTS = { textSize: "default", contrast: false };

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "a11y_invalid" });

export function normalize(input = {}, prev = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const out = { textSize: prev.textSize || DEFAULTS.textSize, contrast: !!prev.contrast };
  if (input.textSize !== undefined) {
    const size = String(input.textSize || "").trim().toLowerCase();
    if (!SIZES.includes(size)) throw bad(`text size must be one of ${SIZES.join(", ")}`);
    out.textSize = size;
  }
  if (input.contrast !== undefined) out.contrast = !!input.contrast;
  out.updatedAt = Date.now();
  return out;
}

const current = (h) => ({ ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/a11y/, "");
  if (p !== "" && p !== "/") return false;
  if (req.method === "GET") return h.json(res, 200, { ...current(h), sizes: SIZES });
  if (req.method === "POST" || req.method === "PUT") {
    let next;
    try { next = normalize(body, current(h)); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    h.putDoc(KIND, next);
    return h.json(res, 200, { ...next, sizes: SIZES });
  }
  return false;
}
