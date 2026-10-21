// Grok Bot agent (Phase 12).
// Command: agent cards for Grok Bot and the built-in browser helper (status light, what they are doing now,
//   an activity feed), "Send to Grok Bot" (a click), and Auto / Always / Never for councils and missions.
// Deliverable: the Grok Bot jobs of this run, their results and links, paste a result in by hand, cancel.
// Settings > Integrations > Grok Bot: webhook URL and sender key (vault; never shown again), header name,
//   where results come back, the built-in mock, wait times, and a test job.
const { S, api, toast, esc, md, ago } = window.CC;

const css = `
.cc-gb-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; }
.cc-gb-card { border: 1px solid var(--line); border-left: 3px solid var(--c); border-radius: 10px; padding: 8px 10px; }
.cc-gb-card .hd { display: flex; align-items: center; gap: 6px; }
.cc-gb-card .act { margin-top: 6px; max-height: 92px; overflow: auto; }
.cc-gb-card .act div { display: flex; gap: 6px; font-size: 11px; padding: 1px 0; }
.cc-gb-card .act .t { opacity: .6; min-width: 34px; }
.cc-gb-job { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
.cc-gb-job textarea { width: 100%; min-height: 70px; margin-top: 6px; }
#prov-grokbot input[type=number] { width: 80px; }
`;
const style = document.createElement("style"); style.id = "cc-grokbot-style"; style.textContent = css; document.head.appendChild(style);

const LABEL = { queued: "queued", working: "working", needs_approval: "needs your approval", done: "done", failed: "failed" };
const CHIP = { queued: "", working: "violet", needs_approval: "amber", done: "green", failed: "red" };
const ASYNC = "Results are async and can take minutes.";
let data = null;
async function load() { data = await api("/grokbot"); return data; }
const agents = () => S.providers.filter((p) => p.kind === "agent");
const light = (st) => `<span class="light ${esc(st || "grey")}" style="display:inline-block;width:8px;height:8px;border-radius:50%"></span>`;

// ---------- Command: agent cards, send, include choice ----------
function cardHtml(p) {
  const a = p.agent || {};
  const now = a.now ? `<div class="small" style="margin-top:4px">Now: <span class="chip ${CHIP[a.now.status] || ""}">${esc(LABEL[a.now.status] || a.now.status)}</span> ${esc(a.now.task)}</div>` : `<div class="small dim" style="margin-top:4px">${esc(p.status?.detail || "")}</div>`;
  const act = (a.activity || []).slice(0, 6).map((x) => `<div><span class="t">${ago(x.ts)}</span><span class="chip ${CHIP[x.status] || ""}" style="padding:0 5px">${esc(LABEL[x.status] || x.status)}</span><span class="dim" style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(x.task)}</span></div>`).join("");
  return `<div class="cc-gb-card" style="--c:${esc(p.color)}" data-agent="${esc(p.id)}">
    <div class="hd">${light(p.status?.status)}<b>${esc(p.name)}</b><span class="dim small">${esc(p.vendor || "")}</span>${p.id === "grokbot" ? `<button class="ghost small" data-gb-settings style="margin-left:auto">set up</button>` : ""}</div>
    <div class="small dim" style="margin-top:2px">${(a.tags || []).map((t) => esc(t.label)).join(" · ")}</div>
    ${now}${act ? `<div class="act">${act}</div>` : ""}</div>`;
}
function renderCommand(el) {
  const list = agents();
  if (!list.length) { el.innerHTML = ""; return; }
  const gb = list.find((p) => p.id === "grokbot");
  const ch = S.grokbotChoice === true ? "always" : S.grokbotChoice === false ? "never" : "auto";
  el.innerHTML = `<div style="margin-top:8px">
    <div class="row small" style="gap:8px;flex-wrap:wrap"><span class="muted">Agents</span>
      <span class="seg" id="gb-choice" title="Councils and missions: hand Grok Bot the parts that need signed-in browsing, Gmail, Drive, Calendar or teammate bots">${["auto", "always", "never"].map((c) => `<button data-c="${c}" class="${ch === c ? "on" : ""}">${c === "auto" ? "Grok Bot: when needed" : c === "always" ? "Always" : "Never"}</button>`).join("")}</span>
      <button class="btn sm" id="gb-send" ${gb?.agent?.ready ? "" : "disabled"} title="${gb?.agent?.ready ? "Hand the orders above to Grok Bot as one job. " + ASYNC : esc(gb?.status?.detail || "")}" style="margin-left:auto">Send to Grok Bot</button></div>
    <div class="cc-gb-cards">${list.map(cardHtml).join("")}</div>
    <div class="dim small" style="margin-top:4px">Jobs made through the APIs do not show up in grok.com, claude.ai or ChatGPT history; watch them here. ${ASYNC}</div></div>`;
  el.querySelector("#gb-choice").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.grokbotChoice = b.dataset.c === "always" ? true : b.dataset.c === "never" ? false : undefined; renderCommand(el); });
  el.querySelector("[data-gb-settings]")?.addEventListener("click", () => { S.focusProvider = "grokbot"; CC.go("settings"); });
  el.querySelector("#gb-send").addEventListener("click", async (e) => {
    const task = (document.querySelector("#orders")?.value || "").trim();
    if (!task) return toast("Type the orders first", true);
    e.target.disabled = true;
    try {
      let context = "";
      const projectId = document.querySelector("#proj")?.value || null;
      if (projectId) { try { context = (await api(`/memory/context?projectId=${encodeURIComponent(projectId)}`)).context || ""; } catch {} }
      const r = await api("/grokbot/jobs", { method: "POST", body: { task, context, projectId } });
      toast(`Sent to Grok Bot. ${ASYNC}`);
      S.grokbotLastClick = r.job.id;
    } catch (err) { toast(err.message, true); }
    finally { e.target.disabled = false; }
  });
}

