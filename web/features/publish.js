// Publishing: buttons under the deliverable (Instagram, HighLevel, Slack, Google Drive), each with a
// preview + confirm; Connect (OAuth), pasted tokens and the Drive folder in Settings; history in a Publish tab.
import { plainExplain, plainLabel } from "../plain.js";
const { S, api, toast, esc } = window.CC;

function stripMd(t) { return (t || "").replace(/```[\s\S]*?```/g, "").replace(/[#*>`_]/g, "").replace(/\n{3,}/g, "\n\n").trim(); }

// Finished media jobs that can be attached (doc media.jobs from the Media tab).
async function mediaJobs() {
  try { const r = await api("/media/jobs"); return (Array.isArray(r) ? r : r.items || []).filter((j) => j.status === "done" && j.outputs?.length).slice(0, 30); } catch { return []; }
}
const jobLabel = (j) => `${j.kind} · ${j.provider} · ${String(j.params?.prompt || j.params?.text || "").slice(0, 50)}`;
const TITLE = { instagram: "Post to Instagram", ghl: "Schedule in HighLevel", slack: "Send to Slack", drive: "Save to Drive" };
const VERB = { instagram: "post", ghl: "schedule", slack: "send", drive: "save" };

async function openPreview(el, channel, run) {
  const title = run.mission?.title || run.council?.prompt?.slice(0, 80) || "Deliverable";
  const text = stripMd(run.deliverable || "").slice(0, 2200);
  let accounts = []; if (channel === "ghl") { try { accounts = await api("/publish/ghl-accounts"); } catch {} }
  let rooms = []; if (channel === "slack") { try { rooms = await api("/publish/slack-channels"); } catch (e) { toast(e.message, true); } }
  const jobs = await mediaJobs();
  const box = el.querySelector("#pb-preview");
  box.innerHTML = `<div class="route" style="margin-top:8px;border-left:3px solid var(--violet)">
    <div class="row"><b>${TITLE[channel]}</b><button class="ghost small" id="pb-close" style="margin-left:auto">close</button></div>
    ${channel === "drive" ? `<label class="lbl">Title</label><input type="text" id="pb-title" value="${esc(title)}">` : `${channel === "slack" ? `<label class="lbl">Title</label><input type="text" id="pb-title" value="${esc(title)}">` : ""}<label class="lbl">${channel === "slack" ? "Message" : "Caption"}</label><textarea id="pb-text" style="min-height:90px">${esc(text.slice(0, channel === "instagram" ? 2200 : 2000))}</textarea>
    <label class="lbl">Media URL (public https${channel === "slack" ? ", optional" : "; images or mp4"})</label><input type="text" id="pb-media" placeholder="https://...">`}
    <label class="lbl">Attach a media job</label><select id="pb-job"><option value="">${jobs.length ? "none" : "no finished media jobs yet (Media tab)"}</option>${jobs.map((j) => `<option value="${esc(j.id)}">${esc(jobLabel(j))}</option>`).join("")}</select>
    ${channel === "ghl" ? `<label class="lbl">Accounts</label><div>${accounts.length ? accounts.map((a) => `<label class="row small" style="gap:6px"><input type="checkbox" data-acc="${esc(a.id)}" checked> ${esc(a.name)} <span class="dim">${esc(a.platform || "")}</span></label>`).join("") : `<span class="dim small">No connected accounts found (or HighLevel is not connected yet).</span>`}</div><label class="lbl">When (blank = now)</label><input type="datetime-local" id="pb-when">` : ""}
    ${channel === "slack" ? `<label class="lbl">Channel</label>${rooms.length ? `<select id="pb-room">${rooms.map((c) => `<option value="${esc(c.id)}" data-name="${esc(c.name)}">#${esc(c.name)}${c.member ? "" : " (invite the app first)"}</option>`).join("")}</select>` : `<span class="dim small">No channels found (or Slack is not connected yet).</span>`}` : ""}
    <div class="row" style="margin-top:10px"><button class="btn sm" id="pb-prev">Preview</button>${channel === "drive" ? "" : `<button class="btn sm" id="pb-personas" title="See how real people would react to this post, then fix it in one click">Test with personas</button>`}<span class="small" id="pb-out">Preview first. The confirm button ${VERB[channel]}s exactly what the preview shows.</span><button class="btn sm primary" id="pb-go" style="margin-left:auto" disabled title="Preview first">Confirm &amp; ${VERB[channel]}</button></div></div>`;
  let previewId = null;
  const go = box.querySelector("#pb-go"), out = box.querySelector("#pb-out");
  const room = () => box.querySelector("#pb-room");
  const payload = () => ({ channel, title: box.querySelector("#pb-title")?.value || title, text: box.querySelector("#pb-text")?.value ?? text, mediaUrl: box.querySelector("#pb-media")?.value.trim() || undefined, mediaType: /\.(mp4|mov|webm)(\?|$)/i.test(box.querySelector("#pb-media")?.value || "") ? "video" : "image", mediaJobId: box.querySelector("#pb-job")?.value || undefined, when: box.querySelector("#pb-when")?.value ? new Date(box.querySelector("#pb-when").value).getTime() : null, accountIds: [...box.querySelectorAll("[data-acc]:checked")].map((c) => c.dataset.acc), channelId: room()?.value || undefined, channelName: room()?.selectedOptions[0]?.dataset.name || undefined, projectId: run.mission?.projectId || run.council?.projectId || S.project || null, missionId: run.id });
  // any edit after a preview makes it stale: the post must match what was shown
  const stale = () => { if (!previewId) return; previewId = null; go.disabled = true; out.innerHTML = `<span class="dim">Changed since the preview. Preview again.</span>`; };
  box.querySelectorAll("input, textarea, select").forEach((i) => { i.addEventListener("input", stale); i.addEventListener("change", stale); });
  box.querySelector("#pb-close").addEventListener("click", () => { box.innerHTML = ""; });
  // Test with personas: a revised caption goes back in the box (and the preview has to run again)
  box.querySelector("#pb-personas")?.addEventListener("click", () => {
    const t = box.querySelector("#pb-text");
    window.CC.testWithPersonas?.({ text: t?.value || text, kind: "post", onUse: (next) => { if (!t) return; t.value = next; t.dispatchEvent(new Event("input")); } });
  });
  box.querySelector("#pb-prev").addEventListener("click", async () => {
    try {
      const r = await api("/publish/preview", { method: "POST", body: payload() });
      previewId = r.previewId;
      out.innerHTML = `${esc(r.summary)}${r.media ? ` <span class="chip">media ${esc(r.media.kind)}${r.media.files ? ` · ${r.media.files} file${r.media.files === 1 ? "" : "s"}` : ""}</span>` : ""}${r.problems.length ? `<div style="color:var(--amber)">${r.problems.map(esc).join(" · ")}</div>` : ""}${r.dryRun ? ' <span class="chip amber">not connected · practice only, nothing is sent</span>' : ' <span class="chip green">ready</span>'}`;
      go.disabled = r.problems.length > 0 && !r.dryRun; go.title = go.disabled ? "Fix the problems above, then preview again" : "";
    } catch (e) { previewId = null; go.disabled = true; toast(e.message, true); }
  });
  go.addEventListener("click", async () => {
    if (!previewId) return toast("Preview first", true);
    go.disabled = true;
    try { const r = await api("/publish/post", { method: "POST", body: { channel, previewId, confirmed: true } }); toast(r.status === "posted" ? `Done: ${r.result?.url || "sent"}` : r.status === "dry-run" ? "Practice run recorded. Nothing was sent (not connected)." : `Failed: ${r.error}`, r.status === "failed"); box.innerHTML = ""; }
    catch (e) { previewId = null; toast(e.message, true); out.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
  });
}

// ---------- Settings: one row per OAuth connector ----------
function connectorRow(c) {
  return `<div style="padding:8px 0;border-top:1px solid var(--line)" data-con="${esc(c.id)}">
    <div class="row small"><b>${esc(c.name)}</b>${c.connected ? `<span class="chip green">connected${c.account ? ` · ${esc(c.account)}` : ""}</span>` : c.needsSignIn ? `<span class="chip amber">sign in again</span>` : c.viaPaste ? `<span class="chip">pasted token</span>` : `<span class="chip">not connected</span>`}<a class="small" href="${esc(c.consoleUrl)}" target="_blank" rel="noopener" style="margin-left:auto">developer console</a></div>
    <div class="dim small">Asks only to: ${esc(c.scopeLabel)}. ${esc(c.setup)}</div>
    <div class="row" style="margin-top:4px;gap:6px"><input type="text" data-f="cid" placeholder="${c.sharedClient ? "using the browser helper's Google client" : "Client ID"}" value="${esc(c.clientId || "")}" style="flex:1"><input type="password" data-f="csec" placeholder="${c.clientSecretSaved ? "client secret saved (type to replace)" : "Client secret"}" style="flex:1">
      <button class="btn sm" data-a="connect">${c.connected ? "Connect again" : "Connect"}</button>${c.connected || c.viaPaste ? `<button class="ghost small" data-a="off">Disconnect</button>` : ""}</div></div>`;
}

async function renderSettings(el) {
  let chans = [], cons = []; try { [chans, cons] = await Promise.all([api("/publish/channels"), api("/publish/connect")]); } catch {}
  const dr = chans.find((c) => c.id === "drive");
  el.innerHTML = `<div class="panel"><h3>Publishing <span class="right">every post needs a preview and a click</span></h3>
    <div class="hint">Connect each service with ${esc(plainLabel("oauth"))}. ${esc(plainExplain("oauth"))} The token stays in the vault on this computer and is never shown again. Connecting posts nothing.</div>
    <div class="row small" style="margin:6px 0"><button class="btn sm" id="pb-doctor">Check my connections</button><span id="pb-doctor-out" role="status" aria-live="polite"></span></div>
    ${cons.map(connectorRow).join("")}
    <details style="margin-top:8px"><summary class="small" style="cursor:pointer">Paste a token instead</summary>
    <div class="row" style="margin-top:6px"><span style="width:110px">Instagram</span><input type="password" id="pb-ig-tok" placeholder="Page access token (long-lived)" style="flex:1"><input type="text" id="pb-ig-id" placeholder="IG user id" style="width:160px"><button class="btn sm" id="pb-ig-save">Save</button></div>
    <div class="row" style="margin-top:6px"><span style="width:110px">HighLevel</span><input type="password" id="pb-ghl-tok" placeholder="Private integration token" style="flex:1"><input type="text" id="pb-ghl-loc" placeholder="Location id" style="width:160px"><button class="btn sm" id="pb-ghl-save">Save</button></div>
    <div class="row" style="margin-top:6px"><span style="width:110px">Slack</span><input type="password" id="pb-sl-tok" placeholder="Bot token (xoxb-...)" style="flex:1"><button class="btn sm" id="pb-sl-save">Save</button></div>
    <div class="dim small" style="margin-top:6px">Instagram: a long-lived Page token with instagram_content_publish; the IG user id is the professional account linked to the Page. HighLevel: Settings, Private Integrations, a token with social-media-posting scopes. Slack: your app's Bot User OAuth Token.</div></details>
    <div class="row" style="margin-top:10px"><span style="width:110px">Drive folder</span><input type="text" id="pb-drive" placeholder="C:\\Users\\you\\Google Drive\\Everborn" value="${esc(dr?.folder || "")}" style="flex:1"><button class="btn sm" id="pb-drive-save">Save</button></div>
    <div class="dim small">Used by Save to Drive when Google Drive is not connected: a Drive-synced folder on this computer.</div></div>`;
  const saved = (what, fn) => async () => { try { await fn(); toast(`${what} saved`); renderSettings(el); } catch (e) { toast(e.message, true); } };
  el.querySelector("#pb-ig-save").addEventListener("click", saved("Instagram", () => api("/publish/keys", { method: "POST", body: { channel: "instagram", token: el.querySelector("#pb-ig-tok").value.trim(), igUserId: el.querySelector("#pb-ig-id").value } })));
  el.querySelector("#pb-ghl-save").addEventListener("click", saved("HighLevel", () => api("/publish/keys", { method: "POST", body: { channel: "ghl", token: el.querySelector("#pb-ghl-tok").value.trim(), locationId: el.querySelector("#pb-ghl-loc").value } })));
  el.querySelector("#pb-sl-save").addEventListener("click", saved("Slack", () => api("/publish/keys", { method: "POST", body: { channel: "slack", token: el.querySelector("#pb-sl-tok").value.trim() } })));
  el.querySelector("#pb-drive-save").addEventListener("click", saved("Drive folder", () => api("/publish/prefs", { method: "POST", body: { driveFolder: el.querySelector("#pb-drive").value } })));
  el.querySelector("#pb-doctor")?.addEventListener("click", async () => {
    try {
      const r = await api("/publish/connect-doctor");
      const out = el.querySelector("#pb-doctor-out");
      out.innerHTML = r.checks.length ? `<ul style="margin:6px 0;padding-left:18px">${r.checks.map((c) => `<li>${c.level === "ok" ? "OK. " : ""}${esc(c.problem)}${c.fix === "reconnect" ? " Press Connect again on that row." : c.fix === "connect" ? " Press Connect on the HighLevel contacts row." : ""}</li>`).join("")}</ul>` : " Nothing is connected yet.";
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-con]").forEach((row) => {
    const k = row.dataset.con, c = cons.find((x) => x.id === k);
    row.querySelector('[data-a="connect"]').addEventListener("click", async () => {
      try {
        const body = { clientId: row.querySelector('[data-f="cid"]').value.trim() || (c.sharedClient ? "" : undefined) };
        const sec = row.querySelector('[data-f="csec"]').value.trim(); if (sec) body.clientSecret = sec;
        if (body.clientId !== undefined || body.clientSecret) await api(`/publish/connect/${k}/client`, { method: "POST", body });
        const r = await api(`/publish/connect/${k}/start`, { method: "POST", body: { origin: location.origin } });
        window.open(r.url, "_blank", "noopener");
        toast(`Sign in to ${c.name} and allow the access asked for; this page finishes the link when you come back.`);
      } catch (e) { toast(e.message, true); }
    });
    row.querySelector('[data-a="off"]')?.addEventListener("click", async () => {
      if (!(await window.CC.confirm(`Disconnect ${c.name}? Its token is removed from the vault. To remove the access on ${c.name}'s side too, revoke the app there.`, { danger: true, ok: "Disconnect" }))) return;
      try { await api(`/publish/connect/${k}`, { method: "DELETE" }); toast(`${c.name} disconnected`); renderSettings(el); } catch (e) { toast(e.message, true); }
    });
  });
}

