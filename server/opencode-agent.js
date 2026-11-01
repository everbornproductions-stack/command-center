// 0.4.33: OpenCode as a free helper inside Meldmind.
// OpenCode (https://opencode.ai) is a coding agent with free models (provider "opencode": big-pickle, GLM Flash free,
// DeepSeek Flash free ...). Those models only answer through OpenCode itself, and `opencode serve` speaks its own REST
// API (sessions and messages), not an OpenAI-compatible /v1. So Meldmind runs it the way it runs Antigravity:
//  - the binary is found like the other apps (server/sub-routes.js findBin, env CC_OPENCODE_BIN);
//  - `opencode serve` is started on a free localhost port only when a step needs it (hidden window, no console,
//    never port 4747), reused while Meldmind runs, and stopped (the whole process tree) when Meldmind quits or after
//    10 idle minutes;
//  - ask() makes a session in a throwaway temp folder (never the person's project folder unless a code step passes
//    one), sends the prompt, polls for the answer with a hard time limit, and on any failure stops the session and
//    returns { ok: false, code: "quota" | "timeout" | "error" | "missing" | "stopped", message } in plain words;
//  - only a free model (cost 0) is used, picked in a fixed order, and never one whose name or note mentions training
//    or keeping prompts (the Freebuff rule, isSafeModelText);
//  - out of usage rests the helper in Your AI helpers (worker-pool noteLimit / noteRest) so the next helper takes
//    the step. Every answer is recorded by the caller at cost 0 (the stream's usage says free).
// Nothing here signs in, stores a password or passes API keys to OpenCode (its environment is cleaned).
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { findBin, killTree } from "./sub-routes.js";
import { HOSTED } from "./store.js";
import { spawnSpec } from "./mcp-client.js";
import { stripSecrets } from "./handoff.js";
import { cleanEnv, isSafeModelText } from "./freebuff-agent.js";
import { localFetch } from "./loopback-fetch.js";
import { cliLimit } from "./cli-limit.js";
import { capsFor } from "./added-caps.js";
import { registerLocalRoute } from "./local-routes.js";
import { addRouteSource } from "./route-extras.js";
import { noteRest, noteLimit, clearRest, restingUntil, workerUsable } from "./worker-pool.js";

export const AGENT_ID = "opencode";
export const NAME = "OpenCode";
export const COLOR = "#f59e0b";
export const BIN = { bin: "opencode", envBin: "CC_OPENCODE_BIN" };
export const MELDMIND_PORT = 4747; // the installed Meldmind's own port: never used for OpenCode
export const IDLE_MS = 10 * 60 * 1000;
export const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
export const QUIET_MS = 90 * 1000; // no new text for this long reads as "not answering"
export const START_WAIT_MS = 45 * 1000;
export const TIMEOUT_REST_MS = 30 * 60 * 1000;
// Free models, best first. Anything else that is free and safe comes after these, in OpenCode's own order.
export const MODEL_ORDER = ["big-pickle", "glm-5.3-flash-free", "deepseek-v4.1-flash-free", "flint-40b-free"];
export const NOT_INSTALLED = "OpenCode is not installed on this computer yet. Use Install OpenCode under Your AI helpers.";
export const READ_ONLY_LINE = "You are answering a question only. Do not edit, create, or delete files. Do not run commands or use tools. Reply with the answer text only.";
const LIMIT_WORDS = /usage limit|free usage|freeusagelimit|rate.?limit|quota|too many requests|\b429\b|limit reached|out of (?:credits|usage)|insufficient|exhausted|try again later|overloaded/i;

const clip = (s, n = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal?.removeEventListener?.("abort", done); resolve(); }
  signal?.addEventListener?.("abort", done, { once: true });
});
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

