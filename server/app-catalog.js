// Curated map from a program name to what it is good at. A later https catalog
// can replace or add entries. It cannot carry an installer or a buy link that runs.
import { CAPABILITIES } from "./registry.js";

const EM = "\u2014";

export const BUNDLED = [
  { id: "ffmpeg", names: ["FFmpeg", "ffmpeg", "ffmpeg.exe"], title: "FFmpeg", capabilities: ["creative"], price: "free", url: "https://ffmpeg.org/", reason: "Trims and converts video on this computer.", keywords: "video|clip|trim|mp4|reel|ffmpeg" },
  { id: "shotcut", names: ["Shotcut", "shotcut", "shotcut.exe"], title: "Shotcut", capabilities: ["creative"], price: "free", url: "https://shotcut.org/", reason: "Cuts a video on a timeline without a subscription.", keywords: "video|edit a video|timeline|shotcut" },
  { id: "blender", names: ["Blender", "blender", "blender.exe"], title: "Blender", capabilities: ["creative"], price: "free", url: "https://www.blender.org/", reason: "Builds 3D scenes and short animation on this PC.", keywords: "3d|blender|animation|model a" },
  { id: "gimp", names: ["GIMP", "gimp", "gimp.exe"], title: "GIMP", capabilities: ["creative"], price: "free", url: "https://www.gimp.org/", reason: "Edits pictures on this PC with no subscription.", keywords: "photo|image|picture|gimp|retouch" },
  { id: "krita", names: ["Krita", "krita", "krita.exe"], title: "Krita", capabilities: ["creative"], price: "free", url: "https://krita.org/", reason: "Paints and edits illustrations on this PC.", keywords: "paint|illustrat|krita|drawing" },
  { id: "inkscape", names: ["Inkscape", "inkscape", "inkscape.exe"], title: "Inkscape", capabilities: ["creative"], price: "free", url: "https://inkscape.org/", reason: "Draws logos and vector art on this PC.", keywords: "logo|vector|svg|inkscape" },
  { id: "audacity", names: ["Audacity", "audacity", "audacity.exe"], title: "Audacity", capabilities: ["creative"], price: "free", url: "https://www.audacityteam.org/", reason: "Records and trims audio on this PC.", keywords: "audio|podcast|audacity|voice recording" },
  { id: "obs", names: ["OBS Studio", "obs", "obs64", "obs64.exe"], title: "OBS Studio", capabilities: ["creative"], price: "free", url: "https://obsproject.com/", reason: "Records the screen or a camera on this PC.", keywords: "screen record|obs|livestream|capture the screen" },
  { id: "handbrake", names: ["HandBrake", "HandBrakeCLI", "handbrake"], title: "HandBrake", capabilities: ["creative"], price: "free", url: "https://handbrake.fr/", reason: "Shrinks a video file so it is easier to share.", keywords: "handbrake|compress a video|transcode" },
  { id: "resolve", names: ["DaVinci Resolve", "Resolve"], title: "DaVinci Resolve", capabilities: ["creative"], price: "free", url: "https://www.blackmagicdesign.com/products/davinciresolve", reason: "Edits and colors video. The free edition is enough to start.", keywords: "davinci|color grade|edit the film" },
  { id: "photoshop", names: ["Adobe Photoshop", "Photoshop"], title: "Photoshop", capabilities: ["creative"], price: "paid", url: "https://www.adobe.com/products/photoshop.html", reason: "Edits photos when the job needs Photoshop itself.", keywords: "photoshop" },
  { id: "word", names: ["Microsoft Word", "WINWORD", "winword.exe"], title: "Microsoft Word", capabilities: ["writing"], price: "paid", url: "https://www.microsoft.com/microsoft-365/word", reason: "Opens and edits the Word document a client sends.", keywords: "word doc|\\.docx|proposal|client letter|microsoft word" },
  { id: "libreoffice", names: ["LibreOffice", "soffice", "soffice.exe"], title: "LibreOffice", capabilities: ["writing"], price: "free", url: "https://www.libreoffice.org/", reason: "Writes and opens documents on this PC for free.", keywords: "proposal|document|libreoffice|client letter|docx" },
  { id: "excel", names: ["Microsoft Excel", "EXCEL", "excel.exe"], title: "Microsoft Excel", capabilities: ["math", "analysis"], price: "paid", url: "https://www.microsoft.com/microsoft-365/excel", reason: "Works a spreadsheet the client already uses.", keywords: "spreadsheet|excel|xlsx|budget sheet" },
  { id: "git", names: ["Git", "git", "git.exe"], title: "Git", capabilities: ["code"], price: "free", url: "https://git-scm.com/", reason: "Keeps code history on this PC.", keywords: "git commit|repository|repo\\b|version control" },
  { id: "vscode", names: ["Visual Studio Code", "Microsoft Visual Studio Code", "code", "code.exe"], title: "Visual Studio Code", capabilities: ["code"], price: "free", url: "https://code.visualstudio.com/", reason: "Edits the project in a code editor on this PC.", keywords: "code editor|visual studio code|vscode" },
  { id: "node", names: ["Node.js", "node", "node.exe"], title: "Node.js", capabilities: ["code"], price: "free", url: "https://nodejs.org/", reason: "Runs JavaScript tools on this PC.", keywords: "node\\.js|javascript tool|npm\\b" },
  { id: "python", names: ["Python", "python", "python3", "python.exe"], title: "Python", capabilities: ["code"], price: "free", url: "https://www.python.org/", reason: "Runs Python scripts on this PC.", keywords: "python" },
  { id: "docker", names: ["Docker Desktop", "docker", "docker.exe"], title: "Docker", capabilities: ["code"], price: "free", url: "https://www.docker.com/", reason: "Runs the project's containers on this PC.", keywords: "docker|container" },
  { id: "gh", names: ["GitHub CLI", "gh", "gh.exe"], title: "GitHub CLI", capabilities: ["code"], price: "free", url: "https://cli.github.com/", reason: "Works with GitHub from the command line.", keywords: "github cli|\\bgh\\b" },
  { id: "notepadpp", names: ["Notepad++", "notepad++"], title: "Notepad++", capabilities: ["code"], price: "free", url: "https://notepad-plus-plus.org/", reason: "Opens code and plain text quickly on Windows.", keywords: "notepad\\+\\+" },
  { id: "aider", names: ["aider", "aider.exe"], title: "Aider", capabilities: ["code"], price: "free", url: "https://aider.chat/", reason: "Edits a repo from the command line with a connected model.", keywords: "aider" },
  { id: "ollama", names: ["Ollama", "ollama", "ollama.exe"], title: "Ollama", capabilities: ["code", "reasoning"], price: "free", url: "https://ollama.com/", reason: "Runs an open model on this PC.", keywords: "ollama|local model" },
];

