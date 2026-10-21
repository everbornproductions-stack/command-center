// Together: team spaces, AI group chat, rooms with live builds, and the news list.
const { api, toast, esc, $, $$ } = window.CC;

const SUPPORT_FALLBACK = "This persona is not a licensed therapist. If you are in crisis, call or text 988, the Suicide and Crisis Lifeline. Help is free, private, and available all day.";

let section = "spaces";

function bar(active) {
  const items = [["spaces", "Team spaces"], ["chat", "Group chat"], ["rooms", "Rooms"], ["news", "News"]];
  return `<div class="row" style="gap:8px;margin-bottom:14px">${items.map(([id, label]) => `<button type="button" class="btn sm ${active === id ? "primary" : ""}" data-sec="${id}">${label}</button>`).join("")}</div>`;
}

function wireBar(v) {
  $$("[data-sec]", v).forEach((b) => b.addEventListener("click", () => { section = b.dataset.sec; render(v); }));
}

async function drawSpaces(v) {
  v.innerHTML = `${bar("spaces")}<div class="empty">Loading team spaces...</div>`;
  let data;
  try { data = await api("/teamspaces"); }
  catch (e) { v.innerHTML = `${bar("spaces")}<div class="empty">${esc(e.message)}</div>`; wireBar(v); return; }
  const seats = data.seats || {};
  const lock = seats.message ? `<div class="panel" role="status"><h3>Team spaces</h3><p>${esc(seats.message)}</p><p class="dim small">Phase 8 teams stay on their own page. This does not replace them.</p></div>` : "";
  const cards = (data.spaces || []).map((s) => `<div class="panel" data-space="${esc(s.id)}">
    <h3>${esc(s.name)} <span class="chip">${esc(s.role)}</span> <span class="right">${s.seats} in this space</span></h3>
    <div class="dim small" style="margin-bottom:8px">${(s.members || []).map((m) => `${esc(m.email)} (${esc(m.role)}, ${esc(m.status)})`).join(", ") || "No one else yet. You count as one seat."}</div>
    ${(s.hiddenMembers ? `<div class="dim small">${s.hiddenMembers} blocked ${s.hiddenMembers === 1 ? "person is" : "people are"} hidden.</div>` : "")}
    <div class="small" style="margin:8px 0">${(s.projects || []).map((p) => `<span class="chip">${esc(p.name)}</span>`).join(" ") || `<span class="dim">No shared projects yet.</span>`}</div>
    <form class="row" data-invite style="gap:6px;margin-top:8px">
      <input type="email" required placeholder="teammate@example.com" aria-label="Email to invite" style="flex:1">
      <select aria-label="Role"><option value="member">member</option><option value="admin">admin</option><option value="viewer">viewer</option></select>
      <button class="btn sm" type="submit">Invite</button>
    </form>
    <div class="dim small" style="margin-top:6px">No email is sent. You get a link to pass on yourself. An invite uses a seat.</div>
    <div data-link></div>
    <div class="row" style="gap:6px;margin-top:8px">
      <select data-project aria-label="Project to share"><option value="">Share a project</option></select>
      <button type="button" class="btn sm" data-share>Share</button>
      <button type="button" class="ghost small" data-del>Delete space</button>
    </div>
  </div>`).join("");
  v.innerHTML = `${bar("spaces")}
    <div class="panel"><h3>Team spaces <span class="right">${seats.used || 0} of ${seats.limit ?? seats.cap ?? 5} seats</span></h3>
      <p class="dim small">Extreme includes 5 seats, counting you. Shared projects and roles live here. Studio teams are unchanged.</p>
      ${seats.open ? `<form id="ts-new" class="row" style="gap:6px"><input name="name" required maxlength="80" placeholder="Space name" aria-label="Team space name" style="flex:1"><button class="btn sm primary" type="submit">Create</button></form>` : ""}
    </div>
    ${lock}
    ${cards || (seats.open ? `<div class="empty">No team spaces yet.</div>` : "")}`;
  wireBar(v);
  const proj = $("#ts-new", v);
  const options = (window.CC.S.projects || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  $$("[data-project]", v).forEach((sel) => { sel.insertAdjacentHTML("beforeend", options); });
  proj?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get("name");
    try { await api("/teamspaces", { method: "POST", body: { name } }); toast("Team space created"); drawSpaces(v); }
    catch (err) { toast(err.message, true); }
  });
  $$("[data-space]", v).forEach((card) => {
    const id = card.dataset.space;
    card.querySelector("[data-invite]")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = e.target.querySelector("input").value.trim();
      const role = e.target.querySelector("select").value;
      try {
        const r = await api(`/teamspaces/${id}/members`, { method: "POST", body: { email, role } });
        const box = card.querySelector("[data-link]");
        box.innerHTML = `<div class="small" style="margin-top:8px">Link, shown once: <span class="mono">${esc(r.link)}</span></div>`;
        toast("Invite ready. Nothing was emailed.");
      } catch (err) { toast(err.message, true); }
    });
    card.querySelector("[data-share]")?.addEventListener("click", async () => {
      const projectId = card.querySelector("[data-project]").value;
      if (!projectId) return toast("Pick a project", true);
      try { await api(`/teamspaces/${id}/projects`, { method: "POST", body: { projectId } }); toast("Project shared"); drawSpaces(v); }
      catch (err) { toast(err.message, true); }
    });
    card.querySelector("[data-del]")?.addEventListener("click", async () => {
      if (!confirm("Delete this team space? Shared links are removed. Your projects stay.")) return;
      try { await api(`/teamspaces/${id}`, { method: "DELETE" }); toast("Team space deleted"); drawSpaces(v); }
      catch (err) { toast(err.message, true); }
    });
  });
}

