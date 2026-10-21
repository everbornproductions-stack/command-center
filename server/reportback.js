// Report-back relay. An AI Meldmind handed a job to can POST the outcome to the hosted hub.
// The hub stores it only until that same person's app picks it up, then deletes it.
// The desktop reaches the hub with CC_WORKER_URL and CC_WORKER_TOKEN (outbound only).
// Nothing here opens a port on the PC. With no hub, the person uses Paste result.
import crypto from "node:crypto";
import { doc, putDoc, ctx } from "./store.js";
import { emit } from "./events.js";
import { localFetch } from "./loopback-fetch.js";
import { acceptUsageReport } from "./credit-tracker.js";

export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BODY_MAX = 64 * 1024;
export const STATUSES = ["done", "failed", "needs_input"];
const LOCAL_DOC = "reportback.jobs";
const MAX_LOCAL = 100;
const RATE_WINDOW_MS = 60 * 1000;

const relay = new Map(); // jobId -> record. Memory only. No admin list. No disk.
const waiters = new Map(); // ownerHash -> Set<{ finish }>
const rateHits = new Map();
const relayNotes = [];

const clip = (s, n) => String(s ?? "").slice(0, n);
const oneLine = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function ttlMs() {
  const n = Number(process.env.CC_REPORTBACK_TTL_MS);
  if (Number.isFinite(n) && n >= 200 && n <= TTL_MS) return Math.floor(n);
  return TTL_MS;
}
function rateMax() {
  const n = Number(process.env.CC_REPORTBACK_RATE_MAX);
  if (Number.isFinite(n) && n >= 2 && n <= 1000) return Math.floor(n);
  return 30;
}
export function hashToken(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
function hashEq(aHex, bHex) {
  if (typeof aHex !== "string" || typeof bHex !== "string" || !aHex || aHex.length !== bHex.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(aHex, "hex"), Buffer.from(bHex, "hex")); }
  catch { return false; }
}
export function bearerOf(req) {
  const m = String(req?.headers?.authorization || "").match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return "";
  const t = m[1];
  if (t.length < 8 || t.length > 500 || /[\r\n\s]/.test(t)) return "";
  return t;
}

// Job id and status only. Never the token, the summary, the links, or the files.
export function noteRelay(jobId, status) {
  const id = String(jobId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const st = String(status || "").replace(/[^a-z_]/g, "").slice(0, 32);
  if (!id || !st) return;
  relayNotes.push({ jobId: id, status: st, at: Date.now() });
  if (relayNotes.length > 200) relayNotes.shift();
  console.log(`report-back ${id} ${st}`);
}
export const relayLog = () => relayNotes.map((n) => `report-back ${n.jobId} ${n.status}`);
export const relaySize = () => relay.size;

export function workerUrl() {
  const raw = String(process.env.CC_WORKER_URL || "").trim();
  if (!raw) return "";
  let u;
  try { u = new URL(raw); } catch { return ""; }
  const loop = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (u.username || u.password) return "";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loop)) return "";
  return u.origin;
}
export function workerToken() {
  const t = String(process.env.CC_WORKER_TOKEN || "").trim();
  if (t.length < 16 || t.length > 500 || /[\r\n\s]/.test(t)) return "";
  return t;
}
export const workerOn = () => !!(workerUrl() && workerToken());

export function doneUrl(jobId) {
  const base = workerUrl();
  if (!base || !validId(jobId)) return "";
  return `${base}/api/handoff/${jobId}/done`;
}

const ID_RE = /^[a-z]{1,12}-[A-Za-z0-9_-]{6,64}$/;
export const validId = (id) => ID_RE.test(String(id || ""));
function newId() { return "rb-" + crypto.randomBytes(9).toString("base64url"); }

