// Free first setup (0.4.18): installs what is missing, only after the person clicks OK.
//  - Gemini on this computer: npm install -g @google/gemini-cli (only when npm is there; otherwise the official link)
//  - Ollama: winget install --id Ollama.Ollama -e --source winget on Windows (otherwise the official download page)
//  - a local model: ollama pull <a model from server/free-ai.json>
//  - Gemini sign-in: opens the Gemini app in its own window so the person signs in with Google there.
// No shell string is ever built: every command is a program and a list of arguments (spawnSpec only wraps a
// .cmd file the way Windows requires). Meldmind never signs in for anyone and never sees a password or key.
import { spawn } from "node:child_process";
import { spawnSpec } from "./mcp-client.js";
import { which, killTree, routeById, findBin } from "./sub-routes.js";
import { CONFIG } from "./gpu.js";

export const LINKS = CONFIG.links;
const MODELS = new Set(CONFIG.gpuTiers.flatMap((t) => [t.general.model, t.coding.model]));
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

// The exact program and arguments for one step. Exported so tests can check there is no shell string.
export async function commandFor(what, { platform = process.platform, model = "", whichImpl = which } = {}) {
  if (what === "gemini-cli") {
    const npm = await whichImpl(platform === "win32" ? "npm.cmd" : "npm").catch(() => "") || await whichImpl("npm").catch(() => "");
    if (!npm) return { link: LINKS.node, why: "Node.js is not installed. Install it from the official page, then press the button again.", alt: LINKS.geminiCli };
    return { file: npm, args: ["install", "-g", "@google/gemini-cli"] };
  }
  if (what === "ollama") {
    if (platform !== "win32") return { link: LINKS.ollama, why: "Download Ollama from the official page." };
    const winget = await whichImpl("winget.exe").catch(() => "") || await whichImpl("winget").catch(() => "");
    if (!winget) return { link: LINKS.ollama, why: "Windows Package Manager is not on this computer. Download Ollama from the official page." };
    return { file: winget, args: ["install", "--id", "Ollama.Ollama", "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"] };
  }
  if (what === "ollama-model") {
    if (!MODELS.has(model)) return { error: "That model is not on Meldmind's list." };
    const ollama = await whichImpl(platform === "win32" ? "ollama.exe" : "ollama").catch(() => "") || await whichImpl("ollama").catch(() => "");
    if (!ollama) return { error: "Install Ollama first." };
    return { file: ollama, args: ["pull", model] };
  }
  if (what === "gemini-signin") {
    const bin = await findBin(routeById("gemini-cli"));
    if (!bin) return { error: "Install the Gemini app first." };
    return { file: bin, args: [], window: true, link: LINKS.geminiCli };
  }
  if (what === "antigravity") return { link: LINKS.antigravity, why: "Download Antigravity from Google's page and sign in there." };
  return { error: "Unknown step." };
}

// Runs one step. consent must be exactly true (the person clicked OK). Resolves { ok, link?, message }.
export async function runInstall(what, { consent, model, spawnImpl = spawn, platform = process.platform, whichImpl } = {}) {
  if (consent !== true) return { ok: false, code: "consent", message: "Meldmind installs nothing without your OK." };
  const cmd = await commandFor(what, { platform, model, whichImpl });
  if (cmd.error) return { ok: false, code: "error", message: cmd.error };
  if (!cmd.file) return { ok: false, code: "link", link: cmd.link, message: cmd.why };
  const spec = spawnSpec(cmd.file, cmd.args);
  if (cmd.window) {
    // the sign-in runs in its own window, where the person finishes it; Meldmind does not watch or type into it
    try {
      const child = spawnImpl(spec.file, spec.args, { shell: false, detached: true, stdio: "ignore", windowsHide: false, windowsVerbatimArguments: spec.windowsVerbatimArguments || undefined });
      child.on?.("error", () => {});
      child.unref?.();
    } catch (e) { return { ok: false, code: "error", message: e.message, link: cmd.link }; }
    return { ok: true, message: "The Gemini app opened in its own window. Pick Sign in with Google there and finish in your browser.", link: cmd.link };
  }
  return await new Promise((resolve) => {
    let child, tail = "";
    try {
      child = spawnImpl(spec.file, spec.args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], windowsVerbatimArguments: spec.windowsVerbatimArguments || undefined });
    } catch (e) { resolve({ ok: false, code: "error", message: e.message }); return; }
    const keep = (c) => { tail = (tail + String(c)).slice(-2000); };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timer = setTimeout(() => { killTree(child); resolve({ ok: false, code: "timeout", message: "The install took too long and was stopped." }); }, INSTALL_TIMEOUT_MS);
    timer.unref?.();
    child.once("error", (e) => { clearTimeout(timer); resolve({ ok: false, code: "error", message: e.message }); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true, message: "Done." } : { ok: false, code: "failed", message: `It did not finish (code ${code}). ${tail.replace(/\s+/g, " ").trim().slice(-300)}` });
    });
  });
}