// ---------- OAuth: the browser came back with ?code=&state=pub-<connector>-... ----------
async function finishIfBack() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state") || "";
  const m = /^pub-(google|meta|ghlcrm|ghl|slack)-/.exec(state);
  if (!code || !m) return;
  for (const k of ["code", "state", "scope", "authuser", "prompt", "session_state", "iss", "hd"]) q.delete(k);
  history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
  try { const r = await api(`/publish/connect/${m[1]}/finish`, { method: "POST", body: { code, state } }); toast(`${r.name} connected for publishing${r.account ? ` (${r.account})` : ""}. Nothing posts without your click.`); }
  catch (e) { toast(`Sign-in did not finish: ${e.message}`, true); }
  if (S.view === "settings") window.CC.render?.();
}

CC.register({
  id: "publish",
  onEvent(ev) { if (ev.type === "hello") finishIfBack(); },
  deliverable: { order: 12, render(el, run) {
    if (!run?.id || !run.deliverable) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:8px;gap:8px;flex-wrap:wrap"><span class="dim">Publish:</span>${Object.entries(TITLE).map(([ch, t]) => `<button class="btn sm" data-ch="${ch}">${t}</button>`).join("")}</div><div id="pb-preview"></div>`;
    el.querySelectorAll("[data-ch]").forEach((b) => b.addEventListener("click", () => openPreview(el, b.dataset.ch, run)));
  } },
  tab: { label: "Publish", short: "Publish", icon: "⇪", order: 40, async render(view) {
    let hist = [], chans = [], sends = []; try { hist = await api("/publish/history"); chans = await api("/publish/channels"); sends = (await api("/publish/send-log?limit=30")).items || []; } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const link = (u) => /^https:\/\//.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>` : u ? `<span class="dim">${esc(u)}</span>` : "";
    view.innerHTML = `<div class="grid" id="pub-tour" style="grid-template-columns: 320px minmax(0,1fr)">
      <div class="panel"><h3>Channels</h3>${chans.map((c) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(c.name)}</span><span class="chip ${c.ready ? "green" : ""}" style="margin-left:auto">${c.ready ? "ready" : "practice only"}</span></div><div class="dim small">${esc(c.needs)}</div>`).join("")}<div class="dim small" style="margin-top:8px">Connect services in Settings, Publishing.</div></div>
      <div class="panel"><h3>History <span class="right">${hist.length}</span></h3>${hist.map((h) => `<div class="small" style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="row"><b>${esc(h.channel)}${h.channelName ? ` #${esc(h.channelName)}` : ""}</b><span class="chip ${h.status === "posted" ? "green" : h.status === "failed" ? "red" : "amber"}">${esc(h.status)}</span><span class="dim" style="margin-left:auto">${new Date(h.ts).toLocaleString()}</span></div><div class="dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.title || h.text || "")}</div>${link(h.result?.url)}${h.error ? `<div style="color:var(--red)">${esc(h.error)}</div>` : ""}</div>`).join("") || `<div class="dim small">Nothing published yet.</div>`}</div>
      <div class="panel" id="pb-sendlog"><h3>Send log <span class="right">${sends.length}</span></h3><div class="dim small">Everything Meldmind sent for you: when, where, the words, and whether a warning was overridden. Private numbers are hidden.</div>${sends.map((x) => `<div class="small" style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="row"><b>${esc(x.channel)}${x.to ? ` to ${esc(x.to)}` : ""}</b>${x.rules?.length ? `<span class="chip amber" title="${esc(x.rules.join(", "))}">${x.sendAnyway ? "sent anyway" : "warned"}</span>` : ""}<span class="dim" style="margin-left:auto">${new Date(x.at).toLocaleString()}</span></div><div class="dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.title || x.text || "")}</div></div>`).join("") || `<div class="dim small">Nothing sent yet.</div>`}</div></div>`;
    if (S.flags?.publish) { try { await import("/features/publish-plus.js"); window.CC.mountPublishPlus?.(view); } catch {} }
    if (S.flags?.finishrouter) { try { await import("/features/finish-router.js"); window.CC.mountFinishRouter?.(view); } catch {} }
    if (S.flags?.finishers) { try { await import("/features/finishers.js"); window.CC.mountFinishers?.(view); } catch {} }
  } },
  settings: { order: 50, render: renderSettings },
});
