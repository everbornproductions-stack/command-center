// Media tab + "Make media from this" under deliverables + key fields in Settings.
const { S, api, toast, esc, money, pname, pcolor, go } = window.CC;

let providers = [];
async function loadProviders() { try { providers = await api("/media/providers"); } catch { providers = []; } return providers; }
const kindsOf = (pid) => providers.find((p) => p.id === pid)?.kinds || [];

function form(prefill = {}) {
  const pv = providers.filter((p) => p.kinds.includes(prefill.kind || "video"));
  return `<div class="panel" id="md-form"><h3>Generate <span class="right">estimate first · nothing spends until you click Generate</span></h3>
    <div class="row"><div class="seg" id="md-kind">${["video", "image", "voice"].map((k) => `<button data-k="${k}" class="${(prefill.kind || "video") === k ? "on" : ""}">${k}</button>`).join("")}</div>
      <select id="md-prov" style="width:auto">${pv.map((p) => `<option value="${p.id}">${esc(p.name)}${p.keyed ? "" : " (no key: dry run)"}</option>`).join("")}</select>
      <select id="md-proj" style="width:auto"><option value="">No project</option>${S.projects.map((p) => `<option value="${p.id}" ${p.id === S.project ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <label class="lbl">Prompt / text</label><textarea id="md-prompt" style="min-height:80px">${esc(prefill.prompt || "")}</textarea>
    <div class="row" style="margin-top:8px"><label class="small" id="md-img-l">First-frame image URL <input type="text" id="md-img" placeholder="https://… (needed for image-to-video)" style="width:320px;padding:5px 8px"></label><label class="small" id="md-dur-l">Seconds <input type="number" id="md-dur" value="5" min="3" max="10" style="width:70px;padding:5px 8px"></label><input type="text" id="md-model" placeholder="model (optional)" style="width:220px;padding:5px 8px"></div>
    <div class="row" style="margin-top:10px"><button class="btn sm" id="md-est">Estimate</button><span class="small" id="md-est-out"></span><button class="btn sm primary" id="md-go" style="margin-left:auto" disabled>Generate</button></div></div>`;
}

function wireForm(root, after) {
  let kind = root.querySelector("#md-kind button.on")?.dataset.k || "video";
  const refreshProv = () => { const sel = root.querySelector("#md-prov"); sel.innerHTML = providers.filter((p) => p.kinds.includes(kind)).map((p) => `<option value="${p.id}">${esc(p.name)}${p.keyed ? "" : " (no key: dry run)"}</option>`).join(""); root.querySelector("#md-img-l").style.display = kind === "voice" ? "none" : ""; root.querySelector("#md-dur-l").style.display = kind === "video" ? "" : "none"; root.querySelector("#md-go").disabled = true; };
  root.querySelector("#md-kind").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; kind = b.dataset.k; root.querySelectorAll("#md-kind button").forEach((x) => x.classList.toggle("on", x === b)); refreshProv(); });
  const params = () => ({ prompt: root.querySelector("#md-prompt").value.trim(), text: root.querySelector("#md-prompt").value.trim(), imageUrl: root.querySelector("#md-img").value.trim() || undefined, duration: Number(root.querySelector("#md-dur").value) || 5, model: root.querySelector("#md-model").value.trim() || undefined });
  root.querySelector("#md-est").addEventListener("click", async () => { try { const r = await api("/media/estimate", { method: "POST", body: { provider: root.querySelector("#md-prov").value, kind, params: params() } }); root.querySelector("#md-est-out").innerHTML = `≈ <b>${money(r.estimate.usd, 3)}</b> <span class="dim">${esc(r.estimate.note || "")}</span>${r.keyed ? "" : ' <span class="chip amber">no key · dry run</span>'}`; root.querySelector("#md-go").disabled = false; } catch (e) { toast(e.message, true); } });
  root.querySelector("#md-go").addEventListener("click", async () => { try { const j = await api("/media/generate", { method: "POST", body: { provider: root.querySelector("#md-prov").value, kind, params: params(), projectId: root.querySelector("#md-proj").value || null, missionId: S.live?.id || null } }); toast(`Job ${j.id} started`); after?.(); } catch (e) { toast(e.message, true); } });
}

async function renderTab(view, prefill) {
  await loadProviders();
  let jobs = []; try { jobs = await api("/media/jobs"); } catch {}
  view.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 380px">${form(prefill || {})}
    <div class="panel"><h3>Jobs <span class="right">${jobs.length}</span></h3>${jobs.slice(0, 30).map((j) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)" class="small">
      <div class="row"><span class="dot" style="background:${pcolor(j.provider)}"></span><b>${esc(pname(j.provider))}</b> · ${esc(j.kind)} <span class="chip ${j.status === "done" ? "green" : j.status === "failed" ? "red" : j.status === "dry-run" ? "amber" : ""}" style="margin-left:auto">${esc(j.status)}${j.progress ? " " + esc(String(j.progress)) : ""}</span></div>
      <div class="dim" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(j.params?.prompt || j.params?.text || "")}</div>
      <div class="row dim"><span>≈ ${money(j.estimate?.usd || 0, 3)}</span>${j.error ? `<span style="color:var(--red)">${esc(j.error)}</span>` : ""}${j.note ? `<span>${esc(j.note)}</span>` : ""}${(j.outputs || []).map((o) => /^https?:/.test(o) ? `<a href="${esc(o)}" target="_blank" rel="noopener">open</a>` : `<a href="#" data-open="${esc(o)}">show file</a>`).join(" ")}</div></div>`).join("") || `<div class="dim small">No jobs yet. Try a dry run: it costs nothing.</div>`}</div></div>`;
  wireForm(view, () => renderTab(view));
  view.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); try { await api("/media/open", { method: "POST", body: { path: a.dataset.open } }); } catch (er) { toast(er.message, true); } }));
}

CC.register({
  id: "media",
  tab: { label: "Media", short: "Media", icon: "▶", order: 20, render: (v) => renderTab(v, CC._mediaPrefill), },
  deliverable: { order: 15, render(el, run) {
    if (!run?.id) { el.innerHTML = ""; return; }
    const text = (run.deliverable || "").replace(/[#*>`]/g, "").trim().slice(0, 400);
    el.innerHTML = `<div class="row small" style="margin-top:8px"><button class="btn sm" id="md-from">Make media from this</button><span class="dim">opens Media with the prompt pre-filled</span></div>`;
    el.querySelector("#md-from").addEventListener("click", () => { CC._mediaPrefill = { kind: "video", prompt: text }; go("media"); setTimeout(() => { CC._mediaPrefill = null; }, 1000); });
  } },
  settings: { order: 40, async render(el) {
    await loadProviders();
    el.innerHTML = `<div class="panel"><h3>Media API keys <span class="right">Kling, ElevenLabs, Runway, fal.ai</span></h3>
      ${providers.map((p) => `<div class="row" style="margin-top:6px"><span style="width:110px"><span class="dot" style="background:${pcolor(p.id)}"></span> ${esc(p.name)}</span>${p.id === "kling" ? `<input type="password" placeholder="access key" data-mk="${p.id}" style="flex:1"><input type="password" placeholder="secret key" data-ms="${p.id}" style="flex:1">` : `<input type="password" placeholder="${p.keyed ? "key saved" : "API key"}" data-mk="${p.id}" style="flex:1">`}<button class="btn sm" data-save="${p.id}">Save</button><span class="chip ${p.keyed ? "green" : ""}">${p.keyed ? "keyed" : "dry run"}</span></div>`).join("")}
      <div class="dim small" style="margin-top:8px">Keys are sealed in the same vault as the chat AIs. Without a key, generation runs as a dry run with the estimate shown.</div></div>`;
    el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => { const pid = b.dataset.save; const key = el.querySelector(`[data-mk="${pid}"]`).value.trim(); const secret = el.querySelector(`[data-ms="${pid}"]`)?.value.trim(); if (!key) return toast("Paste the key first", true); try { const r = await api("/media/keys", { method: "POST", body: { provider: pid, key, secret } }); toast(`${pname(pid)} key saved${r.balance?.usd != null ? ` · balance $${r.balance.usd}` : ""}`); render(); } catch (e) { toast(e.message, true); } }));
  } },
});
