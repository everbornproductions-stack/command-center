// Media tab + "Make media from this" and a mission's media steps under deliverables + key fields in Settings.
// The estimate always comes first: Generate stays off until the estimate for the current choices is on screen,
// and it sends that estimate back. A mission's paid media step waits here (and under its deliverable) for Approve.
import { mountBar } from "../next-actions-ui.js";
import { mediaKeyLine, plainPriceLine } from "./key-hints.js";
const { S, api, apiBlobUrl, toast, esc, money, pname, pcolor, go } = window.CC;

let providers = [];
async function loadProviders() { try { providers = await api("/media/providers"); } catch { providers = []; } return providers; }

const STATUS = { awaiting_ok: "waiting for your OK", "dry-run": "dry run", declined: "not made" };
const chip = (s) => (s === "done" ? "green" : s === "failed" ? "red" : s === "dry-run" || s === "awaiting_ok" ? "amber" : "");

function form(prefill = {}) {
  const pv = providers.filter((p) => p.kinds.includes(prefill.kind || "video"));
  return `<div class="panel" id="md-form"><h3>Generate <span class="right">estimate first · nothing spends until you click Generate</span></h3>
    <div class="row"><div class="seg" id="md-kind">${["video", "image", "voice"].map((k) => `<button data-k="${k}" class="${(prefill.kind || "video") === k ? "on" : ""}">${k}</button>`).join("")}</div>
      <select id="md-prov" style="width:auto">${pv.map((p) => `<option value="${p.id}">${esc(p.name)}${p.keyed ? "" : p.connected ? " (MCP)" : " (needs a key: practice only)"}</option>`).join("")}</select>
      <select id="md-proj" style="width:auto"><option value="">No project</option>${S.projects.map((p) => `<option value="${p.id}" ${p.id === S.project ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <label class="lbl">Prompt / text</label><textarea id="md-prompt" style="min-height:80px">${esc(prefill.prompt || "")}</textarea>
    <div class="row" style="margin-top:8px"><label class="small" id="md-img-l">First-frame image URL <input type="text" id="md-img" placeholder="https://… (needed for image-to-video)" style="width:320px;padding:5px 8px"></label><label class="small" id="md-dur-l">Seconds <input type="number" id="md-dur" value="5" min="3" max="10" style="width:70px;padding:5px 8px"></label><input type="text" id="md-model" placeholder="model (optional)" style="width:220px;padding:5px 8px"></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="md-est">See the price</button><span class="small" id="md-est-out"></span><button class="btn sm primary" id="md-go" style="margin-left:auto">Generate</button></div>
    <div class="small dim" id="md-need" style="margin-top:6px"${mediaKeyLine(providers, prefill.kind || "video", pv[0]?.id) ? "" : " hidden"}>${esc(mediaKeyLine(providers, prefill.kind || "video", pv[0]?.id))} <a href="#" data-keys="1">Open Settings</a></div></div>`;
}

function wireForm(root, after) {
  let kind = root.querySelector("#md-kind button.on")?.dataset.k || "video";
  let seen = null; // the estimate on screen; Generate sends it back
  let autoT = 0;   // the price is worked out a moment after the last change (0.4.21)
  const stale = () => { seen = null; const g = root.querySelector("#md-go"); g.disabled = false; g.textContent = "Generate"; g.title = "Shows the price first"; root.querySelector("#md-est-out").innerHTML = ""; clearTimeout(autoT); autoT = setTimeout(() => { if (root.isConnected && seen == null && root.querySelector("#md-prompt").value.trim()) estimate(); }, 700); };
  // 0.4.25 (audit A5): Generate is never a silent button. With no key for the chosen service, one short line says so.
  const showNeed = () => {
    const box = root.querySelector("#md-need"); if (!box) return;
    const line = mediaKeyLine(providers, kind, root.querySelector("#md-prov").value);
    box.hidden = !line;
    box.firstChild.textContent = line ? line + " " : "";
  };
  root.querySelector("#md-need")?.querySelector("[data-keys]")?.addEventListener("click", (e) => { e.preventDefault(); window.CC.openSettings?.("keys"); });
  const refreshProv = () => { const sel = root.querySelector("#md-prov"); sel.innerHTML = providers.filter((p) => p.kinds.includes(kind)).map((p) => `<option value="${p.id}">${esc(p.name)}${p.keyed ? "" : p.connected ? " (MCP)" : " (needs a key: practice only)"}</option>`).join(""); root.querySelector("#md-img-l").style.display = kind === "voice" ? "none" : ""; root.querySelector("#md-dur-l").style.display = kind === "video" ? "" : "none"; showNeed(); stale(); };
  root.querySelector("#md-proj")?.addEventListener("change", (e) => { if (S.flags?.projectbar) window.CC.setWorkingProject?.(e.target.value); });
  root.querySelector("#md-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; kind = b.dataset.k; root.querySelectorAll("#md-kind button").forEach((x) => x.classList.toggle("on", x === b)); refreshProv(); });
  for (const sel of ["#md-prov", "#md-prompt", "#md-img", "#md-dur", "#md-model"]) root.querySelector(sel).addEventListener("input", stale);
  root.querySelector("#md-prov").addEventListener("change", showNeed);
  const params = () => ({ prompt: root.querySelector("#md-prompt").value.trim(), text: root.querySelector("#md-prompt").value.trim(), imageUrl: root.querySelector("#md-img").value.trim() || undefined, duration: Number(root.querySelector("#md-dur").value) || 5, model: root.querySelector("#md-model").value.trim() || undefined });
  const estimate = async () => {
    try {
      const r = await api("/media/estimate", { method: "POST", body: { provider: root.querySelector("#md-prov").value, kind, params: params() } });
      seen = r.usd;
      root.querySelector("#md-est-out").innerHTML = `<b data-md-price>${esc(plainPriceLine(r.estimate, r.usd))}</b>${r.keyed ? "" : r.connected ? ' <span class="chip">MCP</span>' : ' <span class="chip amber">needs a key · practice only, nothing spent</span>'}${r.capped ? ' <span class="chip red">at its spend cap</span>' : r.wouldExceed ? ` <span class="chip red">over the cap ($${esc(String(r.capLeft))} left)</span>` : ""}`;
      root.querySelector("#md-go").disabled = !!(r.capped || r.wouldExceed);
      root.querySelector("#md-go").textContent = r.capped || r.wouldExceed ? "Generate" : `Generate (about ${money(r.usd, 3)})`;
      return r;
    } catch (e) { toast(e.message, true); return null; }
  };
  root.querySelector("#md-est").addEventListener("click", estimate);
  root.querySelector("#md-go").addEventListener("click", async () => {
    // One step (0.4.21): the first press shows the price, the next press makes it.
    if (seen == null) {
      if (!root.querySelector("#md-prompt").value.trim()) return toast("Write what you want first.", true);
      const r = await estimate();
      if (r && !root.querySelector("#md-go").disabled) toast("That is the price. Press Generate again to make it.");
      return;
    }
    try { const j = await api("/media/generate", { method: "POST", body: { provider: root.querySelector("#md-prov").value, kind, params: params(), estimate: seen, projectId: root.querySelector("#md-proj").value || null, missionId: S.live?.id || null } }); toast(`Job ${j.id} started`); after?.(); } catch (e) { toast(e.message, true); }
  });
}

function jobRow(j) {
  const files = (j.files || []).map((f) => (f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">open</a>` : `<a href="#" data-view="${esc(j.id)}:${f.i}">view ${esc(f.name)}</a> <a href="#" data-open="${esc(j.id)}:${f.i}">show in folder</a>`)).join(" ");
  const ok = j.status === "awaiting_ok" ? `<div class="row" style="margin-top:4px"><button class="btn sm primary" data-approve="${esc(j.id)}" data-usd="${esc(String(j.estimate?.usd ?? 0))}">Approve · about ${money(j.estimate?.usd || 0, 3)}</button><button class="btn sm" data-decline="${esc(j.id)}">No thanks</button><span class="dim">${esc(j.estimate?.note || "")}</span></div>` : "";
  return `<div style="padding:8px 0;border-bottom:1px solid var(--line)" class="small">
      <div class="row"><span class="dot" style="background:${pcolor(j.provider)}"></span><b>${esc(pname(j.provider))}</b> · ${esc(j.kind)}${j.origin === "mission" ? ' <span class="dim">· mission step</span>' : ""} <span class="chip ${chip(j.status)}" style="margin-left:auto">${esc(STATUS[j.status] || j.status)}${j.progress ? " " + esc(String(j.progress)) : ""}</span></div>
      <div class="dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(j.params?.prompt || j.params?.text || "")}</div>
      <div class="row dim"><span>≈ ${money(j.estimate?.usd || 0, 3)}</span>${j.error ? `<span style="color:var(--red)">${esc(j.error)}</span>` : ""}${j.note ? `<span>${esc(j.note)}</span>` : ""}${files}</div>${ok}</div>`;
}
function wireJobs(root, after) {
  root.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/media/jobs/${b.dataset.approve}/approve`, { method: "POST", body: { estimate: Number(b.dataset.usd) } }); toast("Approved: generating"); after?.(); } catch (e) { toast(e.message, true); after?.(); } }));
  root.querySelectorAll("[data-decline]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/media/jobs/${b.dataset.decline}/decline`, { method: "POST", body: {} }); toast("Not made. Nothing was spent."); after?.(); } catch (e) { toast(e.message, true); } }));
  root.querySelectorAll("[data-view]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); const [id, i] = a.dataset.view.split(":"); try { window.open(await apiBlobUrl(`/media/file?id=${encodeURIComponent(id)}&i=${i}`), "_blank", "noopener"); } catch (er) { toast(er.message, true); } }));
  root.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); const [id, i] = a.dataset.open.split(":"); try { await api("/media/open", { method: "POST", body: { id, i: Number(i) } }); } catch (er) { toast(er.message, true); } }));
}

