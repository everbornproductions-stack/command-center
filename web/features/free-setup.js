// 0.4.34 (Chris: "we have a let's set up free AIs in the setup screen when people sign on, correct? we need to make sure
// that every set up opens the appropriate window for them to do so and get them up and going"):
// "Save money with free AIs", on the first-run welcome screen (the reserved slot) and at the top of the Get free AIs card.
// Every row opens the right window for its kind:
//  - an app on this PC (Codex, Claude Code, OpenCode, Freebuff): Install runs npm with a fixed package name,
//    then Sign in opens the app's own sign-in window (server/helper-install.js)
//  - Antigravity: Get it opens Google's download page
//  - a free key (Gemini, Groq, OpenRouter): Get key opens the key page in the browser, and the paste box saves the key
//    straight to the vault (POST /keys); the key is never kept in the page
// "Set up all free AIs" installs every missing one, then opens each sign-in in turn and waits for it to finish.
const { api, toast, esc } = window.CC;

// Gemini CLI is not offered: on 2026-11-01 Google answered "This client is no longer supported for Gemini Code Assist for
// individuals ... migrate to Antigravity". Antigravity takes its place; Gemini models stay reachable with a free Gemini key.
export const APPS = ["antigravity", "codex", "claude-code", "opencode", "freebuff"];
export const KEYS = ["google", "groq", "openrouter"];
const CAN_INSTALL = new Set(["codex", "claude-code", "opencode", "freebuff"]);
const CAN_SIGNIN = new Set(["codex", "claude-code", "freebuff"]);
const PAGE = { antigravity: "https://antigravity.google/download" };
// Codex and Claude Code use a plan the person may already pay for; the others are free to everyone.
const PLAN_NOTE = { codex: "Uses your ChatGPT plan", "claude-code": "Uses your Claude plan" };
export const SIGNIN_WAIT_MS = 10 * 60 * 1000;

/** What the row's button does for this helper, or null when it is ready. Pure, so tests import it. */
export function appAction(w) {
  if (!w) return null;
  if (w.status === "retired") return null;
  if (w.status === "missing" && CAN_INSTALL.has(w.id)) return { kind: "install", label: "Install" };
  if (w.status === "missing" && (w.page || PAGE[w.id])) return { kind: "page", label: "Get it", url: w.page || PAGE[w.id] };
  if (w.status === "signin" && CAN_SIGNIN.has(w.id)) return { kind: "signin", label: "Sign in" };
  return null;
}
const chip = (w) => w?.status === "ready" ? `<span class="chip green">Ready</span>` : w?.status === "signin" ? `<span class="chip amber">Needs sign-in</span>` : w?.status === "resting" ? `<span class="chip amber">Resting</span>` : `<span class="chip">Not installed</span>`;

function openPage(url) {
  if (!url) return;
  if (window.ccDesktop?.openExternal) window.ccDesktop.openExternal(url);
  else { const w = window.open(url, "_blank", "noopener,noreferrer"); if (w) w.opener = null; }
}

