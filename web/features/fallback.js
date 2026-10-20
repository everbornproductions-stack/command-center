// Smart fallback (Phase 26).
// Command: which AIs are skipped right now and why (out of credits, rate limited, key rejected, unreachable, cap).
// Deliverable: "stood in" chips naming which model took over for which, and why.
// Settings > Smart fallback: on/off, OpenRouter-first retry, hops, free tiers with their allowance and use today.
const { S, api, toast, esc, money, pname, pcolor } = window.CC;

const css = `
.cc-fb-skip { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cc-fb-skip .chip b { font-weight: 600; }
.cc-fb-stand { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cc-fb-stand .chip .via { opacity: .7; }
#cc-fb-settings table { width: 100%; border-collapse: collapse; margin-top: 6px; }
#cc-fb-settings td { padding: 5px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
#cc-fb-settings input[type=number] { width: 72px; padding: 3px 5px; }
`;
const style = document.createElement("style"); style.id = "cc-fallback-style"; style.textContent = css; document.head.appendChild(style);

let data = null;
async function load() { data = await api("/fallback"); return data; }
const left = (ms) => (ms == null ? "until the cap resets" : ms >= 60000 ? `${Math.ceil(ms / 60000)} min left` : `${Math.ceil(ms / 1000)} s left`);
const KIND_LABEL = { credits: "out of credits", rate: "rate limited", key: "key rejected", unreachable: "unreachable", server: "provider error", cap: "cap reached" };

