// Colour themes: dark / light / system and an accent colour. Prefs live on the server per user
// (/api/themes) and are mirrored in localStorage so the right theme paints before the first state
// arrives (no flash). Everything is applied through CSS variables plus one injected style block;
// styles.css itself is not edited.
const { S, api, toast, esc } = window.CC;

const LS = "cc.theme";
const DEFAULTS = { mode: "dark", accent: "#22d3ee", background: null };
let prefs = read();
let presets = { cyan: "#22d3ee", violet: "#a78bfa", green: "#34d399", amber: "#fbbf24", rose: "#fb7185", blue: "#60a5fa", orange: "#fb923c", lime: "#a3e635" };
let backgrounds = { ink: "#090d14", midnight: "#0b1020", slate: "#1e293b", pine: "#10241c", paper: "#f4f1ea", sand: "#f6f1e7" };
let gradients = {
  dusk: { label: "Dusk", light: false, css: "linear-gradient(160deg, #1a1030 0%, #0b1020 45%, #12324a 100%)" },
  tide: { label: "Tide", light: false, css: "linear-gradient(165deg, #06202a 0%, #0e3b46 50%, #14532d 100%)" },
  ember: { label: "Ember", light: false, css: "linear-gradient(160deg, #2a120c 0%, #1c100e 40%, #3b1d12 100%)" },
  grove: { label: "Grove", light: true, css: "linear-gradient(165deg, #e7f0e4 0%, #d5e4dc 50%, #efe6d6 100%)" },
};
const svgUrl = (body) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  const data = encodeURIComponent(svg).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `url('data:image/svg+xml,${data}')`;
};
let images = {
  night: { label: "Night", light: false, css: svgUrl("<rect width='120' height='80' fill='#070b14'/><circle cx='92' cy='18' r='8' fill='#f4f1ea'/><circle cx='18' cy='22' r='1' fill='#e5e7eb'/><circle cx='40' cy='14' r='0.8' fill='#e5e7eb'/><circle cx='70' cy='28' r='0.9' fill='#e5e7eb'/>") },
  dunes: { label: "Dunes", light: false, css: svgUrl("<rect width='120' height='80' fill='#1c140e'/><path d='M0 50 Q30 30 60 48 T120 42 V80 H0 Z' fill='#3b2a1a'/><path d='M0 62 Q40 48 80 60 T120 56 V80 H0 Z' fill='#6b4f32'/>") },
  harbor: { label: "Harbor", light: false, css: svgUrl("<rect width='120' height='80' fill='#0b1c2c'/><rect y='46' width='120' height='34' fill='#134e6f'/><rect y='58' width='120' height='8' fill='#1d6a8a'/><rect x='18' y='36' width='16' height='18' fill='#0f172a'/><rect x='40' y='28' width='10' height='26' fill='#1e293b'/>") },
};
const PHOTO = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i;
const PHOTO_MAX = 400000;
let synced = false;

function read() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return { ...DEFAULTS }; } }
function remember(p) {
  try {
    const saved = { mode: p.mode, accent: p.accent, background: p.background || null };
    if (p.background === "photo" && p.photo) saved.photo = p.photo;
    localStorage.setItem(LS, JSON.stringify(saved));
  } catch {}
}

