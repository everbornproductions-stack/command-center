// Pictures, video and voice from whichever connected maker works (0.4.21, Chris note 8, audit rows 37 and 38).
// - Lists every connected maker for a kind: image = OpenAI, Gemini, xAI, Replicate, fal.ai (server/images.js) plus Runway;
//   video = Kling, fal.ai, Runway; voice = ElevenLabs (server/media-jobs.js).
// - When the first fails (credits gone, bad key, a provider outage) the next connected one makes it. Every try is recorded.
// - With none connected it says BEFORE anything is sent which key to add and where. It never saves a placeholder as the result.
// Same shape as server/media-preflight.js (K-dog) mediaStatus(), so either can feed the same banner.
import { doc, putDoc } from "./store.js";
import { providerList, estimate as imageEstimate, makeImages } from "./images.js";
import * as M from "./media-jobs.js";
import { emit } from "./events.js";

const LABEL = { image: "Picture", video: "Video", voice: "Voice-over" };
const WHAT = { image: "pictures", video: "video", voice: "a voice-over" };
const norm = (k) => (k === "audio" ? "voice" : k);

// Where each key goes, in the words a person sees in Settings.
const WHERE = {
  openai: { key: "OpenAI", at: "Settings > AI keys" }, google: { key: "Google Gemini", at: "Settings > AI keys" }, xai: { key: "xAI", at: "Settings > AI keys" },
  replicate: { key: "Replicate", at: "Settings > Media" }, fal: { key: "fal.ai", at: "Settings > Media" }, runway: { key: "Runway", at: "Settings > Media" },
  kling: { key: "Kling", at: "Settings > Media" }, elevenlabs: { key: "ElevenLabs", at: "Settings > Media" },
};
const FIRST_ASK = { image: ["fal", ["openai", "google", "xai"]], video: ["kling", ["fal", "runway"]], voice: ["elevenlabs", []] };

/** The plain "add this key" line shown where the feature lives, before the person spends or sends anything. */
export function setupMessage(kind) {
  const k = norm(kind);
  const [first, others] = FIRST_ASK[k] || FIRST_ASK.image;
  const w = WHERE[first];
  let msg = `Add your ${w.key} key in ${w.at} to make ${WHAT[k]}.`;
  if (others.length) {
    const names = others.map((o) => WHERE[o].key);
    const places = [...new Set(others.map((o) => WHERE[o].at))];
    msg += ` Or add ${names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0]} in ${places.join(" or ")}.`;
  }
  return msg;
}

const imageSize = (size) => (["square", "portrait", "landscape"].includes(size) ? size : "square");

/** Every maker that is connected for this kind, cheapest first; makers at their spend cap come last, flagged. */
export function candidates(kind, { size = "square", params } = {}) {
  const k = norm(kind);
  const ready = [];
  const capped = [];
  const add = (row) => (row.capped ? capped : ready).push(row);
  if (k === "image") {
    for (const p of providerList().filter((x) => !x.demo && x.ready && x.ops.includes("generate"))) {
      try {
        const e = imageEstimate({ provider: p.id, op: "generate", n: 1, size: imageSize(size), quality: "medium" });
        add({ via: "images", id: p.id, name: p.name, usd: e.usd, model: e.model, capped: !!(e.capped || e.wouldExceed), size: e.size, quality: e.quality });
      } catch { /* a provider that cannot price this is skipped */ }
    }
    ready.sort((a, b) => a.usd - b.usd);
  }
  for (const id of M.ORDER[k] || []) {
    if (k === "image" && (ready.some((r) => r.id === id) || capped.some((r) => r.id === id))) continue; // fal is already in the list above
    if (!M.ready(id)) continue;
    try {
      const e = M.estimate({ provider: id, kind: k, params: params || { prompt: "x", text: "x" } });
      add({ via: "media", id, name: e.providerName, usd: e.usd, capped: !!(e.capped || e.wouldExceed) });
    } catch { /* skip */ }
  }
  return [...ready, ...capped];
}