// ---------- pure helpers ----------
/** The free models OpenCode offers (provider "opencode", cost 0), safe ones only, in Meldmind's order. */
export function freeModels(config) {
  const providers = Array.isArray(config?.providers) ? config.providers : Array.isArray(config) ? config : [];
  const oc = providers.find((p) => p && p.id === "opencode");
  if (!oc) return [];
  const raw = Array.isArray(oc.models) ? oc.models : Object.entries(oc.models || {}).map(([id, m]) => ({ id, ...(m || {}) }));
  const ok = raw.filter((m) => {
    if (!m || !m.id) return false;
    const c = m.cost || {};
    if (!(Number(c.input) === 0 && Number(c.output) === 0) || c.input == null || c.output == null) return false;
    if (/deprecated/i.test(String(m.status || ""))) return false;
    const words = [m.id, m.name, m.note, m.notes, m.description].filter(Boolean).join(" ");
    return isSafeModelText(words);
  }).map((m) => ({ providerID: "opencode", modelID: String(m.id), name: String(m.name || m.id) }));
  const rank = (m) => { const i = MODEL_ORDER.indexOf(m.modelID); return i < 0 ? MODEL_ORDER.length : i; };
  return ok.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
}
/** The model for one ask: the wanted one when it is free and safe, else the first free one. Null when there is none. */
export function pickFreeModel(config, { want = "" } = {}) {
  const list = freeModels(config);
  const w = String(want || "").replace(/^opencode\//, "");
  return (w && list.find((m) => m.modelID === w)) || list[0] || null;
}

const errorWords = (e) => clip(e?.data?.message || e?.message || e?.data?.name || e?.name || "", 300);
/** What the session's messages say so far: the assistant's text, whether it finished, and any error. */
export function readMessages(list) {
  const msgs = (Array.isArray(list) ? list : []).filter((m) => m && m.info);
  const asst = msgs.filter((m) => m.info.role === "assistant");
  let error = null;
  for (const m of asst) {
    if (m.info.error) { error = { name: String(m.info.error.name || ""), words: errorWords(m.info.error) }; }
    for (const p of m.parts || []) if (p?.type === "error") error = { name: "error", words: clip(p.text || p.message || p.error || "", 300) };
  }
  const last = asst[asst.length - 1] || null;
  const text = asst.map((m) => (m.parts || []).filter((p) => p?.type === "text" && !p.synthetic && !p.ignored).map((p) => String(p.text || "")).join("")).filter((t) => t.trim()).join("\n\n").trim();
  const completed = !!(last && last.info.time?.completed);
  const toolTurn = !!(last && /tool/i.test(String(last.info.finish || "")));
  return { text, error, completed, toolTurn, hasAssistant: !!last };
}
/** A failure in plain words. An error from OpenCode's side (out of free usage, a limit, a provider fault) is "quota". */
export function plainError(err) {
  const name = String(err?.name || "");
  const words = String(err?.words || "");
  if (/abort/i.test(name)) return fail("stopped", "OpenCode was stopped.");
  const lim = cliLimit(words, { short: true });
  const why = LIMIT_WORDS.test(`${name} ${words}`) || lim ? "is out of free usage for now" : "could not answer right now";
  return fail("quota", `OpenCode ${why}${words ? ` (${clip(words, 140)})` : ""}. Another helper will take the step.`, { until: lim?.resetAt || null, detail: words });
}

// ---------- the server process ----------
function freePort(avoid = MELDMIND_PORT) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const once = () => {
      const srv = net.createServer();
      srv.unref();
      srv.once("error", (e) => (++tries < 5 ? once() : reject(e)));
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => (port === avoid && ++tries < 5 ? once() : resolve(port)));
      });
    };
    once();
  });
}
// npm puts opencode.cmd next to node_modules\opencode-ai\bin\opencode.exe: run the .exe itself so there is no cmd window
export function resolveExe(bin, { exists = fs.existsSync } = {}) {
  const b = String(bin || "");
  if (process.platform !== "win32" || !/\.cmd$/i.test(b)) return b;
  const exe = path.join(path.dirname(b), "node_modules", "opencode-ai", "bin", "opencode.exe");
  try { return exists(exe) ? exe : b; } catch { return b; }
}
export function defaultCommand(bin, args) {
  const spec = spawnSpec(resolveExe(bin), args);
  return { file: spec.file, args: spec.args, windowsVerbatimArguments: !!spec.windowsVerbatimArguments };
}
// Synchronous stop for process exit (an async taskkill would never run)
function killTreeSync(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try { spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true, timeout: 5000, stdio: "ignore" }); } catch { /* gone */ }
    return;
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/**
 * One OpenCode runner. Options (tests inject them; the app uses the defaults):
 *  baseUrl     an OpenCode server that is already running (env CC_OPENCODE_URL); then nothing is started or stopped
 *  findBinary  async () => path of the opencode binary, or ""
 *  command     (bin, args) => { file, args } to spawn
 *  fetchImpl   fetch for the loopback calls
 *  idleMs, pollMs, startWaitMs, quietMs, workRoot
 */
