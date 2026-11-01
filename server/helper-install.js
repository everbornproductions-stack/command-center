// 0.4.33 (Chris: "Codex, OpenCode, Freebuff say not installed in settings. There should be a link on uninstalled services
// or a way to run it through Meld, like an install button that automatically sets it up for you"):
//  - Install runs `npm install -g <package>` for a helper that is missing. The package names are fixed here and were
//    checked against their publishers (OpenAI, the OpenCode team, Codebuff, Google, Anthropic); nothing a person types
//    ever goes into the command. It runs only after a click, on this PC only (never in the hosted app).
//  - Sign in opens a normal window running the helper's own sign-in. The person signs in there with their own account;
//    Meldmind never sees or types a password.
//  - A helper that is not on npm (Antigravity) gets its download page instead.
import { spawn } from "node:child_process";
import { spawnSpec } from "./mcp-client.js";
import { findBin, clearStatusCache } from "./sub-routes.js";
import { HOSTED } from "./store.js";
import { loadCatalog } from "./free-catalog.js";

export const INSTALL_MS = 5 * 60 * 1000;
export const NODE_PAGE = "https://nodejs.org/en/download";

// id: helper id in server/worker-pool.js. pkg: the exact npm package. bin: the command it adds.
// signIn: what the sign-in window runs (the helper's own command); words: what the person does there.
export const HELPERS = {
  codex: { pkg: "@openai/codex", bin: "codex", signIn: ["login"], words: "A window opens and then your browser: sign in with your ChatGPT account, then come back and press Check again." },
  // Gemini CLI is not installed or signed in from here: Google retired it for individuals on 2026-11-01 ("This client is no
  // longer supported for Gemini Code Assist for individuals ... migrate to Antigravity"). Antigravity replaces it.
  "gemini-cli": { page: "https://antigravity.google/download", words: "Google replaced Gemini CLI with Antigravity for personal accounts. Get Antigravity instead; your Gemini key keeps working." },
  "claude-code": { pkg: "@anthropic-ai/claude-code", bin: "claude", signIn: [], words: "A window opens with Claude Code: type /login, finish in your browser, then close the window and press Check again." },
  opencode: { pkg: "opencode-ai", bin: "opencode", allowScripts: true, signIn: null, words: "" },
  freebuff: { pkg: "freebuff", bin: "freebuff", signIn: [], words: "A window opens with Freebuff: follow its sign-in link in your browser, then close the window and press Check again." },
  // 0.4.36 (panel 0434 item 7): Antigravity sign-in happens in its own app, then the helper list can check it again.
  antigravity: { page: "https://antigravity.google/download", words: "Download Antigravity from Google, install it, sign in there, then press Check again." },
};

export const canInstall = (id) => !!HELPERS[id]?.pkg;
export const canSignIn = (id) => Array.isArray(HELPERS[id]?.signIn);
export const pageFor = (id) => HELPERS[id]?.page || "";

/** The npm arguments for a helper, or null. Pure, so a test can read it. */
export function installArgs(id) {
  const h = HELPERS[id];
  if (!h?.pkg) return null;
  return ["install", "-g", ...(h.allowScripts ? [`--allow-scripts=${h.pkg}`] : []), h.pkg];
}

const tail = (s, n = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(-n);

/**
 * Install one helper. Resolves { ok, id, message, code?, page? }; never throws.
 * deps (tests): findNpm, run(file, args, opts) -> Promise<{ code, out }>.
 */
export async function installHelper(id, deps = {}) {
  const h = HELPERS[id];
  const entry = loadCatalog().entries.find((e) => e.id === id);
  if (entry?.status === "retired") return { ok: false, id, code: "retired", message: entry.retiredNote };
  if (HOSTED) return { ok: false, id, code: "hosted", message: "Installing helpers works in the desktop app on your own PC." };
  if (!h) return { ok: false, id, code: "unknown", message: "Meldmind does not know how to install that helper." };
  if (!h.pkg) return { ok: false, id, code: "page", page: h.page, message: h.words };
  const npm = await (deps.findNpm || (() => findBin({ bin: "npm", envBin: "CC_NPM_BIN" })))();
  if (!npm) return { ok: false, id, code: "no-node", page: NODE_PAGE, message: "Installing needs Node.js on this PC. Get it from nodejs.org (the LTS button), then press Install again." };
  const res = await (deps.run || runOnce)(npm, installArgs(id), { timeoutMs: deps.timeoutMs || INSTALL_MS });
  try { clearStatusCache(); } catch {}
  if (res.code === 0) return { ok: true, id, message: `Installed ${h.bin}.${canSignIn(id) ? " Next, press Sign in." : ""}` };
  if (res.timedOut) return { ok: false, id, code: "timeout", message: "The install took too long and was stopped. Check your internet connection and try again." };
  const out = tail(res.out);
  if (/EACCES|EPERM|permission/i.test(out)) return { ok: false, id, code: "permission", message: "Windows did not allow the install. Try again, or install it yourself from a command window." };
  return { ok: false, id, code: "failed", message: `The install did not finish.${out ? ` npm said: ${out}` : ""}` };
}

function runOnce(file, args, { timeoutMs = INSTALL_MS } = {}) {
  return new Promise((resolve) => {
    const spec = spawnSpec(file, args);
    let out = "", done = false, child;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { try { child?.kill(); } catch {} finish({ code: null, timedOut: true, out }); }, timeoutMs);
    try {
      child = spawn(spec.file, spec.args, { windowsHide: true, windowsVerbatimArguments: !!spec.windowsVerbatimArguments, env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ") } });
      const take = (c) => { out = (out + c).slice(-8000); };
      child.stdout?.on("data", take); child.stderr?.on("data", take);
      child.on("error", (e) => finish({ code: -1, out: String(e?.message || e) }));
      child.on("close", (code) => finish({ code, out }));
    } catch (e) { finish({ code: -1, out: String(e?.message || e) }); }
  });
}

/**
 * Open the helper's own sign-in in a window the person can see. Resolves { ok, id, message, code? }.
 * deps (tests): findHelper, open(binPath, args).
 */
export async function signInHelper(id, deps = {}) {
  const h = HELPERS[id];
  const entry = loadCatalog().entries.find((e) => e.id === id);
  if (entry?.status === "retired") return { ok: false, id, code: "retired", message: entry.retiredNote };
  if (HOSTED) return { ok: false, id, code: "hosted", message: "Signing in to helpers works in the desktop app on your own PC." };
  if (!canSignIn(id)) return { ok: false, id, code: "none", message: "This helper has no sign-in step." };
  const bin = await (deps.findHelper || (() => findBin({ bin: h.bin, envBin: `CC_${h.bin.toUpperCase()}_BIN` })))();
  if (!bin) return { ok: false, id, code: "missing", message: "Install it first, then press Sign in." };
  try { await (deps.open || openWindow)(bin, h.signIn); }
  catch (e) { return { ok: false, id, code: "failed", message: `The sign-in window did not open: ${tail(e?.message, 160)}` }; }
  return { ok: true, id, message: h.words };
}

// A new console window (Windows: start "" cmd /k <bin> <args>), so the person sees the helper and its sign-in link.
function openWindow(bin, args) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("Open a terminal and run " + [bin, ...args].join(" ")));
    const q = (s) => `"${String(s).replace(/"/g, "")}"`;
    const line = `start "Meldmind sign-in" cmd /k ${[q(bin), ...args.map(q)].join(" ")}`;
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], { detached: true, stdio: "ignore", windowsVerbatimArguments: true });
    child.on("error", reject);
    child.unref();
    setTimeout(resolve, 300);
  });
}
