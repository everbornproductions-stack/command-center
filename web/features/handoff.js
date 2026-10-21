// Manual handoff. Continue in copies a prompt and opens the provider's own page.
// Grab reply is the only clipboard read. Confirm saves the reply. No page is automated.
const { S, api, toast, esc } = window.CC;

const GEMINI_DATA_NOTICE = "Gemini free tier: Google says unpaid Gemini API and Google AI Studio use may use what you submit and the replies to improve Google products, and human reviewers may read them. Do not paste sensitive, confidential, or personal information. Paid Gemini API use follows different terms. This is a manual handoff. Meldmind does not send the text for you.";
window.CC.geminiDataNotice = GEMINI_DATA_NOTICE;

const css = `
.cc-ho { margin-top: 8px; }
.cc-ho .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.cc-ho-meter { height: 6px; border-radius: 99px; background: var(--line); margin-top: 6px; overflow: hidden; }
.cc-ho-meter i { display: block; height: 100%; background: var(--accent, #7dd3fc); }
.cc-ho-box { margin-top: 8px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.cc-ho-box textarea, #cc-ho-settings textarea { width: 100%; min-height: 72px; margin-top: 6px; }
#cc-ho-settings input[type=url], #cc-ho-settings input[type=text] { flex: 1; min-width: 140px; }
`;
const style = document.createElement("style"); style.id = "cc-handoff-style"; style.textContent = css; document.head.appendChild(style);

let data = null;
let flow = null; // remembered across re-renders so a preview is not rebuilt by reading the clipboard again

async function load() { data = await api("/handoff"); if (data?.geminiNotice) window.CC.geminiDataNotice = data.geminiNotice; return data; }
const draftText = () => document.querySelector("#orders")?.value || "";
const threadId = () => S.live?.id || null;

async function openTarget(url) {
  const desk = window.ccDesktop;
  if (desk && typeof desk.openExternal === "function") { await desk.openExternal(url); return; }
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.opener = null;
}
async function copyPrompt(text) { await navigator.clipboard.writeText(text); }
async function grabReply() {
  return navigator.clipboard.readText();
}

function meter(chars, max) {
  const pct = Math.min(100, Math.round((Number(chars) / Number(max || 1)) * 100));
  return `<div class="cc-ho-meter" role="meter" aria-label="Handoff prompt size" aria-valuemin="0" aria-valuemax="${Number(max) || 0}" aria-valuenow="${Number(chars) || 0}"><i style="width:${pct}%"></i></div><div class="small dim">${Number(chars) || 0} / ${Number(max) || 0} characters</div>`;
}

function flowHtml() {
  if (!flow) return "";
  const gemini = flow.gemini ? `<div class="small" style="margin-top:6px">${esc(flow.geminiNotice || GEMINI_DATA_NOTICE)}${flow.geminiTerms ? ` <a href="${esc(flow.geminiTerms)}" target="_blank" rel="noopener noreferrer">Google's terms</a>` : ""}</div>` : "";
  const preview = flow.phase === "preview" ? `<label class="small" for="ho-preview">Preview the reply, then save it. It is tagged manual.</label><textarea id="ho-preview">${esc(flow.preview || "")}</textarea><div class="row" style="gap:8px;margin-top:6px"><button type="button" class="btn sm primary" id="ho-confirm">Save to this thread</button><button type="button" class="btn sm" id="ho-cancel">Cancel</button></div>` : `<div class="row" style="gap:8px;margin-top:6px"><button type="button" class="btn sm primary" data-grab="${esc(flow.targetId)}">Grab reply</button></div>`;
  const paste = flow.pasteOpen ? `<label class="small" for="ho-paste">Paste what the other AI wrote. A line that starts with DONE: is enough.</label><textarea id="ho-paste" placeholder="DONE: the summary"></textarea><div class="row" style="gap:8px;margin-top:6px"><button type="button" class="btn sm primary" id="ho-paste-save">Save</button></div>` : "";
  return `<div class="cc-ho-box"><div class="small"><b>Manual handoff</b> to ${esc(flow.name)}. ${esc(flow.instructions || "")}</div>${meter(flow.chars, flow.maxChars)}${gemini}${flow.copied ? "" : `<div class="small dim" style="margin-top:6px">Could not copy automatically. Select the prompt below and copy it.</div><textarea readonly>${esc(flow.prompt || "")}</textarea>`}<div class="small" style="margin-top:6px">When the other AI finishes, the summary shows in this job. If it cannot call back, paste the result here.</div><div class="row" style="gap:8px;margin-top:6px"><button type="button" class="btn sm" id="ho-paste-open">Paste result</button></div>${paste}${preview}</div>`;
}