// ---------- Command: skipped providers ----------
async function renderCommand(el) {
  try { await load(); } catch { el.innerHTML = ""; return; }
  const d = data;
  if (!d.settings.on) { el.innerHTML = `<div class="dim small" style="margin-top:6px">Smart fallback is off: a job fails when its AI is out of credits. Turn it on in Settings.</div>`; return; }
  if (!d.skipped.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="route cc-fb-skip" style="margin-top:8px"><span class="small muted">Standing aside:</span>
    ${d.skipped.map((s) => `<span class="chip ${s.kind === "cap" ? "red" : "amber"}" title="${esc(s.detail || s.reason)}"><span class="dot" style="background:${pcolor(s.provider)}"></span> <b>${esc(s.providerName)}</b> ${esc(KIND_LABEL[s.kind] || s.kind)} · ${esc(left(s.leftMs))}</span>`).join("")}
    <span class="small muted">work goes to the next-best AI; each comes back on its own</span></div>`;
}

// ---------- Deliverable: who stood in ----------
function fallbacksOfLive() {
  const l = S.live; if (!l?.id) return [];
  if (l.kind === "council") return l.council?.fallbacks || [];
  return l.mission?.fallbacks || [];
}
function renderDeliverable(el) {
  const fb = fallbacksOfLive();
  if (!fb.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="cc-fb-stand"><span class="small muted" style="width:100%">Stood in · ${fb.length === 1 ? "one hand-off" : `${fb.length} hand-offs`}: the job went on when a provider could not take it</span>
    ${fb.map((f) => `<span class="chip" title="${esc(f.reason)}"><span class="dot" style="background:${pcolor(f.to.provider)}"></span> ${esc(f.to.name || pname(f.to.provider))}${f.via ? ` <span class="via">via OpenRouter</span>` : ""} for <span class="dot" style="background:${pcolor(f.from.provider)}"></span> ${esc(pname(f.from.provider))} · ${esc(KIND_LABEL[f.kind] || f.kind)}${f.taskId ? ` · ${esc(f.taskId)}` : ""}</span>`).join("")}</div>`;
}

// ---------- Settings ----------
async function renderSettings(el) {
  try { await load(); } catch (e) { el.innerHTML = `<div class="panel"><h3>Smart fallback</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const d = data, s = d.settings;
  el.innerHTML = `<div class="panel" id="cc-fb-settings"><h3>Smart fallback <span class="right">${d.standInsMonth} stand-in${d.standInsMonth === 1 ? "" : "s"} · ${d.freeMonth} free call${d.freeMonth === 1 ? "" : "s"} this month</span></h3>
    <div class="small muted" style="margin-bottom:8px">A job never fails because one AI is out of credits, rate limited, refusing its key or unreachable. That AI is skipped for new work, the same model is retried through OpenRouter when you have a key there, then the next-best model for the job takes over. The feed and the deliverable say who stood in and why. Every call is in the ledger and inside the spend caps.</div>
    <div class="row" style="gap:14px;flex-wrap:wrap">
      <label class="row small" style="gap:6px"><input type="checkbox" id="fb-on" ${s.on ? "checked" : ""}> Smart fallback on</label>
      <label class="row small" style="gap:6px"><input type="checkbox" id="fb-or" ${s.openrouterFirst ? "checked" : ""}> Retry the same model through OpenRouter first <span class="chip ${d.openrouter.keyed ? (d.openrouter.ready ? "green" : "amber") : ""}">${d.openrouter.keyed ? (d.openrouter.ready ? "key saved" : "key saved, skipped right now") : "no OpenRouter key"}</span></label>
      <label class="row small" style="gap:6px">Stand-ins per call <input type="number" id="fb-hops" min="1" max="6" value="${s.maxHops}"></label>
    </div>
    <div class="cat-h" style="margin-top:14px">Standing aside right now</div>
    ${d.skipped.length ? d.skipped.map((k) => `<div class="row small" style="gap:8px;padding:4px 0"><span class="dot" style="background:${pcolor(k.provider)}"></span><b style="width:110px">${esc(k.providerName)}</b><span class="chip ${k.kind === "cap" ? "red" : "amber"}">${esc(KIND_LABEL[k.kind] || k.kind)}</span><span class="dim">${esc(k.detail || "")}</span><span class="dim small" style="margin-left:auto">${esc(left(k.leftMs))}</span>${k.kind === "cap" ? `<span class="dim small">raise the cap in Spend caps</span>` : `<button class="ghost small" data-clear="${k.provider}">try again now</button>`}</div>`).join("") : `<div class="dim small">Nobody. Every AI with a key is taking work.</div>`}
    <div class="cat-h" style="margin-top:14px">Free tiers for small jobs</div>
    <div class="small muted">Short jobs (classifying, QA, titles, reviews) go to a free tier you have while its allowance lasts, and those calls are recorded at $0. The limits below are conservative list values from 2026-10-18; edit them to match your plan. A paid key with a tier ticked would under-count those small calls, so untick it in that case.</div>
    ${window.CC.geminiDataNotice ? `<div class="small" id="cc-gemini-notice" style="margin-top:6px">${esc(window.CC.geminiDataNotice)}</div>` : ""}
    <table>${d.freeTiers.map((t) => `<tr>
      <td><label class="row small" style="gap:6px"><input type="checkbox" data-free-on="${t.provider}" ${t.on ? "checked" : ""}><span class="dot" style="background:${pcolor(t.provider)}"></span><b>${esc(t.providerName)}</b></label></td>
      <td class="small"><span>${esc(t.name)}</span><div class="dim">${esc(t.models.join(", "))}</div></td>
      <td class="small nowrap"><input type="number" min="0" data-free-day="${t.provider}" value="${t.perDay}" title="list ${t.listPerDay}"> / day</td>
      <td class="small nowrap"><input type="number" min="0" data-free-min="${t.provider}" value="${t.perMinute}" title="list ${t.listPerMinute}"> / min</td>
      <td class="small dim">${t.keyed ? `${t.usedToday} today · ${t.usedMinute} this minute${t.on ? (t.eligibleNow ? ` · <span style="color:var(--green)">in use</span>` : ` · allowance used or skipped`) : ""}` : "no key"}</td>
    </tr><tr><td colspan="5" class="dim small" style="border-bottom:1px solid var(--line);padding-top:0">${esc(t.note)}</td></tr>`).join("")}</table>
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn sm primary" id="fb-save">Save</button><button class="btn sm" id="fb-clear-all" style="margin-left:auto">Put everyone back in the rotation</button></div>
    ${d.recent.length ? `<div class="cat-h" style="margin-top:14px">Recent stand-ins</div>${d.recent.slice(0, 8).map((r) => `<div class="row small" style="gap:8px;padding:3px 0"><span class="dim mono">${new Date(r.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="dot" style="background:${pcolor(r.provider)}"></span>${esc(pname(r.provider))} · ${esc(r.model)}${r.via ? ` <span class="chip">via OpenRouter</span>` : ""} for <span class="dot" style="background:${pcolor(r.from)}"></span>${esc(pname(r.from))} · ${esc(KIND_LABEL[r.kind] || r.kind)} <span class="dim" style="margin-left:auto">${r.role || ""} · ${money(r.cost, 4)}</span></div>`).join("")}` : ""}
  </div>`;
  const save = async () => {
    const freeTiers = {};
    el.querySelectorAll("[data-free-on]").forEach((cb) => { const pid = cb.dataset.freeOn; freeTiers[pid] = { on: cb.checked, perDay: Number(el.querySelector(`[data-free-day="${pid}"]`).value), perMinute: Number(el.querySelector(`[data-free-min="${pid}"]`).value) }; });
    try { data = await api("/fallback/settings", { method: "POST", body: { on: el.querySelector("#fb-on").checked, openrouterFirst: el.querySelector("#fb-or").checked, maxHops: Number(el.querySelector("#fb-hops").value) || 3, freeTiers } }); toast("Smart fallback settings saved"); renderSettings(el); }
    catch (e) { toast(e.message, true); }
  };
  el.querySelector("#fb-save").addEventListener("click", save);
  el.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", async () => { try { data = (await api("/fallback/clear", { method: "POST", body: { provider: b.dataset.clear } })).view; renderSettings(el); } catch (e) { toast(e.message, true); } }));
  el.querySelector("#fb-clear-all").addEventListener("click", async () => { try { const r = await api("/fallback/clear", { method: "POST", body: {} }); data = r.view; toast(r.cleared.length ? `${r.cleared.length} back in the rotation` : "Nobody was standing aside"); renderSettings(el); } catch (e) { toast(e.message, true); } });
}

CC.register({
  id: "fallback",
  command: { order: 17, render: renderCommand },
  deliverable: { order: 7, render: renderDeliverable },
  settings: { order: 10, render: renderSettings },
  onEvent(ev) {
    if (ev.type === "fallback.skip" || ev.type === "fallback.clear") { data = null; if (S.view === "command") { const box = document.querySelector('#cmd-extras [data-feature="fallback"]'); if (box) renderCommand(box); } }
  },
});
