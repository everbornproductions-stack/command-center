// Grok Bot agent (Phase 12). Grok Bot is the person's own assistant with its own computer, signed-in
// browser, Gmail, Drive, Calendar and teammate bots. When a job needs one of those, the app hands it over:
//   1. Settings > Integrations > Grok Bot: webhook URL and sender key in the vault (never in git, never
//      logged, never sent to the browser after saving), an optional header name (default Authorization,
//      sent as "Bearer <key>"; any other header carries the key as is).
//   2. Dispatch: POST <webhook> with that header and { job_id, task, context, workspace, callback_url }.
//      Only from an explicit council / mission step or a click. Never in demo mode unless the built-in
//      mock is selected (the mock never leaves this process).
//   3. Results: POST /api/grokbot/callback/<job_id>?t=<per-job token> with { status, text, artifacts }.
//      The token is random per job, stored only as a SHA-256 hash, compared with timingSafeEqual, and
//      burned by `done` or `failed`. The route is exempt from the session token and rejects everything else.
// callback_url only works once Grok Bot can reach it (the hosted hub, or a tunnel Chris sets up). Until
// then a job stays queued / working and the person can paste the result in by hand.
import crypto from "node:crypto";
import { getSecret, setSecret } from "./vault.js";
import { HOSTED, doc, putDoc, ctx, runAs, currentUserId, getContext } from "./store.js";
import { emit } from "./events.js";
import { observe } from "./brain.js";
import { heuristicClassify } from "./router.js";
import { demoActive } from "./mock.js";
import { CFG } from "./hosted.js";
import { localFetch } from "./loopback-fetch.js";
import { reportBlock } from "./reportback.js";
import { permissionFor } from "./getdone.js";

export const AGENT_ID = "grokbot";
export const NAME = "Grok Bot";
export const COLOR = "#c4b5fd";
const VAULT_ID = "agent-grokbot";
const SETTINGS = "grokbot.settings";
const JOBS = "grokbot.jobs";
const PORT = Number(process.env.PORT || process.env.CC_PORT || 4747);
const MAX_JOBS = 200;

export const TAGS = ["signed-in-browsing", "gmail", "drive", "calendar", "teammate-bots"];
export const TAG_LABEL = { "signed-in-browsing": "signed-in browsing", gmail: "Gmail", drive: "Google Drive", calendar: "Google Calendar", "teammate-bots": "teammate bots" };
export const STATUSES = ["queued", "working", "needs_approval", "done", "failed"];
export const STATUS_LABEL = { queued: "Queued", working: "Working", needs_approval: "Needs your approval", done: "Done", failed: "Failed" };
const TERMINAL = new Set(["done", "failed"]);
export const DEFAULTS = { auto: true, mock: false, councilWaitSec: 90, missionWaitMin: 15, publicUrl: "" };
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "content-type", "transfer-encoding", "connection", "cookie", "expect", "upgrade"]);

const clip = (s, n) => String(s ?? "").slice(0, n);
const oneLine = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();

// ---------- what a job needs (the router's hint) ----------
// Plain writing ("draft an email", "write a post") is text work and never matches.
const NEEDS = {
  gmail: /\b(gmail|my inbox|the inbox|my e-?mails?|unread (e-?mails?|messages)|e-?mails? from|send (an |the |this |that |my )?e-?mails?|reply to (the |this |that |his |her |their )?e-?mail|check (my )?e-?mail|forward (the |this )?e-?mail|label (the |my )?e-?mails?)\b/i,
  drive: /\b(google drive|my drive|in drive|to drive|from drive|drive folder|google docs?|google sheets?|google slides|shared folder|my docs folder)\b/i,
  calendar: /\b(calendar|my schedule|book (a |the )?(meeting|call|appointment)|schedule (a |the )?(meeting|call|appointment)|meeting invite|calendar invite|send (an |the )?invite|my availability|free slots?)\b/i,
  "signed-in-browsing": /\b(log ?in(to)?|sign(ed)? ?in|my account|account dashboard|portal|fill (in|out) (the |a |this )?form|in my browser|open the website|browse to|go to the site|download (my |the )?(invoice|statement|receipt|report)s?|check (my )?orders?)\b/i,
  "teammate-bots": /\b(teammate bots?|other bots|my bots|bot team|team bots|hand (it )?(off )?to (the |my )?bots)\b/i,
};
export function agentNeeds(text) {
  const t = String(text || "");
  return TAGS.filter((tag) => NEEDS[tag].test(t));
}
export const mentionsGrokBot = (text) => /\bgrok[\s_-]?bot\b/i.test(String(text || ""));

