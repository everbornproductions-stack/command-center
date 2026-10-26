// Publish plus on the Publish page (flag_publish, 0.4.19): caption and hashtag variations, a content
// calendar, and one-click website publish with preview and roll back. Nothing is posted or deployed from
// here without a click on a screen that shows exactly what will go out. Tokens go to the vault and are
// never shown again.
const CC = window.CC;

const STYLE = `
.pp-card{margin-bottom:12px;overflow-wrap:anywhere;word-break:break-word}
.pp-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.pp-tabs button[aria-pressed="true"]{outline:2px solid var(--violet)}
.pp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.pp-card textarea{width:100%;min-height:90px;box-sizing:border-box}
.pp-card input[type=text],.pp-card input[type=password],.pp-card select,.pp-card input[type=datetime-local]{max-width:100%;box-sizing:border-box}
.pp-item{border-top:1px solid var(--line);padding:8px 0}
.pp-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:4px 0}
.pp-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;margin:8px 0}
.pp-day{min-height:46px;border:1px solid var(--line);border-radius:6px;padding:2px 3px;font-size:11px;overflow:hidden;overflow-wrap:anywhere}
.pp-day b{display:block}
.pp-dot{display:block;margin-top:2px;padding:0 3px;border-radius:4px;background:var(--panel2,rgba(127,127,127,.18));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-dot.ok{background:rgba(40,160,90,.28)}
.pp-box{border-left:3px solid var(--violet);padding:6px 10px;margin:8px 0;overflow-wrap:anywhere}
.pp-frame{width:100%;height:240px;border:1px solid var(--line);border-radius:6px;background:#fff}
.pp-files{max-height:120px;overflow:auto;margin:4px 0}
`;
function ensureStyle() {
  if (document.getElementById("pp-style")) return;
  const s = document.createElement("style");
  s.id = "pp-style"; s.textContent = STYLE;
  document.head.appendChild(s);
}

