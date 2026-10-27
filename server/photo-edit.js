// Photo editor (flag_photoeditor, 0.4.19). Non-destructive: the original photo is never rewritten.
// A version is a recipe (slider settings) plus, when the browser sends it, a rendered copy saved as a NEW
// file in the project's media folder and listed in the gallery. The adjustments themselves run in the
// browser (web/photo-adjust.js), so nothing here calls an AI or spends money.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { doc, putDoc } from "./store.js";
import { getImage, imageFile, mediaDir } from "./images.js";
import { SLIDERS, PRESETS, normalizeRecipe, isBlank } from "../web/photo-adjust.js";

export { SLIDERS, PRESETS, normalizeRecipe };

const KEY = "photo.edits";
const JOBS = "media.jobs";
export const MAX_RENDER_BYTES = 12 * 1024 * 1024;
const MAX_VERSIONS_PER_PHOTO = 40;
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export class PhotoError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const bad = (msg, status = 400, code) => new PhotoError(status, msg, code);

const store = () => { const d = doc(KEY, () => ({ versions: [] })); if (!Array.isArray(d.versions)) d.versions = []; return d; };

// Prompts for the AI route. Every one says to keep the real photo and the faces as they are.
const KEEP = "Keep the original photo exactly as it is: the same people, faces, pose, objects and framing. Do not redraw, reshape, swap or invent anything. Change only the light and color.";
export const PROMPTS = [
  { id: "balance-light", title: "Balance the light", prompt: `Gently balance the light in this photo. Lift the dark areas a little and calm the brightest areas so nothing is washed out. ${KEEP}` },
  { id: "warm-golden", title: "Warm golden hour feel", prompt: `Give this photo the warm light of late afternoon. Soft gold in the light, natural skin. ${KEEP}` },
  { id: "cool-calm", title: "Cool and calm", prompt: `Give this photo a cool, calm morning feel with a soft blue cast in the shadows. Keep skin looking natural. ${KEEP}` },
  { id: "portrait-glow", title: "Soft portrait glow", prompt: `Make this portrait look softly lit and flattering. Even out the light on the face and keep real skin texture. Do not smooth away freckles, lines or pores. ${KEEP}` },
  { id: "crisp-detail", title: "Crisp detail", prompt: `Make this photo look crisper. Bring out texture in fabric, hair and surfaces without a halo or an over-sharpened look. ${KEEP}` },
  { id: "fix-backlight", title: "Rescue a backlit photo", prompt: `This photo was taken against a bright window or sky. Bring up the faces and foreground and keep the bright background from burning out. ${KEEP}` },
  { id: "true-color", title: "True color", prompt: `Correct the color cast so whites look white and skin looks natural. ${KEEP}` },
  { id: "moody-evening", title: "Moody evening", prompt: `Give this photo a moody evening look with deeper shadows and a little glow from the light sources. ${KEEP}` },
];

export function config() { return { sliders: SLIDERS, presets: PRESETS, prompts: PROMPTS, maxRenderBytes: MAX_RENDER_BYTES }; }

const publicVersion = (v) => ({ id: v.id, imageId: v.imageId, index: v.index, projectId: v.projectId || null, name: v.name, recipe: v.recipe, renderId: v.renderId || null, createdAt: v.createdAt });

export function listVersions({ imageId } = {}) {
  const items = store().versions.filter((v) => !imageId || v.imageId === String(imageId));
  return items.sort((a, b) => b.createdAt - a.createdAt).map(publicVersion);
}

function parseRender(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw bad("The edited picture must be a PNG, JPEG or WebP picture.", 400, "bad_render");
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw bad("The edited picture is empty.", 400, "bad_render");
  if (bytes.length > MAX_RENDER_BYTES) throw bad("The edited picture is too large to save (12 MB at most).", 413, "too_big");
  return { mime: m[1], bytes };
}

// Saves one version. The source photo is only read. A rendered copy goes to a new file with a new id.
export function saveVersion(body = {}) {
  const imageId = String(body.imageId || "");
  if (!imageId) throw bad("Pick a photo first.", 400, "no_photo");
  const src = getImage(imageId); // 404 when there is no such photo
  const index = Number(body.index) || 0;
  imageFile(imageId, index); // proves the original file exists; it is never written
  const recipe = normalizeRecipe(body.recipe);
  if (isBlank(recipe)) throw bad("Move at least one slider before saving a version.", 400, "blank");
  const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 80) || `Version ${store().versions.filter((v) => v.imageId === imageId).length + 1}`;
  const id = "pv-" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const projectId = body.projectId !== undefined ? body.projectId || null : src.projectId || null;
  let renderId = null;
  if (body.dataUrl) {
    const r = parseRender(body.dataUrl);
    const dir = mediaDir(projectId);
    renderId = "img-" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
    const file = path.join(dir, `${renderId}.${EXT[r.mime]}`);
    fs.writeFileSync(file, r.bytes, { flag: "wx" }); // wx: a name that exists is never overwritten
    const d = doc(JOBS, () => ({ items: [] }));
    if (!Array.isArray(d.items)) d.items = [];
    d.items.unshift({
      id: renderId, source: "images", kind: "image", provider: "photo-editor", op: "photo", status: "done",
      params: { prompt: `Photo edit: ${name}`, from: { imageId, index }, recipe },
      projectId, estimate: { usd: 0, note: "adjusted on this PC" }, cost: 0, ms: 0, demo: false, via: "local", fallback: false,
      createdAt: Date.now(), finishedAt: Date.now(), outputs: [file], mimes: [r.mime],
    });
    d.items = d.items.slice(0, 500);
    putDoc(JOBS, d);
  }
  const s = store();
  const row = { id, imageId, index, projectId, name, recipe, renderId, createdAt: Date.now() };
  s.versions.unshift(row);
  const seen = new Map();
  s.versions = s.versions.filter((v) => { const c = (seen.get(v.imageId) || 0) + 1; seen.set(v.imageId, c); return c <= MAX_VERSIONS_PER_PHOTO; });
  putDoc(KEY, s);
  return publicVersion(row);
}

// Removes a version and its edited copy. The original photo is never removed here.
export function deleteVersion(id) {
  const s = store();
  const v = s.versions.find((x) => x.id === id);
  if (!v) throw bad("No such version.", 404, "not_found");
  if (v.renderId) {
    const d = doc(JOBS, () => ({ items: [] }));
    const row = (d.items || []).find((j) => j.id === v.renderId && j.provider === "photo-editor");
    if (row) {
      const root = path.resolve(DATA_DIR) + path.sep;
      for (const f of row.outputs || []) { const full = path.resolve(f); if (full.startsWith(root)) { try { fs.rmSync(full, { force: true }); } catch {} } }
      d.items = d.items.filter((j) => j !== row);
      putDoc(JOBS, d);
    }
  }
  s.versions = s.versions.filter((x) => x.id !== id);
  putDoc(KEY, s);
  return { ok: true };
}