// ---------- settings and secrets ----------
export function settings() { return { ...DEFAULTS, ...(doc(SETTINGS, () => ({ ...DEFAULTS })) || {}) }; }
const secret = () => getSecret(VAULT_ID) || null;
const configured = () => { const s = secret(); return !!(s?.key && s?.url); };
const headerOf = () => secret()?.header || "Authorization";

export function readiness() {
  const s = settings();
  if (s.mock) return { ready: true, via: "mock", detail: "ready (built-in mock: nothing leaves this computer)" };
  if (!configured()) return { ready: false, via: null, detail: "not set up: add the webhook URL and sender key in Settings > Integrations" };
  if (demoActive()) return { ready: false, via: null, detail: "demo mode is on: Grok Bot jobs only go to the built-in mock (turn it on, or turn demo mode off)" };
  return { ready: true, via: "webhook", detail: "ready" };
}

export function callbackBase() {
  const s = settings();
  return (s.publicUrl || (HOSTED ? CFG.hubUrl || "" : "") || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
}

function badRequest(msg) { return Object.assign(new Error(msg), { status: 400 }); }
export function checkUrl(raw, { allowLoopbackHttp = true } = {}) {
  const s = String(raw || "").trim();
  if (!s || s.length > 500 || /\s/.test(s)) throw badRequest("Enter the full webhook address, starting with https://");
  let u; try { u = new URL(s); } catch { throw badRequest("That is not a web address."); }
  if (u.username || u.password) throw badRequest("Put the key in the sender key field, not in the address.");
  const loop = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loop && allowLoopbackHttp)) throw badRequest("The address must start with https:// (http:// only for this computer).");
  return u.toString();
}

export async function saveConfig(body = {}) {
  const prev = secret() || {};
  const next = { ...prev };
  if (body.remove) { await setSecret(VAULT_ID, null); emit("log", { text: "Grok Bot connection removed from the vault." }); statusChanged(); return configView(); }
  if (body.url !== undefined && String(body.url).trim()) next.url = checkUrl(body.url);
  if (body.key !== undefined && String(body.key).trim()) {
    const k = String(body.key).trim();
    if (k.length < 8 || k.length > 4000 || /[\r\n]/.test(k)) throw badRequest("The sender key looks wrong (8 to 4000 characters, one line).");
    next.key = k;
  }
  if (body.header !== undefined) {
    const h = String(body.header || "").trim() || "Authorization";
    if (!/^[A-Za-z0-9-]{1,64}$/.test(h) || FORBIDDEN_HEADERS.has(h.toLowerCase())) throw badRequest("Header name: letters, digits and dashes only (for example Authorization or X-Api-Key).");
    next.header = h;
  }
  const s = settings();
  const out = { ...s };
  if (body.auto !== undefined) out.auto = !!body.auto;
  if (body.mock !== undefined) out.mock = !!body.mock;
  if (body.councilWaitSec !== undefined) { const n = Number(body.councilWaitSec); if (!Number.isFinite(n) || n < 0 || n > 900) throw badRequest("Council wait: 0 to 900 seconds."); out.councilWaitSec = Math.round(n); }
  if (body.missionWaitMin !== undefined) { const n = Number(body.missionWaitMin); if (!Number.isFinite(n) || n < 0 || n > 240) throw badRequest("Mission wait: 0 to 240 minutes."); out.missionWaitMin = Math.round(n); }
  if (body.publicUrl !== undefined) out.publicUrl = String(body.publicUrl || "").trim() ? checkUrl(body.publicUrl).replace(/\/$/, "") : "";
  const secretChanged = next.url !== prev.url || next.key !== prev.key || next.header !== prev.header;
  // half a connection (URL without key or the other way round) is kept so it can be finished; it is not ready
  if (secretChanged) {
    await setSecret(VAULT_ID, { key: next.key || "", url: next.url || "", header: next.header || "Authorization" });
  }
  putDoc(SETTINGS, out);
  emit("log", { text: secretChanged ? "Grok Bot connection saved in the vault." : "Grok Bot settings saved." });
  statusChanged();
  return configView();
}

