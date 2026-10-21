// Text size, high contrast, and Read aloud. Speech starts only when Read aloud is clicked.
const { api, toast, esc } = window.CC;

const LS = "cc.a11y";
const SIZES = [
  { id: "small", label: "Small" },
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
  { id: "xlarge", label: "Extra large" },
];
let prefs = read();
let speaking = false;

function read() {
  try { return { textSize: "default", contrast: false, ...JSON.parse(localStorage.getItem(LS) || "{}") }; }
  catch { return { textSize: "default", contrast: false }; }
}
function remember(p) {
  try { localStorage.setItem(LS, JSON.stringify({ textSize: p.textSize, contrast: !!p.contrast })); } catch {}
}

export function apply(p = prefs) {
  prefs = { textSize: SIZES.some((s) => s.id === p.textSize) ? p.textSize : "default", contrast: !!p.contrast };
  remember(prefs);
  const root = document.documentElement;
  root.dataset.text = prefs.textSize;
  if (prefs.contrast) root.dataset.contrast = "high";
  else root.removeAttribute("data-contrast");
}

const css = `
html[data-text="small"] body { font-size: 13px; }
html[data-text="default"] body { font-size: 14px; }
html[data-text="large"] body { font-size: 18px; }
html[data-text="xlarge"] body { font-size: 20px; }
html[data-contrast="high"] {
  --text: #ffffff !important; --muted: #f3f4f6 !important; --dim: #e5e7eb !important;
  --bg: #000000 !important; --bg-2: #000000 !important; --panel: #000000 !important; --panel-solid: #000000 !important;
  --line: #ffffff !important; --line-2: #ffffff !important;
}
html[data-contrast="high"][data-theme="light"] {
  --text: #000000 !important; --muted: #111827 !important; --dim: #1f2937 !important;
  --bg: #ffffff !important; --bg-2: #ffffff !important; --panel: #ffffff !important; --panel-solid: #ffffff !important;
  --line: #000000 !important; --line-2: #000000 !important;
}
html[data-contrast="high"] .btn, html[data-contrast="high"] a { text-decoration: underline; }
html[data-contrast="high"] .btn { border-width: 2px; }
`;
const style = document.createElement("style");
style.id = "cc-a11y";
style.textContent = css;
document.head.appendChild(style);
apply(prefs);

async function save(patch) {
  const next = { ...prefs, ...patch };
  apply(next);
  try { const r = await api("/a11y", { method: "POST", body: { textSize: next.textSize, contrast: next.contrast } }); apply(r); }
  catch (e) { toast(e.message, true); }
}

function plainText(run) {
  return String(run?.deliverable || run?.verdict?.text || "").replace(/[#*_`>\[\]()]/g, " ").replace(/\s+/g, " ").trim();
}

function readAloud(run, btn) {
  const text = plainText(run);
  if (!text) { toast("There is no answer to read yet.", true); return; }
  if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") {
    toast("Read aloud is not available in this window.", true);
    return;
  }
  if (speaking) {
    window.speechSynthesis.cancel();
    speaking = false;
    if (btn) btn.textContent = "Read aloud";
    return;
  }
  const u = new SpeechSynthesisUtterance(text.slice(0, 8000));
  u.lang = "en-US";
  u.onend = () => { speaking = false; if (btn) btn.textContent = "Read aloud"; };
  speaking = true;
  if (btn) btn.textContent = "Stop reading";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function renderPanel(el) {
  el.innerHTML = `<div class="panel" id="a11y-panel"><h3>Reading</h3>
    <label class="lbl">Text size</label>
    <div class="seg" id="a11y-size">${SIZES.map((s) => `<button type="button" data-size="${s.id}" class="${prefs.textSize === s.id ? "on" : ""}">${esc(s.label)}</button>`).join("")}</div>
    <label class="row small" style="gap:8px;margin-top:10px"><input type="checkbox" id="a11y-contrast" ${prefs.contrast ? "checked" : ""}> High contrast</label>
    <div class="dim small" style="margin-top:8px">Text size and high contrast apply across the app. Read aloud is on an answer and speaks only when you click it.</div>
  </div>`;
  el.querySelector("#a11y-size").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    save({ textSize: b.dataset.size }).then(() => renderPanel(el));
  });
  el.querySelector("#a11y-contrast").addEventListener("change", (e) => {
    save({ contrast: e.target.checked }).then(() => renderPanel(el));
  });
}

window.CC.a11y = { apply, prefs: () => ({ ...prefs }), readAloud };

CC.register({
  id: "a11y",
  settings: { order: 6, render: renderPanel },
  deliverable: { order: 6, render(el, run) {
    const text = plainText(run);
    if (!text) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:8px;gap:8px"><button class="btn sm" type="button" id="a11y-read">Read aloud</button><span class="dim">Speaks this answer. Click again to stop.</span></div>`;
    const btn = el.querySelector("#a11y-read");
    btn.addEventListener("click", () => readAloud(run, btn));
  } },
  onState() {
    api("/a11y").then((r) => { if (r?.textSize) apply(r); }).catch(() => {});
  },
});
