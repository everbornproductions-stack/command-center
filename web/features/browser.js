// Built-in browser helper (Phase 27).
// Command: "Browser helper: when needed / Always / Never" for councils and missions, "Send to Browser helper"
//   (a click), and each open job with its live action log, the OK / No question and Stop.
// Everywhere: a floating box whenever the helper waits for your OK, showing exactly what will happen.
// Deliverable: this run's helper jobs, their action logs and results.
// Settings > Integrations > Browser helper: on / automatic, limits, the model, and Google (Gmail and Drive,
//   read-only by default; sending only when ticked, and every email still asks first).
const { S, api, toast, esc, md, ago } = window.CC;

const css = `
.cc-bh-job { border: 1px solid var(--line); border-left: 3px solid #38bdf8; border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
.cc-bh-log { margin-top: 6px; max-height: 150px; overflow: auto; font: 11px/1.35 var(--mono); }
.cc-bh-log div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-bh-log .refused, .cc-bh-log .error, .cc-bh-log .no { color: var(--red); }
.cc-bh-log .ok, .cc-bh-log .done { color: var(--green); }
.cc-bh-log .ask { color: var(--amber); }
.cc-bh-ask { border: 1px solid var(--amber); border-radius: 8px; padding: 8px 10px; margin-top: 6px; }
.cc-bh-ask pre { margin: 4px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; font: 12px/1.35 var(--mono); }
#cc-bh-float { position: fixed; right: 16px; bottom: 16px; width: min(460px, calc(100vw - 32px)); z-index: 60; background: var(--bg2, #0f1520); box-shadow: 0 10px 30px rgba(0,0,0,.45); border-radius: 12px; }
#prov-browser-helper input[type=number] { width: 80px; }
`;
const style = document.createElement("style"); style.id = "cc-browser-style"; style.textContent = css; document.head.appendChild(style);

const LABEL = { queued: "queued", working: "working", needs_approval: "needs your OK", done: "done", failed: "failed" };
const CHIP = { queued: "", working: "violet", needs_approval: "amber", done: "green", failed: "red" };
const OPEN = (j) => !["done", "failed"].includes(j.status);
let data = null;
async function load() { data = await api("/browser"); return data; }
const light = (st) => `<span class="light ${esc(st || "grey")}" style="display:inline-block;width:8px;height:8px;border-radius:50%"></span>`;
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function askHtml(j) {
  const a = j.approval;
  if (!a) return "";
  return `<div class="cc-bh-ask" data-ask="${esc(a.id)}">
    <b>${a.kind === "your turn" ? "Your turn:" : "OK to do this?"}</b> ${esc(a.title)}
    <pre>${esc((a.lines || []).join("\n"))}</pre>
    <div class="row" style="gap:8px;margin-top:6px"><button class="btn sm primary" data-ok>OK, do it</button><button class="btn sm" data-no>No</button><span class="dim small" style="margin-left:auto">Nothing happens until you click.</span></div>
  </div>`;
}
function jobHtml(j, { full = false } = {}) {
  const log = (j.log || []).slice(full ? -60 : -8).reverse().map((l) => `<div class="${esc(l.kind)}" title="${esc(l.text)}">${time(l.ts)}  ${esc(l.text)}</div>`).join("");
  const arts = (j.artifacts || []).map((a) => a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)).join(" · ");
  return `<div class="cc-bh-job" data-bh-job="${esc(j.id)}">
    <div class="row small" style="gap:6px">${light(j.status === "done" ? "green" : j.status === "failed" ? "red" : j.status === "needs_approval" ? "amber" : "grey")}<b>Browser helper</b><span class="chip ${CHIP[j.status] || ""}">${esc(LABEL[j.status] || j.status)}</span>${j.accountLabel ? `<span class="chip" title="Google account for this task">${esc(j.accountLabel)}</span>` : ""}${j.driver === "reader" ? `<span class="chip" title="No desktop window: pages are read as text, without JavaScript">text reader</span>` : ""}${j.late ? `<span class="chip">arrived later</span>` : ""}
      <span class="dim" style="margin-left:auto">${j.steps || 0} steps · $${Number(j.cost || 0).toFixed(4)}${j.model ? ` · ${esc(j.model.name || j.model.model)}` : ""}</span>${OPEN(j) ? `<button class="ghost small" data-stop>Stop</button>` : ""}</div>
    <div class="small dim" style="margin-top:4px">${esc(j.task.slice(0, 240))}</div>
    ${askHtml(j)}
    ${j.text ? `<div class="md small" style="margin-top:6px">${md(j.text)}</div>` : ""}
    ${arts ? `<div class="small" style="margin-top:4px">${arts}</div>` : ""}
    ${j.error && j.status === "failed" ? `<div class="small" style="color:var(--red);margin-top:4px">${esc(j.error)}</div>` : ""}
    ${log ? `<details ${OPEN(j) || full ? "open" : ""} style="margin-top:4px"><summary class="small muted" style="cursor:pointer">Action log</summary><div class="cc-bh-log">${log}</div></details>` : ""}
  </div>`;
}
function wire(el, again) {
  el.querySelectorAll("[data-bh-job]").forEach((box) => {
    const id = box.dataset.bhJob;
    const ask = box.querySelector("[data-ask]");
    const answer = async (ok) => {
      box.querySelectorAll("[data-ok],[data-no]").forEach((b) => (b.disabled = true));
      try { await api(`/browser/jobs/${encodeURIComponent(id)}/${ok ? "approve" : "deny"}`, { method: "POST", body: { approval: ask.dataset.ask } }); } catch (e) { toast(e.message, true); }
      again();
    };
    ask?.querySelector("[data-ok]").addEventListener("click", () => answer(true));
    ask?.querySelector("[data-no]").addEventListener("click", () => answer(false));
    box.querySelector("[data-stop]")?.addEventListener("click", async () => { try { await api(`/browser/jobs/${encodeURIComponent(id)}/stop`, { method: "POST" }); toast("Browser helper stopped"); } catch (e) { toast(e.message, true); } again(); });
  });
}

