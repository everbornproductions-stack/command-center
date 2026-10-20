// Day plan: briefing, email to a task or hold, and find a time. Send is a separate click.
const { api, toast, esc, go } = window.CC;

const css = `
.ep-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 920px; }
.ep-card { background: #0e1726; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.ep-card h3 { margin: 0 0 6px; font-size: 16px; }
.ep-say { font-family: var(--mono); font-size: 13px; margin: 6px 0; }
.ep-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ep-wrap textarea, .ep-wrap input[type="text"], .ep-wrap input[type="number"] { width: 100%; }
@media (max-width: 640px) { .ep-row .btn { width: 100%; } }
`;
if (!document.getElementById("ep-style")) {
  const style = document.createElement("style");
  style.id = "ep-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const TOUR = [
  { id: "ep-brief", title: "Morning briefing", body: "Try saying: Every weekday at 8: agenda, inbox, tasks, weather, and news. The briefing only reads. Nothing is sent." },
  { id: "ep-extract", title: "Email to a task or a hold", body: "Try saying: Turn this email into a task and a calendar hold. Saving writes a task and a hold on this computer. It does not write Google Calendar." },
  { id: "ep-slots", title: "Find a time", body: "Try saying: Find 3 open 30 min slots next week for Ana. The email stays a draft until you click Send." },
];
window.CC.everydaySteps = [...(window.CC.everydaySteps || []), ...TOUR.map((s) => ({
  id: s.id, for: "both", view: "everyday-plan", target: "#ep-root", title: s.title, body: s.body,
}))];

let data = null;
let preview = null;
let draft = null;
let output = null;
let tourAt = -1;

async function load() { data = await api("/everyday-plan"); }

