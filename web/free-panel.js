// Free first (0.4.18): the words and HTML for "Save money with free AIs", shared by Settings and the welcome
// screen. Pure functions (no DOM), so tests can check them. The wiring is in web/features/free-first.js.
// Words that change with the mode live in FREE_TERMS: Simple says plain words, Expert keeps the product names.
export const TITLE = "Save money with free AIs";
export const INTRO = "Easy jobs like summaries, drafts, rewrites and quick research go to free AIs first. Hard work still goes to your paid AIs, and a free answer that looks wrong is redone by them.";
export const SWITCH = "Use free AIs first for easy jobs";
export const QUALITY_TOO = "Also in Quality mode";
export const FREE_TERMS = {
  simple: { "openrouter-free": "Free models through your OpenRouter key", "gemini-cli": "The Gemini app on this computer (free with a Google account)", antigravity: "The Antigravity app on this computer", ollama: "A free AI that runs on this computer", gpuTitle: "Free local AI on your graphics card" },
  expert: { "openrouter-free": "OpenRouter :free models", "gemini-cli": "Gemini CLI", antigravity: "Google Antigravity (agy)", ollama: "Ollama (local models)", gpuTitle: "Local models on your NVIDIA GPU (Ollama)" },
};
const mk = (mode) => (mode === "expert" || mode === "developer" ? "expert" : "simple");
export const freeTerm = (key, mode) => FREE_TERMS[mk(mode)][key] ?? FREE_TERMS.simple[key] ?? key;

const plainEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TONE = { ready: "green", signin: "amber", nomodel: "amber", nokey: "", missing: "" };

// What the one button does for each route that is not ready.
export function fixFor(r) {
  if (r.status === "ready") return null;
  if (r.id === "gemini-cli") return r.status === "signin" ? { what: "gemini-signin", label: "Sign in" } : { what: "gemini-cli", label: "Install" };
  if (r.id === "antigravity") return { what: "antigravity", label: "Get it" };
  if (r.id === "ollama") return r.status === "missing" ? { what: "ollama", label: "Install" } : null;
  if (r.id === "openrouter-free") return { what: "openrouter-key", label: "Add a key" };
  return null;
}

export function needsInstall(view = {}) {
  return (view.routes || []).filter((r) => ["gemini-cli", "gemini-signin"].includes(fixFor(r)?.what));
}

export function panelHtml(view = {}, { esc = plainEsc, mode = "simple", setup = false } = {}) {
  const rows = (view.routes || []).map((r) => {
    const fix = fixFor(r);
    const name = freeTerm(r.id, mode);
    const tip = mk(mode) === "expert" ? ` title="${esc(freeTerm(r.id, "simple"))}"` : "";
    return `<div class="row small cc-ff-route" data-ff-route="${esc(r.id)}" style="gap:8px;padding:6px 0;flex-wrap:wrap;align-items:center">
      <b style="min-width:200px"${tip}>${esc(name)}</b>
      <span class="chip ${TONE[r.status] || ""}" data-ff-status="${esc(r.status)}">${esc(r.label)}</span>
      ${r.perDay > 0 ? `<span class="dim">${Number(r.usedToday) || 0} of ${Number(r.perDay)} today</span>` : `<span class="dim">${Number(r.usedToday) || 0} today</span>`}
      <label class="row" style="gap:4px;margin-left:auto"><input type="checkbox" data-ff-on="${esc(r.id)}" ${r.on ? "checked" : ""}> Use it</label>
      ${fix ? `<button type="button" class="btn sm" data-ff-fix="${esc(fix.what)}">${esc(fix.label)}</button>` : ""}
    </div>`;
  }).join("");
  const missing = needsInstall(view);
  const one = missing.length ? `<button type="button" class="btn primary sm" id="cc-ff-setup">Set up the free AIs for me</button>
    <div class="small dim">Meldmind asks before it installs anything. You sign in yourself on Google's own page; Meldmind never sees your password.</div>` : "";
  const today = view.today?.line ? `<div class="small" id="cc-ff-today" style="margin-top:6px">${esc(view.today.line)}</div>` : "";
  return `<div class="panel" id="cc-ff-settings"><h3>${esc(TITLE)}</h3>
    <div class="hint">${esc(INTRO)}</div>
    <label class="row small" style="gap:6px;margin-top:8px"><input type="checkbox" id="cc-ff-on" ${view.on !== false ? "checked" : ""}> ${esc(SWITCH)}</label>
    ${setup ? "" : `<label class="row small" style="gap:6px"><input type="checkbox" id="cc-ff-quality" ${view.qualityToo ? "checked" : ""}> ${esc(QUALITY_TOO)}</label>`}
    ${today}
    <div class="cat-h" style="margin-top:10px">Tried in this order</div>
    ${rows || `<div class="dim small">Checking this computer...</div>`}
    <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">${one}<button type="button" class="btn sm" id="cc-ff-check">Check again</button></div>
    ${localHtml(view, { esc, mode })}
  </div>`;
}

// The graphics card offer. Nothing when there is no suitable NVIDIA card.
export function localHtml(view = {}, { esc = plainEsc, mode = "simple" } = {}) {
  const rec = view.local;
  if (!view.gpu?.found || !rec) return "";
  const dev = mk(mode) === "expert";
  const line = (kind, m) => `<li${kind === "coding" && dev ? ' class="cc-ff-hi"' : ""}><b>${kind === "coding" ? "For code" : "For everyday work"}:</b> ${esc(m.model)} (${esc(m.size)}). <span class="dim">Licence: ${esc(m.licence)}</span>
    <button type="button" class="btn sm" data-ff-pull="${esc(m.model)}">Install this model</button></li>`;
  const order = dev ? [["coding", rec.coding], ["general", rec.general]] : [["general", rec.general], ["coding", rec.coding]];
  const ollama = (view.routes || []).find((r) => r.id === "ollama");
  return `<div class="cat-h" style="margin-top:12px">${esc(freeTerm("gpuTitle", mode))}</div>
    <div class="small">Found ${esc(view.gpu.name)} with ${esc(String(view.gpu.vramGb))} GB${view.gpu.atLeast ? " or more" : ""}. Models for ${esc(rec.tier)} run well on it, free, and nothing leaves this computer.</div>
    ${rec.note ? `<div class="small dim">${esc(rec.note)}</div>` : ""}
    ${ollama?.status === "missing" ? `<div class="row" style="margin-top:4px"><button type="button" class="btn sm primary" data-ff-fix="ollama">Install Ollama (free, from the official source)</button></div>` : ""}
    <ul class="small" style="margin:6px 0 0 18px;padding:0">${order.map(([k, m]) => line(k, m)).join("")}</ul>`;
}

// What the OK box says before anything runs.
export function consentText(what, model = "") {
  if (what === "gemini-cli") return "Install the Gemini app from Google (npm install -g @google/gemini-cli)? After it installs, Meldmind opens it so you can sign in with your Google account.";
  if (what === "gemini-signin") return "Open the Gemini app in its own window so you can sign in with Google? You finish the sign-in yourself.";
  if (what === "ollama") return "Install Ollama from its official source (winget install --id Ollama.Ollama)? It is free and runs AI models on this computer.";
  if (what === "ollama-model") return `Download the model ${model}? It can take a while and uses several GB of disk space.`;
  return "Go ahead?";
}
