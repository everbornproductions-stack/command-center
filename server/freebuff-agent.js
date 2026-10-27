// Freebuff as a free coder inside Meldmind (0.4.22).
// Freebuff is a free, ad-supported coding agent that runs as a text screen (a TUI). Meldmind starts it in a built-in
// terminal, picks a safe model, types the request for the person and reads the answer back.
//
// Layout of this file:
//  1. Pure functions that take screen text (model pick rules, idle, ads, limits, sign-in, masking, cleanup). Tests feed
//     them recorded screens (test/fixtures/freebuff).
//  2. A Terminal driver: tmux (Linux, Mac) or node-pty (only when it is already installed; nothing is added).
//  3. A session manager (createFreebuff) with start / ask / stop, and the two hooks the free-first router uses.
// Never used: the "Space Bunny Alpha" model (it keeps prompts), any model with a training note, any priced or locked row.
// Nothing is stored about the person's sign-in. The sign-in page is opened by the person, never typed into.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { maskPrivate } from "./mask-private.js";
import { doc, putDoc } from "./store.js";

export const PROVIDER_ID = "freebuff";
export const NAME = "Freebuff";
export const WANT_MODEL = "MiMo v2.6 Flash Fast";
export const NO_TERMINAL = "Freebuff needs the built-in terminal, which is not available on this computer yet.";
export const NOT_INSTALLED = "Freebuff is not installed on this computer yet. Install it once with: npm install -g freebuff";
const STATE_DOC = "freebuff.state";

// ---------- 1. pure functions on screen text ----------
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g;
export const plain = (s) => String(s ?? "").replace(ANSI, "").replace(/\r\n?/g, "\n");
const BOX_ONLY = /^[\s─-╿]*$/;
const trimChrome = (line) => line.replace(/^[\s│┃]+/, "").replace(/[\s│┃]+$/, "");

// A model row is never accepted when it says anything about training, prompts being kept, Space Bunny, a price,
// an upgrade or a lock.
const UNSAFE_ROW = /training|space[\s_-]?bunny|\$\s*\d|\bprices?\b|\bpriced\b|\bupgrade\b|\blocked\b|\block\b|prompts?\s+(?:are\s+)?(?:kept|stored|saved)|keeps?\s+(?:your\s+)?prompts?/i;
export function isSafeModelText(text) { return !!String(text || "").trim() && !UNSAFE_ROW.test(text); }

// The row the picker's arrow points at (the line with "› "), plus a wrapped note line under it.
export function selectedRow(screen) {
  const lines = plain(screen).split("\n");
  const at = lines.findIndex((l) => /(^|[\s│])›\s/.test(l));
  if (at < 0) return null;
  let row = trimChrome(lines[at]).replace(/^›\s*/, "");
  const next = lines[at + 1] == null ? "" : trimChrome(lines[at + 1]);
  // a continuation line is indented, has no multiplier ("2x") and is not box edge
  if (next && !BOX_ONLY.test(lines[at + 1]) && /^\s{3,}/.test(lines[at + 1].replace(/^[\s│┃]/, " ")) && !/\b\d+x\b/.test(next) && !/^›/.test(next)) row += ` ${next}`;
  return row.replace(/\s+/g, " ").trim();
}
// One step of the model picker: what to do with the screen as it is right now.
export function modelDecision(screen, want = WANT_MODEL) {
  const row = selectedRow(screen);
  if (!row) return { action: "wait" };
  if (!row.toLowerCase().includes(String(want).toLowerCase())) return { action: "down", row };
  if (!isSafeModelText(row)) return { action: "refuse", row, reason: `${want} is marked as not safe to use (${row}). Meldmind will not use it.` };
  return { action: "choose", row };
}
export function statusBarLine(screen) {
  const lines = plain(screen).split("\n").filter((l) => /\/model to change/i.test(l));
  return lines.length ? trimChrome(lines[lines.length - 1]) : "";
}
export function statusShowsModel(screen, want = WANT_MODEL) {
  const bar = statusBarLine(screen);
  return !!bar && bar.toLowerCase().includes(String(want).toLowerCase()) && isSafeModelText(bar);
}
export function modelFromStatus(screen, known = [WANT_MODEL]) {
  const bar = statusBarLine(screen).toLowerCase();
  return known.find((m) => bar.includes(m.toLowerCase())) || "";
}

