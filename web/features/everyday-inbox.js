// Inbox and tasks. Try saying the examples. A reply waits for Send.
const { api, toast, esc, go } = window.CC;

const css = `
.ea-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 920px; }
.ea-card { background: var(--card-bg, #0e1726); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.ea-card h3 { margin: 0 0 6px; font-size: 16px; }
.ea-say { font-family: var(--mono); font-size: 13px; margin: 6px 0; }
.ea-steps { margin: 6px 0 0; padding-left: 18px; }
.ea-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ea-msg { padding: 8px 0; border-bottom: 1px solid var(--line); }
#ea-inbox-root textarea, #ea-inbox-root input[type="text"] { width: 100%; }
@media (max-width: 640px) { .ea-row .btn { width: 100%; } }
`;
if (!document.getElementById("ea-inbox-style")) {
  const style = document.createElement("style");
  style.id = "ea-inbox-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const TOUR = [
  { id: "ea-inbox", title: "Inbox summary", say: "What needs me today in all my inboxes?", body: "Try saying: What needs me today in all my inboxes? Meldmind reads the connected mailboxes and lists what needs a reply. Nothing is sent." },
  { id: "ea-reply", title: "Reply in my tone", say: "Reply to Dana, say yes to Thursday", body: "Try saying: Reply to Dana, say yes to Thursday. The draft uses your tone. It is sent only when you click Send, and the click uses the To, subject, and body on screen." },
  { id: "ea-remind", title: "Reminders and to-dos", say: "Remind me at 5 to call Mom", body: "Try saying: Remind me at 5 to call Mom. Or: Remind me to renew my license next month. These stay on this computer." },
];

window.CC.everydaySteps = [...(window.CC.everydaySteps || []), ...TOUR.map((s) => ({
  id: s.id, for: "both", view: "everyday-inbox", target: "#ea-inbox-root", title: s.title, body: s.body,
}))];

let data = null;
let summary = null;
let draft = null;
let tourAt = -1;

async function load() {
  data = await api("/everyday-inbox");
}

function howtoHtml() {
  const rows = data?.howto || [];
  return rows.map((h) => `<div class="ea-card" id="howto-${esc(h.id)}">
    <h3>How to: ${esc(h.title)}</h3>
    <div class="ea-say">Try saying: ${esc(h.say)}</div>
    <ol class="ea-steps">${(h.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
  </div>`).join("");
}

function summaryHtml() {
  if (!summary) return `<div class="dim small">No summary yet. Try the example, or connect Google with read Gmail.</div>`;
  const accounts = summary.accounts || [];
  return `<div class="small dim">${summary.sample ? "Sample mailboxes. Not your mail." : "From the connected mailboxes."} Nothing was sent.</div>
    ${accounts.map((a) => `<div class="ea-msg"><b>${esc(a.label)}</b> <span class="dim">${a.count} message${a.count === 1 ? "" : "s"}</span>
      ${a.note ? `<div class="dim small">${esc(a.note)}</div>` : ""}
      ${a.error ? `<div class="dim small">${esc(a.error)}</div>` : ""}
      ${(a.headlines || []).map((m) => `<div class="small" style="margin-top:4px">${m.newsletter ? `<span class="chip">Newsletter</span> ` : ""}<b>${esc(m.subject || "(no subject)")}</b> from ${esc(m.from || "")}<div class="dim">${esc(m.snippet || "")}</div>
        ${m.newsletter ? "" : `<button type="button" class="btn sm" data-reply="${esc(m.id)}" data-from="${esc(m.from)}" data-subject="${esc(m.subject)}" data-account="${esc(a.id)}">Draft a reply</button>`}
      </div>`).join("")}
    </div>`).join("")}
    ${(summary.needs || []).length ? `<div class="small" style="margin-top:8px"><b>Needs a reply:</b> ${summary.needs.map((n) => esc(n.subject)).join(", ")}</div>` : ""}`;
}

