// Colour themes: dark / light / system and an accent colour. Prefs live on the server per user
// (/api/themes) and are mirrored in localStorage so the right theme paints before the first state
// arrives (no flash). Everything is applied through CSS variables plus one injected style block;
// styles.css itself is not edited.
const { S, api, toast, esc } = window.CC;

const LS = "cc.theme";
const DEFAULTS = { mode: "dark", accent: "#22d3ee" };
let prefs = read();
let presets = { cyan: "#22d3ee", violet: "#a78bfa", green: "#34d399", amber: "#fbbf24", rose: "#fb7185", blue: "#60a5fa", orange: "#fb923c", lime: "#a3e635" };
let synced = false;

function read() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return { ...DEFAULTS }; } }
function remember(p) { try { localStorage.setItem(LS, JSON.stringify({ mode: p.mode, accent: p.accent })); } catch {} }

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
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = theme === "dark" ? "#0b111b" : "#f3f5f9";
}

async function save(patch) {
  try { const r = await api("/themes", { method: "POST", body: patch }); presets = r.presets || presets; apply(r); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
async function sync() {
  try { const r = await api("/themes"); presets = r.presets || presets; apply({ mode: r.mode, accent: r.accent }); synced = true; } catch {}
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
`;
const style = document.createElement("style"); style.id = "cc-themes"; style.textContent = css; document.head.appendChild(style);

// Paint immediately from the local mirror, then follow the system setting when "system" is chosen.
apply(prefs);
window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => { if (prefs.mode === "system") apply(prefs); });

function renderPanel(el) {
  const swatches = Object.entries(presets).map(([n, c]) => `<button class="cc-swatch ${prefs.accent === c ? "on" : ""}" data-accent="${c}" title="${esc(n)}" style="background:${c}"></button>`).join("");
  el.innerHTML = `<div class="panel"><h3>Appearance <span class="right">${esc(resolved())} · ${esc(prefs.accent)}</span></h3>
    <label class="lbl">Theme</label>
    <div class="seg cc-theme-seg" id="cc-theme-mode">${["dark", "light", "system"].map((m) => `<button data-m="${m}" class="${prefs.mode === m ? "on" : ""}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div>
    <label class="lbl">Accent colour</label>
    <div class="row" style="gap:8px">${swatches}<input type="color" id="cc-theme-custom" value="${esc(prefs.accent)}" title="Custom colour" style="width:34px;height:28px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"><button class="ghost small" id="cc-theme-reset" style="margin-left:auto">reset</button></div>
    <div class="cc-theme-preview"><div class="box"><span class="dot green"></span> Panel text <span class="chip">chip</span></div><button class="btn primary sm">Primary</button><button class="btn sm">Button</button></div>
    <div class="dim small" style="margin-top:8px">Saved to your account${S.mode === "hosted" ? " in the hub" : " on this PC"}; every device you sign in on follows it.</div>
  </div>`;
  el.querySelector("#cc-theme-mode").addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return; await save({ mode: b.dataset.m }); renderPanel(el); });
  el.querySelectorAll("[data-accent]").forEach((b) => b.addEventListener("click", async () => { await save({ accent: b.dataset.accent }); renderPanel(el); }));
  el.querySelector("#cc-theme-custom").addEventListener("change", async (e) => { await save({ accent: e.target.value }); renderPanel(el); });
  el.querySelector("#cc-theme-reset").addEventListener("click", async () => { try { const r = await api("/themes", { method: "DELETE" }); apply(r); renderPanel(el); toast("Theme reset"); } catch (e) { toast(e.message, true); } });
}

window.CC.themes = { apply, prefs: () => ({ ...prefs }), set: save, resolved };

CC.register({
  id: "themes",
  settings: { order: 5, render: renderPanel },
  onState() { if (!synced) sync(); },
});
if (S.providers.length && !synced) sync();