export function pasteBlock() {
  return "When finished, let Meldmind know: reply with DONE: <summary> and the user can paste it back.";
}
export function reportBlockText({ url, token } = {}) {
  if (!url || !token) return pasteBlock();
  const payload = JSON.stringify({ status: "done", summary: "<summary>", links: [] });
  const curl = `curl -sS -X POST "${url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '${payload}'`;
  return `When finished, let Meldmind know: POST ${url} with header Authorization: Bearer ${token} and JSON {status, summary, links}. If you can't make web requests, reply with DONE: <summary> and the user can paste it back.\n\n${curl}\n\nIf the work used paid AI credits, add usage: [{"provider": "anthropic", "cost": 0.42}] to the JSON, in US dollars, so Meldmind's credit balance stays right.`;
}

function safeHttp(raw) {
  try {
    const u = new URL(String(raw || ""));
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return "";
    return u.toString().slice(0, 2000);
  } catch { return ""; }
}

export function cleanReport(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) {
    const e = new Error("send a JSON object { status, summary, links }"); e.status = 400; throw e;
  }
  if (!STATUSES.includes(p.status)) {
    const e = new Error("status must be done, failed, or needs_input"); e.status = 400; throw e;
  }
  if (p.summary !== undefined && p.summary !== null && typeof p.summary !== "string") {
    const e = new Error("summary must be text"); e.status = 400; throw e;
  }
  if (p.links !== undefined && !Array.isArray(p.links)) {
    const e = new Error("links must be a list"); e.status = 400; throw e;
  }
  if (p.files !== undefined && !Array.isArray(p.files)) {
    const e = new Error("files must be a list"); e.status = 400; throw e;
  }
  const links = [];
  for (const item of (p.links || []).slice(0, 20)) {
    const url = safeHttp(typeof item === "string" ? item : item?.url);
    if (url) links.push(url);
  }
  const files = [];
  for (const f of (p.files || []).slice(0, 10)) {
    if (!f || typeof f !== "object") continue;
    const name = oneLine(f.name || "file", 120) || "file";
    const url = safeHttp(f.url);
    const text = typeof f.text === "string" ? f.text.slice(0, 4000) : "";
    if (!url && !text) continue;
    files.push({ name, url: url || null, text: text || null });
  }
  // Optional: AI credits the agent spent on this job, so Meldmind's tracked balance stays right.
  const usage = [];
  for (const u of (Array.isArray(p.usage) ? p.usage : []).slice(0, 5)) {
    const cost = Number(u?.cost ?? u?.credits_spent);
    if (!u || typeof u.provider !== "string" || !Number.isFinite(cost) || cost < 0 || cost > 10000) continue;
    usage.push({ provider: oneLine(u.provider, 40), cost: +cost.toFixed(4), note: oneLine(u.note || "", 140) });
  }
  return { status: p.status, summary: clip(p.summary || "", 8000), links, files, ...(usage.length ? { usage } : {}) };
}

export function parsePasted(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  const m = raw.match(/^DONE:\s*([\s\S]*)$/i);
  const summary = (m ? m[1] : raw).trim();
  return { summary, status: "done" };
}

