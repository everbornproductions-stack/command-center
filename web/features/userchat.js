// People chat (Phase 92). Direct messages and small groups. Send is a click.
// Report and block stay on this computer. Nothing goes out until Send.
const { api, toast, esc } = window.CC;

let openId = "";
let draft = "";
let reportFor = "";

function hubLine(d) {
  if (d.hub?.configured && d.hub.mode === "hosted") return "This computer is the hub, so messages are stored here.";
  if (d.hub?.configured && d.hub.host) return `A hub is set (${d.hub.host}). Send keeps a copy here and hands the message to that hub.`;
  return "Local only until you set up a hub.";
}

async function renderTab(view) {
  let d;
  try { d = await api("/userchat"); }
  catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (openId && !(d.threads || []).some((t) => t.id === openId)) openId = "";
  const thread = (d.threads || []).find((t) => t.id === openId) || null;
  const spaces = d.spaces || [];
  view.innerHTML = `<div id="uc-root" class="grid" style="grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: 14px">
    <div class="panel"><h3>People</h3>
      <div class="row small muted" style="gap:8px;flex-wrap:wrap;align-items:center"><span>${esc(hubLine(d))}</span>${d.hub?.configured ? "" : `<button type="button" class="btn sm" id="uc-setup-hub">Set up hub</button>`}</div>
      <form id="uc-hub-form" hidden class="small" style="margin-top:6px"><div class="dim">A hub lets you chat with people on other computers. Paste the web address whoever runs your hub gave you. You can leave this empty and keep chatting on this computer only.</div><div class="row" style="gap:6px;margin-top:4px"><input name="hub" type="text" aria-label="Hub address" placeholder="https://your-hub.example.com" style="flex:1"><button class="btn sm primary" type="submit">Save hub</button></div><div id="uc-hub-msg" class="dim small" role="status"></div></form>
      ${spaces.length ? spaces.map((s) => `<div class="cat-h" style="margin-top:10px">${esc(s.name)}</div>
        ${(s.members || []).map((m) => `<div class="row small" style="gap:6px;padding:3px 0">
          <span style="flex:1">${esc(m.email)} <span class="dim">${esc(m.role)}</span></span>
          ${s.role === "viewer" ? "" : `<button class="btn sm" type="button" data-dm="${esc(s.id)}" data-email="${esc(m.email)}">Message</button>`}
          <label class="dim small"><input type="checkbox" data-pick="${esc(s.id)}" value="${esc(m.email)}" aria-label="Add ${esc(m.email)} to a group"> Group</label>
        </div>`).join("") || `<div class="dim small">No one else is in this team space yet.</div>`}
        ${s.role === "viewer" ? `<div class="dim small">You can read this team space. A viewer cannot send.</div>` : `<button class="btn sm" type="button" data-group="${esc(s.id)}" style="margin-top:6px">Start group chat</button>`}
      `).join("") : `<div class="empty">Chat with people you invite. This is part of Extreme. <button type="button" class="btn sm" id="uc-plans">See plans</button><div class="dim small" style="margin-top:8px">Nothing is sent until you click Send.</div></div>`}
      ${(d.blocks || []).length ? `<div class="cat-h" style="margin-top:12px">Blocked</div>` + d.blocks.map((b) => `<div class="row small" style="gap:6px"><span style="flex:1">${esc(b.key)}</span><button class="ghost small" type="button" data-unblock="${esc(b.key)}">Unblock</button></div>`).join("") : ""}
    </div>
    <div class="panel"><h3>${thread ? esc(thread.title || "Chat") : "Chat"}</h3>
      ${thread ? `<div class="dim small" style="margin-bottom:8px">${esc((thread.members || []).join(", "))}</div>
        <div id="uc-log" style="min-height:120px">${(thread.messages || []).map((m) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">
          <b>${esc(m.from)}</b> <span class="dim">${esc(m.text)}</span>
          <div class="row" style="gap:6px;margin-top:4px">
            <button class="ghost small" type="button" data-report="${esc(m.id)}">Report</button>
            ${m.from === d.me ? "" : `<button class="ghost small" type="button" data-block="${esc(m.from)}">Block</button>`}
          </div>
          ${reportFor === m.id ? `<form data-report-form="${esc(m.id)}" class="row" style="gap:6px;margin-top:4px"><input type="text" required maxlength="500" aria-label="Why you are reporting this" placeholder="Why are you reporting this?" style="flex:1"><button class="btn sm" type="submit">File report</button></form>` : ""}
        </div>`).join("") || `<div class="dim small">No messages yet. Nothing is sent until you click Send.</div>`}
        <form id="uc-send" class="row" style="gap:8px;margin-top:10px">
          <input id="uc-text" type="text" maxlength="2000" aria-label="Message" placeholder="Write a message" value="${esc(draft)}" style="flex:1">
          <button class="btn sm primary" type="submit">Send</button>
        </form>` : `<div class="empty">Pick a person, or start a small group. Nothing is sent until you click Send.</div>`}
      ${(d.reports || []).length ? `<div class="dim small" style="margin-top:8px">${d.reports.length} report${d.reports.length === 1 ? "" : "s"} saved on this computer. Nothing was sent.</div>` : ""}
    </div>
  </div>`;
  view.querySelector("#uc-setup-hub")?.addEventListener("click", () => {
    const f = view.querySelector("#uc-hub-form");
    if (f) { f.hidden = !f.hidden; f.querySelector("input")?.focus(); }
  });
  view.querySelector("#uc-hub-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = view.querySelector("#uc-hub-msg");
    const url = String(new FormData(e.target).get("hub") || "").trim();
    if (msg) msg.textContent = "Checking the address...";
    try {
      const r = await api("/userchat/hub", { method: "POST", body: { url } });
      if (r.ok) { toast(r.cleared ? "Hub removed. People chat is local only." : "Hub saved."); renderTab(view); }
      else if (msg) msg.textContent = r.message || "That address did not work. Nothing was changed.";
    } catch (err) { if (msg) msg.textContent = err.message; }
  });
  view.querySelector("#uc-plans")?.addEventListener("click", () => {
    const S = window.CC.S;
    if (S) { S.settingsMore = true; S.navFocus = "#settings-plan"; }
    window.CC.go?.("settings");
  });
  const box = view.querySelector("#uc-text");
  if (box) box.addEventListener("input", () => { draft = box.value; });
  view.querySelectorAll("[data-dm]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await api("/userchat/threads", { method: "POST", body: { spaceId: b.dataset.dm, with: b.dataset.email } });
      openId = r.thread?.id || "";
      draft = "";
      renderTab(view);
    } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", async () => {
    const picked = [...view.querySelectorAll(`[data-pick="${globalThis.CSS.escape(b.dataset.group)}"]:checked`)].map((el) => el.value);
    if (picked.length < 2) { toast("Pick at least two people for a group.", true); return; }
    try {
      const r = await api("/userchat/threads", { method: "POST", body: { spaceId: b.dataset.group, members: picked } });
      openId = r.thread?.id || "";
      draft = "";
      renderTab(view);
    } catch (err) { toast(err.message, true); }
  }));
  view.querySelector("#uc-send")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = view.querySelector("#uc-text")?.value || "";
    try {
      const r = await api(`/userchat/threads/${encodeURIComponent(openId)}/messages`, { method: "POST", body: { text } });
      draft = "";
      toast(r.hub?.delivered ? "Sent. A copy stayed here, and the hub took it." : "Saved on this computer.");
      renderTab(view);
    } catch (err) { toast(err.message, true); }
  });
  view.querySelectorAll("[data-report]").forEach((b) => b.addEventListener("click", () => { reportFor = reportFor === b.dataset.report ? "" : b.dataset.report; renderTab(view); }));
  view.querySelectorAll("[data-report-form]").forEach((form) => form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const reason = form.querySelector("input")?.value || "";
    try {
      await api("/userchat/report", { method: "POST", body: { targetType: "message", targetId: form.dataset.reportForm, reason } });
      reportFor = "";
      toast("Report saved on this computer.");
      renderTab(view);
    } catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll("[data-block]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/userchat/block", { method: "POST", body: { email: b.dataset.block } }); toast("Blocked on this computer."); renderTab(view); }
    catch (err) { toast(err.message, true); }
  }));
  view.querySelectorAll("[data-unblock]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/userchat/unblock", { method: "POST", body: { email: b.dataset.unblock } }); toast("Unblocked."); renderTab(view); }
    catch (err) { toast(err.message, true); }
  }));
}

window.CC.register({ id: "userchat", tab: { label: "People", short: "People", icon: "☺", order: 36, render: renderTab } });
