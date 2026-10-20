// Colour themes (Phase 1): light / dark / follow-the-system, an accent colour, and a background.
// A background is a colour, a built-in gradient, a built-in image, or a photo read from a local
// file. Web addresses are refused. Prefs live in the "themes.prefs" document.
export const id = "themes";

const KIND = "themes.prefs";
export const MODES = ["dark", "light", "system"];
// Named presets the picker shows; any other #rrggbb value is accepted as a custom accent.
export const ACCENTS = { cyan: "#22d3ee", violet: "#a78bfa", green: "#34d399", amber: "#fbbf24", rose: "#fb7185", blue: "#60a5fa", orange: "#fb923c", lime: "#a3e635" };
export const BACKGROUNDS = { ink: "#090d14", midnight: "#0b1020", slate: "#1e293b", pine: "#10241c", paper: "#f4f1ea", sand: "#f6f1e7" };
// Fixed looks only. The stored value is an id, never a web address or a block of CSS from the user.
export const GRADIENTS = {
  dusk: { label: "Dusk", light: false, css: "linear-gradient(160deg, #1a1030 0%, #0b1020 45%, #12324a 100%)" },
  tide: { label: "Tide", light: false, css: "linear-gradient(165deg, #06202a 0%, #0e3b46 50%, #14532d 100%)" },
  ember: { label: "Ember", light: false, css: "linear-gradient(160deg, #2a120c 0%, #1c100e 40%, #3b1d12 100%)" },
  grove: { label: "Grove", light: true, css: "linear-gradient(165deg, #e7f0e4 0%, #d5e4dc 50%, #efe6d6 100%)" },
};
const svgUrl = (body) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  const data = encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `url('data:image/svg+xml,${data}')`;
};
export const IMAGES = {
  night: { label: "Night", light: false, css: svgUrl("<rect width='120' height='80' fill='#070b14'/><circle cx='92' cy='18' r='8' fill='#f4f1ea'/><circle cx='18' cy='22' r='1' fill='#e5e7eb'/><circle cx='40' cy='14' r='0.8' fill='#e5e7eb'/><circle cx='70' cy='28' r='0.9' fill='#e5e7eb'/>") },
  dunes: { label: "Dunes", light: false, css: svgUrl("<rect width='120' height='80' fill='#1c140e'/><path d='M0 50 Q30 30 60 48 T120 42 V80 H0 Z' fill='#3b2a1a'/><path d='M0 62 Q40 48 80 60 T120 56 V80 H0 Z' fill='#6b4f32'/>") },
  harbor: { label: "Harbor", light: false, css: svgUrl("<rect width='120' height='80' fill='#0b1c2c'/><rect y='46' width='120' height='34' fill='#134e6f'/><rect y='58' width='120' height='8' fill='#1d6a8a'/><rect x='18' y='36' width='16' height='18' fill='#0f172a'/><rect x='40' y='28' width='10' height='26' fill='#1e293b'/>") },
};
export const DEFAULTS = { mode: "dark", accent: ACCENTS.cyan, background: null, photo: null };
const HEX = /^#[0-9a-f]{6}$/;
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const PHOTO_MAX = 400000;
const BG_BAD = "background must be a #rrggbb colour, a preset name, a built-in image, a gradient, or empty";

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "theme_invalid" });

export function cleanPhoto(value) {
  if (typeof value !== "string") throw bad("photo must be a JPEG, PNG, or WebP file from this computer");
  const data = value.replace(/\s+/g, "");
  if (data.length > PHOTO_MAX || data.length < 32 || !PHOTO.test(data)) throw bad("photo must be a JPEG, PNG, or WebP file from this computer");
  return data;
}

function shortHex(a) {
  return a.length === 4 && a[0] === "#" ? `#${a[1]}${a[1]}${a[2]}${a[2]}${a[3]}${a[3]}` : a;
}

// Pure: merge a partial update into the previous prefs, rejecting anything that is not a theme.
export function normalize(input = {}, prev = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const out = { mode: prev.mode || DEFAULTS.mode, accent: prev.accent || DEFAULTS.accent, background: prev.background ?? null, photo: prev.photo || null };
  if (input.mode !== undefined) {
    if (!MODES.includes(input.mode)) throw bad(`mode must be one of ${MODES.join(", ")}`);
    out.mode = input.mode;
  }
  if (input.accent !== undefined) {
    const a = String(input.accent ?? "").trim().toLowerCase();
    const hex = ACCENTS[a] || shortHex(a);
    if (!HEX.test(hex)) throw bad("accent must be a #rrggbb colour or a preset name");
    out.accent = hex;
  }
  if (input.background !== undefined) {
    if (input.background === null || input.background === "") {
      out.background = null;
      out.photo = null;
    } else {
      const a = String(input.background).trim().toLowerCase();
      if (a.startsWith("gradient:")) {
        const id = a.slice("gradient:".length);
        if (!GRADIENTS[id]) throw bad(BG_BAD);
        out.background = `gradient:${id}`;
        out.photo = null;
      } else if (a.startsWith("image:")) {
        const id = a.slice("image:".length);
        if (!IMAGES[id]) throw bad(BG_BAD);
        out.background = `image:${id}`;
        out.photo = null;
      } else if (a === "photo") {
        out.background = "photo";
      } else {
        const hex = BACKGROUNDS[a] || shortHex(a);
        if (!HEX.test(hex)) throw bad(BG_BAD);
        out.background = hex;
        out.photo = null;
      }
    }
  }
  if (out.background === "photo") {
    if (input.photo !== undefined) out.photo = cleanPhoto(input.photo);
    else if (!out.photo) throw bad("photo must be a JPEG, PNG, or WebP file from this computer");
  } else out.photo = null;
  out.updatedAt = Date.now();
  return out;
}

const current = (h) => ({ ...DEFAULTS, ...h.doc(KIND, () => ({ ...DEFAULTS })) });
const view = (h) => ({ ...current(h), presets: ACCENTS, backgrounds: BACKGROUNDS, gradients: GRADIENTS, images: IMAGES, modes: MODES });

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
  if (req.method === "DELETE") { h.putDoc(KIND, { ...DEFAULTS, photo: null, updatedAt: Date.now() }); return h.json(res, 200, view(h)); }
  return false;
}
