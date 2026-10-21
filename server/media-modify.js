// Modify a picture or video that is already on this computer.
// Plan picks a capable connected AI and shows the price. Run is a second click.
// Nothing is posted, published, or sent. Bytes stay in the data folder.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertNoSecret, readIdeaFile, readOrderFile, readPending } from "./box-files.js";
import { MAX_SOURCE_BYTES, estimate, imageFile, makeImages } from "./images.js";
import { summary as ledgerSummary, recordCall } from "./ledger.js";
import { projectMediaDir } from "./media-jobs.js";
import { demoActive } from "./mock.js";
import { complete } from "./providers.js";
import { listProjects } from "./projects.js";
import { PROVIDERS, estimateCostAt } from "./registry.js";
import { DATA_DIR } from "./paths.js";
import { doc, putDoc, HOSTED } from "./store.js";
import { getSecret } from "./vault.js";

const DOC = "media.modify";
const JOB_ID = /^mm_[a-f0-9]{12}$/;
const VISION_IN = 1600;
const VISION_OUT = 350;
const IMAGE_EDIT = ["openai", "google", "replicate", "fal", "demo-image"];
const VISION = ["google", "openai", "anthropic", "xai"];
const KEY_IDS = ["openai", "google", "anthropic", "xai", "replicate", "fal"];

export const NO_EDIT = "No image editor is connected. Add an OpenAI, Gemini, Replicate, or fal key. Nothing was sent.";
export const NO_VISION = "No vision model is connected. Add a Gemini or OpenAI key. Nothing was sent.";
export const NO_TRIM = "This computer has no video trimmer yet. Install ffmpeg, or ask for a caption or a description instead. Nothing was changed.";
const TOO_BIG = "That picture is over 3.5 MB, so it can stay with the idea but it is too big to retouch. Make a smaller copy and upload that.";
const GIF = "A GIF can stay with the idea, but retouch and variation need a PNG, JPEG, or WebP. Nothing was changed.";

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

function has(ready, id) {
  if (typeof ready === "function") return !!ready(id);
  return !!ready?.[id];
}

export function classifyAsk(text, media) {
  const t = String(text || "").toLowerCase();
  const video = media === "video" || String(media || "").startsWith("video/");
  if (video) {
    if (/\b(trims?|cuts?|shorten|clip)\b/.test(t)) return "trim";
    if (/\b(captions?|subtitles?|titles)\b/.test(t)) return "caption";
    return "describe";
  }
  if (/\b(vary|variation|variations|another take|new take)\b/.test(t)) return "variation";
  if (/\b(describe|describes|description|what is|what's|caption)\b/.test(t)) return "describe";
  return "edit";
}

export function routeMedia({ media, task, ready, trimmer = false } = {}) {
  const video = media === "video";
  if (video && task === "trim") {
    if (trimmer) {
      return { kind: "video", task, provider: "local", model: "ffmpeg", usd: 0, demo: false, dryRun: false, message: "Trim on this computer with ffmpeg. Nothing is uploaded. Run is a separate click." };
    }
    return { kind: "video", task, provider: null, model: null, usd: 0, demo: false, dryRun: true, message: NO_TRIM };
  }
  if (!video && (task === "edit" || task === "variation")) {
    const provider = IMAGE_EDIT.find((id) => has(ready, id)) || null;
    if (!provider) return { kind: "image-edit", task, provider: null, model: null, usd: 0, demo: false, dryRun: true, message: NO_EDIT };
    const demo = provider === "demo-image";
    return { kind: "image-edit", task, provider, model: null, usd: null, demo, dryRun: demo, message: "" };
  }
  const provider = VISION.find((id) => has(ready, id)) || (has(ready, "demo") || (!video && has(ready, "demo-image")) ? "demo" : null);
  if (!provider) return { kind: "vision", task, provider: null, model: null, usd: 0, demo: false, dryRun: true, message: NO_VISION };
  const demo = provider === "demo";
  return { kind: "vision", task, provider, model: null, usd: demo ? 0 : null, demo, dryRun: demo, message: "" };
}

function findOnPath(names) {
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch { /* next */ }
    }
  }
  return null;
}

