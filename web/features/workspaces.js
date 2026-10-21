// Teams and shared workspaces (Phase 8, Studio): invite people with a role (admin, member, viewer) through
// an invite link (nothing is emailed), share chosen projects, see AI usage per member, and switch the
// active workspace from the header. Roles and permissions come from the server (PERMISSIONS table).
const { S, api, toast, esc, money, fmtN, favicon, $, $$ } = window.CC;

let data = null; // last GET /api/workspaces
const ROLE_HELP = {
  owner: "everything, including deleting the workspace",
  admin: "invite and remove members and viewers, share projects, see everyone's usage",
  member: "sees shared projects; their AI calls count toward the workspace",
  viewer: "read-only: sees shared projects, nothing else",
};

async function load() { data = await api("/workspaces"); renderSwitcher(); return data; }
const all = () => [...(data?.owned || []), ...(data?.memberOf || [])];

// ---------- header switcher ----------
function renderSwitcher() {
  const host = $(".top-right"); if (!host || !data) return;
  let sel = $("#ws-switch");
  const list = all();
  if (!list.length) { sel?.closest(".ws-switch")?.remove(); return; }
  if (!sel) {
    const wrap = document.createElement("label"); wrap.className = "ws-switch row small"; wrap.style.gap = "6px"; wrap.title = "Active workspace: AI calls you make count toward it";
    wrap.innerHTML = `<span class="dim">Workspace</span><select id="ws-switch" aria-label="Active workspace"></select>`;
    host.prepend(wrap); sel = $("#ws-switch");
    sel.addEventListener("change", async () => {
      try { await api("/workspaces/active", { method: "POST", body: { id: sel.value || null } }); data.active = sel.value || null; toast(sel.value ? `Working in ${sel.selectedOptions[0].textContent}` : "Working in Personal"); if (S.view === "workspaces") window.CC.render(); }
      catch (e) { toast(e.message, true); sel.value = data.active || ""; }
    });
  }
  sel.innerHTML = `<option value="">Personal</option>` + list.map((w) => `<option value="${esc(w.id)}" ${data.active === w.id ? "selected" : ""}>${esc(w.name)} (${esc(w.role)})</option>`).join("");
  sel.value = data.active || "";
}

function projectTiles(p) {
  return `<div class="cat-h" style="margin-top:8px">${esc(p.name)}</div>` + (p.categories || []).map((c) => `<div class="small muted" style="margin:4px 0 2px">${esc(c.name)}</div>
    <div class="links">${(c.links || []).map((l) => `<a class="linkt" href="${esc(l.url)}" target="_blank" rel="noopener"><img src="${favicon(l.url)}" alt=""><span>${esc(l.name)}</span></a>`).join("") || `<div class="dim small">No links.</div>`}</div>`).join("");
}

function usageTable(w) {
  const month = new Date().toISOString().slice(0, 7);
  const rows = (w.usage || []).filter((u) => u.month === month);
  const byEmail = {};
  for (const u of rows) { const b = (byEmail[u.email || u.userId] ||= { calls: 0, cost: 0 }); b.calls += u.calls; b.cost += u.cost; }
  if (w.permissions["usage.viewAll"]) for (const e of [data.me, ...w.members.filter((m) => m.role !== "viewer").map((m) => m.email)].filter(Boolean)) byEmail[e] ||= { calls: 0, cost: 0 };
  const entries = Object.entries(byEmail);
  return `<table class="tbl small" style="width:100%"><thead><tr><th>Member</th><th style="text-align:right">Calls</th><th style="text-align:right">Spend</th></tr></thead><tbody>
    ${entries.map(([e, b]) => `<tr><td>${esc(e)}${e === data.me ? ' <span class="dim">(you)</span>' : ""}</td><td style="text-align:right" class="mono">${fmtN(b.calls)}</td><td style="text-align:right" class="mono">${money(b.cost, 3)}</td></tr>`).join("") || `<tr><td colspan="3" class="dim">No calls this month yet.</td></tr>`}
  </tbody></table><div class="dim small" style="margin-top:4px">This month, AI calls made while this workspace was picked in the header switcher${w.permissions["usage.viewAll"] ? "" : " (you see only your own)"}.</div>`;
}

