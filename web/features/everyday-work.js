// Docs, meeting prep, and lead drafts. Send and save are separate clicks.
const { api, toast, esc, go } = window.CC;

const css = `
.ew-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 920px; }
.ew-card { background: #0e1726; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.ew-card h3 { margin: 0 0 6px; font-size: 16px; }
.ew-say { font-family: var(--mono); font-size: 13px; margin: 6px 0; }
.ew-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ew-wrap textarea, .ew-wrap input[type="text"] { width: 100%; }
@media (max-width: 640px) { .ew-row .btn { width: 100%; } }
`;
if (!document.getElementById("ew-style")) {
  const style = document.createElement("style");
  style.id = "ew-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const TOUR = [
  { id: "ew-docs", title: "Find and summarize a doc", body: "Try saying: Find the Q3 proposal and summarize it. Drive and Notion are only read. A saved copy stays on this computer." },
  { id: "ew-meet", title: "Meeting prep", body: "Try saying: Prep me for my 2pm. A transcript summary lists to-dos. This build does not record calls. Adding to-dos is a click." },
  { id: "ew-lead", title: "New lead follow-up", body: "Try saying: When a new HighLevel lead comes in, draft a text and email. Send is one click. Twilio is not contacted." },
];
window.CC.everydaySteps = [...(window.CC.everydaySteps || []), ...TOUR.map((s) => ({
  id: s.id, for: "both", view: "everyday-work", target: "#ew-root", title: s.title, body: s.body,
}))];

let data = null;
let found = null;
let prep = null;
let summary = null;
let lead = null;
let tourAt = -1;

async function load() { data = await api("/everyday-work"); }

