// Phase 33 item 1. HighLevel contacts, invoices, and workflows.
// A write shows a preview. The request goes out only after Confirm.
const { api, toast, esc } = window.CC;

const FIELDS = ["query", "name", "email", "phone", "contactId", "amount", "title", "workflowId", "channel", "text"];

async function render(el) {
  let data;
  try { data = await api("/highlevel"); }
  catch (e) { el.innerHTML = `<div class="panel"><h3>HighLevel</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const connect = data.connect || {};
  const actions = data.actions || [];
  el.innerHTML = `<div class="panel"><h3>HighLevel contacts, invoices, and workflows <span class="right">${connect.connected ? "connected" : "not connected"}</span></h3>
    <p class="small" style="margin:6px 0 0">${esc(data.note || "")}</p>
    <div class="small dim" style="margin-top:6px">${esc(connect.scopeLabel || "Connect the HighLevel contacts app under Publishing. Social posting stays on its own scopes.")}</div>
    ${connect.account ? `<div class="small" style="margin-top:4px">Account: ${esc(connect.account)}</div>` : ""}
    <div class="small dim" style="margin-top:4px">${esc(connect.setup || "Add the client ID under Settings, Publishing, on the HighLevel contacts row, then connect.")}</div>
    <label class="lbl" style="margin-top:10px">Action</label>
    <select id="hl-action" aria-label="HighLevel action">${actions.map((a) => `<option value="${esc(a.id)}">${esc(a.description)}</option>`).join("")}</select>
    ${FIELDS.map((k) => `<label class="small" style="display:block;margin-top:8px">${esc(k)}<input id="hl-${esc(k)}" style="width:100%"></label>`).join("")}
    <div class="row" style="gap:8px;margin-top:10px">
      <button class="btn sm" type="button" id="hl-preview">Preview</button>
      <button class="btn sm primary" type="button" id="hl-go" hidden>Confirm</button>
    </div>
    <div id="hl-out" class="small" style="margin-top:8px"></div>
  </div>`;
  let planId = "";
  const read = () => {
    const body = { action: el.querySelector("#hl-action").value };
    for (const k of FIELDS) body[k] = el.querySelector(`#hl-${k}`).value;
    return body;
  };
  el.querySelector("#hl-preview").addEventListener("click", async () => {
    const out = el.querySelector("#hl-out");
    const go = el.querySelector("#hl-go");
    planId = "";
    go.hidden = true;
    try {
      const r = await api("/highlevel/preview", { method: "POST", body: read() });
      if (r.needsClick) {
        planId = r.planId;
        go.hidden = false;
        out.textContent = `${r.summary} Nothing was sent. Confirm when this is what you want.`;
      } else {
        out.textContent = `${r.summary} ${JSON.stringify(r.result || {})}`;
      }
    } catch (e) { out.textContent = e.message; toast(e.message, true); }
  });
  el.querySelector("#hl-go").addEventListener("click", async () => {
    const out = el.querySelector("#hl-out");
    if (!planId) return;
    try {
      const r = await api("/highlevel/run", { method: "POST", body: { planId, confirmed: true } });
      out.textContent = `${r.summary || "Done."} ${JSON.stringify(r.result || {})}`;
      el.querySelector("#hl-go").hidden = true;
      planId = "";
      toast(r.sent ? "Sent after your click." : "Saved after your click.");
    } catch (e) { out.textContent = e.message; toast(e.message, true); }
  });
}

window.CC.register({ id: "highlevel", settings: { order: 48, render } });
