// Google Antigravity through its headless CLI (agy).
// One task: agy -p "..." --output-format stream-json, then the process exits.
// Keys are never placed on the command line. Output is scrubbed with stripSecrets().
// The manual handoff in server/handoff.js stays as the fallback when agy is missing.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { spawnSpec } from "./mcp-client.js";
import { stripSecrets } from "./handoff.js";
import { doc, putDoc } from "./store.js";
import { emit } from "./events.js";
import { recordCall } from "./ledger.js";
import { observe } from "./brain.js";
import { heuristicClassify } from "./router.js";
import { capsFor } from "./added-caps.js";
import { registerLocalRoute } from "./local-routes.js";
import { addRouteSource } from "./route-extras.js";
import { guard, isProFeature } from "./license.js";

export const AGENT_ID = "antigravity";
export const NAME = "Google Antigravity";
export const COLOR = "#34d399";
export const DOC = "antigravity.state";
export const JOBS = "antigravity.jobs";
const MAX_JOBS = 80;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_TIMEOUT_MS = 20 * 1000;

export const INSTALL_PS1 = "https://antigravity.google/cli/install.ps1";
export const INSTALL_SH = "https://antigravity.google/cli/install.sh";

const SECRET_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
const DEFAULTS = { allowed: false, pinnedVersion: "", seenVersion: "", previousVersion: "", versionChanged: false, signedIn: null, lastError: "" };

const clip = (s, n) => String(s ?? "").slice(0, n);
const oneLine = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

let cachedDetect = null;
let registered = false;
const running = new Map();
let signInChild = null;

export function readState() {
  let d = null;
  try { d = doc(DOC, () => ({ ...DEFAULTS })); } catch { d = null; }
  const raw = d && typeof d === "object" ? d : {};
  return {
    ...DEFAULTS,
    ...raw,
    allowed: raw.allowed === true,
    signedIn: raw.signedIn === true ? true : raw.signedIn === false ? false : null,
    versionChanged: raw.versionChanged === true,
  };
}
function writeState(patch) {
  const next = { ...readState(), ...patch };
  putDoc(DOC, next);
  return next;
}

export function childEnv(base = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (!k || SECRET_ENV.test(k)) continue;
    env[k] = v;
  }
  return env;
}

export function agyCandidates({ env = process.env, platform = process.platform, home, localAppData } = {}) {
  const list = [];
  if (platform === "win32") {
    const base = localAppData || env.LOCALAPPDATA || "";
    if (base) {
      list.push(path.join(base, "agy", "bin", "agy.exe"));
      list.push(path.join(base, "agy", "bin", "agy.cmd"));
      list.push(path.join(base, "agy", "bin", "agy"));
    }
  } else {
    const h = home || env.HOME || os.homedir() || "";
    if (h) list.push(path.join(h, ".local", "bin", "agy"));
  }
  return list;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

export function whichAgy() {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const child = spawn(cmd, ["agy"], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(""); }, 4000);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (c) => { out += c; });
    child.once("error", () => { clearTimeout(timer); resolve(""); });
    child.once("exit", () => {
      clearTimeout(timer);
      const line = String(out).split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
      resolve(line);
    });
  });
}

export async function detectAgy(opts = {}) {
  if (opts.env?.CC_AGY_BIN || (!opts.env && process.env.CC_AGY_BIN)) {
    const p = (opts.env || process.env).CC_AGY_BIN;
    const ok = opts.exists || exists;
    if (ok(p)) return { found: true, path: p, source: "env" };
  }
  const check = opts.exists || exists;
  const which = opts.which || whichAgy;
  try {
    const fromPath = await which();
    if (fromPath && check(fromPath)) return { found: true, path: fromPath, source: "path" };
  } catch { /* PATH lookup is optional */ }
  for (const c of agyCandidates(opts)) {
    if (check(c)) return { found: true, path: c, source: "install" };
  }
  return { found: false, path: "", source: null };
}

export function parseVersion(text) {
  const m = String(text || "").match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : "";
}

