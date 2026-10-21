// Get it done. One job can run its ordinary steps without asking.
// Spending money and a permanent delete still need one tap.
// Sending a message stays off unless that box is on.
const { api, toast, esc } = window.CC;

const css = `
#gd-banner { position: fixed; top: 58px; left: 50%; transform: translateX(-50%); z-index: 58; width: min(560px, calc(100vw - 24px)); background: var(--bg2, #0f1520); border: 1px solid var(--amber, #f59e0b); border-radius: 10px; padding: 8px 10px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
#gd-banner .gd-line { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
#gd-box label { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
#gd-log { margin-top: 8px; max-height: 160px; overflow: auto; }
#gd-log div { padding: 2px 0; border-bottom: 1px solid var(--line); }
`;
const style = document.createElement("style"); style.id = "cc-getdone-style"; style.textContent = css; document.head.appendChild(style);

const KINDS = [
  ["writing", "Writing"],
  ["research", "Research"],
  ["code", "Code"],
  ["creative", "Creative"],
  ["analysis", "Analysis"],
  ["math", "Math"],
  ["reasoning", "Reasoning"],
];

const choice = { on: false, send: false };
function said(text) {
  const t = String(text || "").toLowerCase().replace(/[’‘]/g, "'");
  return /\bget it done\b/.test(t) && /\b(?:don't|dont|do not) ask me\b/.test(t);
}
window.CC.getDoneChoice = {
  get on() { return !!(choice.on || said(document.querySelector("#orders")?.value || "")); },
  get send() { return !!(choice.send && this.on); },
};

let state = { rules: [], grants: [], log: [] };
let painting = false;

function when(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
}

async function load() {
  state = await api("/getdone");
  paintBanner();
  document.querySelectorAll("#gd-log").forEach((n) => { n.innerHTML = logHtml(); });
  return state;
}

function paintBanner() {
  let box = document.getElementById("gd-banner");
  const grants = state.grants || [];
  if (!grants.length) { box?.remove(); return; }
  if (!box) { box = document.createElement("div"); box.id = "gd-banner"; document.body.appendChild(box); }
  box.innerHTML = grants.map((g) => `<div class="gd-line"><span>Get it done is on for this job. Stop is still here.</span><button type="button" class="btn sm" data-gd-stop="${esc(g.runId)}">Stop</button></div>`).join("");
  box.querySelectorAll("[data-gd-stop]").forEach((b) => b.addEventListener("click", () => stopJob(b.dataset.gdStop)));
}

async function stopJob(runId) {
  try {
    state = await api(`/getdone/stop/${encodeURIComponent(runId)}`, { method: "POST", body: {} });
    toast("Stopped. Get it done is off for this job.");
    paintBanner();
  } catch (e) { toast(e.message, true); }
}

function logHtml() {
  const rows = (state.log || []).slice().reverse();
  if (!rows.length) return `<div class="dim">No steps yet.</div>`;
  return rows.map((row) => `<div><span class="dim">${esc(when(row.at))}</span> ${esc(row.text)}</div>`).join("");
}

function renderCommand(el) {
  const phrase = said(document.querySelector("#orders")?.value || "");
  const on = choice.on || phrase;
  el.innerHTML = `<div id="gd-box" style="margin-top:8px">
    <label><input type="checkbox" id="gd-on" ${on ? "checked" : ""}> Get it done</label>
    <div class="small dim">Don't ask me on this job. It ends when the job ends. You can also type "get it done, don't ask me".</div>
    <label><input type="checkbox" id="gd-send" ${choice.send && on ? "checked" : ""} ${on ? "" : "disabled"}> Also send messages</label>
    <div class="small dim">Off unless you turn it on. Spending money and a permanent delete still need one tap.</div>
    <details open style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Activity log</summary><div id="gd-log" class="small">${logHtml()}</div></details>
  </div>`;
  const onBox = el.querySelector("#gd-on");
  const sendBox = el.querySelector("#gd-send");
  onBox.addEventListener("change", () => {
    choice.on = onBox.checked;
    if (!choice.on) choice.send = false;
    renderCommand(el);
  });
  sendBox.addEventListener("change", () => { choice.send = sendBox.checked; });
}

async function renderSettings(el) {
  try { await load(); } catch { /* the panel still draws */ }
  const rules = state.rules || [];
  el.innerHTML = `<div class="panel" id="gd-settings">
    <h3>Get it done</h3>
    <div class="small muted">Always for this kind of job runs those jobs without asking. It stays until you revoke it. Each job still ends on its own. Spending money and a permanent delete still need one tap. Sending a message stays off unless you tick it here.</div>
    <div class="row small" style="gap:8px;flex-wrap:wrap;margin-top:8px">
      <label>Kind <select id="gd-rule-kind">${KINDS.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label>
      <label class="row" style="gap:6px"><input type="checkbox" id="gd-rule-send"> Also send messages</label>
      <button type="button" class="btn sm" id="gd-rule-save">Always for this kind of job</button>
    </div>
    <div id="gd-rules" style="margin-top:8px">${rules.length ? rules.map((r) => `<div class="row small" style="gap:8px;margin-top:6px"><span>${esc(r.label)}</span>${r.send ? `<span class="chip">sending on</span>` : `<span class="chip">sending off</span>`}<button type="button" class="btn sm" data-gd-revoke="${esc(r.id)}">Revoke</button></div>`).join("") : `<div class="dim small">No standing rules.</div>`}</div>
    <details open style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Activity log</summary><div id="gd-log" class="small">${logHtml()}</div></details>
  </div>`;
  el.querySelector("#gd-rule-save").addEventListener("click", async () => {
    try {
      state = await api("/getdone/rules", { method: "POST", body: { jobKind: el.querySelector("#gd-rule-kind").value, send: !!el.querySelector("#gd-rule-send").checked } });
      toast("Saved. You can revoke it any time.");
      renderSettings(el);
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-gd-revoke]").forEach((b) => b.addEventListener("click", async () => {
    try { state = await api(`/getdone/rules/${encodeURIComponent(b.dataset.gdRevoke)}`, { method: "DELETE" }); toast("Revoked"); renderSettings(el); }
    catch (e) { toast(e.message, true); }
  }));
}

document.addEventListener("input", (e) => {
  if (e.target?.id !== "orders") return;
  if (!said(e.target.value)) return;
  const box = document.querySelector("#gd-on");
  if (box && !box.checked) { choice.on = true; box.checked = true; const send = document.querySelector("#gd-send"); if (send) send.disabled = false; }
});

window.CC.register({
  id: "getdone",
  command: { order: 4, render: renderCommand },
  settings: { order: 24, render: renderSettings },
  async onState() { if (painting) return; painting = true; try { await load(); } catch {} painting = false; },
  onEvent(ev) {
    if (ev.type === "getdone.update" && ev.rules) { state = { rules: ev.rules, grants: ev.grants || [], log: ev.log || state.log }; paintBanner(); return; }
    if (["mission.update", "browser.job", "grokbot.job", "reportback.result", "council.update"].includes(ev.type)) load().catch(() => {});
  },
});