function render(root) {
  const say = data?.trySaying || {};
  root.innerHTML = `<div class="ep-wrap" id="ep-root">
    <div class="ep-card">
      <h3>Day plan</h3>
      <div class="dim small">${esc(data?.safety || "")}</div>
      <div class="ep-row" style="margin-top:8px"><button type="button" class="btn sm" id="ep-tour">Show the examples</button><button type="button" class="ghost small" id="ep-help">Help</button></div>
      ${tourAt >= 0 ? `<div class="ep-card" id="ep-spot"><b>${esc(TOUR[tourAt].title)}</b><div>${esc(TOUR[tourAt].body)}</div><button type="button" class="btn sm" id="ep-next" style="margin-top:8px">${tourAt === TOUR.length - 1 ? "Finish" : "Next"}</button></div>` : ""}
    </div>
    <div class="ep-card">
      <h3>Morning briefing</h3>
      <div class="ep-say">Try saying: ${esc(say.brief || "")}</div>
      <div class="ep-row">
        <label class="small">City<input type="text" id="ep-city" maxlength="80" aria-label="City for the weather line"></label>
        <button type="button" class="btn sm primary" id="ep-routine">Save weekday 8:00 routine</button>
        <button type="button" class="btn sm" id="ep-prep">Prepare now</button>
      </div>
      <div class="dim small" style="margin-top:6px">Free includes one routine. Weather and news are not fetched.</div>
      ${(data?.routines || []).map((r) => `<div class="small">${esc(r.name)} at ${r.hour}:${String(r.minute).padStart(2, "0")}${r.city ? ` · ${esc(r.city)}` : ""}</div>`).join("")}
      ${output ? `<div style="margin-top:8px">${(output.sections || []).map((s) => `<div><b>${esc(s.title)}</b><ul>${(s.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("")}</div>` : ""}
    </div>
    <div class="ep-card">
      <h3>Email to a task or a hold</h3>
      <div class="ep-say">Try saying: ${esc(say.extract || "")}</div>
      <input type="text" id="ep-from" placeholder="From" aria-label="From">
      <input type="text" id="ep-subject" placeholder="Subject" aria-label="Subject" style="margin-top:6px">
      <textarea id="ep-body" rows="4" placeholder="Paste the email" aria-label="Email body" style="margin-top:6px"></textarea>
      <div class="ep-row" style="margin-top:8px"><button type="button" class="btn sm" id="ep-preview">Preview</button><button type="button" class="btn sm primary" id="ep-save">Save task and hold</button></div>
      ${preview ? `<div class="small" style="margin-top:8px">Task: ${esc(preview.task?.title || "")}${preview.hold ? `<br>Hold: ${esc(new Date(preview.hold.start).toLocaleString())} to ${esc(new Date(preview.hold.end).toLocaleString())} on this computer` : "<br>No time found, so there is no hold."}</div>` : ""}
      ${(data?.holds || []).map((h) => `<div class="ep-row" style="margin-top:6px"><span>${esc(h.title)} · ${esc(new Date(h.start).toLocaleString())} · local</span><button type="button" class="ghost small" data-hold="${esc(h.id)}">Remove hold</button></div>`).join("")}
    </div>
    <div class="ep-card">
      <h3>Find a time</h3>
      <div class="ep-say">Try saying: ${esc(say.slots || "")}</div>
      <div class="ep-row">
        <input type="text" id="ep-name" placeholder="Ana" aria-label="Person">
        <input type="text" id="ep-to" placeholder="ana@client.test" aria-label="Email address">
        <input type="number" id="ep-mins" value="30" min="15" max="240" aria-label="Minutes">
      </div>
      <div class="ep-row" style="margin-top:8px"><button type="button" class="btn sm" id="ep-slots">Draft the options</button></div>
      ${draft ? `<label class="small">To<input type="text" id="ep-dto" value="${esc(draft.to)}"></label>
        <label class="small">Subject<input type="text" id="ep-dsub" value="${esc(draft.subject)}"></label>
        <label class="small">Body<textarea id="ep-dbody" rows="6">${esc(draft.body)}</textarea></label>
        <button type="button" class="btn sm primary" id="ep-send">Send</button>` : ""}
    </div>
    <h3 style="margin:0">How to</h3>
    ${(data?.howto || []).map((h) => `<div class="ep-card"><h3>How to: ${esc(h.title)}</h3><div class="ep-say">Try saying: ${esc(h.say)}</div><ol>${(h.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("")}
  </div>`;
  root.querySelector("#ep-tour")?.addEventListener("click", () => { tourAt = 0; render(root); });
  root.querySelector("#ep-next")?.addEventListener("click", () => { tourAt = tourAt >= TOUR.length - 1 ? -1 : tourAt + 1; render(root); });
  root.querySelector("#ep-help")?.addEventListener("click", () => go("help"));
  root.querySelector("#ep-routine")?.addEventListener("click", () => saveRoutine(root));
  root.querySelector("#ep-prep")?.addEventListener("click", () => prep(root));
  root.querySelector("#ep-preview")?.addEventListener("click", () => extract(root, false));
  root.querySelector("#ep-save")?.addEventListener("click", () => extract(root, true));
  root.querySelector("#ep-slots")?.addEventListener("click", () => slots(root));
  root.querySelector("#ep-send")?.addEventListener("click", () => send(root));
  root.querySelectorAll("[data-hold]").forEach((b) => b.addEventListener("click", () => dropHold(root, b.dataset.hold)));
}

function emailFrom(root) {
  return { from: root.querySelector("#ep-from")?.value || "", subject: root.querySelector("#ep-subject")?.value || "", body: root.querySelector("#ep-body")?.value || "" };
}
async function saveRoutine(root) {
  try {
    await api("/everyday-plan/routines", { method: "POST", body: { name: "Weekday morning", hour: 8, minute: 0, weekdays: true, city: root.querySelector("#ep-city")?.value || "" } });
    await load(); toast("Routine saved. It only prepares a briefing."); render(root);
  } catch (e) { toast(e.message, true); }
}
async function prep(root) {
  try {
    output = await api("/everyday-plan/prepare", { method: "POST", body: { sample: true } });
    toast("Briefing prepared. Nothing was sent."); render(root);
  } catch (e) { toast(e.message, true); }
}
async function extract(root, save) {
  try {
    const path = save ? "/everyday-plan/extract/save" : "/everyday-plan/extract";
    const out = await api(path, { method: "POST", body: emailFrom(root) });
    preview = out.task ? out : out;
    if (!save) preview = out;
    if (save) { await load(); toast("Saved on this computer. Google Calendar was not written."); }
    render(root);
  } catch (e) { toast(e.message, true); }
}
async function dropHold(root, id) {
  try { await api(`/everyday-plan/holds/${encodeURIComponent(id)}`, { method: "DELETE" }); await load(); render(root); } catch (e) { toast(e.message, true); }
}
async function slots(root) {
  try {
    const out = await api("/everyday-plan/slots", { method: "POST", body: {
      name: root.querySelector("#ep-name")?.value || "Ana",
      to: root.querySelector("#ep-to")?.value || "",
      minutes: Number(root.querySelector("#ep-mins")?.value) || 30,
      count: 3, days: 7,
    } });
    draft = out.draft;
    toast("Draft is ready. Nothing was sent.");
    render(root);
  } catch (e) { toast(e.message, true); }
}
async function send(root) {
  if (!draft) return;
  try {
    const out = await api(`/everyday-plan/drafts/${encodeURIComponent(draft.id)}/send`, { method: "POST", body: {
      confirm: true,
      to: root.querySelector("#ep-dto")?.value || "",
      subject: root.querySelector("#ep-dsub")?.value || "",
      body: root.querySelector("#ep-dbody")?.value || "",
    } });
    draft = out.draft;
    toast(`Sent to ${out.draft.to}`);
    render(root);
  } catch (e) { toast(e.message, true); }
}
async function renderTab(root) {
  try { await load(); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  render(root);
}
window.CC.register({ id: "everyday-plan", tab: { label: "Day plan", short: "Day plan", icon: "☀", order: 19, render: renderTab } });
