// Guided API-key setup: one provider per step. Where to get the key (link opens the provider's key
// page), what the key looks like, paste, Test and save (the server runs a test call and only then
// seals the key in the vault), then Next. A refused key is never kept. Keys are never shown again
// after saving: the wizard only ever shows the masked form the server returns.
const { S, api, toast, esc, go, refresh } = window.CC;

const css = `
#cc-keysetup { position: fixed; inset: 0; z-index: 72; background: rgba(3,6,12,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
#cc-keysetup .box { width: 860px; max-width: 100%; max-height: calc(100vh - 32px); display: grid; grid-template-columns: 220px 1fr; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: 0 28px 70px rgba(0,0,0,.5); overflow: hidden; }
#cc-keysetup .side { border-right: 1px solid var(--line); padding: 14px 10px; overflow: auto; background: var(--bg-2); }
#cc-keysetup .side h4 { margin: 4px 8px 10px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
#cc-keysetup .side button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 0; color: var(--text); padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 13px; }
#cc-keysetup .side button.on { background: var(--accent-soft); }
#cc-keysetup .side button .nm { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#cc-keysetup .main { padding: 18px 22px; overflow: auto; font-size: 13.5px; line-height: 1.5; }
#cc-keysetup .main h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
#cc-keysetup ol.steps { margin: 12px 0 0; padding-left: 22px; }
#cc-keysetup ol.steps li { margin: 4px 0; }
#cc-keysetup .result { margin-top: 12px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg-2); }
#cc-keysetup .result.green { border-color: var(--green); } #cc-keysetup .result.amber { border-color: var(--amber); } #cc-keysetup .result.red { border-color: var(--red); }
#cc-keysetup .foot { display: flex; gap: 8px; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
@media (max-width: 760px) { #cc-keysetup .box { grid-template-columns: 1fr; } #cc-keysetup .side { display: none; } }
`;
const style = document.createElement("style"); style.id = "cc-keysetup"; style.textContent = css; document.head.appendChild(style);

let data = null;   // last /api/keysetup view
let el = null;     // overlay root
let idx = 0;       // current provider index; data.providers.length = the finish page
let busy = false;
let result = null; // { tone, label, detail, billingUrl } for the current step
let hint = null;   // paste-detection note

async function load() { data = await api("/keysetup"); return data; }

export async function open(startAt) {
  try { await load(); } catch (e) { return toast(e.message, true); }
  if (!data.providers.length) return toast("No provider needs a key here.", true);
  if (!el) {
    el = document.createElement("div"); el.id = "cc-keysetup"; document.body.appendChild(el);
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
  }
  if (!data.startedAt) { try { data = await api("/keysetup/start", { method: "POST" }); } catch {} }
  if (typeof startAt === "string") idx = Math.max(0, data.providers.findIndex((p) => p.id === startAt));
  else if (typeof startAt === "number") idx = startAt;
  else { const first = data.providers.findIndex((p) => !p.keyed && !p.skipped); idx = first < 0 ? 0 : first; }
  result = null; hint = null; render();
}
function close() { if (!el) return; el.remove(); el = null; document.removeEventListener("keydown", onKey); }
function onKey(e) { if (e.key === "Escape") close(); }

function next() { result = null; hint = null; idx = Math.min(idx + 1, data.providers.length); render(); }
function back() { result = null; hint = null; idx = Math.max(idx - 1, 0); render(); }