export function normName(value) {
  return String(value || "").trim().toLowerCase().replace(/\.exe$/i, "");
}

function compileKeywords(source) {
  if (!source) return null;
  const text = String(source);
  if (text.length > 80) return null;
  try { return new RegExp(text, "i"); } catch { return null; }
}

export function compileEntry(raw) {
  if (!raw || typeof raw !== "object") throw bad("A catalog entry is missing.");
  for (const key of ["install", "installer", "command", "script", "buy", "checkout"]) {
    if (raw[key] != null) throw bad("The catalog cannot include an installer or a purchase.");
  }
  const id = String(raw.id || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw bad("A catalog id must be short letters, digits, and dashes.");
  const title = String(raw.title || "").trim();
  if (!title || title.length > 80 || title.includes(EM)) throw bad("A catalog title is missing.");
  const names = Array.isArray(raw.names) ? raw.names.map((n) => String(n || "").trim()).filter(Boolean) : [];
  if (!names.length || names.length > 12) throw bad(`${title} needs a short list of names.`);
  const capabilities = [];
  for (const cap of raw.capabilities || []) {
    const c = String(cap || "").trim().toLowerCase();
    if (!CAPABILITIES.includes(c)) throw bad(`Unknown task type on ${title}.`);
    if (!capabilities.includes(c)) capabilities.push(c);
  }
  if (!capabilities.length) throw bad(`${title} needs a task type.`);
  const price = raw.price === "paid" ? "paid" : raw.price === "free" ? "free" : "";
  if (!price) throw bad(`${title} must be Free or Paid.`);
  const url = String(raw.url || "").trim();
  let parsed;
  try { parsed = new URL(url); } catch { throw bad(`${title} needs an official https link.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw bad(`${title} needs an official https link.`);
  const reason = String(raw.reason || "").trim();
  if (!reason || reason.length > 200 || reason.includes(EM)) throw bad(`${title} needs a short reason.`);
  const keywords = raw.keywords ? String(raw.keywords) : "";
  if (keywords.length > 80) throw bad(`${title} has a keyword list that is too long.`);
  return { id, names, title, capabilities, price, url, reason, keywords: compileKeywords(keywords), keywordSource: keywords };
}

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function bundledCatalog() {
  return BUNDLED.map((row) => compileEntry(row));
}

export function mergeCatalog(base, extra) {
  const map = new Map(base.map((row) => [row.id, row]));
  for (const row of extra || []) map.set(row.id, row);
  return [...map.values()];
}

export function matchOne(name, catalog) {
  const key = normName(name);
  if (!key) return null;
  for (const row of catalog) {
    if (row.names.some((n) => normName(n) === key)) return row;
  }
  // "FFmpeg 6.1" still matches. Short names such as "gh" stay exact, so they do not swallow other tools.
  let best = null;
  for (const row of catalog) {
    for (const n of row.names) {
      const known = normName(n);
      if (known.length < 4) continue;
      if (key.startsWith(known + " ") || key.startsWith(known + "-")) {
        if (!best || known.length > best.len) best = { row, len: known.length };
      }
    }
  }
  return best?.row || null;
}

export function storedCatalog(rows) {
  return (rows || []).map((row) => {
    const { keywords, ...rest } = row || {};
    return rest;
  });
}

export function hydrateCatalog(rows) {
  return (rows || []).map((row) => {
    if (!row || typeof row !== "object") return row;
    if (row.keywords instanceof RegExp) return row;
    const source = typeof row.keywordSource === "string" ? row.keywordSource : (typeof row.keywords === "string" ? row.keywords : "");
    return { ...row, keywords: compileKeywords(source), keywordSource: source };
  });
}

export function validateRemoteCatalog(json) {
  const apps = json && Array.isArray(json.apps) ? json.apps : null;
  if (!apps) throw bad("The catalog needs an apps list.");
  if (apps.length > 200) throw bad("The catalog is too large.");
  return apps.map((row) => compileEntry(row));
}

export async function pullCatalog(url, fetchImpl = globalThis.fetch) {
  const address = String(url || "").trim();
  let parsed;
  try { parsed = new URL(address); } catch { throw bad("The catalog address must start with https."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw bad("The catalog address must start with https.");
  const res = await fetchImpl(address, { redirect: "error", credentials: "omit" });
  if (!res?.ok) throw bad("The catalog could not be read.");
  const len = Number(res.headers?.get?.("content-length") || 0);
  if (len > 200000) throw bad("The catalog is too large.");
  const text = await res.text();
  if (text.length > 200000) throw bad("The catalog is too large.");
  let json;
  try { json = JSON.parse(text); } catch { throw bad("The catalog was not valid."); }
  return validateRemoteCatalog(json);
}
