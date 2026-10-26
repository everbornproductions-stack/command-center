// "Type it, get the finished thing" (0.4.21): the engine behind making a picture, a video or a voice straight
// from a chat message. One call to plan (what will run, the price, the generator prompt), one call to run.
//
//  - A cheap chat AI turns the plain request into the generator prompt (cheapest capable connected AI; the
//    demo AIs and any failure fall back to a plain local rewrite, so nothing ever blocks on it). The prompt is
//    never the result: the page shows it only under "How it was made".
//  - The best-value connected maker renders it (cheapest by default; the quality and max priority modes pick the
//    priciest). Demo mode and practice runs cost nothing and still give a finished (practice) result.
//  - Nothing here skips a guard: image prices go through the same estimate and spend cap checks as the Images
//    tab (server/images.js), video and voice through server/media-jobs.js. A price above the person's guard is
//    handed back as needsOk so the page asks once, inline.
//  - The result is named from the request in MindMedia and linked as a version of the one before it.
import { doc } from "./store.js";
import { demoActive } from "./mock.js";
import { demosHidden } from "./demo-visibility.js";
import { providerList, estimate as imageEstimate, makeImages, IMAGE_PROVIDERS } from "./images.js";
import * as M from "./media-jobs.js";
import { cheapest } from "./router.js";
import { PROVIDERS } from "./registry.js";
import { completeFallback } from "./fallback.js";
import { recordCall } from "./ledger.js";
import { updateAssetMeta } from "./project-media.js";
import { nameFromPrompt } from "../web/make-intent.js";

export const GUARD_DEFAULT_USD = 0.5;
export class MakeError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }
const bad = (m, s = 400, x) => new MakeError(s, m, x);

const settings = () => { try { return doc("settings", () => ({})) || {}; } catch { return {}; } };
export const guardUsd = () => { const n = Number(settings().makeAskAboveUsd); return n > 0 ? n : GUARD_DEFAULT_USD; };
const wantsBest = () => ["quality", "max"].includes(String(settings().defaultMode || "balanced"));

// ---------- what to make it with ----------
const KIND_LABEL = { image: "picture", video: "video", audio: "voice" };
function noMaker(kind) {
  if (kind === "image") return bad("Meldmind needs a picture maker for this, and none is connected yet. Add a key for OpenAI, Google Gemini, Replicate or fal and ask again.", 409, { code: "no_provider", next: { label: "Add a picture key", go: "settings" } });
  if (kind === "video") return bad("Meldmind needs a video maker for this, and none is connected yet. Add a Kling, fal or Runway key and ask again.", 409, { code: "no_provider", next: { label: "Add a video key", go: "settings" } });
  return bad("Meldmind needs a voice maker for this, and none is connected yet. Add an ElevenLabs key and ask again.", 409, { code: "no_provider", next: { label: "Add a voice key", go: "settings" } });
}
const practiceOk = () => demoActive() && !demosHidden();

function sizeFor(text) {
  const t = String(text || "");
  if (/\b(?:portrait|poster|story|phone wallpaper|vertical|tall)\b/i.test(t)) return "portrait";
  if (/\b(?:banner|wallpaper|landscape|panorama|panoramic|wide|header|cover)\b/i.test(t)) return "landscape";
  return "square";
}

export function pickImageMaker(request) {
  const size = sizeFor(request);
  const rows = providerList().filter((p) => !p.demo && p.ready && !p.capped && p.ops.includes("generate"));
  const priced = [];
  for (const p of rows) {
    try { const e = imageEstimate({ provider: p.id, op: "generate", n: 1, size, quality: "medium" }); if (!e.capped && !e.wouldExceed) priced.push(e); } catch { /* skip a provider that cannot price this */ }
  }
  if (priced.length) {
    priced.sort((a, b) => (wantsBest() ? b.usd - a.usd : a.usd - b.usd));
    return { ...priced[0], practice: false };
  }
  if (rows.length) throw bad("Every connected picture maker has reached its monthly spend cap. Raise a cap or wait for the month to roll over.", 402, { code: "capped", next: { label: "Open spend caps", go: "settings" } });
  if (practiceOk()) return { ...imageEstimate({ provider: "demo-image", op: "generate", n: 1, size, quality: "medium" }), practice: true };
  throw noMaker("image");
}