/** Can this kind be made now, and by whom? Same shape as media-preflight mediaStatus(). */
export function status(kind, opts = {}) {
  const k = norm(kind);
  const list = candidates(k, opts);
  const ready = list.filter((c) => !c.capped);
  const capped = list.filter((c) => c.capped);
  const label = LABEL[k];
  if (ready.length) {
    const main = ready[0];
    const alt = ready.slice(1).map((r) => r.name);
    return { kind: k, label, ok: true, provider: main.id, providerName: main.name, usd: main.usd, ready, missing: capped, alternatives: alt,
      message: `${label}: ${main.name} will make it${alt.length ? `. If it fails, ${alt.join(" or ")} steps in` : ""}.` };
  }
  if (capped.length) {
    return { kind: k, label, ok: false, provider: null, providerName: capped[0].name, ready: [], missing: capped, alternatives: [],
      message: `${label} is blocked: ${capped.map((c) => c.name).join(" and ")} reached its spending cap. Raise the cap in Settings > Spend caps or add another ${k === "image" ? "picture" : k} key. ${setupMessage(k)}` };
  }
  return { kind: k, label, ok: false, provider: null, providerName: null, ready: [], missing: [], alternatives: [], message: setupMessage(k) };
}

const why = (e) => String(e?.message || e || "failed").replace(/\s+/g, " ").slice(0, 160);

export class SwitchError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }

// ---------- one picture, with another maker standing in ----------
/** Make one picture. Tries each connected maker in turn. Returns { row, maker, tried }. Throws SwitchError when none can. */
export async function makeImageSwitch({ prompt, size = "square", projectId = null, runId = null, maxUsd, first, make = makeImages } = {}) {
  const list = candidates("image", { size }).filter((c) => !c.capped && c.via === "images").sort((a, b) => (b.id === first) - (a.id === first));
  if (!list.length) throw new SwitchError(409, status("image").message, { code: "no_provider", next: { label: "Add a picture key", go: "settings" } });
  const tried = [];
  for (const c of list) {
    if (maxUsd != null && c.usd > maxUsd + 1e-9) { tried.push({ id: c.id, name: c.name, ok: false, reason: `about $${c.usd}, over the $${maxUsd} you allowed` }); continue; }
    try {
      const row = await make({ provider: c.id, model: c.model, op: "generate", prompt, n: 1, size: c.size || size, quality: c.quality || "medium", estimate: c.usd, projectId, runId });
      tried.push({ id: c.id, name: c.name, ok: true });
      if (tried.length > 1) emit("log", { text: `${tried.filter((t) => !t.ok).map((t) => t.name).join(" and ")} could not make the picture, so ${c.name} did.`, missionId: runId || undefined });
      return { row, maker: c, tried };
    } catch (e) {
      tried.push({ id: c.id, name: c.name, ok: false, reason: why(e) });
      emit("log", { text: `${c.name} could not make the picture (${why(e)}). Trying the next connected picture AI.`, level: "error", missionId: runId || undefined });
    }
  }
  throw new SwitchError(502, `No picture was made. ${tried.map((t) => `${t.name}: ${t.reason}`).join(". ")}. ${setupMessage("image")}`, { code: "all_failed", tried });
}

// ---------- a video or voice job, with another maker standing in ----------
const KEY = "media.switch"; // job id -> { alts: [{id,name}], params, kind, projectId, switchedTo }
const plans = () => doc(KEY, () => ({ items: {} }));
export const switchInfo = (jobId) => plans().items[jobId] || null;
function remember(jobId, rec) { const d = plans(); d.items[jobId] = rec; const keys = Object.keys(d.items); if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete d.items[k]; putDoc(KEY, d); }

