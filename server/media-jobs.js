// Media actions (R2): the job engine behind the Media tab and the media steps of a mission.
//
//  - Video, image and voice through the provider adapters in server/media/ (Kling, fal.ai, Runway, ElevenLabs).
//  - The credit estimate comes first. A job that would spend (a key is saved) runs only after a click that
//    repeats the estimate the person saw: Generate on the Media tab, or Approve on a mission's media step
//    (the step waits as "awaiting_ok" until then). Spend caps (alerts plugin) are checked before any call.
//  - Every finished paid job is one ledger line (kind "credits", the estimate as its cost, the project).
//  - Outputs are saved into the project's media folder (data folder > projects > <id> > media).
//  - No key (and demo mode): a dry run. Nothing is called or spent; a placeholder file (an SVG frame for
//    video and image, a second of silence for voice) is saved to the project so the whole flow can be tried.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { HOSTED, doc, putDoc, ctx, runAs } from "./store.js";
import { getSecret } from "./vault.js";
import { emit } from "./events.js";
import { recordCredits, summary as ledgerSummary } from "./ledger.js";
import { demoSvg } from "./images.js";
import * as kling from "./media/kling.js";
import * as elevenlabs from "./media/elevenlabs.js";
import * as runway from "./media/runway.js";
import * as fal from "./media/fal.js";
import { filesFromTool, isDual, mcpConfigured, runService } from "./connect.js";

export const JOBS = "media.jobs"; // shared with the image gallery (server/images.js)
export const ADAPTERS = { kling, elevenlabs, runway, fal };
export const KINDS = ["video", "image", "voice"];
// which provider a mission step uses for each kind, best first (a keyed one wins over a dry run)
export const ORDER = { video: ["kling", "fal", "runway"], image: ["fal", "runway"], voice: ["elevenlabs"] };
const KEY_ENV = { kling: "KLING_ACCESS_KEY", elevenlabs: "ELEVENLABS_API_KEY", runway: "RUNWAY_API_KEY", fal: "FAL_KEY" };
const POLL_MS = (process.env.CC_PACKAGED !== "1" && Number(process.env.CC_MEDIA_POLL_MS)) || 5000; // tests poll faster
const POLL_FOR_MS = 20 * 60 * 1000;
export const MAX_PROMPT = 5000;
const FINAL = new Set(["done", "dry-run", "failed", "declined"]);

export class MediaError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); } }
const bad = (msg, status = 400, extra) => new MediaError(status, msg, extra);

export const secretOf = (pid) => getSecret(pid, KEY_ENV[pid]);
export const keyed = (pid) => !!secretOf(pid)?.key;
// A dual service (Kling and the others) can also be reached through its MCP server. keyed stays the API key.
export const mcpOn = (pid) => isDual(pid) && mcpConfigured(pid);
export const ready = (pid) => keyed(pid) || mcpOn(pid);
export const both = (pid) => isDual(pid);

function capState(pid, add = 0) {
  const cap = Number(doc("alerts.caps", () => ({}))[pid]) || 0;
  const stop = (doc("alerts.state", () => undefined)?.stop || []).includes(pid);
  if (!cap) return { cap: null, left: null, capped: stop, over: false };
  const spent = ledgerSummary().byProvider?.[pid]?.month || 0;
  return { cap, left: +Math.max(0, cap - spent).toFixed(4), capped: stop || spent >= cap, over: spent + add > cap + 1e-9 };
}

// the provider a mission step uses: keyed and under its cap, else keyed, else the first one (a dry run)
export function chooseProvider(kind) {
  const list = ORDER[kind] || [];
  return list.find((p) => ready(p) && !capState(p).capped) || list.find((p) => ready(p)) || list[0] || null;
}

// only the fields the adapters read; a first-frame image must be a web address
function cleanParams(params = {}) {
  const out = {};
  const prompt = String(params.prompt ?? "").trim(), text = String(params.text ?? "").trim();
  if (prompt) out.prompt = prompt.slice(0, MAX_PROMPT + 1);
  if (text) out.text = text.slice(0, MAX_PROMPT + 1);
  if (params.imageUrl && /^https:\/\/\S+$/i.test(String(params.imageUrl))) out.imageUrl = String(params.imageUrl).slice(0, 2000);
  if (params.duration !== undefined && params.duration !== null && params.duration !== "") out.duration = Math.min(20, Math.max(1, Math.round(Number(params.duration)) || 5));
  for (const k of ["model", "voiceId", "aspect", "mode", "ratio", "size", "negative"]) if (params[k]) out[k] = String(params[k]).slice(0, 200);
  return out;
}

