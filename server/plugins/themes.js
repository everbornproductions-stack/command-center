// Colour themes (Phase 1): light / dark / follow-the-system, an accent, a background colour,
// and an optional wallpaper (built-in gradient, built-in image, or a photo from a local file).
// Saved per user in the "themes.prefs" document (local: data/themes.prefs.json; hosted: a user_docs
// row). The browser module (web/features/themes.js) paints them. This side only validates and stores
// them. A wallpaper cannot be a web address. Nothing here touches keys or the ledger.
export const id = "themes";

const KIND = "themes.prefs";
export const MODES = ["dark", "light", "system"];
// Named presets the picker shows; any other #rrggbb value is accepted as a custom accent.
export const ACCENTS = {
  cyan: "#22d3ee", violet: "#a78bfa", green: "#34d399", amber: "#fbbf24", rose: "#fb7185", blue: "#60a5fa", orange: "#fb923c", lime: "#a3e635",
  teal: "#2dd4bf", indigo: "#818cf8", gold: "#e8b86d", magenta: "#e879f9",
};
export const BACKGROUNDS = {
  ink: "#090d14", midnight: "#0b1020", slate: "#1e293b", pine: "#10241c", paper: "#f4f1ea", sand: "#f6f1e7",
  charcoal: "#18181b", navy: "#0c1b33", wine: "#2a1218", fog: "#e7e5e4",
};
export const GRADIENTS = ["aurora", "dusk", "tide", "ember", "frost"];
// "stage" is a photo file shipped with the app (web/backgrounds, path in web/features/themes.js).
// It is the default picture since 0.4.17.
export const IMAGES = ["stage", "horizon", "orbit", "lattice", "bloom"];
// Theme presets: a mode, an accent name, a background name (or null), and a wallpaper id (or null).
export const LOOKS = {
  harbor: { mode: "dark", accent: "teal", background: "navy", wallpaper: null },
  ember: { mode: "dark", accent: "gold", background: null, wallpaper: "gradient:ember" },
  paper: { mode: "light", accent: "blue", background: "paper", wallpaper: null },
  aurora: { mode: "dark", accent: "violet", background: null, wallpaper: "gradient:aurora" },
};
// The default look since 0.4.17 (Chris, 2026-10-21): dark, cyan accent, pine background colour,
// and the built-in stage picture. It paints the same way as any picture wallpaper.
export const DEFAULTS = { mode: "dark", accent: ACCENTS.cyan, background: BACKGROUNDS.pine, wallpaper: "image:stage", photo: null };
// The look before 0.4.17, kept so tests and the migration can name it.
export const OLD_DEFAULTS = { mode: "dark", accent: ACCENTS.cyan, background: null, wallpaper: null, photo: null };
// Bump to move everyone to a new default once more.
export const DEFAULT_VERSION = 2;
export const NEW_BACKGROUND_NOTE = "New background. Change it any time in Settings > Appearance.";
export const PHOTO_LIMIT = 900 * 1024;
const HEX = /^#[0-9a-f]{6}$/;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/;

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "theme_invalid" });

export function validatePhoto(dataUrl) {
  const s = String(dataUrl ?? "").trim();
  if (/^https?:/i.test(s) || s.startsWith("//") || /url\s*\(/i.test(s)) throw bad("a photo must be a file on this computer, not a web address");
  const m = s.match(DATA_URL);
  if (!m) throw bad("photo must be a PNG, JPEG, or WebP from a file on this computer");
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw bad("photo is empty");
  if (bytes.length > PHOTO_LIMIT) throw bad(`photo is too large (the limit is ${Math.round(PHOTO_LIMIT / 1024)} KB)`);
  const kind = m[1];
  const ok = kind === "png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : kind === "jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!ok) throw bad(`photo bytes do not match ${kind.toUpperCase()}`);
  return `data:image/${kind};base64,${m[2]}`;
}