// What the browser may know. The URL and the key never go back after saving.
export function configView() {
  const s = settings(), sec = secret(), r = readiness();
  return {
    urlSaved: !!sec?.url, keySaved: !!sec?.key, header: headerOf(), headerValue: headerOf().toLowerCase() === "authorization" ? "Bearer <your sender key>" : "<your sender key>",
    auto: s.auto, mock: s.mock, councilWaitSec: s.councilWaitSec, missionWaitMin: s.missionWaitMin, publicUrl: s.publicUrl,
    callbackBase: callbackBase(), callbackExample: `${callbackBase()}/api/grokbot/callback/<job_id>?t=<token>`,
    reachable: !!s.publicUrl || HOSTED, ready: r.ready, via: r.via, detail: r.detail, demo: demoActive(), tags: TAGS.map((t) => ({ id: t, label: TAG_LABEL[t] })),
  };
}

// ---------- jobs ----------
const jobs = () => doc(JOBS, () => []);
const saveJobs = (list) => putDoc(JOBS, list.slice(0, MAX_JOBS));
export const findJob = (id) => jobs().find((j) => j.id === id) || null;
const owners = new Map(); // jobId -> userId (hosted: callbacks carry no sign-in, so the job says whose it is)
const waiters = new Map(); // jobId -> Set<{ done(job), update(job) }>
const claimed = new Set(); // jobs a running council or mission will still await (a fast result is not "late")
const finishListeners = [];
export const onJobFinished = (fn) => finishListeners.push(fn);
const noted = new Set();
// A click hand-off is its own job. A council or mission records the same job itself.
function noteOutcome(j) {
  if (!j || noted.has(j.id)) return;
  const kind = j.source?.kind;
  if (kind === "council" || kind === "mission") return;
  noted.add(j.id);
  const cls = heuristicClassify(String(j.task || "").slice(0, 4000));
  const ms = j.updatedAt && j.createdAt ? j.updatedAt - j.createdAt : null;
  observe({ provider: AGENT_ID, model: AGENT_ID, capability: cls.capability, difficulty: cls.difficulty, runId: j.id, ok: j.status === "done", cost: 0, ms });
}

export function publicJob(j) {
  if (!j) return null;
  return { id: j.id, task: j.task, contextChars: (j.context || "").length, workspace: j.workspace, source: j.source, needs: j.needs || [], status: j.status, statusLabel: STATUS_LABEL[j.status], via: j.via, createdAt: j.createdAt, sentAt: j.sentAt || null, updatedAt: j.updatedAt, text: j.text || "", artifacts: j.artifacts || [], error: j.error || null, by: j.by || null, history: j.history || [], late: !!j.late };
}
export const listJobs = (n = 50) => jobs().slice(0, n).map(publicJob);
export const runJobs = (runId) => jobs().filter((j) => j.source?.runId === runId).map(publicJob);

function workspaceKey() { try { return doc("workspaces.active", () => ({ id: null })).id || "personal"; } catch { return "personal"; } }

function statusChanged() {
  const card = hubCard();
  emit("provider.status", { provider: AGENT_ID, status: card.status.status, detail: card.status.detail });
}

