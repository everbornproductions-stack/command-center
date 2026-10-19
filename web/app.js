import { AgentGraph } from "/graph.js";

// ---------------- state ----------------
const S = {
  providers: [], ledger: null, subscriptions: [], subscriptionTotals: null, projects: [], hq: null, missions: [], settings: {}, skills: {}, vault: null, capabilities: [],
  view: "command", project: localStorage.getItem("cc.project") || "", live: newLive(), feed: [], activeByProvider: {}, routePreview: null, openProject: null,
};
function newLive() { return { id: null, kind: null, status: null, agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null }; }
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v, d = 2) => "$" + Number(v || 0).toFixed(d);
const fmtN = (v) => Number(v || 0).toLocaleString();
const P = (id) => S.providers.find((p) => p.id === id);
const pname = (id) => P(id)?.name || (String(id).startsWith("demo-") ? `${String(id).slice(5).replace(/^./, (c) => c.toUpperCase())} (demo)` : id);
const pcolor = (id) => P(id)?.color || "#22d3ee";
const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600) | 0}h` : `${(s / 86400) | 0}d`; };
const favicon = (url) => { try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`; } catch { return ""; } };

// ---------------- hub address + session ----------------
// The UI can talk to a hub other than the one that served it (a phone shell pointing at the hosted
// hub, or the desktop app pointing at it). ?hub= or #hub= in the URL sets it; it is remembered.
const HUB = (() => {
  try {
    const u = new URL(location.href);
    const h = u.searchParams.get("hub") || new URLSearchParams(u.hash.replace(/^#/, "")).get("hub");
    if (h) { localStorage.setItem("cc.hub", h.replace(/\/$/, "")); u.searchParams.delete("hub"); u.hash = ""; history.replaceState(null, "", u.pathname + u.search); }
  } catch {}
  const v = (localStorage.getItem("cc.hub") || "").replace(/\/$/, "");
  return v && v !== location.origin ? v : "";
})();
const hubAddress = () => HUB || location.origin;
let CONFIG = { mode: "local" };
// Local mode: the server injects a per-launch session token into index.html; every /api call carries it
// (X-CC-Token) and it is the first WebSocket message, so a foreign web page cannot drive this console.
const TOKEN = document.querySelector('meta[name="cc-token"]')?.content || "";
let AUTH = (() => { try { return JSON.parse(localStorage.getItem("cc.auth") || "null"); } catch { return null; } })();
function saveAuth(a) { AUTH = a; try { if (a) localStorage.setItem("cc.auth", JSON.stringify(a)); else localStorage.removeItem("cc.auth"); } catch {} }
// After the magic link, Supabase sends the browser back with the session in the URL hash.
function captureAuthFromHash() {
  if (!location.hash.includes("access_token=")) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  const at = h.get("access_token"); if (!at) return false;
  saveAuth({ access_token: at, refresh_token: h.get("refresh_token"), expires_at: Number(h.get("expires_at")) * 1000 || Date.now() + Number(h.get("expires_in") || 3600) * 1000 });
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}
async function ensureFreshToken() {
  if (!AUTH) return null;
  if (AUTH.expires_at - Date.now() > 60000 || !AUTH.refresh_token || !CONFIG.supabase) return AUTH.access_token;
  try {
    const r = await fetch(`${CONFIG.supabase.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: CONFIG.supabase.anonKey, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: AUTH.refresh_token }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || "refresh failed");
    saveAuth({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
    return AUTH.access_token;
  } catch (e) { signOut(false, "Your session expired. Sign in again."); return null; }
}
async function signOut(tellServer = true, message = "") {
  const a = AUTH; saveAuth(null);
  if (tellServer && a && CONFIG.supabase) fetch(`${CONFIG.supabase.url}/auth/v1/logout`, { method: "POST", headers: { apikey: CONFIG.supabase.anonKey, authorization: `Bearer ${a.access_token}` } }).catch(() => {});
  try { ws?.close(); } catch {}
  clearTimeout(wsTimer);
  renderGate(message);
}

async function apiHeaders() {
  const headers = { "content-type": "application/json" };
  if (CONFIG.mode === "hosted") { const t = await ensureFreshToken(); if (t) headers.authorization = `Bearer ${t}`; }
  else if (TOKEN) headers["x-cc-token"] = TOKEN;
  return headers;
}
async function api(path, opts = {}) {
  const headers = await apiHeaders();
  const r = await fetch(HUB + "/api" + path, { headers, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401 && CONFIG.mode === "hosted") { signOut(false, "Signed out. Sign in again."); throw new Error("Sign in required"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
// Fetch a non-JSON API response (download, QR image) with the same auth headers; returns a blob: URL.
async function apiBlobUrl(path) {
  const r = await fetch(HUB + "/api" + path, { headers: await apiHeaders() });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.statusText); }
  return URL.createObjectURL(await r.blob());
}
function downloadBlob(url, filename) { const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function toast(msg, err = false) {
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.textContent = msg;
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3500);
}

// ---------------- markdown (small, safe) ----------------
function md(src) {
  if (!src) return "";
  let s = esc(src);
  const blocks = [];
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (m, l, c) => { blocks.push(`<pre><code>${c}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.*\|\n?)*)/gm, (m, h, sep, rows) => {
    const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
    const th = cells(h).map((c) => `<th>${c}</th>`).join("");
    const tr = rows.trim().split("\n").map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>\n`;
  });
  s = s.replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>");
  s = s.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");
  s = s.replace(/^(?:[-*] .*(?:\n|$))+/gm, (m) => `<ul>${m.trim().split("\n").map((l) => `<li>${l.replace(/^[-*] /, "")}</li>`).join("")}</ul>\n`);
  s = s.replace(/^(?:\d+\. .*(?:\n|$))+/gm, (m) => `<ol>${m.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("")}</ol>\n`);
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.split(/\n{2,}/).map((p) => (/^<(h\d|ul|ol|pre|table|blockquote)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[i]);
  return s;
}

// ---------------- websocket ----------------
let ws, wsTimer;
function connect() {
  const base = HUB ? new URL(HUB) : location;
  ws = new WebSocket(`${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/ws`);
  ws.onopen = async () => {
    if (CONFIG.mode === "hosted") { const t = await ensureFreshToken(); if (!t) return; ws.send(JSON.stringify({ type: "auth", token: t })); }
    else ws.send(JSON.stringify({ type: "auth", token: TOKEN })); // local: per-launch session token
    $("#conn-dot").className = "dot green"; $("#conn-txt").textContent = "live";
  };
  ws.onclose = (e) => { if (e.code === 4401 || e.code === 4403) return; $("#conn-dot").className = "dot red"; $("#conn-txt").textContent = "reconnecting"; clearTimeout(wsTimer); wsTimer = setTimeout(connect, 1500); };
  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "auth.error") {
      if (CONFIG.mode === "hosted") return signOut(false, ev.error || "Sign in again.");
      // local: the server was relaunched with a new token; reload once to pick it up
      const last = Number(sessionStorage.getItem("cc.reload") || 0);
      if (Date.now() - last > 10000) { sessionStorage.setItem("cc.reload", String(Date.now())); location.reload(); }
      else { $("#conn-dot").className = "dot red"; $("#conn-txt").textContent = "reload the page"; }
      return;
    }
    handle(ev);
  };
}
function applyState(st) {
  Object.assign(S, { mode: st.mode, user: st.user, hub: st.hub, license: st.license, update: st.update, version: st.version, rules: st.rules, scheduled: st.scheduled, demo: st.demo, providers: st.providers, ledger: st.ledger, subscriptions: st.subscriptions || [], subscriptionTotals: st.subscriptionTotals, subscriptionsLocked: !!st.subscriptionsLocked, projects: st.projects, hq: st.hq, missions: st.missions, settings: st.settings, skills: st.skills, vault: st.vault, capabilities: st.capabilities, hqDir: st.hqDir });
  S.plugins = st.plugins || [];
  if (st.settings?.demoNotice && !S.demoNoticeShown) { S.demoNoticeShown = true; toast("Demo AIs removed now that your own keys are set up. You can turn demo mode back on in Settings."); api("/demo/ack", { method: "POST" }).catch(() => {}); }
  for (const f of window.CC?.features || []) { if (f.onState) { try { f.onState(S); } catch (e) { console.warn(`[feature ${f.id}]`, e); } } }
}
function handle(ev) {
  for (const f of window.CC?.features || []) { if (f.onEvent) { try { f.onEvent(ev); } catch (e) { console.warn(`[feature ${f.id}]`, e); } } }
  switch (ev.type) {
    case "hello": {
      applyState(ev.state);
      S.feed = (ev.state.recent || []).filter((e) => ["log", "agent.msg", "agent.error", "agent.start", "agent.done", "provider.status", "ledger.entry"].includes(e.type)).slice(-60);
      const run = ev.state.lastRun;
      if (run && !S.live.id) { if (run.kind === "council") { S.live = newLive(); S.live.id = run.id; S.live.kind = "council"; S.live.council = run; S.live.status = run.status; if (run.verdict?.text) S.live.deliverable = run.verdict.text; } else { S.live = newLive(); S.live.id = run.id; S.live.kind = run.kind; S.live.mission = run; S.live.status = run.status; for (const t of run.tasks || []) S.live.tasks[t.id] = t; S.live.deliverable = run.deliverable || ""; } }
      if (S.mode !== "hosted" && !S.settings.onboarded && !S.visitedSetup) { S.visitedSetup = true; S.view = "setup"; }
      document.body.classList.toggle("hosted", S.mode === "hosted");
      const setupTab = $("#tab-setup"); if (setupTab) setupTab.style.display = S.mode === "hosted" ? "none" : "";
      renderAll(); return;
    }
    case "tick": Object.assign(S, { ledger: ev.ledger, subscriptions: ev.subscriptions || [], subscriptionTotals: ev.subscriptionTotals, subscriptionsLocked: !!ev.subscriptionsLocked, providers: ev.providers }); renderStrip(); renderBudget(); if (["credits", "subscriptions"].includes(S.view)) render(); return;
    case "provider.status": { const p = P(ev.provider); if (p) p.status = { status: ev.status, detail: ev.detail, latencyMs: ev.latencyMs, balance: ev.balance }; renderStrip(); graph?.setStatus(ev.provider, ev.status); pushFeed(ev); return; }
    case "agent.start": onAgentStart(ev); pushFeed(ev); return;
    case "agent.delta": onAgentDelta(ev); return;
    case "agent.done": onAgentEnd(ev, false); pushFeed(ev); return;
    case "agent.error": onAgentEnd(ev, true); pushFeed(ev); return;
    case "agent.msg": graph?.pulse(ev.from, ev.to, ev.text); pushFeed(ev); return;
    case "task.update": onTask(ev); return;
    case "mission.update": onMission(ev.mission); return;
    case "council.update": onCouncil(ev.council); return;
    case "ledger.entry": if (S.ledger && ev.entry.kind === "call") { S.ledger.month += ev.entry.cost; S.ledger.today += ev.entry.cost; S.ledger.calls++; const b = S.ledger.byProvider[ev.entry.provider]; if (b) { b.month += ev.entry.cost; b.today += ev.entry.cost; b.calls++; } renderBudget(); renderStrip(); } return;
    case "log": pushFeed(ev); return;
    case "update.state": S.update = ev.update; renderUpdateBar(); renderUpdateBox(); return;
  }
}

// ---------------- live run handling ----------------
let graph = null;
function ensureLive(id, kind) {
  if (S.live.id !== id) { S.live = newLive(); S.live.id = id; S.live.kind = kind || (id?.startsWith("c-") ? "council" : id?.startsWith("m-") ? "mission" : "single"); graph?.resetAll(); S.activeByProvider = {}; if (S.view === "command") renderOps(); }
}
function onAgentStart(ev) {
  ensureLive(ev.missionId);
  S.live.agents[ev.agent] = { ...ev, text: "", done: false };
  if (["chair", "assemble", "answer"].includes(ev.role) && (S.live.kind !== "council" || ev.role === "chair")) S.live.primary = ev.agent;
  if (S.live.kind === "single") S.live.primary = ev.agent;
  S.activeByProvider[ev.provider] = (S.activeByProvider[ev.provider] || 0) + 1;
  graph?.activate(ev.provider, ev.label?.replace(/^[^:]+:\s*/, "") || ev.role);
  renderStrip();
  if (S.view === "command") renderOps();
}
function onAgentDelta(ev) {
  const a = S.live.agents[ev.agent]; if (!a) return;
  a.text += ev.text;
  if (S.view !== "command") return;
  if (ev.agent === S.live.primary) { const o = $("#out-md"); if (o) { o.innerHTML = md(a.text); o.classList.add("cursor"); o.scrollTop = o.scrollHeight; } }
  if (S.live.kind === "council" && a.role === "answer") { const c = $(`[data-ans="${CSS.escape(a.model)}"] .body`); if (c) { c.innerHTML = md(a.text); c.scrollTop = c.scrollHeight; } }
  if (S.live.kind === "mission" && ev.taskId) { const t = $(`[data-task="${ev.taskId}"] .bar i`); if (t) { const cur = parseFloat(t.style.width) || 0; t.style.width = Math.max(cur, Math.min(96, 10 + a.text.length / 40)) + "%"; } }
}
function onAgentEnd(ev, err) {
  const a = S.live.agents[ev.agent]; if (a) { a.done = true; a.error = ev.error; a.ms = ev.ms; a.cost = ev.cost; }
  S.activeByProvider[ev.provider] = Math.max(0, (S.activeByProvider[ev.provider] || 1) - 1);
  graph?.deactivate(ev.provider, err ? "error" : ev.ms ? `${(ev.ms / 1000).toFixed(1)}s` : "");
  renderStrip();
  if (S.view === "command" && ev.agent === S.live.primary) $("#out-md")?.classList.remove("cursor");
}
function onTask(ev) {
  ensureLive(ev.missionId, "mission");
  S.live.tasks[ev.task.id] = ev.task;
  if (S.view === "command") renderTasks();
}
function onMission(m) {
  if (m.kind === "council") return; // councils arrive through council.update
  ensureLive(m.id, m.kind);
  S.live.mission = m; S.live.status = m.status;
  for (const t of m.tasks || []) S.live.tasks[t.id] = t;
  if (m.deliverable) S.live.deliverable = m.deliverable;
  const i = S.missions.findIndex((x) => x.id === m.id);
  const summ = { id: m.id, kind: m.kind, title: m.title, projectId: m.projectId, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt, cost: m.cost, tasks: (m.tasks || []).length, providers: [...new Set((m.tasks || []).map((t) => t.provider))].concat(m.provider ? [m.provider] : []) };
  if (i >= 0) S.missions[i] = summ; else S.missions.unshift(summ);
  if (S.view === "command") { renderTasks(); renderOutput(); renderOpsHead(); }
  if (m.status === "cancelled") toast("Scheduled mission cancelled");
  if (["done", "done-with-errors", "failed", "aborted"].includes(m.status)) { graph?.resetAll(); S.activeByProvider = {}; renderStrip(); toast(`${m.kind === "single" ? "Answer" : "Mission"} ${m.status.replace("-", " ")} · ${money(m.cost, 4)}`, m.status === "failed"); }
}
function onCouncil(c) {
  ensureLive(c.id, "council");
  S.live.council = c; S.live.status = c.status;
  if (c.verdict?.text) S.live.deliverable = c.verdict.text;
  if (S.view === "command") { renderCouncil(); renderOpsHead(); if (c.verdict) renderOutput(); }
  if (c.status === "done") { const i = S.missions.findIndex((x) => x.id === c.id); const summ = { id: c.id, kind: "council", title: c.prompt.slice(0, 90), projectId: c.projectId, status: c.status, startedAt: c.startedAt, finishedAt: c.finishedAt, cost: c.cost, members: c.members.map((m) => m.provider) }; if (i >= 0) S.missions[i] = summ; else S.missions.unshift(summ); graph?.resetAll(); S.activeByProvider = {}; renderStrip(); toast(`Council done · ${money(c.cost, 4)}`); }
}

// ---------------- feed ----------------
function pushFeed(ev) {
  S.feed.push(ev); if (S.feed.length > 80) S.feed.shift();
  const list = $("#feed-list"); if (!list) return;
  const node = feedNode(ev); if (!node) return;
  list.appendChild(node);
  while (list.children.length > 80) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}
function feedNode(ev) {
  const d = document.createElement("div");
  const t = new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let who = "", txt = "", cls = "", color = "";
  switch (ev.type) {
    case "log": who = "Command"; txt = ev.text; cls = ev.level === "error" ? "err" : ""; color = "#22d3ee"; break;
    case "agent.start": who = pname(ev.provider); txt = ev.label || `${ev.role} started`; color = pcolor(ev.provider); break;
    case "agent.done": who = pname(ev.provider); txt = `done in ${((ev.ms || 0) / 1000).toFixed(1)}s${ev.cost != null ? ` · ${money(ev.cost, 4)}` : ""}`; color = pcolor(ev.provider); break;
    case "agent.error": who = pname(ev.provider); txt = ev.error; cls = "err"; color = pcolor(ev.provider); break;
    case "agent.msg": who = `${pname(ev.from)} → ${pname(ev.to)}`; txt = ev.text; cls = "msg"; color = "#a78bfa"; break;
    case "provider.status": who = pname(ev.provider); txt = `${ev.status}: ${ev.detail}`; color = { green: "#34d399", amber: "#fbbf24", red: "#f87171" }[ev.status] || "#4b5563"; break;
    case "ledger.entry": if (ev.entry.kind !== "credits") return null; who = pname(ev.entry.provider); txt = `${fmtN(ev.entry.units)} credits logged${ev.entry.note ? ": " + ev.entry.note : ""}`; color = pcolor(ev.entry.provider); break;
    default: return null;
  }
  d.className = `ev ${cls}`;
  d.innerHTML = `<div class="bar" style="background:${color}"></div><div><span class="who" style="color:${color}">${esc(who)}</span><span class="t">${t}</span><div class="txt">${esc(txt)}</div></div>`;
  return d;
}
function renderFeed() {
  const list = $("#feed-list"); list.innerHTML = "";
  for (const ev of S.feed) { const n = feedNode(ev); if (n) list.appendChild(n); }
  list.scrollTop = list.scrollHeight;
}

// ---------------- strip + budget ----------------
function renderStrip() {
  const strip = $("#strip");
  const order = S.providers.filter((p) => p.kind === "text").concat(S.providers.filter((p) => p.kind !== "text"));
  strip.innerHTML = order.map((p) => {
    const st = p.status?.status || "grey";
    const bp = S.ledger?.byProvider?.[p.id];
    const sub = S.subscriptions.find((s) => s.provider === p.id);
    let line = p.status?.detail || "";
    let meter = 0, badge = "";
    if (p.kind === "text") {
      line = p.keyed ? `${money(bp?.month || 0)} this month` : "no key";
      if (p.status?.balance?.left != null) line = `${money(p.status.balance.left)} left`;
      meter = S.settings.budgetMonthly ? Math.min(100, ((bp?.month || 0) / S.settings.budgetMonthly) * 100) : 0;
    } else if (sub) {
      if (sub.credits != null && sub.creditsTotal) { line = `${fmtN(sub.credits)} / ${fmtN(sub.creditsTotal)} ${sub.unit || ""}`; meter = (sub.credits / sub.creditsTotal) * 100; }
      else if (sub.credits != null) line = `${fmtN(sub.credits)} ${sub.unit || "credits"}`;
      else if (sub.renews) line = `renews ${sub.renews.slice(5)}`;
      else line = p.status?.detail && p.status.detail !== "no key" ? p.status.detail : "tracked";
    }
    const active = S.activeByProvider[p.id] > 0;
    if (active) badge = `${S.activeByProvider[p.id]} working`;
    const stLight = p.kind !== "text" && st === "grey" && sub ? (sub.signal === "low" || sub.signal === "attention" ? "red" : sub.signal === "renewing" ? "amber" : "green") : st;
    return `<div class="tile ${active ? "active" : ""}" style="--c:${p.color}" data-p="${p.id}" title="${esc(p.status?.detail || "")}">
      <div class="top"><span class="light ${stLight}"></span><span class="name">${esc(p.name)}</span></div>
      <div class="sub">${esc(line)}</div>
      <div class="meter"><i style="width:${meter.toFixed(0)}%;background:${p.color}"></i></div>
      ${badge ? `<span class="badge">${badge}</span>` : ""}
    </div>`;
  }).join("");
  $$(".tile", strip).forEach((t) => t.addEventListener("click", () => { S.view = "settings"; S.focusProvider = t.dataset.p; render(); }));
}
function renderBudget() {
  const b = S.settings.budgetMonthly || 0, m = S.ledger?.month || 0;
  $("#budget-val").textContent = `${money(m)} / ${money(b, 0)}`;
  $("#budget-pill").style.borderColor = m > b ? "var(--red)" : m > b * 0.8 ? "var(--amber)" : "var(--line)";
}

// ---------------- views ----------------
function renderUpdateBar() {
  const u = S.update, bar = $("#update-bar"); if (!bar) return;
  if (!u?.available || S.updateDismissed === u.latest) { bar.style.display = "none"; return; }
  bar.style.display = "";
  const busy = u.phase === "downloading" || u.phase === "installing";
  const action = u.desktop
    ? `<button class="btn sm primary" style="margin-left:auto" id="upd-go" ${busy ? "disabled" : ""}>${u.phase === "downloading" ? `Downloading ${u.progress ?? 0}%` : u.phase === "installing" ? "Restarting..." : "Update and restart"}</button>`
    : `<a class="btn sm primary" style="margin-left:auto" href="${esc(u.url || "#")}" target="_blank" rel="noopener">Get the update</a>`;
  bar.innerHTML = `<span>↑</span><div><b>Update available: Command AI v${esc(u.latest)}</b> (you have v${esc(u.current)}). ${esc(u.notes || "")}${u.error ? ` <span style="color:var(--amber)">${esc(u.error)}</span>` : ""}</div>${action}${busy ? "" : `<button class="ghost small" id="upd-later">later</button>`}`;
  $("#upd-go")?.addEventListener("click", installUpdate);
  $("#upd-later")?.addEventListener("click", () => { S.updateDismissed = u.latest; bar.style.display = "none"; });
}
// Settings: current version, Check for updates, and the install button when one is waiting
function updateBoxHtml() {
  const u = S.update || {};
  const busy = u.phase === "downloading" || u.phase === "installing";
  const status = u.phase === "downloading" ? `Downloading v${esc(u.latest)}: ${u.progress ?? 0}%`
    : u.phase === "installing" ? "Installing; the app restarts in a moment"
    : u.available ? `Update available: v${esc(u.latest)}`
    : u.checkedAt && !u.error ? "You are on the latest version" : "";
  return `<b>Command AI</b> v${esc(S.version || u.current || "")} <span class="dim">(an Everborn product by Everborn Productions)</span> <button class="btn sm" id="s-upd" ${busy ? "disabled" : ""}>Check for updates</button>`
    + (u.available && u.desktop ? ` <button class="btn sm primary" id="s-upd-go" ${busy ? "disabled" : ""}>Update and restart</button>` : "")
    + (status ? ` <span class="dim">${status}</span>` : "")
    + (u.error ? ` <span class="dim">(last check failed: ${esc(u.error)})</span>` : "");
}
function renderUpdateBox() {
  const box = $("#s-upd-box"); if (!box) return;
  box.innerHTML = updateBoxHtml();
  $("#s-upd")?.addEventListener("click", async (e) => { e.preventDefault(); try { S.update = await api("/update/check", { method: "POST" }); } catch (err) { return toast(err.message, true); } S.updateDismissed = null; renderUpdateBar(); renderUpdateBox(); toast(S.update.available ? `v${S.update.latest} is available` : S.update.error ? `Check failed: ${S.update.error}` : "You are on the latest version", !!S.update.error); });
  $("#s-upd-go")?.addEventListener("click", installUpdate);
}
async function installUpdate() {
  try { S.update = await api("/update/install", { method: "POST" }); toast("Downloading the update; the app restarts when it is ready"); }
  catch (e) { toast(e.message, true); }
  renderUpdateBar(); renderUpdateBox();
}
function renderAll() { renderStrip(); renderBudget(); renderFeed(); renderUpdateBar(); render(); }
function render() {
  $$("#tabs button, #mobile-nav button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
  $("#feed")?.classList.remove("open");
  const v = $("#view");
  graph = null;
  ensureFeatureTabs();
  const ft = window.CC?.byKind?.("tab").find((f) => f.id === S.view);
  if (ft) { try { ft.tab.render(v); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; } return; }
  if (S.view === "command") renderCommand(v);
  else if (S.view === "projects") renderProjects(v);
  else if (S.view === "credits") renderCredits(v);
  else if (S.view === "subscriptions") renderSubscriptions(v);
  else if (S.view === "settings") renderSettings(v);
  else if (S.view === "setup") renderSetup(v);
}
// Feature tabs register themselves (web/features/*.js); buttons are added once to both navs.
function ensureFeatureTabs() {
  for (const f of window.CC?.byKind?.("tab") || []) {
    if (!$(`#tabs button[data-view="${f.id}"]`)) { const b = document.createElement("button"); b.dataset.view = f.id; b.textContent = f.tab.label; $("#tabs").insertBefore(b, $("#tabs button[data-view=settings]")); }
    // phones: feature tabs go into a "More" sheet instead of crowding the bottom bar
    let more = $("#mobile-more");
    if (!more) { more = document.createElement("div"); more.id = "mobile-more"; more.className = "mobile-more"; document.body.appendChild(more); const mb = document.createElement("button"); mb.dataset.more = "1"; mb.innerHTML = `<i>⋯</i>More`; mb.addEventListener("click", () => more.classList.toggle("open")); $("#mobile-nav").insertBefore(mb, $("#mobile-nav button[data-view=settings]")); }
    if (!$(`#mobile-more button[data-view="${f.id}"]`)) { const b = document.createElement("button"); b.dataset.view = f.id; b.innerHTML = `<i>${f.tab.icon || "✦"}</i>${esc(f.tab.short || f.tab.label)}`; b.addEventListener("click", () => { more.classList.remove("open"); S.view = f.id; S.openProject = null; render(); }); more.appendChild(b); }
  }
  $$("#tabs button, #mobile-nav button[data-view], #mobile-more button").forEach((b) => b.classList.toggle("active", b.dataset.view === S.view));
  $("#mobile-more")?.classList.remove("open");
}
function renderExtras(kind, sel, ...args) {
  const box = $(sel); if (!box) return;
  box.innerHTML = "";
  for (const f of window.CC?.byKind?.(kind) || []) { const d = document.createElement("div"); d.dataset.feature = f.id; box.appendChild(d); try { f[kind].render(d, ...args); } catch (e) { d.innerHTML = `<div class="dim small">${esc(f.id)}: ${esc(e.message)}</div>`; } }
}
function projectOptions(sel) {
  return `<option value="">No project</option>` + S.projects.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
}

// ----- Command -----
function renderCommand(v) {
  const modeSel = S.cmdMode || "mission";
  v.innerHTML = `
  <div class="cmd">
    <div class="orders">
      <div class="panel" style="display:flex;flex-direction:column;gap:6px;flex:1">
        <h3>Marching orders <span class="right" id="cls-hint"></span></h3>
        <textarea id="orders" placeholder="Tell the team what you want. One line is enough.&#10;&#10;e.g. Plan the Instagram week for our new product launch: 5 post ideas, captions, hashtags and a posting schedule.">${esc(S.lastOrders || "")}</textarea>
        <label class="lbl">How to run it</label>
        <div class="seg" id="run-mode">
          <button data-m="single" class="${modeSel === "single" ? "on" : ""}" title="Best single AI for the job">Single</button>
          <button data-m="council" class="${modeSel === "council" ? "on" : ""}" title="Several AIs answer, review each other, chair writes the verdict">Council</button>
          <button data-m="mission" class="${modeSel === "mission" ? "on" : ""}" title="Plan → assign to specialists → QA → assemble">Mission</button>
        </div>
        <label class="lbl">Priority</label>
        <div class="seg" id="cost-mode">
          ${["quality", "balanced", "economy"].map((m) => `<button data-m="${m}" class="${(S.costMode || S.settings.defaultMode) === m ? "on" : ""}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}
        </div>
        <label class="lbl">When</label>
        <div class="seg" id="when-mode">
          <button data-m="now" class="${(S.whenMode || "now") === "now" ? "on" : ""}">Now</button>
          <button data-m="offpeak" class="${S.whenMode === "offpeak" ? "on" : ""}" title="Queue the mission for the next discount window (e.g. DeepSeek off-peak, 50% off)">Off-peak</button>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="row small" style="gap:6px"><input type="checkbox" id="qa" ${S.settings.qa !== false ? "checked" : ""}> AI-to-AI QA</label>
          <label class="row small" style="gap:6px;margin-left:auto">Cap $<input type="number" id="budget" value="${S.settings.missionBudget || 2}" step="0.5" min="0.1" style="width:70px;padding:4px 6px"></label>
        </div>
        <label class="lbl">Project</label>
        <select id="proj">${projectOptions(S.project)}</select>
        <div id="route" class="route" style="margin-top:10px;display:none"></div>
        <div id="cmd-extras"></div>
        <div class="row" style="margin-top:auto;padding-top:10px">
          <button class="btn" id="preview">Preview route</button>
          <button class="btn primary" id="go" style="margin-left:auto">Send orders ⏎</button>
        </div>
      </div>
    </div>
    <div class="panel ops">
      <h3>Live ops <span id="ops-head" class="right"></span><button class="ghost small" id="abort" style="display:none;color:var(--red)">abort</button></h3>
      <div class="graph-wrap" id="graph"></div>
      <div id="tasks" class="tasks"></div>
      <div id="council"></div>
    </div>
    <div class="panel output">
      <h3>Deliverable <span class="right" id="out-head"></span><button class="ghost small" id="copy">copy</button></h3>
      <div class="md" id="out-md"></div>
      <div id="deliv-extras"></div>
    </div>
  </div>`;
  graph = new AgentGraph($("#graph"));
  // keyed AIs always appear; grey (no key) ones only fill in while there is room
  const textKeyed = S.providers.filter((p) => p.kind === "text" && p.keyed);
  const textGrey = S.providers.filter((p) => p.kind === "text" && !p.keyed).slice(0, Math.max(0, 8 - textKeyed.length));
  const media = S.providers.filter((p) => p.kind !== "text" && (p.keyed || S.subscriptions.some((s) => s.provider === p.id && (s.credits != null || s.renews))));
  graph.setProviders([...textKeyed, ...textGrey, ...media]);
  graph.onNodeClick = (id) => { S.view = "settings"; S.focusProvider = id; render(); };
  for (const [pid, n] of Object.entries(S.activeByProvider)) if (n > 0) graph.activate(pid, "working");
  $("#run-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.cmdMode = b.dataset.m; $$("#run-mode button").forEach((x) => x.classList.toggle("on", x === b)); });
  $("#cost-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.costMode = b.dataset.m; $$("#cost-mode button").forEach((x) => x.classList.toggle("on", x === b)); });
  $("#when-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.whenMode = b.dataset.m; $$("#when-mode button").forEach((x) => x.classList.toggle("on", x === b)); });
  $("#proj").addEventListener("change", (e) => { S.project = e.target.value; localStorage.setItem("cc.project", S.project); });
  $("#orders").addEventListener("input", (e) => { S.lastOrders = e.target.value; });
  $("#orders").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendOrders(); });
  $("#go").addEventListener("click", sendOrders);
  $("#preview").addEventListener("click", previewRoute);
  $("#copy").addEventListener("click", () => { navigator.clipboard.writeText(S.live.deliverable || $("#out-md").innerText); toast("Copied"); });
  $("#abort").addEventListener("click", () => S.live.id && api(`/mission/${S.live.id}/abort`, { method: "POST" }));
  renderOps();
  renderExtras("command", "#cmd-extras");
}
function renderOps() { renderOpsHead(); renderTasks(); renderCouncil(); renderOutput(); }
function renderOpsHead() {
  const h = $("#ops-head"); if (!h) return;
  const l = S.live;
  if (!l.id) { h.textContent = "idle"; $("#abort").style.display = "none"; return; }
  const cost = l.mission?.cost ?? l.council?.cost ?? 0;
  h.textContent = `${l.kind} · ${l.status || "running"} · ${money(cost, 4)}`;
  $("#abort").style.display = l.kind === "mission" && ["scheduled", "planning", "running", "assembling"].includes(l.status) ? "" : "none";
}
function renderTasks() {
  const box = $("#tasks"); if (!box) return;
  const tasks = Object.values(S.live.tasks);
  if (S.live.kind === "mission" && S.live.status === "scheduled" && S.live.mission?.scheduledFor) { box.innerHTML = `<div class="empty" style="color:var(--amber)">Queued for ${new Date(S.live.mission.scheduledFor).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${esc(S.live.mission.reason || "")}<br><span class="dim small">It will start on its own; use abort to cancel.</span></div>`; return; }
  if (S.live.kind !== "mission" || !tasks.length) { box.innerHTML = S.live.kind === "mission" && S.live.status === "planning" ? `<div class="empty">Planning…</div>` : ""; return; }
  box.innerHTML = tasks.map((t) => {
    const pct = t.status === "done" ? 100 : t.status === "failed" ? 100 : t.status === "review" ? 85 : t.status === "running" ? 30 : 0;
    const rv = t.review ? `<span class="chip ${t.review.pass ? "green" : "amber"}" title="${esc((t.review.issues || []).join("; "))}">QA ${t.review.score ?? ""}${t.review.pass ? " ✓" : " ✎"}</span>` : "";
    return `<div class="task" data-task="${t.id}">
      <span class="st ${t.status}"></span>
      <div><div>${esc(t.title)} ${t.retried ? '<span class="chip amber">re-assigned</span>' : ""} ${t.revised ? '<span class="chip violet">revised</span>' : ""} ${rv}</div><div class="who" style="color:${pcolor(t.provider)}">${esc(t.agentName || pname(t.provider))} · ${esc(t.model)}${t.deps?.length ? ` · after ${t.deps.join(", ")}` : ""}</div></div>
      <span class="chip">${t.capability}</span>
      <span class="cost">${money(t.cost || t.estCost || 0, 4)}</span>
      <div class="bar"><i style="width:${pct}%;background:${t.status === "failed" ? "var(--red)" : pcolor(t.provider)}"></i></div>
    </div>`;
  }).join("");
}
function renderCouncil() {
  const box = $("#council"); if (!box) return;
  const c = S.live.council;
  if (S.live.kind !== "council" || !c) { box.innerHTML = ""; return; }
  const answers = c.members.map((m) => c.answers?.[m.model] || { provider: m.provider, model: m.model, letter: "?" });
  box.innerHTML = `<div class="cat-h" style="margin-top:14px">Answers ${c.classification ? `<span class="chip">${c.classification.capability}</span>` : ""}</div>
  <div class="council-cols">${answers.map((a) => {
    const sb = c.scoreboard?.[a.model];
    const live = Object.values(S.live.agents).find((x) => x.model === a.model && x.role === "answer");
    const text = a.text || live?.text || (a.error ? `**Error:** ${a.error}` : "");
    return `<div class="ans ${c.winner === a.model ? "winner" : ""}" style="--c:${pcolor(a.provider)}" data-ans="${esc(a.model)}">
      <div class="hd"><span class="dot" style="background:${pcolor(a.provider)}"></span>${esc(pname(a.provider))} <span class="dim small">${esc(a.letter || "")}</span>
      <span class="score">${sb?.avg != null ? `peer ${sb.avg}/10${c.winner === a.model ? " ★" : ""}` : a.ms ? `${(a.ms / 1000).toFixed(1)}s` : ""}</span></div>
      <div class="body md">${md(text)}</div></div>`;
  }).join("")}</div>
  ${Object.keys(c.reviews || {}).length ? `<div class="cat-h">Where they disagreed</div><div class="small muted">${Object.values(c.reviews).map((r) => `<div><b style="color:${pcolor(r.provider)}">${esc(pname(r.provider))}</b>: ${esc(r.disagreement || "none")}</div>`).join("")}</div>` : ""}`;
}
function renderOutput() {
  const o = $("#out-md"), h = $("#out-head"); if (!o) return;
  const l = S.live;
  const prim = l.primary ? l.agents[l.primary] : null;
  const text = l.deliverable || prim?.text || "";
  if (!l.id) { o.innerHTML = `<div class="empty">Send orders to see the team work. Single = best AI for the job. Council = several AIs answer and judge each other. Mission = plan, assign, QA, assemble.</div>`; h.textContent = ""; return; }
  h.textContent = prim ? `${pname(prim.provider)} · ${prim.model}` : "";
  if (!text) { o.innerHTML = l.kind === "mission" ? `<div class="empty">The deliverable appears here once the assembler starts.</div>` : `<div class="empty">Waiting…</div>`; return; }
  o.innerHTML = md(text);
  if (prim && !prim.done) o.classList.add("cursor"); else o.classList.remove("cursor");
  const finished = ["done", "done-with-errors", "failed", "aborted"].includes(l.status) || (prim && prim.done && l.kind === "single");
  renderExtras("deliverable", "#deliv-extras", finished ? l : null);
}
async function previewRoute() {
  const prompt = $("#orders").value.trim(); if (!prompt) return;
  const box = $("#route"); box.style.display = ""; box.innerHTML = `<span class="muted">Classifying…</span>`;
  try {
    const r = await api(`/route?prompt=${encodeURIComponent(prompt)}&mode=${encodeURIComponent(S.costMode || S.settings.defaultMode)}`);
    S.routePreview = r;
    const c = r.classification, best = r.ranked[0];
    const d = r.defer;
    box.innerHTML = `<div><b>${esc(c.summary || c.capability)}</b> <span class="chip">${c.capability}</span> <span class="chip">difficulty ${c.difficulty}</span> ${c.needWeb ? '<span class="chip violet">needs web</span>' : ""}</div>
      <div class="small" style="margin-top:6px">Best fit: <b style="color:${pcolor(best?.provider)}">${esc(best?.name || "none available")}</b> ≈ ${money(best?.estCost || 0, 4)} per call${best?.discount ? ` <span class="chip green">${best.discount.pct}% off now</span>` : ""}${best?.warnings?.length ? ` <span class="chip amber" title="${esc(best.warnings.join("; "))}">health −${best.healthPenalty}</span>` : ""} · council of 4 ≈ ${money(r.councilEstimate, 3)}</div>
      ${r.cheaper?.advice ? `<div class="adv">${esc(r.cheaper.advice)}</div>` : ""}
      ${d ? `<div class="adv" style="color:var(--amber)">Not urgent? Off-peak at ${new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${esc(d.model)} at ${d.pct}% off saves about ${d.saving}% (${money(d.laterCost, 4)} vs ${money(d.nowCost, 4)}). Pick "Off-peak" under When.</div>` : ""}
      <div class="small dim" style="margin-top:4px">${r.ranked.slice(0, 4).map((m) => `${esc(m.name)} ${m.score}`).join(" · ")}</div>`;
    $("#cls-hint").textContent = c.source === "heuristic" ? "classified locally" : `classified by ${c.source}`;
  } catch (e) { box.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
}
async function sendOrders() {
  const prompt = $("#orders").value.trim(); if (!prompt) return toast("Type the orders first", true);
  const mode = S.cmdMode || "mission", costMode = S.costMode || S.settings.defaultMode;
  const qa = $("#qa").checked, budgetUsd = Number($("#budget").value) || 2, projectId = $("#proj").value || null;
  if (!S.providers.some((p) => p.kind === "text" && p.keyed)) { S.view = "settings"; render(); return toast("Add at least one API key first", true); }
  $("#go").disabled = true;
  try {
    // project memory (brand voice, offers, never-say list) rides along when a project is selected
    let memory = "";
    if (projectId) { try { memory = (await api(`/memory/context?projectId=${encodeURIComponent(projectId)}`)).context || ""; } catch {} }
    const withMemory = memory ? `${prompt}\n\n${memory}` : prompt;
    if (mode === "single") await api("/chat", { method: "POST", body: { prompt: withMemory, projectId } });
    else if (mode === "council") await api("/council", { method: "POST", body: { prompt: withMemory, projectId, qa, lite: costMode === "economy" } });
    else { const r = await api("/mission", { method: "POST", body: { goal: prompt, context: memory, mode: costMode, projectId, qa, budgetUsd, runAt: S.whenMode || "now" } }); if (r.scheduled) toast(`Queued for ${new Date(r.scheduled.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${r.scheduled.reason}`); }
    S.live = newLive(); renderOps();
  } catch (e) { toast(e.message, true); }
  finally { setTimeout(() => { const g = $("#go"); if (g) g.disabled = false; }, 800); }
}

// ----- Projects -----
function renderProjects(v) {
  if (S.openProject) return renderProjectDetail(v, S.projects.find((p) => p.id === S.openProject));
  const hq = S.hq;
  v.innerHTML = `<div class="grid" style="grid-template-columns: 1fr 360px">
    <div>
      <div class="row" style="margin-bottom:12px"><h3 style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Projects</h3><button class="btn sm" id="newp" style="margin-left:auto">+ New project</button></div>
      <div class="pcards">${S.projects.map((p) => {
        const runs = S.missions.filter((m) => m.projectId === p.id);
        const tasks = (hq?.tasks || []).filter((t) => t.client === p.hqClient);
        return `<div class="pcard" style="--c:${p.color}" data-id="${p.id}">
          <h4>${esc(p.name)}</h4><div class="muted small">${esc(p.summary || "")}</div>
          <div class="cats">${p.categories.map((c) => `<span class="chip">${esc(c.name)} · ${c.links.length}</span>`).join("")}</div>
          <div class="row small dim" style="margin-top:10px;gap:14px"><span>${runs.length} AI run${runs.length === 1 ? "" : "s"}</span>${tasks.length ? `<span>${tasks.length} open HQ task${tasks.length === 1 ? "" : "s"}</span>` : ""}<span style="margin-left:auto">${runs[0] ? ago(runs[0].startedAt) + " ago" : ""}</span></div>
        </div>`; }).join("")}</div>
    </div>
    <div class="grid">
      <div class="panel"><h3>Waiting on you <span class="right">HQ board</span></h3>
        ${hq?.available ? (hq.decisions.length ? hq.decisions.map((d) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="mono dim small">${d.id} · ${d.date}</div><div>${esc(d.question)}</div>${d.recommendation ? `<div class="small" style="color:var(--green)">→ ${esc(d.recommendation)}</div>` : ""}</div>`).join("") : `<div class="dim small">Nothing open.</div>`) : S.hqDir ? `<div class="dim small">No HQ board found at ${esc(S.hqDir)}.</div>` : `<div class="dim small">Optional: link a task-board folder with the CC_HQ_DIR setting to see open tasks and decisions here.</div>`}
      </div>
      <div class="panel"><h3>Recent runs</h3>
        ${S.missions.slice(0, 12).map((m) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer" data-run="${m.id}"><span class="chip ${m.status === "done" ? "green" : m.status?.startsWith("fail") ? "red" : ""}">${m.kind}</span>${m.demo ? `<span class="chip" title="Made with the pretend demo AIs">demo</span>` : ""}<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title)}</span><span class="mono dim">${money(m.cost, 3)}</span></div>`).join("") || `<div class="dim small">No runs yet.</div>`}
      </div>
    </div></div>`;
  $$(".pcard", v).forEach((c) => c.addEventListener("click", () => { S.openProject = c.dataset.id; render(); }));
  $$("[data-run]", v).forEach((r) => r.addEventListener("click", () => openRun(r.dataset.run)));
  $("#newp").addEventListener("click", async () => { const name = prompt("Project name"); if (!name) return; try { await api("/projects", { method: "POST", body: { name, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } }); await refresh(); } catch (e) { toast(e.message, true); } });
}
function renderProjectDetail(v, p) {
  if (!p) { S.openProject = null; return renderProjects(v); }
  const runs = S.missions.filter((m) => m.projectId === p.id);
  const tasks = (S.hq?.tasks || []).filter((t) => t.client === p.hqClient);
  const credits = S.hq?.credits?.byProject || {};
  const projCredits = Object.entries(credits).filter(([k]) => p.id.includes(k.split("-")[0]) || k.includes(p.id));
  v.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="ghost" id="back">← Projects</button><h2 style="margin:0;font-size:20px;border-left:4px solid ${p.color};padding-left:10px">${esc(p.name)}</h2><span class="muted">${esc(p.summary || "")}</span>
    <select id="proj-sel" style="width:auto;margin-left:auto"><option value="${p.id}">Set as active project</option></select><button class="btn sm" id="use">Use in Command</button><button class="btn sm danger" id="del">Delete</button></div>
  <div class="grid" style="grid-template-columns: 1fr 340px">
    <div>
      ${p.categories.map((c) => `<div class="cat-h">${esc(c.name)} <button class="ghost small" data-add="${c.id}">+ link</button></div>
        <div class="links">${c.links.map((l) => `<a class="linkt" href="${esc(l.url)}" target="_blank" rel="noopener"><img src="${favicon(l.url)}" alt=""><span>${esc(l.name)}</span><span class="x" data-rm="${c.id}" data-url="${esc(l.url)}">✕</span></a>`).join("") || `<div class="dim small">No links yet.</div>`}</div>`).join("")}
      <div class="cat-h">Add category <button class="ghost small" id="addcat">+ category</button></div>
    </div>
    <div class="grid">
      <div class="panel"><h3>Open HQ tasks <span class="right">${tasks.length}</span></h3>${tasks.slice(0, 15).map((t) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><span class="mono dim">${t.id}</span> ${esc(t.title)} <span class="chip">${t.status.replace(/_/g, " ")}</span>${t.owner ? ` <span class="dim">${t.owner}</span>` : ""}</div>`).join("") || `<div class="dim small">None.</div>`}</div>
      ${projCredits.length ? `<div class="panel"><h3>Media credits (HQ log)</h3>${projCredits.map(([k, val]) => `<div class="row small"><span>${esc(k)}</span><span class="mono" style="margin-left:auto">${fmtN(val)}</span></div>`).join("")}</div>` : ""}
      <div class="panel"><h3>AI runs <span class="right">${runs.length}</span></h3>${runs.slice(0, 20).map((m) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer" data-run="${m.id}"><span class="chip ${m.status === "done" ? "green" : ""}">${m.kind}</span><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(m.title)}</span><span class="mono dim">${money(m.cost, 3)}</span></div>`).join("") || `<div class="dim small">Pick this project in Command and send orders.</div>`}</div>
    </div></div>`;
  $("#back").addEventListener("click", () => { S.openProject = null; render(); });
  $("#use").addEventListener("click", () => { S.project = p.id; localStorage.setItem("cc.project", p.id); S.view = "command"; render(); });
  $("#del").addEventListener("click", async () => { if (!confirm(`Delete project "${p.name}"? Links only; nothing external is touched.`)) return; await api(`/projects/${p.id}`, { method: "DELETE" }); S.openProject = null; await refresh(); });
  $$("[data-add]", v).forEach((b) => b.addEventListener("click", async () => { const url = prompt("Link URL"); if (!url) return; const name = prompt("Name", url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) || url; await api(`/projects/${p.id}/links`, { method: "POST", body: { categoryId: b.dataset.add, name, url } }); await refresh(); }));
  $$("[data-rm]", v).forEach((x) => x.addEventListener("click", async (e) => { e.preventDefault(); e.stopPropagation(); await api(`/projects/${p.id}/links?category=${encodeURIComponent(x.dataset.rm)}&url=${encodeURIComponent(x.dataset.url)}`, { method: "DELETE" }); await refresh(); }));
  $("#addcat").addEventListener("click", async () => { const name = prompt("Category name (e.g. Social Posts, Music Videos, Ads)"); if (!name) return; p.categories.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, links: [] }); await api("/projects", { method: "POST", body: p }); await refresh(); });
  $$("[data-run]", v).forEach((r) => r.addEventListener("click", () => openRun(r.dataset.run)));
}
async function openRun(id) {
  try {
    const m = await api(`/missions/${id}`);
    S.live = newLive(); S.live.id = m.id; S.live.kind = m.kind; S.live.status = m.status;
    if (m.kind === "council") { S.live.council = m; S.live.deliverable = m.verdict?.text || ""; }
    else if (m.kind === "mission") { S.live.mission = m; for (const t of m.tasks) S.live.tasks[t.id] = t; S.live.deliverable = m.deliverable || ""; }
    else { S.live.deliverable = m.deliverable || ""; S.live.agents.x = { provider: m.provider, model: m.model, text: m.deliverable, done: true }; S.live.primary = "x"; }
    S.view = "command"; render();
  } catch (e) { toast(e.message, true); }
}

// ----- Credits -----
function renderCredits(v) {
  const L = S.ledger || { month: 0, today: 0, calls: 0, byProvider: {}, series: [], recent: [] };
  const max = Math.max(0.01, ...L.series.map((d) => d.v));
  const textP = S.providers.filter((p) => p.kind === "text");
  const caps = S.capabilities.filter((c) => c !== "fast");
  const allModels = textP.flatMap((p) => p.models.map((m) => ({ ...m, provider: p.id, color: p.color }))).filter((m) => S.providers.find((p) => p.id === m.provider)?.keyed);
  const bestPer = {}; for (const c of caps) bestPer[c] = Math.max(0, ...allModels.map((m) => m.caps[c] || 0));
  const hqc = S.hq?.credits;
  v.innerHTML = `
  <div class="kpi" style="margin-bottom:16px">
    <div class="k"><div class="l">API spend · month</div><div class="v">${money(L.month)}</div><div class="s">budget ${money(S.settings.budgetMonthly, 0)} · ${S.settings.budgetMonthly ? Math.round((L.month / S.settings.budgetMonthly) * 100) : 0}%</div></div>
    <div class="k"><div class="l">Today</div><div class="v">${money(L.today)}</div><div class="s">${L.calls} calls this month</div></div>
    <div class="k"><div class="l">Subscriptions</div><div class="v">${money(S.subscriptionTotals?.known || 0, 0)}<span class="dim" style="font-size:13px"> + ~${money(S.subscriptionTotals?.estimated || 0, 0)} est.</span></div><div class="s">${S.subscriptionTotals?.unconfirmed || 0} prices still unconfirmed</div></div>
    <div class="k"><div class="l">Media credits logged</div><div class="v">${fmtN(hqc?.total || 0)}</div><div class="s">${hqc ? `${hqc.rows} generations in HQ credit log` : "no HQ credit log"}</div></div>
  </div>
  <div class="grid cols-2">
    <div class="panel"><h3>Daily API spend <span class="right">last 30 days</span></h3>
      <div class="sparks">${L.series.map((d) => `<i style="height:${Math.max(2, (d.v / max) * 100)}%" data-v="${d.d.slice(5)} ${money(d.v, 3)}"></i>`).join("")}</div></div>
    <div class="panel"><h3>Spend by AI <span class="right">this month</span></h3>
      <table class="tbl"><thead><tr><th>AI</th><th class="right">Calls</th><th class="right">Tokens in / out</th><th class="right">Spend</th><th>Balance</th></tr></thead><tbody>
      ${textP.map((p) => { const b = L.byProvider[p.id] || {}; return `<tr><td><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}</td><td class="right mono">${b.calls || 0}</td><td class="right mono dim">${fmtN(b.inTok)} / ${fmtN(b.outTok)}</td><td class="right mono">${money(b.month || 0, 3)}</td><td class="small muted">${p.status?.balance?.left != null ? money(p.status.balance.left) + " left" : p.keyed ? "no balance API" : "no key"}</td></tr>`; }).join("")}
      </tbody></table></div>
  </div>
  <div class="grid cols-2" style="margin-top:16px">
    <div class="panel"><h3>Who's best at what <span class="right">baseline + what the council taught us</span></h3>
      <div class="skillgrid" style="grid-template-columns: 170px repeat(${caps.length}, 1fr)">
        <div class="cell hd"></div>${caps.map((c) => `<div class="cell hd" style="text-align:center">${c}</div>`).join("")}
        ${allModels.map((m) => `<div class="cell hd" style="color:${m.color}">${esc(m.name)}</div>${caps.map((c) => { const vv = m.caps[c] || 0; const lead = vv === bestPer[c]; const learned = m.base && m.base[c] !== vv; return `<div class="cell" style="background:${lead ? "#113b3a" : "#0d1420"};color:${lead ? "var(--green)" : "#c7d0dd"}" title="${learned ? `learned: was ${m.base[c]}` : ""}">${vv}${learned ? "*" : ""}</div>`; }).join("")}`).join("")}
      </div>
      ${allModels.length ? `<div class="dim small" style="margin-top:8px">* adjusted by council results. Run councils to teach the router.</div>` : `<div class="empty">Add API keys to see the matrix.</div>`}
    </div>
    <div class="grid">
      <div class="panel"><h3>Log media credits <span class="right">Kling · Suno · Flow · Sync</span></h3>
        <div class="row"><select id="cr-p" style="width:160px">${S.providers.filter((p) => p.kind !== "text").map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
        <input type="number" id="cr-u" placeholder="credits" style="width:110px"><input type="text" id="cr-n" placeholder="note (shot, prompt…)" style="flex:1"><button class="btn sm" id="cr-go">Log</button></div>
        <div class="dim small" style="margin-top:6px">Logged credits feed the status strip, burn rate and runway on the Subscriptions tab.</div></div>
      ${hqc ? `<div class="panel"><h3>HQ credit log <span class="right">${esc((hqc.file || "").split(/[\\/]/).slice(-2).join("/"))}</span></h3>
        <div class="grid cols-2"><div>${Object.entries(hqc.byTool).sort((a, b) => b[1] - a[1]).map(([k, val]) => `<div class="row small"><span>${esc(k)}</span><span class="mono" style="margin-left:auto">${fmtN(val)}</span></div>`).join("")}</div>
        <div>${Object.entries(hqc.byProject).map(([k, val]) => `<div class="row small"><span>${esc(k)}</span><span class="mono" style="margin-left:auto">${fmtN(val)}</span></div>`).join("")}</div></div></div>` : ""}
      <div class="panel"><h3>Discount windows <span class="right">time-of-day pricing</span></h3>
        ${(S.rules || []).map((r) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line)"><label class="row" style="gap:6px"><input type="checkbox" data-rule="${r.id}" ${r.enabled ? "checked" : ""}></label><span class="dot" style="background:${r.color || "#4b5563"}"></span><span><b>${esc(r.providerName)}</b> · ${esc(r.name)} · ${r.pct}% off</span><span style="margin-left:auto" class="${r.activeNow ? "chip green" : "chip"}">${r.activeNow ? "active now" : r.nextStart ? "next " + new Date(r.nextStart).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : r.enabled ? "no window in 48h" : "off"}</span></div><div class="dim small" style="margin-left:26px">${esc(r.note || "")}</div>`).join("") || `<div class="dim small">No rules.</div>`}
        <div class="dim small" style="margin-top:6px">Rules live in data/pricing-rules.json (provider, % off, peak hours, time zone). Pick "Off-peak" under When in Command to queue a mission for the next window.${(S.scheduled || []).length ? ` <b>${S.scheduled.length} mission${S.scheduled.length === 1 ? "" : "s"} queued.</b>` : ""}</div></div>
      <div class="panel"><h3>Recent calls <span class="right">✓ = exact billed amount</span></h3><table class="tbl"><tbody>${L.recent.filter((e) => e.kind === "call").slice(0, 12).map((e) => `<tr><td class="dim mono small">${new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td><td><span class="dot" style="background:${pcolor(e.provider)}"></span> ${esc(e.model)}</td><td class="dim small">${e.role || ""}</td><td class="right mono dim">${fmtN(e.inTok)}/${fmtN(e.outTok)}</td><td class="right mono">${money(e.cost, 4)}${e.exact ? " ✓" : e.estimated ? "~" : ""}</td></tr>`).join("") || `<tr><td class="dim">No calls yet.</td></tr>`}</tbody></table></div>
    </div>
  </div>`;
  $$("[data-rule]", v).forEach((cb) => cb.addEventListener("change", async () => { const rules = (S.rules || []).map((r) => ({ ...r, enabled: r.id === cb.dataset.rule ? cb.checked : r.enabled })); for (const r of rules) { delete r.providerName; delete r.color; delete r.activeNow; delete r.nextStart; } S.rules = await api("/rules", { method: "POST", body: { rules } }); toast("Rules saved"); }));
  $("#cr-go").addEventListener("click", async () => { const units = Number($("#cr-u").value); if (!units) return; await api("/credits", { method: "POST", body: { provider: $("#cr-p").value, units, note: $("#cr-n").value, project: S.project } }); toast("Logged"); await refresh(); });
}

// ----- Subscriptions -----
function renderSubscriptions(v) {
  if (S.subscriptionsLocked) {
    v.innerHTML = `<div class="panel" style="max-width:720px;margin:24px auto;text-align:center;padding:36px 28px">
      <div style="font-size:28px;margin-bottom:8px">🔒</div>
      <h2 style="margin:0 0 8px;font-size:20px">The Subscriptions tracker is part of Pro</h2>
      <div class="muted">What you pay for every AI subscription, when it renews, credits left, burn per day, runway, and a plain keep / watch / cancel signal. Pro also unlocks Mission mode, unlimited councils and projects, and the off-peak scheduler.</div>
      <div class="row" style="justify-content:center;margin-top:18px;gap:10px"><a class="btn primary" href="https://square.link/u/dbU38mQC" target="_blank" rel="noopener">Go Pro, $15.99/month</a><button class="btn" id="sub-lic">I have a licence key</button></div>
    </div>`;
    $("#sub-lic").addEventListener("click", () => { S.view = "settings"; render(); });
    return;
  }
  const T = S.subscriptionTotals || {};
  v.innerHTML = `
  <div class="kpi" style="margin-bottom:16px">
    <div class="k"><div class="l">Confirmed monthly</div><div class="v">${money(T.known || 0, 0)}</div><div class="s">${T.count - (T.unconfirmed || 0)} of ${T.count} priced</div></div>
    <div class="k"><div class="l">Estimated (list prices)</div><div class="v">~${money(T.estimated || 0, 0)}</div><div class="s">confirm to replace the estimate</div></div>
    <div class="k"><div class="l">Needs attention</div><div class="v">${S.subscriptions.filter((s) => s.signal !== "ok").length}</div><div class="s">low credits, renewing, or errors</div></div>
    <div class="k"><div class="l">API on top</div><div class="v">${money(S.ledger?.month || 0)}</div><div class="s">metered usage this month</div></div>
  </div>
  <div class="panel"><h3>Subscriptions &amp; credits <button class="btn sm" id="addsub" style="margin-left:auto">+ Add</button></h3>
  <table class="tbl"><thead><tr><th>Service</th><th>Plan</th><th>$/month</th><th>Renews</th><th>Credits left</th><th>Burn / day</th><th>Signal</th><th></th></tr></thead><tbody>
  ${S.subscriptions.map((s) => `<tr data-id="${s.id}">
    <td><span class="dot ${s.live?.status || ""}" style="${s.live ? "" : `background:${pcolor(s.provider)}`}"></span> <a href="${esc(s.url || "#")}" target="_blank" rel="noopener">${esc(s.name)}</a><div class="dim small">${esc(s.notes || "")}</div></td>
    <td><input type="text" data-f="plan" value="${esc(s.plan || "")}" style="width:150px;padding:4px 6px"></td>
    <td><input type="number" data-f="monthly" value="${s.monthly ?? ""}" placeholder="${s.listPrice != null ? "~" + s.listPrice : "?"}" style="width:80px;padding:4px 6px"></td>
    <td><input type="date" data-f="renews" value="${s.renews || ""}" style="width:140px;padding:4px 6px"></td>
    <td><div class="row" style="gap:4px"><input type="number" data-f="credits" value="${s.credits ?? ""}" style="width:80px;padding:4px 6px"><span class="dim">/</span><input type="number" data-f="creditsTotal" value="${s.creditsTotal ?? ""}" style="width:80px;padding:4px 6px"></div>${s.pctLeft != null ? `<div class="meter" style="height:3px;background:#1a2333;border-radius:3px;margin-top:4px"><i style="display:block;height:100%;width:${s.pctLeft}%;background:${s.pctLeft < 20 ? "var(--red)" : "var(--green)"}"></i></div>` : ""}</td>
    <td class="mono small">${s.burnPerDay != null ? `${s.burnPerDay}${s.runway != null ? ` · ${s.runway}d left` : ""}` : "<span class='dim'>-</span>"}</td>
    <td><span class="sig ${s.signal}">${s.signal}</span><div class="dim small">${esc(s.why || "")}</div></td>
    <td class="right"><button class="ghost small" data-save>save</button> <button class="ghost small" data-del style="color:var(--red)">✕</button></td>
  </tr>`).join("")}
  </tbody></table>
  <div class="dim small" style="margin-top:8px">Prices marked "?" are unknown; the grey "~" placeholder is the public list price, used only for the estimate. Credits left update automatically for services with a balance API (OpenRouter, DeepSeek, ElevenLabs) and from logged generations otherwise.</div></div>`;
  $$("tr[data-id]", v).forEach((tr) => {
    const id = tr.dataset.id;
    const collect = () => { const o = { id }; $$("[data-f]", tr).forEach((i) => { o[i.dataset.f] = i.value === "" ? null : i.type === "number" ? Number(i.value) : i.value; }); return o; };
    $("[data-save]", tr).addEventListener("click", async () => { await api("/subscriptions", { method: "POST", body: collect() }); toast("Saved"); await refresh(); });
    $("[data-del]", tr).addEventListener("click", async () => { if (!confirm("Remove this subscription from the tracker?")) return; await api(`/subscriptions/${id}`, { method: "DELETE" }); await refresh(); });
    $$("input", tr).forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") $("[data-save]", tr).click(); }));
  });
  $("#addsub").addEventListener("click", async () => { const name = prompt("Service name"); if (!name) return; await api("/subscriptions", { method: "POST", body: { name, plan: "", monthly: null, unit: "credits" } }); await refresh(); });
}

// ----- Settings -----
function renderSettings(v) {
  const textP = S.providers.filter((p) => p.kind === "text"), mediaP = S.providers.filter((p) => p.kind !== "text");
  const card = (p) => `<div class="pcard-set" style="--c:${p.color}" id="prov-${p.id}">
    <div class="hd"><span class="dot ${p.status?.status || "grey"}"></span><span class="nm">${esc(p.name)}</span><span class="vd">${esc(p.vendor)}</span>
      <span class="chip ${p.status?.status === "red" ? "red" : ""}" style="margin-left:auto" title="${esc(p.status?.detail || "")}">${esc(p.status?.detail || "no key")}</span></div>
    ${p.custom ? `<div class="row small dim" style="margin-top:6px;gap:8px"><span class="mono">${esc(p.baseUrl || "")}</span><span>· ${p.api === "anthropic" ? "Anthropic-compatible" : "OpenAI-compatible"}</span><button class="ghost small" data-cp-edit="${p.id}" style="margin-left:auto">Edit</button><button class="ghost small" data-cp-del="${p.id}">Delete</button></div>` : ""}
    ${p.links?.keys && !p.keyed ? `<div class="row small" style="margin-top:8px"><a class="btn sm" href="${esc(p.links.keys)}" target="_blank" rel="noopener">Get a ${esc(p.name)} API key</a><span class="dim">then paste it below</span></div>` : ""}
    ${!p.hasApi ? `<div class="dim small" style="margin-top:8px">No public API: credits are tracked from what you log, and the links below open the real thing.</div>` : `<div class="row" style="margin-top:10px">
      ${p.noKey ? `<span class="small dim" style="flex:1">No key needed (runs on this PC)</span>` : `<input type="password" placeholder="${p.keyed ? `saved: ${p.masked}` : p.keyHint || "API key"}" data-key="${p.id}" style="flex:1" autocomplete="off">`}
      ${p.id === "kling" ? `<input type="password" placeholder="secret key" data-secret="${p.id}" style="flex:1" autocomplete="off">` : ""}
      ${p.noKey ? "" : `<button class="btn sm" data-save-key="${p.id}">Save &amp; test</button>`}
      ${p.keyed ? `<button class="btn sm" data-test="${p.id}">Test</button><button class="btn sm danger" data-rm-key="${p.id}">Remove</button>` : ""}
    </div>`}
    <div class="row small" style="margin-top:8px;gap:12px">${Object.entries(p.links || {}).filter(([, u]) => u).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${k}</a>`).join("")}</div>
    ${p.kind === "text" ? `<div class="models">${p.models.map((m) => `<div class="mrow" data-model="${esc(m.id)}"><span class="mono" title="${esc(m.id)}">${esc(m.name)} <span class="dim">· ${m.tier}</span></span><input type="number" step="0.01" value="${m.in}" data-in title="$ per 1M input tokens"><input type="number" step="0.01" value="${m.out}" data-out title="$ per 1M output tokens"><button class="ghost small" data-price>save $</button></div>`).join("")}
      ${p.liveModels?.length ? `<div class="dim small" style="margin-top:6px">Your account can also see: ${p.liveModels.slice(0, 14).map(esc).join(", ")}${p.liveModels.length > 14 ? "…" : ""}</div>` : ""}</div>` : ""}
  </div>`;
  v.innerHTML = `
  <div class="grid" style="grid-template-columns: 1fr 1fr">
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Chat &amp; reasoning AIs <span class="right">${S.mode === "hosted" ? "keys encrypted in your hub" : "keys stay on this PC"} · ${esc(S.vault?.method || "")}</span></h3>
        ${anyKeyHtml()}
        <div class="grid" style="gap:10px;margin-top:10px">${textP.map(card).join("")}</div>
        ${S.mode === "hosted" ? "" : `<div class="row" style="margin-top:10px"><button class="btn sm" id="cp-add">+ Add custom provider</button><span class="dim small">Any OpenAI- or Anthropic-compatible API: OpenRouter, Groq, Together, Fireworks, DeepSeek, Mistral, Perplexity, Ollama, LM Studio, a company gateway.</span></div><div id="cp-form"></div>`}</div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>General</h3>
        <div class="grid cols-3">
          <div><label class="lbl">Monthly API budget $</label><input type="number" id="s-budget" value="${S.settings.budgetMonthly}"></div>
          <div><label class="lbl">Default priority</label><select id="s-mode">${["quality", "balanced", "economy"].map((m) => `<option ${S.settings.defaultMode === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
          <div><label class="lbl">Mission cap $</label><input type="number" id="s-mcap" value="${S.settings.missionBudget}" step="0.5"></div>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn sm" id="s-save">Save</button><button class="btn sm" id="s-check">Re-check all AIs</button>
          <label class="row small" style="gap:6px;margin-left:auto"><input type="checkbox" id="s-demo" ${S.demo ? "checked" : ""}> Demo mode (3 pretend AIs, no spend)</label></div>
        <div class="dim small" style="margin-top:6px">${S.mode === "hosted" ? "" : `${S.hqDir ? `HQ folder: ${esc(S.hqDir)} · ` : ""}<a href="#" id="s-setup">Run first-time setup again</a> · `}<span id="s-upd-box">${updateBoxHtml()}</span></div>
        ${S.mode === "hosted"
          ? `<div class="dim small" style="margin-top:8px">Your API keys are encrypted (AES-256-GCM) before they are stored and are only decrypted inside the hub to call the provider you gave them to. They are never sent to this browser.</div>`
          : S.vault?.canSave === false
            ? `<div class="small" style="margin-top:8px;color:var(--amber)">Keys cannot be saved here: ${esc(S.vault?.method || "")} Keys are only ever stored encrypted by the operating system; use the desktop app.</div>`
            : `<div class="dim small" style="margin-top:8px">Vault file: <span class="mono">${esc(S.vault?.file || "")}</span>. Keys are sealed with ${esc(S.vault?.method || "the operating system")} for your user account and never leave this machine except to the provider you gave them to.</div>`}
      </div>
      ${S.mode === "hosted" ? `<div class="panel"><h3>Account <span class="right">${esc(S.user?.email || "")}</span></h3>
        <div class="row"><span class="small muted">Signed in to the hub at <span class="mono">${esc(hubAddress())}</span>.</span><button class="btn sm" id="acct-out" style="margin-left:auto">Sign out</button></div></div>` : ""}
      <div class="panel"><h3>Phone &amp; other devices <span class="right">pairing</span></h3>
        <div class="grid" style="grid-template-columns: 1fr 150px; gap: 14px; align-items: start">
          <div>
            <label class="lbl">Hub address</label>
            <div class="row"><input type="text" id="hub-addr" value="${esc(hubAddress())}" placeholder="https://your-hub.fly.dev" style="flex:1;font-family:var(--mono)"><button class="btn sm" id="hub-save">Use this hub</button>${HUB ? `<button class="btn sm" id="hub-reset" title="Go back to the hub that served this page">Reset</button>` : ""}</div>
            <div class="dim small" style="margin-top:8px">Scan the code with your phone camera to open this hub there, then Share → Add to Home Screen (iPhone) or Install app (Android). Any browser works: the phone talks to the hub, so your PC can be off${S.mode === "hosted" ? "" : " once the hub is hosted (see docs/hosted-hub.md)"}.</div>
            <div class="row small" style="margin-top:8px"><a href="${esc(hubAddress())}" target="_blank" rel="noopener" class="mono">${esc(hubAddress())}</a><button class="ghost small" id="hub-copy">copy link</button></div>
          </div>
          <img id="hub-qr" alt="QR code for ${esc(hubAddress())}" style="width:150px;height:150px;background:#fff;border-radius:10px;padding:6px">
        </div></div>
      <div class="panel"><h3>Licence &amp; cloud <span class="right">tier: ${esc(S.license?.tier || "free")}${S.license?.configured ? "" : " · no licence server"}</span></h3>
        <div class="row"><input type="text" id="lic-key" placeholder="${S.license?.key ? `active: ${esc(S.license.key)}` : "EVB-XXXX-XXXX-XXXX"}" style="flex:1;font-family:var(--mono)"><button class="btn sm primary" id="lic-go">Activate</button><button class="btn sm" id="lic-re">Re-check</button></div>
        <div class="small muted" style="margin-top:6px">${esc(S.license?.message || "")} ${S.license?.email ? `· ${esc(S.license.email)}` : ""} ${(S.license?.tier || "free") === "free" ? `· Free tier: Single mode, ${S.license?.limits?.councilsPerMonth ?? 3} councils/month, 1 project. <a href="https://square.link/u/dbU38mQC" target="_blank" rel="noopener">Go Pro, $15.99/month</a>` : ""}</div>
        <div class="row" style="margin-top:8px"><input type="text" id="lic-code" placeholder="promo code" style="width:180px">${S.mode === "hosted" ? `<span class="small muted" style="flex:1">redeems for ${esc(S.user?.email || "your account")}</span>` : `<input type="text" id="lic-email" placeholder="your email" style="flex:1">`}<button class="btn sm" id="lic-redeem">Redeem</button></div>
        ${S.license?.configured ? "" : `<div class="dim small" style="margin-top:8px">No licence server is configured, so this copy runs on the Free tier. The desktop build ships with the connection built in; when running from source, enter the Supabase project URL and publishable key below (or set CC_SUPABASE_URL and CC_SUPABASE_ANON_KEY).</div>`}
        ${S.mode === "hosted" ? "" : `<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Licence server (Supabase) connection${S.license?.cloudSource ? ` · using ${esc(S.license.cloudSource)}` : ""}</summary>
          <div class="row" style="margin-top:8px"><input type="text" id="cl-url" placeholder="https://xxxx.supabase.co" value="${esc(S.settings.cloud?.url || S.license?.cloudUrl || "")}" style="flex:1"><input type="password" id="cl-key" placeholder="publishable key (required)" style="flex:1" autocomplete="off"><button class="btn sm" id="cl-save">Save</button></div>
          <div class="dim small" style="margin-top:6px">Both fields are required. Changing the project never raises the tier: the licence is re-checked against the new server.</div></details>`}
      </div>
      <div id="settings-extras" class="grid" style="gap:16px"></div>
      <div class="panel"><h3>Media &amp; creative tools <span class="right">credits tracked · API where one exists</span></h3>
        <div class="grid" style="gap:10px">${mediaP.map(card).join("")}</div></div>
    </div>
  </div>`;
  $$("[data-save-key]", v).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.saveKey; const key = $(`[data-key="${id}"]`, v).value.trim(); const secret = $(`[data-secret="${id}"]`, v)?.value.trim();
    if (!key) return toast("Paste the key first", true);
    const sug = await suggestKey(key);
    if (sug && sug.provider !== id && sug.confidence === "high" && confirm(`This looks like a ${sug.name} key, not ${pname(id)}. Save it as ${sug.name} instead?`)) return saveKeyAs(sug, key);
    b.disabled = true; b.textContent = "Testing…";
    try { const r = await api("/keys", { method: "POST", body: { provider: id, key, secret } }); keyToast(id, r); await refresh(); }
    catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Save & test"; }
  }));
  $$("[data-test]", v).forEach((b) => b.addEventListener("click", async () => { b.textContent = "…"; const r = await api(`/check/${b.dataset.test}`, { method: "POST" }); toast(`${pname(b.dataset.test)}: ${r.status} · ${r.detail}`, r.status === "red"); await refresh(); }));
  $$("[data-rm-key]", v).forEach((b) => b.addEventListener("click", async () => { if (!confirm(`Remove the ${pname(b.dataset.rmKey)} key from the vault?`)) return; await api(`/keys/${b.dataset.rmKey}`, { method: "DELETE" }); await refresh(); }));
  $$("[data-price]", v).forEach((b) => b.addEventListener("click", async () => { const row = b.closest(".mrow"); await api("/pricing", { method: "POST", body: { model: row.dataset.model, in: Number($("[data-in]", row).value), out: Number($("[data-out]", row).value) } }); toast("Price saved"); }));
  $("#s-save").addEventListener("click", async () => { S.settings = await api("/settings", { method: "POST", body: { budgetMonthly: Number($("#s-budget").value), defaultMode: $("#s-mode").value, missionBudget: Number($("#s-mcap").value) } }); renderBudget(); toast("Saved"); });
  $("#s-check").addEventListener("click", async () => { toast("Checking every AI…"); await api("/check", { method: "POST" }); await refresh(); });
  $("#s-setup")?.addEventListener("click", (e) => { e.preventDefault(); S.view = "setup"; render(); });
  $("#acct-out")?.addEventListener("click", () => signOut(true, "Signed out."));
  $("#hub-save").addEventListener("click", () => { const v = $("#hub-addr").value.trim().replace(/\/$/, ""); if (!/^https?:\/\//.test(v)) return toast("Enter a full address, e.g. https://your-hub.fly.dev", true); localStorage.setItem("cc.hub", v); location.reload(); });
  $("#hub-reset")?.addEventListener("click", () => { localStorage.removeItem("cc.hub"); location.reload(); });
  $("#hub-copy").addEventListener("click", () => { navigator.clipboard.writeText(hubAddress()); toast("Link copied"); });
  apiBlobUrl(`/pair/qr.svg?u=${encodeURIComponent(hubAddress())}`).then((u) => { const img = $("#hub-qr"); if (img) img.src = u; }).catch(() => {});
  $("#lic-go")?.addEventListener("click", async () => { try { S.license = await api("/license", { method: "POST", body: { key: $("#lic-key").value } }); toast(S.license.message || "Licence checked", S.license.tier === "free"); render(); } catch (e) { toast(e.message, true); } });
  $("#lic-re")?.addEventListener("click", async () => { S.license = await api("/license/recheck", { method: "POST" }); toast(S.license.message || "Re-checked"); render(); });
  $("#lic-redeem")?.addEventListener("click", async () => { try { S.license = await api("/license", { method: "POST", body: { code: $("#lic-code").value, email: $("#lic-email")?.value || S.user?.email } }); toast(`Redeemed: ${S.license.tier}`); render(); } catch (e) { toast(e.message, true); } });
  $("#cl-save")?.addEventListener("click", async () => { try { const r = await api("/cloud", { method: "POST", body: { url: $("#cl-url").value, anonKey: $("#cl-key").value } }); S.settings.cloud = r.cloud; S.license = r.license; toast("Licence server saved; re-checking the licence"); render(); } catch (e) { toast(e.message, true); } });
  renderUpdateBox();
  $("#s-demo").addEventListener("change", async (e) => { const r = await api("/demo", { method: "POST", body: { on: e.target.checked } }); S.demo = r.demo; toast(r.demo ? "Demo AIs online" : "Demo AIs offline"); await refresh(); });
  wireAnyKey(v);
  $("#cp-add")?.addEventListener("click", () => openCustomForm());
  $$("[data-cp-edit]", v).forEach((b) => b.addEventListener("click", () => openCustomForm(b.dataset.cpEdit)));
  $$("[data-cp-del]", v).forEach((b) => b.addEventListener("click", async () => { if (!confirm(`Delete the custom provider ${pname(b.dataset.cpDel)} and its saved key? Past runs stay in history.`)) return; try { await api(`/providers/custom/${encodeURIComponent(b.dataset.cpDel)}`, { method: "DELETE" }); toast("Custom provider deleted"); await refresh(); } catch (e) { toast(e.message, true); } }));
  renderExtras("settings", "#settings-extras");
  if (S.focusProvider) { const el = $(`#prov-${S.focusProvider}`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.animate([{ boxShadow: "0 0 0 2px var(--accent)" }, { boxShadow: "none" }], { duration: 1600 }); S.focusProvider = null; }
}

async function refresh() { applyState(await api("/state")); renderStrip(); renderBudget(); render(); }

// ----- Keys for any provider (v0.3.1) -----
function keyToast(id, r) {
  const st = r.status || {};
  toast(`${pname(id)}: ${st.status === "green" ? "key works" : st.detail || st.status}`, st.status === "red");
  if (r.demoRetired) { S.demoNoticeShown = true; toast("Demo AIs removed now that your own keys are set up. You can turn demo mode back on in Settings."); api("/demo/ack", { method: "POST" }).catch(() => {}); }
}
async function suggestKey(key) { try { return (await api("/providers/suggest", { method: "POST", body: { key } })).suggestion; } catch { return null; } }
async function saveKeyAs(sug, key) {
  if (sug.builtin && P(sug.provider)) { try { const r = await api("/keys", { method: "POST", body: { provider: sug.provider, key } }); keyToast(sug.provider, r); S.focusProvider = sug.provider; await refresh(); } catch (e) { toast(e.message, true); } return; }
  // a provider we only know as a preset (Together, Fireworks): open the custom form filled in
  S.view = "settings"; render(); openCustomForm(null, { preset: sug.provider, key });
}
function anyKeyHtml() {
  return `<div class="route" style="margin-top:4px"><div class="small muted" style="margin-bottom:6px">Paste any API key and the app works out which provider it belongs to (AIza... is Google Gemini, sk-ant-... is Claude, xai-... is Grok).</div>
    <div class="row"><input type="password" id="anykey" placeholder="paste any API key" style="flex:1" autocomplete="off"><button class="btn sm primary" id="anykey-go">Detect &amp; save</button></div>
    <div class="small" id="anykey-out" style="margin-top:6px"></div></div>`;
}
function wireAnyKey(root) {
  const go = $("#anykey-go", root); if (!go) return;
  go.addEventListener("click", async () => {
    const key = $("#anykey", root).value.trim(); const out = $("#anykey-out", root);
    if (!key) return toast("Paste the key first", true);
    const sug = await suggestKey(key);
    if (!sug) { out.innerHTML = `Not sure which provider this key is for. Paste it into the right card below, or <a href="#" id="anykey-custom">add it as a custom provider</a>.`; $("#anykey-custom", root)?.addEventListener("click", (e) => { e.preventDefault(); openCustomForm(null, { key }); }); return; }
    out.textContent = `Looks like a ${sug.name} key${sug.confidence === "high" ? "" : " (best guess)"}.`;
    if (sug.confidence !== "high" && !confirm(`This looks like a ${sug.name} key, but it is a guess. Save it as ${sug.name}?`)) return;
    await saveKeyAs(sug, key);
  });
}
async function openCustomForm(editId, pre = {}) {
  const box = $("#cp-form"); if (!box) return toast("Custom providers are added in the desktop app.", true);
  let presets = [], existing = null;
  try { presets = (await api("/providers/presets")).presets; if (editId) existing = (await api("/providers/custom")).custom.find((c) => c.id === editId); } catch (e) { return toast(e.message, true); }
  const pr = presets.find((x) => x.id === pre.preset);
  const f = existing || (pr ? { name: pr.name, baseUrl: pr.baseUrl, api: pr.api, noKey: pr.noKey, keysUrl: pr.keys } : { api: "openai" });
  box.innerHTML = `<div class="route" style="margin-top:10px"><div class="cat-h">${existing ? `Edit ${esc(existing.name)}` : "Add custom provider"}</div>
    ${existing ? "" : `<div class="row small" style="flex-wrap:wrap;gap:6px;margin-bottom:8px"><span class="dim">Presets:</span>${presets.map((x) => `<button class="ghost small" data-preset="${x.id}" title="${esc(x.baseUrl)}">${esc(x.name)}${x.builtin ? " (built in)" : ""}</button>`).join("")}</div>`}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
      <label class="small">Name<input type="text" id="cp-name" value="${esc(f.name || "")}" placeholder="My gateway" style="width:100%"></label>
      <label class="small">API style<select id="cp-api" style="width:100%"><option value="openai" ${f.api !== "anthropic" ? "selected" : ""}>OpenAI-compatible (most providers)</option><option value="anthropic" ${f.api === "anthropic" ? "selected" : ""}>Anthropic-compatible</option></select></label>
      <label class="small" style="grid-column:1/3">Base URL<input type="text" id="cp-url" value="${esc(f.baseUrl || "")}" placeholder="https://api.example.com/v1" style="width:100%;font-family:var(--mono)"></label>
      <label class="small">API key<input type="password" id="cp-key" value="${esc(pre.key || "")}" placeholder="${existing?.keyed ? "saved (leave empty to keep)" : "API key"}" style="width:100%" autocomplete="off" ${f.noKey ? "disabled" : ""}></label>
      <label class="row small" style="gap:6px;align-self:end"><input type="checkbox" id="cp-nokey" ${f.noKey ? "checked" : ""}> No key needed (Ollama, LM Studio)</label>
      <label class="small" style="grid-column:1/3">Models (comma separated; leave empty to discover from /models)<div class="row"><input type="text" id="cp-models" value="${esc((f.models || []).join(", "))}" placeholder="e.g. llama-3.3-70b, qwen3-32b" style="flex:1;font-family:var(--mono)"><button class="btn sm" id="cp-discover">Discover models</button></div></label>
      <label class="small" style="grid-column:1/3">Extra headers (optional, one per line as Name: value; stored encrypted)<textarea id="cp-headers" rows="2" style="width:100%;font-family:var(--mono)" placeholder="${existing?.headerNames?.length ? `saved: ${esc(existing.headerNames.join(", "))} (leave empty to keep)` : "X-Org-Id: 1234"}"></textarea></label>
    </div>
    ${f.keysUrl ? `<div class="small" style="margin-top:6px"><a href="${esc(f.keysUrl)}" target="_blank" rel="noopener">Get a key for ${esc(f.name)}</a></div>` : ""}
    <div class="row" style="margin-top:8px"><button class="btn sm primary" id="cp-save">${existing ? "Save changes" : "Add provider"}</button><button class="btn sm" id="cp-cancel">Cancel</button><span class="small dim" id="cp-msg"></span></div></div>`;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  $$("[data-preset]", box).forEach((b) => b.addEventListener("click", () => { const x = presets.find((y) => y.id === b.dataset.preset); if (x.builtin) { S.focusProvider = x.builtin; box.innerHTML = ""; render(); return toast(`${x.name} is built in: paste the key into its card.`); } openCustomForm(null, { preset: x.id, key: $("#cp-key", box).value }); }));
  $("#cp-nokey", box).addEventListener("change", (e) => { $("#cp-key", box).disabled = e.target.checked; });
  $("#cp-cancel", box).addEventListener("click", () => { box.innerHTML = ""; });
  const headers = () => { const t = $("#cp-headers", box).value.trim(); if (!t) return existing ? undefined : {}; return Object.fromEntries(t.split(/\n/).map((l) => l.split(/:(.*)/s)).filter((x) => x[0]?.trim()).map(([n, v]) => [n.trim(), (v || "").trim()])); };
  const body = () => ({ id: existing?.id, name: $("#cp-name", box).value, baseUrl: $("#cp-url", box).value, api: $("#cp-api", box).value, key: $("#cp-key", box).value, noKey: $("#cp-nokey", box).checked, models: $("#cp-models", box).value, headers: headers(), keysUrl: f.keysUrl || null });
  $("#cp-discover", box).addEventListener("click", async () => { const m = $("#cp-msg", box); m.textContent = "Asking the provider for its models..."; try { const r = await api("/providers/discover", { method: "POST", body: body() }); $("#cp-models", box).value = r.models.slice(0, 40).join(", "); m.textContent = `${r.models.length} model${r.models.length === 1 ? "" : "s"} found. Trim the list to the ones you want.`; } catch (e) { m.textContent = e.message; } });
  $("#cp-save", box).addEventListener("click", async (e) => { const b = e.target; b.disabled = true; $("#cp-msg", box).textContent = "Saving and testing..."; try { const r = await api("/providers/custom", { method: "POST", body: body() }); box.innerHTML = ""; keyToast(r.provider.id, r); S.focusProvider = r.provider.id; await refresh(); } catch (err) { $("#cp-msg", box).textContent = err.message; b.disabled = false; } });
}

// ---------------- boot ----------------
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.view = b.dataset.view; S.openProject = null; render(); });
$("#feed-clear").addEventListener("click", () => { S.feed = []; renderFeed(); });
$("#mobile-nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.hasAttribute("data-feed")) { $("#feed").classList.toggle("open"); return; } S.view = b.dataset.view; S.openProject = null; render(); });
// PWA: when a new service worker takes over (new version deployed), offer a refresh instead of reloading under the person
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("/sw.js").then((reg) => { setInterval(() => reg.update().catch(() => {}), 3600 * 1000); }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) showRefreshPrompt(); });
}
function showRefreshPrompt() {
  if ($("#sw-refresh")) return;
  const d = document.createElement("div"); d.id = "sw-refresh"; d.className = "update-bar"; d.setAttribute("role", "status");
  d.innerHTML = `<span>↑</span><div><b>New version available</b></div><button class="btn sm primary" style="margin-left:auto" id="sw-refresh-go">Refresh</button><button class="ghost small" id="sw-refresh-later">later</button>`;
  const bar = $("#update-bar"); if (bar) bar.after(d); else document.body.prepend(d);
  $("#sw-refresh-go").addEventListener("click", () => location.reload());
  $("#sw-refresh-later").addEventListener("click", () => d.remove());
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "Install app"; b.style.marginLeft = "4px"; b.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; b.remove(); }; $(".top-right").prepend(b); });
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }, 1000);

// ----- sign-in gate (hosted mode) -----
function renderGate(message = "") {
  const g = $("#gate"); g.style.display = "";
  $("#app").style.visibility = "hidden";
  const unreachable = !CONFIG.supabase;
  g.innerHTML = `<div class="gate-card">
    <div class="brand" style="justify-content:center;margin-bottom:6px"><span class="brand-mark"></span><span class="brand-name">COMMAND <b>AI</b></span></div>
    <div class="muted small" style="text-align:center;margin-bottom:18px">${unreachable ? `Cannot reach the hub at <span class="mono">${esc(hubAddress())}</span>.` : `Sign in to your hub at <span class="mono">${esc(hubAddress())}</span>`}</div>
    ${unreachable ? "" : `<label class="lbl">Email</label>
    <form id="gate-form" class="row" style="gap:8px"><input type="email" id="gate-email" required placeholder="you@example.com" style="flex:1" autocomplete="email" value="${esc(localStorage.getItem("cc.email") || "")}"><button class="btn primary" type="submit" id="gate-go">Email me a sign-in link</button></form>
    <div class="small muted" style="margin-top:10px">No password. We email you a link; open it on this device and you are in. New here? The same link creates your account.</div>`}
    <div class="dim small" style="text-align:center;margin-top:16px">Command AI, an Everborn product by Everborn Productions</div>
    <div id="gate-msg" class="small" style="margin-top:12px;min-height:18px;color:${message ? "var(--amber)" : "var(--green)"}">${esc(message)}</div>
    <details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Hub address</summary>
      <div class="row" style="margin-top:8px"><input type="text" id="gate-hub" value="${esc(hubAddress())}" style="flex:1;font-family:var(--mono)"><button class="btn sm" id="gate-hub-save">Use</button>${HUB ? `<button class="btn sm" id="gate-hub-reset">Reset</button>` : ""}</div></details>
  </div>`;
  $("#gate-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#gate-email").value.trim(); if (!email) return;
    localStorage.setItem("cc.email", email);
    const b = $("#gate-go"); b.disabled = true; b.textContent = "Sending…";
    try {
      const redirect = location.origin + location.pathname;
      const r = await fetch(`${CONFIG.supabase.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, { method: "POST", headers: { apikey: CONFIG.supabase.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, create_user: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.msg || j.error_description || j.message || `HTTP ${r.status}`);
      $("#gate-msg").style.color = "var(--green)"; $("#gate-msg").textContent = `Link sent to ${email}. Open it on this device (check spam if it takes a minute).`;
    } catch (err) { $("#gate-msg").style.color = "var(--red)"; $("#gate-msg").textContent = err.message; b.disabled = false; b.textContent = "Email me a sign-in link"; }
  });
  $("#gate-hub-save")?.addEventListener("click", () => { const v = $("#gate-hub").value.trim().replace(/\/$/, ""); if (!/^https?:\/\//.test(v)) return; localStorage.setItem("cc.hub", v); location.reload(); });
  $("#gate-hub-reset")?.addEventListener("click", () => { localStorage.removeItem("cc.hub"); location.reload(); });
}
function hideGate() { $("#gate").style.display = "none"; $("#app").style.visibility = ""; }

async function boot() {
  captureAuthFromHash();
  try { const r = await fetch(HUB + "/api/config", { cache: "no-store" }); if (!r.ok) throw new Error(r.statusText); CONFIG = await r.json(); }
  catch { CONFIG = { mode: HUB ? "hosted" : "local", supabase: null }; if (HUB) return renderGate("The hub did not answer."); }
  document.body.classList.toggle("hosted", CONFIG.mode === "hosted");
  if (CONFIG.mode === "hosted" && !AUTH) return renderGate();
  hideGate();
  connect();
}
// Feature plugins (web/features/*.js) get a small, stable API; see web/features/index.js.
window.CC = { get S() { return S; }, api, toast, md, esc, money, fmtN, ago, favicon, P, pname, pcolor, $, $$, render, refresh, renderOutput, go: (view) => { S.view = view; S.openProject = null; render(); } };
import("/features/index.js").then(() => { if (S.providers.length) render(); }).catch((e) => console.warn("[features]", e));
boot();

// ----- Setup (first run) -----
function renderSetup(v) {
  const st = S.setup || (S.setup = { step: 1, history: true, keys: true, bookmarks: true, days: 180, result: null, busy: false });
  if (st.step === 1 || !st.result) {
    v.innerHTML = `<div style="max-width:860px;margin:0 auto">
      <div class="panel" style="padding:26px">
        <div class="row" style="gap:14px;align-items:flex-start"><span class="brand-mark" style="margin-top:6px"></span><div>
          <h2 style="margin:0 0 6px;font-size:22px">Let's connect the AIs you already use</h2>
          <div class="muted">Three optional steps. Everything below runs on this PC only; nothing is uploaded anywhere.</div></div></div>
        <div class="grid" style="margin-top:22px;gap:12px">
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-h" ${st.history ? "checked" : ""} style="margin-top:4px"><div><b>Look at my browser history to find the AIs and creative tools I use</b><div class="dim small">Reads Chrome / Edge / Brave history files locally for the last <input type="number" id="su-days" value="${st.days}" style="width:64px;padding:2px 6px;display:inline"> days, counts visits to known AI sites, then deletes the temporary copy. You see the list and choose what to connect.</div></div></label>
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-k" ${st.keys ? "checked" : ""} style="margin-top:4px"><div><b>Check whether any AI API keys are already on this PC</b><div class="dim small">Looks at environment variables such as ANTHROPIC_API_KEY or OPENAI_API_KEY. Found keys are shown masked; you decide which to import into the sealed vault.</div></div></label>
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-b" ${st.bookmarks ? "checked" : ""} style="margin-top:4px"><div><b>Organize my AI bookmarks</b><div class="dim small">Builds a "🤖 AI" bookmark folder (chat, video, music, dev, billing pages) from what was found. You can download it as an import file or let the app add it to Chrome directly (that closes and reopens Chrome).</div></div></label>
        </div>
        <div class="row" style="margin-top:22px"><button class="btn primary" id="su-go" ${st.busy ? "disabled" : ""}>${st.busy ? "Scanning…" : "Start"}</button><button class="btn" id="su-skip">Skip, I'll add keys myself</button><span class="dim small" style="margin-left:auto">You can run this again from Settings.</span></div>
      </div></div>`;
    $("#su-go").addEventListener("click", async () => {
      st.history = $("#su-h").checked; st.keys = $("#su-k").checked; st.bookmarks = $("#su-b").checked; st.days = Number($("#su-days").value) || 180;
      st.busy = true; render();
      try { st.result = await api("/setup/scan", { method: "POST", body: { history: st.history, keys: st.keys, days: st.days } }); st.step = 2; }
      catch (e) { toast(e.message, true); }
      st.busy = false; render();
    });
    $("#su-skip").addEventListener("click", async () => { await api("/setup/done", { method: "POST" }); S.settings.onboarded = true; S.view = "settings"; render(); });
    return;
  }
  const r = st.result, scan = r.scan, keys = r.keys || {};
  const provRows = (scan?.providers || []).map((e) => {
    const p = P(e.provider); const k = keys[e.provider];
    const linked = p?.keyed;
    return `<div class="route" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border-left:3px solid ${p?.color || "#4b5563"}">
      <div><b>${esc(e.name)}</b> <span class="dim small">· ${fmtN(e.visits)} visits · last ${ago(e.lastVisit)} ago · ${esc(e.profiles.join(", "))}</span>
        <div class="small" style="margin-top:4px">${linked ? `<span class="chip green">linked ✓</span>` : k ? `<span class="chip violet">key found on this PC (${esc(k.source)}, ${esc(k.masked)})</span>` : p?.hasApi ? `<span class="chip">needs an API key</span>` : `<span class="chip">no public API · tracked by credits</span>`}</div></div>
      <div class="row" style="justify-content:flex-end">
        ${!linked && k ? `<button class="btn sm primary" data-import="${e.provider}">Import key</button>` : ""}
        ${!linked && p?.hasApi ? `<button class="btn sm" data-open="${e.provider}">Open key page</button><input type="password" placeholder="paste key" data-paste="${e.provider}" style="width:170px;padding:5px 8px"><button class="btn sm" data-savek="${e.provider}">Save</button>` : ""}
        ${p && !p.hasApi ? `<button class="btn sm" data-track='${esc(JSON.stringify({ name: e.name, provider: e.provider, url: e.url, visits: e.visits }))}'>Track credits</button>` : ""}
      </div></div>`; }).join("");
  const toolRows = (scan?.tools || []).map((e) => `<label class="row small" style="padding:4px 0"><input type="checkbox" data-tool='${esc(JSON.stringify({ name: e.name, url: e.url, visits: e.visits }))}'> <b>${esc(e.name)}</b> <span class="dim">· ${fmtN(e.visits)} visits · ${esc(e.cat)}</span></label>`).join("");
  const folder = r.folder || [];
  const profiles = r.profiles || [];
  v.innerHTML = `<div style="max-width:980px;margin:0 auto" class="grid">
    <div class="panel"><h3>AIs you use <span class="right">${scan ? `${scan.days} days · ${scan.scanned.length} browser profile${scan.scanned.length === 1 ? "" : "s"} scanned` : "history scan skipped"}</span></h3>
      <div class="grid" style="gap:8px">${provRows || `<div class="empty">No known AI sites found in the history window. Add keys in Settings instead.</div>`}</div>
      ${anyKeyHtml()}
      <div class="dim small" style="margin-top:8px">Not listed? Paste the key above, or add any provider (Google Gemini, OpenRouter, Groq, Ollama...) in <a href="#" id="setup-settings">Settings</a>. "Open key page" opens the provider's API-key page in your browser. Copy the key, paste it here, Save. Keys are sealed by the operating system (${esc(S.vault?.method || "Windows DPAPI")}) and never leave this PC.</div></div>
    ${toolRows ? `<div class="panel"><h3>Other AI &amp; creative tools found <span class="right">tick to track as subscriptions</span></h3>${toolRows}<div class="row" style="margin-top:8px"><button class="btn sm" id="su-track">Track selected</button></div></div>` : ""}
    ${st.bookmarks && folder.length ? `<div class="panel"><h3>Your AI bookmark folder <span class="right">${folder.reduce((a, c) => a + c.links.length, 0)} links</span></h3>
      <div class="grid cols-3" style="gap:10px">${folder.map((c) => `<div><div class="cat-h" style="margin:4px 0 6px">${esc(c.name)}</div>${c.links.map((l) => `<div class="small" style="padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><img src="${favicon(l.url)}" style="width:12px;height:12px;vertical-align:-1px;margin-right:6px">${esc(l.name)}</div>`).join("")}</div>`).join("")}</div>
      <div class="row" style="margin-top:14px"><button class="btn sm" id="su-dl">Download import file</button>
        <select id="su-prof" style="width:auto">${profiles.map((x) => `<option value="${x.browser}|${x.dir}" ${x.synced ? "disabled" : ""}>${esc(x.browserName)} · ${esc(x.name)}${x.email ? ` (${esc(x.email)})` : ""}${x.synced ? " · synced, use import" : ""}</option>`).join("")}</select>
        <button class="btn sm primary" id="su-apply">Add to this browser now</button><span class="dim small">closes and reopens the browser, keeps your tabs, backs up first</span></div></div>` : ""}
    <div class="row"><button class="btn" id="su-back">← Back</button><button class="btn primary" id="su-done" style="margin-left:auto">Finish setup</button></div></div>`;
  $$("[data-import]", v).forEach((b) => b.addEventListener("click", async () => { const r2 = await api("/setup/import-keys", { method: "POST", body: { providers: [b.dataset.import] } }); toast(r2.imported.length ? `${pname(b.dataset.import)} linked` : "Nothing imported", !r2.imported.length); await refresh(); }));
  $$("[data-open]", v).forEach((b) => b.addEventListener("click", async () => { const r2 = await api("/setup/open", { method: "POST", body: { provider: b.dataset.open } }); toast(`Opened ${r2.url}`); }));
  wireAnyKey(v);
  $("#setup-settings", v)?.addEventListener("click", (e) => { e.preventDefault(); S.view = "settings"; render(); });
  $$("[data-savek]", v).forEach((b) => b.addEventListener("click", async () => { const key = $(`[data-paste="${b.dataset.savek}"]`, v).value.trim(); if (!key) return toast("Paste the key first", true); b.textContent = "…"; try { const r2 = await api("/keys", { method: "POST", body: { provider: b.dataset.savek, key } }); keyToast(b.dataset.savek, r2); await refresh(); } catch (e) { toast(e.message, true); b.textContent = "Save"; } }));
  $$("[data-track]", v).forEach((b) => b.addEventListener("click", async () => { try { await api("/setup/track", { method: "POST", body: { tools: [JSON.parse(b.dataset.track)] } }); toast("Added to Subscriptions"); await refresh(); } catch (e) { toast(e.message, true); } }));
  $("#su-track")?.addEventListener("click", async () => { const tools = $$("[data-tool]:checked", v).map((c) => JSON.parse(c.dataset.tool)); if (!tools.length) return toast("Tick a tool first", true); try { const r2 = await api("/setup/track", { method: "POST", body: { tools } }); toast(`Tracking ${r2.added.join(", ")}`); await refresh(); } catch (e) { toast(e.message, true); } });
  $("#su-apply")?.addEventListener("click", async () => { const [browser, profile] = $("#su-prof").value.split("|"); if (!confirm(`This will close ${browser} (gracefully, tabs restore on relaunch), add the 🤖 AI folder to profile "${profile}", and reopen it. Continue?`)) return; try { const r2 = await api("/setup/bookmarks/apply", { method: "POST", body: { browser, profile } }); toast(`Bookmarks added. Backup saved.${r2.relaunched ? " Browser relaunched." : ""}`); } catch (e) { toast(e.message, true); } });
  $("#su-dl")?.addEventListener("click", async () => { try { downloadBlob(await apiBlobUrl("/setup/bookmarks.html"), "ai-bookmarks.html"); } catch (e) { toast(e.message, true); } });
  $("#su-back").addEventListener("click", () => { st.step = 1; st.result = null; render(); });
  $("#su-done").addEventListener("click", async () => { await api("/setup/done", { method: "POST" }); S.settings.onboarded = true; toast("Setup complete"); S.view = "command"; render(); });
}