export function printTimeoutFlag(ms) {
  const s = Math.max(1, Math.round(Number(ms) / 1000));
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

// The only arguments agy receives. A key in the task is scrubbed first.
export function buildArgs(task, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const clean = stripSecrets(String(task || "")).trim();
  if (!clean) {
    const err = new Error("The task is empty after removing secrets.");
    err.status = 400;
    throw err;
  }
  return ["-p", clean, "--output-format", "stream-json", "--print-timeout", printTimeoutFlag(timeoutMs)];
}

export function commandFor(bin, args, opts = {}) {
  const execPath = opts.execPath || process.env.CC_AGY_EXEC || "";
  if (execPath) return { file: execPath, args: [bin, ...args], windowsVerbatimArguments: false };
  const spec = spawnSpec(bin, args);
  return { file: spec.file, args: spec.args, windowsVerbatimArguments: !!spec.windowsVerbatimArguments };
}

function assertNoSecrets(args) {
  const blob = (args || []).join("\n");
  if (/\b(?:sk-ant-|sk-or-|sk-proj-|sk-|AIza|xai-|gsk_|Bearer\s)/.test(blob)) {
    const err = new Error("Refusing to put a key on the command line.");
    err.status = 400;
    throw err;
  }
}

export function plainAgyError(text, status = "") {
  const s = `${status} ${text || ""}`;
  if (/auth|sign[ -]?in|not logged|login required|authentication required|unauthenticated/i.test(s)) {
    return { code: "signin", message: "Antigravity needs you to sign in. Click Sign in, finish it in the browser, then click Check." };
  }
  if (/quota|rate limit|resource exhausted|out of credits|too many requests|\b429\b/i.test(s)) {
    return { code: "quota", message: "Antigravity is out of quota right now. Try again later, or send this task to another AI." };
  }
  if (/not found|ENOENT|command not found|no such file/i.test(s)) {
    return { code: "install", message: "Antigravity is not installed. Click Install and connect. You do not need a terminal." };
  }
  const detail = oneLine(stripSecrets(text), 240);
  return { code: "agy", message: detail ? `Antigravity could not finish that task. ${detail}` : "Antigravity could not finish that task. Try again, or use the manual handoff." };
}

export function parseAgyLine(line) {
  const t = String(line || "").trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return { raw: t }; }
}

export function eventFrom(msg) {
  if (!msg) return null;
  if (msg.raw) return { kind: "log", text: stripSecrets(msg.raw) };
  if (msg.event === "init") return { kind: "init", conversationId: String(msg.conversation_id || "") };
  if (msg.event === "step_update") {
    const s = msg.step_update || {};
    return {
      kind: "step",
      stepType: String(s.step_type || ""),
      state: String(s.state || ""),
      text: stripSecrets(s.text_delta || ""),
      tool: String(s.tool_name || ""),
    };
  }
  if (msg.event === "result") {
    const r = msg.result || {};
    return {
      kind: "result",
      status: String(r.status || ""),
      response: stripSecrets(r.response || ""),
      error: stripSecrets(r.error || ""),
      usage: r.usage && typeof r.usage === "object" ? r.usage : null,
      conversationId: String(r.conversation_id || ""),
    };
  }
  return { kind: "log", text: "" };
}

function usageFrom(ev) {
  const u = ev?.usage || {};
  return {
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    cost: 0,
  };
}

function killChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try { child.kill(); } catch {}
  const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
  t.unref?.();
  child.once?.("exit", () => clearTimeout(t));
}

function waitExit(child) {
  if (!child) return Promise.resolve(null);
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
}

export function installCommand(platform = process.platform) {
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `irm ${INSTALL_PS1} | iex`] };
  }
  return { file: "bash", args: ["-c", `curl -fsSL ${INSTALL_SH} | bash`] };
}