function appRow(w) {
  if (w.status === "retired") {
    const next = w.replacedBy && w.page ? `<button type="button" class="btn sm" data-fs-page="${esc(w.page)}">Get ${esc(w.replacedBy)}</button>` : "";
    return `<div class="row cc-fs-row" data-fs-app="${esc(w.id)}" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px"><b style="min-width:120px">${esc(w.label)}</b><span class="chip">Retired</span><span class="dim small" style="flex:1">${esc(w.statusLabel || w.retiredNote || "")}</span>${next}</div>`;
  }
  const a = appAction(w);
  return `<div class="row cc-fs-row" data-fs-app="${esc(w.id)}" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
    <b style="min-width:120px">${esc(w.label)}</b>${chip(w)}<span class="dim small" style="flex:1;min-width:10rem">${esc(PLAN_NOTE[w.id] || w.good || "")}</span>
    ${a ? `<button type="button" class="btn sm primary" data-fs-act="${a.kind}" data-fs-id="${esc(w.id)}"${a.url ? ` data-url="${esc(a.url)}"` : ""} aria-label="${esc(a.label)} ${esc(w.label)}">${esc(a.label)}</button>` : ""}
  </div>`;
}
function keyRow(p) {
  if (p.catalogStatus === "retired") return `<div class="row cc-fs-row"><b style="min-width:120px">${esc(p.name)}</b><span class="chip">Retired</span><span class="dim small" style="flex:1">${esc(p.retiredNote || "")}</span>${p.replacedBy && p.replacementPage ? `<button type="button" class="btn sm" data-fs-page="${esc(p.replacementPage)}">Get ${esc(p.replacedBy)}</button>` : ""}</div>`;
  return `<div class="row cc-fs-row" data-fs-key="${esc(p.provider)}" style="gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
    <b style="min-width:120px">${esc(p.name)}</b>${p.connected ? `<span class="chip green">Connected</span>` : `<span class="chip">No key yet</span>`}<span class="dim small" style="flex:1;min-width:10rem">${esc(p.what || "")}</span>
    ${p.connected ? "" : `<button type="button" class="btn sm" data-fs-page="${esc(p.url)}">Get key</button>${p.connectable === false ? "" : `
    <input type="password" autocomplete="off" spellcheck="false" class="cc-fs-key" data-provider="${esc(p.provider)}" placeholder="Paste key" aria-label="Paste the ${esc(p.name)} key" style="width:12rem">
    <button type="button" class="btn sm primary" data-fs-save="${esc(p.provider)}">Save</button>`}`}
  </div>`;
}

