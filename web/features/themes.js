// Colour themes: dark / light / system, an accent, a background colour, built-in gradients and
// pictures, and a photo from a file on this computer. Prefs live on the server per user
// (/api/themes) and are mirrored in localStorage so the right theme paints before the first state
// arrives (no flash). Everything is applied through CSS variables plus one injected style block;
// styles.css itself is not edited. A web address is never used as a background.
const { S, api, toast, esc } = window.CC;

const LS = "cc.theme";
const DEFAULTS = { mode: "dark", accent: "#22d3ee", background: null, wallpaper: null, photo: null };
let prefs = read();
let presets = {
  cyan: "#22d3ee", violet: "#a78bfa", green: "#34d399", amber: "#fbbf24", rose: "#fb7185", blue: "#60a5fa", orange: "#fb923c", lime: "#a3e635",
  teal: "#2dd4bf", indigo: "#818cf8", gold: "#e8b86d", magenta: "#e879f9",
};
let backgrounds = {
  ink: "#090d14", midnight: "#0b1020", slate: "#1e293b", pine: "#10241c", paper: "#f4f1ea", sand: "#f6f1e7",
  charcoal: "#18181b", navy: "#0c1b33", wine: "#2a1218", fog: "#e7e5e4",
};
let gradients = ["aurora", "dusk", "tide", "ember", "frost"];
let images = ["horizon", "orbit", "lattice", "bloom"];
let looks = {
  harbor: { mode: "dark", accent: "teal", background: "navy", wallpaper: null },
  ember: { mode: "dark", accent: "gold", background: null, wallpaper: "gradient:ember" },
  paper: { mode: "light", accent: "blue", background: "paper", wallpaper: null },
  aurora: { mode: "dark", accent: "violet", background: null, wallpaper: "gradient:aurora" },
};
const LOOK_LABEL = { harbor: "Harbor", ember: "Ember", paper: "Paper", aurora: "Aurora" };
const GRADIENT_CSS = {
  aurora: "linear-gradient(155deg, #042f2e 0%, #115e59 32%, #312e81 68%, #0b1020 100%)",
  dusk: "linear-gradient(180deg, #1e1b4b 0%, #6d28d9 46%, #9d174d 82%, #111827 100%)",
  tide: "linear-gradient(135deg, #082f49 0%, #0e7490 48%, #134e4a 100%)",
  ember: "linear-gradient(150deg, #1c1917 0%, #9a3412 46%, #44403c 100%)",
  frost: "linear-gradient(165deg, #e0f2fe 0%, #e0e7ff 52%, #f8fafc 100%)",
};
const LIGHT_WALLS = new Set(["gradient:frost"]);
const SAFE_PHOTO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
let synced = false;

function read() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return { ...DEFAULTS }; } }
function remember(p) {
  try {
    localStorage.setItem(LS, JSON.stringify({
      mode: p.mode, accent: p.accent, background: p.background || null, wallpaper: p.wallpaper || null, photo: p.photo || null,
    }));
  } catch {}
}
const labelOf = (id) => LOOK_LABEL[id] || id.charAt(0).toUpperCase() + id.slice(1);

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
  paintScene(root);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = prefs.background || (theme === "dark" ? "#0b111b" : "#f3f5f9");
}

const BG_VARS = ["--bg", "--bg-2", "--text", "--muted", "--dim", "--panel", "--panel-solid", "--line", "--line-2"];
function paintBackground(root, color) {
  if (!color) {
    root.removeAttribute("data-bg");
    for (const v of BG_VARS) root.style.removeProperty(v);
    return;
  }
  root.dataset.bg = "custom";
  const light = luminance(color) > 0.55;
  root.style.setProperty("--bg", color);
  root.style.setProperty("--bg-2", mix(color, light ? "#ffffff" : "#000000", 0.35));
  root.style.setProperty("--text", light ? "#111827" : "#e5e7eb");
  root.style.setProperty("--muted", light ? "#566071" : "#8b95a7");
  root.style.setProperty("--dim", light ? "#7b8595" : "#5b667a");
  root.style.setProperty("--panel", light ? "#ffffffd9" : "#111827cc");
  root.style.setProperty("--panel-solid", light ? "#ffffff" : "#111827");
  root.style.setProperty("--line", light ? "#d9dfe8" : "#1f2937");
  root.style.setProperty("--line-2", light ? "#c3ccd9" : "#273449");
}