export async function* iterateJob(opts = {}) {
  const task = stripSecrets(String(opts.task || "")).trim();
  if (!task) {
    const err = new Error("The task is empty.");
    err.status = 400;
    throw err;
  }
  const det = opts.bin ? { found: true, path: opts.bin, source: "given" } : (cachedDetect?.found ? cachedDetect : await detectAgy(opts));
  if (!det.found) {
    yield { kind: "error", plain: plainAgyError("command not found") };
    return;
  }
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const id = opts.jobId || ("agy-" + crypto.randomBytes(6).toString("hex"));
  const args = buildArgs(task, { timeoutMs });
  const cmd = commandFor(det.path, args, opts);
  assertNoSecrets(cmd.args);
  const spawnFn = opts.spawnImpl || spawn;
  let child;
  try {
    child = spawnFn(cmd.file, cmd.args, {
      cwd: opts.cwd || undefined,
      env: childEnv(opts.env || process.env),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: cmd.windowsVerbatimArguments || undefined,
    });
  } catch (e) {
    yield { kind: "error", jobId: id, plain: plainAgyError(e.message) };
    return;
  }
  const rec = { id, child, stopped: false, why: "", kill: () => {} };
  rec.kill = (why = "stop") => { rec.stopped = true; rec.why = why; killChild(child); };
  running.set(id, rec);
  yield { kind: "start", jobId: id, bin: det.path };
  let stderr = "";
  const timer = setTimeout(() => rec.kill("timeout"), timeoutMs);
  timer.unref?.();
  const onAbort = () => rec.kill();
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { stderr = (stderr + c).slice(-4000); });
  }
  child.once("error", (e) => { stderr = (stderr + "\n" + e.message).slice(-4000); });
  const lines = child.stdout
    ? readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    : null;
  let sawResult = false;
  try {
    if (lines) {
      for await (const line of lines) {
        const parsed = eventFrom(parseAgyLine(line));
        if (!parsed) continue;
        if (parsed.kind === "step" && parsed.text) yield { kind: "delta", text: parsed.text, jobId: id, stepType: parsed.stepType };
        else if (parsed.kind === "result") {
          sawResult = true;
          yield { ...parsed, jobId: id };
        }
      }
    }
    const code = await waitExit(child);
    if (!sawResult) {
      const plain = rec.why === "timeout"
        ? { code: "timeout", message: "Antigravity took too long and was stopped." }
        : rec.stopped
          ? { code: "stopped", message: "Stopped. Antigravity was closed." }
          : plainAgyError(stripSecrets(stderr) || `agy exited (${code})`);
      yield { kind: "error", jobId: id, plain, exitCode: code };
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener?.("abort", onAbort);
    try { lines?.close(); } catch {}
    killChild(child);
    running.delete(id);
  }
}

export function stopAgyJob(id) {
  if (id === "signin" && signInChild) {
    killChild(signInChild);
    signInChild = null;
    return true;
  }
  const rec = running.get(id);
  if (!rec) return false;
  rec.kill();
  return true;
}
export function stopAllAgy() {
  for (const rec of running.values()) rec.kill();
  if (signInChild) { killChild(signInChild); signInChild = null; }
}

const jobs = () => {
  try { const list = doc(JOBS, () => []); return Array.isArray(list) ? list : []; } catch { return []; }
};
const saveJobs = (list) => putDoc(JOBS, list.slice(0, MAX_JOBS));

export function publicJob(j) {
  if (!j) return null;
  return {
    id: j.id, task: j.task, status: j.status, text: j.text || "", error: j.error || null,
    createdAt: j.createdAt, updatedAt: j.updatedAt, sentAt: j.sentAt || null, source: j.source || null,
    version: j.version || "",
  };
}
export function listJobs(n = 40) { return jobs().slice(0, n).map(publicJob); }
export function findJob(id) { return jobs().find((j) => j.id === id) || null; }

function upsert(job) {
  const list = jobs().filter((j) => j.id !== job.id);
  list.unshift(job);
  saveJobs(list);
}

function announce(job) {
  emit("antigravity.job", { job: publicJob(job) });
  emit("external.handoff", {
    agent: AGENT_ID, jobId: job.id, status: job.status, task: oneLine(job.task, 160),
    result: oneLine(job.text || job.error || "", 240), sentAt: job.sentAt || null,
    failed: job.status === "failed",
  });
  const note = job.status === "failed" ? job.error : job.status === "done" ? "finished" : "working";
  if (note) emit("log", { text: `Antigravity: ${oneLine(note, 180)}`, level: job.status === "failed" ? "error" : undefined });
}