export function isIdle(screen) {
  const s = plain(screen);
  return /Enter a coding task/.test(s) && !/working\.\.\.|Add to the current task/.test(s);
}
export const isBusy = (screen) => /working\.\.\.|Add to the current task/.test(plain(screen));
export function isPicker(screen) { return selectedRow(screen) != null; }

// Boxes of a few lines made of box characters. A box that carries the sponsored card's words is the ad.
const AD_WORDS = /\/ads:|Not now|Sponsored|\[\s*[^\]\n]{2,30}\s*\]\s+Not now/;
function boxBlocks(lines) {
  const blocks = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const l = i < lines.length ? lines[i] : "";
    const isBox = /^\s*[╭┌╒╓╔│┃╰└╘╙╚]/.test(l);
    if (isBox && start < 0) start = i;
    if (!isBox && start >= 0) { blocks.push([start, i - 1]); start = -1; }
    else if (isBox && start >= 0 && /^\s*[╰└╘╙╚]/.test(l)) { blocks.push([start, i]); start = -1; }
  }
  return blocks;
}
function adRanges(lines) {
  const out = [];
  for (const [a, b] of boxBlocks(lines)) {
    const body = lines.slice(a, b + 1).join("\n");
    if (AD_WORDS.test(body)) out.push([a, b]);
  }
  // an ad card that is not in a box: drop the line with the accept hint and its neighbours that hold the card words
  lines.forEach((l, i) => { if (/\/ads:/.test(l) && !out.some(([a, b]) => i >= a && i <= b)) out.push([i, i]); });
  return out;
}
export function stripAds(screen) {
  const lines = plain(screen).split("\n");
  const drop = new Set();
  for (const [a, b] of adRanges(lines)) for (let i = a; i <= b; i++) drop.add(i);
  return lines.filter((_l, i) => !drop.has(i)).join("\n");
}
// The sponsored card as one plain line, to show labelled "Sponsored (Freebuff)". Null when there is none.
export function extractAd(screen) {
  const lines = plain(screen).split("\n");
  const ranges = adRanges(lines);
  if (!ranges.length) return null;
  const [a, b] = ranges[ranges.length - 1];
  const text = lines.slice(a, b + 1).map(trimChrome)
    .filter((l) => !BOX_ONLY.test(l))
    .map((l) => l.replace(/^[─-╿\s]*(?:Sponsored)?[─-╿\s]*$/i, "").replace(/\[\s*[^\]]+\s*\]/g, "").replace(/\bNot now\b/g, "").replace(/\/ads:\S+/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean).join(" ").trim();
  return text ? { text: text.slice(0, 300) } : null;
}

const CHROME_LINE = /\/model to change|Enter a coding task|Add to the current task|working\.\.\.|hours? remaining|^\s*Thinking\b/i;
export function cleanTranscript(screen) {
  const kept = stripAds(screen).split("\n").filter((l) => !BOX_ONLY.test(l) || !l.trim()).map((l) => trimChrome(l).replace(/\s+$/, "")).filter((l) => !CHROME_LINE.test(l));
  const out = [];
  for (const l of kept) { if (!l.trim() && (!out.length || !out[out.length - 1].trim())) continue; out.push(l); }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n");
}
// Just the answer to one request: the clean transcript after the line where the request was echoed.
export function answerFrom(screen, task = "") {
  const clean = cleanTranscript(screen);
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const first = norm(String(task).split("\n").find((l) => l.trim()) || "").slice(0, 28);
  const lines = clean.split("\n");
  let from = 0;
  if (first.length >= 6) {
    for (let i = lines.length - 1; i >= 0; i--) if (norm(lines[i]).includes(first)) { from = i + 1; break; }
  }
  const taskNorm = norm(task);
  let rest = lines.slice(from);
  while (rest.length && (!rest[0].trim() || (norm(rest[0]).length > 3 && taskNorm.includes(norm(rest[0]).replace(/^You:\s*/i, ""))))) rest = rest.slice(1);
  return rest.join("\n").trim();
}

