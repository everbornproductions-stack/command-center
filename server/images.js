// Image generation in chat (Phase 21): generate, edit and variations through the person's own keys.
//
//  - Providers: OpenAI GPT-Image, Google Gemini (native image model), xAI, and Flux through Replicate or fal.
//    Each adapter is a few HTTP calls; base URLs come from the registry so tests point them at local mocks
//    (CC_BASE_URL_<ID>, ignored by installed builds).
//  - Edit and variation carry the source image (a gallery image or an upload). A variation is the source
//    image plus a "new take on this image" prompt; xAI makes new images only, and says so.
//  - The cost estimate comes first: /api/images/estimate, and a generate call must repeat the estimate it
//    showed (an older, lower one is refused with the current figure). One ledger line per image made
//    (kind "image", no prompt text). Spend caps (alerts plugin) are checked before any call: a provider at
//    its cap, or one this batch would push over it, is refused.
//  - Results are saved to the media gallery: the files go into the project's media folder next to the
//    Media tab's jobs, and each batch is a row in the same "media.jobs" list (kind "image"), with its prompt.
//  - No key: a clear "add a key" message, no call. Demo mode has a pretend provider that draws a local SVG
//    (no network, no cost). Hosted hub: not yet (the files live in the local data folder); the routes say so.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { localFetch } from "./loopback-fetch.js";
import { HOSTED, doc, putDoc } from "./store.js";
import { PROVIDERS, geminiBase } from "./registry.js";
import { getSecret } from "./vault.js";
import { summary as ledgerSummary, recordImage } from "./ledger.js";
import { emit } from "./events.js";
import { demoActive } from "./mock.js";
import { demosHidden, realJobSkipsDemo } from "./demo-visibility.js";
import { networkCause } from "./health.js";
import { filesFromTool, isDual, mcpConfigured, runService } from "./connect.js";

export const JOBS = "media.jobs"; // shared with the Media tab (server/plugins/media.js)
export const OPS = ["generate", "edit", "variation"];
export const SIZES = ["square", "portrait", "landscape"];
export const QUALITIES = ["low", "medium", "high"];
export const MAX_N = 4, MAX_PROMPT = 4000, MAX_SOURCE_BYTES = 3_500_000;
export const VARIATION_PROMPT = "Make a new variation of this image: same subject, style and colours, a fresh composition.";
const MIMES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

const devBase = (id, fallback) => (process.env.CC_PACKAGED !== "1" && process.env[`CC_BASE_URL_${id.toUpperCase()}`]) || fallback;

// Prices are per image in USD, as published by each provider in October 2026. They are estimates: the
// provider's bill is the truth (OpenAI edits also bill the source image as input tokens).
export const IMAGE_PROVIDERS = {
  openai: {
    id: "openai", name: "OpenAI GPT-Image", keyName: "OpenAI", where: "Settings > AI keys", ops: OPS,
    defaultModel: "gpt-image-1",
    models: {
      "gpt-image-1": { name: "GPT-Image 1", price: { low: [0.011, 0.016], medium: [0.042, 0.063], high: [0.167, 0.25] } },
      "gpt-image-1-mini": { name: "GPT-Image 1 mini", price: { low: [0.005, 0.006], medium: [0.011, 0.015], high: [0.036, 0.052] } },
    },
  },
  google: {
    id: "google", name: "Google Gemini", keyName: "Google Gemini", where: "Settings > AI keys", ops: OPS,
    defaultModel: "gemini-nano-banana-2.1",
    models: { "gemini-nano-banana-2.1": { name: "Gemini Nano Banana 2.1", price: 0.039 } },
  },
  xai: {
    id: "xai", name: "xAI Grok", keyName: "xAI", where: "Settings > AI keys", ops: ["generate"],
    defaultModel: "grok-imagine-image-2.0",
    models: { "grok-imagine-image-2.0": { name: "Grok Imagine Image 2.0", price: 0.07 } },
  },
  replicate: {
    id: "replicate", name: "Flux via Replicate", keyName: "Replicate", where: "Settings > Media", ops: OPS,
    defaultModel: "black-forest-labs/flux-schnell", editModel: "black-forest-labs/flux-kontext-pro",
    models: {
      "black-forest-labs/flux-schnell": { name: "Flux Schnell", price: 0.003 },
      "black-forest-labs/flux-dev": { name: "Flux Dev", price: 0.025 },
      "black-forest-labs/flux-1.1-pro": { name: "Flux 1.1 Pro", price: 0.04 },
      "black-forest-labs/flux-kontext-pro": { name: "Flux Kontext Pro (edits)", price: 0.04, edit: true },
    },
  },
  fal: {
    id: "fal", name: "Flux via fal", keyName: "fal.ai", where: "Settings > Media", ops: OPS,
    defaultModel: "fal-ai/flux/dev", editModel: "fal-ai/flux-pro/kontext",
    models: {
      "fal-ai/flux/schnell": { name: "Flux Schnell", price: 0.003 },
      "fal-ai/flux/dev": { name: "Flux Dev", price: 0.025 },
      "fal-ai/flux-pro/v1.1": { name: "Flux 1.1 Pro", price: 0.04 },
      "fal-ai/flux-pro/kontext": { name: "Flux Kontext Pro (edits)", price: 0.04, edit: true },
    },
  },
  "demo-image": {
    id: "demo-image", name: "Demo images", keyName: "", where: "", ops: OPS, demo: true,
    defaultModel: "demo-sketch", models: { "demo-sketch": { name: "Demo sketch (no network, free)", price: 0 } },
  },
};