// ---- colour maths (no library) ----
function rgb(hex) { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function mix(a, b, t) { const A = rgb(a), B = rgb(b); return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function luminance(h) { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const alpha = (h, a) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

const systemDark = () => !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches;
export function resolved(p = prefs) { return p.mode === "system" ? (systemDark() ? "dark" : "light") : p.mode; }

export function apply(p = prefs) {
  prefs = { ...DEFAULTS, ...p };
  remember(prefs);
  const theme = resolved(prefs), root = document.documentElement, a = prefs.accent;
  root.dataset.theme = theme;
  root.style.setProperty("--accent", a);
  root.style.setProperty("--accent-2", theme === "dark" ? mix(a, "#ffffff", 0.3) : mix(a, "#000000", 0.25));
  root.style.setProperty("--accent-ink", luminance(a) > 0.45 ? "#06202a" : "#ffffff");
  root.style.setProperty("--accent-deep", mix(a, "#000000", 0.28));
  root.style.setProperty("--accent-soft", alpha(a, 0.14));
  root.style.setProperty("--accent-glow", alpha(a, 0.55));
  paintBackground(root, prefs.background, prefs.photo);
  const meta = document.querySelector('meta[name="theme-color"]');
  const look = backdrop(prefs.background, prefs.photo);
  if (meta) meta.content = look?.type === "color" ? look.color : look?.fallback || (theme === "dark" ? "#0b111b" : "#f3f5f9");
}

const BG_VARS = ["--bg", "--bg-2", "--text", "--muted", "--dim", "--panel", "--panel-solid", "--line", "--line-2"];
function paintSurface(root, light, bg) {
  root.style.setProperty("--bg", bg);
  root.style.setProperty("--bg-2", mix(bg, light ? "#ffffff" : "#000000", 0.35));
  root.style.setProperty("--text", light ? "#111827" : "#e5e7eb");
  root.style.setProperty("--muted", light ? "#566071" : "#8b95a7");
  root.style.setProperty("--dim", light ? "#7b8595" : "#5b667a");
  root.style.setProperty("--panel", light ? "#ffffffd9" : "#111827cc");
  root.style.setProperty("--panel-solid", light ? "#ffffff" : "#111827");
  root.style.setProperty("--line", light ? "#d9dfe8" : "#1f2937");
  root.style.setProperty("--line-2", light ? "#c3ccd9" : "#273449");
}
function isPhoto(value) {
  return typeof value === "string" && value.length <= PHOTO_MAX && PHOTO.test(value.replace(/\s+/g, ""));
}
function backdrop(value, photo) {
  if (!value) return null;
  if (String(value).startsWith("gradient:")) {
    const g = gradients[String(value).slice(9)];
    if (!g) return null;
    return { type: "gradient", light: !!g.light, css: g.css, fallback: g.light ? "#e7f0e4" : "#0b1020" };
  }
  if (String(value).startsWith("image:")) {
    const g = images[String(value).slice(6)];
    if (!g) return null;
    return { type: "image", light: false, css: g.css, fallback: "#070b14" };
  }
  if (value === "photo") {
    const data = typeof photo === "string" ? photo.replace(/\s+/g, "") : "";
    if (!isPhoto(data)) return null;
    return { type: "photo", light: false, css: `url("${data}")`, fallback: "#111827" };
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return { type: "color", color: value };
  return null;
}
function paintBackground(root, value, photo) {
  root.style.removeProperty("--bg-image");
  root.style.removeProperty("--bg-scrim");
  const look = backdrop(value, photo);
  if (!look) {
    root.removeAttribute("data-bg");
    for (const v of BG_VARS) root.style.removeProperty(v);
    return;
  }
  if (look.type === "color") {
    root.dataset.bg = "custom";
    paintSurface(root, luminance(look.color) > 0.55, look.color);
    return;
  }
  root.dataset.bg = look.type;
  paintSurface(root, look.light, look.fallback);
  root.style.setProperty("--bg-image", look.css);
  if (look.type !== "gradient") root.style.setProperty("--bg-scrim", "rgba(8,12,20,0.62)");
}

async function save(patch) {
  try { const r = await api("/themes", { method: "POST", body: patch }); presets = r.presets || presets; apply(r); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
async function sync() {
  try { const r = await api("/themes"); presets = r.presets || presets; backgrounds = r.backgrounds || backgrounds; if (r.gradients) gradients = r.gradients; if (r.images) images = r.images; apply({ mode: r.mode, accent: r.accent, background: r.background || null, photo: r.photo || null }); synced = true; } catch {}
}

// ---- the style block: accent wiring for both themes + a full light palette ----
const css = `
.btn.primary { background: linear-gradient(180deg, var(--accent), var(--accent-deep)); border-color: var(--accent); color: var(--accent-ink); }
.brand-mark { background: var(--accent); animation: ccbreathe 3s ease-in-out infinite; }
@keyframes ccbreathe { 0%,100% { box-shadow: 0 0 0 4px var(--accent-soft), 0 0 14px var(--accent-glow); } 50% { box-shadow: 0 0 0 6px var(--accent-soft), 0 0 26px var(--accent-glow); } }
input:focus, select:focus, textarea:focus { box-shadow: 0 0 0 3px var(--accent-soft); }
.hub-ring { stroke: var(--accent-soft); }
.sparks i { background: linear-gradient(180deg, var(--accent), var(--accent-deep)); }
.sparks i:hover::after { color: var(--accent-2); }
.cursor::after { color: var(--accent); }
.update-bar { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), var(--panel-solid); border-color: var(--accent-glow); }
.linkt:hover { border-color: var(--accent); }
.mobile-nav button.active { color: var(--accent-2); }
.cc-theme-seg button.on { background: var(--accent-soft); color: var(--text); }
.cc-swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; display: inline-block; }
.cc-swatch.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--panel-solid) inset; }
.cc-swatch:hover { transform: scale(1.08); }
.cc-theme-preview { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.cc-theme-preview .box { flex: 1; border-radius: 10px; padding: 10px 12px; border: 1px solid var(--line); background: var(--panel); font-size: 12px; }

html[data-theme="light"] {
  --bg: #f3f5f9; --bg-2: #ffffff; --panel: #ffffffd9; --panel-solid: #ffffff; --line: #d9dfe8; --line-2: #c3ccd9;
  --text: #111827; --muted: #566071; --dim: #7b8595; --green: #059669; --amber: #d97706; --red: #dc2626; --grey: #9ca3af; --violet: #7c3aed;
}
html[data-theme="light"] body { background: radial-gradient(1200px 600px at 20% -10%, var(--accent-soft) 0%, transparent 60%), radial-gradient(900px 500px at 100% 0%, #e9e4f7 0%, transparent 55%), var(--bg); }
html[data-theme="light"] ::-webkit-scrollbar-thumb { background: #c3ccd9; border-color: var(--bg); }
html[data-theme="light"] .topbar { background: linear-gradient(180deg, #ffffff, #f6f8fb); }
html[data-theme="light"] .brand-name { color: #334155; }
html[data-theme="light"] .tabs, html[data-theme="light"] .pill, html[data-theme="light"] .seg { background: #ffffff; }
html[data-theme="light"] .tabs button.active, html[data-theme="light"] .seg button.on { background: #e8edf5; color: var(--text); box-shadow: inset 0 0 0 1px #c9d3e2; }
html[data-theme="light"] .feed { background: #f7f9fc; }
html[data-theme="light"] .ev { background: #ffffff; border-color: #e3e8f0; }
html[data-theme="light"] .ev .txt { color: #334155; }
html[data-theme="light"] .strip { background: linear-gradient(180deg, #f7f9fc, #eef2f7); }
html[data-theme="light"] .tile, html[data-theme="light"] .kpi .k, html[data-theme="light"] .task, html[data-theme="light"] .ans, html[data-theme="light"] .route, html[data-theme="light"] .linkt, html[data-theme="light"] .toast, html[data-theme="light"] .gate-card input { background: #ffffff; }
html[data-theme="light"] .tile .meter, html[data-theme="light"] .task .bar { background: #e5e9f0; }
html[data-theme="light"] .btn { background: #e8edf5; border-color: #cbd5e1; color: var(--text); }
html[data-theme="light"] .btn:hover { background: #dde4ee; }
html[data-theme="light"] .btn.primary { color: var(--accent-ink); }
html[data-theme="light"] .btn.danger { background: #fde8e8; border-color: #f5b5b5; color: #b91c1c; }
html[data-theme="light"] input[type=text], html[data-theme="light"] input[type=number], html[data-theme="light"] input[type=password], html[data-theme="light"] input[type=date], html[data-theme="light"] input[type=email], html[data-theme="light"] select, html[data-theme="light"] textarea { background: #ffffff; }
html[data-theme="light"] .chip { background: #eef2f7; border-color: #d9dfe8; color: #334155; }
html[data-theme="light"] .chip.green { color: #047857; border-color: #a7e3cc; }
html[data-theme="light"] .chip.amber { color: #b45309; border-color: #f3d19c; }
html[data-theme="light"] .chip.red { color: #b91c1c; border-color: #f5b5b5; }
html[data-theme="light"] .chip.violet { color: #6d28d9; border-color: #d4c5f7; }
html[data-theme="light"] table.tbl td { border-bottom-color: #e8edf3; }
html[data-theme="light"] table.tbl tr:hover td { background: #f3f6fa; }
html[data-theme="light"] .graph-wrap { background: radial-gradient(600px 300px at 50% 50%, #ffffff 0%, #f1f4f9 70%); }
html[data-theme="light"] .node-label { fill: #1f2937; }
html[data-theme="light"] .node-sub { fill: #566071; }
html[data-theme="light"] .edge { stroke: #c9d3e2; }
html[data-theme="light"] .md code, html[data-theme="light"] .md pre { background: #f3f6fa; }
html[data-theme="light"] .linkt:hover { background: #f3f6fa; }
html[data-theme="light"] .skillgrid .cell { background: #f3f6fa !important; color: var(--text) !important; }
html[data-theme="light"] .skillgrid .cell[style*="#113b3a"] { background: #d7f5e9 !important; color: #047857 !important; }
html[data-theme="light"] .sig.ok { background: #d7f5e9; color: #047857; }
html[data-theme="light"] .sig.low, html[data-theme="light"] .sig.attention { background: #fde8e8; color: #b91c1c; }
html[data-theme="light"] .sig.renewing { background: #fdf1d6; color: #92400e; }
html[data-theme="light"] .mobile-nav { background: #ffffff; }
html[data-theme="light"] .mobile-nav button.active { background: #e8edf5; }
html[data-theme="light"] .gate { background: radial-gradient(1200px 600px at 20% -10%, var(--accent-soft) 0%, transparent 60%), var(--bg); }
html[data-theme="light"] .update-bar { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), #ffffff; }
html[data-bg="custom"] body, html[data-bg="custom"] .gate {
  background: radial-gradient(1200px 600px at 20% -10%, var(--accent-soft) 0%, transparent 55%), var(--bg);
}
html[data-bg="gradient"] body, html[data-bg="gradient"] .gate { background: var(--bg-image); }
html[data-bg="image"] body, html[data-bg="image"] .gate,
html[data-bg="photo"] body, html[data-bg="photo"] .gate {
  background-color: var(--bg);
  background-image: linear-gradient(var(--bg-scrim), var(--bg-scrim)), var(--bg-image);
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
}
`;
const style = document.createElement("style"); style.id = "cc-themes"; style.textContent = css; document.head.appendChild(style);

// Paint immediately from the local mirror, then follow the system setting when "system" is chosen.
apply(prefs);
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => { if (prefs.mode === "system") apply(prefs); });

function renderPanel(el) {
  const swatches = Object.entries(presets).map(([n, c]) => `<button class="cc-swatch ${prefs.accent === c ? "on" : ""}" data-accent="${c}" title="${esc(n)}" style="background:${c}"></button>`).join("");
  const backs = Object.entries(backgrounds).map(([n, c]) => `<button class="cc-swatch ${prefs.background === c ? "on" : ""}" data-bg="${c}" title="${esc(n)}" style="background:${c}"></button>`).join("");
  const grads = Object.entries(gradients).map(([id, g]) => `<button class="cc-swatch ${prefs.background === `gradient:${id}` ? "on" : ""}" data-bg="gradient:${esc(id)}" title="${esc(g.label || id)}" style="background:${g.css}"></button>`).join("");
  const pics = Object.entries(images).map(([id, g]) => `<button class="cc-swatch ${prefs.background === `image:${id}` ? "on" : ""}" data-bg="image:${esc(id)}" title="${esc(g.label || id)}" style="background:${g.css} center / cover no-repeat"></button>`).join("");
  const bgHex = /^#[0-9a-f]{6}$/i.test(prefs.background || "") ? prefs.background : "#090d14";
  el.innerHTML = `<div class="panel"><h3>Appearance <span class="right">${esc(resolved())} · ${esc(prefs.accent)}</span></h3>
    <label class="lbl">Theme</label>
    <div class="seg cc-theme-seg" id="cc-theme-mode">${["dark", "light", "system"].map((m) => `<button data-m="${m}" class="${prefs.mode === m ? "on" : ""}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div>
    <label class="lbl">Accent colour</label>
    <div class="row" style="gap:8px">${swatches}<input type="color" id="cc-theme-custom" value="${esc(prefs.accent)}" title="Custom colour" style="width:34px;height:28px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"></div>
    <label class="lbl" style="margin-top:10px">Background</label>
    <div class="row" style="gap:8px">${backs}<input type="color" id="cc-bg-custom" value="${esc(bgHex)}" title="Custom background" style="width:34px;height:28px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"><button class="ghost small" id="cc-bg-clear">Built-in</button><button class="ghost small" id="cc-theme-reset" style="margin-left:auto">reset</button></div>
    <label class="lbl" style="margin-top:10px">Gradient</label>
    <div class="row" style="gap:8px">${grads}</div>
    <label class="lbl" style="margin-top:10px">Built-in image</label>
    <div class="row" style="gap:8px">${pics}</div>
    <label class="lbl" style="margin-top:10px">Your photo</label>
    <div class="row" style="gap:8px;align-items:center"><label class="btn sm" for="cc-bg-photo">Choose a photo</label><input type="file" id="cc-bg-photo" accept="image/jpeg,image/png,image/webp" hidden><span class="dim small">${prefs.background === "photo" ? "Using your photo" : "JPEG, PNG, or WebP from this computer"}</span></div>
    <div class="cc-theme-preview"><div class="box"><span class="dot green"></span> Panel text <span class="chip">chip</span></div><button class="btn primary sm">Primary</button><button class="btn sm">Button</button></div>
    <div class="dim small" style="margin-top:8px">Saved to your account${S.mode === "hosted" ? " in the hub" : " on this PC"}; every device you sign in on follows it. A photo is a file from this computer. Web addresses are not used. Text stays readable.</div>
  </div>`;
  el.querySelector("#cc-theme-mode").addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return; await save({ mode: b.dataset.m }); renderPanel(el); });
  el.querySelectorAll("[data-accent]").forEach((b) => b.addEventListener("click", async () => { await save({ accent: b.dataset.accent }); renderPanel(el); }));
  el.querySelector("#cc-theme-custom").addEventListener("change", async (e) => { await save({ accent: e.target.value }); renderPanel(el); });
  el.querySelectorAll("[data-bg]").forEach((b) => b.addEventListener("click", async () => { await save({ background: b.dataset.bg }); renderPanel(el); }));
  el.querySelector("#cc-bg-custom").addEventListener("change", async (e) => { await save({ background: e.target.value }); renderPanel(el); });
  el.querySelector("#cc-bg-clear").addEventListener("click", async () => { await save({ background: "" }); renderPanel(el); });
  el.querySelector("#cc-bg-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.type && !/^image\/(jpeg|png|webp)$/.test(file.type)) { toast("Choose a JPEG, PNG, or WebP photo from this computer.", true); return; }
    if (file.size > 280 * 1024) { toast("That photo is too large. Choose one under 280 KB.", true); return; }
    try { const data = await readPhoto(file); await save({ background: "photo", photo: data }); renderPanel(el); }
    catch (err) { toast(err.message, true); }
  });
  el.querySelector("#cc-theme-reset").addEventListener("click", async () => { try { const r = await api("/themes", { method: "DELETE" }); apply(r); renderPanel(el); toast("Theme reset"); } catch (e) { toast(e.message, true); } });
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That photo could not be read."));
    reader.onload = () => {
      const data = String(reader.result || "").replace(/\s+/g, "");
      if (!isPhoto(data)) reject(new Error("Choose a JPEG, PNG, or WebP photo from this computer."));
      else resolve(data);
    };
    reader.readAsDataURL(file);
  });
}

window.CC.themes = { apply, prefs: () => ({ ...prefs }), set: save, resolved };

CC.register({
  id: "themes",
  settings: { order: 5, render: renderPanel },
  onState() { if (!synced) sync(); },
});
if (S.providers.length && !synced) sync();
