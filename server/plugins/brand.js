// Brand kit (Phase 1): a logo plus brand colours, name and tagline, saved per user in the
// "brand.kit" document. The browser module applies it to the app header; client share pages
// (Phase 4) import brandKit() / brandCss() from here so they carry the same look.
// The logo is stored as a small data: URL (PNG, JPEG, WebP or SVG, 400 KB max) after its bytes are
// checked against the declared type; SVGs with scripts, event handlers or embedded documents are
// refused. Nothing here touches keys, the ledger or any external service.
export const id = "brand";

const KIND = "brand.kit";
export const DEFAULTS = { name: "", tagline: "", primary: null, secondary: null, logo: null, updatedAt: null };
export const LIMITS = { logoBytes: 400 * 1024, name: 60, tagline: 120 };
const HEX = /^#[0-9a-f]{6}$/;
const DATA_URL = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/]+=*)$/;
const MAGIC = {
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
};
const SVG_UNSAFE = /<\s*script|\bon[a-z]+\s*=|javascript:|<\s*foreignObject|<\s*iframe|<\s*embed|<\s*object|<!ENTITY/i;

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "brand_invalid" });

export function validateLogo(dataUrl) {
  const s = String(dataUrl || "").trim();
  const m = s.match(DATA_URL);
  if (!m) throw bad("logo must be a data: URL of a PNG, JPEG, WebP or SVG image");
  const kind = m[1] === "svg+xml" ? "svg" : m[1];
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw bad("logo is empty");
  if (bytes.length > LIMITS.logoBytes) throw bad(`logo is too large (${Math.round(bytes.length / 1024)} KB; the limit is ${LIMITS.logoBytes / 1024} KB)`);
  if (kind === "svg") {
    const text = bytes.toString("utf8");
    if (!/<svg[\s>]/i.test(text)) throw bad("SVG logo has no <svg> element");
    if (SVG_UNSAFE.test(text)) throw bad("SVG logo contains scripts, event handlers or embedded documents");
  } else if (!MAGIC[kind](bytes)) throw bad(`logo bytes do not match the declared ${kind.toUpperCase()} type`);
  return s;
}

function color(v, field) {
  if (v === null || v === "") return null;
  const a = String(v).trim().toLowerCase();
  const hex = a.length === 4 && a[0] === "#" ? `#${a[1]}${a[1]}${a[2]}${a[2]}${a[3]}${a[3]}` : a;
  if (!HEX.test(hex)) throw bad(`${field} must be a #rrggbb colour`);
  return hex;
}
const text = (v, max, field) => {
  const t = String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > max) throw bad(`${field} must be ${max} characters or fewer`);
  return t;
};

// Pure: merge a partial update into the previous kit. Unknown fields are ignored.
export function normalize(input = {}, prev = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const out = { ...DEFAULTS, ...prev };
  if (input.name !== undefined) out.name = text(input.name, LIMITS.name, "name");
  if (input.tagline !== undefined) out.tagline = text(input.tagline, LIMITS.tagline, "tagline");
  if (input.primary !== undefined) out.primary = color(input.primary, "primary");
  if (input.secondary !== undefined) out.secondary = color(input.secondary, "secondary");
  if (input.logo !== undefined) out.logo = input.logo === null || input.logo === "" ? null : validateLogo(input.logo);
  out.updatedAt = Date.now();
  return out;
}

export const brandKit = (h) => ({ ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) });

// CSS for a share page or any page that wants the kit as variables (safe: colours are validated hex).
export function brandCss(kit) {
  const k = { ...DEFAULTS, ...kit };
  const name = JSON.stringify(k.name || "");
  return `:root{--brand-primary:${k.primary || "#22d3ee"};--brand-secondary:${k.secondary || k.primary || "#a78bfa"};--brand-name:${name};--brand-has-logo:${k.logo ? 1 : 0};}\n`;
}

const view = (h) => ({ ...brandKit(h), limits: LIMITS });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/brand/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, view(h));
  if (req.method === "GET" && p === "/css") {
    const css = brandCss(brandKit(h));
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(css) });
    res.end(css);
    return true;
  }
  if ((req.method === "POST" || req.method === "PUT") && (p === "" || p === "/")) {
    let next;
    try { next = normalize(body, brandKit(h)); } catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    h.putDoc(KIND, next);
    return h.json(res, 200, view(h));
  }
  if (req.method === "DELETE" && p === "/logo") { h.putDoc(KIND, { ...brandKit(h), logo: null, updatedAt: Date.now() }); return h.json(res, 200, view(h)); }
  if (req.method === "DELETE" && (p === "" || p === "/")) { h.putDoc(KIND, { ...DEFAULTS, updatedAt: Date.now() }); return h.json(res, 200, view(h)); }
  return false;
}