async function runStored(job, opts = {}) {
  let text = "";
  let result = null;
  let failed = null;
  const started = Date.now();
  try {
    for await (const ev of iterateJob({ task: job.task, jobId: job.id, timeoutMs: opts.timeoutMs, bin: opts.bin })) {
      if (ev.kind === "delta" && ev.text) {
        text += ev.text;
        job.text = text;
        job.updatedAt = Date.now();
        upsert(job);
        emit("antigravity.delta", { jobId: job.id, text: ev.text });
      } else if (ev.kind === "result") result = ev;
      else if (ev.kind === "error") failed = ev.plain;
    }
  } catch (e) {
    failed = plainAgyError(e.message);
  }
  const ms = Date.now() - started;
  if (result?.status === "SUCCESS" || (result && !result.error && result.response && result.status !== "ERROR")) {
    job.status = "done";
    job.text = stripSecrets(result.response || text).trim();
    job.error = null;
    writeState({ signedIn: true, lastError: "" });
  } else if (failed?.code === "stopped" || result?.status === "CANCELED" || result?.status === "INTERRUPTED") {
    job.status = "failed";
    job.error = "Stopped. Antigravity was closed.";
    job.text = stripSecrets(text);
  } else {
    const plain = failed || plainAgyError(result?.error || result?.response || "", result?.status || "");
    job.status = "failed";
    job.error = plain.message;
    job.text = stripSecrets(result?.response || text);
    if (plain.code === "signin") writeState({ signedIn: false, lastError: plain.message });
    else writeState({ lastError: plain.message });
  }
  job.updatedAt = Date.now();
  job.version = readState().seenVersion || "";
  upsert(job);
  const usage = usageFrom(result);
  try {
    recordCall({ provider: AGENT_ID, model: AGENT_ID, usage, missionId: job.id, role: "answer", ms });
  } catch { /* ledger must not hide the result */ }
  try {
    const cls = heuristicClassify(String(job.task || "").slice(0, 4000));
    observe({ provider: AGENT_ID, model: AGENT_ID, capability: cls.capability, difficulty: cls.difficulty, runId: job.id, ok: job.status === "done", cost: 0, ms });
  } catch { /* a score miss does not change the job */ }
  announce(job);
  return publicJob(job);
}

export async function dispatchJob({ task, source = {}, timeoutMs } = {}) {
  guard("desktop");
  const clean = stripSecrets(String(task || "")).trim();
  if (!clean) {
    const err = new Error("Type a task first.");
    err.status = 400;
    throw err;
  }
  const det = cachedDetect?.found ? cachedDetect : await detectAgy();
  cachedDetect = det;
  if (!det.found) {
    const err = new Error(plainAgyError("command not found").message);
    err.status = 409;
    err.code = "install";
    throw err;
  }
  const now = Date.now();
  const job = {
    id: "agy-" + crypto.randomBytes(6).toString("hex"),
    task: clip(clean, 8000),
    status: "working",
    text: "",
    error: null,
    createdAt: now,
    updatedAt: now,
    sentAt: now,
    source: { kind: source.kind === "mission" || source.kind === "council" ? source.kind : "click" },
    version: readState().seenVersion || "",
  };
  upsert(job);
  announce(job);
  runStored(job, { timeoutMs }).catch(() => {});
  return publicJob(job);
}

export async function* agyChatStream(opts = {}) {
  const task = stripSecrets((opts.messages || []).map((m) => m?.content || "").filter(Boolean).join("\n\n") || opts.prompt || "").trim();
  let result = null;
  let failed = null;
  for await (const ev of iterateJob({ task, timeoutMs: opts.timeoutMs, signal: opts.signal })) {
    if (ev.kind === "delta" && ev.text) yield { type: "delta", text: ev.text };
    else if (ev.kind === "result") result = ev;
    else if (ev.kind === "error") failed = ev.plain;
  }
  const bad = (result && result.status && result.status !== "SUCCESS")
    ? plainAgyError(result.error || result.response, result.status)
    : failed;
  if (bad && result?.status !== "SUCCESS") {
    if (bad.code === "signin") writeState({ signedIn: false, lastError: bad.message });
    const err = new Error(bad.message);
    err.code = bad.code;
    throw err;
  }
  writeState({ signedIn: true, lastError: "" });
  yield { type: "done", usage: usageFrom(result), stop: "end" };
}