export function resolveFfmpeg() {
  const set = process.env.CC_FFMPEG_BIN;
  if (set === "off" || set === "0" || set === "false") return null;
  if (set) {
    if (/\.(mjs|cjs|js)$/i.test(set)) return { cmd: process.execPath, prefix: [path.resolve(set)] };
    return { cmd: set, prefix: [] };
  }
  const found = findOnPath(process.platform === "win32" ? ["ffmpeg.exe", "ffmpeg"] : ["ffmpeg"]);
  if (!found) return null;
  return { cmd: found, prefix: [] };
}

function capped(id) {
  const cap = Number(doc("alerts.caps", () => ({}))[id]) || 0;
  const stop = (doc("alerts.state", () => undefined)?.stop || []).includes(id);
  if (stop) return true;
  if (!cap) return false;
  const spent = ledgerSummary().byProvider?.[id]?.month || 0;
  return spent >= cap;
}

function connections() {
  const keyed = {};
  const ready = {};
  for (const id of KEY_IDS) {
    keyed[id] = !!getSecret(id, PROVIDERS[id]?.keyEnv)?.key;
    ready[id] = keyed[id] && !capped(id);
  }
  if (demoActive()) ready["demo-image"] = ready.demo = true;
  return { keyed, ready };
}

function mediaOf(file) {
  if (!file) return "";
  if (file.kind === "video" || String(file.mime || "").startsWith("video/")) return "video";
  if (file.kind === "image" || String(file.mime || "").startsWith("image/")) return "image";
  return "";
}

function loadFile(body) {
  const where = body?.where === "orders" ? "orders" : body?.where === "idea" ? "idea" : "";
  if (!where) throw fail(400, "Say whether the file is on an idea or in marching orders.");
  const id = String(body?.fileId || "");
  const file = where === "orders" ? readOrderFile(id) : (body?.ideaId ? readIdeaFile(body.ideaId, id) : readPending(id));
  if (!file?.buf) throw fail(404, "That file is not on this computer.");
  const media = mediaOf(file);
  if (!media) throw fail(400, "Modify is for a picture or a video. Nothing was changed.");
  return { where, file, media };
}

function defaultChatModel(id) {
  const models = PROVIDERS[id]?.models || [];
  return models.find((m) => m.default)?.id || models[0]?.id || "";
}

function fillRoute(route) {
  if (!route.provider) return route;
  if (route.kind === "image-edit") {
    const est = estimate({ provider: route.provider, op: route.task === "variation" ? "variation" : "edit", n: 1, size: "square", quality: "medium" });
    const verb = route.task === "variation" ? "make a variation" : "retouch this picture";
    const price = est.usd ? `About $${est.usd}. ` : "Demo, nothing spent. ";
    return {
      ...route,
      provider: est.provider,
      model: est.model,
      usd: est.usd,
      demo: route.demo,
      dryRun: !!route.demo || est.usd === 0,
      message: `${est.providerName} will ${verb}. ${price}Run is a separate click. Nothing is sent until then.`,
    };
  }
  if (route.kind === "video" && route.provider === "local") return { ...route, model: "ffmpeg", usd: 0 };
  if (route.provider === "demo") {
    const verb = route.task === "caption" ? "caption" : "description";
    return { ...route, model: "demo", usd: 0, demo: true, dryRun: true, message: `Demo, nothing spent. A sample ${verb} stays on this computer. Run is a separate click. Nothing is sent until then.` };
  }
  const model = defaultChatModel(route.provider);
  const usd = +estimateCostAt(model, VISION_IN, VISION_OUT).toFixed(4);
  const name = PROVIDERS[route.provider]?.name || route.provider;
  const verb = route.task === "caption" ? "caption this" : "describe this";
  return { ...route, model, usd, demo: false, dryRun: false, message: `${name} will ${verb}. About $${usd}. Run is a separate click. Nothing is sent until then.`, ask: undefined };
}

function blockedMessage(media, task, keyed) {
  const ids = (!media || media === "image") && (task === "edit" || task === "variation") ? IMAGE_EDIT : VISION;
  if (ids.some((id) => keyed[id])) return "A connected AI is at its spend cap, so nothing was changed.";
  return "";
}

export function plan(body = {}) {
  if (HOSTED) throw fail(400, "Media changes run in the desktop app for now. Nothing was changed.");
  const { file, media } = loadFile(body);
  const ask = assertNoSecret(body?.ask).trim();
  if (!ask) throw fail(400, "Write what you want done. Nothing was changed.");
  const task = classifyAsk(ask, media);
  const { keyed, ready } = connections();
  let route = routeMedia({ media, task, ready, trimmer: !!resolveFfmpeg() });
  if (!route.provider) {
    const blocked = blockedMessage(media, task, keyed);
    if (blocked) route = { ...route, message: blocked };
  } else route = fillRoute(route);
  return {
    task: route.task,
    provider: route.provider,
    model: route.model,
    kind: route.kind,
    message: route.message,
    usd: route.usd || 0,
    dryRun: !!route.dryRun,
    demo: !!route.demo,
    sends: false,
    name: file.name,
    media,
  };
}