export function pickMediaMaker(kind, params) {
  const mk = kind === "audio" ? "voice" : kind;
  const list = M.ORDER[mk] || [];
  const live = [];
  for (const id of list) {
    if (!M.ready(id)) continue;
    try { const e = M.estimate({ provider: id, kind: mk, params }); if (!e.capped && !e.wouldExceed) live.push(e); } catch { /* skip */ }
  }
  if (live.length) { live.sort((a, b) => (wantsBest() ? b.usd - a.usd : a.usd - b.usd)); return { ...live[0], practice: false, mediaKind: mk }; }
  if (list.some((id) => M.ready(id))) throw bad(`Every connected ${KIND_LABEL[kind]} maker has reached its monthly spend cap. Raise a cap or wait for the month to roll over.`, 402, { code: "capped", next: { label: "Open spend caps", go: "settings" } });
  if (practiceOk()) { const id = M.chooseProvider(mk); return { ...M.estimate({ provider: id, kind: mk, params }), practice: true, mediaKind: mk }; }
  throw noMaker(kind);
}

// ---------- the plain request becomes the generator prompt ----------
const STYLE = {
  logo: "Clean, simple vector-style logo, bold shapes, balanced layout, plain background.",
  photo: "Natural light, sharp focus, realistic detail, well composed.",
  art: "Rich colour, clear subject, well composed.",
};
export function localPrompt(kind, request, { previous = "", change = "", another = 0 } = {}) {
  const base = String(previous || request || "").trim().replace(/[.\s]+$/, "");
  let t = base;
  if (change) t = `${base}. ${String(change).trim().replace(/[.\s]+$/, "")}`;
  else if (another) t = `${base}, a different take${another > 2 ? ` (take ${another})` : ""}`;
  if (kind === "video") return `${t}. Smooth camera movement, natural motion, cinematic light.`;
  if (kind === "audio") return String(request || t);
  if (change || another || previous) return t;
  if (/\blogo|icon|badge|emblem\b/i.test(t)) return `${t}. ${STYLE.logo}`;
  if (/\b(?:painting|drawing|illustration|cartoon|sketch|poster)\b/i.test(t)) return `${t}. ${STYLE.art}`;
  return `${t}. ${STYLE.photo}`;
}

async function aiPrompt(kind, request, { previous, change, another }) {
  let choice = null;
  try { choice = cheapest(60); } catch { choice = null; }
  if (!choice || PROVIDERS[choice.provider]?.demo) return null;
  const what = kind === "video" ? "an AI video generator" : "an AI image generator";
  const system = `You write one prompt for ${what}. Reply with the finished prompt only: one to three plain sentences with concrete visual details (subject, setting, light, style, mood). Do not add words to be printed in the picture unless the person asked for them. No quotes, no preamble, no lists.`;
  const user = change
    ? `Current prompt: ${previous}\nThe person now asks: ${change}\nWrite the updated prompt. Keep everything they did not ask to change.`
    : another
      ? `Current prompt: ${previous || request}\nWrite a different take on the same idea (new composition, same subject and style).`
      : `The person asked for: ${request}\nWrite the generator prompt.`;
  const t0 = Date.now();
  const r = await completeFallback({ provider: choice.provider, model: choice.model, maxTokens: 220, system, messages: [{ role: "user", content: user }] }, { missionId: "make-it", role: "prompt", small: true, tools: false, cls: { capability: "creative", difficulty: 1 }, mode: "economy" });
  try { recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: "make-it", role: "prompt", ms: Date.now() - t0 }); } catch { /* the ledger line is a nicety */ }
  const out = String(r.text || "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").slice(0, 1200);
  return out.length >= 8 ? { text: out, by: r.model || choice.model } : null;
}

export async function writePrompt(kind, request, opts = {}) {
  if (kind === "audio") return { text: String(request || "").trim(), by: "" };
  try {
    const ai = await aiPrompt(kind, request, opts);
    if (ai) return ai;
  } catch { /* a plain rewrite stands in */ }
  return { text: localPrompt(kind, request, opts), by: "" };
}

