// Get everything connected. Checklist only. Connect calls the existing key, OAuth,
// and MCP flows. This file never reads a key and never posts one.
const { S, api, toast, esc, render } = window.CC;

const css = `
.cs-wrap { max-width: 860px; margin: 0 auto; }
.cs-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.cs-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.cs-steps { margin: 6px 0 0; padding-left: 18px; }
.cs-steps li { margin: 2px 0; }
.cs-accounts { margin-top: 8px; display: grid; gap: 6px; }
.cs-acct { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
@media (max-width: 640px) {
  .cs-row { grid-template-columns: 1fr; }
  .cs-actions { justify-content: flex-start; }
}
`;
if (!document.getElementById("cc-connect-setup-style")) {
  const style = document.createElement("style");
  style.id = "cc-connect-setup-style";
  style.textContent = css;
  document.head.appendChild(style);
}

let data = null;
let busy = false;
let focusBound = false;

function expert() { return (window.CC.uiMode?.() || S.uiMode) === "expert"; }

function chip(status) {
  const tone = status === "Connected" ? "green" : status === "Handoff" ? "violet" : "";
  return `<span class="chip ${tone}">${esc(status)}</span>`;
}

async function load() {
  data = await api("/connectsetup");
  S.connectSetup = data;
  return data;
}

async function reload() {
  try { await load(); } catch { /* keep the list we have */ }
  if (S.connectWizard && S.view === "setup") render();
}

function focusSettings(sel, message, view) {
  S.connectWizard = false;
  S.view = view || "settings";
  S.navFocus = sel || "";
  render();
  if (message) toast(message);
}

async function runFlow(item, accountId) {
  const f = item.flow || {};
  if (f.expertOnly && !expert()) {
    toast("This connection is set up in Expert. Switch with the control in the top bar, then open Get everything connected from Help.");
    return;
  }
  if (f.type === "keysetup") {
    await window.CC.keysetup?.open?.(f.provider);
    return;
  }
  if (f.type === "mcp") {
    const r = await api("/connect/mcp", { method: "POST", body: { provider: f.provider } });
    if (r.oauthUrl) {
      localStorage.setItem("cc.mcp.oauth", r.serverId);
      window.open(r.oauthUrl, "_blank", "noopener");
      toast("Sign in, then come back to this page.");
    } else if (r.ok) toast("Connected");
    else toast(r.error || "Could not connect", true);
    await reload();
    return;
  }
  if (f.type === "open") {
    const r = await api("/setup/open", { method: "POST", body: { provider: f.provider } });
    toast(r.url ? `Opened ${r.url}` : "Opened");
    return;
  }
  // One-click Sign in with Google or Microsoft (0.4.17), when Everborn's sign-in app is set up.
  if (f.signin && !accountId && window.CC.appSignIn) { await window.CC.appSignIn.start(f.signin.provider, f.signin.step); return; }
  if (f.type === "browser-google") {
    if (!f.clientReady) return focusSettings(f.focus, "One-click Sign in with Google is coming soon. For now you can add your own Google sign-in app under Advanced. The secret stays in the vault.");
    const r = await api("/browser/google/start", { method: "POST", body: { origin: location.origin, gmail: !!f.want?.gmail, drive: !!f.want?.drive, send: false, calendar: !!f.want?.calendar, keep: !!f.keep, ...(accountId ? { accountId } : {}) } });
    window.open(r.url, "_blank", "noopener");
    toast("Sign in with Google. This page finishes the link when you come back.");
    return;
  }
  if (f.type === "mail") {
    if (!f.clientReady) return focusSettings("", f.provider === "outlook" ? "One-click Sign in with Microsoft is coming soon. For now you can add your own Microsoft sign-in app in Subscriptions. The secret stays in the vault." : "Add the sign-in client in Subscriptions, then connect. The secret stays in the vault.", f.focusView || "subscriptions");
    const r = await api("/services/mail/start", { method: "POST", body: { source: f.provider, origin: location.origin, ...(accountId ? { accountId } : {}) } });
    localStorage.setItem("cc.mail.oauth", f.provider);
    window.open(r.url, "_blank", "noopener");
    toast("Sign in and allow read-only mail. This page finishes the link when you come back.");
    return;
  }
  if (f.type === "publish") {
    if (!f.clientReady) return focusSettings(f.focus, "Add the sign-in client in Settings, Publishing, then connect. The secret stays in the vault.");
    const r = await api(`/publish/connect/${encodeURIComponent(f.connector)}/start`, { method: "POST", body: { origin: location.origin } });
    window.open(r.url, "_blank", "noopener");
    toast("Sign in. This page finishes the link when you come back. Nothing posts until you confirm.");
    return;
  }
  if (f.type === "library") {
    if (!f.clientReady) return focusSettings(f.focus, "Add the sign-in client in Settings, then connect. The secret stays in the vault.");
    const r = await api(`/libraries/${encodeURIComponent(f.source)}/start`, { method: "POST", body: { origin: location.origin } });
    window.open(r.url, "_blank", "noopener");
    toast("Sign in and allow read access. This page finishes the link when you come back.");
    return;
  }
  if (f.type === "settings") return focusSettings(f.focus, "");
  toast("Connect is not available for this row yet.", true);
}