function announce(j, note) {
  emit("grokbot.job", { job: publicJob(j) });
  // Phase 29 live view watches outside agents through this event
  emit("external.handoff", { agent: AGENT_ID, jobId: j.id, status: j.status, task: oneLine(j.task, 160), result: oneLine(j.text, 240), sentAt: j.sentAt || null, missionId: j.source?.runId || "", projectId: j.source?.projectId || "", failed: j.status === "failed" });
  if (note) emit("log", { text: `Grok Bot: ${note}`, level: j.status === "failed" ? "error" : undefined, missionId: j.source?.runId || undefined });
  statusChanged();
}

// Hand a job to Grok Bot. Throws (status 409) when it is not ready; a refused or unreachable webhook
// gives back a failed job instead, with a plain reason.
export async function dispatch({ task, context = "", source = {}, needs = [] } = {}) {
  const t = String(task || "").trim();
  if (!t) throw badRequest("The job needs a task.");
  const r = readiness();
  if (!r.ready) throw Object.assign(new Error(`Grok Bot is ${r.detail}.`), { status: 409, code: "grokbot_not_ready" });
  const id = "gb-" + crypto.randomBytes(9).toString("base64url");
  const token = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  const j = {
    id, task: clip(t, 20000), context: clip(context, 40000), workspace: workspaceKey(),
    source: { kind: ["council", "mission", "click"].includes(source.kind) ? source.kind : "click", runId: source.runId || null, taskId: source.taskId || null, projectId: source.projectId || null },
    needs: needs.filter((x) => TAGS.includes(x)), status: "queued", via: r.via, createdAt: now, updatedAt: now, sentAt: null,
    text: "", artifacts: [], error: null, history: [{ status: "queued", ts: now, note: "created" }], tokenHash: sha(token).toString("hex"),
  };
  const list = jobs(); list.unshift(j); saveJobs(list);
  owners.set(id, currentUserId());
  if (j.source.runId) claimed.add(id);
  const perm = permissionFor({ runId: source.runId || null, ownId: id, text: j.task, toggle: source.getItDone === true, send: source.sendMessages === true });
  const callback_url = `${callbackBase()}/api/grokbot/callback/${id}?t=${token}`;
  if (r.via === "mock") {
    j.sentAt = Date.now(); saveJobs(jobs());
    announce(j, `job queued (built-in mock): ${oneLine(t, 90)}`);
    runMock(j);
    return publicJob(j);
  }
  const sec = secret();
  const header = sec.header || "Authorization";
  const value = header.toLowerCase() === "authorization" ? `Bearer ${sec.key}` : sec.key;
  const reported = await reportBlock({ jobId: id, kind: "grokbot", threadId: j.source?.runId || null });
  const taskOut = `${j.task}\n\n${reported.block}\n\n${perm.line}`;
  let res, reply = null;
  try {
    res = await localFetch(sec.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", connection: "close", [header]: value }, body: JSON.stringify({ job_id: id, task: taskOut, context: j.context, workspace: j.workspace, callback_url }), signal: AbortSignal.timeout(Number(process.env.CC_GROKBOT_TIMEOUT_MS) || 15000), redirect: "error" });
    try { reply = await res.json(); } catch { reply = null; }
  } catch (e) {
    return fail(j, `Could not reach Grok Bot: ${netReason(e)}`);
  }
  if (!res.ok) return fail(j, res.status === 401 || res.status === 403 ? `Grok Bot refused the sender key (${res.status}).` : `Grok Bot refused the job (${res.status}).`);
  j.sentAt = Date.now();
  const ack = STATUSES.includes(reply?.status) && !TERMINAL.has(reply.status) ? reply.status : "queued";
  if (ack !== "queued") { j.status = ack; j.history.push({ status: ack, ts: Date.now(), note: "answer to the hand-off" }); }
  j.updatedAt = Date.now(); saveJobs(jobs());
  announce(j, `job handed over (${STATUS_LABEL[j.status].toLowerCase()}): ${oneLine(t, 90)}. Results come back on their own and can take minutes.`);
  return publicJob(j);
}

function netReason(e) {
  const code = e?.cause?.code || e?.code || "";
  if (e?.name === "TimeoutError" || /timeout/i.test(code)) return "no answer in time";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "address not found";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "connection dropped";
  if (/CERT|SSL|TLS/i.test(code)) return "the secure connection failed";
  return "network error";
}

// A hand-off the webhook refused or never answered. dispatch() reports it to its caller directly.
function fail(j, why) {
  j.status = "failed"; j.error = why; j.tokenHash = null; j.updatedAt = Date.now();
  j.history.push({ status: "failed", ts: j.updatedAt, note: why });
  saveJobs(jobs());
  claimed.delete(j.id);
  announce(j, why);
  noteOutcome(j);
  return publicJob(j);
}

// One status change, from the callback, the mock, a paste or a cancel.
export function applyStatus(id, { status, text, artifacts, by = "grokbot", note } = {}) {
  const list = jobs();
  const j = list.find((x) => x.id === id);
  if (!j) throw Object.assign(new Error("no such job"), { status: 404 });
  if (!STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
  const pasting = by === "you" && status === "done";
  if (TERMINAL.has(j.status) && !(pasting && j.status === "failed")) throw Object.assign(new Error("that job is already finished"), { status: 409 });
  const now = Date.now();
  j.status = status; j.updatedAt = now;
  if (text !== undefined && text !== null) j.text = clip(text, 200000);
  if (Array.isArray(artifacts)) j.artifacts = cleanArtifacts(artifacts);
  if (status === "failed") j.error = clip(note || text || "Grok Bot reported a failure", 500);
  if (pasting) j.error = null;
  j.by = by === "you" ? "you" : by === "mock" ? "mock" : "grokbot";
  j.history.push({ status, ts: now, note: clip(note || (by === "you" ? "pasted by you" : ""), 120) });
  if (j.history.length > 40) j.history = j.history.slice(-40);
  if (TERMINAL.has(status)) j.tokenHash = null; // single use: done or failed burns the token
  saveJobs(list);
  const what = status === "done" ? (by === "you" ? "result pasted in by you" : "result back") : status === "needs_approval" ? "needs your approval before it goes on (answer in Grok Bot)" : status === "failed" ? `failed: ${j.error}` : STATUS_LABEL[status].toLowerCase();
  announce(j, `${what}: ${oneLine(j.task, 70)}`);
  if (TERMINAL.has(status)) settle(j); else for (const w of waiters.get(id) || []) w.update?.(publicJob(j));
  return publicJob(j);
}

function cleanArtifacts(list) {
  const out = [];
  for (const a of list.slice(0, 20)) {
    if (!a || typeof a !== "object") continue;
    let url = "";
    try { const u = new URL(String(a.url || "")); if (["https:", "http:"].includes(u.protocol) && !u.username && !u.password) url = u.toString(); } catch {}
    const name = oneLine(a.name || a.title || "", 120);
    if (!url && !name) continue;
    out.push({ name: name || url, url: url || null, type: oneLine(a.type || "", 40) || null });
  }
  return out;
}

// Wake whoever waits for this job; if nobody does (the council or mission moved on, or the app
// restarted), the run that asked for it gets the late result through the finish listeners.
function settle(j) {
  noteOutcome(j);
  const ws = waiters.get(j.id);
  if (ws?.size) { waiters.delete(j.id); claimed.delete(j.id); for (const w of ws) w.done(publicJob(j)); return; }
  if (claimed.has(j.id)) return; // the run that asked has not started waiting yet; awaitJob() sees it finished
  j.late = !!j.source?.runId;
  if (j.late) saveJobs(jobs());
  for (const fn of finishListeners) Promise.resolve().then(() => fn(publicJob(j))).catch((e) => console.error("[grokbot] late result:", e.message));
}

// Resolves with the job once it is done or failed, or null when the wait ends (timeout or abort).
export function awaitJob(id, { timeoutMs = 60000, signal, onUpdate } = {}) {
  const j = findJob(id);
  if (!j) { claimed.delete(id); return Promise.resolve(null); }
  if (TERMINAL.has(j.status)) { claimed.delete(id); return Promise.resolve(publicJob(j)); }
  // 0 minutes means go on now. setTimeout(0) becomes a 1 ms timer, and Windows can
  // swallow that, so a mission that should not wait sits there until the test gives up.
  if (!(Number(timeoutMs) > 0)) { claimed.delete(id); return Promise.resolve(null); }
  return new Promise((resolve) => {
    let timer = null;
    const w = {
      done: (job) => { clearTimeout(timer); signal?.removeEventListener?.("abort", stop); resolve(job); },
      update: (job) => { try { onUpdate?.(job); } catch {} },
    };
    // the wait is over: from now on a result is late and goes to the finish listeners
    const stop = () => { clearTimeout(timer); waiters.get(id)?.delete(w); if (!waiters.get(id)?.size) claimed.delete(id); resolve(null); };
    if (!waiters.has(id)) waiters.set(id, new Set());
    waiters.get(id).add(w);
    timer = setTimeout(stop, Math.max(0, timeoutMs));
    timer.unref?.();
    if (signal) { if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true }); }
  });
}