async function renderTab(view, prefill) {
  await loadProviders();
  let jobs = []; try { jobs = await api("/media/jobs"); } catch {}
  const waiting = jobs.filter((j) => j.status === "awaiting_ok");
  view.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 380px">${form(prefill || {})}
    <div class="panel" id="md-jobs"><h3>Jobs <span class="right">${waiting.length ? `${waiting.length} waiting for your OK · ` : ""}${jobs.length}</span></h3><div id="md-na"></div><div id="md-va"></div>${[...waiting, ...jobs.filter((j) => j.status !== "awaiting_ok")].slice(0, 30).map(jobRow).join("") || `<div class="dim small">No jobs yet. Try a dry run: it costs nothing.</div>`}</div></div>`;
  wireForm(view, () => renderTab(view));
  wireJobs(view, () => renderTab(view));
  mediaNextActions(view, jobs);
  if (S.flags?.videoeditor) { try { await import("/features/video-editor.js"); await window.CC.mountVideoEditor?.(view); } catch {} }
}

CC.register({
  id: "media",
  tab: { label: "Media", short: "Media", icon: "▶", order: 20, render: (v) => renderTab(v, CC._mediaPrefill), },
  deliverable: { order: 15, render: renderDeliverable },
  onEvent,
  settings: { order: 40, render: renderSettings },
});

async function renderDeliverable(el, run) {
    if (!run?.id) { el.innerHTML = ""; return; }
    const text = (run.deliverable || "").replace(/[#*>`]/g, "").trim().slice(0, 400);
    // Live Ops keeps tasks as an id map. A saved mission keeps them as a list.
    const rawTasks = run?.tasks;
    const tasks = Array.isArray(rawTasks) ? rawTasks : (rawTasks && typeof rawTasks === "object" ? Object.values(rawTasks) : []);
    const steps = tasks.filter((t) => t && t.media);
    let jobs = [];
    if (steps.length) { try { jobs = await api(`/media/jobs?missionId=${encodeURIComponent(run.id)}`); } catch {} }
    el.innerHTML = `${jobs.length ? `<div class="panel" style="margin-top:8px"><h3>Media from this mission <span class="right">estimate first · a paid file waits for your OK</span></h3>${jobs.map(jobRow).join("")}</div>` : ""}<div class="row small" style="margin-top:8px"><button class="btn sm" id="md-from">Make media from this</button><span class="dim">opens Media with the prompt pre-filled</span></div>`;
    wireJobs(el, () => renderDeliverable(el, run));
    el.querySelector("#md-from").addEventListener("click", () => { CC._mediaPrefill = { kind: "video", prompt: text }; go("media"); setTimeout(() => { CC._mediaPrefill = null; }, 1000); });
}
// Next actions (flag): under the newest finished job. Variations are three prompt tries to pick from; none runs by itself.
function mediaNextActions(view, jobs) {
  const job = jobs.find((j) => j.status === "done" && (j.params?.prompt || j.params?.text));
  const box = view.querySelector("#md-na");
  if (!job || !box) return;
  const text = job.params.prompt || job.params.text;
  if (S.flags?.finishpath) import("../finishpath-ui.js").then((m) => m.mountPair(box, { kind: "media", text, name: `${job.kind}: ${String(text).slice(0, 50)}`, onEdit: () => view.querySelector("#md-prompt")?.focus() })).catch(() => {});
  mountBar(box, {
    kind: "media", text, ref: job.id, name: `${job.kind}: ${String(text).slice(0, 50)}`,
    onVariations: async (t) => {
      try {
        const r = await api("/nextactions/variations", { method: "POST", body: { text: t } });
        const va = view.querySelector("#md-va");
        va.innerHTML = `<div class="small dim" style="margin-top:8px">Pick one to put in the prompt box. Nothing runs until you press Estimate and Generate.</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${r.prompts.map((p, i) => `<button type="button" class="btn sm" data-va="${i}" style="overflow-wrap:anywhere;white-space:normal;text-align:left;max-width:100%">Try ${i + 1}</button>`).join("")}</div>`;
        va.querySelectorAll("[data-va]").forEach((b) => b.addEventListener("click", () => {
          const ta = view.querySelector("#md-prompt");
          ta.value = r.prompts[Number(b.dataset.va)];
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.focus();
        }));
      } catch (e) { toast(e.message, true); }
    },
  });
}
let evTimer = null;
function onEvent(ev) {
    if (ev.type !== "media.job" || S.view !== "media") return;
    const view = document.querySelector("#view");
    if (view?.querySelector("#md-jobs") && !view.querySelector("#md-prompt:focus")) { clearTimeout(evTimer); evTimer = setTimeout(() => renderTab(view), 400); }
}
async function renderSettings(el) {
    await loadProviders();
    el.innerHTML = `<div class="panel"><h3>Media API keys <span class="right">Kling, ElevenLabs, Runway, fal.ai</span></h3>
      ${providers.map((p) => `<div class="row" style="margin-top:6px"><span style="width:110px"><span class="dot" style="background:${pcolor(p.id)}"></span> ${esc(p.name)}</span>${p.id === "kling" ? `<input type="password" placeholder="access key" data-mk="${p.id}" style="flex:1"><input type="password" placeholder="secret key" data-ms="${p.id}" style="flex:1">` : `<input type="password" placeholder="${p.keyed ? "key saved" : "API key"}" data-mk="${p.id}" style="flex:1">`}<button class="btn sm" data-save="${p.id}">Save</button><span class="chip ${p.keyed || p.connected ? "green" : ""}">${p.keyed ? "keyed" : p.connected ? "MCP" : "dry run"}</span></div>`).join("")}
      <div class="dim small" style="margin-top:8px">Keys are sealed in the same vault as the chat AIs. Without a key, generation runs as a dry run: the estimate is shown, nothing is spent, and a placeholder file is saved to the project.</div></div>`;
    el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => { const pid = b.dataset.save; const key = el.querySelector(`[data-mk="${pid}"]`).value.trim(); const secret = el.querySelector(`[data-ms="${pid}"]`)?.value.trim(); if (!key) return toast("Paste the key first", true); try { const r = await api("/media/keys", { method: "POST", body: { provider: pid, key, secret } }); toast(`${pname(pid)} key saved${r.balance?.usd != null ? ` · balance $${r.balance.usd}` : ""}`); renderSettings(el); } catch (e) { toast(e.message, true); } }));
}