// ---------- the floating OK box, on every view ----------
function renderFloat() {
  let box = document.getElementById("cc-bh-float");
  const j = (data?.jobs || []).find((x) => x.status === "needs_approval" && x.approval);
  if (!j || (S.view === "command" && document.querySelector('#cmd-extras [data-feature="browser"] [data-ask]'))) { box?.remove(); return; }
  if (!box) { box = document.createElement("div"); box.id = "cc-bh-float"; document.body.appendChild(box); }
  if (box.dataset.ask === j.approval.id) return;
  box.dataset.ask = j.approval.id;
  box.innerHTML = jobHtml(j);
  wire(box, () => refresh());
}

// ---------- Command ----------
function renderCommand(el) {
  const card = S.providers.find((p) => p.id === "browser-helper");
  if (!card) { el.innerHTML = ""; return; }
  const ready = !!card.agent?.ready;
  const ch = S.browserChoice === true ? "always" : S.browserChoice === false ? "never" : "auto";
  const open = (data?.jobs || []).filter(OPEN);
  const accounts = data?.config?.google?.accounts || [];
  const picker = accounts.length ? `<label class="row small" style="gap:6px">Account <select id="bh-account" title="Which Google account this task uses">${accounts.map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? "selected" : ""}>${esc(a.label)}${a.isDefault ? " (default)" : ""}${a.connected ? "" : " (not connected)"}</option>`).join("")}</select></label>` : "";
  el.innerHTML = `<div style="margin-top:8px">
    <div class="row small" style="gap:8px;flex-wrap:wrap"><span class="muted">Browser helper</span>
      <span class="seg" id="bh-choice" title="Councils and missions: hand the browser helper the parts that need a website, Gmail or Drive (when Grok Bot is not set up)">${["auto", "always", "never"].map((c) => `<button data-c="${c}" class="${ch === c ? "on" : ""}">${c === "auto" ? "when needed" : c === "always" ? "Always" : "Never"}</button>`).join("")}</span>
      ${picker}
      <button class="ghost small" id="bh-settings">settings</button>
      <button class="btn sm" id="bh-send" ${ready ? "" : "disabled"} title="${ready ? "The helper browses for the orders above in its own window; it asks before sending, posting, deleting, buying or submitting a form" : esc(card.status?.detail || "")}" style="margin-left:auto">Send to Browser helper</button></div>
    ${open.map((j) => jobHtml(j)).join("")}</div>`;
  el.querySelector("#bh-choice").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.browserChoice = b.dataset.c === "always" ? true : b.dataset.c === "never" ? false : undefined; renderCommand(el); });
  el.querySelector("#bh-settings").addEventListener("click", () => { S.focusProvider = "browser-helper"; CC.go("settings"); });
  el.querySelector("#bh-send").addEventListener("click", async (e) => {
    const task = (document.querySelector("#orders")?.value || "").trim();
    if (!task) return toast("Type the orders first", true);
    e.target.disabled = true;
    try {
      let context = "";
      const projectId = document.querySelector("#proj")?.value || null;
      if (projectId) { try { context = (await api(`/memory/context?projectId=${encodeURIComponent(projectId)}`)).context || ""; } catch {} }
      const accountId = el.querySelector("#bh-account")?.value || "";
      await api("/browser/jobs", { method: "POST", body: { task, context, projectId, ...(accountId ? { accountId } : {}) } });
      toast("The browser helper is on it. It asks before anything is sent, posted, deleted, bought or submitted.");
      await refresh();
    } catch (err) { toast(err.message, true); }
    finally { e.target.disabled = false; }
  });
  wire(el, () => refresh());
}

// ---------- Deliverable: this run's helper jobs ----------
async function renderDeliverable(el) {
  const runId = S.live?.id;
  if (!runId) { el.innerHTML = ""; return; }
  const has = (S.live.council?.agents || []).some((a) => a.id === "browser-helper") || Object.values(S.live.tasks || {}).some((t) => t.provider === "browser-helper");
  if (!has) { el.innerHTML = ""; return; }
  let jobs = [];
  try { jobs = await api(`/browser/jobs?run=${encodeURIComponent(runId)}`); } catch { el.innerHTML = ""; return; }
  if (S.live?.id !== runId) return;
  el.innerHTML = jobs.length ? `<div class="cat-h" style="margin-top:12px">Browser helper on this ${esc(S.live.kind || "run")}</div>${jobs.map((j) => jobHtml(j, { full: true })).join("")}` : "";
  wire(el, () => renderDeliverable(el));
}

// ---------- Settings > Integrations > Browser helper ----------
async function renderSettings(el) {
  if (!el.querySelector("#prov-browser-helper")) el.innerHTML = `<div class="panel" id="prov-browser-helper"><h3>Integrations: Browser helper</h3><div class="dim small">Loading...</div></div>`;
  try { await load(); } catch (e) { el.innerHTML = `<div class="panel" id="prov-browser-helper"><h3>Integrations: Browser helper</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const c = data.config, card = data.card, g = c.google;
  const models = [];
  for (const p of S.providers) if (p.kind === "text" && p.keyed) for (const mm of p.models || []) models.push({ id: `${p.id}/${mm.id}`, name: `${p.name}: ${mm.name}` });
  el.innerHTML = `<div class="panel" id="prov-browser-helper"><h3>Integrations: Browser helper <span class="right">${light(card.status.status)} ${esc(card.status.detail)}</span></h3>
    <div class="small muted">For when you do not have Grok Bot: an AI drives ${esc(c.driverLabel)}, one step at a time, with an action log and a Stop button. It reads pages and, with your Google sign-in, Gmail and Drive. It asks for your OK before it sends, posts, deletes, buys or submits any form, and shows exactly what will happen. It never types passwords (you sign in yourself in its window), never fills in card details, and never handles Square or billing pages. Every AI call is in the ledger and inside your spend caps.</div>
    <div class="row small" style="gap:14px;flex-wrap:wrap;margin-top:10px">
      <label class="row" style="gap:6px"><input type="checkbox" id="bh-on" ${c.on ? "checked" : ""}> On</label>
      <label class="row" style="gap:6px" title="Only when Grok Bot is not set up"><input type="checkbox" id="bh-auto" ${c.auto ? "checked" : ""}> Councils and missions hand it the parts that need a website, Gmail or Drive</label>
      ${c.desktop ? `<label class="row" style="gap:6px"><input type="checkbox" id="bh-window" ${c.showWindow ? "checked" : ""}> Use its own window (off: the text reader)</label>` : ""}
    </div>
    <div class="row small" style="gap:14px;flex-wrap:wrap;margin-top:8px">
      <label class="row" style="gap:6px">Steps per job <input type="number" id="bh-steps" min="1" max="40" value="${c.maxSteps}"></label>
      <label class="row" style="gap:6px">Spend per job $ <input type="number" id="bh-cost" min="0.01" max="5" step="0.01" value="${c.maxCostUsd}"></label>
      <label class="row" style="gap:6px">Wait for your OK <input type="number" id="bh-okwait" min="1" max="120" value="${c.approvalWaitMin}"> min</label>
      <label class="row" style="gap:6px">Council waits <input type="number" id="bh-cwait" min="0" max="900" value="${c.councilWaitSec}"> s</label>
      <label class="row" style="gap:6px">Mission waits <input type="number" id="bh-mwait" min="0" max="240" value="${c.missionWaitMin}"> min</label>
    </div>
    <div class="row small" style="gap:8px;margin-top:8px"><span>Driven by</span><select id="bh-model"><option value="">the cheapest capable AI${c.modelNow && !c.modelNow.picked ? ` (now ${esc(c.modelNow.name)})` : ""}</option>${models.map((x) => `<option value="${esc(x.id)}" ${c.model === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn sm primary" id="bh-save">Save</button><button class="btn sm" id="bh-demo" ${c.ready ? "" : "disabled"} title="A pretend bakery page that ships with the app: watch it read the page, fill in the contact form and ask for your OK">Try it on the demo page</button></div>

    <div class="cat-h" style="margin-top:14px">Google: Gmail, Drive, and Calendar ${g.connected ? `<span class="chip green">connected</span>` : g.needsSignIn ? `<span class="chip amber">sign in again</span>` : ""}</div>
    <div class="dim small">Uses your own Google sign-in and the least access that works: read Gmail and read Drive, unless you tick sending or Calendar. Even then every email waits for your OK, and a calendar change waits for a click. Grok Bot can still take calendar work. ${esc(g.setup)} <a href="${esc(g.consoleUrl)}" target="_blank" rel="noopener">Open the Google Cloud console</a>. The client secret and tokens stay in the vault and are never shown again.</div>
    ${g.connected ? `<div class="small" style="margin-top:4px">Allowed: ${g.scopes.map((x) => esc(x.label)).join(", ")}${g.connectedAt ? ` · since ${ago(g.connectedAt)} ago` : ""}</div>` : ""}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      <div><label class="lbl">OAuth client ID</label><input type="text" id="bh-cid" value="${esc(g.clientId || "")}" placeholder="${g.clientIdFromEnv ? "set by CC_GOOGLE_CLIENT_ID" : "1234...apps.googleusercontent.com"}" style="font-family:var(--mono)"></div>
      <div><label class="lbl">Client secret ${g.clientSecretSaved ? `<span class="chip green">saved</span>` : ""}</label><input type="password" id="bh-csec" placeholder="${g.clientSecretSaved ? "saved in the vault (type to replace)" : "GOCSPX-..."}" autocomplete="off"></div>
    </div>
    <div class="row small" style="gap:14px;flex-wrap:wrap;margin-top:8px">
      <label class="row" style="gap:6px"><input type="checkbox" id="bh-g-gmail" checked> Read Gmail</label>
      <label class="row" style="gap:6px"><input type="checkbox" id="bh-g-drive" checked> Read Google Drive</label>
      <label class="row" style="gap:6px"><input type="checkbox" id="bh-g-send"> Send email (asks you every time)</label>
      <label class="row" style="gap:6px"><input type="checkbox" id="bh-g-cal" ${g.scopes?.some((x) => x.id === "calendar") ? "checked" : ""}> Google Calendar</label>
    </div>
    <div class="row" style="margin-top:8px;gap:8px"><button class="btn sm" id="bh-g-save">Save client</button><button class="btn sm primary" id="bh-g-connect">${g.connected ? "Connect again" : "Connect Google"}</button>${g.connected ? `<button class="btn sm danger" id="bh-g-off" style="margin-left:auto">Disconnect</button>` : ""}</div>
    <div id="bh-accounts" style="margin-top:10px">
      ${(g.accounts || []).map((a) => `<div class="row small" data-bh-acct="${esc(a.id)}" style="gap:8px;flex-wrap:wrap;margin-top:6px">
        <input type="text" data-bh-label value="${esc(a.label)}" aria-label="Account label" style="width:160px;padding:4px 6px">
        <label class="row" style="gap:4px"><input type="radio" name="bh-acct-default" data-bh-default ${a.isDefault ? "checked" : ""}> Default</label>
        <span class="chip ${a.connected ? (a.needsSignIn ? "amber" : "green") : ""}">${a.connected ? (a.needsSignIn ? "sign in again" : "connected") : "not connected"}</span>
        <button class="ghost small" data-bh-remove>Remove</button>
      </div>`).join("")}
      <div class="row small" style="gap:8px;margin-top:8px"><input type="text" id="bh-new-label" placeholder="Label, e.g. Work" aria-label="Label for another Google account" style="width:160px;padding:4px 6px"><button class="btn sm" id="bh-add-account">Add another account</button></div>
    </div>
    ${data.jobs.length ? `<div class="cat-h" style="margin-top:14px">Recent jobs</div><div id="bh-jobs">${data.jobs.slice(0, 5).map((j) => jobHtml(j)).join("")}</div>` : ""}
  </div>`;
  const v = (sel) => el.querySelector(sel)?.value;
  const on = (sel) => !!el.querySelector(sel)?.checked;
  el.querySelector("#bh-save").addEventListener("click", async () => {
    const body = { on: on("#bh-on"), auto: on("#bh-auto"), maxSteps: Number(v("#bh-steps")), maxCostUsd: Number(v("#bh-cost")), approvalWaitMin: Number(v("#bh-okwait")), councilWaitSec: Number(v("#bh-cwait")), missionWaitMin: Number(v("#bh-mwait")), model: v("#bh-model") };
    if (el.querySelector("#bh-window")) body.showWindow = on("#bh-window");
    try { await api("/browser/config", { method: "POST", body }); toast("Browser helper settings saved"); await CC.refresh(); } catch (e) { toast(e.message, true); }
  });
  el.querySelector("#bh-demo").addEventListener("click", async () => { try { await api("/browser/demo", { method: "POST" }); toast("The helper is opening the demo page. It will ask for your OK before it sends the form."); await refresh(); } catch (e) { toast(e.message, true); } });
  const saveClient = async () => { const body = { clientId: v("#bh-cid") }; if (v("#bh-csec").trim()) body.clientSecret = v("#bh-csec"); await api("/browser/google/client", { method: "POST", body }); };
  el.querySelector("#bh-g-save").addEventListener("click", async () => { try { await saveClient(); toast("Google client saved"); renderSettings(el); } catch (e) { toast(e.message, true); } });
  el.querySelector("#bh-g-connect").addEventListener("click", async () => {
    try {
      await saveClient();
      const r = await api("/browser/google/start", { method: "POST", body: { origin: location.origin, gmail: on("#bh-g-gmail"), drive: on("#bh-g-drive"), send: on("#bh-g-send"), calendar: on("#bh-g-cal") } });
      window.open(r.url, "_blank", "noopener");
      toast("Sign in to Google and allow the access you ticked; this page finishes the link when you come back.");
    } catch (e) { toast(e.message, true); }
  });
  el.querySelector("#bh-g-off")?.addEventListener("click", async () => { if (!confirm("Disconnect Google from the browser helper? Its tokens are removed from the vault. To remove the access on Google's side too, use myaccount.google.com/permissions.")) return; try { await api("/browser/google", { method: "DELETE" }); toast("Google disconnected"); renderSettings(el); } catch (e) { toast(e.message, true); } });
  el.querySelector("#bh-add-account")?.addEventListener("click", async () => {
    const label = v("#bh-new-label").trim();
    if (!label) return toast("Give this account a label.", true);
    let created = null;
    try {
      await saveClient();
      created = await api("/mail-accounts", { method: "POST", body: { provider: "google", label } });
      const r = await api("/browser/google/start", { method: "POST", body: { origin: location.origin, gmail: on("#bh-g-gmail"), drive: on("#bh-g-drive"), send: on("#bh-g-send"), calendar: on("#bh-g-cal"), accountId: created.account.id } });
      window.open(r.url, "_blank", "noopener");
      toast("Sign in to Google for this account. This page finishes the link when you come back.");
    } catch (e) { toast(e.message, true); }
    if (created) renderSettings(el);
  });
  el.querySelectorAll("[data-bh-acct]").forEach((row) => {
    const id = row.dataset.bhAcct;
    row.querySelector("[data-bh-label]").addEventListener("change", async () => {
      try { await api(`/mail-accounts/${encodeURIComponent(id)}/label`, { method: "POST", body: { label: row.querySelector("[data-bh-label]").value } }); toast("Account label saved"); renderSettings(el); }
      catch (e) { toast(e.message, true); }
    });
    row.querySelector("[data-bh-default]").addEventListener("change", async () => {
      try { await api(`/mail-accounts/${encodeURIComponent(id)}/default`, { method: "POST", body: {} }); toast("Default Google account updated"); renderSettings(el); }
      catch (e) { toast(e.message, true); }
    });
    row.querySelector("[data-bh-remove]").addEventListener("click", async () => {
      if (!confirm("Remove this Google account? Its token is removed from the vault.")) return;
      try { await api(`/mail-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }); toast("Account removed"); renderSettings(el); }
      catch (e) { toast(e.message, true); }
    });
  });
  const jb = el.querySelector("#bh-jobs"); if (jb) wire(jb, () => renderSettings(el));
}

