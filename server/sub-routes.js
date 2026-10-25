// Backup when API credits run out (2026-10-21, Chris approved).
// The order is one list, CHAIN, so a later step can be slotted in without rework:
//   1. Official apps on this PC (Claude Code, Codex, Gemini CLI, Antigravity), signed in with the person's own plan
//   2. Website (only if the person turned it on; stored, not wired in this pass)
//   3. You copy it over (the click handoff with send-back instructions and automatic checking)
//
// This module knows the official command-line apps: where they are, whether they are signed in, and how to
// ask one question. It never starts a sign-in, never reads a sign-in file (only checks that it exists), never
// uses a shell (shell: false, the prompt goes on stdin, never on the command line), and kills the whole
// process tree on a timeout or on Stop waiting. API keys are kept out of the child's environment, so the app
// answers with the person's subscription, not an API key. Nothing here opens or reads a chat website.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { spawnSpec } from "./mcp-client.js";
import { stripSecrets } from "./handoff.js";
import { doc, putDoc, HOSTED } from "./store.js";
import { childEnv, detectAgy, readState as agyState, iterateJob as agyIterate } from "./antigravity-cli.js";

export const SETTINGS = "subroutes.settings";
export const CHAIN = [
  { id: "apps", n: 1, label: "Official apps on this PC" },
  { id: "website", n: 2, label: "Website (if you turned it on)" },
  { id: "copy", n: 3, label: "You copy it over" },
];
export const CHAIN_LINE = CHAIN.map((s) => `${s.n}. ${s.label}`).join(", ");
export const APPS_NOTE = "Uses the official app for each AI, signed in with your own plan.";
export const WEBSITE_LABEL = "Let Meldmind use the website for me (ChatGPT, Claude, Grok)";
export const WEBSITE_WARNING = "This uses browser control to type into the website and read the reply. The websites' terms do not allow automated use, and your account could be suspended. Use the official apps above when you can.";
export const WEBSITE_LATER = "Website mode is coming in a later update.";
export const STATUS_LABEL = { ready: "Installed and signed in", signin: "Not signed in", missing: "Not installed" };
export const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;
const OUT_MAX = 400000;

// The question-only rule every app gets, in its own words and (where the app documents one) as a flag.
export const READ_ONLY_LINE = "You are answering a question only. Do not edit, create, or delete files. Do not run commands or use tools. Reply with the answer text only.";

// Each official app. args never carry the question: it goes on stdin.
//  - Claude Code: print mode reads the prompt from stdin; plan mode does not edit files or run commands.
//  - Codex: "exec -" reads the prompt from stdin; the read-only sandbox blocks writes and commands that change things.
//  - Gemini CLI: -p is appended to stdin; without a yes-to-all flag, tools that change things are not run.
//  - Antigravity: the existing agy route (server/antigravity-cli.js) where it is already set up.
export const ROUTES = [
  { id: "claude-code", name: "Claude Code", plain: "The Claude app on this computer (Claude Code)", ai: "Claude", providers: ["anthropic"], bin: "claude", envBin: "CC_CLAUDE_BIN",
    args: ["-p", "--output-format", "text", "--permission-mode", "plan"],
    signin: { all: [[".claude", ".credentials.json"]], darwin: [[".claude.json"]] },
    setupUrl: "https://docs.anthropic.com/en/docs/claude-code/setup" },
  { id: "codex", name: "Codex", plain: "The ChatGPT app on this computer (Codex)", ai: "ChatGPT", providers: ["openai"], bin: "codex", envBin: "CC_CODEX_BIN",
    args: ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--color", "never", "-"],
    signin: { all: [[".codex", "auth.json"]] },
    setupUrl: "https://developers.openai.com/codex/cli" },
  { id: "gemini-cli", name: "Gemini CLI", plain: "The Gemini app on this computer", ai: "Gemini", providers: ["google"], bin: "gemini", envBin: "CC_GEMINI_BIN",
    args: ["-p", "Answer the question you were given on standard input. Do not edit files or run commands."],
    signin: { all: [[".gemini", "oauth_creds.json"]] },
    setupUrl: "https://github.com/google-gemini/gemini-cli" },
  { id: "antigravity", name: "Antigravity", plain: "The Antigravity app on this computer", ai: "Gemini", providers: ["google"], agy: true,
    setupUrl: "https://antigravity.google/" },
];
export const routeById = (id) => ROUTES.find((r) => r.id === id) || null;
export const routesFor = (provider) => ROUTES.filter((r) => r.providers.includes(provider));