function draftHtml() {
  if (!draft) return "";
  return `<div class="ea-card" id="ea-draft">
    <h3>Draft, not sent</h3>
    <label class="small">To<input type="text" id="ea-to" value="${esc(draft.to || "")}"></label>
    <label class="small">Subject<input type="text" id="ea-subject" value="${esc(draft.subject || "")}"></label>
    <label class="small">Body<textarea id="ea-body" rows="6">${esc(draft.body || "")}</textarea></label>
    ${draft.toneNote ? `<div class="dim small">Tone: ${esc(draft.toneNote)}</div>` : ""}
    <div class="ea-row" style="margin-top:8px"><button type="button" class="btn sm primary" id="ea-send">Send</button><button type="button" class="btn sm" id="ea-personas" title="See how real people would react to this draft, then fix it in one click">Test with personas</button><span class="dim small">Send uses the To, subject, and body above.</span></div>
  </div>`;
}

function listHtml() {
  const reminders = data?.reminders || [];
  const todos = data?.todos || [];
  const row = (item, kind) => `<div class="ea-row" style="margin-top:6px"><span>${item.done ? "Done: " : ""}${esc(item.title)}</span>${item.at ? `<span class="dim small">${esc(new Date(item.at).toLocaleString())}</span>` : ""}${item.due ? `<span class="chip">Due</span>` : ""}<button type="button" class="btn sm" data-done="${esc(kind)}:${esc(item.id)}">Done</button><button type="button" class="ghost small" data-remove="${esc(kind)}:${esc(item.id)}">Remove</button></div>`;
  return `<div class="ea-card"><h3>Reminders</h3>${reminders.map((r) => row(r, "reminders")).join("") || `<div class="dim small">None yet.</div>`}</div>
    <div class="ea-card"><h3>To-dos</h3>${todos.map((r) => row(r, "todos")).join("") || `<div class="dim small">None yet.</div>`}</div>`;
}

function render(root) {
  root.innerHTML = `<div class="ea-wrap" id="ea-inbox-root">
    <div class="ea-card">
      <h3>Inbox and tasks</h3>
      <div class="dim small">Read and draft freely. A reply goes out only when you click Send. Reminders stay on this computer. No password is stored.</div>
      <div class="ea-row" style="margin-top:8px">
        <button type="button" class="btn sm primary" id="ea-try">Try this example</button>
        <button type="button" class="btn sm" id="ea-live">Summarize connected inboxes</button>
        <button type="button" class="btn sm" id="ea-tour">Show the examples</button>
        <button type="button" class="ghost small" id="ea-help">Help</button>
      </div>
      <div class="ea-say" id="ea-say">Try saying: ${esc(data?.trySaying?.inbox || "")}</div>
      <label class="small">Reply instruction<input type="text" id="ea-instruction" value="${esc(data?.trySaying?.reply || "")}" aria-label="What the reply should say"></label>
      ${tourAt >= 0 ? `<div class="ea-card" id="ea-spot"><b>${esc(TOUR[tourAt].title)}</b><div>${esc(TOUR[tourAt].body)}</div><div class="ea-row" style="margin-top:8px"><button type="button" class="btn sm" id="ea-tour-next">${tourAt === TOUR.length - 1 ? "Finish" : "Next"}</button></div></div>` : ""}
    </div>
    <div class="ea-card" id="ea-summary">${summaryHtml()}</div>
    ${draftHtml()}
    <div class="ea-card">
      <h3>Add in plain text</h3>
      <div class="ea-say">Try saying: ${esc(data?.trySaying?.remind || "")}</div>
      <div class="ea-say">Try saying: ${esc(data?.trySaying?.todo || "")}</div>
      <input type="text" id="ea-plain" maxlength="500" placeholder="Remind me at 5 to call Mom" aria-label="Reminder or to-do">
      <div class="ea-row" style="margin-top:8px"><button type="button" class="btn sm primary" id="ea-add">Add</button></div>
    </div>
    ${listHtml()}
    <h3 style="margin:0">How to</h3>
    ${howtoHtml()}
  </div>`;
  root.querySelector("#ea-try")?.addEventListener("click", () => runSummary(true));
  root.querySelector("#ea-live")?.addEventListener("click", () => runSummary(false));
  root.querySelector("#ea-tour")?.addEventListener("click", () => { tourAt = 0; render(root); });
  root.querySelector("#ea-tour-next")?.addEventListener("click", () => { tourAt = tourAt >= TOUR.length - 1 ? -1 : tourAt + 1; render(root); });
  root.querySelector("#ea-help")?.addEventListener("click", () => go("help"));
  root.querySelector("#ea-add")?.addEventListener("click", () => addPlain(root));
  root.querySelector("#ea-send")?.addEventListener("click", () => send(root));
  // Test with personas: a revised body goes back in the box; nothing is sent
  root.querySelector("#ea-personas")?.addEventListener("click", () => {
    const body = root.querySelector("#ea-body");
    window.CC.testWithPersonas?.({ text: body?.value || "", kind: "email", onUse: (next) => { if (body) body.value = next; } });
  });
  root.querySelectorAll("[data-reply]").forEach((b) => b.addEventListener("click", () => makeDraft(root, b)));
  root.querySelectorAll("[data-done]").forEach((b) => b.addEventListener("click", () => mark(root, b.dataset.done, "done")));
  root.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => mark(root, b.dataset.remove, "remove")));
}

