// One sentence becomes an email draft and a calendar event. Approve is the only send.
const { api, toast, esc } = window.CC;

const EXAMPLE = "email this client and put it on my calendar";

function render(el) {
  el.innerHTML = `<div class="panel" id="plain-request">
    <h3>Try saying...</h3>
    <p class="dim small">Try saying: ${esc(EXAMPLE)}. A cheap fast AI drafts the email and the event and shows the cost. Meldmind sends the email and adds the event only after you click Approve once. No outside AI touches your accounts.</p>
    <label class="lbl" for="plain-text">Request</label>
    <textarea id="plain-text" rows="3" placeholder="Try saying: ${esc(EXAMPLE)}"></textarea>
    <div class="row" style="margin-top:8px;gap:8px">
      <button class="btn sm primary" type="button" id="plain-draft">Draft</button>
    </div>
    <div id="plain-out"></div>
  </div>`;
  el.querySelector("#plain-draft").addEventListener("click", () => makeDraft(el));
}

function field(id, label, value, extra = "") {
  return `<div><label class="lbl" for="${id}">${esc(label)}</label><input id="${id}" type="text" value="${esc(value || "")}" ${extra}></div>`;
}

function showDraft(el, item) {
  const out = el.querySelector("#plain-out");
  const email = item.email;
  const event = item.event;
  const done = item.status === "done";
  out.innerHTML = `
    <p class="small" id="plain-cost" style="margin-top:10px">${esc(item.note || "")}</p>
    ${email ? `<div class="cat-h">Email draft</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
        ${field("plain-to", "To", email.to)}
        ${field("plain-subject", "Subject", email.subject)}
      </div>
      <label class="lbl" for="plain-body">Body</label>
      <textarea id="plain-body" rows="4">${esc(email.body || "")}</textarea>` : ""}
    ${event ? `<div class="cat-h">Calendar event</div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
        ${field("plain-summary", "Title", event.summary)}
        ${field("plain-where", "Location", event.location)}
        ${field("plain-start", "Start", event.start)}
        ${field("plain-end", "End", event.end)}
      </div>` : ""}
    <p class="dim small">${item.ready?.gmail && item.ready?.calendar ? "Gmail sending and Calendar are connected." : "Connect Gmail sending and Google Calendar before you approve. Nothing is sent until then."}</p>
    <div class="row" style="margin-top:8px;gap:8px">
      <button class="btn sm primary" type="button" id="plain-approve" ${done ? "disabled" : ""}>${done ? "Approved" : "Approve"}</button>
    </div>
    <div id="plain-result" class="small" style="margin-top:8px">${done ? resultLine(item) : ""}</div>`;
  out.querySelector("#plain-approve")?.addEventListener("click", () => doApprove(el, item.id));
}

function resultLine(item) {
  const bits = [];
  if (item.emailSent) bits.push(`Email sent to ${item.emailSent.to?.join?.(", ") || item.email?.to || "the address"}.`);
  if (item.eventCreated?.summary) bits.push(`Event created: ${item.eventCreated.summary}.`);
  return esc(bits.join(" "));
}

function edits(el) {
  const v = (id) => el.querySelector(id)?.value;
  const body = {};
  if (el.querySelector("#plain-to")) body.email = { to: v("#plain-to"), subject: v("#plain-subject"), body: v("#plain-body") };
  if (el.querySelector("#plain-summary")) body.event = { summary: v("#plain-summary"), location: v("#plain-where"), start: v("#plain-start"), end: v("#plain-end"), description: "" };
  return body;
}

async function makeDraft(el) {
  const text = el.querySelector("#plain-text").value;
  const btn = el.querySelector("#plain-draft");
  btn.disabled = true;
  try {
    const item = await api("/actions/draft", { method: "POST", body: { text } });
    showDraft(el, item);
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
}

async function doApprove(el, id) {
  const btn = el.querySelector("#plain-approve");
  if (btn) btn.disabled = true;
  try {
    const item = await api(`/actions/${encodeURIComponent(id)}/approve`, { method: "POST", body: edits(el) });
    showDraft(el, item);
    toast("Approved. Meldmind sent it through the connected accounts.");
  } catch (e) {
    if (btn) btn.disabled = false;
    toast(e.message, true);
  }
}

window.CC.register({
  id: "actions",
  command: { order: 2, render },
});