async function drawChat(v) {
  v.innerHTML = `${bar("chat")}<div class="empty">Loading group chat...</div>`;
  let data;
  try { data = await api("/groupchat"); }
  catch (e) { v.innerHTML = `${bar("chat")}<div class="empty">${esc(e.message)}</div>`; wireBar(v, () => drawChat(v)); return; }
  const picked = new Set((data.members || []).map((m) => m.provider));
  const personaOf = Object.fromEntries((data.members || []).map((m) => [m.provider, m.persona]));
  const personas = data.personas || [];
  const rows = (data.ais || []).map((ai) => {
    const on = picked.has(ai.id);
    const persona = personaOf[ai.id] || "technical";
    return `<label class="row small" style="gap:8px;padding:4px 0">
      <input type="checkbox" data-ai="${esc(ai.id)}" data-model="${esc(ai.models[0].id)}" ${on ? "checked" : ""}>
      <span style="flex:1">${esc(ai.name)}</span>
      <select data-persona="${esc(ai.id)}" aria-label="Persona for ${esc(ai.name)}">${personas.map((p) => `<option value="${esc(p.id)}" ${p.id === persona ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select>
    </label>`;
  }).join("");
  const thread = (data.messages || []).map((m) => `<div class="panel" style="margin-top:8px"><div class="small"><b>You</b></div><div>${esc(m.text)}</div>
    ${(m.replies || []).map((r) => `<div style="margin-top:8px"><div class="small"><b>${esc(r.name)}</b> <span class="chip">${esc(r.persona)}</span></div>${(r.replies || []).map((line) => `<div>${esc(line)}</div>`).join("")}${r.error ? `<div class="dim small">${esc(r.error)}</div>` : ""}</div>`).join("")}
  </div>`).join("");
  v.innerHTML = `${bar("chat")}
    <div class="panel"><h3>Group chat <span class="right">up to ${data.max} AIs</span></h3>
      <p class="dim small">Each AI uses one persona and gives two or three short replies. Nothing is sent until you click Send.</p>
      ${rows || `<div class="empty">No AIs yet. Turn on demo mode or add a key.</div>`}
      <div id="gc-support" class="panel" role="note" hidden style="margin-top:10px"></div>
      <button type="button" class="btn sm" id="gc-save" style="margin-top:8px">Save who is in the chat</button>
    </div>
    <form id="gc-send" class="panel"><h3>Message</h3>
      <textarea id="gc-text" rows="3" maxlength="4000" aria-label="Message to the group" placeholder="Write to the group"></textarea>
      <button class="btn sm primary" type="submit" style="margin-top:8px">Send</button>
    </form>
    <div id="gc-thread">${thread}</div>`;
  wireBar(v, () => drawChat(v));
  const note = data.supportNote || SUPPORT_FALLBACK;
  const box = $("#gc-support", v);
  const refreshNote = () => {
    const on = $$("[data-ai]:checked", v).some((c) => c.parentElement.querySelector("select")?.value === "support");
    box.hidden = !on;
    box.textContent = on ? note : "";
  };
  $$("[data-ai], [data-persona]", v).forEach((el) => el.addEventListener("change", refreshNote));
  refreshNote();
  $("#gc-save", v)?.addEventListener("click", async () => {
    const members = $$("[data-ai]:checked", v).map((c) => ({ provider: c.dataset.ai, model: c.dataset.model, persona: c.parentElement.querySelector("select").value }));
    try { const r = await api("/groupchat/members", { method: "POST", body: { members } }); toast("Chat updated"); if (r.supportNote) { box.hidden = false; box.textContent = r.supportNote; } drawChat(v); }
    catch (err) { toast(err.message, true); }
  });
  $("#gc-send", v)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#gc-text", v).value.trim();
    if (!text) return toast("Write a message first", true);
    try { await api("/groupchat/send", { method: "POST", body: { text } }); toast("Sent"); drawChat(v); }
    catch (err) { toast(err.message, true); }
  });
}

async function drawRooms(v) {
  v.innerHTML = `${bar("rooms")}<div class="empty">Loading rooms...</div>`;
  let data;
  try { data = await api("/rooms"); }
  catch (e) { v.innerHTML = `${bar("rooms")}<div class="empty">${esc(e.message)}</div>`; wireBar(v, () => drawRooms(v)); return; }
  const open = v.dataset.open || "";
  let detail = "";
  if (open) {
    try {
      const room = await api(`/rooms/${open}`);
      detail = `<div class="panel" data-room="${esc(room.id)}"><h3>${esc(room.name)} <span class="chip">${esc(room.category)}</span></h3>
        <div class="dim small">${room.hub ? "" : "Watching stays on this PC. A hosted hub is not running."}</div>
        ${(room.messages || []).map((m) => `<div class="row small" style="gap:8px;padding:4px 0"><span style="flex:1"><b>${esc(m.author)}</b> ${esc(m.text)}</span>
          <button type="button" class="ghost small" data-hide="${esc(m.id)}">Hide</button>
          <button type="button" class="ghost small" data-report="${esc(m.id)}" data-type="message">Report</button></div>`).join("") || `<div class="dim small">No messages yet.</div>`}
        <form id="room-say" class="row" style="gap:6px;margin-top:8px"><input id="room-text" aria-label="Room message" placeholder="Message" style="flex:1"><button class="btn sm" type="submit">Send</button></form>
        <div class="row" style="gap:6px;margin-top:8px"><input id="room-who" aria-label="Person to add" placeholder="Person to add" style="flex:1"><button type="button" class="btn sm" id="room-add">Add</button></div>
        ${(room.members || []).map((m) => `<div class="row small"><span style="flex:1">${esc(m.name)}</span>${m.id === "you" ? "" : `<button type="button" class="ghost small" data-block="${esc(m.id)}">Block</button>`}</div>`).join("")}
        <div style="margin-top:8px"><b class="small">Live build</b>
          ${room.live ? `<div>${esc(room.live.title)} <span class="chip">${esc(room.live.status)}</span><div class="dim small">Now: ${esc(room.live.step)}</div><ul>${(room.live.tasks || []).map((t) => `<li>${esc(t.title)} (${esc(t.status)})</li>`).join("")}</ul>` : `<div class="dim small">No build is shared into this room yet.</div>`}
          <form id="room-live" class="row" style="gap:6px"><input id="room-mid" aria-label="Build id" placeholder="Build id" style="flex:1"><button class="btn sm" type="submit">Share build</button></form>
          <button type="button" class="btn sm" id="room-copy">Copy as a recipe</button>
        </div>
        <form id="room-report" class="row" style="gap:6px;margin-top:8px"><input id="room-why" aria-label="Why you are reporting this" placeholder="Why you are reporting this" style="flex:1"><button class="btn sm" type="submit">Report room</button></form>
      </div>`;
    } catch (e) { detail = `<div class="empty">${esc(e.message)}</div>`; }
  }
  const list = (data.rooms || []).map((r) => `<button type="button" class="btn sm" data-open="${esc(r.id)}">${esc(r.name)} <span class="dim">${esc(r.category)}</span></button>`).join(" ");
  const recipes = (data.recipes || []).map((r) => `<div class="row small" style="padding:4px 0"><span style="flex:1">${esc(r.title)} <span class="dim">${(r.steps || []).length} steps</span></span><button type="button" class="btn sm" data-run="${esc(r.id)}">Run recipe</button></div>`).join("");
  v.innerHTML = `${bar("rooms")}
    <div class="panel"><h3>Rooms</h3>
      <p class="dim small">${esc(data.note || "")}</p>
      <form id="room-new" class="row" style="gap:6px">
        <input name="name" required maxlength="80" aria-label="Room name" placeholder="Room name" style="flex:1">
        <select name="category" aria-label="Category">${(data.categories || []).map((c) => `<option>${esc(c)}</option>`).join("")}</select>
        <button class="btn sm primary" type="submit">Create room</button>
      </form>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${list || `<span class="dim small">No rooms yet.</span>`}</div>
    </div>
    ${detail}
    <div class="panel"><h3>Recipes</h3>${recipes || `<div class="dim small">Copy a live build to keep it as a recipe. Running it starts a mission after you click.</div>`}</div>`;
  v.dataset.open = open;
  wireBar(v, () => drawRooms(v));
  $("#room-new", v)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const room = await api("/rooms", { method: "POST", body: { name: fd.get("name"), category: fd.get("category") } });
      v.dataset.open = room.id;
      toast("Room created");
      drawRooms(v);
    } catch (err) { toast(err.message, true); }
  });
  $$("[data-open]", v).forEach((b) => b.addEventListener("click", () => { v.dataset.open = b.dataset.open; drawRooms(v); }));
  $("#room-say", v)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("#room-text", v).value.trim();
    try { await api(`/rooms/${open}/messages`, { method: "POST", body: { text } }); drawRooms(v); }
    catch (err) { toast(err.message, true); }
  });
  $("#room-add", v)?.addEventListener("click", async () => {
    const name = $("#room-who", v).value.trim();
    try { await api(`/rooms/${open}/members`, { method: "POST", body: { name } }); toast("Person added"); drawRooms(v); }
    catch (err) { toast(err.message, true); }
  });
  $$("[data-hide]", v).forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/rooms/${open}/messages/${b.dataset.hide}/hide`, { method: "POST", body: {} }); drawRooms(v); }
    catch (err) { toast(err.message, true); }
  }));
  $$("[data-report]", v).forEach((b) => b.addEventListener("click", async () => {
    const reason = prompt("Why are you reporting this?");
    if (!reason) return;
    try { await api(`/rooms/${open}/report`, { method: "POST", body: { targetType: b.dataset.type, targetId: b.dataset.report, reason } }); toast("Report saved on this PC. Nothing was sent."); }
    catch (err) { toast(err.message, true); }
  }));
  $$("[data-block]", v).forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/rooms/${open}/block`, { method: "POST", body: { key: b.dataset.block } }); toast("Blocked on this PC"); drawRooms(v); }
    catch (err) { toast(err.message, true); }
  }));
  $("#room-live", v)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api(`/rooms/${open}/live`, { method: "POST", body: { missionId: $("#room-mid", v).value.trim() } }); toast("Build shared into this room"); drawRooms(v); }
    catch (err) { toast(err.message, true); }
  });
  $("#room-copy", v)?.addEventListener("click", async () => {
    try { await api(`/rooms/${open}/recipe`, { method: "POST", body: {} }); toast("Copied as a recipe"); drawRooms(v); }
    catch (err) { toast(err.message, true); }
  });
  $("#room-report", v)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api(`/rooms/${open}/report`, { method: "POST", body: { targetType: "room", targetId: open, reason: $("#room-why", v).value } }); toast("Report saved on this PC. Nothing was sent."); }
    catch (err) { toast(err.message, true); }
  });
  $$("[data-run]", v).forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/rooms/recipes/${b.dataset.run}/start`, { method: "POST", body: {} }); toast("Recipe started"); }
    catch (err) { toast(err.message, true); }
  }));
}