// ---------- settings (one source of truth for Settings and Setup) ----------
export function routeSettings() {
  let d = null;
  try { d = doc(SETTINGS, () => ({ routes: {}, website: false })); } catch { d = null; }
  const raw = d && typeof d === "object" ? d : {};
  const routes = {};
  for (const r of ROUTES) if (typeof raw.routes?.[r.id] === "boolean") routes[r.id] = raw.routes[r.id];
  const paths = {};
  for (const r of ROUTES) if (!r.agy && typeof raw.paths?.[r.id] === "string" && raw.paths[r.id]) paths[r.id] = raw.paths[r.id];
  return { routes, paths, website: raw.website === true, websiteAt: raw.websiteAt || null, signedOut: raw.signedOut && typeof raw.signedOut === "object" ? raw.signedOut : {} };
}
export function saveRouteSettings(patch = {}) {
  const cur = routeSettings();
  const next = { ...cur, routes: { ...cur.routes }, paths: { ...cur.paths } };
  // A program the person points to by hand (0.4.18): a full path to an existing file named after that app.
  if (patch.paths && typeof patch.paths === "object") {
    for (const [id, p] of Object.entries(patch.paths)) {
      const r = routeById(id);
      if (!r || r.agy) continue;
      if (!p) { delete next.paths[id]; continue; }
      const err = checkCustomPath(r, String(p));
      if (err) throw Object.assign(new Error(err), { status: 400, code: "path" });
      next.paths[id] = path.resolve(String(p));
    }
    clearStatusCache();
  }
  if (patch.routes && typeof patch.routes === "object") {
    for (const [id, on] of Object.entries(patch.routes)) if (routeById(id) && typeof on === "boolean") next.routes[id] = on;
  }
  if (patch.website !== undefined) {
    const on = patch.website === true;
    if (on && !cur.website && patch.confirm !== true) {
      throw Object.assign(new Error(`Turning on website mode needs a confirm. ${WEBSITE_WARNING}`), { status: 400, code: "confirm", needsConfirm: true });
    }
    next.website = on;
    next.websiteAt = on ? (cur.websiteAt || Date.now()) : null;
  }
  putDoc(SETTINGS, next);
  return routeSettings();
}
// A route the person has not touched is on when it is installed and signed in.
export const routeOn = (id, s = routeSettings()) => s.routes[id] !== false;

// ---------- detection ----------
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
export const homeDir = (env = process.env) => env.CC_SUBCLI_HOME || os.homedir();

export function which(bin, { platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const cmd = platform === "win32" ? "where.exe" : "which";
    let child;
    try { child = spawn(cmd, [bin], { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { resolve(""); return; }
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve(""); }, 4000);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (c) => { out += c; });
    child.once("error", () => { clearTimeout(timer); resolve(""); });
    child.once("exit", () => {
      clearTimeout(timer);
      const lines = String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // npm puts a bare sh script next to the .cmd on Windows: the .cmd or .exe is the one to run
      const pick = platform === "win32" ? (lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) || "") : (lines[0] || "");
      resolve(pick);
    });
  });
}

export function installCandidates(route, { env = process.env, platform = process.platform } = {}) {
  const h = homeDir(env);
  const list = [];
  if (platform === "win32") {
    const appData = env.APPDATA || (h ? path.join(h, "AppData", "Roaming") : "");
    if (h) list.push(path.join(h, ".local", "bin", `${route.bin}.exe`));
    if (appData) list.push(path.join(appData, "npm", `${route.bin}.cmd`));
  } else {
    if (h) { list.push(path.join(h, ".local", "bin", route.bin)); list.push(path.join(h, ".npm-global", "bin", route.bin)); }
    list.push(path.join("/opt/homebrew/bin", route.bin), path.join("/usr/local/bin", route.bin));
  }
  return list;
}

export function checkCustomPath(route, p, { platform = process.platform } = {}) {
  if (!path.isAbsolute(p)) return "Use the full location of the program, for example C:\Users\you\AppData\Roaming\npm\gemini.cmd.";
  let st = null;
  try { st = fs.statSync(p); } catch {}
  if (!st || !st.isFile()) return "No program was found at that location.";
  const base = path.basename(p).toLowerCase();
  const ok = platform === "win32" ? new RegExp(`^${route.bin}\.(exe|cmd|bat)$`, "i").test(base) : base === route.bin;
  if (!ok) return `That file is not ${route.name}. Its name should be ${route.bin}${platform === "win32" ? ".exe or " + route.bin + ".cmd" : ""}.`;
  return "";
}

export async function findBin(route, opts = {}) {
  const env = opts.env || process.env;
  const given = env[route.envBin];
  if (given) return exists(given) ? given : "";
  let custom = "";
  try { custom = routeSettings().paths[route.id] || ""; } catch {}
  if (custom && exists(custom)) return custom;
  if (env.CC_SUBCLI_NO_PATH === "1") return "";
  try { const p = await (opts.which || which)(route.bin); if (p && exists(p)) return p; } catch {}
  for (const c of installCandidates(route, opts)) if (exists(c)) return c;
  return "";
}