export function cancelJob(id, why = "cancelled by you") {
  const j = findJob(id);
  if (!j) throw Object.assign(new Error("no such job"), { status: 404 });
  if (TERMINAL.has(j.status)) return publicJob(j);
  return applyStatus(id, { status: "failed", by: "you", note: why });
}

export const pasteResult = (id, text, artifacts) => {
  if (!String(text || "").trim()) throw badRequest("Paste the result text first.");
  return applyStatus(id, { status: "done", text: String(text), artifacts, by: "you" });
};

// The built-in mock: a pretend Grok Bot inside this process, for demo mode and trying it out.
// It never opens a page, sends a message or touches an account.
function runMock(j) {
  const c = ctx();
  const step = Number(process.env.CC_GROKBOT_MOCK_MS) || 600;
  const at = (ms, fn) => { const t = setTimeout(() => runAs(c, () => { try { fn(); } catch {} }), ms); t.unref?.(); };
  at(step, () => applyStatus(j.id, { status: "working", by: "mock" }));
  at(step * 2.5, () => applyStatus(j.id, {
    status: "done", by: "mock",
    text: `**Grok Bot (mock)** would handle this with ${(j.needs.length ? j.needs : ["its own computer"]).map((t) => TAG_LABEL[t] || t).join(", ")}:\n\n> ${oneLine(j.task, 300)}\n\nThis is a pretend result from the built-in mock. Nothing was opened, sent or changed.`,
  }));
}