export function routeModels() {
  if (!isProFeature("desktop")) return [];
  const st = readState();
  if (!st.allowed || !cachedDetect?.found || st.signedIn !== true) return [];
  const caps = capsFor(["code", "reasoning"]);
  return [{
    provider: AGENT_ID,
    providerName: NAME,
    color: COLOR,
    model: AGENT_ID,
    name: "Antigravity",
    tier: "local",
    in: 0,
    out: 0,
    caps,
    baseCaps: caps,
    available: true,
    keyed: true,
    status: "green",
    statusDetail: st.seenVersion ? `agy ${st.seenVersion}` : "agy on this PC",
    balance: null,
    discount: null,
    web: false,
  }];
}

export async function readAgyVersion(bin, opts = {}) {
  const cmd = commandFor(bin, ["--version"], opts);
  assertNoSecrets(cmd.args);
  const spawnFn = opts.spawnImpl || spawn;
  const child = spawnFn(cmd.file, cmd.args, {
    env: childEnv(opts.env || process.env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  let out = "";
  const timer = setTimeout(() => killChild(child), opts.timeoutMs || VERSION_TIMEOUT_MS);
  timer.unref?.();
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (c) => { out += c; });
  child.stderr?.on("data", (c) => { out += c; });
  const code = await waitExit(child);
  clearTimeout(timer);
  const version = parseVersion(out);
  return { version, ok: code === 0 && !!version, output: stripSecrets(out).slice(0, 400) };
}

export async function refreshStatus(opts = {}) {
  const det = await detectAgy(opts);
  cachedDetect = det;
  if (!det.found) return cardView();
  try {
    const got = await readAgyVersion(det.path, opts);
    if (got.version) {
      const st = readState();
      const changed = !!(st.pinnedVersion && st.pinnedVersion !== got.version);
      writeState({
        seenVersion: got.version,
        pinnedVersion: got.version,
        previousVersion: changed ? st.pinnedVersion : (st.previousVersion || ""),
        versionChanged: changed,
      });
    }
  } catch { /* a version miss still leaves the install card */ }
  return cardView();
}

export function cardView() {
  const st = readState();
  const det = cachedDetect || { found: false, path: "", source: null };
  let state = "install";
  let detail = "Needs install. Click Install and connect. Meldmind runs Google's installer. You do not need a terminal.";
  let light = "grey";
  if (!det.found) {
    state = "install";
  } else if (st.signedIn === false) {
    state = "signin";
    light = "amber";
    detail = "Needs sign-in. Click Sign in and finish it in your browser. Meldmind never sees the password.";
  } else if (st.signedIn === true && st.allowed) {
    state = "ready";
    light = "green";
    detail = st.seenVersion ? `Ready. agy ${st.seenVersion}` : "Ready.";
  } else if (det.found) {
    state = "installed";
    detail = st.allowed
      ? "Installed. Click Check to confirm sign-in."
      : "Installed. Turn on Allow before Meldmind can hand it work. The manual handoff stays available.";
  }
  if (st.versionChanged && st.previousVersion && st.seenVersion) {
    detail = `${detail} Antigravity is now ${st.seenVersion}. It was ${st.previousVersion}.`;
  }
  const open = jobs().find((j) => j.status === "working");
  if (open) { light = "green"; detail = "Working on a task."; }
  return {
    id: AGENT_ID,
    name: NAME,
    state,
    light,
    detail,
    found: !!det.found,
    source: det.source || null,
    allowed: st.allowed,
    signedIn: st.signedIn,
    version: st.seenVersion || "",
    pinnedVersion: st.pinnedVersion || "",
    previousVersion: st.previousVersion || "",
    versionChanged: !!st.versionChanged,
    lastError: st.lastError || "",
    fallback: { id: "antigravity", label: "Manual handoff" },
    ready: state === "ready",
  };
}

export function hubCard() {
  const card = cardView();
  const list = jobs();
  const open = list.filter((j) => j.status === "working");
  const activity = list.slice(0, 8).map((j) => ({ ts: j.updatedAt || j.createdAt, jobId: j.id, status: j.status === "working" ? "working" : j.status === "done" ? "done" : "failed", task: oneLine(j.task, 80), note: j.error || "" }));
  return {
    id: AGENT_ID, name: NAME, vendor: "Google", color: COLOR, kind: "agent", links: {}, keyHint: null, unit: null, hasApi: false, demo: false, custom: false, noKey: true,
    keyed: card.ready, masked: null, status: { status: card.light, detail: card.detail }, models: [], liveModels: [],
    agent: {
      tags: [{ id: "code", label: "coding on this PC" }],
      ready: card.ready,
      via: "local-cli",
      open: open.length,
      now: open[0] ? { jobId: open[0].id, status: open[0].status, task: oneLine(open[0].task, 120) } : null,
      activity,
      card,
    },
  };
}

export async function allowAgy(allow) {
  if (allow) guard("desktop");
  writeState({ allowed: !!allow });
  return cardView();
}

export async function installAgy({ confirm, platform = process.platform, spawnImpl = spawn } = {}) {
  if (confirm === true) guard("desktop");
  if (confirm !== true) {
    return { ok: false, needsConfirm: true, message: "Install and connect downloads Google's Antigravity installer and runs it. You sign in in the browser. Nothing is installed until you confirm. No password is stored." };
  }
  const cmd = installCommand(platform);
  assertNoSecrets(cmd.args);
  const child = spawnImpl(cmd.file, cmd.args, { env: childEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
  let err = "";
  child.stderr?.setEncoding?.("utf8");
  child.stderr?.on?.("data", (c) => { err = (err + c).slice(-2000); });
  const code = await waitExit(child);
  await refreshStatus();
  if (code !== 0) {
    return { ok: false, message: "Antigravity did not install. Click Retry. Nothing else on this PC was changed.", detail: oneLine(stripSecrets(err), 200) };
  }
  if (!cachedDetect?.found) {
    return { ok: false, message: "The installer finished, but agy was not found. Click Retry." };
  }
  return { ok: true, message: "Antigravity is installed. Sign in next. Meldmind does not see your password.", card: cardView() };
}

export async function beginSignIn({ confirm, spawnImpl = spawn } = {}) {
  if (confirm === true) guard("desktop");
  if (confirm !== true) {
    return { ok: false, needsConfirm: true, message: "This opens Antigravity sign-in in your browser. You sign in once. Meldmind does not see or store the password." };
  }
  const det = cachedDetect?.found ? cachedDetect : await detectAgy();
  cachedDetect = det;
  if (!det.found) return { ok: false, message: plainAgyError("command not found").message };
  if (signInChild && signInChild.exitCode === null) return { ok: true, message: "Sign-in is already open in your browser." };
  const cmd = commandFor(det.path, []);
  assertNoSecrets(cmd.args);
  try {
    signInChild = spawnImpl(cmd.file, cmd.args, { env: childEnv(), stdio: "ignore", windowsHide: true, shell: false });
    signInChild.once?.("exit", () => { if (signInChild?.exitCode !== null) signInChild = null; });
  } catch (e) {
    return { ok: false, message: plainAgyError(e.message).message };
  }
  return { ok: true, message: "Sign-in is open in your browser. Finish it there, then click Check." };
}

export async function verifyAgy({ confirm } = {}) {
  if (confirm === true) guard("desktop");
  if (confirm !== true) {
    return { ok: false, needsConfirm: true, message: "Check sends one short test task to Antigravity and reads the reply. Nothing is sent until you confirm." };
  }
  const det = cachedDetect?.found ? cachedDetect : await detectAgy();
  cachedDetect = det;
  if (!det.found) return { ok: false, message: plainAgyError("command not found").message, card: cardView() };
  const job = await dispatchJob({ task: "Reply with exactly: ok", source: { kind: "click" } });
  return { ok: true, job, message: "Test task sent. The card updates when Antigravity replies.", card: cardView() };
}

export function registerAntigravity() {
  if (registered) return;
  registered = true;
  addRouteSource(routeModels);
  registerLocalRoute(AGENT_ID, agyChatStream, NAME);
}
registerAntigravity();