// Signed in means the app's own sign-in file is there (it is never opened), and the last answer did not
// come back "not signed in" since that file last changed.
export function signinFile(route, { env = process.env, platform = process.platform } = {}) {
  const h = homeDir(env);
  if (!h || !route.signin) return "";
  const rels = [...(route.signin[platform] || []), ...(route.signin.all || [])];
  for (const rel of rels) { const p = path.join(h, ...rel); if (exists(p)) return p; }
  return "";
}

let cache = { at: 0, rows: null };
export async function routeStatus(route, opts = {}) {
  if (HOSTED) return { id: route.id, name: route.name, ai: route.ai, status: "missing", label: STATUS_LABEL.missing, path: "" };
  if (route.agy) {
    let det = { found: false, path: "" };
    try { det = await detectAgy(opts.env ? { env: opts.env } : {}); } catch {}
    if (!det.found) return { id: route.id, name: route.name, ai: route.ai, status: "missing", label: STATUS_LABEL.missing, path: "" };
    const signed = agyState().signedIn === true;
    return { id: route.id, name: route.name, ai: route.ai, status: signed ? "ready" : "signin", label: signed ? STATUS_LABEL.ready : STATUS_LABEL.signin, path: det.path };
  }
  const bin = await findBin(route, opts);
  if (!bin) return { id: route.id, name: route.name, ai: route.ai, status: "missing", label: STATUS_LABEL.missing, path: "" };
  const file = signinFile(route, opts);
  const out = routeSettings().signedOut[route.id];
  const signed = !!file && !(out && out >= mtime(file));
  return { id: route.id, name: route.name, ai: route.ai, status: signed ? "ready" : "signin", label: signed ? STATUS_LABEL.ready : STATUS_LABEL.signin, path: bin };
}

export async function allStatus({ refresh = false, ...opts } = {}) {
  if (!refresh && cache.rows && Date.now() - cache.at < 60000) return cache.rows;
  const rows = [];
  for (const r of ROUTES) rows.push(await routeStatus(r, opts));
  cache = { at: Date.now(), rows };
  return rows;
}
export const clearStatusCache = () => { cache = { at: 0, rows: null }; };

export async function routesView({ refresh = false } = {}) {
  const s = routeSettings();
  const rows = (await allStatus({ refresh })).map((row) => {
    const r = routeById(row.id);
    return { id: row.id, name: row.name, plain: r.plain || row.name, ai: row.ai, status: row.status, label: row.label, on: routeOn(row.id, s), setupUrl: r.setupUrl, customPath: s.paths[row.id] || "", canSetPath: !r.agy };
  });
  return {
    routes: rows, website: s.website, chain: CHAIN, chainLine: CHAIN_LINE, appsNote: APPS_NOTE,
    websiteLabel: WEBSITE_LABEL, websiteWarning: WEBSITE_WARNING, websiteLater: WEBSITE_LATER, hosted: HOSTED,
  };
}

// The official apps that may answer for this AI right now, in order.
export async function readyRoutesFor(provider, opts = {}) {
  if (HOSTED) return [];
  const s = routeSettings();
  const out = [];
  for (const r of routesFor(provider)) {
    if (!routeOn(r.id, s)) continue;
    const st = await routeStatus(r, opts);
    if (st.status === "ready") out.push({ ...r, path: st.path });
  }
  return out;
}

// ---------- asking one question ----------
export function plainCliError(text, name = "The app") {
  const s = String(text || "");
  if (/not (?:logged|signed) in|login required|please (?:log|sign) ?in|run .*login|authenticat|unauthori[sz]ed|\b401\b|sign[ -]?in required|no credentials/i.test(s)) return { code: "signin", message: `${name} is not signed in.` };
  if (/quota|rate limit|usage limit|limit reached|too many requests|\b429\b|exhausted|out of credits|credit balance|upgrade your plan/i.test(s)) return { code: "quota", message: `${name} is out of its own plan's quota right now.` };
  if (/ENOENT|not found|not recognized|no such file/i.test(s)) return { code: "missing", message: `${name} is not installed.` };
  const detail = stripSecrets(s).replace(/\s+/g, " ").trim().slice(0, 200);
  return { code: "failed", message: detail ? `${name} could not answer. ${detail}` : `${name} could not answer.` };
}

export function commandFor(bin, args, env = process.env) {
  const exec = env.CC_SUBCLI_EXEC || "";
  if (exec) return { file: exec, args: [bin, ...args], windowsVerbatimArguments: false };
  const spec = spawnSpec(bin, args);
  return { file: spec.file, args: spec.args, windowsVerbatimArguments: !!spec.windowsVerbatimArguments };
}