// ---------- the callback (no session token; the per-job token instead) ----------
export const CALLBACK_PREFIX = "/api/grokbot/callback/";
export const isCallback = (pathname) => String(pathname || "").startsWith(CALLBACK_PREFIX);

function tokenOk(presented, storedHex) {
  if (!storedHex || typeof presented !== "string" || !presented || presented.length > 200) return false;
  const a = sha(presented), b = Buffer.from(storedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readLimited(req, max = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let d = "", over = false;
    req.on("data", (c) => { if (over) return; d += c; if (d.length > max) { over = true; reject(Object.assign(new Error("too large"), { status: 413 })); req.resume(); } });
    req.on("end", () => { if (!over) resolve(d); });
    req.on("error", reject);
  });
}

// send(res, status, body) is index.js's json(). Every refusal is short and says nothing about other jobs.
export async function handleCallback(req, res, url, send) {
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "POST only" }); }
  const m = url.pathname.slice(CALLBACK_PREFIX.length).match(/^(gb-[A-Za-z0-9_-]{8,40})$/);
  if (!m) return send(res, 404, { error: "not found" });
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return send(res, 415, { error: "content-type must be application/json" });
  let raw;
  try { raw = await readLimited(req); } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? "payload too large" : "bad request" }); }
  const id = m[1];
  const c = HOSTED ? getContext(owners.get(id)) : getContext(null);
  if (!c) return send(res, 401, { error: "job or token not recognised" });
  return runAs(c, () => {
    const j = findJob(id);
    if (!j || !tokenOk(url.searchParams.get("t"), j.tokenHash)) return send(res, 401, { error: "job or token not recognised" });
    let p;
    try { p = raw ? JSON.parse(raw) : null; } catch { return send(res, 400, { error: "bad json" }); }
    if (!p || typeof p !== "object" || Array.isArray(p)) return send(res, 400, { error: "send a JSON object { status, text, artifacts }" });
    if (!STATUSES.includes(p.status)) return send(res, 400, { error: `status must be one of ${STATUSES.join(", ")}` });
    if (p.text !== undefined && typeof p.text !== "string") return send(res, 400, { error: "text must be a string" });
    if (p.artifacts !== undefined && !Array.isArray(p.artifacts)) return send(res, 400, { error: "artifacts must be a list" });
    try {
      const out = applyStatus(id, { status: p.status, text: p.text, artifacts: p.artifacts, note: p.status === "failed" ? p.text : undefined });
      return send(res, 200, { ok: true, job_id: id, status: out.status });
    } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  });
}