// Limits, in plain words. kind: concurrent | daily | session
export function detectLimit(screen) {
  const s = plain(screen);
  if (/concurrent[\s-]*session/i.test(s)) return { kind: "concurrent", message: "Freebuff is already running in another window on your account. Close that one, then try again." };
  const hrs = s.match(/\b(\d+)\s*\/\s*(\d+)\s*hours?\s+remaining/i);
  if ((hrs && Number(hrs[1]) === 0) || /\b0\s+hours?\s+remaining/i.test(s) || /used (?:up )?all (?:of )?your free hours/i.test(s)) return { kind: "daily", message: "You have used all of today's free Freebuff hours. It comes back tomorrow. Other free AIs will take the work until then." };
  if (/session\s+(?:has\s+)?(?:ended|expired)/i.test(s) || (/\b0m left\b/.test(s) && /new session/i.test(s))) return { kind: "session", message: "This free Freebuff session ended (they last about an hour). Start it again to keep going." };
  return null;
}
export function hoursLeft(screen) {
  const m = plain(screen).match(/\b(\d+)\s*\/\s*(\d+)\s*hours?\s+remaining/i);
  return m ? { left: Number(m[1]), total: Number(m[2]) } : null;
}
export function minutesLeft(screen) {
  const m = plain(screen).match(/\b(\d+)m left\b/);
  return m ? Number(m[1]) : null;
}
// Sign-in: { needed, url }. Only an https link is ever passed on.
export function detectSignIn(screen) {
  const s = plain(screen);
  if (isIdle(s)) return { needed: false, url: null };
  if (!/sign[\s-]*in|log[\s-]*in|authenticat/i.test(s)) return { needed: false, url: null };
  const m = s.match(/https:\/\/[^\s<>"'`)\]]+/);
  const url = m ? m[0].replace(/[.,;:!?]+$/, "") : null;
  return { needed: true, url };
}

// Secrets: the request is masked first, then refused when something that looks like a key is still in it.
const KEY_LIKE = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bAIza[0-9A-Za-z_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{12,}/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(?:xai|gsk|pplx|r8)[-_][A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /\b(?:api[_ -]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{16,}/i,
  /\b[A-Fa-f0-9]{40,}\b/, /\b[A-Za-z0-9+/_-]{48,}={0,2}(?![A-Za-z0-9])/,
];
export const looksLikeKey = (text) => KEY_LIKE.some((re) => re.test(String(text || "")));
export function prepareTask(text) {
  const masked = maskPrivate(String(text ?? "")).replace(/\r\n?/g, "\n").trim();
  if (!masked) { const e = new Error("Type what you want the free coder to do."); e.status = 400; throw e; }
  if (looksLikeKey(masked)) { const e = new Error("That request has something that looks like a password or a key. Take it out first. Nothing was sent."); e.status = 400; e.code = "secret"; throw e; }
  return masked.slice(0, 20000);
}

// Passwords and keys on this PC are not handed to the Freebuff process.
const SECRET_ENV = /^(?:[A-Z0-9]+_)*(?:API_KEY|API_TOKEN|ACCESS_KEY|SECRET_KEY|SECRET|AUTH_TOKEN|ACCESS_TOKEN|SERVICE_KEY|TOKEN|PASSWORD)$|^CC_|^FAL_KEY$/;
export function secretEnvNames(env = process.env) { return Object.keys(env).filter((k) => SECRET_ENV.test(k)); }
export function cleanEnv(env = process.env) { const out = { ...env }; for (const k of secretEnvNames(env)) delete out[k]; return out; }

// ---------- 2. terminal drivers ----------
// Terminal = { screen(): Promise<string>, paste(text), type(text), key(name), close() }
// A driver = { id, available(): Promise<bool>, start({ cwd, cols, rows }): Promise<Terminal> }
function run(cmd, args, { input, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); } catch (e) { reject(e); return; }
    let out = "", err = "";
    const t = setTimeout(() => { try { p.kill(); } catch { /* gone */ } reject(new Error(`${cmd} did not answer`)); }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} exited ${code}`)); });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}

export function findOnPath(names, { env = process.env, exists = fs.existsSync, extra = [] } = {}) {
  const dirs = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean).concat(extra);
  for (const d of dirs) for (const n of names) { const f = path.join(d, n); if (exists(f)) return f; }
  return null;
}
export function findFreebuff(opts = {}) {
  const names = process.platform === "win32" ? ["freebuff.cmd", "freebuff.exe", "freebuff.ps1"] : ["freebuff"];
  return findOnPath(names, { extra: [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "AppData", "Roaming", "npm")], ...opts });
}

const KEYS = { Down: "Down", Up: "Up", Enter: "Enter", Escape: "Escape", "C-c": "C-c" };
export function tmuxDriver({ run: sh = run, exe = "tmux", freebuff = () => findFreebuff() || "freebuff", env = process.env } = {}) {
  return {
    id: "tmux",
    async available() { if (process.platform === "win32") return false; try { await sh(exe, ["-V"]); return true; } catch { return false; } },
    async start({ cwd, cols = 200, rows = 60 }) {
      const name = `mm-fb-${process.pid}-${Date.now().toString(36)}`;
      const unset = secretEnvNames(env).flatMap((k) => ["-u", k]);
      await sh(exe, ["new-session", "-d", "-s", name, "-x", String(cols), "-y", String(rows), "-c", cwd, "env", ...unset, freebuff(), "--cwd", cwd]);
      return {
        driver: "tmux",
        screen: () => sh(exe, ["capture-pane", "-p", "-J", "-t", name, "-S", "-3000"]),
        visible: () => sh(exe, ["capture-pane", "-p", "-t", name]),
        type: (text) => sh(exe, ["send-keys", "-t", name, "-l", text]),
        key: (k) => sh(exe, ["send-keys", "-t", name, KEYS[k] || k]),
        async paste(text) { const buf = `${name}-b`; await sh(exe, ["load-buffer", "-b", buf, "-"], { input: text }); await sh(exe, ["paste-buffer", "-b", buf, "-p", "-d", "-t", name]); },
        async close() { try { await sh(exe, ["send-keys", "-t", name, "C-c"]); await sh(exe, ["send-keys", "-t", name, "C-c"]); } catch { /* ended */ } try { await sh(exe, ["kill-session", "-t", name]); } catch { /* ended */ } },
      };
    },
  };
}

const PTY_KEYS = { Down: "\x1b[B", Up: "\x1b[A", Enter: "\r", Escape: "\x1b", "C-c": "\x03" };
// node-pty is used only when it is already installed. Nothing is added to the app for it.
export function ptyDriver({ load = () => import("node-pty"), loadXterm = () => import("@xterm/headless"), freebuff = () => findFreebuff() || "freebuff", env = process.env } = {}) {
  let ptyMod = null;
  const getPty = async () => { if (ptyMod) return ptyMod; try { const m = await load(); ptyMod = m.default?.spawn ? m.default : m; } catch { ptyMod = false; } return ptyMod; };
  return {
    id: "pty",
    async available() { return !!(await getPty())?.spawn; },
    async start({ cwd, cols = 200, rows = 60 }) {
      const pty = await getPty();
      if (!pty?.spawn) throw new Error(NO_TERMINAL);
      const bin = freebuff();
      const proc = process.platform === "win32" ? pty.spawn("cmd.exe", ["/c", bin, "--cwd", cwd], { name: "xterm-256color", cols, rows, cwd, env: cleanEnv(env) }) : pty.spawn(bin, ["--cwd", cwd], { name: "xterm-256color", cols, rows, cwd, env: cleanEnv(env) });
      let term = null;
      try { const x = await loadXterm(); const T = x.Terminal || x.default?.Terminal; term = new T({ cols, rows, scrollback: 3000, allowProposedApi: true }); } catch { term = null; }
      let raw = "";
      proc.onData((d) => { if (term) term.write(d); else raw = (raw + d).slice(-200000); });
      const render = () => {
        if (term) { const b = term.buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) || ""); return out.join("\n"); }
        return plain(raw).replace(/[\x00-\x08\x0b-\x1f]/g, ""); // eslint-disable-line no-control-regex
      };
      return {
        driver: "pty",
        screen: async () => { await new Promise((r) => setImmediate(r)); return render(); },
        visible: async () => { await new Promise((r) => setImmediate(r)); return render().split("\n").slice(-rows).join("\n"); },
        type: (t) => proc.write(t),
        key: (k) => proc.write(PTY_KEYS[k] || k),
        paste: (t) => proc.write(`\x1b[200~${t}\x1b[201~`),
        close: async () => { try { proc.write("\x03"); proc.write("\x03"); } catch { /* ended */ } try { proc.kill(); } catch { /* ended */ } try { term?.dispose(); } catch { /* ended */ } },
      };
    },
  };
}

// The first driver that works on this computer, or null.
export async function detectDriver(drivers = [tmuxDriver(), ptyDriver()]) {
  for (const d of drivers) { try { if (await d.available()) return d; } catch { /* next */ } }
  return null;
}

// ---------- 3. the session manager ----------
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (status, message, code) => { const e = new Error(message); e.status = status; if (code) e.code = code; return e; };
const DEFAULT_TIMING = { startMs: 40000, pollMs: 1000, pickWaitMs: 400, idleMs: 10000, maxMs: 30 * 60 * 1000, pickSteps: 25 };

export function createFreebuff({ driver = undefined, drivers = undefined, installed = () => !!findFreebuff(), timing = {}, sleep = sleepMs, workRoot = path.join(os.tmpdir(), "meldmind-freebuff"), trouble = undefined, saved = undefined } = {}) {
  const T = { ...DEFAULT_TIMING, ...timing };
  const st = { phase: "stopped", model: "", message: "", signin: null, hours: null, minutes: null, limit: null, limitUntil: 0, transcript: "", ad: null, folder: "", lastAskAt: 0, busy: false, driver: "" };
  let term = null;
  let driverCache = driver === undefined ? undefined : driver;
  let chain = Promise.resolve();

  const persisted = saved || { get: () => { try { return doc(STATE_DOC, () => ({})) || {}; } catch { return {}; } }, set: (v) => { try { putDoc(STATE_DOC, { ...(doc(STATE_DOC, () => ({})) || {}), ...v }); } catch { /* optional */ } } };
  const flag = trouble || {
    async mark(kind, detail) { try { const m = await import("./fallback.js"); m.markTrouble(PROVIDER_ID, kind, detail, { quiet: true }); } catch { /* the table is optional */ } },
    async clear() { try { const m = await import("./fallback.js"); if (m.trouble(PROVIDER_ID)) m.clearTrouble(PROVIDER_ID, "works again"); } catch { /* optional */ } },
    async active() { try { const m = await import("./fallback.js"); return !!m.trouble(PROVIDER_ID); } catch { return false; } },
  };

  async function getDriver() {
    if (driverCache !== undefined) return driverCache;
    driverCache = await detectDriver(drivers);
    return driverCache;
  }
  const pageText = async () => (term ? plain(await term.screen()) : "");
  const refreshView = (screen) => {
    st.transcript = cleanTranscript(screen);
    st.ad = extractAd(screen);
    const h = hoursLeft(screen); if (h) st.hours = h;
    const m = minutesLeft(screen); if (m != null) st.minutes = m;
  };
  function applyLimit(lim) {
    st.phase = "limit"; st.limit = lim.kind; st.message = lim.message;
    st.limitUntil = Date.now() + (lim.kind === "concurrent" ? 90 * 1000 : 15 * 60 * 1000); // matches the trouble table cooldowns
    flag.mark(lim.kind === "concurrent" ? "rate" : "credits", lim.message);
    persisted.set({ lastLimit: lim.kind, lastLimitAt: Date.now() });
  }
  async function closeTerm() { const t = term; term = null; if (t) { try { await t.close(); } catch { /* ended */ } } }

  // Reads the screen and moves the state forward. Safe to call again and again.
  async function advance(screen) {
    refreshView(screen);
    const lim = detectLimit(screen);
    if (lim && !isBusy(screen)) { applyLimit(lim); return st.phase; }
    const si = detectSignIn(screen);
    if (si.needed) {
      st.phase = "signin"; st.signin = si.url ? { url: si.url, label: "Open this link to sign in to Freebuff (free)" } : null;
      st.message = si.url ? "Open the link to sign in to Freebuff. It is free. Then come back here." : "Freebuff is asking you to sign in. Waiting for its link.";
      return st.phase;
    }
    st.signin = null;
    if (isIdle(screen)) {
      if (statusShowsModel(screen, WANT_MODEL)) {
        if (st.phase !== "ready") { st.phase = "ready"; st.limit = null; st.limitUntil = 0; persisted.set({ enabled: true, signedIn: true, lastReadyAt: Date.now() }); flag.clear(); }
        st.model = WANT_MODEL; st.message = "Ready.";
      }
      else if (st.phase !== "ready") st.phase = "picking";
    }
    return st.phase;
  }

  async function pickModel() {
    await term.type("/model"); await sleep(T.pickWaitMs); await term.key("Enter"); await sleep(T.pickWaitMs * 2);
    for (let i = 0; i < T.pickSteps; i++) {
      const view = await (term.visible ? term.visible() : term.screen());
      const d = modelDecision(view, WANT_MODEL);
      if (d.action === "refuse") { await term.key("Escape"); throw fail(409, d.reason, "model"); }
      if (d.action === "choose") {
        await term.key("Enter"); await sleep(T.pickWaitMs * 2);
        const after = await (term.visible ? term.visible() : term.screen());
        if (!statusShowsModel(after, WANT_MODEL)) throw fail(409, `Freebuff did not switch to ${WANT_MODEL}, so nothing was sent.`, "model");
        st.model = WANT_MODEL; return true;
      }
      if (d.action === "down") await term.key("Down");
      await sleep(T.pickWaitMs);
    }
    await term.key("Escape");
    throw fail(409, `Freebuff does not offer ${WANT_MODEL} right now, so Meldmind did not use it.`, "model");
  }

  async function start({ folder } = {}) {
    const dir = folder ? path.resolve(String(folder)) : path.join(workRoot, "work");
    if (term && st.folder === dir && ["ready", "signin", "picking", "starting"].includes(st.phase)) { await poll(); return view(); }
    if (term) await closeTerm();
    const d = await getDriver();
    if (!d) { st.phase = "unavailable"; st.message = NO_TERMINAL; throw fail(501, NO_TERMINAL, "no-terminal"); }
    if (!installed()) { st.phase = "unavailable"; st.message = NOT_INSTALLED; throw fail(501, NOT_INSTALLED, "not-installed"); }
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* checked next */ }
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw fail(400, "That folder was not found.");
    Object.assign(st, { phase: "starting", folder: dir, message: "Starting Freebuff...", signin: null, limit: null, transcript: "", ad: null, model: "", driver: d.id });
    try { term = await d.start({ cwd: dir }); }
    catch (e) { st.phase = "error"; st.message = `Freebuff did not start: ${String(e.message || e).slice(0, 120)}`; term = null; throw fail(502, st.message); }
    await poll(T.startMs);
    return view();
  }

  // Waits (up to ms) for sign-in, a limit, or a ready input; then picks the model once the input is up.
  async function poll(ms = 0) {
    const t0 = Date.now();
    for (;;) {
      if (!term) return st.phase;
      const screen = await pageText();
      const phase = await advance(screen);
      if (phase === "picking") {
        try { await pickModel(); } catch (e) { await closeTerm(); st.phase = "error"; st.message = e.message; throw e; }
        const s2 = await pageText(); await advance(s2);
        return st.phase;
      }
      if (phase === "ready" || phase === "limit") return phase;
      if (phase === "signin" && (ms === 0 || st.signin?.url)) return phase;
      if (Date.now() - t0 >= ms) {
        if (phase === "starting" && ms > 0) { st.phase = "error"; st.message = "Freebuff did not show its input box. It may need you to sign in. Choose Set up again."; await closeTerm(); }
        return st.phase;
      }
      await sleep(T.pollMs);
    }
  }

  const view = () => ({
    installed: !!installed(), driver: st.driver || undefined, running: !!term, phase: st.phase, signedIn: st.phase === "ready" || st.phase === "picking" ? true : !!persisted.get().signedIn,
    model: st.model || null, hoursLeft: st.hours, minutesLeft: st.minutes, limit: st.limit, message: st.message, signin: st.signin,
    transcript: st.transcript, ad: st.ad ? { label: "Sponsored (Freebuff)", text: st.ad.text } : null, busy: st.busy, folder: st.folder || null, free: true,
  });

  async function status({ refresh = true } = {}) {
    if (refresh && term && !st.busy) { try { await poll(0); } catch { /* shown in the message */ } }
    const v = view();
    if (!term && !driverCache && driverCache !== null && driver === undefined) { try { await getDriver(); } catch { /* none */ } }
    v.driver = st.driver || (driverCache && driverCache.id) || undefined;
    v.terminalAvailable = !!driverCache;
    if (driverCache === null) v.message = v.message || NO_TERMINAL;
    v.signedIn = v.signedIn || false;
    return v;
  }

  // One request at a time. Returns { text, free: true, model }.
  function ask(text, { folder } = {}) {
    const job = chain.then(() => doAsk(text, { folder }));
    chain = job.catch(() => {});
    return job;
  }
  async function doAsk(text, { folder } = {}) {
    const task = prepareTask(text); // masks, then refuses anything that still looks like a key
    if (!term || (folder && path.resolve(String(folder)) !== st.folder)) await start({ folder });
    else await poll(0);
    if (st.phase === "signin") throw fail(409, "Sign in to Freebuff first (Free AIs, Set up). It is free.", "signin");
    if (st.phase === "limit") throw fail(429, st.message, "limit");
    if (st.phase !== "ready") throw fail(409, st.message || "Freebuff is not ready yet.", "not-ready");
    if (!isIdle(await pageText())) throw fail(409, "Freebuff is still working on the last request.", "busy");
    // the chosen model must be showing in the status bar right before anything is pasted
    const before = await pageText();
    if (!statusShowsModel(before, WANT_MODEL)) throw fail(409, "Freebuff is not on the safe model, so nothing was sent.", "model");
    st.busy = true; st.lastAskAt = Date.now();
    try {
      await term.paste(task); await sleep(T.pickWaitMs * 2); await term.key("Enter");
      await sleep(T.pickWaitMs * 4);
      const t0 = Date.now(); let last = ""; let sameSince = Date.now(); let seenBusy = false;
      for (;;) {
        await sleep(T.pollMs);
        const screen = await pageText();
        refreshView(screen);
        if (isBusy(screen)) seenBusy = true;
        const lim = detectLimit(screen);
        if (lim && !isBusy(screen)) { applyLimit(lim); throw fail(429, lim.message, "limit"); }
        const si = detectSignIn(screen);
        if (si.needed) { await advance(screen); throw fail(409, "Freebuff asked you to sign in again.", "signin"); }
        const snap = cleanTranscript(screen);
        if (snap !== last) { last = snap; sameSince = Date.now(); }
        if (isIdle(screen) && Date.now() - sameSince >= T.idleMs && (seenBusy || Date.now() - t0 > T.idleMs * 2)) {
          const answer = answerFrom(screen, task);
          st.phase = "ready"; flag.clear();
          return { text: answer, free: true, provider: PROVIDER_ID, model: st.model || WANT_MODEL, ad: st.ad ? { label: "Sponsored (Freebuff)", text: st.ad.text } : null };
        }
        if (Date.now() - t0 > T.maxMs) throw fail(504, "Freebuff took too long on that request, so Meldmind stopped waiting.", "timeout");
      }
    } finally { st.busy = false; }
  }

  async function stop() { await closeTerm(); Object.assign(st, { phase: "stopped", message: "Stopped.", signin: null, busy: false }); return view(); }

  // Ready now, or set up before and able to start by itself. Not while a limit is running.
  const isReady = () => {
    if (st.limitUntil && Date.now() < st.limitUntil) return false;
    if (st.phase === "ready" && term) return true;
    return !!persisted.get().enabled && driverCache !== null && !["limit", "unavailable", "signin", "error"].includes(st.phase);
  };

  return { start, ask, stop, status, view, isReady, advance, getDriver, _state: st, _flag: flag };
}

// ---------- hooks for the free-first router ----------
export const freebuff = createFreebuff();
export function freebuffReady() {
  try { return freebuff.isReady(); } catch { return false; }
}
// task: string, or { text, folder }. Resolves { text, free: true, provider: "freebuff", model }.
export async function freebuffRun(task, opts = {}) {
  const text = typeof task === "string" ? task : task?.text;
  const folder = opts.folder || (typeof task === "object" ? task?.folder : undefined);
  const r = await freebuff.ask(text, { folder });
  return r;
}
// free-bids.js (another worker) exposes setFreeBuffHooks. A missing module or setter is fine.
export function registerFreeBuffHooks(mod, hooks = { freebuffReady, freebuffRun }) {
  if (mod && typeof mod.setFreeBuffHooks === "function") { mod.setFreeBuffHooks(hooks); return true; }
  return false;
}

// One mission step. Never throws: { ok: true, text } or { ok: false, reason } so the mission can hand the step on.
export async function freebuffStep(t, { missionId = "run", ask = freebuffRun } = {}) {
  try {
    const text = `${t.title || "Code step"}. ${t.instructions || ""}`.trim();
    const r = await ask({ text, folder: path.join(os.tmpdir(), "meldmind-freebuff", String(missionId).replace(/[^\w-]/g, "_")) });
    if (!r?.text) return { ok: false, reason: "Freebuff sent back nothing." };
    return { ok: true, text: r.text };
  } catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 160) }; }
}