async function drawNews(v) {
  v.innerHTML = `${bar("news")}<div class="empty">Loading news...</div>`;
  let data;
  try { data = await api("/newsfeed"); }
  catch (e) { v.innerHTML = `${bar("news")}<div class="empty">${esc(e.message)}</div>`; wireBar(v, () => drawNews(v)); return; }
  const items = (data.items || []).map((item) => `<div class="panel" style="margin-top:8px"><div class="small"><span class="chip">${esc(item.kind)}</span> ${esc(item.title)}</div>${item.body ? `<div class="dim small" style="margin-top:4px">${esc(item.body)}</div>` : ""}</div>`).join("");
  v.innerHTML = `${bar("news")}
    <div class="panel"><h3>News and alerts</h3><p class="dim small">${esc(data.note || "")}</p>
      <p class="dim small">Model version watching is not running yet. A note shows up here when one is recorded. Spend warnings come from your caps. Updates do not download on their own.</p>
    </div>
    ${items || `<div class="empty">Nothing new.</div>`}`;
  wireBar(v, () => drawNews(v));
}

function render(v) {
  if (section === "chat") return drawChat(v);
  if (section === "rooms") return drawRooms(v);
  if (section === "news") return drawNews(v);
  return drawSpaces(v);
}

window.CC.register({
  id: "together",
  tab: { label: "Together", short: "Together", order: 46, render },
});