function parseWallpaper(raw) {
  const w = String(raw ?? "").trim().toLowerCase();
  if (!w) return null;
  if (/url\s*\(|https?:|javascript:|data:|\\|\s|\/\//i.test(w)) throw bad("wallpaper must be a built-in gradient, a built-in image, photo, or empty");
  if (w === "photo") return "photo";
  const g = /^gradient:([a-z]+)$/.exec(w);
  if (g) {
    if (!GRADIENTS.includes(g[1])) throw bad("unknown gradient");
    return `gradient:${g[1]}`;
  }
  const im = /^image:([a-z]+)$/.exec(w);
  if (im) {
    if (!IMAGES.includes(im[1])) throw bad("unknown image");
    return `image:${im[1]}`;
  }
  throw bad("wallpaper must be a built-in gradient, a built-in image, photo, or empty");
}

function colour(input, table, field) {
  const a = String(input ?? "").trim().toLowerCase();
  const named = table[a];
  const hex = named || (a.length === 4 && a[0] === "#" ? `#${a[1]}${a[1]}${a[2]}${a[2]}${a[3]}${a[3]}` : a);
  if (!HEX.test(hex)) throw bad(`${field} must be a #rrggbb colour, a preset name, or empty`);
  return hex;
}

// Pure: merge a partial update into the previous prefs, rejecting anything that is not a theme.
export function normalize(input = {}, prev = DEFAULTS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("body must be an object");
  const out = {
    mode: prev.mode || DEFAULTS.mode,
    accent: prev.accent || DEFAULTS.accent,
    background: prev.background ?? null,
    wallpaper: prev.wallpaper ?? null,
    photo: prev.photo ?? null,
  };
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
  if (input.background !== undefined) {
    out.background = input.background === null || input.background === "" ? null : colour(input.background, BACKGROUNDS, "background");
  }
  if (input.photo !== undefined) {
    out.photo = input.photo === null || input.photo === "" ? null : validatePhoto(input.photo);
    if (input.wallpaper === undefined) out.wallpaper = out.photo ? "photo" : (prev.wallpaper === "photo" ? null : out.wallpaper);
  }
  if (input.wallpaper !== undefined) {
    out.wallpaper = input.wallpaper === null || input.wallpaper === "" ? null : parseWallpaper(input.wallpaper);
    if (out.wallpaper !== "photo") out.photo = null;
  }
  if (out.wallpaper === "photo" && !out.photo) throw bad("choose a photo from a file on this computer");
  if (out.wallpaper !== "photo") out.photo = null;
  out.updatedAt = Date.now();
  return out;
}

const LOOK_FIELDS = ["mode", "accent", "background", "wallpaper", "photo"];
const pick = (p) => Object.fromEntries(LOOK_FIELDS.map((k) => [k, p?.[k] ?? (k === "mode" ? "dark" : k === "accent" ? ACCENTS.cyan : null)]));
const sameLook = (a, b) => LOOK_FIELDS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

// A brand-new install starts on the default and is already up to date: no note.
export function freshDoc(now = Date.now()) {
  return { ...DEFAULTS, defaultVersion: DEFAULT_VERSION, previous: null, notePending: false, updatedAt: now };
}

// One time per DEFAULT_VERSION: everyone moves to the default look. Whatever they had is kept
// as `previous` (unless it already was the default), so Undo or Settings can put it back.
// Pure. Returns { doc, changed }.
export function migrate(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return { doc: freshDoc(now), changed: true };
  if ((Number(raw.defaultVersion) || 0) >= DEFAULT_VERSION) return { doc: raw, changed: false };
  const had = pick({ ...OLD_DEFAULTS, ...raw });
  const previous = sameLook(had, DEFAULTS) ? null : had;
  return {
    doc: { ...DEFAULTS, defaultVersion: DEFAULT_VERSION, previous, notePending: true, migratedAt: now, updatedAt: now },
    changed: true,
  };
}

// Undo: put the saved previous look back. The previous slot is then empty.
export function restorePrevious(raw, now = Date.now()) {
  const d = raw && typeof raw === "object" ? raw : freshDoc(now);
  if (!d.previous) return { doc: d, restored: false };
  return { doc: { ...d, ...pick(d.previous), previous: null, notePending: false, updatedAt: now }, restored: true };
}

function load(h) {
  const raw = h.doc(KIND, () => freshDoc());
  const { doc, changed } = migrate(raw);
  if (changed) h.putDoc(KIND, doc);
  return doc;
}
const current = (h) => ({ ...DEFAULTS, ...load(h) });
// The saved previous look can hold a large photo. The browser only needs to know it exists.
const view = (h) => {
  const d = current(h);
  return {
    ...pick(d),
    updatedAt: d.updatedAt,
    hasPrevious: !!d.previous,
    note: d.notePending ? NEW_BACKGROUND_NOTE : null,
    defaults: pick(DEFAULTS),
    presets: ACCENTS,
    backgrounds: BACKGROUNDS,
    gradients: GRADIENTS,
    images: IMAGES,
    looks: LOOKS,
    modes: MODES,
  };
};
// Keep the migration flag and the saved previous look across normal saves.
const keep = (d) => ({ defaultVersion: d.defaultVersion, previous: d.previous ?? null, notePending: !!d.notePending });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/themes/, "");
  if (p === "/previous" && req.method === "POST") {
    const { doc, restored } = restorePrevious(current(h));
    if (restored) h.putDoc(KIND, doc);
    return h.json(res, restored ? 200 : 409, restored ? view(h) : { error: "There is no previous background to restore", code: "no_previous", ...view(h) });
  }
  if (p === "/note" && req.method === "POST") {
    const d = current(h);
    if (d.notePending) h.putDoc(KIND, { ...d, notePending: false });
    return h.json(res, 200, view(h));
  }
  if (p !== "" && p !== "/") return false;
  if (req.method === "GET") return h.json(res, 200, view(h));
  if (req.method === "POST" || req.method === "PUT") {
    const prev = current(h);
    let next;
    try { next = normalize(body, prev); } catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    h.putDoc(KIND, { ...next, ...keep(prev) });
    return h.json(res, 200, view(h));
  }
  if (req.method === "DELETE") { h.putDoc(KIND, { ...DEFAULTS, ...keep(current(h)), updatedAt: Date.now() }); return h.json(res, 200, view(h)); }
  return false;
}