function render(root) {
  const say = data?.trySaying || {};
  root.innerHTML = `<div class="ew-wrap" id="ew-root">
    <div class="ew-card">
      <h3>Docs and follow-up</h3>
      <div class="dim small">${esc(data?.safety || "")}</div>
      <div class="ew-row" style="margin-top:8px"><button type="button" class="btn sm" id="ew-tour">Show the examples</button><button type="button" class="ghost small" id="ew-help">Help</button></div>
      ${tourAt >= 0 ? `<div class="ew-card" id="ew-spot"><b>${esc(TOUR[tourAt].title)}</b><div>${esc(TOUR[tourAt].body)}</div><button type="button" class="btn sm" id="ew-next" style="margin-top:8px">${tourAt === TOUR.length - 1 ? "Finish" : "Next"}</button></div>` : ""}
    </div>
    <div class="ew-card">
      <h3>Find and summarize a doc</h3>
      <div class="ew-say">Try saying: ${esc(say.docs || "")}</div>
      <input type="text" id="ew-q" aria-label="What to find" placeholder="Q3 proposal">
      <div class="ew-row" style="margin-top:8px"><button type="button" class="btn sm" id="ew-find">Find</button></div>
      ${(found?.notes || []).map((n) => `<div class="dim small">${esc(n)}</div>`).join("")}
      ${(found?.matches || []).map((hit, i) => `<div class="small" style="margin-top:8px"><b>${esc(hit.title)}</b> <span class="dim">${esc(hit.source)}</span><div>${esc(hit.summary)}</div><button type="button" class="btn sm" data-save="${i}">Save a copy</button></div>`).join("")}
    </div>
    <div class="ew-card">
      <h3>Meeting prep</h3>
      <div class="ew-say">Try saying: ${esc(say.prep || "")}</div>
      <div class="ew-say">Try saying: ${esc(say.transcript || "")}</div>
      <input type="text" id="ew-title" aria-label="Meeting title" placeholder="Q3 proposal review">
      <input type="text" id="ew-at" aria-label="When" placeholder="2:00 pm" style="margin-top:6px">
      <textarea id="ew-notes" rows="2" aria-label="Notes" placeholder="Notes" style="margin-top:6px"></textarea>
      <textarea id="ew-script" rows="4" aria-label="Transcript" placeholder="Paste a transcript. This build does not record calls." style="margin-top:6px"></textarea>
      <div class="ew-row" style="margin-top:8px"><button type="button" class="btn sm" id="ew-add">Save meeting</button><button type="button" class="btn sm" id="ew-prep">Prep me</button><button type="button" class="btn sm" id="ew-sum">Summarize</button><button type="button" class="btn sm primary" id="ew-tasks">Add the to-dos</button></div>
      ${prep ? `<ul>${(prep.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${summary ? `<div class="small"><b>Summary</b><div>${esc(summary.summary || "")}</div><b>Action items</b><ul>${(summary.actions || []).map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
    </div>
    <div class="ew-card">
      <h3>New lead follow-up</h3>
      <div class="ew-say">Try saying: ${esc(say.lead || "")}</div>
      <div class="dim small">${esc(data?.notice || "")} HighLevel is not called. Pro is required.</div>
      <div class="ew-row" style="margin-top:8px">
        <input type="text" id="ew-name" aria-label="Lead name" placeholder="Ana">
        <input type="text" id="ew-email" aria-label="Lead email" placeholder="ana@client.test">
        <input type="text" id="ew-phone" aria-label="Lead phone" placeholder="+15555550100">
      </div>
      <textarea id="ew-lead-note" rows="2" aria-label="Lead note" placeholder="What they asked" style="margin-top:6px"></textarea>
      <div class="ew-row" style="margin-top:8px"><button type="button" class="btn sm" id="ew-draft">Draft the follow-up</button></div>
      ${lead ? `<label class="small">Email to ${esc(lead.drafts?.email?.to || "")}<textarea id="ew-email-body" rows="4">${esc(lead.drafts?.email?.body || "")}</textarea></label>
        <div class="dim small">Subject: ${esc(lead.drafts?.email?.subject || "")}</div>
        <button type="button" class="btn sm primary" id="ew-send-email">Send email</button>
        <label class="small">Text to ${esc(lead.drafts?.sms?.to || "")}<textarea id="ew-sms-body" rows="3">${esc(lead.drafts?.sms?.body || "")}</textarea></label>
        <button type="button" class="btn sm primary" id="ew-send-sms">Send text</button>` : ""}
    </div>
    <h3 style="margin:0">How to</h3>
    ${(data?.howto || []).map((h) => `<div class="ew-card"><h3>How to: ${esc(h.title)}</h3><div class="ew-say">Try saying: ${esc(h.say)}</div><ol>${(h.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("")}
  </div>`;
  root.querySelector("#ew-tour")?.addEventListener("click", () => { tourAt = 0; render(root); });
  root.querySelector("#ew-next")?.addEventListener("click", () => { tourAt = tourAt >= TOUR.length - 1 ? -1 : tourAt + 1; render(root); });
  root.querySelector("#ew-help")?.addEventListener("click", () => go("help"));
  root.querySelector("#ew-find")?.addEventListener("click", () => find(root));
  root.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", () => saveCopy(root, Number(b.dataset.save))));
  root.querySelector("#ew-add")?.addEventListener("click", () => addMeeting(root));
  root.querySelector("#ew-prep")?.addEventListener("click", () => prepMeeting(root));
  root.querySelector("#ew-sum")?.addEventListener("click", () => sumMeeting(root));
  root.querySelector("#ew-tasks")?.addEventListener("click", () => addTasks(root));
  root.querySelector("#ew-draft")?.addEventListener("click", () => draftLead(root));
  root.querySelector("#ew-send-email")?.addEventListener("click", () => sendLead(root, "email"));
  root.querySelector("#ew-send-sms")?.addEventListener("click", () => sendLead(root, "sms"));
}

let meetingId = "";

async function find(root) {
  try { found = await api("/everyday-work/find", { method: "POST", body: { q: root.querySelector("#ew-q")?.value || "" } }); render(root); }
  catch (e) { toast(e.message, true); }
}
async function saveCopy(root, i) {
  const hit = found?.matches?.[i];
  if (!hit) return;
  try {
    await api("/everyday-work/save", { method: "POST", body: { confirm: true, title: hit.title, text: hit.summary } });
    toast("Saved a copy on this computer.");
    await load(); render(root);
  } catch (e) { toast(e.message, true); }
}
function meetingBody(root) {
  return {
    title: root.querySelector("#ew-title")?.value || "",
    at: root.querySelector("#ew-at")?.value || "",
    notes: root.querySelector("#ew-notes")?.value || "",
    transcript: root.querySelector("#ew-script")?.value || "",
  };
}
async function addMeeting(root) {
  try { const r = await api("/everyday-work/meetings", { method: "POST", body: meetingBody(root) }); meetingId = r.meeting.id; toast("Meeting saved on this computer."); await load(); render(root); }
  catch (e) { toast(e.message, true); }
}
async function prepMeeting(root) {
  if (!meetingId) return toast("Save the meeting first.", true);
  try { prep = await api(`/everyday-work/meetings/${encodeURIComponent(meetingId)}/prep`, { method: "POST", body: {} }); render(root); }
  catch (e) { toast(e.message, true); }
}
async function sumMeeting(root) {
  if (!meetingId) return toast("Save the meeting first.", true);
  try { summary = await api(`/everyday-work/meetings/${encodeURIComponent(meetingId)}/summary`, { method: "POST", body: {} }); render(root); }
  catch (e) { toast(e.message, true); }
}
async function addTasks(root) {
  if (!meetingId) return toast("Save the meeting first.", true);
  try { summary = await api(`/everyday-work/meetings/${encodeURIComponent(meetingId)}/tasks`, { method: "POST", body: { confirm: true } }); toast(summary.saved ? "To-dos added on this computer." : "Nothing new to add."); await load(); render(root); }
  catch (e) { toast(e.message, true); }
}
async function draftLead(root) {
  try {
    const r = await api("/everyday-work/leads", { method: "POST", body: {
      name: root.querySelector("#ew-name")?.value || "",
      email: root.querySelector("#ew-email")?.value || "",
      phone: root.querySelector("#ew-phone")?.value || "",
      note: root.querySelector("#ew-lead-note")?.value || "",
    } });
    lead = r.lead; render(root);
  } catch (e) { toast(e.message, true); }
}
async function sendLead(root, channel) {
  if (!lead) return;
  const draft = lead.drafts?.[channel];
  if (!draft) return;
  const body = channel === "email" ? (root.querySelector("#ew-email-body")?.value || draft.body) : (root.querySelector("#ew-sms-body")?.value || draft.body);
  try {
    const r = await api(`/everyday-work/leads/${encodeURIComponent(lead.id)}/send`, { method: "POST", body: { confirm: true, channel, to: draft.to, subject: draft.subject || "", body } });
    toast(r.notice || "Recorded on this computer.");
    await load(); render(root);
  } catch (e) { toast(e.message, true); }
}

window.CC.register({
  id: "everyday-work",
  tab: { label: "Docs and follow-up", order: 46, async render(view) {
    view.innerHTML = `<div class="ew-wrap" id="ew-root"><div class="dim small">Loading docs and follow-up...</div></div>`;
    try { await load(); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    render(view);
  } },
});