/** Draw the step into `box`. Reloads itself after each action. */
export function mountFreeSetup(box, { title = "Save money with free AIs", keys: showKeys = true } = {}) {
  if (!box) return;
  let busy = false;
  const paint = async (refresh = false) => {
    let workers = [], pages = [];
    try { workers = (await api(`/workers${refresh ? "?refresh=1" : ""}`)).workers || []; } catch {}
    try { pages = (await api("/free-ais")).pages || []; } catch {}
    let catalog = { apps: [], keys: [] };
    try { catalog = await api("/free-catalog"); } catch {}
    const appIds = catalog.apps?.map((e) => e.id) || APPS;
    const apps = appIds.map((id) => { const w = workers.find((row) => row.id === id); const e = catalog.apps?.find((row) => row.id === id); return w ? { ...w, retiredNote: e?.retiredNote || w.retiredNote, replacedBy: e?.replacedBy || w.replacedBy, page: e?.page } : e?.page ? { id, label: e.label, good: e.good, status: e.status === "retired" ? "retired" : "missing", statusLabel: e.retiredNote, retiredNote: e.retiredNote, replacedBy: e.replacedBy, page: e.page, enabled: false } : null; }).filter(Boolean)
      // a retired helper (Gemini CLI) is not offered to someone setting up; Settings still shows it with its note
      .filter((w) => w.status !== "retired" && !(catalog.apps || []).some((e) => e.id === w.id && e.status === "retired"));
    const keys = (catalog.keys?.length ? catalog.keys : pages).map((e) => { const p = pages.find((row) => row.provider === (e.provider || e.id) || row.id === e.id); const replacement = [...(catalog.keys || []), ...(catalog.apps || [])].find((row) => row.id === e.replacedBy); return p ? { ...p, name: e.label || p.name, what: e.good || p.what, url: e.page || p.url, catalogStatus: e.status, retiredNote: e.retiredNote, replacedBy: e.replacedBy, replacementPage: replacement?.page, connectable: e.connectable } : { id: e.id, provider: e.provider || e.id, name: e.label, what: e.good, url: e.page, catalogStatus: e.status, retiredNote: e.retiredNote, replacedBy: e.replacedBy, replacementPage: replacement?.page, connectable: e.connectable }; }).filter((e) => e.url);
    const todo = apps.filter((w) => appAction(w) && appAction(w).kind !== "page").length;
    box.innerHTML = `<div class="welcome-block" id="cc-free-setup"><h3>${esc(title)}</h3>
      <div class="dim small">Free AIs do the work first, so a job keeps going when a paid AI runs out. Each button opens the right window: an install, the app's own sign-in, or the page for a free key.</div>
      <div class="lbl" style="margin-top:10px">Apps on this PC</div>
      ${apps.map(appRow).join("") || `<div class="dim small">Checking this PC...</div>`}
      ${showKeys ? `<div class="lbl" style="margin-top:12px">Free keys</div>${keys.map(keyRow).join("")}` : ""}
      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn primary" id="cc-fs-all" ${todo && !busy ? "" : "disabled"}>${todo ? `Set up all free AIs (${todo})` : "All apps are set up"}</button>
        <button type="button" class="btn sm" id="cc-fs-again">Check again</button>
        <span class="dim small" id="cc-fs-line" role="status" aria-live="polite"></span>
      </div></div>`;
    wire(apps);
  };
  const line = (t) => { const el = box.querySelector("#cc-fs-line"); if (el) el.textContent = t; };
  async function act(id, kind) {
    if (kind === "install") {
      line(`Installing ${id}... about a minute.`);
      const r = await api(`/workers/${encodeURIComponent(id)}/install`, { method: "POST" }).catch((e) => ({ ok: false, message: e.message }));
      if (r.page && !r.ok) openPage(r.page);
      toast(r.message, !r.ok);
      return r.ok;
    }
    const r = await api(`/workers/${encodeURIComponent(id)}/signin`, { method: "POST" }).catch((e) => ({ ok: false, message: e.message }));
    toast(r.message, !r.ok);
    return r.ok;
  }
  // after a sign-in window opens, look every 5 seconds until the helper is Ready (or 10 minutes pass)
  async function waitReady(id) {
    const t0 = Date.now();
    while (Date.now() - t0 < SIGNIN_WAIT_MS && box.isConnected) {
      await new Promise((r) => setTimeout(r, 5000));
      try { const w = ((await api("/workers?refresh=1")).workers || []).find((x) => x.id === id); if (w?.status === "ready") return true; } catch {}
    }
    return false;
  }
  function wire(apps) {
    box.querySelectorAll("[data-fs-act]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.fsAct === "page") { openPage(b.dataset.url); return; }
      b.disabled = true; b.textContent = b.dataset.fsAct === "install" ? "Installing..." : "Opening...";
      await act(b.dataset.fsId, b.dataset.fsAct);
      await paint(true);
    }));
    box.querySelectorAll("[data-fs-page]").forEach((b) => b.addEventListener("click", () => openPage(b.dataset.fsPage)));
    box.querySelectorAll("[data-fs-save]").forEach((b) => b.addEventListener("click", async () => {
      const input = box.querySelector(`.cc-fs-key[data-provider="${CSS.escape(b.dataset.fsSave)}"]`);
      const key = (input?.value || "").trim();
      if (!key) return toast("Paste the key first.", true);
      try { await api("/keys", { method: "POST", body: { provider: b.dataset.fsSave, key } }); if (input) input.value = ""; toast("Saved. It goes straight to your private vault."); await paint(true); }
      catch (e) { toast(e.message, true); }
    }));
    box.querySelector("#cc-fs-again")?.addEventListener("click", () => paint(true));
    box.querySelector("#cc-fs-all")?.addEventListener("click", async () => {
      if (busy) return; busy = true;
      try {
        for (const w of apps.filter((x) => appAction(x)?.kind === "install")) await act(w.id, "install");
        const fresh = ((await api("/workers?refresh=1")).workers || []).filter((w) => APPS.includes(w.id) && appAction(w)?.kind === "signin");
        for (const w of fresh) {
          line(`Sign in to ${w.label} in the window that opened. Meldmind waits here.`);
          if (await act(w.id, "signin")) line((await waitReady(w.id)) ? `${w.label} is ready.` : `${w.label} is not signed in yet. You can do it later.`);
        }
        line("Done. Free AIs go first from now on.");
      } finally { busy = false; await paint(true); }
    });
  }
  paint(false);
}

window.CC.freeSetup = { mount: mountFreeSetup };
window.CC.register({ id: "free-setup", welcome: { order: 5, render: (el) => { const box = document.createElement("div"); el.appendChild(box); mountFreeSetup(box); } } });