export class ImageError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }
const bad = (msg, status = 400, extra) => new ImageError(status, msg, extra);

// ---------- keys, caps, estimates ----------
function secretOf(pid) {
  if (pid === "demo-image") return demoActive() ? { key: "demo" } : null;
  return getSecret(pid, PROVIDERS[pid]?.keyEnv);
}
const keyed = (pid) => !!secretOf(pid)?.key;
const mcpReady = (pid) => isDual(pid) && mcpConfigured(pid);
function capState(pid, add = 0) {
  const cap = Number(doc("alerts.caps", () => ({}))[pid]) || 0;
  const stop = (doc("alerts.state", () => undefined)?.stop || []).includes(pid);
  if (!cap) return { cap: null, spent: null, left: null, capped: stop, over: false };
  const spent = ledgerSummary().byProvider?.[pid]?.month || 0;
  return { cap, spent: +spent.toFixed(4), left: +Math.max(0, cap - spent).toFixed(4), capped: stop || spent >= cap, over: spent + add > cap + 1e-9 };
}

function pick(body = {}) {
  const pv = IMAGE_PROVIDERS[body.provider];
  if (!pv) throw bad("Pick an image provider: OpenAI, Google Gemini, xAI, Replicate or fal.");
  if (realJobSkipsDemo(pv)) throw bad("Demo images stay off while a real AI is connected. Pick a provider you have a key for.");
  if (pv.demo && !demoActive()) throw bad("Demo images are only there in demo mode. Turn demo mode on in Settings, or pick a provider you have a key for.");
  const op = body.op || "generate";
  if (!OPS.includes(op)) throw bad("op must be generate, edit or variation.");
  if (!pv.ops.includes(op)) throw bad(`${pv.name} makes new images only; it cannot ${op === "edit" ? "edit an image" : "make variations"}. Pick OpenAI, Gemini, Replicate or fal for that.`);
  let model = String(body.model || "").trim();
  if (!model) model = op !== "generate" && pv.editModel ? pv.editModel : pv.defaultModel;
  if (!pv.models[model]) throw bad(`${pv.name} has no image model called ${model}. Choose one of: ${Object.keys(pv.models).join(", ")}.`);
  // on Replicate and fal the plain Flux models make new images; edits and variations go through Kontext
  if (op !== "generate" && pv.editModel && !pv.models[model].edit) model = pv.editModel;
  const n = Math.round(Number(body.n ?? 1));
  if (!(n >= 1 && n <= MAX_N)) throw bad(`Ask for 1 to ${MAX_N} images.`);
  const size = body.size || "square", quality = body.quality || "medium";
  if (!SIZES.includes(size)) throw bad("size must be square, portrait or landscape.");
  if (!QUALITIES.includes(quality)) throw bad("quality must be low, medium or high.");
  return { pv, op, model, n, size, quality };
}