// ---------- Google sign-in: the browser came back with ?code=&state=bh-... ----------
async function finishGoogleIfBack() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state") || "";
  if (!code || !state.startsWith("bh-")) return;
  for (const k of ["code", "state", "scope", "authuser", "prompt", "session_state", "iss", "hd"]) q.delete(k);
  history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
  try { const r = await api("/browser/google/finish", { method: "POST", body: { code, state } }); toast(`Google connected for the browser helper: ${r.scopes.map((x) => x.label).join(", ")}.`); }
  catch (e) { toast(`Google sign-in did not finish: ${e.message}`, true); }
}

// ---------- live updates ----------
let pending = null;
async function refresh() {
  try { await load(); } catch { return; }
  const i = S.providers.findIndex((p) => p.id === "browser-helper"); if (i >= 0) S.providers[i] = data.card;
  CC.graph?.setStatus?.("browser-helper", data.card.status.status);
  const box = document.querySelector('#cmd-extras [data-feature="browser"]'); if (box && S.view === "command") renderCommand(box);
  renderFloat();
}
const soon = () => { clearTimeout(pending); pending = setTimeout(refresh, 150); };
CC.register({
  id: "browser",
  command: { order: 13, render: renderCommand },
  deliverable: { order: 7, render: renderDeliverable },
  settings: { order: 4, render: renderSettings },
  onEvent(ev) {
    if (ev.type === "hello") { finishGoogleIfBack(); soon(); }
    if (ev.type === "browser.job" || ev.type === "browser.step") {
      soon();
      const runId = ev.job?.source?.runId || ev.runId;
      if (runId && runId === S.live?.id && S.view === "command") { const d = document.querySelector('#deliv-extras [data-feature="browser"]'); if (d) renderDeliverable(d); }
      if (ev.type === "browser.job" && ev.job?.source?.kind === "click" && ev.job.status === "done") toast("The browser helper finished. See its card in Command.");
    }
  },
});