// ---------- plan: what will run, and what it costs. Spends nothing. ----------
export async function plan(body = {}) {
  const kind = ["image", "video", "audio"].includes(body.kind) ? body.kind : "";
  if (!kind) throw bad("Say whether to make a picture, a video or a voice.");
  const request = String(body.request || "").trim();
  if (!request) throw bad("Write what to make.");
  if (request.length > 3000) throw bad("That is a long request. Keep it under 3000 characters.");
  const seconds = Math.min(20, Math.max(3, Math.round(Number(body.seconds)) || 5));
  const another = Number(body.another) || 0;
  const gen = body.generatorPrompt ? { text: String(body.generatorPrompt).trim().slice(0, 4000), by: String(body.writtenBy || "") } : await writePrompt(kind, request, { previous: body.previousPrompt || "", change: body.change || "", another });
  let maker, usd, params = null;
  if (kind === "image") { maker = pickImageMaker(`${request} ${body.change || ""}`); usd = maker.usd; }
  else {
    params = kind === "video" ? { prompt: gen.text, duration: seconds } : { text: gen.text, prompt: gen.text };
    maker = pickMediaMaker(kind, params); usd = maker.practice ? 0 : maker.usd;
  }
  const practice = !!maker.practice;
  const guard = guardUsd();
  return {
    ok: true, kind, request, generatorPrompt: gen.text, writtenBy: gen.by || "", seconds: kind === "video" ? seconds : undefined,
    provider: maker.provider, providerName: maker.providerName, model: maker.model || null, size: maker.size || null, quality: maker.quality || null,
    usd: practice ? 0 : +Number(usd).toFixed(4), practice, guard,
    needsOk: !practice && Number(usd) > guard,
  };
}

// ---------- run: make it ----------
async function tag(projectId, assetId, { name, request, parentId }) {
  try { updateAssetMeta(projectId || "unfiled", assetId, { name, prompt: request, ...(parentId ? { parentId } : {}) }); } catch { /* the hub still lists it under its file name */ }
}

export async function run(body = {}) {
  const p = await plan(body);
  const prompt = String(body.generatorPrompt || p.generatorPrompt || "").trim().slice(0, 4000);
  if (!prompt) throw bad("Write what to make.");
  if (p.needsOk && !(Number(body.okUsd) + 1e-9 >= p.usd)) throw bad(`That costs about $${p.usd}. Say yes first.`, 409, { code: "needs_ok", plan: p });
  const projectId = body.projectId || null;
  const name = nameFromPrompt(body.request || p.request);
  const parent = body.parentAssetId || "";
  if (p.kind === "image") {
    const row = await makeImages({ provider: p.provider, model: p.model, op: "generate", prompt, n: 1, size: p.size || "square", quality: p.quality || "medium", estimate: p.practice ? 0 : p.usd, projectId, runId: null });
    const assetId = `job:${row.id}:0`;
    await tag(projectId, assetId, { name, request: body.request || p.request, parentId: parent });
    const f = row.files[0] || {};
    return { ok: true, kind: "image", state: "done", id: row.id, assetId, projectId: projectId || "unfiled", name, mime: f.mime || "image/png", fileName: f.name || "", fileUrl: `/images/${row.id}/file?i=0`, generatorPrompt: prompt, provider: p.provider, providerName: p.providerName, model: p.model, usd: p.usd, practice: p.practice, writtenBy: p.writtenBy };
  }
  const mk = p.kind === "audio" ? "voice" : "video";
  const params = p.kind === "video" ? { prompt, duration: p.seconds || 5 } : { text: prompt, prompt };
  const job = M.createJob({ provider: p.provider, kind: mk, params, projectId, approve: true, estimate: p.practice ? undefined : p.usd, origin: "chat" });
  const assetId = `job:${job.id}:0`;
  await tag(projectId, assetId, { name, request: body.request || p.request, parentId: parent });
  return { ok: true, kind: p.kind, state: "working", id: job.id, jobId: job.id, assetId, projectId: projectId || "unfiled", name, generatorPrompt: prompt, provider: p.provider, providerName: p.providerName, usd: p.usd, practice: p.practice, writtenBy: p.writtenBy };
}

// ---------- a video or voice job, as the page polls it ----------
export function jobStatus(id) {
  const job = M.getJob(String(id || ""));
  if (!job) throw bad("No such job.", 404);
  const pub = M.publicJob(job);
  const done = ["done", "dry-run"].includes(job.status);
  const file = pub.files?.[0] || null;
  return {
    ok: true, id: job.id, kind: job.kind === "voice" ? "audio" : job.kind, status: job.status, state: done ? "done" : ["failed", "declined"].includes(job.status) ? "error" : "working",
    progress: job.progress || null, error: job.error || "", practice: !!job.dryRun,
    fileUrl: done && file && !file.url ? `/media/file?id=${encodeURIComponent(job.id)}&i=0` : "", remoteUrl: done && file?.url ? file.url : "",
    fileName: file?.name || "", assetId: `job:${job.id}:0`,
  };
}

export { IMAGE_PROVIDERS };