function buttons(targets) {
  return (targets || []).map((t) => `<button type="button" class="btn sm" data-continue="${esc(t.id)}">Continue in ${esc(t.name)}</button>`).join("");
}

async function onContinue(id) {
  const built = await api("/handoff/prompt", { method: "POST", body: { targetId: id, threadId: threadId(), draft: draftText(), getItDone: !!window.CC?.getDoneChoice?.on, sendMessages: !!window.CC?.getDoneChoice?.send } });
  let copied = false;
  try { await copyPrompt(built.prompt); copied = true; toast("Prompt copied"); }
  catch { toast("Could not copy. Select the prompt and copy it.", true); }
  try { await openTarget(built.url); }
  catch (e) { toast(e.message || "Could not open the page", true); }
  flow = { targetId: built.targetId, name: built.name, jobId: built.jobId || "", prompt: built.prompt, chars: built.chars, maxChars: built.maxChars, instructions: built.instructions, gemini: built.gemini, geminiNotice: built.geminiNotice, geminiTerms: built.geminiTerms, copied, phase: "copied", preview: "", pasteOpen: false };
}

async function onGrab() {
  let text = "";
  try { text = await grabReply(); }
  catch { text = ""; }
  flow = { ...(flow || {}), phase: "preview", preview: text || "" };
  if (!text) toast("Could not read the clipboard. Paste the reply into the box.", true);
}