function svgUri(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}
const IMAGE_CSS = {
  horizon: svgUri(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset="0.55" stop-color="#6d28d9"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#sky)"/><circle cx="1180" cy="200" r="150" fill="#fde68a" opacity="0.35"/><circle cx="1180" cy="200" r="78" fill="#fde68a"/><path d="M0 560 C260 430 480 640 760 500 C1040 360 1280 560 1600 420 L1600 900 L0 900 Z" fill="#0e7490"/><path d="M0 700 C340 600 620 820 980 680 C1240 580 1420 760 1600 660 L1600 900 L0 900 Z" fill="#134e4a"/>`),
  orbit: svgUri(`<rect width="1600" height="900" fill="#0b1020"/><circle cx="500" cy="420" r="260" fill="none" stroke="#22d3ee" stroke-width="28" opacity="0.85"/><circle cx="1040" cy="380" r="320" fill="none" stroke="#a78bfa" stroke-width="22" opacity="0.75"/><circle cx="780" cy="470" r="110" fill="#1d4ed8"/>`),
  lattice: svgUri(`<rect width="1600" height="900" fill="#0f172a"/><g stroke="#38bdf8" stroke-width="3" opacity="0.45"><path d="M0 120H1600M0 300H1600M0 480H1600M0 660H1600M180 0V900M460 0V900M740 0V900M1020 0V900M1300 0V900"/></g><circle cx="460" cy="300" r="16" fill="#22d3ee"/><circle cx="1020" cy="480" r="16" fill="#c4b5fd"/>`),
  bloom: svgUri(`<rect width="1600" height="900" fill="#1e1030"/><circle cx="380" cy="420" r="340" fill="#7c3aed" opacity="0.9"/><circle cx="1120" cy="500" r="380" fill="#0e7490" opacity="0.85"/><circle cx="820" cy="220" r="220" fill="#db2777" opacity="0.7"/>`),
};

function wallNodes() {
  let wall = document.getElementById("cc-wall");
  if (!wall) {
    wall = document.createElement("div");
    wall.id = "cc-wall";
    wall.setAttribute("aria-hidden", "true");
    const veil = document.createElement("div");
    veil.id = "cc-wall-veil";
    veil.setAttribute("aria-hidden", "true");
    document.body.prepend(veil);
    document.body.prepend(wall);
  }
  return { wall, veil: document.getElementById("cc-wall-veil") };
}

function paintScene(root) {
  const wall = prefs.wallpaper || null;
  const kind = wall ? wall.split(":")[0] : "";
  if (kind === "gradient" || kind === "image" || kind === "photo") root.dataset.wall = kind;
  else root.removeAttribute("data-wall");
  if (LIGHT_WALLS.has(wall)) paintBackground(root, "#f4f7fb");
  else if (kind) paintBackground(root, null);
  else paintBackground(root, prefs.background);
  const { wall: node } = wallNodes();
  let image = "";
  if (kind === "gradient") image = GRADIENT_CSS[wall.slice("gradient:".length)] || "";
  else if (kind === "image") image = IMAGE_CSS[wall.slice("image:".length)] || "";
  else if (kind === "photo" && SAFE_PHOTO.test(prefs.photo || "")) image = `url("${prefs.photo}")`;
  node.style.backgroundImage = image;
}

function fileToPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Choose a photo from a file on this computer"));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("Pick a photo under 8 MB"));
    if (!/^image\/(png|jpeg|webp)$/.test(file.type || "")) return reject(new Error("Use a PNG, JPEG, or WebP file"));
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.width * scale));
      c.height = Math.max(1, Math.round(im.height * scale));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not a photo the browser can open")); };
    im.src = url;
  });
}