function render() {
  if (!el) return;
  const list = data.providers, p = list[idx];
  const side = `<div class="side"><h4>Your AIs</h4>${list.map((x, i) => `<button class="${i === idx ? "on" : ""}" data-i="${i}"><span class="dot ${x.keyed ? x.status.status || "green" : x.skipped ? "grey" : "grey"}"></span><span class="nm">${esc(x.name)}</span>${x.keyed ? `<span class="small dim">linked</span>` : x.skipped ? `<span class="small dim">skipped</span>` : ""}</button>`).join("")}
    <button class="${idx >= list.length ? "on" : ""}" data-i="${list.length}"><span class="dot ${data.linkedCount ? "green" : "grey"}"></span><span class="nm">Finish</span></button></div>`;
  let main;
  if (!p) {
    const linked = list.filter((x) => x.keyed);
    main = `<div class="main"><h3>${linked.length ? `${linked.length} of ${list.length} AIs linked` : "No keys yet"}</h3>
      <div class="muted" style="margin-top:8px">${linked.length ? `Linked: ${linked.map((x) => esc(x.name)).join(", ")}. The status strip shows a green light for each one, and the router can send work to them now.` : "You can come back any time: Settings, then Guided API-key setup. Demo mode keeps working without keys."}</div>
      ${S.vault?.file ? `<div class="dim small" style="margin-top:10px">Keys are sealed with ${esc(S.vault?.method || "the operating system")} in <span class="mono">${esc(S.vault.file)}</span> and never leave this machine except to the provider you gave them to.</div>` : `<div class="dim small" style="margin-top:10px">Keys are encrypted before they are stored and are only decrypted to call the provider you gave them to.</div>`}
      <div class="foot"><button class="btn sm" id="ks-back">Back</button><span style="flex:1"></span><button class="btn sm primary" id="ks-done">Done</button></div></div>`;
  } else {
    const n = idx + 1;
    main = `<div class="main">
      <div class="row" style="gap:8px"><h3><span class="dot ${p.keyed ? p.status.status || "green" : "grey"}"></span>${esc(p.name)} <span class="dim small" style="font-weight:400">${esc(p.vendor)}</span></h3><span class="dim small" style="margin-left:auto;font-family:var(--mono)">${n} / ${list.length}</span></div>
      <div class="muted" style="margin-top:6px">${esc(p.why)}${p.free ? ` <span class="chip green">free tier</span>` : ""}</div>
      ${p.keyed ? `<div class="result green">Already linked: <span class="mono">${esc(p.masked || "")}</span>. ${esc(p.status.detail || "")} Paste a new key below to replace it, or press Next.</div>` : ""}
      <ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <div class="row" style="margin-top:10px;gap:8px">${p.keysUrl ? `<a class="btn sm" href="${esc(p.keysUrl)}" target="_blank" rel="noopener">Open the ${esc(p.name)} key page</a>` : ""}${p.billingUrl ? `<a class="small" href="${esc(p.billingUrl)}" target="_blank" rel="noopener">billing</a>` : ""}<span class="dim small">A key looks like <span class="mono">${esc(p.looks)}</span></span></div>
      <div class="row" style="margin-top:12px;gap:8px">
        <input type="password" id="ks-key" placeholder="${esc(p.fields.secret ? "access key" : "paste the key here")}" style="flex:1" autocomplete="off" spellcheck="false">
        ${p.fields.secret ? `<input type="password" id="ks-secret" placeholder="secret key" style="flex:1" autocomplete="off">` : ""}
        ${p.fields.workspaceId ? `<input type="text" id="ks-ws" placeholder="workspace ID (optional)" style="width:180px;font-family:var(--mono)" autocomplete="off" title="Only for keys that must name a workspace.">` : ""}
        <button class="btn sm primary" id="ks-save" ${busy ? "disabled" : ""}>${busy ? "Testing…" : "Test and save"}</button>
      </div>
      ${hint ? `<div class="small" style="margin-top:6px">${hint}</div>` : ""}
      ${result ? `<div class="result ${result.tone}"><b>${esc(result.label)}.</b> ${esc(result.detail || "")}${result.tone === "amber" && result.billingUrl ? ` <a href="${esc(result.billingUrl)}" target="_blank" rel="noopener">Add credit</a>.` : ""}${result.tone === "red" ? " Nothing was saved; copy the key again and retry, or skip this one." : ""}</div>` : ""}
      <div class="dim small" style="margin-top:10px">The console sends one test call to ${esc(p.name)}, then seals the key in the vault. It is never logged and never shown again (only its first and last four characters).</div>
      <div class="foot"><button class="btn sm" id="ks-back" ${idx === 0 ? "disabled" : ""}>Back</button><button class="ghost small" id="ks-skip">Skip ${esc(p.name)}</button><span style="flex:1"></span><button class="ghost small" id="ks-close">Close</button><button class="btn sm primary" id="ks-next">${n === list.length ? "Finish" : "Next"}</button></div>
    </div>`;
  }
  el.innerHTML = `<div class="box" role="dialog" aria-label="Guided API-key setup">${side}${main}</div>`;
  el.querySelectorAll(".side button").forEach((b) => b.addEventListener("click", () => { result = null; hint = null; idx = Number(b.dataset.i); render(); }));
  el.querySelector("#ks-back")?.addEventListener("click", back);
  el.querySelector("#ks-next")?.addEventListener("click", next);
  el.querySelector("#ks-close")?.addEventListener("click", close);
  el.querySelector("#ks-done")?.addEventListener("click", async () => { try { await api("/keysetup/complete", { method: "POST" }); } catch {} close(); toast(data.linkedCount ? "Keys set up. Your AIs are ready." : "No keys saved. Add them any time from Settings."); go("command"); });
  el.querySelector("#ks-skip")?.addEventListener("click", async () => { try { data = await api("/keysetup/skip", { method: "POST", body: { provider: p.id } }); } catch {} next(); });
  el.querySelector("#ks-save")?.addEventListener("click", () => save(p));
  const keyEl = el.querySelector("#ks-key");
  keyEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") save(p); });
  keyEl?.addEventListener("input", () => detect(p, keyEl.value.trim()));
  if (keyEl && !busy) setTimeout(() => keyEl.focus(), 50);
}

