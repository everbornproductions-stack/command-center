// Google Calendar: list, create, and update. Nothing is written until a button is clicked.
const { api, toast, esc } = window.CC;

function render(el) {
  el.innerHTML = `<div class="panel" id="calendar-panel">
    <h3>Google Calendar</h3>
    <p class="dim small" id="cal-status">Checking the connection...</p>
    <div id="cal-body"></div>
  </div>`;
  load(el);
}

async function load(el) {
  const status = el.querySelector("#cal-status");
  const body = el.querySelector("#cal-body");
  let view;
  try { view = await api("/calendar"); }
  catch (e) { status.textContent = e.message; return; }
  if (!view.connected) {
    status.textContent = view.clientReady
      ? "Not connected. Connect uses your Google sign-in. Grok Bot can still take calendar work."
      : "Add the Google sign-in client in Settings, Browser helper, then connect. The secret stays in the vault.";
    body.innerHTML = view.clientReady ? `<button class="btn sm primary" type="button" id="cal-connect">Connect Google Calendar</button>` : "";
    body.querySelector("#cal-connect")?.addEventListener("click", async () => {
      try {
        const r = await api("/browser/google/start", { method: "POST", body: { origin: location.origin, calendar: true, keep: true } });
        window.open(r.url, "_blank", "noopener");
        toast("Sign in with Google. This page finishes the link when you come back.");
      } catch (e) { toast(e.message, true); }
    });
    return;
  }
  status.textContent = "Connected. Listing events does not change your calendar. Create and update run only when you click.";
  let events = [];
  try { events = (await api("/calendar/events")).events || []; }
  catch (e) { body.innerHTML = `<p class="dim small">${esc(e.message)}</p>`; return; }
  body.innerHTML = `
    <div id="cal-list">${events.length ? events.map(row).join("") : `<p class="dim small">No events in the next window.</p>`}</div>
    <div class="cat-h" style="margin-top:12px">New event</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
      <div><label class="lbl" for="cal-title">Title</label><input id="cal-title" type="text" maxlength="200"></div>
      <div><label class="lbl" for="cal-where">Location</label><input id="cal-where" type="text" maxlength="300"></div>
      <div><label class="lbl" for="cal-start">Start</label><input id="cal-start" type="datetime-local"></div>
      <div><label class="lbl" for="cal-end">End</label><input id="cal-end" type="datetime-local"></div>
    </div>
    <label class="lbl" for="cal-notes">Notes</label>
    <textarea id="cal-notes" rows="2"></textarea>
    <div class="row" style="margin-top:8px"><button class="btn sm primary" type="button" id="cal-add">Create event</button></div>`;
  body.querySelector("#cal-add").addEventListener("click", () => create(el));
  body.querySelectorAll("[data-cal-save]").forEach((btn) => btn.addEventListener("click", () => saveRow(el, btn.dataset.calSave)));
}

function row(ev) {
  return `<div class="row small" data-cal-row="${esc(ev.id)}" style="gap:8px;flex-wrap:wrap;margin-top:8px">
    <input type="text" data-cal-summary value="${esc(ev.summary || "")}" aria-label="Event title" maxlength="200" style="flex:1;min-width:160px">
    <span class="dim">${esc(ev.start || "")}</span>
    <button class="btn sm" type="button" data-cal-save="${esc(ev.id)}">Update</button>
    ${ev.link ? `<a href="${esc(ev.link)}" target="_blank" rel="noopener">Open</a>` : ""}
  </div>`;
}

async function create(el) {
  const v = (id) => el.querySelector(id)?.value || "";
  const start = v("#cal-start");
  const end = v("#cal-end");
  try {
    await api("/calendar/events", { method: "POST", body: {
      summary: v("#cal-title"),
      location: v("#cal-where"),
      description: v("#cal-notes"),
      start: start ? new Date(start).toISOString() : "",
      end: end ? new Date(end).toISOString() : "",
    } });
    toast("Event created");
    await load(el);
  } catch (e) { toast(e.message, true); }
}

async function saveRow(el, id) {
  const rowEl = el.querySelector(`[data-cal-row="${CSS.escape(id)}"]`);
  const summary = rowEl?.querySelector("[data-cal-summary]")?.value || "";
  try {
    await api(`/calendar/events/${encodeURIComponent(id)}`, { method: "POST", body: { summary } });
    toast("Event updated");
    await load(el);
  } catch (e) { toast(e.message, true); }
}

window.CC.register({
  id: "calendar",
  settings: { order: 5, render },
});