function absorb(r) {
  if (r?.presets) presets = r.presets;
  if (r?.backgrounds) backgrounds = r.backgrounds;
  if (Array.isArray(r?.gradients)) gradients = r.gradients;
  if (Array.isArray(r?.images)) images = r.images;
  if (r?.looks && typeof r.looks === "object") looks = r.looks;
  return {
    mode: r.mode, accent: r.accent, background: r.background || null, wallpaper: r.wallpaper || null, photo: r.photo || null,
  };
}

async function save(patch) {
  try { const r = await api("/themes", { method: "POST", body: patch }); apply(absorb(r)); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
async function sync() {
  try { const r = await api("/themes"); apply(absorb(r)); synced = true; } catch {}
}

// ---- the style block: accent wiring for both themes + a full light palette ----
const css = `
.btn.primary { background: linear-gradient(180deg, var(--accent), var(--accent-deep)); border-color: var(--accent); color: var(--accent-ink); }
.brand-mark { background: var(--accent); animation: ccbreathe 3s ease-in-out infinite; }
@keyframes ccbreathe { 0%,100% { box-shadow: 0 0 0 4px var(--accent-soft), 0 0 14px var(--accent-glow); } 50% { box-shadow: 0 0 0 6px var(--accent-soft), 0 0 26px var(--accent-glow); } }
input:focus, select:focus, textarea:focus { box-shadow: 0 0 0 3px var(--accent-soft); }
.hub-ring { stroke: var(--accent-soft); }
.sparks i { background: linear-gradient(180deg, var(--accent), var(--accent-deep)); }
.cc-spark-tip { color: var(--accent-2); }
.cursor::after { color: var(--accent); }
.update-bar { background: linear-gradient(90deg, var(--accent-soft), transparent 60%), var(--panel-solid); border-color: var(--accent-glow); }
.linkt:hover { border-color: var(--accent); }
.mobile-nav button.active { color: var(--accent-2); }
.cc-theme-seg button.on { background: var(--accent-soft); color: var(--text); }
.cc-swatch { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; display: inline-block; }
.cc-swatch.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--panel-solid) inset; }
.cc-swatch:hover { transform: scale(1.08); }
.cc-swatch.cc-wall-swatch { width: 52px; height: 32px; border-radius: 8px; background-size: cover; background-position: center; }
.cc-look.on, #cc-bg-clear.on, #cc-bg-photo.on, #cc-wall-clear.on { color: var(--text); box-shadow: inset 0 0 0 1px var(--accent); }
.cc-theme-preview { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.cc-theme-preview .box { flex: 1; border-radius: 10px; padding: 10px 12px; border: 1px solid var(--line); background: var(--panel); font-size: 12px; }
#cc-wall, #cc-wall-veil { position: fixed; inset: 0; pointer-events: none; display: none; }
#cc-wall { z-index: 0; background-position: center; background-size: cover; background-repeat: no-repeat; }
#cc-wall-veil { z-index: 0; }
html[data-wall] #cc-wall, html[data-wall] #cc-wall-veil { display: block; }
html[data-wall="image"] #cc-wall, html[data-wall="photo"] #cc-wall { inset: -20px; filter: blur(10px); transform: scale(1.04); }
html[data-wall="image"] #cc-wall-veil, html[data-wall="photo"] #cc-wall-veil { background: rgba(8, 12, 18, .5); }
html[data-theme="light"][data-wall="image"] #cc-wall-veil, html[data-theme="light"][data-wall="photo"] #cc-wall-veil { background: rgba(243, 245, 249, .68); }
html[data-wall="gradient"] #cc-wall-veil { background: rgba(8, 12, 18, .28); }
html[data-wall="gradient"][data-bg="custom"] #cc-wall-veil { background: rgba(255, 255, 255, .16); }
html[data-theme="light"][data-wall="gradient"] #cc-wall-veil { background: rgba(255, 255, 255, .2); }
html[data-wall] .app { position: relative; z-index: 1; }
html[data-wall] .topbar, html[data-wall] .feed, html[data-wall] .strip, html[data-wall] .mobile-nav,
html[data-wall] .panel, html[data-wall] .tile, html[data-wall] .ev, html[data-wall] .tabs, html[data-wall] .pill {
  background: color-mix(in srgb, var(--panel-solid) 62%, transparent);
  backdrop-filter: blur(6px);
}
html[data-wall] .graph-wrap { background: color-mix(in srgb, var(--panel-solid) 40%, transparent); }

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
html[data-wall] body, html[data-wall] .gate { background: transparent; }
`;
const style = document.createElement("style"); style.id = "cc-themes"; style.textContent = css; document.head.appendChild(style);

// Paint immediately from the local mirror, then follow the system setting when "system" is chosen.
apply(prefs);
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => { if (prefs.mode === "system") apply(prefs); });

function sameLook(look) {
  const accent = presets[look.accent];
  const background = look.background ? backgrounds[look.background] : null;
  return prefs.mode === look.mode && prefs.accent === accent && (prefs.background || null) === (background || null) && (prefs.wallpaper || null) === (look.wallpaper || null) && !prefs.photo;
}

function renderPanel(el) {
  const swatches = Object.entries(presets).map(([n, c]) => `<button class="cc-swatch ${prefs.accent === c ? "on" : ""}" data-accent="${c}" title="${esc(n)}" style="background:${c}"></button>`).join("");
  const colourOn = !prefs.wallpaper;
  const backs = Object.entries(backgrounds).map(([n, c]) => `<button class="cc-swatch ${colourOn && prefs.background === c ? "on" : ""}" data-bg="${c}" title="${esc(n)}" style="background:${c}"></button>`).join("");
  const lookBtns = Object.entries(looks).map(([id, look]) => `<button class="btn sm cc-look ${sameLook(look) ? "on" : ""}" data-look="${esc(id)}">${esc(labelOf(id))}</button>`).join("");
  const grads = gradients.map((id) => `<button class="cc-swatch cc-wall-swatch ${prefs.wallpaper === `gradient:${id}` ? "on" : ""}" data-gradient="${esc(id)}" title="${esc(labelOf(id))}" style="background:${GRADIENT_CSS[id] || "var(--bg-2)"}"></button>`).join("");
  const pics = images.map((id) => `<button class="cc-swatch cc-wall-swatch ${prefs.wallpaper === `image:${id}` ? "on" : ""}" data-image="${esc(id)}" title="${esc(labelOf(id))}" style="background-image:${IMAGE_CSS[id] || "none"};background-color:#10141c"></button>`).join("");
  const plain = !prefs.background && !prefs.wallpaper;
  el.innerHTML = `<div class="panel"><h3>Appearance <span class="right">${esc(resolved())} · ${esc(prefs.accent)}</span></h3>
    <label class="lbl">Theme</label>
    <div class="seg cc-theme-seg" id="cc-theme-mode">${["dark", "light", "system"].map((m) => `<button data-m="${m}" class="${prefs.mode === m ? "on" : ""}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div>
    <label class="lbl" style="margin-top:10px">Theme presets</label>
    <div class="row" style="gap:8px" id="cc-looks">${lookBtns}</div>
    <label class="lbl">Accent colour</label>
    <div class="row" style="gap:8px">${swatches}<input type="color" id="cc-theme-custom" value="${esc(prefs.accent)}" title="Custom colour" style="width:34px;height:28px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"></div>
    <label class="lbl" style="margin-top:10px">Background</label>
    <div class="row" style="gap:8px">${backs}<input type="color" id="cc-bg-custom" value="${esc(prefs.background || "#090d14")}" title="Custom background" style="width:34px;height:28px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"><button class="ghost small ${plain ? "on" : ""}" id="cc-bg-clear">Built-in</button><button class="ghost small" id="cc-theme-reset" style="margin-left:auto">reset</button></div>
    <label class="lbl" style="margin-top:10px">Gradient</label>
    <div class="row" style="gap:8px">${grads}</div>
    <label class="lbl" style="margin-top:10px">Pictures</label>
    <div class="row" style="gap:8px">${pics}<button class="btn sm ${prefs.wallpaper === "photo" ? "on" : ""}" id="cc-bg-photo">Your photo</button><button class="ghost small" id="cc-wall-clear">No picture</button></div>
    <input type="file" id="cc-bg-file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a photo from this computer" style="display:none">
    <div class="cc-theme-preview"><div class="box"><span class="dot green"></span> Panel text <span class="chip">chip</span></div><button class="btn primary sm">Primary</button><button class="btn sm">Button</button></div>
    <div class="dim small" style="margin-top:8px">Saved to your account${S.mode === "hosted" ? " in the hub" : " on this PC"}; every device you sign in on follows it. A picture or photo sits behind a dim, blurred layer so text stays readable. Your photo is chosen from a file on this computer. A web address is not accepted.</div>
  </div>`;
  const redraw = () => renderPanel(el);
  el.querySelector("#cc-theme-mode").addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return; await save({ mode: b.dataset.m }); redraw(); });
  el.querySelectorAll("[data-accent]").forEach((b) => b.addEventListener("click", async () => { await save({ accent: b.dataset.accent }); redraw(); }));
  el.querySelector("#cc-theme-custom").addEventListener("change", async (e) => { await save({ accent: e.target.value }); redraw(); });
  el.querySelectorAll("[data-bg]").forEach((b) => b.addEventListener("click", async () => { await save({ background: b.dataset.bg, wallpaper: "", photo: "" }); redraw(); }));
  el.querySelector("#cc-bg-custom").addEventListener("change", async (e) => { await save({ background: e.target.value, wallpaper: "", photo: "" }); redraw(); });
  el.querySelector("#cc-bg-clear").addEventListener("click", async () => { await save({ background: "", wallpaper: "", photo: "" }); redraw(); });
  el.querySelectorAll("[data-look]").forEach((b) => b.addEventListener("click", async () => {
    const look = looks[b.dataset.look]; if (!look) return;
    await save({ mode: look.mode, accent: look.accent, background: look.background || "", wallpaper: look.wallpaper || "", photo: "" });
    redraw();
  }));
  el.querySelectorAll("[data-gradient]").forEach((b) => b.addEventListener("click", async () => { await save({ wallpaper: `gradient:${b.dataset.gradient}`, photo: "" }); redraw(); }));
  el.querySelectorAll("[data-image]").forEach((b) => b.addEventListener("click", async () => { await save({ wallpaper: `image:${b.dataset.image}`, photo: "" }); redraw(); }));
  el.querySelector("#cc-bg-photo").addEventListener("click", () => el.querySelector("#cc-bg-file").click());
  el.querySelector("#cc-bg-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { const photo = await fileToPhoto(file); await save({ wallpaper: "photo", photo }); redraw(); }
    catch (err) { toast(err.message, true); }
  });
  el.querySelector("#cc-wall-clear").addEventListener("click", async () => { await save({ wallpaper: "", photo: "" }); redraw(); });
  el.querySelector("#cc-theme-reset").addEventListener("click", async () => { try { const r = await api("/themes", { method: "DELETE" }); apply(absorb(r)); redraw(); toast("Theme reset"); } catch (e) { toast(e.message, true); } });
}

window.CC.themes = { apply, prefs: () => ({ ...prefs }), set: save, resolved };

CC.register({
  id: "themes",
  settings: { order: 5, render: renderPanel },
  onState() { if (!synced) sync(); },
});
if (S.providers.length && !synced) sync();