// ---------- the router's view ----------
// explicit: true (the person asked for Grok Bot), false (left out), undefined (the router decides).
export function wantAgent({ prompt, explicit } = {}) {
  const needs = agentNeeds(prompt), r = readiness(), s = settings();
  if (explicit === false) return { use: false, needs, reason: "left out by you" };
  const asked = explicit === true || mentionsGrokBot(prompt);
  if (!r.ready) return { use: false, needs, reason: r.detail };
  if (asked) return { use: true, needs, reason: "you asked for Grok Bot" };
  if (!needs.length) return { use: false, needs, reason: "plain text work: another AI does it as well" };
  if (!s.auto) return { use: false, needs, reason: "automatic hand-off is off" };
  return { use: true, needs, reason: `needs ${needs.map((t) => TAG_LABEL[t]).join(", ")}` };
}
export function routeAdvice(prompt) {
  const needs = agentNeeds(prompt), r = readiness();
  const fits = needs.length > 0 || mentionsGrokBot(prompt);
  return { agent: AGENT_ID, name: NAME, fits, needs: needs.map((t) => ({ id: t, label: TAG_LABEL[t] })), ready: r.ready, detail: r.detail, auto: settings().auto };
}
export const waitMs = (kind) => (kind === "council" ? settings().councilWaitSec * 1000 : settings().missionWaitMin * 60000);

// ---------- the hub card ----------
export function hubCard() {
  const r = readiness();
  const list = jobs();
  const open = list.filter((j) => !TERMINAL.has(j.status));
  const last = list[0];
  let status = "grey", detail = r.detail;
  if (r.ready) {
    status = "green"; detail = r.via === "mock" ? "ready (mock)" : "ready";
    // the newest hand-off failing (refused or unreachable) turns the light red until the next one goes through
    if (last?.status === "failed" && !last.by && /Could not reach|refused/.test(last.error || "")) { status = "red"; detail = last.error; }
    else if (open.some((j) => j.status === "needs_approval")) { status = "amber"; detail = "needs your approval"; }
    else if (open.length) detail = `${open.length} job${open.length === 1 ? "" : "s"} in progress`;
  } else if (configured() && demoActive()) status = "amber";
  const activity = [];
  for (const j of list.slice(0, 12)) for (const h of j.history || []) activity.push({ ts: h.ts, jobId: j.id, status: h.status, task: oneLine(j.task, 80), note: h.note || "" });
  activity.sort((a, b) => b.ts - a.ts);
  return {
    id: AGENT_ID, name: NAME, vendor: "your assistant", color: COLOR, kind: "agent", links: {}, keyHint: null, unit: null, hasApi: false, demo: false, custom: false, noKey: false,
    keyed: r.ready, masked: null, status: { status, detail }, models: [], liveModels: [],
    agent: { tags: TAGS.map((t) => ({ id: t, label: TAG_LABEL[t] })), ready: r.ready, via: r.via, open: open.length, now: open[0] ? { jobId: open[0].id, status: open[0].status, task: oneLine(open[0].task, 120) } : null, activity: activity.slice(0, 10) },
  };
}