function limited(key) {
  const now = Date.now();
  const arr = (rateHits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  if (arr.length) rateHits.set(key, arr); else rateHits.delete(key);
  if (rateHits.size > 5000) {
    for (const [k, v] of rateHits) if (!v.length || now - v[v.length - 1] >= RATE_WINDOW_MS) rateHits.delete(k);
  }
  return arr.length > rateMax();
}
function clientKey(req) {
  const ip = String(req.socket?.remoteAddress || "unknown").slice(0, 80);
  return ip;
}

function sweep(now = Date.now()) {
  for (const [id, job] of relay) {
    if (job.expiresAt > now) continue;
    relay.delete(id);
    noteRelay(id, "expired");
  }
}

function readLimited(req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers["content-length"] || 0);
    if (Number.isFinite(len) && len > max) {
      const e = new Error("payload too large"); e.status = 413; reject(e); req.resume(); return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true;
        const e = new Error("payload too large"); e.status = 413; reject(e); req.resume(); return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function publicResult(job) {
  const r = job.result;
  return { jobId: job.jobId, status: r.status, summary: r.summary, links: r.links, files: r.files, ...(r.usage ? { usage: r.usage } : {}) };
}
function pendingFor(ownerHash) {
  sweep();
  const rows = [];
  for (const job of relay.values()) {
    if (!job.result || !hashEq(job.ownerHash, ownerHash)) continue;
    rows.push(publicResult(job));
  }
  return rows;
}
function wake(ownerHash) {
  const set = waiters.get(ownerHash);
  if (!set?.size) return;
  const rows = pendingFor(ownerHash);
  for (const w of [...set]) w.finish(rows);
}

export function registerRelay({ ownerToken, jobId }) {
  const token = String(ownerToken || "");
  if (token.length < 16) { const e = new Error("job or token not recognised"); e.status = 401; throw e; }
  const id = validId(jobId) ? jobId : newId();
  if (relay.has(id)) { const e = new Error("that job already exists"); e.status = 409; throw e; }
  const jobToken = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  relay.set(id, {
    jobId: id,
    ownerHash: hashToken(token),
    tokenHash: hashToken(jobToken),
    createdAt: now,
    expiresAt: now + ttlMs(),
    used: false,
    result: null,
  });
  noteRelay(id, "registered");
  return { jobId: id, token: jobToken, expiresAt: now + ttlMs() };
}

export function acceptRelay({ jobId, presented, body }) {
  sweep();
  const job = relay.get(jobId);
  const presentedHash = presented ? hashToken(presented) : "";
  if (!job || job.used || !job.tokenHash || !hashEq(job.tokenHash, presentedHash)) {
    if (job && job.expiresAt <= Date.now()) { relay.delete(jobId); noteRelay(jobId, "expired"); }
    const e = new Error("job or token not recognised"); e.status = 401; throw e;
  }
  if (job.expiresAt <= Date.now()) {
    relay.delete(jobId);
    noteRelay(jobId, "expired");
    const e = new Error("job or token not recognised"); e.status = 401; throw e;
  }
  const clean = cleanReport(body);
  job.used = true;
  job.tokenHash = "";
  job.result = clean;
  noteRelay(jobId, clean.status);
  wake(job.ownerHash);
  return { ok: true, jobId, status: clean.status };
}

export function ackRelay({ ownerToken, jobId }) {
  sweep();
  const job = relay.get(jobId);
  const ownerHash = ownerToken ? hashToken(ownerToken) : "";
  if (!job || !hashEq(job.ownerHash, ownerHash)) {
    const e = new Error("not found"); e.status = 404; throw e;
  }
  relay.delete(jobId);
  noteRelay(jobId, "deleted");
  return { ok: true, jobId };
}

function waitInbox(ownerHash, ms, req) {
  const ready = pendingFor(ownerHash);
  if (ready.length || !(ms > 0)) return Promise.resolve(ready);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const entry = { finish: (rows) => { if (settled) return; settled = true; clearTimeout(timer); set?.delete(entry); if (!set?.size) waiters.delete(ownerHash); resolve(rows || pendingFor(ownerHash)); } };
    const set = waiters.get(ownerHash) || new Set();
    waiters.set(ownerHash, set);
    set.add(entry);
    timer = setTimeout(() => entry.finish(pendingFor(ownerHash)), ms);
    timer.unref?.();
    const stop = () => entry.finish([]);
    req.on("close", stop);
    req.on("aborted", stop);
  });
}

const DONE_RE = /^\/api\/handoff\/([a-z]{1,12}-[A-Za-z0-9_-]{6,64})\/(done|ack)$/;
export function isReportRoute(method, pathname) {
  if (method === "POST" && pathname === "/api/handoff/jobs") return true;
  if (method === "GET" && pathname === "/api/handoff/inbox") return true;
  return (method === "POST" && DONE_RE.test(String(pathname || "")));
}

