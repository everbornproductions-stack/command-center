// Backup when API credits run out (2026-10-21, Chris approved). When an AI cannot answer because its API
// credits ran out and smart fallback has no other API route for that slot (a single chat, a council seat,
// or a side-by-side column), the slot does not fail. It waits, and Meldmind works down one ordered list
// (server/sub-routes.js CHAIN):
//   1. the AI's official app on this PC, signed in with the person's own plan (the answer fills in on its own)
//   2. website mode, only when the person turned it on: the AI's own site in Meldmind's browser window (server/website-step.js)
//   3. "You copy it over": Continue in <AI> copies a prompt that asks the other AI to send its answer back
//      (report-back hub, the Meldmind MCP tool submit_answer, or a marked block the person copies)
// Meldmind keeps checking: the hub poll, the MCP tool, and (in the desktop app) the clipboard when the window
// comes back into focus. Paste reply and Stop waiting are always there.
//
// Waiting jobs are a per-user document, like the report-back jobs, so they survive a restart. The answer
// text is never kept on the job and never logged: it goes into the run that is waiting for it.
import crypto from "node:crypto";
import { PROVIDERS } from "./registry.js";
import { doc, putDoc, ctx, runAs, HOSTED } from "./store.js";
import { emit } from "./events.js";
import { recordCall } from "./ledger.js";
import { fallbackSettings, troubleKind } from "./fallback.js";
import { listTargets, stripSecrets } from "./handoff.js";
import { hubOn, hubRoute } from "./reportback.js";
import { askWebsite, liveDeps as webDeps } from "./website-step.js";
import { CHAIN, WEBSITE_NOTE, readyRoutesFor, routeSettings, askApp, stopApp, noteSignedOut } from "./sub-routes.js";

export const DOC = "answerwait.jobs";
export const MAX_JOBS = 100;
export const ANSWER_MAX = 100000;
export const ASK_MAX = 20000;
export const START = "MELDMIND ANSWER";
export const END = "END MELDMIND ANSWER";
export const PLACEHOLDER = "(your full answer here)";
export const ID_RE = /^ans-[A-Za-z0-9_-]{6,64}$/;
export const KINDS = ["single", "council", "compare"];

const bad = (status, message, code) => Object.assign(new Error(message), { status, code });
const oneLine = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const SUB_NAME = { anthropic: "Claude", openai: "ChatGPT", xai: "Grok", google: "Gemini" };

// ---------- when does a slot wait ----------
export const waitOn = () => fallbackSettings().subscriptions !== false;
// Out of credits or billing, not rate limits, not a bad key.
export function creditOutage(err) {
  if (!err) return false;
  if (err.code === "paused") return err.kind ? err.kind === "credits" : !/rate limited/i.test(String(err.message || ""));
  if (err.code === "cap") return false;
  return troubleKind(err) === "credits";
}
export const shouldWait = (err) => waitOn() && creditOutage(err);

// ---------- names and pages ----------
export function aiName(provider) {
  const t = listTargets().find((x) => x.provider === provider);
  return t?.name || SUB_NAME[provider] || PROVIDERS[provider]?.name || provider || "that AI";
}
export function pageFor(provider) {
  const t = listTargets().find((x) => x.provider === provider);
  if (t?.url) return t.url;
  const p = PROVIDERS[provider];
  if (!p || p.demo) return null;
  const u = String(p.links?.app || "");
  return /^https:\/\//.test(u) ? u : null;
}