// A key pasted into the wrong step is pointed at the right one before anything is sent.
let detectTimer = null;
function detect(p, key) {
  clearTimeout(detectTimer); hint = null;
  if (key.length < 12) { el?.querySelector("#ks-hint")?.remove(); return; }
  detectTimer = setTimeout(async () => {
    try {
      const { suggestion } = await api("/providers/suggest", { method: "POST", body: { key } });
      if (suggestion && suggestion.provider !== p.id && suggestion.confidence === "high") {
        const at = data.providers.findIndex((x) => x.id === suggestion.provider);
        hint = `This looks like a <b>${esc(suggestion.name)}</b> key, not ${esc(p.name)}.${at >= 0 ? ` <a href="#" id="ks-jump">Jump to ${esc(suggestion.name)}</a> (the key stays in the box).` : ""}`;
        const h = document.createElement("div"); h.className = "small"; h.style.marginTop = "6px"; h.innerHTML = hint;
        const old = el.querySelector("#ks-hint"); old?.remove(); h.id = "ks-hint";
        el.querySelector("#ks-key")?.closest(".row")?.after(h);
        h.querySelector("#ks-jump")?.addEventListener("click", (e) => { e.preventDefault(); const v = el.querySelector("#ks-key")?.value || ""; idx = at; result = null; hint = null; render(); const k = el.querySelector("#ks-key"); if (k) { k.value = v; } });
      } else el.querySelector("#ks-hint")?.remove();
    } catch {}
  }, 350);
}

async function save(p) {
  if (busy) return;
  const key = el.querySelector("#ks-key")?.value.trim();
  if (!key) return toast("Paste the key first", true);
  const body = { provider: p.id, key };
  const sec = el.querySelector("#ks-secret"); if (sec) body.secret = sec.value.trim();
  const ws = el.querySelector("#ks-ws"); if (ws && ws.value.trim()) body.workspaceId = ws.value.trim();
  busy = true; render();
  try {
    const r = await api("/keysetup/save", { method: "POST", body });
    result = { tone: r.verdict.tone, label: r.verdict.label, detail: r.status.detail, billingUrl: r.billingUrl };
    if (r.kept) {
      toast(`${p.name}: ${r.verdict.label.toLowerCase()}`);
      if (r.demoRetired) { S.demoNoticeShown = true; toast("Demo AIs removed now that your own keys are set up. You can turn demo mode back on in Settings."); api("/demo/ack", { method: "POST" }).catch(() => {}); }
      await load();
      refresh().catch(() => {});
    }
  } catch (e) { result = { tone: "red", label: "Not saved", detail: e.message }; }
  busy = false; render();
  if (result?.tone !== "red") el.querySelector("#ks-next")?.focus();
}

function renderPanel(box) {
  const d = data;
  const linked = d ? `${d.linkedCount} of ${d.total} linked` : "";
  box.innerHTML = `<div class="panel"><h3>Guided API-key setup <span class="right">${esc(linked)}${d?.completedAt ? ` · finished ${new Date(d.completedAt).toLocaleDateString()}` : ""}</span></h3>
    <div class="row"><button class="btn sm" id="ks-open">Set up keys step by step</button><span class="dim small">One provider at a time: where to get the key, paste, a test call, then the vault. Keys are never logged or shown again.</span>${d?.completedAt || d?.startedAt ? `<button class="ghost small" id="ks-reset" style="margin-left:auto">reset</button>` : ""}</div>
  </div>`;
  box.querySelector("#ks-open").addEventListener("click", () => open());
  box.querySelector("#ks-reset")?.addEventListener("click", async () => { try { data = await api("/keysetup/reset", { method: "POST" }); renderPanel(box); } catch (e) { toast(e.message, true); } });
}

window.CC.keysetup = { open, close, state: () => data };

CC.register({
  id: "keysetup",
  settings: { order: 6, render: (box) => { renderPanel(box); if (!data) load().then(() => renderPanel(box)).catch(() => {}); } },
});