/** Start a video or voice job on the best connected maker; if it fails later, the next one is started automatically. */
export function startMediaSwitch({ kind, params, projectId = null, missionId = null, missionTaskId = null, usd, first, create = M.createJob } = {}) {
  const k = norm(kind);
  const list = candidates(k, { params }).filter((c) => !c.capped && c.via === "media").sort((a, b) => (b.id === first) - (a.id === first));
  if (!list.length) throw new SwitchError(409, status(k).message, { code: "no_provider", next: { label: `Add a ${k === "voice" ? "voice" : "video"} key`, go: "settings" } });
  const [head, ...rest] = list;
  const job = create({ provider: head.id, kind: k, params, projectId, missionId, missionTaskId, approve: true, estimate: usd ?? head.usd, origin: "chat" });
  if (rest.length) remember(job.id, { kind: k, params, projectId, missionId, missionTaskId, alts: rest.map((r) => ({ id: r.id, name: r.name, usd: r.usd })), tried: [head.id] });
  return { job, maker: head, alternatives: rest };
}

// When a job we are watching fails, start it on the next connected maker and point the old job at the new one.
export function failover(job, create = M.createJob) {
  if (job.status !== "failed") return null;
  const rec = switchInfo(job.id);
  if (!rec || rec.switchedTo || !rec.alts?.length) return null;
  const [next, ...rest] = rec.alts;
  try {
    const nj = create({ provider: next.id, kind: rec.kind, params: rec.params, projectId: rec.projectId, missionId: rec.missionId, missionTaskId: rec.missionTaskId, approve: true, estimate: next.usd, origin: "chat" });
    remember(job.id, { ...rec, switchedTo: nj.id, reason: why(job.error) });
    if (rest.length) remember(nj.id, { ...rec, alts: rest, tried: [...rec.tried, next.id], switchedTo: undefined });
    emit("log", { text: `${M.ADAPTERS[job.provider]?.name || job.provider} could not make the ${rec.kind} (${why(job.error)}). ${next.name} is making it instead.`, level: "error", missionId: rec.missionId || undefined });
    return nj;
  } catch (e) {
    remember(job.id, { ...rec, switchError: why(e) });
    return null;
  }
}
M.onJobFinished((job) => { failover(job); });

/** Follow a failed job to the one that replaced it (at most 3 hops). */
export function followJob(jobId) {
  let id = jobId;
  for (let i = 0; i < 3; i++) { const r = switchInfo(id); if (!r?.switchedTo) break; id = r.switchedTo; }
  return id;
}

// ---------- a Mission media step ----------
/** The step's maker. A picture under the auto-OK amount is made at once by the first connected picture AI that works;
 *  a paid video or voice job (or a pricier picture on a Runway/fal job) is created and waits for the person's OK as before.
 *  Returns { image: { row, maker, tried } } or { job, maker }. Throws SwitchError with the one key to add when nothing is connected. */
export async function missionMediaStep({ kind, prompt, text, projectId = null, missionId = null, missionTaskId = null, guardUsd = 0.5, make = makeImages, create = M.createJob } = {}) {
  const k = norm(kind);
  const words = String(prompt || text || "").slice(0, M.MAX_PROMPT);
  const list = candidates(k, { params: { prompt: words, text: words } });
  const usable = list.filter((c) => !c.capped);
  if (!usable.length) throw new SwitchError(409, status(k).message, { code: "no_provider" });
  if (k === "image") {
    const cheap = usable.filter((c) => c.via === "images" && c.usd <= guardUsd + 1e-9);
    if (cheap.length) {
      const r = await makeImageSwitch({ prompt: words, projectId, runId: missionId, maxUsd: guardUsd, make });
      return { image: r };
    }
  }
  const m = usable.find((c) => c.via === "media");
  if (!m) {
    const c = usable[0];
    throw new SwitchError(409, `${c.name} would make this for about $${c.usd}, which is over your auto-OK amount ($${guardUsd}). Make it from chat and say yes to the price, or raise the amount in Settings.`, { code: "needs_ok" });
  }
  const job = create({ provider: m.id, kind: k, params: { prompt: words, text: words }, projectId, missionId, missionTaskId, approve: false, origin: "mission" });
  return { job, maker: m };
}