// ---------- Deliverable: this run's Grok Bot jobs ----------
function jobHtml(j) {
  const arts = (j.artifacts || []).map((a) => a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)).join(" · ");
  const open = !["done", "failed"].includes(j.status) || (j.status === "failed" && j.by !== "you");
  return `<div class="cc-gb-job" data-job="${esc(j.id)}">
    <div class="row small" style="gap:6px">${light(j.status === "done" ? "green" : j.status === "failed" ? "red" : j.status === "needs_approval" ? "amber" : "grey")}<b>Grok Bot</b><span class="chip ${CHIP[j.status] || ""}">${esc(LABEL[j.status] || j.status)}</span>${j.by === "you" ? `<span class="chip">pasted by you</span>` : j.via === "mock" ? `<span class="chip">mock</span>` : ""}${j.late ? `<span class="chip">arrived later</span>` : ""}<span class="dim" style="margin-left:auto">${j.sentAt ? `sent ${ago(j.sentAt)} ago` : ""}</span></div>
    <div class="small dim" style="margin-top:4px">${esc(j.task.slice(0, 200))}</div>
    ${j.text ? `<div class="md small" style="margin-top:6px">${md(j.text)}</div>` : ""}
    ${arts ? `<div class="small" style="margin-top:4px">${arts}</div>` : ""}
    ${j.error && j.status === "failed" ? `<div class="small" style="color:var(--red);margin-top:4px">${esc(j.error)}</div>` : ""}
    ${open ? `<div class="dim small" style="margin-top:4px">${ASYNC} When Grok Bot finishes, the summary shows here. If it cannot call back, use Paste result.</div>
      <details style="margin-top:4px"><summary class="small muted" style="cursor:pointer">Paste result</summary><textarea data-paste placeholder="DONE: the summary"></textarea>
      <div class="row" style="margin-top:4px;gap:6px"><button class="btn sm" data-save-paste>Save result</button>${["done", "failed"].includes(j.status) ? "" : `<button class="ghost small" data-cancel style="margin-left:auto">cancel job</button>`}</div></details>` : ""}
  </div>`;
}
async function renderDeliverable(el, run) {
  const runId = S.live?.id;
  if (!runId) { el.innerHTML = ""; return; }
  const hasAgent = (S.live.council?.agents?.length) || Object.values(S.live.tasks || {}).some((t) => t.agent);
  if (!hasAgent) { el.innerHTML = ""; return; }
  let jobs = [];
  try { jobs = await api(`/grokbot/jobs?run=${encodeURIComponent(runId)}`); } catch { el.innerHTML = ""; return; }
  if (S.live?.id !== runId) return;
  el.innerHTML = jobs.length ? `<div class="cat-h" style="margin-top:12px">Grok Bot on this ${esc(S.live.kind || "run")}</div>${jobs.map(jobHtml).join("")}` : "";
  wireJobs(el, () => renderDeliverable(el, run));
}
function wireJobs(el, again) {
  el.querySelectorAll("[data-job]").forEach((box) => {
    const id = box.dataset.job;
    box.querySelector("[data-save-paste]")?.addEventListener("click", async () => {
      const text = box.querySelector("[data-paste]").value;
      try { await api(`/grokbot/jobs/${encodeURIComponent(id)}/result`, { method: "POST", body: { text } }); toast("Result saved"); again(); } catch (e) { toast(e.message, true); }
    });
    box.querySelector("[data-cancel]")?.addEventListener("click", async () => {
      if (!confirm("Cancel this Grok Bot job here? Grok Bot is not told; a late result will be refused.")) return;
      try { await api(`/grokbot/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }); again(); } catch (e) { toast(e.message, true); }
    });
  });
}

// ---------- Settings > Integrations > Grok Bot ----------
async function renderSettings(el) {
  // drawn at once so a click on the Grok Bot tile can scroll here before the data arrives
  if (!el.querySelector("#prov-grokbot")) el.innerHTML = `<div class="panel" id="prov-grokbot"><h3>Integrations: Grok Bot</h3><div class="dim small">Loading...</div></div>`;
  try { await load(); } catch (e) { el.innerHTML = `<div class="panel" id="prov-grokbot"><h3>Integrations: Grok Bot</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const c = data.config, card = data.card;
  el.innerHTML = `<div class="panel" id="prov-grokbot"><h3>Integrations: Grok Bot <span class="right">${light(card.status.status)} ${esc(card.status.detail)}</span></h3>
    <div class="small muted">Grok Bot is your own assistant with its own computer, signed-in browser, Gmail, Drive, Calendar and teammate bots. When a council or mission needs one of those (${c.tags.map((t) => esc(t.label)).join(", ")}), Meldmind hands Grok Bot that part as a job. It is never picked for plain text work another AI does as well. Nothing is sent without your orders or a click.</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      <div><label class="lbl">Webhook URL ${c.urlSaved ? `<span class="chip green">saved</span>` : ""}</label><input type="password" id="gb-url" placeholder="${c.urlSaved ? "saved in the vault (type to replace)" : "https://..."}" autocomplete="off"></div>
      <div><label class="lbl">Sender key ${c.keySaved ? `<span class="chip green">saved</span>` : ""}</label><input type="password" id="gb-key" placeholder="${c.keySaved ? "saved in the vault (type to replace)" : "the key Grok Bot expects"}" autocomplete="off"></div>
      <div><label class="lbl">Header name (optional)</label><input type="text" id="gb-header" value="${esc(c.header)}" placeholder="Authorization" style="font-family:var(--mono)"><div class="dim small">Sent as <span class="mono">${esc(c.header)}: ${esc(c.headerValue)}</span></div></div>
      <div><label class="lbl">Where results come back (optional)</label><input type="text" id="gb-public" value="${esc(c.publicUrl)}" placeholder="https://your-hub or tunnel address" style="font-family:var(--mono)"></div>
    </div>
    <div class="dim small" style="margin-top:6px">The URL and key are kept in the vault, never logged and never shown again after saving. Each job carries its own one-time callback address: <span class="mono">${esc(c.callbackExample)}</span>.
      ${c.reachable ? "A finished job can also report back through the hosted hub. The summary shows in the job." : `<span style="color:var(--amber)">That address is on this computer, so Grok Bot can only reach it once the hosted hub exists or a tunnel is set up. Until then jobs stay queued or working, and you can use Paste result.</span>`}</div>
    <div class="row small" style="gap:14px;flex-wrap:wrap;margin-top:10px">
      <label class="row" style="gap:6px"><input type="checkbox" id="gb-auto" ${c.auto ? "checked" : ""}> Hand jobs that need it to Grok Bot on its own</label>
      <label class="row" style="gap:6px"><input type="checkbox" id="gb-mock" ${c.mock ? "checked" : ""}> Use the built-in mock (pretend Grok Bot, nothing leaves this computer)</label>
      <label class="row" style="gap:6px">Council waits <input type="number" id="gb-cwait" min="0" max="900" value="${c.councilWaitSec}"> s</label>
      <label class="row" style="gap:6px">Mission waits <input type="number" id="gb-mwait" min="0" max="240" value="${c.missionWaitMin}"> min</label>
    </div>
    ${c.demo && !c.mock ? `<div class="small" style="color:var(--amber);margin-top:6px">Demo mode is on: Grok Bot jobs only go to the built-in mock.</div>` : ""}
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn sm primary" id="gb-save">Save</button><button class="btn sm" id="gb-test" ${c.ready ? "" : "disabled"}>Send a test job</button>${c.urlSaved || c.keySaved ? `<button class="btn sm danger" id="gb-rm" style="margin-left:auto">Remove connection</button>` : ""}</div>
    ${data.jobs.length ? `<div class="cat-h" style="margin-top:14px">Recent jobs</div><div id="gb-jobs">${data.jobs.slice(0, 6).map(jobHtml).join("")}</div>` : ""}
  </div>`;
  const v = (sel) => el.querySelector(sel).value;
  el.querySelector("#gb-save").addEventListener("click", async () => {
    const body = { header: v("#gb-header"), publicUrl: v("#gb-public"), auto: el.querySelector("#gb-auto").checked, mock: el.querySelector("#gb-mock").checked, councilWaitSec: Number(v("#gb-cwait")), missionWaitMin: Number(v("#gb-mwait")) };
    if (v("#gb-url").trim()) body.url = v("#gb-url");
    if (v("#gb-key").trim()) body.key = v("#gb-key");
    try { await api("/grokbot/config", { method: "POST", body }); toast("Grok Bot settings saved"); await CC.refresh(); } catch (e) { toast(e.message, true); }
  });
  el.querySelector("#gb-test").addEventListener("click", async () => { try { const r = await api("/grokbot/test", { method: "POST" }); toast(r.job.status === "failed" ? r.job.error : `Test job sent. ${ASYNC}`, r.job.status === "failed"); renderSettings(el); } catch (e) { toast(e.message, true); } });
  el.querySelector("#gb-rm")?.addEventListener("click", async () => { if (!confirm("Remove the Grok Bot webhook URL and sender key from the vault?")) return; try { await api("/grokbot/config", { method: "POST", body: { remove: true } }); toast("Removed"); await CC.refresh(); } catch (e) { toast(e.message, true); } });
  const jb = el.querySelector("#gb-jobs"); if (jb) wireJobs(jb, () => renderSettings(el));
}

// ---------- live updates ----------
function rerenderCommand() { const box = document.querySelector('#cmd-extras [data-feature="grokbot"]'); if (box) renderCommand(box); }
function rerenderDeliverable() { const box = document.querySelector('#deliv-extras [data-feature="grokbot"]'); if (box) renderDeliverable(box); }
CC.register({
  id: "grokbot",
  command: { order: 12, render: renderCommand },
  deliverable: { order: 6, render: renderDeliverable },
  settings: { order: 3, render: renderSettings },
  onEvent(ev) {
    if (ev.type === "grokbot.job") {
      // the provider list carries the card (light, now, activity); refresh it from the server
      api("/grokbot").then((d) => {
        data = d;
        const i = S.providers.findIndex((p) => p.id === "grokbot"); if (i >= 0) S.providers[i] = d.card;
        CC.graph?.setStatus("grokbot", d.card.status.status);
        if (S.view === "command") { rerenderCommand(); if (ev.job?.source?.runId === S.live?.id) rerenderDeliverable(); }
        if (ev.job?.id === S.grokbotLastClick && ev.job.status === "done") toast("Grok Bot finished the job you sent. See Settings > Integrations > Grok Bot, or the card in Command.");
      }).catch(() => {});
    }
    if (ev.type === "grokbot.late" && ev.runId === S.live?.id) {
      // a result that came back after the run moved on: show it in place
      if (ev.kind === "council" && ev.council) { S.live.council = ev.council; if (ev.council.verdict?.text) S.live.deliverable = ev.council.verdict.text; }
      if (ev.kind === "mission" && ev.mission) { S.live.mission = ev.mission; for (const t of ev.mission.tasks || []) S.live.tasks[t.id] = t; S.live.deliverable = ev.mission.deliverable || S.live.deliverable; }
      if (S.view === "command") CC.renderOps?.();
    }
  },
});