export function estimate({ provider, kind, params = {} } = {}) {
  const a = ADAPTERS[provider];
  if (!a) throw bad("Unknown media provider. Pick Kling, fal.ai, Runway or ElevenLabs.");
  if (!KINDS.includes(kind)) throw bad("kind must be video, image or voice.");
  if (!a.kinds.includes(kind)) throw bad(`${a.name} does not make ${kind}.`);
  const p = cleanParams(params);
  const e = a.estimate({ ...p, kind });
  const has = keyed(a.id);
  const live = ready(a.id);
  const cap = live ? capState(a.id, e.usd) : { cap: null, left: null, capped: false, over: false };
  return { provider: a.id, providerName: a.name, kind, estimate: e, usd: e.usd, keyed: has, connected: live, both: both(a.id), dryRun: !live, capped: cap.capped, wouldExceed: !cap.capped && cap.over, cap: cap.cap, capLeft: cap.left };
}

// a paid job: refused at the cap, and refused unless the click carried the current estimate
function checkSpend(est, seen) {
  if (est.capped) throw bad(`${est.providerName} has reached its monthly spend cap, so nothing was generated. Raise the cap in Settings > Spend caps or wait for the month to roll over.`, 402, { code: "capped" });
  if (est.wouldExceed) throw bad(`This ${est.kind} (about $${est.usd}) would take ${est.providerName} over its monthly spend cap ($${est.capLeft} left). Make it shorter or raise the cap.`, 402, { code: "capped" });
  const n = Number(seen);
  if (seen === undefined || seen === null || seen === "" || !(n + 1e-9 >= est.usd)) throw bad(`Check the cost first: about $${est.usd} (${est.estimate.note || est.providerName}).`, 409, { code: "estimate_first", estimate: est });
}

// ---------- the job list (per user) ----------
const list = () => doc(JOBS, () => ({ items: [] }));
export const getJob = (id) => list().items.find((x) => x.id === id) || null;
export const listJobs = ({ projectId, missionId } = {}) => list().items.filter((j) => (!projectId || j.projectId === projectId) && (!missionId || j.missionId === missionId)).slice(0, 100);
function saveJob(job) {
  const d = list();
  const i = d.items.findIndex((x) => x.id === job.id);
  if (i >= 0) d.items[i] = job; else d.items.unshift(job);
  d.items = d.items.slice(0, 500);
  putDoc(JOBS, d);
  emit("media.job", { job: publicJob(job) });
}
// what the page sees: file names, not where they live on disk
export const publicJob = (j) => j && ({ ...j, files: (j.outputs || []).map((o, i) => (/^https?:/i.test(o) ? { i, url: o } : { i, name: path.basename(o) })) });

const finishedListeners = new Set();
const waiters = new Map(); // job id -> [resolve]
export const onJobFinished = (fn) => finishedListeners.add(fn);
function finished(job) {
  for (const fn of finishedListeners) { try { Promise.resolve(fn(job)).catch((e) => console.error("[media] listener:", e.message)); } catch (e) { console.error("[media] listener:", e.message); } }
  for (const r of waiters.get(job.id) || []) r(job);
  waiters.delete(job.id);
}
// resolves with the job once it is final, or null after ms
export function awaitJob(id, ms = 60000) {
  const j = getJob(id);
  if (j && FINAL.has(j.status)) return Promise.resolve(j);
  return new Promise((resolve) => {
    const t = setTimeout(() => { resolve(null); }, ms); t.unref?.();
    const arr = waiters.get(id) || []; arr.push((job) => { clearTimeout(t); resolve(job); }); waiters.set(id, arr);
  });
}

// ---------- files ----------
export function projectMediaDir(projectId) {
  const d = path.join(DATA_DIR, "projects", String(projectId || "unfiled").replace(/[^a-z0-9-_]/gi, "_"), "media");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// one second of silence, 8 kHz mono 8-bit PCM
export function silentWav(seconds = 1) {
  const n = 8000 * seconds, b = Buffer.alloc(44 + n, 0x80);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
}
function savePlaceholder(job) {
  if (HOSTED) return [];
  const dir = projectMediaDir(job.projectId);
  const words = job.params.prompt || job.params.text || "";
  if (job.kind === "voice") { const f = path.join(dir, `${job.id}-dry-run.wav`); fs.writeFileSync(f, silentWav(1)); return [f]; }
  const f = path.join(dir, `${job.id}-dry-run.svg`);
  fs.writeFileSync(f, demoSvg({ prompt: words || job.kind, size: job.kind === "video" ? "portrait" : "square", op: job.kind === "video" ? "video dry run" : "image dry run" }));
  return [f];
}
async function saveOutput(job, out) {
  if (HOSTED) { job.outputs = out.urls || []; return; } // hosted: keep the provider's addresses (object storage comes with the hub)
  const dir = projectMediaDir(job.projectId);
  const outputs = [];
  if (out.bytes) { const f = path.join(dir, `${job.id}.${out.ext || "bin"}`); fs.writeFileSync(f, out.bytes); outputs.push(f); }
  for (const [i, u] of (out.urls || []).entries()) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(String(r.status));
      const ext = (u.split("?")[0].match(/\.(mp4|mov|webm|png|jpg|jpeg|webp|mp3|wav)$/i) || [, job.kind === "video" ? "mp4" : job.kind === "image" ? "png" : "mp3"])[1];
      const f = path.join(dir, `${job.id}${i ? "-" + i : ""}.${ext}`);
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      outputs.push(f);
    } catch { outputs.push(u); }
  }
  job.outputs = outputs;
}
// a saved output of a job, only inside the data folder
export function outputFile(id, i) {
  const j = getJob(String(id || ""));
  const f = j?.outputs?.[Number(i) || 0];
  if (!f || /^https?:/i.test(f)) return null;
  const full = path.resolve(f), root = path.resolve(DATA_DIR) + path.sep;
  if (!full.startsWith(root) || !fs.existsSync(full)) return null;
  return full;
}