function accountBlock(it) {
  if (!it.mail) return "";
  const accounts = it.accounts || [];
  return `<div class="cs-accounts">
    ${accounts.map((a) => `<div class="cs-acct"><span>${esc(a.label || "")}</span> ${chip(a.connected ? "Connected" : "Not connected")}${a.isDefault ? ` <span class="chip">Default</span>` : ""}</div>`).join("")}
    <div class="cs-acct">
      <input type="text" data-mail-label="${esc(it.id)}" placeholder="Label, e.g. Business" aria-label="Label for another account" maxlength="40" style="width:180px;padding:4px 6px">
      <button type="button" class="btn sm" data-add="${esc(it.id)}">Add another</button>
    </div>
  </div>`;
}

function renderInto(v) {
  const items = data?.items || [];
  const showDetail = expert();
  v.innerHTML = `<div class="cs-wrap">
    <div class="panel" style="padding:22px">
      <div class="route cs-row" id="cs-restart-box" style="margin-bottom:14px">
        <div>
          <b>Run the whole setup again</b>
          <div class="dim small" style="margin-top:4px">Start over: welcome screen, Find my AIs, then connections. Nothing you saved is changed without asking.</div>
        </div>
        <div class="cs-actions">
          <button type="button" class="btn sm" id="cs-restart-all">Run the whole setup again</button>
        </div>
      </div>
      <h2 style="margin:0 0 6px;font-size:22px">Get everything connected</h2>
      <div class="muted">Every integration Meldmind can use. Connect uses the same sign-in, key, or MCP step as Settings. Skip any row. You can finish later.</div>
      <div class="dim small" style="margin-top:6px">Claude, ChatGPT, Grok, and Gemini stay in the AI setup. This list does not ask for those keys again.</div>
      ${(items.some((it) => ["mcp", "browser-google", "mail", "publish", "library"].includes(it.flow?.type))) ? (window.CC.passwordTipHtml?.() || "") : ""}
      <div class="grid" style="margin-top:16px;gap:8px" id="cs-list">
        ${items.map((it) => `<div class="route cs-row" data-id="${esc(it.id)}">
          <div>
            <b>${esc(it.name)}</b> ${chip(it.status)}${it.skipped ? ` <span class="chip">Skipped</span>` : ""}
            <div class="dim small" style="margin-top:4px">${esc(it.blurb || "")}</div>
            ${(it.steps || []).length ? `<ol class="cs-steps">${it.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
            ${showDetail && it.detail ? `<div class="dim small cs-detail" style="margin-top:4px">${esc(it.detail)}</div>` : ""}
            ${accountBlock(it)}
          </div>
          <div class="cs-actions">
            <button type="button" class="btn sm ${it.status === "Connected" ? "" : "primary"}" data-connect="${esc(it.id)}" data-connected="${it.status === "Connected" ? "1" : "0"}" ${["mcp", "browser-google", "mail", "publish", "library"].includes(it.flow?.type) ? `data-pw-login="1"` : ""}>${it.status === "Connected" ? "Connected" : "Connect"}</button>
            <button type="button" class="btn sm" data-skip="${esc(it.id)}" ${it.skipped ? "disabled" : ""}>${it.skipped ? "Skipped" : "Skip"}</button>
          </div>
        </div>`).join("") || `<div class="empty">No integrations are listed.</div>`}
      </div>
      <div class="row" style="margin-top:18px;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn" id="cs-later">Finish later</button>
        <button type="button" class="btn primary" id="cs-done" style="margin-left:auto">Done</button>
      </div>
    </div>
  </div>`;
  if (!items.some((it) => it.status === "Connected") && window.CC.everydaySuggest?.mount) {
    const slot = document.createElement("div");
    slot.id = "ea-suggest-slot";
    v.querySelector(".cs-wrap")?.appendChild(slot);
    try { window.CC.everydaySuggest.mount(slot); } catch { /* the checklist still works */ }
  }
  v.querySelectorAll("[data-connect]").forEach((b) => b.addEventListener("click", async () => {
    const item = items.find((x) => x.id === b.dataset.connect);
    if (!item || busy) return;
    if (item.status === "Connected") {
      if (window.CC.openProviderSetup) window.CC.openProviderSetup(item.id);
      else { S.view = "settings"; S.settingsMore = true; S.focusProvider = item.id; render(); }
      return;
    }
    busy = true; b.disabled = true;
    try { await runFlow(item); }
    catch (e) { toast(e.message, true); }
    busy = false;
    if (S.connectWizard && S.view === "setup") render();
  }));
  v.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", async () => {
    const item = items.find((x) => x.id === b.dataset.add);
    const label = v.querySelector(`[data-mail-label="${b.dataset.add}"]`)?.value.trim();
    if (!item?.mail || busy) return;
    if (!label) return toast("Give this account a label.", true);
    busy = true; b.disabled = true;
    try {
      const created = await api("/mail-accounts", { method: "POST", body: { provider: item.mail.provider, label } });
      await runFlow(item, created.account?.id);
    } catch (e) { toast(e.message, true); }
    busy = false;
    if (S.connectWizard && S.view === "setup") { try { await reload(); } catch { render(); } }
  }));
  v.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", async () => {
    try { data = await api("/connectsetup/skip", { method: "POST", body: { id: b.dataset.skip } }); S.connectSetup = data; render(); }
    catch (e) { toast(e.message, true); }
  }));
  v.querySelector("#cs-restart-all")?.addEventListener("click", () => {
    if (window.CC.restartFullSetup) { window.CC.restartFullSetup(); return; }
    S.connectWizard = false;
    S.setup = { ...(S.setup || {}), step: 1, result: null, busy: false, phase: "welcome", fullFlow: true };
    S.firstRunDone = true;
    S.view = "setup";
    render();
  });
  v.querySelector("#cs-later").addEventListener("click", async () => {
    try { data = await api("/connectsetup/later", { method: "POST" }); S.connectSetup = data; } catch (e) { toast(e.message, true); return; }
    S.connectWizard = false; S.view = "command"; toast("Open Get everything connected from Help any time."); render();
  });
  v.querySelector("#cs-done").addEventListener("click", async () => {
    try { data = await api("/connectsetup/complete", { method: "POST" }); S.connectSetup = data; } catch (e) { toast(e.message, true); return; }
    S.connectWizard = false; S.view = "command"; toast("Setup complete. You are in Chat. Type below."); render();
  });
}

async function renderWizard(v) {
  if (!focusBound) {
    focusBound = true;
    window.addEventListener("focus", () => { if (S.connectWizard && S.view === "setup") reload(); });
  }
  if (!data) {
    v.innerHTML = `<div class="cs-wrap"><div class="panel">Loading integrations...</div></div>`;
    try { await load(); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  renderInto(v);
}

async function open() {
  try { data = await api("/connectsetup/reset", { method: "POST" }); }
  catch (e) { toast(e.message, true); return; }
  if (S.setup) { S.setup.fullFlow = false; S.setup.phase = ""; }
  S.connectSetup = data;
  S.connectWizard = true;
  S.visitedConnect = true;
  S.view = "setup";
  render();
}

window.CC.connectSetup = { open, render: renderWizard, load };

CC.register({
  id: "connect-setup",
  settings: { order: 6, render(el) {
    el.innerHTML = `<div class="panel"><h3>Get everything connected</h3>
      <div class="dim small">Gmail, Drive, Calendar, HighLevel, CapCut, Kling, and the other integrations. Connect uses the existing sign-in and key steps. Nothing here stores a key.</div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="cs-again">Open the checklist</button></div></div>`;
    el.querySelector("#cs-again").addEventListener("click", () => open());
  } },
});