export function createOpenCode({
  baseUrl = process.env.CC_OPENCODE_URL || "",
  findBinary = () => (HOSTED ? "" : findBin(BIN)), // the hosted hub never runs programs
  command = defaultCommand,
  spawnImpl = spawn,
  fetchImpl = localFetch,
  idleMs = IDLE_MS, pollMs = 1000, startWaitMs = START_WAIT_MS, quietMs = QUIET_MS,
  workRoot = path.join(os.tmpdir(), "meldmind-opencode"),
  rest = true,
} = {}) {
  const fixed = String(baseUrl || "").replace(/\/+$/, "");
  const st = { child: null, base: fixed || null, starting: null, idle: null, busy: 0, config: null, configAt: 0, startedAt: 0, bin: "", binAt: 0, exitHooked: false };

  async function detect({ refresh = false } = {}) {
    if (fixed) return { installed: true, bin: "" };
    if (!refresh && st.binAt && Date.now() - st.binAt < 60000) return { installed: !!st.bin, bin: st.bin };
    let bin = "";
    try { bin = (await findBinary()) || ""; } catch { bin = ""; }
    st.bin = bin; st.binAt = Date.now();
    return { installed: !!bin, bin };
  }
  const knownInstalled = () => !!fixed || !!st.bin;

  async function call(pathAndQuery, { method = "GET", body, timeoutMs = 10000, signal } = {}) {
    const sigs = [AbortSignal.timeout(timeoutMs)];
    if (signal) sigs.push(signal);
    const r = await fetchImpl(`${st.base}${pathAndQuery}`, {
      method, signal: AbortSignal.any ? AbortSignal.any(sigs) : sigs[0],
      headers: body !== undefined ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const raw = await r.text().catch(() => "");
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch { json = undefined; } // the web app's HTML is not an answer
    return { status: r.status, ok: r.ok, json, raw };
  }

  function hookExit() {
    if (st.exitHooked) return;
    st.exitHooked = true;
    process.once("exit", () => { killTreeSync(st.child); });
  }
  function clearIdle() { if (st.idle) { clearTimeout(st.idle); st.idle = null; } }
  function touch() {
    clearIdle();
    if (fixed || !st.child || st.busy > 0) return;
    st.idle = setTimeout(() => { if (st.busy === 0) stop().catch(() => {}); }, idleMs);
    st.idle.unref?.();
  }

  async function ensureServer() {
    if (fixed) return fixed;
    if (st.child && st.child.exitCode === null && st.base) return st.base;
    if (st.starting) return st.starting;
    st.starting = (async () => {
      const { bin } = await detect({ refresh: !st.bin });
      if (!bin) throw Object.assign(new Error(NOT_INSTALLED), { code: "missing" });
      try { fs.mkdirSync(workRoot, { recursive: true }); } catch { /* the spawn says so */ }
      const port = await freePort();
      const spec = command(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"]);
      let child;
      try {
        child = spawnImpl(spec.file, spec.args, {
          cwd: workRoot, env: cleanEnv(process.env), stdio: "ignore", windowsHide: true, shell: false,
          detached: process.platform !== "win32", windowsVerbatimArguments: !!spec.windowsVerbatimArguments,
        });
      } catch (e) { throw Object.assign(new Error(`OpenCode could not start: ${clip(e.message, 120)}`), { code: "error" }); }
      let exited = false, spawnErr = null;
      child.once("error", (e) => { spawnErr = e; exited = true; });
      child.once("exit", () => { exited = true; if (st.child === child) { st.child = null; st.base = null; st.config = null; clearIdle(); } });
      child.unref?.();
      hookExit();
      st.child = child;
      st.base = `http://127.0.0.1:${port}`;
      st.startedAt = Date.now();
      const until = Date.now() + startWaitMs;
      while (Date.now() < until) {
        if (exited) break;
        try {
          const r = await call("/config/providers", { timeoutMs: 2500 });
          if (r.ok && r.json && typeof r.json === "object") { st.config = r.json; st.configAt = Date.now(); return st.base; }
        } catch { /* not up yet */ }
        await sleep(300);
      }
      const why = spawnErr ? clip(spawnErr.message, 120) : exited ? "it closed right away" : "it did not answer in time";
      await stop();
      throw Object.assign(new Error(`OpenCode could not start (${why}).`), { code: "error" });
    })().finally(() => { st.starting = null; });
    return st.starting;
  }

  /** Stop the server and everything it started. Resolves when it is gone (or after 6 s). */
  function stop() {
    clearIdle();
    const child = st.child;
    st.child = null; if (!fixed) st.base = null; st.config = null;
    if (!child || child.exitCode !== null || !child.pid) return Promise.resolve(false);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(true), 6000); // kept referenced, so stop() always settles
      child.once("exit", () => { clearTimeout(t); resolve(true); });
      killTree(child);
    });
  }

  async function config() {
    if (st.config && Date.now() - st.configAt < 10 * 60 * 1000) return st.config;
    const r = await call("/config/providers");
    if (!r.ok || !r.json || typeof r.json !== "object") throw new Error("OpenCode did not list its models.");
    st.config = r.json; st.configAt = Date.now();
    return st.config;
  }

  function settle(res) {
    if (!rest) return res;
    try {
      if (res.ok) clearRest(AGENT_ID);
      else if (res.code === "quota") { const lim = noteLimit(AGENT_ID, res.detail || res.message); if (!lim) noteRest(AGENT_ID, { until: res.until || null, error: res.message }); }
      else if (res.code === "timeout") noteRest(AGENT_ID, { until: Date.now() + TIMEOUT_REST_MS, error: res.message });
    } catch { /* the helper list is best effort */ }
    return res;
  }

  /**
   * Ask OpenCode one thing. Never throws. Resolves { ok: true, text, model } or { ok: false, code, message }.
   * opts: { model, timeoutMs, signal, folder (a code step's own folder), code (let it use its tools) }
   */
  async function ask(prompt, { model = "", timeoutMs = DEFAULT_TIMEOUT_MS, signal = null, folder = "", code = false } = {}) {
    const clean = stripSecrets(String(prompt ?? "")).trim();
    if (!clean) return fail("error", "Type a question first.");
    if (signal?.aborted) return fail("stopped", "OpenCode was stopped.");
    try { await ensureServer(); }
    catch (e) { return fail(e.code === "missing" ? "missing" : "error", clip(e.message, 240)); }
    st.busy++; clearIdle();
    const own = !folder;
    const dir = folder || path.join(workRoot, `q-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
    const q = `?directory=${encodeURIComponent(dir)}`;
    let sid = "", finished = false;
    try {
      if (own) fs.mkdirSync(dir, { recursive: true });
      let pickedModel;
      try { pickedModel = pickFreeModel(await config(), { want: model }); }
      catch (e) { return fail("error", clip(e.message, 200)); }
      if (!pickedModel) return fail("error", "OpenCode has no free model Meldmind can use right now.");
      const s = await call(`/session${q}`, { method: "POST", body: { title: "Meldmind" }, signal });
      sid = s.json?.id || "";
      if (!s.ok || !sid) return fail("error", `OpenCode did not open a session (HTTP ${s.status}).`);
      const body = {
        model: { providerID: pickedModel.providerID, modelID: pickedModel.modelID },
        parts: [{ type: "text", text: code ? clean : `${READ_ONLY_LINE}\n\n${clean}` }],
        ...(code ? {} : { tools: { bash: false, edit: false, write: false, patch: false, webfetch: false, task: false } }),
      };
      const sent = await call(`/session/${encodeURIComponent(sid)}/prompt_async${q}`, { method: "POST", body, signal }).catch((e) => ({ status: 0, ok: false, raw: e.message }));
      if (sent.status === 404 || sent.status === 405) {
        // an older OpenCode without prompt_async: the plain message call answers when done, so it is not awaited here
        call(`/session/${encodeURIComponent(sid)}/message${q}`, { method: "POST", body, timeoutMs: timeoutMs + 5000, signal }).catch(() => {});
      } else if (!sent.ok) {
        return fail("error", `OpenCode did not take the question (HTTP ${sent.status || "no answer"}).`);
      }
      const started = Date.now();
      const deadline = started + Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
      const quiet = Math.min(quietMs, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
      let lastText = "", lastChange = started;
      while (true) {
        await sleep(pollMs, signal);
        if (signal?.aborted) return fail("stopped", "OpenCode was stopped.");
        const now = Date.now();
        let view = null, status = null;
        try {
          const r = await call(`/session/${encodeURIComponent(sid)}/message${q}`, { timeoutMs: 8000 });
          if (r.ok && Array.isArray(r.json)) view = readMessages(r.json);
        } catch { /* try again on the next poll */ }
        try {
          const r = await call(`/session/status${q}`, { timeoutMs: 5000 });
          if (r.ok && r.json && typeof r.json === "object" && !Array.isArray(r.json)) status = r.json[sid] || { type: "idle" };
        } catch { /* optional */ }
        if (view?.error) return plainError(view.error);
        if (status?.type === "retry" && (Number(status.attempt) >= 2 || LIMIT_WORDS.test(String(status.message || "")))) {
          return plainError({ name: "retry", words: String(status.message || "OpenCode kept retrying") });
        }
        if (view) {
          if (view.text !== lastText) { lastText = view.text; lastChange = now; }
          const idle = !status || status.type === "idle";
          if (view.completed && !view.toolTurn && idle) {
            if (!view.text) return fail("quota", "OpenCode sent back an empty answer. Another helper will take the step.");
            const lim = cliLimit(view.text, { short: true });
            if (lim && view.text.length < 400) return plainError({ name: "limit", words: view.text });
            finished = true;
            return { ok: true, text: view.text, model: `opencode/${pickedModel.modelID}`, modelName: pickedModel.name, ms: now - started };
          }
        }
        if (now >= deadline) return fail("timeout", `OpenCode did not finish in ${Math.round((deadline - started) / 1000)} seconds and was stopped.`);
        if (now - lastChange >= quiet) return fail("timeout", `OpenCode sent nothing for ${Math.round(quiet / 1000)} seconds, so it was stopped. It may be out of free usage for now.`);
      }
    } catch (e) {
      if (signal?.aborted) return fail("stopped", "OpenCode was stopped.");
      return fail("error", `OpenCode could not answer: ${clip(e.message, 160)}`);
    } finally {
      if (sid && !finished && st.base) await call(`/session/${encodeURIComponent(sid)}/abort${q}`, { method: "POST", timeoutMs: 4000 }).catch(() => {});
      if (sid && st.base) await call(`/session/${encodeURIComponent(sid)}${q}`, { method: "DELETE", timeoutMs: 4000 }).catch(() => {});
      if (own) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp folder */ } }
      st.busy = Math.max(0, st.busy - 1);
      touch();
    }
  }
  const askSettled = async (prompt, opts) => settle(await ask(prompt, opts));

  const status = () => ({ running: !!(st.child && st.child.exitCode === null), pid: st.child?.pid || null, base: st.base, busy: st.busy, installed: knownInstalled() });
  return { ask: askSettled, ensureServer, stop, detect, status, knownInstalled, _state: st };
}

// ---------- the app's one runner, the router route and the helper hooks ----------
export const opencode = createOpenCode();
export const detectOpenCode = (opts) => opencode.detect(opts);
export function opencodeReady() {
  try { return opencode.knownInstalled() && workerUsable(AGENT_ID); } catch { return false; }
}
export const opencodeAsk = (prompt, opts) => opencode.ask(prompt, opts);
export const stopOpenCode = () => opencode.stop();

let refreshing = false;
let watched = false; // detection runs only once the server wires OpenCode in (refreshOpenCode), never in a bare import
export function refreshOpenCode() {
  watched = true;
  if (refreshing) return;
  refreshing = true;
  opencode.detect({ refresh: true }).catch(() => {}).finally(() => { refreshing = false; });
}

/** The router's row for OpenCode: free, on this PC, only while it is installed, switched on and not resting. */
export function routeModels() {
  if (watched && Date.now() - (opencode._state.binAt || 0) > 5 * 60 * 1000) refreshOpenCode();
  if (!opencode.knownInstalled()) return [];
  if (!workerUsable(AGENT_ID)) return []; // switched off, or resting after its free usage ran out
  const caps = capsFor(["code", "reasoning"]);
  return [{
    provider: AGENT_ID, providerName: NAME, color: COLOR, model: AGENT_ID, name: "OpenCode (free models)",
    tier: "local", in: 0, out: 0, caps, baseCaps: caps, available: true, keyed: true, status: "green",
    statusDetail: "Free models through OpenCode on this PC", balance: null, discount: null, web: false, free: true, runnable: true,
  }];
}

const tokens = (s) => Math.ceil(String(s || "").length / 4);
/** The router's stream: one ask, the whole answer as one delta, usage at cost 0 (free) for the ledger. */
export async function* opencodeChatStream(opts = {}, runner = opencode) {
  const system = typeof opts.system === "string" && opts.system.trim() ? `${opts.system.trim()}\n\n` : "";
  const text = (opts.messages || []).map((m) => (typeof m?.content === "string" ? m.content : "")).filter(Boolean).join("\n\n") || String(opts.prompt || "");
  const prompt = `${system}${text}`;
  const r = await runner.ask(prompt, { model: opts.model && opts.model !== AGENT_ID ? opts.model : "", signal: opts.signal, timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
  if (!r.ok) {
    const err = new Error(r.message);
    err.code = r.code;
    if (r.code === "quota") { err.status = 429; err.limit = true; err.until = restingUntil(AGENT_ID) || null; }
    else if (r.code === "timeout") err.status = 504;
    else if (r.code === "missing") err.status = 409;
    else if (r.code === "stopped") err.name = "AbortError";
    else err.status = 502;
    throw err;
  }
  yield { type: "delta", text: r.text };
  yield { type: "done", usage: { input: tokens(prompt), output: tokens(r.text), cost: 0, free: true, estimated: true, actualModel: r.model || null }, stop: "end" };
}

/** One mission step (a code step may pass its own folder). Never throws: { ok, text } or { ok: false, reason, code }. */
export async function opencodeStep(t, { folder = "", ask = opencodeAsk, signal } = {}) {
  const text = `${t?.title || "Step"}. ${t?.instructions || ""}`.trim();
  const r = await ask(text, { folder, code: !!folder, signal });
  return r.ok ? { ok: true, text: r.text, model: r.model } : { ok: false, reason: r.message, code: r.code };
}

let registered = false;
export function registerOpenCode() {
  if (registered) return;
  registered = true;
  addRouteSource(routeModels);
  registerLocalRoute(AGENT_ID, (opts) => opencodeChatStream(opts), NAME);
}
registerOpenCode();