// ---------- create, approve, decline, run ----------
// approve: the click that spends (the Media tab's Generate). A mission step passes approve: false and waits.
export function createJob({ provider, kind, params, projectId = null, missionId = null, missionTaskId = null, approve = false, estimate: seen, origin = "media" } = {}) {
  const p = cleanParams(params);
  const words = p.prompt || p.text || "";
  if (!words) throw bad("Write what to make (for voice, the words to speak).");
  if (words.length > MAX_PROMPT) throw bad(`The prompt is too long (${MAX_PROMPT} characters at most).`);
  const est = estimate({ provider, kind, params: p });
  if (!est.dryRun && approve) checkSpend(est, seen);
  const job = {
    id: "mj-" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), provider: est.provider, kind, params: p,
    projectId: projectId || null, missionId: missionId || null, missionTaskId: missionTaskId || null, origin,
    estimate: est.estimate, dryRun: est.dryRun, status: !est.dryRun && !approve ? "awaiting_ok" : "queued", createdAt: Date.now(), outputs: [],
  };
  saveJob(job);
  if (job.status === "awaiting_ok") {
    emit("log", { text: `${est.providerName} ${kind} is waiting for your OK (about $${est.usd}). Approve it on the Media tab; nothing is spent until you do.`, missionId: job.missionId });
    return job;
  }
  start(job);
  return job;
}
export function approveJob(id, seen) {
  const job = getJob(String(id || ""));
  if (!job) throw bad("No such media job.", 404);
  if (job.status !== "awaiting_ok") throw bad(`This job is ${job.status}, not waiting for an OK.`, 409);
  const est = estimate({ provider: job.provider, kind: job.kind, params: job.params });
  if (!est.dryRun) checkSpend(est, seen);
  job.estimate = est.estimate; job.dryRun = est.dryRun; job.status = "queued"; job.approvedAt = Date.now();
  saveJob(job);
  start(job);
  return job;
}
export function declineJob(id) {
  const job = getJob(String(id || ""));
  if (!job) throw bad("No such media job.", 404);
  if (job.status !== "awaiting_ok") throw bad(`This job is ${job.status}, not waiting for an OK.`, 409);
  job.status = "declined"; job.finishedAt = Date.now();
  saveJob(job);
  emit("log", { text: `${ADAPTERS[job.provider].name} ${job.kind} not made: you said no. Nothing was spent.`, missionId: job.missionId });
  finished(job);
  return job;
}
function start(job) {
  const c = ctx();
  runAs(c, () => runJob(job)).catch((e) => console.error("[media] job:", e.message));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runApi(job, a) {
  const secret = secretOf(job.provider);
  if (!secret?.key) throw new Error(`No ${a.name} API key saved.`);
  const started = await a.start(secret, { ...job.params, kind: job.kind });
  if (started.done) return started;
  job.taskId = started.taskId; job.pollPath = started.pollPath; saveJob(job); // taskId: the provider's id (the live view links Kling's task page)
  for (let i = 0; i < Math.ceil(POLL_FOR_MS / POLL_MS); i++) {
    await sleep(POLL_MS);
    const p = await a.poll(secret, job);
    if (p.done) { if (p.error) throw new Error(p.error); return p; }
    job.progress = p.progress || p.status || null; saveJob(job);
  }
  throw new Error(`${a.name} did not finish within 20 minutes. Check the job on ${a.name}'s own page.`);
}
// The active connection runs the job. If both are set up and it fails, the other one runs it.
async function runPaid(job, a) {
  job.status = "processing"; saveJob(job);
  if (!isDual(job.provider)) { job.via = "key"; job.fallback = false; return runApi(job, a); }
  const out = await runService(job.provider, job.kind, {
    args: { prompt: job.params.prompt || job.params.text || "", text: job.params.text || job.params.prompt || "", model: job.params.model || "", kind: job.kind, duration: job.params.duration, aspect: job.params.aspect || "" },
    api: () => runApi(job, a),
    mcp: (raw) => filesFromTool(raw),
  });
  job.via = out.via; job.fallback = !!out.fallback;
  if (job.fallback) job.note = job.via === "mcp" ? "API key failed. MCP stood in." : "MCP failed. API key stood in.";
  return out.result;
}
async function runJob(job) {
  const user = ctx();
  user.mediaJobsInFlight = (user.mediaJobsInFlight || 0) + 1;
  try { await runJobBody(job); }
  finally { user.mediaJobsInFlight = Math.max(0, (user.mediaJobsInFlight || 1) - 1); }
}
async function runJobBody(job) {
  const a = ADAPTERS[job.provider];
  const agent = `media:${job.id}`;
  const label = `${a.name} ${job.dryRun ? "dry run:" : "generating"} ${job.kind}`;
  emit("agent.start", { agent, provider: job.provider, model: job.params.model || a.defaults?.model || job.provider, role: "media", missionId: job.missionId, taskId: job.missionTaskId, label });
  const t0 = Date.now();
  try {
    if (job.dryRun || !ready(job.provider)) {
      await sleep(300);
      job.dryRun = true;
      job.outputs = savePlaceholder(job);
      job.status = "dry-run"; job.finishedAt = Date.now();
      job.note = `No ${a.name} key saved, so nothing was generated or spent. A placeholder file was saved to the project to show where the result goes. Add the key in Settings > Media to generate for real.`;
      emit("agent.done", { agent, provider: job.provider, model: job.params.model || job.provider, missionId: job.missionId, taskId: job.missionTaskId, ms: Date.now() - t0, cost: 0 });
      saveJob(job); finished(job); return;
    }
    const produced = await runPaid(job, a);
    await saveOutput(job, produced);
    job.status = job.outputs?.length ? "done" : "failed"; job.finishedAt = Date.now();
    if (job.status === "failed") job.error = `Nothing came back. ${a.name} said it finished but sent no file. Press Try again, or add credits in Settings.`;
    // one ledger line per paid job, with the estimate the person approved
    const e = job.estimate || {};
    recordCredits({ provider: job.provider, units: e.credits || e.characters || e.seconds || 1, cost: e.usd, note: `${job.kind}${job.missionId ? " (mission)" : ""}`, project: job.projectId });
    emit("agent.done", { agent, provider: job.provider, model: job.params.model || job.provider, missionId: job.missionId, taskId: job.missionTaskId, ms: Date.now() - t0, cost: e.usd });
    const stood = job.fallback ? (job.via === "mcp" ? " API key failed, MCP stood in." : " MCP failed, API key stood in.") : "";
    const via = job.via === "mcp" ? " Via MCP." : "";
    emit("log", { text: `${a.name} ${job.kind} ready (${job.outputs.length} file${job.outputs.length === 1 ? "" : "s"}, saved to the project) · about $${e.usd}${via}${stood}`, missionId: job.missionId });
  } catch (err) {
    job.status = "failed"; job.error = String(err.message || err).slice(0, 300); job.finishedAt = Date.now();
    emit("agent.error", { agent, provider: job.provider, model: job.params.model || job.provider, missionId: job.missionId, taskId: job.missionTaskId, error: job.error });
  }
  saveJob(job);
  finished(job);
}

// a short line about a finished job for a mission's deliverable
export function resultLine(job) {
  const a = ADAPTERS[job.provider];
  const files = (job.outputs || []).map((o) => (/^https?:/i.test(o) ? o : path.basename(o)));
  if (job.status === "done") return `${a.name} made the ${job.kind} (about $${job.estimate?.usd ?? 0}). Saved to the project: ${files.join(", ")}. Open it on the Media tab.`;
  if (job.status === "dry-run") return `Dry run, nothing spent: no ${a.name} key is saved. Estimate for the real ${job.kind}: about $${job.estimate?.usd ?? 0} (${job.estimate?.note || ""}). Placeholder saved to the project: ${files.join(", ") || "none (hosted)"}.`;
  if (job.status === "declined") return `Not made: you said no to the ${a.name} ${job.kind}. Nothing was spent.`;
  if (job.status === "awaiting_ok") return `Waiting for your OK: ${a.name} ${job.kind}, about $${job.estimate?.usd ?? 0} (${job.estimate?.note || ""}). Approve it on the Media tab; nothing is spent until you do. The file is saved to the project.`;
  return `${a.name} could not make the ${job.kind}: ${job.error || "unknown error"}.`;
}