export function estimate(body = {}) {
  const { pv, op, model, n, size, quality } = pick(body);
  const pr = pv.models[model].price;
  const perImage = typeof pr === "number" ? pr : pr[quality][size === "square" ? 0 : 1];
  const usd = +(perImage * n).toFixed(4);
  const has = keyed(pv.id), ready = has || mcpReady(pv.id), cap = capState(pv.id, usd);
  return {
    provider: pv.id, providerName: pv.name, model, modelName: pv.models[model].name, op, n, size, quality, perImage, usd,
    note: `${n} image${n === 1 ? "" : "s"} x $${perImage} (${pv.models[model].name}${typeof pr === "number" ? "" : `, ${quality}, ${size}`})${pv.id === "openai" && op !== "generate" ? ", plus a little for reading the source image" : ""}`,
    keyed: has, ready, keyMessage: ready ? null : noKeyMessage(pv),
    capped: cap.capped, wouldExceed: !cap.capped && cap.over, cap: cap.cap, capLeft: cap.left,
  };
}
const noKeyMessage = (pv) => (pv.demo ? "Turn demo mode on in Settings to try demo images." : `No ${pv.keyName} key saved. Add your ${pv.keyName} key in ${pv.where} to make images with ${pv.name}.`);

export function providerList() {
  return Object.values(IMAGE_PROVIDERS).filter((p) => !p.demo || (demoActive() && !demosHidden())).map((p) => ({
    id: p.id, name: p.name, ops: p.ops, defaultModel: p.defaultModel, editModel: p.editModel || null, where: p.where, demo: !!p.demo,
    models: Object.entries(p.models).map(([id, m]) => ({ id, name: m.name, edit: !!m.edit, price: m.price })),
    keyed: keyed(p.id), ready: keyed(p.id) || mcpReady(p.id), capped: capState(p.id).capped,
  }));
}