// Stop the app and everything it started. On Windows a child's own children survive child.kill().
export function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/F", "/T", "/PID", String(child.pid)], { windowsHide: true, timeout: 5000 }, () => {});
    return;
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const running = new Map(); // run id -> { stop }
export const runningCount = () => running.size;

export function questionFor(prompt) {
  return `${READ_ONLY_LINE}\n\n${String(prompt || "").trim()}\n`;
}

// One question to one app. Resolves { ok, text } or { ok: false, code, message }. Never throws.
export async function askApp(route, prompt, { timeoutMs, signal, env = process.env, spawnImpl = spawn, runId } = {}) {
  if (route.agy) return askAgy(route, prompt, { timeoutMs, signal });
  const bin = route.path || await findBin(route, { env });
  if (!bin) return { ok: false, ...plainCliError("ENOENT", route.name) };
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : (Number(env.CC_SUBCLI_TIMEOUT_MS) > 0 ? Number(env.CC_SUBCLI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);
  const cmd = commandFor(bin, route.args, env);
  // a scratch folder with nothing in it, so there is nothing to change even if the app tried
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "meldmind-answer-"));
  const id = runId || crypto.randomBytes(6).toString("hex");
  let child;
  try {
    child = spawnImpl(cmd.file, cmd.args, {
      cwd, env: { ...childEnv(env), MELDMIND_ANSWER_ONLY: "1" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false,
      detached: process.platform !== "win32", windowsVerbatimArguments: cmd.windowsVerbatimArguments || undefined,
    });
  } catch (e) {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
    return { ok: false, ...plainCliError(e.message, route.name) };
  }
  return await new Promise((resolve) => {
    let out = "", err = "", why = "", settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      running.delete(id);
      for (const s of [child.stdin, child.stdout, child.stderr]) { try { s?.destroy(); } catch {} }
      killTree(child);
      setTimeout(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} }, 1500).unref?.();
      resolve(res);
    };
    const stop = (reason) => { why = reason; killTree(child); setTimeout(() => finish(reason === "timeout" ? { ok: false, code: "timeout", message: `${route.name} took too long and was stopped.` } : { ok: false, code: "stopped", message: `${route.name} was stopped.` }), 300).unref?.(); };
    const timer = setTimeout(() => stop("timeout"), ms);
    timer.unref?.();
    const onAbort = () => stop("stopped");
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    running.set(id, { stop: () => stop("stopped") });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c) => { if (out.length < OUT_MAX) out += c; });
    child.stderr?.on("data", (c) => { err = (err + c).slice(-4000); });
    child.stdin?.on("error", () => {});
    child.once("error", (e) => { if (!why) finish({ ok: false, ...plainCliError(e.message, route.name) }); });
    child.once("exit", (code) => {
      if (why) return finish(why === "timeout" ? { ok: false, code: "timeout", message: `${route.name} took too long and was stopped.` } : { ok: false, code: "stopped", message: `${route.name} was stopped.` });
      const text = out.replace(ANSI, "").trim();
      if (code === 0 && text) return finish({ ok: true, text: text.slice(0, OUT_MAX) });
      finish({ ok: false, ...plainCliError(`${err}\n${code === 0 ? "no answer" : text}`, route.name), exitCode: code });
    });
    try { child.stdin?.end(questionFor(prompt)); } catch {}
  });
}

async function askAgy(route, prompt, { timeoutMs, signal } = {}) {
  let text = "", result = null, failed = null;
  try {
    for await (const ev of agyIterate({ task: questionFor(prompt), timeoutMs: Number(timeoutMs) > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS, signal })) {
      if (ev.kind === "delta" && ev.text) text += ev.text;
      else if (ev.kind === "result") result = ev;
      else if (ev.kind === "error") failed = ev.plain;
    }
  } catch (e) { failed = { code: "failed", message: e.message }; }
  if (result?.status === "SUCCESS" && (result.response || text).trim()) return { ok: true, text: String(result.response || text).trim() };
  const p = failed || plainCliError(result?.error || result?.response || "no answer", route.name);
  const code = p.code === "install" ? "missing" : p.code === "agy" ? "failed" : p.code;
  return { ok: false, code, message: p.message };
}

export function stopApp(runId) { const r = running.get(runId); if (!r) return false; r.stop(); return true; }
export function stopAllApps() { for (const r of running.values()) r.stop(); }

// "not signed in" from a real answer: the route sits out until its sign-in file changes or Check again.
export function noteSignedOut(id) {
  const s = routeSettings();
  putDoc(SETTINGS, { ...s, signedOut: { ...s.signedOut, [id]: Date.now() } });
  clearStatusCache();
}
export function clearSignedOut() {
  const s = routeSettings();
  putDoc(SETTINGS, { ...s, signedOut: {} });
  clearStatusCache();
}
