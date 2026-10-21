// Inbound Meldmind webhook. Zapier or Make POSTs here to start a chat, a council, or a mission
// and get the result back. The token is checked. A send, post, or charge inside the run still
// waits for Allow in the app. This route does not use the session token.
import { HOSTED, getContext, allContexts, runAs, ctx } from "./store.js";
import { inboundMatches } from "./apps.js";
import { pendingList } from "./mcp.js";
import { bus } from "./events.js";

export const HOOK_PATH = "/api/hooks/meldmind";
const MAX_BODY = 64 * 1024;
const MAX_WAIT_MS = 60000;
const DEFAULT_WAIT_MS = 45000;
const hooksPerMinute = 30;
const hits = new Map();

let starters = null;
export function setStarters(s) { starters = s; }

export const isHook = (pathname) => String(pathname || "") === HOOK_PATH || String(pathname || "").startsWith(`${HOOK_PATH}/runs/`);

const err = (status, message) => Object.assign(new Error(message), { status });

function readLimited(req, max) {
  return new Promise((resolve, reject) => {
    let d = "", over = false;
    req.on("data", (c) => {
      if (over) return;
      d += c;
      if (Buffer.byteLength(d) > max) { over = true; reject(err(413, "payload too large")); req.resume(); }
    });
    req.on("end", () => { if (!over) resolve(d); });
    req.on("error", reject);
  });
}

function presentedToken(req, url) {
  const auth = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  return req.headers["x-meldmind-token"] || auth || url.searchParams.get("t") || "";
}

function contextFor(presented) {
  if (!HOSTED) {
    const c = getContext(null);
    return c && runAs(c, () => inboundMatches(presented)) ? c : null;
  }
  for (const c of allContexts()) {
    if (runAs(c, () => inboundMatches(presented))) return c;
  }
  return null;
}

function rateOk(id, now = Date.now()) {
  const list = (hits.get(id) || []).filter((t) => now - t < 60000);
  if (list.length >= hooksPerMinute) { hits.set(id, list); return false; }
  list.push(now);
  hits.set(id, list);
  return true;
}

function callsOf(m) {
  return (m?.toolCalls || []).map((c) => ({ tool: c.tool || c.name || "", server: c.server || null, ok: !!c.ok, denied: !!c.denied }));
}

function resultOf(kind, m) {
  const text = kind === "council" ? (m?.verdict?.text || m?.deliverable || "") : (m?.deliverable || "");
  return { ok: m?.status === "done", kind, id: m?.id || null, status: m?.status || "unknown", text, toolCalls: callsOf(m) };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function readRun(id) {
  return ctx().store.getMission(id);
}

export async function handleHook(req, res, url, send) {
  const token = String(presentedToken(req, url) || "");
  const c = contextFor(token);
  if (!c) return send(res, 401, { error: "token not recognised" });
  return runAs(c, async () => {
    if (!rateOk(c.userId || "local")) return send(res, 429, { error: `at most ${hooksPerMinute} calls a minute` });
    if (req.method === "GET" && url.pathname.startsWith(`${HOOK_PATH}/runs/`)) {
      const id = decodeURIComponent(url.pathname.slice(`${HOOK_PATH}/runs/`.length));
      if (!/^[a-z0-9-]{4,80}$/i.test(id)) return send(res, 404, { error: "not found" });
      const m = await readRun(id);
      if (!m) return send(res, 404, { error: "not found" });
      const kind = m.kind === "council" ? "council" : m.kind === "mission" ? "mission" : "chat";
      const body = resultOf(kind, m);
      body.needsApproval = pendingList().length > 0;
      return send(res, body.status === "running" || body.status === "planning" ? 202 : 200, body);
    }
    if (req.method !== "POST" || url.pathname !== HOOK_PATH) {
      res.setHeader("allow", "POST, GET");
      return send(res, 405, { error: "POST only" });
    }
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return send(res, 415, { error: "content-type must be application/json" });
    let raw;
    try { raw = await readLimited(req, MAX_BODY); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(res, 400, { error: "send a JSON object" }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "send a JSON object" });
    if (!starters?.runChat) return send(res, 503, { error: "Meldmind is still starting." });
    const kindIn = String(body.kind || "chat").toLowerCase();
    const kind = kindIn === "single" ? "chat" : kindIn;
    if (!["chat", "council", "mission"].includes(kind)) return send(res, 400, { error: "kind must be chat, council, or mission" });
    const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Number.isFinite(Number(body.waitMs)) ? Number(body.waitMs) : DEFAULT_WAIT_MS));
    let runId = null;
    const spy = (ev) => {
      const id = ev?.mission?.id || ev?.council?.id;
      if (id && !runId) runId = id;
    };
    bus.on("event", spy);
    try {
      let promise;
      if (kind === "chat") {
        const prompt = String(body.prompt || "").trim();
        if (!prompt || prompt.length > 8000) return send(res, 400, { error: "prompt is required" });
        promise = starters.runChat({ prompt, provider: body.provider, model: body.model, search: body.search === true, tools: body.tools !== false });
      } else if (kind === "council") {
        const prompt = String(body.prompt || "").trim();
        if (!prompt || prompt.length > 8000) return send(res, 400, { error: "prompt is required" });
        promise = starters.runCouncil({ prompt, lite: body.lite !== false, qa: body.qa === true, search: body.search === true, tools: body.tools !== false, mode: body.mode });
      } else {
        const goal = String(body.goal || body.prompt || "").trim();
        if (!goal || goal.length > 8000) return send(res, 400, { error: "goal is required" });
        const opts = { goal, qa: body.qa === true, search: body.search === true, tools: body.tools !== false, mode: body.mode || "economy" };
        if (Number(body.budgetUsd) > 0) opts.budgetUsd = Number(body.budgetUsd);
        promise = starters.runMission(opts);
      }
      const tracked = promise.then((m) => ({ done: true, m })).catch((e) => ({ done: true, error: e }));
      const timed = await Promise.race([tracked, sleep(waitMs).then(() => ({ timeout: true }))]);
      if (timed.timeout) {
        return send(res, 202, {
          ok: true, kind, id: runId, status: "running",
          needsApproval: pendingList().length > 0,
          poll: runId ? `${HOOK_PATH}/runs/${runId}` : null,
        });
      }
      if (timed.error) return send(res, timed.error.status || 500, { error: timed.error.message, code: timed.error.code });
      const out = resultOf(kind, timed.m);
      out.needsApproval = pendingList().length > 0;
      return send(res, 200, out);
    } catch (e) {
      return send(res, e.status || 500, { error: e.message, code: e.code });
    } finally {
      bus.off("event", spy);
    }
  });
}