// ---------- the gallery (rows in media.jobs, files in the project's media folder) ----------
const jobs = () => doc(JOBS, () => ({ items: [] }));
const isImage = (j) => j?.source === "images";
export function listImages({ projectId } = {}) {
  return jobs().items.filter((j) => isImage(j) && (!projectId || j.projectId === projectId)).map(view);
}
function view(j) {
  return { ...j, outputs: undefined, files: (j.outputs || []).map((f, i) => ({ i, name: path.basename(f), mime: j.mimes?.[i] || "image/png" })) };
}
function rowOf(id) {
  const j = jobs().items.find((x) => x.id === id && isImage(x));
  if (!j) throw bad("No such image.", 404);
  return j;
}
export const getImage = (id) => view(rowOf(id));
function safeFile(f) {
  const full = path.resolve(f), root = path.resolve(DATA_DIR) + path.sep;
  if (!full.startsWith(root)) throw bad("That file is outside the app's data folder.", 400);
  return full;
}
export function imageFile(id, i = 0) {
  const j = rowOf(id), f = j.outputs?.[Number(i) || 0];
  if (!f) throw bad("That image has no such file.", 404);
  const full = safeFile(f);
  if (!fs.existsSync(full)) throw bad("The image file is gone from the media folder.", 404);
  return { bytes: fs.readFileSync(full), mime: j.mimes?.[Number(i) || 0] || "image/png", name: path.basename(full) };
}
export function deleteImage(id) {
  const j = rowOf(id);
  for (const f of j.outputs || []) { try { fs.rmSync(safeFile(f), { force: true }); } catch {} }
  const d = jobs(); d.items = d.items.filter((x) => x.id !== id); putDoc(JOBS, d);
  return { ok: true };
}
export function mediaDir(projectId) {
  const d = path.join(DATA_DIR, "projects", String(projectId || "unfiled").replace(/[^a-z0-9-_]/gi, "_"), "media");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// The source image for an edit or variation: a gallery image ({ imageId, index }) or an upload (data URL).
function sourceOf(src) {
  if (!src || typeof src !== "object") throw bad("Edits and variations need a source image: pick one from the gallery or upload one.");
  if (src.imageId) {
    const f = imageFile(String(src.imageId), src.index);
    if (f.mime === "image/svg+xml") throw bad("Demo sketches cannot be sent to a real provider. Pick a real image or upload one.");
    return { bytes: f.bytes, mime: f.mime, from: { imageId: String(src.imageId), index: Number(src.index) || 0 } };
  }
  const m = String(src.dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw bad("The source image must be a PNG, JPEG or WebP picture.");
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) throw bad("The source image is empty.");
  if (bytes.length > MAX_SOURCE_BYTES) throw bad("The source image is too big (3.5 MB at most). Make it smaller and try again.", 413);
  return { bytes, mime: m[1], from: { upload: String(src.name || "upload").slice(0, 120) } };
}
const dataUrl = (s) => `data:${s.mime};base64,${s.bytes.toString("base64")}`;

// ---------- HTTP plumbing ----------
async function call(pv, url, opts, timeout = 120000) {
  let res;
  try { res = await localFetch(url, { ...opts, signal: AbortSignal.timeout(timeout) }); }
  catch (e) { throw bad(`Could not reach ${pv.name}: ${networkCause(e)}`, 502, { network: true }); }
  const txt = await res.text().catch(() => "");
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!res.ok) {
    const msg = String(j?.error?.message || j?.detail || j?.message || j?.error || txt || "").replace(/\s+/g, " ").slice(0, 200);
    if (res.status === 401 || res.status === 403) throw bad(`Key rejected (${res.status})${msg ? `: ${msg}` : ""}`, 502, { rejected: true });
    if (res.status === 402 || res.status === 429) throw bad(`${pv.name}: ${res.status === 429 ? "rate limited or out of quota" : "out of credits"}${msg ? ` (${msg})` : ""}`, 502);
    throw bad(`${pv.name}: HTTP ${res.status}${msg ? ` ${msg}` : ""}`, 502);
  }
  return j || {};
}
// A provider that answers with a link: fetch it (https, or the local mock address in development).
async function download(pv, u, base) {
  const ok = /^https:\/\//i.test(u) || (process.env.CC_PACKAGED !== "1" && base && /^http:\/\/127\.0\.0\.1[:/]/.test(base) && u.startsWith(new URL(base).origin));
  if (!ok) throw bad(`${pv.name} sent back an image address that is not https.`, 502);
  let r;
  try { r = await localFetch(u, { signal: AbortSignal.timeout(60000) }); } catch (e) { throw bad(`Could not download the image from ${pv.name}: ${networkCause(e)}`, 502); }
  if (!r.ok) throw bad(`Could not download the image from ${pv.name} (HTTP ${r.status}).`, 502);
  const mime = String(r.headers.get("content-type") || "").split(";")[0].trim();
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: MIMES[mime] && mime !== "image/svg+xml" ? mime : sniff(u) };
}
const sniff = (u) => (/\.jpe?g(\?|$)/i.test(u) ? "image/jpeg" : /\.webp(\?|$)/i.test(u) ? "image/webp" : "image/png");
const b64img = (b64, mime = "image/png") => ({ bytes: Buffer.from(String(b64), "base64"), mime });
const openaiSize = { square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" };
const ratio = { square: "1:1", portrait: "2:3", landscape: "3:2" };
const falSize = { square: "square_hd", portrait: "portrait_4_3", landscape: "landscape_4_3" };

// ---------- adapters: (job, secret, source) -> [{ bytes, mime }] ----------
const ADAPTERS = {
  async openai(job, sec, src) {
    const pv = IMAGE_PROVIDERS.openai, base = PROVIDERS.openai.baseUrl, auth = { authorization: `Bearer ${sec.key}` };
    let j;
    if (job.op === "generate") {
      j = await call(pv, `${base}/images/generations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ model: job.model, prompt: job.prompt, n: job.n, size: openaiSize[job.size], quality: job.quality }) });
    } else {
      const fd = new FormData();
      fd.append("model", job.model); fd.append("prompt", job.prompt); fd.append("n", String(job.n)); fd.append("size", openaiSize[job.size]); fd.append("quality", job.quality);
      fd.append("image[]", new Blob([src.bytes], { type: src.mime }), `source.${MIMES[src.mime]}`);
      j = await call(pv, `${base}/images/edits`, { method: "POST", headers: auth, body: fd });
    }
    return (j.data || []).filter((d) => d.b64_json).map((d) => b64img(d.b64_json, `image/${j.output_format === "jpeg" ? "jpeg" : j.output_format === "webp" ? "webp" : "png"}`));
  },
  async google(job, sec, src) {
    const pv = IMAGE_PROVIDERS.google, base = geminiBase(PROVIDERS.google);
    const out = [];
    for (let i = 0; i < job.n; i++) {
      const parts = [{ text: job.prompt }, ...(src ? [{ inline_data: { mime_type: src.mime, data: src.bytes.toString("base64") } }] : [])];
      // the key travels in a header, never in the URL
      const j = await call(pv, `${base}/models/${encodeURIComponent(job.model)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": sec.key, "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], store: false, generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio[job.size] } } }) });
      for (const p of j.candidates?.[0]?.content?.parts || []) { const d = p.inlineData || p.inline_data; if (d?.data) out.push(b64img(d.data, d.mimeType || d.mime_type || "image/png")); }
    }
    return out;
  },
  async xai(job, sec) {
    const pv = IMAGE_PROVIDERS.xai, base = PROVIDERS.xai.baseUrl;
    const j = await call(pv, `${base}/images/generations`, { method: "POST", headers: { authorization: `Bearer ${sec.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: job.model, prompt: job.prompt, n: job.n, response_format: "b64_json" }) });
    return (j.data || []).filter((d) => d.b64_json).map((d) => b64img(d.b64_json, "image/jpeg"));
  },
  async replicate(job, sec, src) {
    const pv = IMAGE_PROVIDERS.replicate, base = devBase("replicate", "https://api.replicate.com/v1");
    const headers = { authorization: `Bearer ${sec.key}`, "content-type": "application/json", prefer: "wait=60" };
    const out = [];
    for (let i = 0; i < job.n; i++) {
      const input = { prompt: job.prompt, aspect_ratio: ratio[job.size], output_format: "png", ...(src ? { input_image: dataUrl(src) } : {}) };
      let p = await call(pv, `${base}/models/${job.model}/predictions`, { method: "POST", headers, body: JSON.stringify({ input }) });
      for (let k = 0; k < 60 && !["succeeded", "failed", "canceled"].includes(p.status) && p.urls?.get; k++) {
        await new Promise((r) => setTimeout(r, 2000));
        p = await call(pv, p.urls.get, { headers: { authorization: `Bearer ${sec.key}` } });
      }
      if (p.status !== "succeeded") throw bad(`${pv.name}: the prediction ${p.status === "failed" || p.status === "canceled" ? p.status : "took too long"}${p.error ? ` (${String(p.error).slice(0, 160)})` : ""}`, 502);
      for (const u of [].concat(p.output || [])) out.push(await download(pv, String(u), base));
    }
    return out;
  },
  async fal(job, sec, src) {
    const pv = IMAGE_PROVIDERS.fal, base = devBase("fal", "https://fal.run");
    const out = [];
    const input = { prompt: job.prompt, ...(src ? { image_url: dataUrl(src), aspect_ratio: ratio[job.size] } : { image_size: falSize[job.size] }), num_images: job.n, output_format: "png" };
    const j = await call(pv, `${base}/${job.model}`, { method: "POST", headers: { authorization: `Key ${sec.key}`, "content-type": "application/json" }, body: JSON.stringify(input) });
    for (const im of j.images || []) if (im?.url) out.push(/^data:image\//.test(im.url) ? b64img(im.url.split(",")[1], im.url.slice(5).split(";")[0]) : await download(pv, im.url, base));
    return out;
  },
  async "demo-image"(job, _sec, src) {
    const out = [];
    for (let i = 0; i < job.n; i++) out.push({ bytes: Buffer.from(demoSvg(job, i, src)), mime: "image/svg+xml" });
    return out;
  },
};

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
// A pretend picture: two colours from the prompt, the prompt as a caption, the source image behind it for an edit.
export function demoSvg(job, i = 0, src = null) {
  const h = crypto.createHash("sha256").update(`${job.prompt}|${i}|${job.op}`).digest();
  const [w, ht] = job.size === "portrait" ? [512, 768] : job.size === "landscape" ? [768, 512] : [640, 640];
  const c1 = `hsl(${h[0] * 1.4 | 0},70%,55%)`, c2 = `hsl(${h[1] * 1.4 | 0},70%,35%)`;
  const words = String(job.prompt).slice(0, 160).split(/\s+/); const lines = []; let cur = "";
  for (const wd of words) { if ((cur + " " + wd).trim().length > 28) { lines.push(cur.trim()); cur = wd; } else cur += " " + wd; }
  if (cur.trim()) lines.push(cur.trim());
  const back = src && src.mime !== "image/svg+xml" ? `<image href="${dataUrl(src)}" width="${w}" height="${ht}" preserveAspectRatio="xMidYMid slice" opacity="0.55"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${back}<circle cx="${w * 0.72 | 0}" cy="${ht * 0.3 | 0}" r="${(h[2] % 60) + 50}" fill="#fff" opacity="0.25"/>${lines.slice(0, 6).map((l, k) => `<text x="32" y="${ht - 40 - (Math.min(lines.length, 6) - 1 - k) * 30}" font-family="sans-serif" font-size="24" fill="#fff">${xmlEsc(l)}</text>`).join("")}<text x="32" y="44" font-family="sans-serif" font-size="16" fill="#fff" opacity="0.8">Demo ${xmlEsc(job.op)} ${i + 1}</text></svg>`;
}

async function picsFromTool(pv, raw) {
  const file = filesFromTool(raw);
  const out = [];
  if (file.bytes?.length) out.push({ bytes: file.bytes, mime: MIMES[file.mime] ? file.mime : "image/png" });
  for (const u of file.urls || []) {
    if (/^data:image\//.test(u)) {
      const m = u.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
      if (m) out.push(b64img(m[2], m[1]));
    } else {
      const base = /^http:\/\/127\.0\.0\.1[:/]/.test(u) ? new URL(u).origin : devBase(pv.id, "https://fal.run");
      out.push(await download(pv, u, base));
    }
  }
  return out;
}

// ---------- one picture, no gallery row (0.4.21): the mission's image steps use this through server/media/imageai.js ----------
// Returns [{ bytes, mime }] from one provider with its saved key. Callers do the price check, the ledger line and the saving.
export async function rawImage(pid, { prompt, size = "square", quality = "medium", model = "", n = 1 } = {}) {
  const pv = IMAGE_PROVIDERS[pid];
  if (!pv || pv.demo) throw bad("Pick a real image provider: OpenAI, Google Gemini, xAI, Replicate or fal.");
  const sec = secretOf(pid);
  if (!sec?.key) throw bad(noKeyMessage(pv), 400, { code: "no_key" });
  const job = { op: "generate", model: model && pv.models[model] ? model : pv.defaultModel, n, size: SIZES.includes(size) ? size : "square", quality: QUALITIES.includes(quality) ? quality : "medium", prompt: String(prompt || "").slice(0, MAX_PROMPT) };
  if (!job.prompt) throw bad("Write what the image should show.");
  const pics = ((await ADAPTERS[pid](job, sec, null)) || []).filter((p) => p?.bytes?.length).slice(0, n);
  if (!pics.length) throw bad(`${pv.name} answered without an image.`, 502);
  return pics.map((p) => ({ bytes: p.bytes, mime: p.mime, ext: MIMES[p.mime] || "png" }));
}
// image providers that can make a picture now: a saved key (or MCP), not at a spend cap. Cheapest model first within a quality tier.
export function readyImageProviders() {
  return Object.values(IMAGE_PROVIDERS).filter((p) => !p.demo && (keyed(p.id) || mcpReady(p.id)) && !capState(p.id).capped).map((p) => p.id);
}
export function imageProviderInfo(pid) {
  const pv = IMAGE_PROVIDERS[pid];
  if (!pv) return null;
  const pr = pv.models[pv.defaultModel].price;
  const usd = typeof pr === "number" ? pr : pr.medium[0];
  return { id: pv.id, name: pv.name, keyName: pv.keyName, where: pv.where, usd, model: pv.defaultModel };
}

// ---------- generate / edit / variation ----------
export async function makeImages(body = {}) {
  if (HOSTED) throw bad("Image generation runs in the desktop app for now: the gallery lives in the local data folder.", 400);
  const est = estimate(body);
  const pv = IMAGE_PROVIDERS[est.provider];
  let prompt = String(body.prompt || "").trim();
  if (est.op === "variation" && !prompt) prompt = VARIATION_PROMPT;
  if (!prompt) throw bad("Write what the image should show.");
  if (prompt.length > MAX_PROMPT) throw bad(`The prompt is too long (${MAX_PROMPT} characters at most).`);
  // nothing is called without a key, over a cap, or before the person has seen the price
  if (!est.ready) throw bad(est.keyMessage || noKeyMessage(pv), 400, { code: "no_key" });
  if (est.capped) throw bad(`${pv.name} has reached its monthly spend cap, so no image was made. Raise the cap in Settings > Spend caps or wait for the month to roll over.`, 402, { code: "capped" });
  if (est.wouldExceed) throw bad(`These images (about $${est.usd}) would take ${pv.name} over its monthly spend cap ($${est.capLeft} left). Ask for fewer or cheaper images, or raise the cap.`, 402, { code: "capped" });
  const seen = Number(body.estimate);
  if (!(body.estimate !== undefined && body.estimate !== null && seen + 1e-9 >= est.usd)) throw bad(`Check the cost first: about $${est.usd} (${est.note}).`, 409, { code: "estimate_first", estimate: est });
  const src = est.op === "generate" ? null : sourceOf(body.source);
  const job = { op: est.op, model: est.model, n: est.n, size: est.size, quality: est.quality, prompt };
  const id = "img-" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const agent = `images:${id}`;
  emit("agent.start", { agent, provider: pv.id, model: est.model, role: "image", missionId: body.runId || null, label: `${pv.name} ${est.op === "generate" ? "making" : est.op === "edit" ? "editing" : "varying"} ${est.n === 1 ? "an image" : `${est.n} images`}` });
  const t0 = Date.now();
  let pics;
  let via = "key", fallback = false;
  try {
    const out = await runService(pv.id, "image", {
      args: { prompt: job.prompt, model: job.model, op: job.op, n: job.n, size: job.size, quality: job.quality },
      api: () => ADAPTERS[pv.id](job, secretOf(pv.id), src),
      mcp: (raw) => picsFromTool(pv, raw),
    });
    pics = out.result; via = out.via; fallback = !!out.fallback;
  }
  catch (e) { emit("agent.error", { agent, provider: pv.id, model: est.model, missionId: body.runId || null, error: e.message }); throw e instanceof ImageError ? e : bad(`${pv.name}: ${e.message}`, 502); }
  pics = (pics || []).filter((p) => p?.bytes?.length).slice(0, est.n);
  if (!pics.length) { emit("agent.error", { agent, provider: pv.id, model: est.model, missionId: body.runId || null, error: "no image" }); throw bad(`${pv.name} answered without an image. Nothing was saved.`, 502); }
  const ms = Date.now() - t0;
  const dir = mediaDir(body.projectId);
  const outputs = [], mimes = [];
  pics.forEach((p, i) => { const f = path.join(dir, `${id}${i ? "-" + i : ""}.${MIMES[p.mime] || "png"}`); fs.writeFileSync(f, p.bytes); outputs.push(f); mimes.push(MIMES[p.mime] ? p.mime : "image/png"); });
  // one ledger line per image, priced at the estimate's per-image figure; never the prompt
  for (let i = 0; i < pics.length; i++) recordImage({ provider: pv.id, model: est.model, op: est.op, cost: est.perImage, ms: i ? 0 : ms, missionId: body.runId || null, project: body.projectId || null });
  const cost = +(est.perImage * pics.length).toFixed(4);
  const row = {
    id, source: "images", kind: "image", provider: pv.id, op: est.op, status: "done",
    params: { prompt, model: est.model, size: est.size, quality: est.quality, n: est.n, from: src?.from || null },
    projectId: body.projectId || null, missionId: body.runId || null, runId: body.runId || null,
    estimate: { usd: est.usd, note: est.note }, cost, ms, demo: !!pv.demo, via, fallback, createdAt: Date.now(), finishedAt: Date.now(), outputs, mimes,
  };
  const d = jobs(); d.items.unshift(row); d.items = d.items.slice(0, 500); putDoc(JOBS, d);
  emit("agent.done", { agent, provider: pv.id, model: est.model, missionId: body.runId || null, ms, cost });
  const viaNote = via === "mcp" ? " Via MCP." : "";
  const stood = fallback ? " The other connection stood in." : "";
  emit("log", { text: `${pv.name}: ${pics.length} image${pics.length === 1 ? "" : "s"} saved to the gallery${cost ? ` (about $${cost})` : ""}.${viaNote}${stood}`, missionId: body.runId || null });
  return view(row);
}