function jobs() {
  return doc(DOC, () => ({ items: [] }));
}

function remember(row) {
  const d = jobs();
  const stored = { ...row };
  delete stored.buf;
  d.items.unshift(stored);
  d.items = d.items.slice(0, 100);
  putDoc(DOC, d);
  return stored;
}

function newJobId() {
  return `mm_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureJobDir(id) {
  const dir = path.join(DATA_DIR, "media-modify", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function publicJob(row, extra = {}) {
  return {
    id: row.id,
    task: row.task,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    usd: row.usd || 0,
    demo: !!row.demo,
    sample: !!row.sample,
    name: row.name,
    mime: row.mime,
    text: row.text || "",
    galleryId: row.galleryId || null,
    sends: false,
    ...extra,
  };
}

function seenOk(body, usd) {
  const seen = Number(body?.estimate);
  if (!(body?.estimate !== undefined && body?.estimate !== null && body?.estimate !== "" && seen + 1e-9 >= usd)) {
    throw fail(409, `Check the cost first: about $${usd}. Nothing was changed.`, { code: "estimate_first", estimate: usd });
  }
}

function runTrim(file, ask) {
  const spec = resolveFfmpeg();
  if (!spec) throw fail(400, NO_TRIM);
  const id = newJobId();
  const dir = ensureJobDir(id);
  const ext = path.extname(file.name || "").toLowerCase() || ".mp4";
  const input = path.join(dir, `in${ext}`);
  const output = path.join(dir, `out${ext}`);
  fs.writeFileSync(input, file.buf);
  return runProc(spec.cmd, [...spec.prefix, "-y", "-i", input, "-t", "8", "-c", "copy", output], 20000).then(() => {
    if (!fs.existsSync(output) || !fs.statSync(output).size) throw fail(400, "The trim did not finish. The video was not changed.");
    const row = remember({
      id, task: "trim", kind: "video", provider: "local", model: "ffmpeg", usd: 0, demo: false, sample: false,
      mime: file.mime, name: `trimmed-${file.name || "video"}`, file: output, createdAt: Date.now(),
    });
    return { job: publicJob(row), sends: false, message: "Trimmed on this computer. Nothing was uploaded." };
  }).catch((e) => {
    if (e.status) throw e;
    throw fail(400, "The trim did not finish. The video was not changed.");
  });
}

function runProc(cmd, args, ms) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr = (stderr + c.toString("utf8")).slice(-4000); });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      reject(new Error("timeout"));
    }, ms);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stderr });
      else reject(new Error("trim failed"));
    });
  });
}

function writeText(row, text) {
  const dir = ensureJobDir(row.id);
  const file = path.join(dir, "result.txt");
  fs.writeFileSync(file, text);
  row.file = file;
  row.mime = "text/plain";
  row.name = "result.txt";
  row.text = text.slice(0, 8000);
  return remember(row);
}

async function runVision(route, file, ask) {
  seenOk({ estimate: route._seen, confirm: true }, route.usd || 0);
  if (route.provider === "demo" || route.demo) {
    const verb = route.task === "caption" ? "Caption" : "Description";
    const text = `Sample. Nothing was spent.\n${verb} for ${file.name}.\nAsk: ${ask}\nThis stand-in stays on this computer. Connect Gemini or OpenAI when you want a model to look at it.\n`;
    const row = writeText({
      id: newJobId(), task: route.task, kind: "vision", provider: "demo", model: "demo", usd: 0, demo: true, sample: true, createdAt: Date.now(),
    }, text);
    return { job: publicJob(row), sends: false, message: "Demo, nothing spent. The sample stays on this computer." };
  }
  if (route.media === "video" && route.provider !== "google") {
    const name = PROVIDERS[route.provider]?.name || "That model";
    throw fail(400, `${name} can see pictures. This video was not sent. Add a Gemini key to caption a video, or ask for a trim. Nothing was changed.`);
  }
  const t0 = Date.now();
  const r = await complete({
    provider: route.provider,
    model: route.model,
    maxTokens: 600,
    system: "You describe or caption a picture or a short video. Plain text only. Do not invent a price. At most 200 words.",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `File name: ${file.name}\nAsk: ${ask}` },
        { type: "image", mime: file.mime, data: file.buf.toString("base64") },
      ],
    }],
  });
  const text = String(r.text || "").trim();
  if (!text) throw fail(502, "The model answered without text. Nothing was saved.");
  recordCall({ provider: route.provider, model: route.model, usage: r.usage || { input: VISION_IN, output: VISION_OUT }, role: "media-modify", ms: Date.now() - t0 });
  const row = writeText({
    id: newJobId(), task: route.task, kind: "vision", provider: route.provider, model: route.model, usd: route.usd || 0, demo: false, sample: false, createdAt: Date.now(),
  }, text);
  return { job: publicJob(row), sends: false, message: "Saved on this computer. Nothing was posted." };
}

export function editBlock(file) {
  if (file?.mime === "image/gif") return GIF;
  if ((file?.buf?.length || 0) > MAX_SOURCE_BYTES) return TOO_BIG;
  return "";
}

async function runEdit(route, file, ask) {
  const blocked = editBlock(file);
  if (blocked) throw fail(400, blocked);
  const est = estimate({ provider: route.provider, model: route.model, op: route.task === "variation" ? "variation" : "edit", n: 1, size: "square", quality: "medium" });
  seenOk({ estimate: route._seen }, est.usd);
  const made = await makeImages({
    provider: est.provider,
    model: est.model,
    op: est.op,
    prompt: ask,
    n: 1,
    size: "square",
    quality: "medium",
    estimate: est.usd,
    source: { dataUrl: `data:${file.mime};base64,${file.buf.toString("base64")}`, name: file.name },
  });
  const row = remember({
    id: newJobId(), task: route.task, kind: "image-edit", provider: est.provider, model: est.model, usd: est.usd,
    demo: !!route.demo, sample: false, mime: made.files?.[0]?.mime || "image/png", name: made.files?.[0]?.name || "image",
    galleryId: made.id, createdAt: Date.now(),
  });
  const price = est.usd ? `About $${est.usd}. ` : "Demo, nothing spent. ";
  return { job: publicJob(row), sends: false, message: `${price}The picture is in the gallery. Nothing was posted.` };
}

export async function run(body = {}) {
  if (HOSTED) throw fail(400, "Media changes run in the desktop app for now. Nothing was changed.");
  if (body?.confirm !== true) throw fail(400, "Run is a separate click. Nothing was changed.");
  const planned = plan(body);
  if (!planned.provider) throw fail(400, planned.message);
  const { file, media } = loadFile(body);
  const ask = assertNoSecret(body?.ask).trim();
  seenOk(body, planned.usd || 0);
  const route = { ...planned, media, _seen: body.estimate };
  if (planned.kind === "video") return runTrim(file, ask);
  if (planned.kind === "vision") return runVision(route, file, ask);
  return runEdit(route, file, ask);
}

export function resultFile(id) {
  if (!JOB_ID.test(String(id || ""))) return null;
  const row = jobs().items.find((item) => item.id === id);
  if (!row) return null;
  if (row.galleryId) {
    try {
      const f = imageFile(row.galleryId, 0);
      return { buf: f.bytes, mime: f.mime, name: row.name || f.name || "image" };
    } catch { return null; }
  }
  if (!row.file) return null;
  const full = path.resolve(row.file);
  const root = path.resolve(DATA_DIR) + path.sep;
  if (!full.startsWith(root) || !fs.existsSync(full)) return null;
  return { buf: fs.readFileSync(full), mime: row.mime || "application/octet-stream", name: row.name || path.basename(full) };
}

export function saveResult(body = {}) {
  const file = resultFile(body?.jobId);
  if (!file) throw fail(404, "That result is not on this computer.");
  const project = listProjects().find((item) => item.id === String(body?.projectId || ""));
  if (!project) throw fail(400, "Pick a project first. Nothing was posted.");
  const dir = projectMediaDir(project.id);
  const safe = String(file.name || "result").replace(/[^\w.()-]+/g, "_").slice(0, 60) || "result";
  const name = `${body.jobId}-${safe}`;
  fs.writeFileSync(path.join(dir, name), file.buf);
  return { saved: true, projectId: project.id, name, sends: false, message: "Saved in the project. Nothing was posted." };
}