// A refusal can answer before the body is read. Drain it so the socket closes.
function dropBody(req) { try { req.resume(); } catch {} }

// Exempt from the session token. The per-job token or the worker token is the check.
// Responses never include another person's job. Logs never include the token or the summary.
export async function handleReportRoute(req, res, url, send) {
  try { res.setHeader("connection", "close"); } catch {}
  const method = req.method;
  const path = url.pathname;
  const ip = clientKey(req);
  if (limited(`all:${ip}`)) { dropBody(req); return send(res, 429, { error: "too many requests" }); }
  try {
    if (method === "POST" && path === "/api/handoff/jobs") {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) { dropBody(req); return send(res, 415, { error: "content-type must be application/json" }); }
      const owner = bearerOf(req);
      if (!owner || owner.length < 16) { dropBody(req); return send(res, 401, { error: "job or token not recognised" }); }
      let raw;
      try { raw = await readLimited(req); } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? "payload too large" : "bad request" }); }
      let p = {};
      try { p = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { error: "bad json" }); }
      if (p.jobId !== undefined && !validId(p.jobId)) return send(res, 400, { error: "bad job id" });
      const out = registerRelay({ ownerToken: owner, jobId: p.jobId });
      return send(res, 200, { jobId: out.jobId, token: out.token, expiresAt: out.expiresAt });
    }
    if (method === "GET" && path === "/api/handoff/inbox") {
      const owner = bearerOf(req);
      if (!owner || owner.length < 16) return send(res, 401, { error: "job or token not recognised" });
      const n = Number(url.searchParams.get("wait"));
      const ms = Number.isFinite(n) && n > 0 ? Math.min(25000, Math.floor(n)) : 0;
      const results = await waitInbox(hashToken(owner), ms, req);
      if (res.writableEnded || res.destroyed) return;
      return send(res, 200, { results });
    }
    const m = path.match(DONE_RE);
    if (!m || method !== "POST") return send(res, 404, { error: "not found" });
    const jobId = m[1];
    const action = m[2];
    const presented = bearerOf(req);
    if (!presented) { dropBody(req); return send(res, 401, { error: "job or token not recognised" }); }
    if (action === "ack") {
      dropBody(req);
      const out = ackRelay({ ownerToken: presented, jobId });
      return send(res, 200, out);
    }
    if (limited(`done:${ip}`)) { dropBody(req); return send(res, 429, { error: "too many requests" }); }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) { dropBody(req); return send(res, 415, { error: "content-type must be application/json" }); }
    let raw;
    try { raw = await readLimited(req); } catch (e) { return send(res, e.status || 400, { error: e.status === 413 ? "payload too large" : "bad request" }); }
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { return send(res, 400, { error: "bad json" }); }
    const out = acceptRelay({ jobId, presented, body });
    return send(res, 200, out);
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : "bad request" });
  }
}

// ---------- the desktop's own copy of the job (never the hub) ----------
function localJobs() {
  const d = doc(LOCAL_DOC, () => []);
  return Array.isArray(d) ? d : [];
}
function saveLocal(list) { putDoc(LOCAL_DOC, list.slice(0, MAX_LOCAL)); }

export function rememberLocal({ jobId, kind, threadId, targetId } = {}) {
  if (!validId(jobId)) return null;
  const list = localJobs().filter((j) => j.id !== jobId);
  const row = {
    id: jobId, kind: kind === "grokbot" ? "grokbot" : "copy", threadId: threadId || null, targetId: targetId || null,
    status: "waiting", summary: "", links: [], files: [], createdAt: Date.now(),
  };
  list.unshift(row);
  saveLocal(list);
  return row;
}
export function localJob(id) { return localJobs().find((j) => j.id === id) || null; }

