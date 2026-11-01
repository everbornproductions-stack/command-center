// 0.4.29: "Your AI helpers", a panel in Settings (Expert). The server side is server/worker-pool.js and
// server/plugins/workers.js. Each helper has a light (green ready, amber resting or needs sign-in, grey off or not
// installed), a switch, and what it is good for. 0.4.33: a missing helper has Install (or Get it, for one that is not on
// npm) and a signed-out one has Sign in, which opens the helper's own sign-in window. Nothing runs without a click.
const { api, toast, esc } = window.CC;

const KIND_WORD = { cli: "App on this PC", agent: "Helper", api: "API" };
// 0.4.33: which helpers Meldmind can install with npm, sign in, or send to a download page (server/helper-install.js)
const CAN_INSTALL = new Set(["codex", "gemini-cli", "claude-code", "opencode", "freebuff"]);
const CAN_SIGNIN = new Set(["codex", "gemini-cli", "claude-code", "freebuff"]);
const GET_PAGE = { antigravity: "https://antigravity.google/download" };
export function helperAction(w) {
  if (w.status === "missing" && CAN_INSTALL.has(w.id)) return { kind: "install", label: "Install" };
  if (w.status === "missing" && GET_PAGE[w.id]) return { kind: "page", label: "Get it", url: GET_PAGE[w.id] };
  if (w.status === "signin" && CAN_SIGNIN.has(w.id)) return { kind: "signin", label: "Sign in" };
  return null;
}
const STYLE_ID = "cc-helpers-style";

function addStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  // Scoped to the panel's own root (LESSONS 2026-10-30: part rules never leak onto other boxes).
  st.textContent = `
#cc-helpers .cc-h-list{display:grid;gap:8px;margin-top:10px}
#cc-helpers .cc-h-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line,rgba(127,127,127,.3));border-radius:10px}
#cc-helpers .cc-h-name{font-weight:600}
#cc-helpers .cc-h-good,#cc-helpers .cc-h-need{font-size:12px;opacity:.85;overflow-wrap:anywhere}
#cc-helpers .cc-h-state{font-size:12px}
#cc-helpers .cc-h-switch{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}
#cc-helpers .cc-h-switch input{width:auto;margin:0}
@media (max-width:520px){#cc-helpers .cc-h-row{grid-template-columns:auto minmax(0,1fr)}#cc-helpers .cc-h-switch{grid-column:2}}`;
  document.head.appendChild(st);
}

// "3:40 PM" in this person's own clock.
function clock(ms) {
  try { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; }
}
export function stateLine(w) {
  if (w.status === "resting" && w.restingUntil) return `Resting, back at ${clock(w.restingUntil) || w.backLabel}`;
  return w.statusLabel || "";
}

function rowHtml(w) {
  const light = w.light || "grey";
  const tags = [KIND_WORD[w.kind] || "", w.free ? "Free" : ""].filter(Boolean).join(" · ");
  return `<div class="cc-h-row" data-helper="${esc(w.id)}" data-status="${esc(w.status)}">
    <span class="dot ${esc(light)}" aria-hidden="true"></span>
    <div style="min-width:0">
      <div><span class="cc-h-name">${esc(w.label)}</span> <span class="dim small">${esc(tags)}</span></div>
      <div class="cc-h-state" data-helper-state>${esc(stateLine(w))}</div>
      ${w.good ? `<div class="cc-h-good dim">Good for: ${esc(w.good)}</div>` : ""}
      ${w.needs ? `<div class="cc-h-need dim">${esc(w.needs)}</div>` : ""}
      ${(() => { const a = helperAction(w); return a ? `<div style="margin-top:6px"><button type="button" class="btn sm primary" data-helper-act="${esc(a.kind)}" data-helper-id="${esc(w.id)}"${a.url ? ` data-url="${esc(a.url)}"` : ""} aria-label="${esc(a.label)} ${esc(w.label)}">${esc(a.label)}</button></div>` : ""; })()}
    </div>
    <label class="cc-h-switch"><input type="checkbox" role="switch" data-helper-switch="${esc(w.id)}" ${w.enabled ? "checked" : ""} aria-label="Use ${esc(w.label)}"> ${w.enabled ? "On" : "Off"}</label>
  </div>`;
}

export function renderHelpers(box) {
  addStyle();
  box.innerHTML = `<div class="panel" id="cc-helpers"><h3>Your AI helpers <span class="right" id="cc-h-count"></span></h3>
    <div class="dim small" id="cc-h-line">Meldmind hands each step to the best helper that is free right now.</div>
    <div class="cc-h-list" id="cc-h-list"><div class="dim small">Checking your helpers...</div></div>
    <div class="row" style="gap:8px;margin-top:10px"><button type="button" class="btn sm" id="cc-h-refresh">Check again</button></div>
  </div>`;
  const $ = (sel) => box.querySelector(sel);
  let timer = null;
  function show(v) {
    const list = v?.workers || [];
    $("#cc-h-line").textContent = v?.line || "";
    const ready = list.filter((w) => w.status === "ready").length;
    $("#cc-h-count").textContent = `${ready} ready of ${list.length}`;
    $("#cc-h-list").innerHTML = list.map(rowHtml).join("") || `<div class="dim small">No helpers found yet.</div>`;
    box.querySelectorAll("[data-helper-act]").forEach((b) => b.addEventListener("click", async () => {
      const wid = b.dataset.helperId, kind = b.dataset.helperAct;
      if (kind === "page") { const u = b.dataset.url; if (window.ccDesktop?.openExternal) window.ccDesktop.openExternal(u); else window.open(u, "_blank", "noopener"); return; }
      const label = b.textContent;
      b.disabled = true; b.textContent = kind === "install" ? "Installing... (about a minute)" : "Opening...";
      try {
        const r = await api(`/workers/${encodeURIComponent(wid)}/${kind === "install" ? "install" : "signin"}`, { method: "POST" });
        if (r.page && !r.ok) { toast(r.message); if (window.ccDesktop?.openExternal) window.ccDesktop.openExternal(r.page); else window.open(r.page, "_blank", "noopener"); }
        else toast(r.message, !r.ok);
        if (r.view) show(r.view);
      } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = label; }
    }));
    box.querySelectorAll("[data-helper-switch]").forEach((sw) => sw.addEventListener("change", async () => {
      const wid = sw.dataset.helperSwitch;
      sw.disabled = true;
      try { show(await api(`/workers/${encodeURIComponent(wid)}`, { method: "POST", body: { enabled: sw.checked } })); }
      catch (e) { toast(e.message, true); sw.checked = !sw.checked; sw.disabled = false; }
    }));
  }
  async function load(refresh = false) {
    clearTimeout(timer);
    if (!box.isConnected) return;
    try { show(await api(`/workers${refresh ? "?refresh=1" : ""}`)); }
    catch (e) { $("#cc-h-list").innerHTML = `<div class="dim small">${esc(e.message)}</div>`; }
    // A resting helper comes back on its own: look again in a minute while the panel is open.
    timer = setTimeout(() => load(false), 60000);
  }
  $("#cc-h-refresh").addEventListener("click", () => load(true));
  load(false);
}

window.CC.register({ id: "workers", settings: { order: 3, slot: "#settings-helpers", render: renderHelpers } });