function roleSelect(current, options, attrs = "") {
  return `<select ${attrs} class="small">${options.map((r) => `<option value="${r}" ${r === current ? "selected" : ""}>${r}</option>`).join("")}</select>`;
}
const grantable = (actor) => (actor === "owner" ? ["admin", "member", "viewer"] : actor === "admin" ? ["member", "viewer"] : []);
const canTouch = (actor, target) => (actor === "owner" ? target !== "owner" : actor === "admin" ? ["member", "viewer"].includes(target) : false);

function manageCard(w) {
  const mine = S.projects || [];
  const shared = new Set((w.projects || []).map((p) => p.id));
  const perm = w.permissions;
  const roles = grantable(w.role);
  const member = (m) => `<div class="row small" style="padding:3px 0;gap:6px"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${esc(m.email)}</span>
      <span class="chip ${m.status === "active" ? "green" : "amber"}">${m.status === "active" ? "joined" : m.expiresAt && m.expiresAt < Date.now() ? "invite expired" : "invited"}</span>
      ${perm["members.role"] && canTouch(w.role, m.role) ? roleSelect(m.role, roles, `data-role="${esc(m.email)}" aria-label="Role for ${esc(m.email)}"`) : `<span class="chip">${esc(m.role)}</span>`}
      ${perm["members.remove"] && canTouch(w.role, m.role) ? `<button class="ghost small" data-rm="${esc(m.email)}">remove</button>` : ""}
      ${perm["members.invite"] && m.status !== "active" && canTouch(w.role, m.role) ? `<button class="ghost small" data-relink="${esc(m.email)}" data-r="${esc(m.role)}">new link</button>` : ""}</div>`;
  return `<div class="panel" data-ws="${esc(w.id)}"><h3>${esc(w.name)} <span class="chip">${esc(w.role)}</span><span class="right">${w.members.length} member${w.members.length === 1 ? "" : "s"} · ${shared.size} shared project${shared.size === 1 ? "" : "s"}</span>
      ${perm["workspace.rename"] ? `<button class="ghost small" data-rename>rename</button>` : ""}${perm["workspace.delete"] ? `<button class="ghost small" data-del style="color:var(--red)">delete</button>` : ""}</h3>
    <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 14px">
      <div>
        <label class="lbl">Team</label>
        ${w.members.map(member).join("") || `<div class="dim small">Nobody yet.</div>`}
        ${perm["members.invite"] ? `<form class="row" data-invite style="margin-top:8px;gap:6px"><input type="email" required placeholder="teammate@example.com" style="flex:1" aria-label="Email to invite">${roleSelect("member", roles, 'aria-label="Role"')}<button class="btn sm" type="submit">Invite</button></form>
        <div data-link></div>
        <div class="dim small" style="margin-top:6px">No email is sent. You get an invite link to send yourself; it works for that address only and expires in 14 days.${data.hosted ? "" : " On this desktop copy, people join through your hosted hub."}</div>` : ""}
      </div>
      <div>
        <label class="lbl">Shared projects</label>
        ${perm["projects.share"] ? (mine.map((p) => `<label class="row small" style="padding:3px 0;gap:8px"><input type="checkbox" data-share="${esc(p.id)}" ${shared.has(p.id) ? "checked" : ""}><span class="dot" style="background:${esc(p.color || "#22d3ee")}"></span>${esc(p.name)}</label>`).join("") || `<div class="dim small">Create a project first (Projects tab).</div>`)
          : (w.projects || []).map(projectTiles).join("") || `<div class="dim small">Nothing shared yet.</div>`}
        ${perm["projects.share"] && data.hosted && shared.size ? `<button class="ghost small" data-sync style="margin-top:6px">push latest links to members</button>` : ""}
      </div>
    </div>
    <div style="margin-top:12px"><label class="lbl">Usage by member</label>${usageTable(w)}</div>
  </div>`;
}

function readCard(w) {
  return `<div class="panel" data-ws="${esc(w.id)}"><h3>${esc(w.name)} <span class="chip">${esc(w.role)}</span><span class="right">shared with you</span></h3>
    <div class="dim small" style="margin-bottom:6px">Your role: ${esc(w.role)}, ${esc(ROLE_HELP[w.role] || "")}.</div>
    ${(w.projects || []).map(projectTiles).join("") || `<div class="dim small">The owner has not shared a project yet.</div>`}
    ${w.permissions["usage.count"] ? `<div style="margin-top:12px"><label class="lbl">Your usage</label>${usageTable(w)}</div>` : ""}</div>`;
}
const card = (w) => (w.permissions["members.invite"] || w.permissions["projects.share"] ? manageCard(w) : readCard(w));

async function render(v) {
  v.innerHTML = `<div class="empty">Loading workspaces...</div>`;
  try { await load(); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const gateCard = !data.studio ? `<div class="panel" style="border-color:var(--violet)"><h3>Studio feature <span class="right">your tier: ${esc(data.tier)}</span></h3>
      <div>Teams let you invite teammates or clients with a role, share only the projects you choose, and see each member's AI usage. Creating a workspace is part of <b>Studio</b>; add a Studio licence in Settings. Workspaces others shared with you still show below.</div></div>` : "";
  const localNote = !data.hosted ? `<div class="dim small" style="margin-bottom:12px">Desktop copy: workspaces you set up here are kept on this PC and work offline. Teammates join through the hosted hub (docs/hosted-hub.md).</div>` : "";
  const roleKey = `<details class="small" style="margin-top:4px"><summary class="dim">What each role can do</summary>${Object.entries(ROLE_HELP).map(([r, t]) => `<div><b>${r}</b>: ${esc(t)}</div>`).join("")}</details>`;
  const active = all().find((w) => w.id === data.active);
  v.innerHTML = `<div style="max-width:1100px;margin:0 auto" class="grid">
    ${gateCard}${localNote}
    <div class="panel"><h3>Active workspace <span class="right">${active ? `${esc(active.name)} (${esc(active.role)})` : "Personal"}</span></h3>
      <div class="dim small">Pick a workspace in the header switcher. AI calls you make while it is picked count toward that workspace's usage.</div>${roleKey}</div>
    ${data.studio ? `<div class="panel"><h3>New workspace</h3><form class="row" id="ws-new"><input type="text" required placeholder="e.g. Snap Credit Fix team" style="flex:1" maxlength="80" aria-label="Workspace name"><button class="btn sm primary" type="submit">Create</button></form></div>` : ""}
    ${data.owned.length ? `<div class="cat-h">Your workspaces</div>` : ""}
    ${data.owned.map(card).join("")}
    ${data.memberOf.length ? `<div class="cat-h">Shared with you</div>` : ""}
    ${data.memberOf.map(card).join("")}
    ${!data.owned.length && !data.memberOf.length && data.studio ? `<div class="empty">No workspaces yet. Create one, invite someone with a role, tick the projects to share.</div>` : ""}
    <div id="team-spaces"></div>
  </div>`;
  window.CC.mountTeamSpaces?.(v.querySelector("#team-spaces"));
  const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); await render(v); return r; } catch (e) { toast(e.message, true); } };
  const showLink = (cardEl, r) => {
    if (!r?.link) return;
    const box = cardEl.querySelector("[data-link]"); if (!box) return;
    box.innerHTML = `<div class="small" style="margin-top:8px;padding:8px;border:1px solid var(--line-2);border-radius:10px">Invite link for <b>${esc(r.email)}</b> as ${esc(r.role)} (shown once):
      <div class="row" style="gap:6px;margin-top:4px"><input class="mono" readonly value="${esc(r.link)}" style="flex:1" aria-label="Invite link"><button class="btn sm" type="button" data-copy>Copy</button></div></div>`;
    box.querySelector("[data-copy]").addEventListener("click", () => { navigator.clipboard?.writeText(r.link); toast("Invite link copied"); });
  };
  const invite = async (id, email, role) => {
    try {
      const r = await api(`/workspaces/${id}/members`, { method: "POST", body: { email, role } });
      await render(v);
      const el = $(`[data-ws="${CSS.escape(id)}"]`, v); if (el) showLink(el, r);
      toast(`${email} invited as ${role}. Copy the link and send it yourself.`);
    } catch (e) { toast(e.message, true); }
  };
  $("#ws-new", v)?.addEventListener("submit", (e) => { e.preventDefault(); const name = e.target.querySelector("input").value.trim(); if (name) act(() => api("/workspaces", { method: "POST", body: { name } }), "Workspace created"); });
  $$("[data-ws]", v).forEach((cardEl) => {
    const id = cardEl.dataset.ws;
    cardEl.querySelector("[data-del]")?.addEventListener("click", () => { if (confirm("Delete this workspace? Members lose access; your projects are not touched.")) act(() => api(`/workspaces/${id}`, { method: "DELETE" }), "Workspace deleted"); });
    cardEl.querySelector("[data-rename]")?.addEventListener("click", () => { const name = prompt("New name for this workspace"); if (name?.trim()) act(() => api(`/workspaces/${id}`, { method: "PATCH", body: { name: name.trim() } }), "Renamed"); });
    cardEl.querySelector("[data-invite]")?.addEventListener("submit", (e) => { e.preventDefault(); const email = e.target.querySelector("input").value.trim(); const role = e.target.querySelector("select").value; if (email) invite(id, email, role); });
    cardEl.querySelectorAll("[data-relink]").forEach((b) => b.addEventListener("click", () => invite(id, b.dataset.relink, b.dataset.r)));
    cardEl.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", () => act(() => api(`/workspaces/${id}/members/${encodeURIComponent(s.dataset.role)}`, { method: "PATCH", body: { role: s.value } }), `Role changed to ${s.value}`)));
    cardEl.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { if (confirm(`Remove ${b.dataset.rm} from this workspace?`)) act(() => api(`/workspaces/${id}/members/${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" }), "Member removed"); }));
    cardEl.querySelectorAll("[data-share]").forEach((cb) => cb.addEventListener("change", () => act(() => cb.checked ? api(`/workspaces/${id}/projects`, { method: "POST", body: { projectId: cb.dataset.share } }) : api(`/workspaces/${id}/projects/${encodeURIComponent(cb.dataset.share)}`, { method: "DELETE" }), cb.checked ? "Project shared" : "Project unshared")));
    cardEl.querySelector("[data-sync]")?.addEventListener("click", () => act(() => api(`/workspaces/${id}/sync`, { method: "POST" }), "Members now see the latest links"));
  });
}

// invite links look like https://hub/#join=<code>; accept once after sign-in, then clear the code from the address bar
let joinTried = false;
async function tryJoin() {
  if (joinTried) return; const m = location.hash.match(/join=([A-Za-z0-9_-]{16,64})/); if (!m) return;
  joinTried = true;
  try { await api("/workspaces/join", { method: "POST", body: { code: m[1] } }); toast("You joined the workspace"); await load(); }
  catch (e) { toast(e.message, true); }
  finally { history.replaceState(null, "", location.pathname + location.search); }
}

let loadedOnce = false;
CC.register({
  id: "workspaces",
  tab: { label: "Teams", short: "Teams", icon: "⚑", order: 40, render },
  onState() { if (!loadedOnce) { loadedOnce = true; load().catch(() => {}); } tryJoin(); },
});
