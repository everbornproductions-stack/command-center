// Publishing: buttons under the deliverable (Instagram, GHL, Drive folder), each with a preview + confirm;
// credentials and the Drive folder in Settings; history in a Publish tab.
const { S, api, toast, esc, md, go } = window.CC;

function stripMd(t) { return (t || "").replace(/```[\s\S]*?```/g, "").replace(/[#*>`_]/g, "").replace(/\n{3,}/g, "\n\n").trim(); }

// Finished media jobs that can be attached (doc media.jobs from the Media tab).
async function mediaJobs() {
  try { const r = await api("/media/jobs"); return (Array.isArray(r) ? r : r.items || []).filter((j) => j.status === "done" && j.outputs?.length).slice(0, 30); } catch { return []; }
}
const jobLabel = (j) => `${j.kind} · ${j.provider} · ${String(j.params?.prompt || j.params?.text || "").slice(0, 50)}`;

async function openPreview(el, channel, run) {
  const title = run.mission?.title || run.council?.prompt?.slice(0, 80) || "Deliverable";
  const text = stripMd(run.deliverable || "").slice(0, 2200);
  let accounts = []; if (channel === "ghl") { try { accounts = await api("/publish/ghl-accounts"); } catch {} }
  const jobs = await mediaJobs();
  const box = el.querySelector("#pb-preview");
  box.innerHTML = `<div class="route" style="margin-top:8px;border-left:3px solid var(--violet)">
    <div class="row"><b>${channel === "instagram" ? "Post to Instagram" : channel === "ghl" ? "Schedule in GoHighLevel" : "Save to Drive folder"}</b><button class="ghost small" id="pb-close" style="margin-left:auto">close</button></div>
    ${channel !== "drive" ? `<label class="lbl">Caption</label><textarea id="pb-text" style="min-height:90px">${esc(text.slice(0, channel === "instagram" ? 2200 : 2000))}</textarea>
    <label class="lbl">Media URL (public https; images or mp4)</label><input type="text" id="pb-media" placeholder="https://…">` : `<label class="lbl">Title</label><input type="text" id="pb-title" value="${esc(title)}">`}
    <label class="lbl">Attach a media job</label><select id="pb-job"><option value="">${jobs.length ? "none" : "no finished media jobs yet (Media tab)"}</option>${jobs.map((j) => `<option value="${esc(j.id)}">${esc(jobLabel(j))}</option>`).join("")}</select>
    ${channel === "ghl" ? `<label class="lbl">Accounts</label><div>${accounts.length ? accounts.map((a) => `<label class="row small" style="gap:6px"><input type="checkbox" data-acc="${esc(a.id)}" checked> ${esc(a.name)} <span class="dim">${esc(a.platform || "")}</span></label>`).join("") : `<span class="dim small">No connected accounts found (or no GHL token yet).</span>`}</div><label class="lbl">When (blank = now)</label><input type="datetime-local" id="pb-when">` : ""}
    <div class="row" style="margin-top:10px"><button class="btn sm" id="pb-prev">Preview</button><span class="small" id="pb-out">Preview first. The confirm button posts exactly what the preview shows.</span><button class="btn sm primary" id="pb-go" style="margin-left:auto" disabled title="Preview first">Confirm &amp; ${channel === "drive" ? "save" : channel === "ghl" ? "schedule" : "post"}</button></div></div>`;
  let previewId = null;
  const go = box.querySelector("#pb-go"), out = box.querySelector("#pb-out");
  const payload = () => ({ channel, title: box.querySelector("#pb-title")?.value || title, text: box.querySelector("#pb-text")?.value ?? text, mediaUrl: box.querySelector("#pb-media")?.value.trim() || undefined, mediaType: /\.(mp4|mov|webm)(\?|$)/i.test(box.querySelector("#pb-media")?.value || "") ? "video" : "image", mediaJobId: box.querySelector("#pb-job")?.value || undefined, when: box.querySelector("#pb-when")?.value ? new Date(box.querySelector("#pb-when").value).getTime() : null, accountIds: [...box.querySelectorAll("[data-acc]:checked")].map((c) => c.dataset.acc), projectId: run.mission?.projectId || run.council?.projectId || S.project || null, missionId: run.id });
  // any edit after a preview makes it stale: the post must match what was shown
  const stale = () => { if (!previewId) return; previewId = null; go.disabled = true; out.innerHTML = `<span class="dim">Changed since the preview. Preview again.</span>`; };
  box.querySelectorAll("input, textarea, select").forEach((i) => { i.addEventListener("input", stale); i.addEventListener("change", stale); });
  box.querySelector("#pb-close").addEventListener("click", () => { box.innerHTML = ""; });
  box.querySelector("#pb-prev").addEventListener("click", async () => {
    try {
      const r = await api("/publish/preview", { method: "POST", body: payload() });
      previewId = r.previewId;
      out.innerHTML = `${esc(r.summary)}${r.media ? ` <span class="chip">media ${esc(r.media.kind)}${r.media.files ? ` · ${r.media.files} file${r.media.files === 1 ? "" : "s"}` : ""}</span>` : ""}${r.problems.length ? `<div style="color:var(--amber)">${r.problems.map(esc).join(" · ")}</div>` : ""}${r.dryRun ? ' <span class="chip amber">no credentials · will record a dry run</span>' : ' <span class="chip green">ready</span>'}`;
      go.disabled = r.problems.length > 0 && !r.dryRun; go.title = go.disabled ? "Fix the problems above, then preview again" : "";
    } catch (e) { previewId = null; go.disabled = true; toast(e.message, true); }
  });
  go.addEventListener("click", async () => {
    if (!previewId) return toast("Preview first", true);
    go.disabled = true;
    try { const r = await api("/publish/post", { method: "POST", body: { channel, previewId, confirmed: true } }); toast(r.status === "posted" ? `Posted: ${r.result?.url || "done"}` : r.status === "dry-run" ? "Recorded as a dry run (no credentials)" : `Failed: ${r.error}`, r.status === "failed"); box.innerHTML = ""; }
    catch (e) { previewId = null; toast(e.message, true); out.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
  });
}

CC.register({
  id: "publish",
  deliverable: { order: 12, render(el, run) {
    if (!run?.id || !run.deliverable) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:8px;gap:8px"><span class="dim">Publish:</span><button class="btn sm" data-ch="instagram">Post to Instagram</button><button class="btn sm" data-ch="ghl">Schedule in GHL</button><button class="btn sm" data-ch="drive">Save to Drive folder</button></div><div id="pb-preview"></div>`;
    el.querySelectorAll("[data-ch]").forEach((b) => b.addEventListener("click", () => openPreview(el, b.dataset.ch, run)));
  } },
  tab: { label: "Publish", short: "Publish", icon: "⇪", order: 40, async render(view) {
    let hist = [], chans = []; try { hist = await api("/publish/history"); chans = await api("/publish/channels"); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    view.innerHTML = `<div class="grid" id="pub-tour" style="grid-template-columns: 320px minmax(0,1fr)">
      <div class="panel"><h3>Channels</h3>${chans.map((c) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(c.name)}</span><span class="chip ${c.ready ? "green" : ""}" style="margin-left:auto">${c.ready ? "ready" : "dry run"}</span></div><div class="dim small">${esc(c.needs)}</div>`).join("")}<div class="dim small" style="margin-top:8px">Set credentials in Settings → Publishing.</div></div>
      <div class="panel"><h3>History <span class="right">${hist.length}</span></h3>${hist.map((h) => `<div class="small" style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="row"><b>${esc(h.channel)}</b><span class="chip ${h.status === "posted" ? "green" : h.status === "failed" ? "red" : "amber"}">${esc(h.status)}</span><span class="dim" style="margin-left:auto">${new Date(h.ts).toLocaleString()}</span></div><div class="dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.title || h.text || "")}</div>${h.result?.url ? `<a href="${esc(h.result.url)}" target="_blank" rel="noopener">${esc(h.result.url)}</a>` : ""}${h.error ? `<div style="color:var(--red)">${esc(h.error)}</div>` : ""}</div>`).join("") || `<div class="dim small">Nothing published yet.</div>`}</div></div>`;
  } },
  settings: { order: 50, async render(el) {
    let chans = []; try { chans = await api("/publish/channels"); } catch {}
    const dr = chans.find((c) => c.id === "drive");
    el.innerHTML = `<div class="panel"><h3>Publishing <span class="right">every post needs a preview and a click</span></h3>
      <div class="row" style="margin-top:6px"><span style="width:110px">Instagram</span><input type="password" id="pb-ig-tok" placeholder="Page access token (long-lived)" style="flex:1"><input type="text" id="pb-ig-id" placeholder="IG user id" style="width:160px"><button class="btn sm" id="pb-ig-save">Save</button></div>
      <div class="row" style="margin-top:6px"><span style="width:110px">GoHighLevel</span><input type="password" id="pb-ghl-tok" placeholder="Private integration token" style="flex:1"><input type="text" id="pb-ghl-loc" placeholder="Location id" style="width:160px"><button class="btn sm" id="pb-ghl-save">Save</button></div>
      <div class="row" style="margin-top:6px"><span style="width:110px">Drive folder</span><input type="text" id="pb-drive" placeholder="C:\\Users\\you\\Google Drive\\Everborn" value="${esc(dr?.folder || "")}" style="flex:1"><button class="btn sm" id="pb-drive-save">Save</button></div>
      <div class="dim small" style="margin-top:8px">Instagram: Meta for Developers → your app → long-lived Page token with instagram_content_publish; the IG user id is the professional account linked to the Page. GHL: Settings → Private Integrations → token with social-media-posting scopes.</div></div>`;
    el.querySelector("#pb-ig-save").addEventListener("click", async () => { try { await api("/publish/keys", { method: "POST", body: { channel: "instagram", token: el.querySelector("#pb-ig-tok").value.trim(), igUserId: el.querySelector("#pb-ig-id").value } }); toast("Instagram saved"); } catch (e) { toast(e.message, true); } });
    el.querySelector("#pb-ghl-save").addEventListener("click", async () => { try { await api("/publish/keys", { method: "POST", body: { channel: "ghl", token: el.querySelector("#pb-ghl-tok").value.trim(), locationId: el.querySelector("#pb-ghl-loc").value } }); toast("GoHighLevel saved"); } catch (e) { toast(e.message, true); } });
    el.querySelector("#pb-drive-save").addEventListener("click", async () => { try { await api("/publish/prefs", { method: "POST", body: { driveFolder: el.querySelector("#pb-drive").value } }); toast("Drive folder saved"); } catch (e) { toast(e.message, true); } });
  } },
});