export function reportStatus() {
  const waiting = localJobs().slice(0, 20).map((j) => ({
    id: j.id, kind: j.kind, threadId: j.threadId || null, status: j.status, summary: j.summary || "", links: j.links || [], files: j.files || [],
  }));
  return { hub: workerOn(), waiting };
}

async function registerRemote(jobId) {
  const base = workerUrl();
  const token = workerToken();
  if (!base || !token) return null;
  const res = await localFetch(`${base}/api/handoff/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", connection: "close", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || data.jobId !== jobId || typeof data.token !== "string" || data.token.length < 16) return null;
  return data.token;
}

export async function reportBlock({ jobId, kind, threadId, targetId } = {}) {
  const id = validId(jobId) ? jobId : newId();
  try { rememberLocal({ jobId: id, kind, threadId, targetId }); } catch {}
  if (!workerOn()) return { jobId: id, hub: false, block: pasteBlock() };
  try {
    const token = await registerRemote(id);
    if (!token) return { jobId: id, hub: false, block: pasteBlock() };
    return { jobId: id, hub: true, block: reportBlockText({ url: doneUrl(id), token }) };
  } catch {
    return { jobId: id, hub: false, block: pasteBlock() };
  }
}

function threadText({ status, summary, links, files }) {
  const lines = [];
  if (summary) lines.push(summary);
  if (links?.length) lines.push(links.map((u, i) => `${i + 1}. ${u}`).join("\n"));
  for (const f of files || []) {
    const bit = [f.name, f.url, f.text].filter(Boolean).join("\n");
    if (bit) lines.push(bit);
  }
  return lines.join("\n\n").trim();
}
function headingFor(status, pasted) {
  if (pasted) return "Pasted result";
  if (status === "failed") return "Could not finish";
  if (status === "needs_input") return "Needs your input";
  return "From the other AI";
}

async function writeThread(threadId, { status, summary, links, files, pasted }) {
  if (!threadId) return null;
  const m = await ctx().store.getMission(String(threadId));
  if (!m) return null;
  const body = threadText({ status, summary, links, files });
  if (!body) return m;
  const now = Date.now();
  m.messages = Array.isArray(m.messages) ? m.messages.slice() : [];
  m.messages.push({ role: "assistant", text: body, at: now, reportBack: true, status: status || "done", pasted: !!pasted });
  const block = `**${headingFor(status, pasted)}**\n\n${body}`;
  m.deliverable = m.deliverable ? `${m.deliverable}\n\n---\n\n${block}` : block;
  const { missionSummary } = await import("./mission.js");
  ctx().store.saveMission(m, missionSummary({ ...m, title: m.title || "" }));
  emit("mission.update", { mission: m });
  return m;
}

async function writeGrok(jobId, { status, summary, links }) {
  const { findJob, applyStatus } = await import("./grokbot.js");
  if (!findJob(jobId)) return false;
  const mapped = status === "needs_input" ? "needs_approval" : status === "failed" ? "failed" : "done";
  const artifacts = (links || []).map((url) => ({ name: url, url }));
  applyStatus(jobId, {
    status: mapped,
    text: summary || "",
    artifacts,
    by: "grokbot",
    note: status === "failed" ? "reported back" : status === "needs_input" ? "needs your input" : "reported back",
  });
  return true;
}

export async function applyLocal(row, { pasted = false } = {}) {
  if (!row || !validId(row.jobId)) return null;
  const status = STATUSES.includes(row.status) ? row.status : "done";
  const summary = clip(row.summary || "", 8000);
  const links = Array.isArray(row.links) ? row.links.filter((u) => typeof u === "string").slice(0, 20) : [];
  const files = Array.isArray(row.files) ? row.files.slice(0, 10) : [];
  const list = localJobs();
  let job = list.find((j) => j.id === row.jobId);
  if (job && (job.status === "done" || job.status === "failed") && !pasted) {
    return { jobId: job.id, status: job.status, duplicate: true, threadId: job.threadId || null };
  }
  if (!job) {
    job = { id: row.jobId, kind: row.jobId.startsWith("gb-") ? "grokbot" : "copy", threadId: row.threadId || null, targetId: null, createdAt: Date.now() };
    list.unshift(job);
  }
  job.status = status;
  job.summary = summary;
  job.links = links;
  job.files = files;
  job.updatedAt = Date.now();
  saveLocal(list);
  const threadId = row.threadId || job.threadId || null;
  try { await writeThread(threadId, { status, summary, links, files, pasted }); } catch {}
  if (job.kind === "grokbot" || String(job.id).startsWith("gb-")) {
    try { await writeGrok(job.id, { status, summary, links }); } catch {}
  }
  // credits the agent reported for this job: counted once per job and line
  const who = job.kind === "grokbot" || String(job.id).startsWith("gb-") ? "Grok Bot" : "A handed-off AI";
  for (const [i, u] of (Array.isArray(row.usage) ? row.usage : []).slice(0, 5).entries()) {
    try { acceptUsageReport({ provider: u.provider, cost: u.cost, note: u.note, report_id: `${job.id}:${i}`, by: who }); } catch {}
  }
  emit("reportback.result", { jobId: job.id, status, summary, links, threadId, pasted: !!pasted });
  emit("log", { text: `Report back ${job.id} ${status}.` });
  return { jobId: job.id, status, summary, threadId };
}

export async function pasteReport({ text, threadId, jobId, confirm } = {}) {
  if (confirm !== true) {
    const e = new Error("Paste result only saves when you click Save."); e.status = 400; throw e;
  }
  const parsed = parsePasted(text);
  if (!parsed.summary) { const e = new Error("Paste the result first."); e.status = 400; throw e; }
  const waiting = localJobs().find((j) => j.threadId && j.threadId === threadId && j.status === "waiting");
  const id = validId(jobId) ? jobId : (waiting ? waiting.id : newId());
  if (!localJob(id)) rememberLocal({ jobId: id, kind: String(id).startsWith("gb-") ? "grokbot" : "copy", threadId });
  const known = localJob(id);
  return applyLocal({ jobId: id, status: "done", summary: parsed.summary, links: [], files: [], threadId: threadId || known?.threadId || null }, { pasted: true });
}

async function ackRemote(jobId) {
  const base = workerUrl();
  const token = workerToken();
  if (!base || !token || !validId(jobId)) return;
  await localFetch(`${base}/api/handoff/${jobId}/ack`, {
    method: "POST",
    headers: { accept: "application/json", connection: "close", authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  }).catch(() => {});
}

let pollTimer = null;
let pollStop = false;
let pollAbort = null;
export function startReportPoller() {
  if (pollTimer || pollStop || !workerOn()) return;
  const wait = (() => {
    const n = Number(process.env.CC_REPORTBACK_POLL_WAIT_MS);
    if (Number.isFinite(n) && n >= 200 && n <= 25000) return Math.floor(n);
    return 20000;
  })();
  const loop = async () => {
    if (pollStop || !workerOn()) return;
    const base = workerUrl();
    const token = workerToken();
    try {
      pollAbort = new AbortController();
      const res = await localFetch(`${base}/api/handoff/inbox?wait=${wait}`, {
        method: "GET",
        headers: { accept: "application/json", connection: "close", authorization: `Bearer ${token}` },
        signal: pollAbort.signal,
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        for (const row of data?.results || []) {
          try { await applyLocal(row); } catch {}
          await ackRemote(row.jobId);
        }
      }
    } catch {}
    pollAbort = null;
    if (!pollStop) {
      pollTimer = setTimeout(loop, 400);
      pollTimer.unref?.();
    }
  };
  pollTimer = setTimeout(loop, 250);
  pollTimer.unref?.();
}
export function stopReportPoller() {
  pollStop = true;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  try { pollAbort?.abort(); } catch {}
  pollAbort = null;
}