const CH = { instagram: "Instagram", ghl: "HighLevel", slack: "Slack" };
const VERB = { instagram: "post", ghl: "schedule", slack: "send" };
const fmt = (t) => (t ? new Date(t).toLocaleString() : "no time set");
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const localInput = (t) => { if (!t) return ""; const d = new Date(t), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

export function mountPublishPlus(view) {
  if (!view || !CC.S?.flags?.publish) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  view.querySelector(":scope > .pp-card")?.remove();
  const card = document.createElement("div");
  card.className = "panel pp-card";
  card.setAttribute("aria-label", "Plan and publish");
  view.prepend(card);
  const st = { tab: "captions", month: new Date(), editing: null, accounts: null, rooms: null, vars: null, plan: null, rb: null, status: null, items: [], hist: [], drafts: [], text: "", platform: "instagram" };

  const shell = () => `<h3>Plan and publish <span class="right">every post and every site change needs your click</span></h3>
    <div class="pp-tabs" role="tablist">${[["captions", "Captions"], ["calendar", "Calendar"], ["website", "Website"]].map(([k, l]) => `<button type="button" class="btn sm" role="tab" data-pp-tab="${k}" aria-pressed="${st.tab === k}">${l}</button>`).join("")}</div>
    <div id="pp-body"></div>`;

  // ---------- captions ----------
  async function paintCaptions(body) {
    const plats = st.status?.platforms || [];
    body.innerHTML = `<label class="lbl" for="pp-cap">Your caption or idea</label><textarea id="pp-cap" placeholder="Write it once. Get short, long and question versions with hashtags.">${esc(st.text)}</textarea>
      <div class="pp-row"><select id="pp-plat" aria-label="Platform">${plats.map((p) => `<option value="${esc(p.id)}"${p.id === st.platform ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button type="button" class="btn sm primary" data-pp="vars">Make versions</button><span class="small dim">Made on this computer. Nothing is sent.</span></div>
      <div id="pp-vars"></div>`;
    paintVars(body.querySelector("#pp-vars"));
  }
  function paintVars(el) {
    const v = st.vars;
    if (!v) { el.innerHTML = ""; return; }
    if (!v.variations.length) { el.innerHTML = `<div class="dim small">${esc(v.note || "Nothing to show yet.")}</div>`; return; }
    const canPlan = !!CH[v.platform];
    el.innerHTML = `<div class="dim small">${esc(v.platformName)} allows ${v.limit} characters${v.maxTags ? ` and up to ${v.maxTags} hashtags` : ""}. Good times to post: ${esc((v.times || []).join(", "))}.</div>` +
      v.variations.map((x, i) => `<div class="pp-item"><div class="row small"><b>${esc(x.label)}</b><span class="chip ${x.fits ? "green" : "amber"}">${x.chars} of ${v.limit}</span><span class="chip">${x.tags} hashtag${x.tags === 1 ? "" : "s"}</span></div>
        <div class="pp-text">${esc(x.text)}</div><div class="pp-row"><button type="button" class="btn sm" data-pp="copy" data-i="${i}">Copy</button><button type="button" class="btn sm" data-pp="tocal" data-i="${i}">${canPlan ? "Add to calendar" : "Add to calendar (pick a service)"}</button></div></div>`).join("");
  }

  // ---------- calendar ----------
  const draftForm = () => {
    const e = st.editing || {};
    const ch = e.channel || (CH[st.platform] ? st.platform : "instagram");
    return `<div class="pp-box"><b>${e.id ? "Change this post" : "New calendar post"}</b>
      <div class="pp-row"><select id="pp-ch" aria-label="Where it goes">${Object.entries(CH).map(([k, n]) => `<option value="${k}"${k === ch ? " selected" : ""}>${n}</option>`).join("")}</select><input type="text" id="pp-title" placeholder="Title" value="${esc(e.title || "")}" style="flex:1;min-width:140px"></div>
      <textarea id="pp-text" aria-label="Post text">${esc(e.text ?? st.text)}</textarea>
      <input type="text" id="pp-media" placeholder="Public https link to the picture or video (optional)" value="${esc(e.mediaUrl || "")}" style="width:100%">
      <div class="pp-row"><label class="small" for="pp-when" id="pp-when-l">${ch === "ghl" ? "Send at (HighLevel holds it until then)" : "Planned for (a reminder; it posts only when you click Send)"}</label><input type="datetime-local" id="pp-when" value="${esc(localInput(e.when))}"></div>
      <div id="pp-extra"></div>
      <div class="pp-row"><button type="button" class="btn sm primary" data-pp="save">${e.id ? "Save changes" : "Add to calendar"}</button>${e.id ? `<button type="button" class="ghost small" data-pp="cancel">Cancel</button>` : ""}<span class="small dim">Saving does not post. ${e.id ? "Changing a post removes its approval." : ""}</span></div></div>`;
  };
  async function paintExtra(body) {
    const el = body.querySelector("#pp-extra"); if (!el) return;
    const ch = body.querySelector("#pp-ch").value, e = st.editing || {};
    if (ch === "ghl") {
      if (!st.accounts) { try { st.accounts = await api("/publish/ghl-accounts"); } catch { st.accounts = []; } }
      el.innerHTML = `<div class="small">Accounts</div>${st.accounts.length ? st.accounts.map((a) => `<label class="row small" style="gap:6px"><input type="checkbox" data-pp-acc="${esc(a.id)}"${(e.accountIds || st.accounts.map((x) => x.id)).includes(a.id) ? " checked" : ""}> ${esc(a.name)} <span class="dim">${esc(a.platform || "")}</span></label>`).join("") : `<span class="dim small">No connected accounts found (or HighLevel is not connected yet).</span>`}`;
    } else if (ch === "slack") {
      if (!st.rooms) { try { st.rooms = await api("/publish/slack-channels"); } catch { st.rooms = []; } }
      el.innerHTML = st.rooms.length ? `<label class="small" for="pp-room">Channel</label> <select id="pp-room">${st.rooms.map((c) => `<option value="${esc(c.id)}" data-name="${esc(c.name)}"${e.channelId === c.id ? " selected" : ""}>#${esc(c.name)}</option>`).join("")}</select>` : `<span class="dim small">No channels found (or Slack is not connected yet).</span>`;
    } else el.innerHTML = "";
  }
  const readForm = (body) => {
    const ch = body.querySelector("#pp-ch").value, room = body.querySelector("#pp-room");
    const when = body.querySelector("#pp-when").value;
    return { channel: ch, title: body.querySelector("#pp-title").value.trim() || "Post", text: body.querySelector("#pp-text").value, mediaUrl: body.querySelector("#pp-media").value.trim() || null, when: when ? new Date(when).getTime() : null, accountIds: [...body.querySelectorAll("[data-pp-acc]:checked")].map((c) => c.dataset.ppAcc), channelId: room?.value || null, channelName: room?.selectedOptions[0]?.dataset.name || null, projectId: CC.S.project || null };
  };
  function itemHtml(it) {
    const chip = it.status === "sent" ? "green" : it.approved ? "green" : it.status === "failed" ? "red" : "amber";
    const label = it.status === "sent" ? "sent" : it.status === "dry-run" ? "tried, not connected" : it.status === "failed" ? "failed" : it.approved ? "approved" : "needs your approval";
    return `<div class="pp-item" data-id="${esc(it.id)}"><div class="row small"><b>${esc(CH[it.channel] || it.channel)}</b><span class="chip ${chip}">${label}</span><span class="dim" style="margin-left:auto">${esc(fmt(it.when))}</span></div>
      <div class="small"><b>${esc(it.title || "")}</b></div><div class="pp-text">${esc(it.text)}</div>${it.mediaUrl ? `<div class="small dim">Picture/video: ${esc(it.mediaUrl)}</div>` : ""}${it.error ? `<div class="small" style="color:var(--red)">${esc(it.error)}</div>` : ""}
      <div class="pp-row">${it.status === "sent" ? "" : `<button type="button" class="btn sm" data-pp="edit" data-id="${esc(it.id)}">Change</button>${it.approved ? `<button type="button" class="ghost small" data-pp="revoke" data-id="${esc(it.id)}">Take back approval</button><button type="button" class="btn sm primary" data-pp="send" data-id="${esc(it.id)}">${it.channel === "ghl" && it.when ? "Preview and schedule" : "Preview and post"}</button>` : `<button type="button" class="btn sm primary" data-pp="ask" data-id="${esc(it.id)}">Review and approve</button>`}<button type="button" class="ghost small" data-pp="del" data-id="${esc(it.id)}">Delete</button>`}</div><div class="pp-ask" data-slot="${esc(it.id)}"></div></div>`;
  }
  function monthGrid() {
    const m = st.month, y = m.getFullYear(), mo = m.getMonth(), first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
    const by = {};
    for (const it of st.items) if (it.when) (by[dayKey(it.when)] ||= []).push(it);
    let cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="small dim" style="text-align:center">${d}</div>`).join("");
    for (let i = 0; i < first.getDay(); i++) cells += `<div></div>`;
    for (let d = 1; d <= days; d++) cells += `<div class="pp-day"><b>${d}</b>${(by[`${y}-${mo}-${d}`] || []).slice(0, 3).map((it) => `<span class="pp-dot ${it.approved || it.status === "sent" ? "ok" : ""}">${esc(CH[it.channel] || "")}: ${esc((it.title || it.text).slice(0, 18))}</span>`).join("")}</div>`;
    return `<div class="pp-row"><button type="button" class="ghost small" data-pp="prev">Back</button><b>${m.toLocaleString(undefined, { month: "long", year: "numeric" })}</b><button type="button" class="ghost small" data-pp="next">Next</button></div><div class="pp-grid" role="grid">${cells}</div>`;
  }
  async function paintCalendar(body) {
    try { st.items = (await api("/publishplus/calendar")).items; } catch (e) { body.innerHTML = `<div class="dim">${esc(e.message)}</div>`; return; }
    body.innerHTML = `<div class="small dim">Plan posts here. A post goes out only after you approve its exact words, then preview it, then click again.</div>${monthGrid()}${draftForm()}<div id="pp-list">${st.items.map(itemHtml).join("") || `<div class="dim small">Nothing planned yet.</div>`}</div><div id="pp-send"></div>`;
    paintExtra(body);
  }

  // ---------- website ----------
  async function paintWebsite(body) {
    try { [st.drafts, st.hist] = [(await api("/publishplus/sites/drafts")).items, (await api("/publishplus/sites/history")).items]; st.status = await api("/publishplus/status"); } catch (e) { body.innerHTML = `<div class="dim">${esc(e.message)}</div>`; return; }
    const t = st.status.targets;
    body.innerHTML = `<div class="small dim">Publish a site you built in the Websites tab. You see the files and a preview first. A preview copy never changes your live site.</div>
      <div class="pp-row"><select id="pp-draft" aria-label="Website">${st.drafts.length ? st.drafts.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (${d.files} files)</option>`).join("") : `<option value="">No built websites yet (Websites tab)</option>`}</select><select id="pp-host" aria-label="Host">${t.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.connected ? "" : " (not connected)"}</option>`).join("")}</select></div>
      <div id="pp-host-set"></div>
      <div class="pp-row"><button type="button" class="btn sm" data-pp="plan-prev">See the preview plan</button><button type="button" class="btn sm" data-pp="plan-live">See the live plan</button></div>
      <div id="pp-plan" aria-live="polite"></div>
      <h4 style="margin:12px 0 4px">Past publishes</h4>${st.hist.map(histHtml).join("") || `<div class="dim small">Nothing published yet.</div>`}<div id="pp-rb"></div>`;
    paintHost(body);
  }
  function paintHost(body) {
    const el = body.querySelector("#pp-host-set"); if (!el) return;
    const t = st.status.targets.find((x) => x.id === body.querySelector("#pp-host").value);
    el.innerHTML = `<div class="pp-box"><div class="row small"><b>${esc(t.name)}</b><span class="chip ${t.connected ? "green" : ""}">${t.connected ? "token saved" : "not connected"}</span></div>
      <div class="pp-row">${t.fields.map((f) => `<input type="text" data-pp-cfg="${esc(f.id)}" placeholder="${esc(f.label)}" aria-label="${esc(f.label)}" value="${esc(f.value)}" style="flex:1;min-width:140px">`).join("")}<button type="button" class="btn sm" data-pp="cfg">Save names</button></div>
      <div class="pp-row"><input type="password" id="pp-tok" placeholder="${t.connected ? "Token saved (type to replace)" : "Paste an API token"}" aria-label="Token" autocomplete="off" style="flex:1;min-width:160px"><button type="button" class="btn sm" data-pp="tok">Save token</button>${t.connected ? `<button type="button" class="ghost small" data-pp="tok-off">Remove token</button>` : ""}</div>
      <div class="small dim">The token goes into the vault on this computer and is never shown again. Saving it deploys nothing.</div></div>`;
  }
  async function refreshHost(body) { st.status = await api("/publishplus/status"); paintHost(body); }
  function histHtml(x) {
    const chip = x.status === "deployed" || x.status === "rolled-back" ? "green" : x.status === "failed" ? "red" : "amber";
    return `<div class="pp-item"><div class="row small"><b>${esc(x.targetName || x.target)}</b><span class="chip ${chip}">${esc(x.status)}</span>${x.production ? `<span class="chip ${x.live ? "green" : ""}">${x.live ? "live now" : "live deploy"}</span>` : x.status === "rolled-back" ? "" : `<span class="chip">preview</span>`}<span class="dim" style="margin-left:auto">${esc(fmt(x.ts))}</span></div>
      <div class="small dim">${esc(x.name || "")}${x.count ? `, ${x.count} files` : ""}${x.url && /^https:\/\//.test(x.url) ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a>` : ""}</div>${x.error ? `<div class="small" style="color:var(--red)">${esc(x.error)}</div>` : ""}${x.note ? `<div class="small dim">${esc(x.note)}</div>` : ""}
      ${x.canRollBack ? `<div class="pp-row"><button type="button" class="btn sm" data-pp="rb" data-id="${esc(x.id)}">Make this the live site again</button></div>` : ""}</div>`;
  }
  async function plan(body, production) {
    const out = body.querySelector("#pp-plan");
    try {
      const p = st.plan = await api("/publishplus/sites/plan", { method: "POST", body: { draftId: body.querySelector("#pp-draft").value, target: body.querySelector("#pp-host").value, production } });
      out.innerHTML = `<div class="pp-box"><b>${esc(p.mode)}</b>: ${esc(p.summary)}
        ${p.problems.length ? `<div style="color:var(--amber)">${p.problems.map(esc).join(" ")}</div>` : ""}
        <div class="small dim">${p.count} file${p.count === 1 ? "" : "s"}, ${Math.max(1, Math.round(p.bytes / 1024))} KB. Plan code ${esc(p.hash)}.</div>
        <details><summary class="small" style="cursor:pointer">Files that will be sent</summary><div class="pp-files small">${p.files.map((f) => `<div>${esc(f.path)} <span class="dim">${f.bytes} bytes</span></div>`).join("")}</div></details>
        ${p.previewHtml ? `<div class="small dim">How the home page looks (scripts are switched off in this preview):</div><iframe class="pp-frame" sandbox="" title="Site preview" srcdoc="${esc(p.previewHtml)}"></iframe>` : ""}
        <div class="pp-row">${p.dryRun ? `<span class="chip amber">not connected: this records a dry run and sends nothing</span>` : ""}<button type="button" class="btn sm primary" data-pp="deploy" ${p.problems.length && !p.dryRun ? "disabled" : ""}>${production ? "Yes, publish the live site now" : "Send the preview copy"}</button></div></div>`;
    } catch (e) { out.innerHTML = `<div style="color:var(--red)">${esc(e.message)}</div>`; }
  }

  // ---------- one body painter ----------
  async function paint() {
    const body = card.querySelector("#pp-body");
    card.querySelectorAll("[data-pp-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ppTab === st.tab)));
    if (!st.status) { try { st.status = await api("/publishplus/status"); } catch (e) { body.innerHTML = `<div class="dim">${esc(e.message)}</div>`; return; } }
    if (st.tab === "captions") await paintCaptions(body); else if (st.tab === "calendar") await paintCalendar(body); else await paintWebsite(body);
  }

  async function sendFlow(id) {
    const it = st.items.find((x) => x.id === id), slot = card.querySelector("#pp-send");
    try {
      const pl = it.payload;
      const pv = await api("/publish/preview", { method: "POST", body: { channel: it.channel, title: pl.title, text: pl.text, mediaUrl: pl.mediaUrl || undefined, mediaType: /\.(mp4|mov|webm)(\?|$)/i.test(pl.mediaUrl || "") ? "video" : "image", when: pl.when || undefined, accountIds: pl.accountIds, channelId: pl.channelId || undefined, channelName: it.channelName || undefined, projectId: it.projectId || undefined } });
      slot.innerHTML = `<div class="pp-box"><b>This is exactly what will go out</b>
        <div class="small">${esc(pv.summary)}</div><div class="pp-text">${esc(pl.text)}</div>${pl.mediaUrl ? `<div class="small dim">Picture/video: ${esc(pl.mediaUrl)}</div>` : ""}
        ${pv.problems.length ? `<div style="color:var(--amber)">${pv.problems.map(esc).join(" · ")}</div>` : ""}${pv.dryRun ? `<div><span class="chip amber">not connected: this records a dry run and sends nothing</span></div>` : ""}
        <div class="pp-row"><button type="button" class="btn sm primary" data-pp="go" data-id="${esc(id)}" data-pv="${esc(pv.previewId)}" data-ch="${esc(it.channel)}" ${pv.problems.length && !pv.dryRun ? "disabled" : ""}>Confirm and ${VERB[it.channel]}</button><button type="button" class="ghost small" data-pp="close-send">Not now</button></div></div>`;
      slot.scrollIntoView?.({ block: "nearest" });
    } catch (e) { toast(e.message, true); }
  }

  card.addEventListener("click", async (ev) => {
    const tab = ev.target.closest("[data-pp-tab]");
    if (tab) { st.tab = tab.dataset.ppTab; st.editing = null; return paint(); }
    const b = ev.target.closest("[data-pp]");
    if (!b) return;
    const a = b.dataset.pp, body = card.querySelector("#pp-body");
    try {
      if (a === "vars") {
        st.text = body.querySelector("#pp-cap").value; st.platform = body.querySelector("#pp-plat").value;
        st.vars = await api("/publishplus/variations", { method: "POST", body: { text: st.text, platform: st.platform } });
        return paintVars(body.querySelector("#pp-vars"));
      }
      if (a === "copy") { const v = st.vars.variations[Number(b.dataset.i)]; try { await navigator.clipboard.writeText(v.text); toast("Copied"); } catch { toast("Could not copy. Select the text and copy it.", true); } return; }
      if (a === "tocal") { const v = st.vars.variations[Number(b.dataset.i)]; st.text = v.text; st.editing = { text: v.text, channel: CH[st.vars.platform] ? st.vars.platform : "instagram" }; st.tab = "calendar"; return paint(); }
      if (a === "save") {
        const f = readForm(body);
        if (st.editing?.id) await api(`/publishplus/calendar/${encodeURIComponent(st.editing.id)}`, { method: "PUT", body: f });
        else await api("/publishplus/calendar", { method: "POST", body: f });
        st.editing = null; toast("Saved to the calendar. Nothing was posted."); return paint();
      }
      if (a === "cancel") { st.editing = null; return paint(); }
      if (a === "edit") { st.editing = st.items.find((x) => x.id === b.dataset.id); return paint(); }
      if (a === "del") { if (!confirm("Remove this from the calendar?")) return; await api(`/publishplus/calendar/${encodeURIComponent(b.dataset.id)}`, { method: "DELETE" }); return paint(); }
      if (a === "prev" || a === "next") { st.month = new Date(st.month.getFullYear(), st.month.getMonth() + (a === "next" ? 1 : -1), 1); return paint(); }
      if (a === "ask") {
        const it = st.items.find((x) => x.id === b.dataset.id), slot = card.querySelector(`[data-slot="${CSS.escape(it.id)}"]`);
        slot.innerHTML = `<div class="pp-box"><b>Approve this exact post?</b><div class="small">${esc(CH[it.channel])} · ${esc(fmt(it.payload.when))}${it.payload.accountIds.length ? ` · ${it.payload.accountIds.length} account${it.payload.accountIds.length === 1 ? "" : "s"}` : ""}</div><div class="pp-text">${esc(it.payload.text)}</div>${it.payload.mediaUrl ? `<div class="small dim">Picture/video: ${esc(it.payload.mediaUrl)}</div>` : ""}<div class="small dim">Approving posts nothing. If you change anything later, the approval is removed.</div><div class="pp-row"><button type="button" class="btn sm primary" data-pp="approve" data-id="${esc(it.id)}" data-hash="${esc(it.hash)}">Approve this post</button><button type="button" class="ghost small" data-pp="cancel">Not now</button></div></div>`;
        return;
      }
      if (a === "approve") { await api(`/publishplus/calendar/${encodeURIComponent(b.dataset.id)}/approve`, { method: "POST", body: { hash: b.dataset.hash, confirmed: true } }); toast("Approved. It has not been posted."); return paint(); }
      if (a === "revoke") { await api(`/publishplus/calendar/${encodeURIComponent(b.dataset.id)}/revoke`, { method: "POST", body: {} }); return paint(); }
      if (a === "send") return sendFlow(b.dataset.id);
      if (a === "close-send") { card.querySelector("#pp-send").innerHTML = ""; return; }
      if (a === "go") {
        b.disabled = true;
        const r = await api("/publish/post", { method: "POST", body: { channel: b.dataset.ch, previewId: b.dataset.pv, confirmed: true, calendarId: b.dataset.id } });
        toast(r.status === "posted" ? `Done: ${r.result?.url || "sent"}` : r.status === "dry-run" ? "Recorded as a dry run (not connected)" : `Failed: ${r.error}`, r.status === "failed");
        return paint();
      }
      // website
      if (a === "cfg") { const vals = {}; body.querySelectorAll("[data-pp-cfg]").forEach((i) => { vals[i.dataset.ppCfg] = i.value; }); await api("/publishplus/sites/config", { method: "POST", body: { target: body.querySelector("#pp-host").value, ...vals } }); toast("Saved"); return refreshHost(body); }
      if (a === "tok") { const i = body.querySelector("#pp-tok"); if (!i.value.trim()) return toast("Paste the token first", true); await api("/publishplus/sites/connect", { method: "POST", body: { target: body.querySelector("#pp-host").value, token: i.value.trim() } }); i.value = ""; toast("Token saved in the vault. Nothing was deployed."); return refreshHost(body); }
      if (a === "tok-off") { if (!confirm("Remove the saved token?")) return; await api(`/publishplus/sites/connect/${encodeURIComponent(body.querySelector("#pp-host").value)}`, { method: "DELETE" }); return refreshHost(body); }
      if (a === "plan-prev") return plan(body, false);
      if (a === "plan-live") return plan(body, true);
      if (a === "deploy") {
        const p = st.plan; b.disabled = true;
        const r = await api("/publishplus/sites/deploy", { method: "POST", body: { draftId: body.querySelector("#pp-draft").value, target: p.target, production: p.production, hash: p.hash, confirmed: true } });
        toast(r.status === "deployed" ? `Done: ${r.url || "sent"}` : r.status === "dry-run" ? "Recorded as a dry run (not connected)" : `Failed: ${r.error}`, r.status === "failed");
        return paint();
      }
      if (a === "rb") {
        const p = st.rb = await api("/publishplus/sites/rollback-plan", { method: "POST", body: { historyId: b.dataset.id } });
        card.querySelector("#pp-rb").innerHTML = `<div class="pp-box"><b>Go back to an older live site?</b><div class="small">${esc(p.summary)}</div>${p.dryRun ? `<div class="chip amber">${esc(p.targetName)} is not connected, so this cannot run</div>` : ""}<div class="pp-row"><button type="button" class="btn sm primary" data-pp="rb-go" ${p.dryRun ? "disabled" : ""}>Yes, go back to it</button><button type="button" class="ghost small" data-pp="rb-no">Not now</button></div></div>`;
        return;
      }
      if (a === "rb-no") { card.querySelector("#pp-rb").innerHTML = ""; return; }
      if (a === "rb-go") { b.disabled = true; await api("/publishplus/sites/rollback", { method: "POST", body: { historyId: st.rb.historyId, confirmed: true } }); toast("The live site went back to the older version."); return paint(); }
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
  card.addEventListener("change", (ev) => {
    const body = card.querySelector("#pp-body");
    if (ev.target.id === "pp-ch") { const l = body.querySelector("#pp-when-l"); if (l) l.textContent = ev.target.value === "ghl" ? "Send at (HighLevel holds it until then)" : "Planned for (a reminder; it posts only when you click Send)"; paintExtra(body); }
    if (ev.target.id === "pp-host") { paintHost(body); body.querySelector("#pp-plan").innerHTML = ""; }
  });

  card.innerHTML = shell();
  paint();
}

CC.mountPublishPlus = mountPublishPlus;
CC.register({ id: "publish-plus" });