// ---------- the marked block ----------
const BLOCK_RE = /^[ \t>*_`#]*MELDMIND ANSWER[ \t]+([A-Za-z0-9_-]{6,80})[ \t*_`]*\r?\n([\s\S]*?)\r?\n[ \t>*_`#]*END MELDMIND ANSWER[ \t*_`]*$/gm;
// Every complete block in a text: [{ jobId, answer }]. The template in our own prompt does not count.
export function markedBlocks(text) {
  const out = [];
  const s = String(text || "").replace(/^﻿/, "");
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(s))) {
    const answer = m[2].replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n\s*```\s*$/, "").trim();
    if (!answer || answer === PLACEHOLDER) continue;
    out.push({ jobId: m[1], answer });
  }
  return out;
}
// The answer inside this job's block, or null. A block for another job is ignored.
export function extractMarked(text, jobId) {
  const hit = markedBlocks(text).filter((b) => b.jobId === jobId).pop();
  return hit ? hit.answer : null;
}

// ---------- the prompts ----------
function questionText(job) {
  let q = String(job.ask || "").trim();
  if (q.length > ASK_MAX) q = `${q.slice(0, ASK_MAX - 16).trimEnd()}\n[cut to fit]`;
  return stripSecrets(q);
}
function howTo(job) { return job.system ? `How to answer: ${oneLine(stripSecrets(job.system), 600)}\n\n` : ""; }

// What an official app on this PC gets: the question only. The answer comes back on its output.
export function appPrompt(job) { return `${howTo(job)}${questionText(job)}`; }

export function blockTemplate(jobId) { return `${START} ${jobId}\n${PLACEHOLDER}\n${END}`; }

// The copy-over prompt: the question, then the send-back instructions in order (hub, MCP tool, marked block).
export function buildCopyPrompt(job, { hub = null } = {}) {
  const name = job.aiName || "this AI";
  const lines = [
    `Meldmind could not answer this through its API because the ${name} API credits ran out. Please answer it here, with your ${name} plan.`,
    "Answer the question only. Do not edit files, run commands, or change anything.",
    "",
    "QUESTION",
    `${howTo(job)}${questionText(job)}`,
    "",
    "SEND YOUR ANSWER BACK TO MELDMIND",
    `Meldmind is waiting for this answer and checks for it on its own. The job id is ${job.id}. Use the first way that works for you:`,
  ];
  let n = 1;
  if (hub?.sbBlock) {
    lines.push(`${n++}. ${hub.sbBlock.split("\n")[0].replace(/^When finished, let Meldmind know: /, "If you can make web requests, tell Meldmind with: ")}`);
    lines.push(`   ${hub.sbBlock.split("\n").filter((l) => l.startsWith("curl")).join(" ")}`);
  } else if (hub?.url && hub?.token) {
    const payload = JSON.stringify({ status: "done", summary: "<your full answer>" });
    lines.push(`${n++}. If you can make web requests, post your full answer to Meldmind: POST ${hub.url} with header Authorization: Bearer ${hub.token} and JSON {"status": "done", "summary": "<your full answer>"}.`);
    lines.push(`   curl -sS -X POST "${hub.url}" -H "Authorization: Bearer ${hub.token}" -H "Content-Type: application/json" -d '${payload}'`);
  }
  lines.push(`${n++}. If you can use tools and Meldmind is connected to you as an MCP server (Claude Code, Antigravity, or another MCP client), call the Meldmind tool submit_answer with job_id "${job.id}" and answer set to your full answer.`);
  lines.push(`${n}. In every case, also end your reply with this block, with your full answer in place of the middle line, so the person can copy it back to Meldmind:`);
  lines.push("", blockTemplate(job.id), "");
  return lines.join("\n");
}

// What list_waiting gives an MCP client: the question and the one tool to call. No hub token.
export function mcpPrompt(job) {
  return `${howTo(job)}${questionText(job)}\n\nAnswer the question only. Then call the Meldmind tool submit_answer with job_id "${job.id}" and answer set to your full answer.`;
}

// ---------- the job list ----------
function jobs() {
  try { const d = doc(DOC, () => []); return Array.isArray(d) ? d : []; } catch { return []; }
}
function saveJobs(list) { putDoc(DOC, list.slice(0, MAX_JOBS)); }
export function findJob(id) { return jobs().find((j) => j.id === id) || null; }
function upsert(job) {
  const list = jobs().filter((j) => j.id !== job.id);
  list.unshift(job);
  saveJobs(list);
  return job;
}
function patch(id, fields) {
  const j = findJob(id);
  if (!j) return null;
  Object.assign(j, fields, { updatedAt: Date.now() });
  return upsert(j);
}

// The waiting box's own words. step is where in CHAIN the job is.
export function headline(job) {
  if (job.step === "website" && job.trying) return `Out of API credits. Answering through the ${job.aiName} website in the Meldmind window.`;
  if (job.step === "apps" && job.trying) return `Out of API credits. Answering through ${job.trying} on this PC.`;
  return `Out of API credits. Answering through your ${job.aiName} subscription.`;
}
export function publicJob(j) {
  if (!j) return null;
  return {
    id: j.id, kind: j.kind, runId: j.runId, slot: j.slot, provider: j.provider, model: j.model, ai: j.aiName, title: j.title,
    status: j.status, step: j.step, trying: j.trying || null, tried: j.tried || [], website: !!j.website, websiteNote: j.website ? WEBSITE_NOTE : null,
    headline: headline(j), page: j.page || null, hub: !!j.hub, createdAt: j.createdAt, updatedAt: j.updatedAt || j.createdAt,
    answeredAt: j.answeredAt || null, answeredBy: j.answeredBy || null, tag: j.tag || null,
  };
}
// What a run keeps on its waiting slot (the box draws from this alone).
export const slotInfo = (j) => ({ jobId: j.id, ai: j.aiName, provider: j.provider, since: j.createdAt, step: j.step, trying: j.trying || null, headline: headline(j), page: j.page || null, website: !!j.website });
export const listJobs = (n = 40) => jobs().slice(0, n).map(publicJob);
export const waitingJobs = () => jobs().filter((j) => j.status === "waiting");

function announce(job) {
  emit("answerwait.update", { job: publicJob(job) });
}
function note(job, status) {
  // the job id and its status only, never the question or the answer
  console.log(`answer-wait ${job.id} ${status}`);
}

// ---------- the run each slot belongs to fills itself in ----------
const handlers = new Map(); // kind -> async (job, { text, tag, by } | { stopped: true })
export function onSlotAnswer(kind, fn) { if (KINDS.includes(kind) && typeof fn === "function") handlers.set(kind, fn); }
// a slot's step changed (the box redraws from the run): kind -> (job) => void
const steppers = new Map();
export function onSlotStep(kind, fn) { if (KINDS.includes(kind) && typeof fn === "function") steppers.set(kind, fn); }

// ---------- opening a wait ----------
// Returns the slot info at once; the chain runs in the background.
export function openWait({ kind, runId, slot = null, provider, model, ask, system = "", title = "" } = {}) {
  if (!KINDS.includes(kind) || !runId || !provider) throw bad(400, "A waiting answer needs a run and an AI.");
  const now = Date.now();
  const job = {
    id: "ans-" + crypto.randomBytes(9).toString("base64url"), kind, runId: String(runId), slot: slot ?? null, provider, model: model || null,
    aiName: aiName(provider), title: oneLine(title || ask, 90), ask: String(ask || "").slice(0, ASK_MAX * 2), system: String(system || "").slice(0, 2000),
    status: "waiting", step: CHAIN[0].id, trying: null, tried: [], website: routeSettings().website, page: pageFor(provider), hub: false, prompt: "",
    createdAt: now, updatedAt: now,
  };
  upsert(job);
  note(job, "waiting");
  emit("log", { text: `${PROVIDERS[provider]?.name || job.aiName} is out of API credits. Meldmind is answering through your ${job.aiName} subscription instead (${CHAIN.map((s) => `${s.n}. ${s.label}`).join(", ")}).`, missionId: runId });
  announce(job);
  const c = ctx();
  setImmediate(() => { runAs(c, () => advance(job.id)).catch((e) => console.error("[answer-wait] chain:", e.message)); });
  return slotInfo(job);
}

// Walk the chain from the job's current step. Each step either answers, or hands on to the next one.
const appRuns = new Map(); // job id -> app run id
let webOverride = null; // tests: a fake browser helper for the website step
export async function advance(jobId) {
  let job = findJob(jobId);
  if (!job || job.status !== "waiting") return;
  let i = Math.max(0, CHAIN.findIndex((s) => s.id === job.step));
  for (; i < CHAIN.length; i++) {
    const step = CHAIN[i].id;
    job = patch(jobId, { step, trying: null });
    if (!job || job.status !== "waiting") return;
    if (step === "apps") {
      if (HOSTED) continue;
      const routes = await readyRoutesFor(job.provider);
      for (const r of routes) {
        job = patch(jobId, { trying: r.name });
        if (!job || job.status !== "waiting") return;
        stepped(job);
        const runId = `${jobId}:${r.id}`;
        appRuns.set(jobId, runId);
        const res = await askApp(r, appPrompt(job), { runId });
        appRuns.delete(jobId);
        job = findJob(jobId);
        if (!job || job.status !== "waiting") return;
        if (res.ok) {
          await deliver(jobId, res.text, { route: "app", by: r.name, tag: `via ${r.name} (subscription)`, raw: true });
          return;
        }
        if (res.code === "signin") noteSignedOut(r.id);
        job = patch(jobId, { tried: [...(job.tried || []), { route: r.id, name: r.name, code: res.code }] });
        note(job, `${r.id}-${res.code}`);
        emit("log", { text: `${res.message} Meldmind moves on to the next way to answer.`, missionId: job.runId });
      }
      continue;
    }
    if (step === "website") {
      // Only when the person turned website mode on. A website that cannot answer hands on to copy it over.
      if (!routeSettings().website || HOSTED) continue;
      job = patch(jobId, { website: true, trying: "the website" });
      stepped(job);
      let res;
      try { res = await askWebsite(job, appPrompt(job), { ...(await webDeps()), ...(webOverride || {}) }); }
      catch (e) { res = { ok: false, code: "error", message: `The website step stopped: ${e.message}` }; }
      job = findJob(jobId);
      if (!job || job.status !== "waiting") return;
      if (res.ok) {
        await deliver(jobId, res.text, { route: "website", by: `${res.site} website`, tag: `via ${res.site} website`, raw: true });
        return;
      }
      job = patch(jobId, { trying: null, tried: [...(job.tried || []), { route: "website", name: "Website", code: res.code }] });
      note(job, `website-${res.code}`);
      emit("log", { text: `${res.message} Meldmind moves on to the next way to answer.`, missionId: job.runId });
      stepped(job);
      continue;
    }
    if (step === "copy") {
      let hub = null;
      if (hubOn()) { try { hub = await hubRoute({ jobId, kind: "answer", threadId: job.runId }); } catch { hub = null; } }
      job = findJob(jobId);
      if (!job || job.status !== "waiting") return;
      job = patch(jobId, { trying: null, hub: !!hub?.hub, prompt: buildCopyPrompt(job, { hub: hub?.hub ? hub : null }) });
      stepped(job);
      return; // waits here until an answer comes back or Stop waiting
    }
  }
}
function stepped(job) {
  announce(job);
  try { steppers.get(job.kind)?.(job); } catch {}
}

// ---------- an answer arrives ----------
// route: app | website | hub | mcp | clipboard | paste
export async function deliver(jobId, text, { route = "paste", by = "", tag = "", raw = false } = {}) {
  if (!ID_RE.test(String(jobId || ""))) throw bad(400, "That is not a Meldmind answer job id.", "bad_id");
  const job = findJob(jobId);
  if (!job) throw bad(404, "No waiting answer has that job id.", "unknown");
  if (job.status !== "waiting") throw bad(409, job.status === "answered" ? "That answer is already in." : "Meldmind stopped waiting for that answer.", "finished");
  let body = String(text ?? "");
  if (body.length > ANSWER_MAX * 2) throw bad(413, `That answer is too long (the limit is ${ANSWER_MAX} characters).`, "too_long");
  const marked = raw ? null : extractMarked(body, jobId);
  if (route === "clipboard" && marked == null && !raw) throw bad(400, "The clipboard has no answer block for this job.", "no_block");
  body = (marked ?? body).trim();
  if (!body) throw bad(400, "The answer is empty.", "empty");
  if (body.length > ANSWER_MAX) throw bad(413, `That answer is too long (the limit is ${ANSWER_MAX} characters).`, "too_long");
  const via = tag || `via ${job.aiName} subscription`;
  const done = patch(jobId, { status: "answered", answeredAt: Date.now(), answeredBy: route, tag: via, trying: null });
  // another route won: an app still working on it is stopped
  const app = appRuns.get(jobId); if (app) stopApp(app);
  note(done, `answered-${route}`);
  try {
    recordCall({ provider: PROVIDERS[job.provider] ? job.provider : "manual", model: by || `${job.aiName} subscription`, usage: { input: 0, output: 0, cost: 0, manual: true, handoff: by || `${job.aiName} subscription` }, missionId: job.runId, role: "subscription" });
  } catch {}
  try { await handlers.get(job.kind)?.(done, { text: body, tag: via, by: by || job.aiName, route }); }
  catch (e) { console.error("[answer-wait] fill:", e.message); }
  announce(done);
  emit("log", { text: `The ${job.aiName} answer came back (${via}) and filled its box.`, missionId: job.runId });
  return { ok: true, jobId, status: "answered", runId: job.runId, kind: job.kind };
}

export async function stopWait(jobId) {
  const job = findJob(jobId);
  if (!job) throw bad(404, "No waiting answer has that job id.", "unknown");
  if (job.status !== "waiting") return { ok: true, jobId, status: job.status };
  const done = patch(jobId, { status: "stopped", trying: null, stoppedAt: Date.now() });
  const app = appRuns.get(jobId); if (app) stopApp(app);
  note(done, "stopped");
  try { await handlers.get(job.kind)?.(done, { stopped: true }); } catch (e) { console.error("[answer-wait] stop:", e.message); }
  announce(done);
  return { ok: true, jobId, status: "stopped" };
}

// The Continue in click: the full prompt and the page. Nothing is sent or opened here.
export function continueInfo(jobId) {
  const job = findJob(jobId);
  if (!job) throw bad(404, "No waiting answer has that job id.", "unknown");
  const prompt = job.prompt || buildCopyPrompt(job);
  return { jobId: job.id, ai: job.aiName, url: job.page || null, prompt, chars: prompt.length, status: job.status, block: blockTemplate(job.id) };
}

// For the Meldmind MCP tool list_waiting.
export function listWaiting() {
  return waitingJobs().map((j) => ({ id: j.id, ai: j.aiName, title: j.title, prompt: mcpPrompt(j) }));
}
export async function submitAnswer({ jobId, answer } = {}) {
  const id = String(jobId ?? "").trim();
  if (!ID_RE.test(id)) throw bad(400, "job_id must be a Meldmind answer job id (it starts with ans-).", "bad_id");
  if (typeof answer !== "string" || !answer.trim()) throw bad(400, "answer must be the full answer text.", "empty");
  if (answer.length > ANSWER_MAX) throw bad(413, `answer is too long (the limit is ${ANSWER_MAX} characters).`, "too_long");
  return deliver(id, answer, { route: "mcp", by: "MCP" });
}

// After a restart: an app that was answering died with the old process, so the chain picks up from that step.
export function resumeAll() {
  for (const j of waitingJobs()) {
    const c = ctx();
    setImmediate(() => { runAs(c, () => advance(j.id)).catch(() => {}); });
  }
}

// A hub result for an answer job (server/reportback.js hands these over).
export async function fromHub(row) {
  const job = findJob(row?.jobId);
  if (!job) return null;
  if (row.status && row.status !== "done") return { jobId: job.id, status: job.status, ignored: true };
  try { return await deliver(job.id, String(row.summary || ""), { route: "hub", by: "report-back" }); }
  catch (e) { return { jobId: job.id, status: job.status, error: e.message }; }
}

export const _test = { jobs, upsert, appRuns, setWebDeps: (d) => { webOverride = d; } };