function bind(el, rerender) {
  el.querySelectorAll("[data-continue]").forEach((b) => b.addEventListener("click", async () => {
    try { await onContinue(b.dataset.continue); rerender(); }
    catch (e) { toast(e.message, true); }
  }));
  el.querySelector("[data-grab]")?.addEventListener("click", async () => {
    try { await onGrab(); rerender(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelector("#ho-cancel")?.addEventListener("click", () => { flow = flow ? { ...flow, phase: "copied", preview: "" } : null; rerender(); });
  el.querySelector("#ho-paste-open")?.addEventListener("click", () => { flow = { ...(flow || {}), pasteOpen: true }; rerender(); });
  el.querySelector("#ho-paste-save")?.addEventListener("click", async () => {
    const text = el.querySelector("#ho-paste")?.value || "";
    try {
      const saved = await api("/handoff/paste", { method: "POST", body: { text, threadId: threadId(), jobId: flow?.jobId || "", confirm: true } });
      flow = null;
      toast("Pasted result saved");
      rerender();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelector("#ho-confirm")?.addEventListener("click", async () => {
    const text = el.querySelector("#ho-preview")?.value || "";
    try {
      const saved = await api("/handoff/reply", { method: "POST", body: { targetId: flow?.targetId, threadId: threadId(), text, draft: draftText(), confirm: true } });
      flow = null;
      toast(`Saved ${saved.label}`);
      rerender();
    } catch (e) { toast(e.message, true); }
  });
}

function paint(el) {
  const auto = (data?.targets || []).filter((t) => t.suggest);
  if (!auto.length && !flow) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="cc-ho route"><span class="small muted">Manual handoff. Continue in a chat you already use. Meldmind does not type into that page or read it.</span><div class="btns">${buttons(auto)}</div>${flowHtml()}</div>`;
  bind(el, () => paint(el));
}

async function renderCommand(el) {
  try { await load(); } catch { el.innerHTML = ""; return; }
  paint(el);
}
async function renderDeliverable(el) {
  try { if (!data) await load(); } catch { el.innerHTML = ""; return; }
  paint(el);
}

async function renderSettings(el) {
  try { await load(); } catch (e) { el.innerHTML = `<div class="panel"><h3>Manual handoff</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const rows = (data.targets || []).map((t) => `<div class="row small" style="gap:8px;padding:6px 0;flex-wrap:wrap" data-row="${esc(t.id)}">
      <input type="text" data-name="${esc(t.id)}" value="${esc(t.name)}" aria-label="Name" style="width:160px">
      <input type="url" data-url="${esc(t.id)}" value="${esc(t.url)}" aria-label="Address">
      <input type="text" data-note="${esc(t.id)}" value="${esc(t.note || "")}" placeholder="Note (optional)" aria-label="Note" style="width:180px">
      <button type="button" class="btn sm" data-save="${esc(t.id)}">Save</button>
      <button type="button" class="ghost small" data-del="${esc(t.id)}">Remove</button>
      <button type="button" class="btn sm" data-continue="${esc(t.id)}">Continue in ${esc(t.name)}</button>
      ${t.suggest ? `<span class="chip">${esc(t.reason || "manual handoff")}</span>` : ""}
    </div>`).join("");
  el.innerHTML = `<div class="panel" id="cc-ho-settings"><h3>Manual handoff</h3>
    <div class="small muted">Each target is a name, the provider's own page, and an optional note. Continue in copies a short prompt and opens that page in your browser. Grab reply reads the clipboard only when you click it, shows a preview, and saves the reply when you confirm. The reply is tagged manual (for example "via ChatGPT web, manual") and the ledger line is $0. This is a manual handoff. Meldmind does not sign in, type, or read the page. When the other AI finishes, the summary shows in the job. If it cannot call back, use Paste result.</div>
    <div class="small" style="margin-top:8px">${esc(data.geminiNotice || GEMINI_DATA_NOTICE)} <a href="${esc(data.geminiTerms || "https://ai.google.dev/gemini-api/terms")}" target="_blank" rel="noopener noreferrer">Google's terms</a></div>
    <div class="cat-h" style="margin-top:12px">Targets</div>
    ${rows || `<div class="dim small">No targets yet.</div>`}
    <div class="cat-h" style="margin-top:12px">Add a target</div>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <input type="text" id="ho-new-name" placeholder="Name" aria-label="New target name" style="width:160px">
      <input type="url" id="ho-new-url" placeholder="https://" aria-label="New target address">
      <input type="text" id="ho-new-note" placeholder="Note (optional)" aria-label="New target note" style="width:180px">
      <button type="button" class="btn sm primary" id="ho-add">Add</button>
    </div>
    ${flowHtml()}
  </div>`;
  bind(el, () => renderSettings(el));
  el.querySelector("#ho-add")?.addEventListener("click", async () => {
    try {
      await api("/handoff/targets", { method: "POST", body: { name: el.querySelector("#ho-new-name").value, url: el.querySelector("#ho-new-url").value, note: el.querySelector("#ho-new-note").value } });
      toast("Target added");
      renderSettings(el);
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.save;
    try {
      await api(`/handoff/targets/${encodeURIComponent(id)}`, { method: "PATCH", body: { name: el.querySelector(`[data-name="${CSS.escape(id)}"]`).value, url: el.querySelector(`[data-url="${CSS.escape(id)}"]`).value, note: el.querySelector(`[data-note="${CSS.escape(id)}"]`).value } });
      toast("Target saved");
      renderSettings(el);
    } catch (e) { toast(e.message, true); }
  }));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/handoff/targets/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); toast("Target removed"); renderSettings(el); }
    catch (e) { toast(e.message, true); }
  }));
}

CC.register({
  id: "handoff",
  command: { order: 18, render: renderCommand },
  deliverable: { order: 8, render: renderDeliverable },
  settings: { order: 11, render: renderSettings },
  onEvent(ev) {
    if (ev.type === "fallback.skip" || ev.type === "fallback.clear" || ev.type === "provider.status") data = null;
    if (ev.type === "reportback.result") {
      const bit = String(ev.summary || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const msg = ev.status === "failed" ? "The other AI could not finish that job." : ev.status === "needs_input" ? "The other AI needs more from you." : "The other AI finished.";
      const body = bit ? `${msg} ${bit}` : msg;
      toast(body);
      try {
        if (window.ccDesktop?.notify) window.ccDesktop.notify("Meldmind", body);
        else if (typeof Notification === "function" && Notification.permission === "granted") new Notification("Meldmind", { body });
      } catch {}
    }
  },
});