async function runSummary(sample) {
  try {
    summary = await api("/everyday-inbox/summary", { method: "POST", body: { sample } });
    if (sample) {
      const dana = (summary.needs || []).find((n) => /dana/i.test(n.from || ""));
      if (dana) {
        const made = await api("/everyday-inbox/draft", { method: "POST", body: { from: dana.from, subject: dana.subject, instruction: data?.trySaying?.reply || "Reply to Dana, say yes to Thursday", messageId: dana.id, accountId: dana.accountId } });
        draft = made.draft;
      }
    }
    toast(sample ? "Sample summary is ready. Nothing was sent." : "Summary is ready. Nothing was sent.");
    render(document.getElementById("view"));
  } catch (e) { toast(e.message, true); }
}

async function makeDraft(root, b) {
  const instruction = root.querySelector("#ea-instruction")?.value || data?.trySaying?.reply || "";
  if (!instruction) return;
  try {
    const made = await api("/everyday-inbox/draft", { method: "POST", body: { from: b.dataset.from, subject: b.dataset.subject, instruction, messageId: b.dataset.reply, accountId: b.dataset.account } });
    draft = made.draft;
    toast("Draft is ready. It is not sent.");
    render(root);
  } catch (e) { toast(e.message, true); }
}

async function send(root) {
  if (!draft) return;
  const to = root.querySelector("#ea-to")?.value || "";
  const subject = root.querySelector("#ea-subject")?.value || "";
  const body = root.querySelector("#ea-body")?.value || "";
  try {
    const out = await api(`/everyday-inbox/drafts/${encodeURIComponent(draft.id)}/send`, { method: "POST", body: { confirm: true, to, subject, body } });
    draft = out.draft;
    toast(`Sent to ${out.draft.to}`);
    render(root);
  } catch (e) { toast(e.message, true); }
}

async function addPlain(root) {
  const text = root.querySelector("#ea-plain")?.value || "";
  try {
    await api("/everyday-inbox/plain", { method: "POST", body: { text } });
    await load();
    toast("Saved on this computer.");
    render(root);
  } catch (e) { toast(e.message, true); }
}

async function mark(root, key, action) {
  const [kind, id] = String(key).split(":");
  try {
    if (action === "done") await api(`/everyday-inbox/${kind}/${encodeURIComponent(id)}/done`, { method: "POST", body: {} });
    else await api(`/everyday-inbox/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
    render(root);
  } catch (e) { toast(e.message, true); }
}

async function renderTab(root) {
  try { await load(); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  render(root);
}

window.CC.register({
  id: "everyday-inbox",
  tab: { label: "Inbox and tasks", short: "Inbox", icon: "✉", order: 18, render: renderTab },
});
