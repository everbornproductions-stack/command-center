import { AgentGraph } from "/graph.js";
import { usageFromSummary, isUsageJob, windowStart } from "/graph-usage.js";
import { installNav, placeNavItem, markNav, markLocks, closeNav, groupFor, GROUPS, currentNavLayout, currentNavPromote, promotable, watchNavLayout, rowOverflows, COMMAND_MODES, shortcutModeOf, commandHeading } from "./nav.js";
import { DAY_VIEWS, EXPERT_SETTINGS, SIMPLE_COMMAND, SIMPLE_STARTER_COUNT, isFreshInstall, resolveMode, resolveProjectMode, shouldAskMode, simpleAllows } from "./mode.js";
import { isNavStateEnabled, captureViewDraft, restoreViewDraft, createNavHistory } from "./nav-state.js";
import { EXPERT_SETUP, FAILURE, MODE_STEP, PLACEHOLDER, RESTART_SETUP_LABEL, STARTERS, TEXT_SIZES, WELCOME, nextRestartPhase, setupPhase, spendLine } from "./simple-ui.js";
import { compareTable } from "./compare.js";
import { arrangeAnswerActions } from "./answer-actions.js";
import { councilRequest, simpleAnswerLine } from "./council-offer.js";
import { composerAis, hideDemoBots, graphNodes, demoBannerOn, DEMO_BANNER_TEXT, DEMO_BANNER_ACTION } from "./composer-ais.js";
import { projectIntent } from "./project-intent.js";
import { askText } from "./ask-dialog.js";
import { NEW_PROJECT, projectNameError, projectOptionsHtml } from "./project-picker.js";
import { barShows, barHtml, lastRunFor } from "./projectbar.js";
import { PAUSE_LABEL, isPausedStatus, pausedNow, quietProvider } from "./access-label.js";
import { attachPack } from "./features/prompt-order.js";
import { maskNotice, riskyHits } from "./copy-guard.js";
import { extremeExtrasHtml, founderSpotsHtml, planCompareHtml, upgradeButtonsHtml } from "./plan-compare.js";
import { createPaidWatch } from "./paid-watch.js";
import { isDesktopOnly } from "./desktop-only.js";
import { installPasswordTip, tipHtml } from "./sign-in-tip.js";
import { IDLE_LINE, OPS_SHOWN, newestTasks, opsState, showDeliverable } from "./live-ops.js";
import { installClickTracking, noteToast, trackBusy, withBusy } from "./busy.js";
import { renderProjectTeam, wireEmployeeHint } from "./employees-ui.js";

// ---------------- state ----------------
const S = {
  providers: [], ledger: null, subscriptions: [], subscriptionTotals: null, projects: [], hq: null, missions: [], settings: {}, skills: {}, vault: null, capabilities: [],
  view: "command", project: localStorage.getItem("cc.project") || "", live: newLive(), feed: [], activeByProvider: {}, routePreview: null, openProject: null, onboarding: null, onboardingNoticeAt: null, pairing: null, connectSetup: null, connectWizard: false, visitedConnect: false, settingsLoaded: false, backgroundQuiet: new Set(),
  navMenu: "", navFocus: "", uiMode: "simple", askMode: false, returnView: null, awaitingRun: false,
};
function newLive() { return { id: null, kind: null, status: null, agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null }; }
const PRIORITY = [["max", "Max quality"], ["quality", "Quality"], ["balanced", "Balanced"], ["savings", "Max savings"], ["speed", "Speed"]];
function priorityNow() {
  const raw = S.costMode || S.settings?.defaultMode || "balanced";
  return raw === "economy" ? "savings" : raw;
}
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
// Any request started by a click marks that button busy until it ends (web/busy.js).
function api(path, opts = {}) { return trackBusy(apiCall(path, opts)); }
async function apiCall(path, opts = {}) {
  const headers = await apiHeaders();
  // opts.raw: a File or Blob sent as is (history import zip), with opts.contentType
  const { raw, contentType, ...rest } = opts;
  const r = await apiFetch(HUB + "/api" + path, { headers: raw ? { ...headers, "content-type": contentType || "application/zip" } : headers, ...rest, body: raw || (opts.body ? JSON.stringify(opts.body) : undefined) });
  if (r.status === 401 && CONFIG.mode === "hosted") { signOut(false, "Signed out. Sign in again."); throw new Error("Sign in required"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(httpError(r, j));
    if (j?.code) err.code = j.code;
    if (j?.missing) err.missing = j.missing;
    if (j?.questions) err.questions = j.questions;
    if (j?.code === "pro_required") showUpgrade(err.message);
    throw err;
  }
  return j;
}
// Error states: never a bare "Failed to fetch" or an empty message. A network failure names the engine
// (or the hub) and what to do; an error answer without a message names the HTTP status.
function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ""));
  if (!m) return false;
  const n = m.slice(1).map(Number);
  if (n.some((x) => x > 255)) return false;
  if (n[0] === 10) return true;
  if (n[0] === 192 && n[1] === 168) return true;
  return n[0] === 172 && n[1] >= 16 && n[1] <= 31;
}
// The phone opened this PC's Wi-Fi address (or a pairing link). A failed fetch is that, not a dead local engine.
function phoneSide() {
  try {
    if (isPrivateIPv4(location.hostname)) return true;
    if (new URL(location.href).searchParams.has("pair")) return true;
    if (HUB && isPrivateIPv4(new URL(HUB).hostname)) return true;
  } catch {}
  return false;
}
const PHONE_FETCH = "This phone cannot reach the PC. Use the same Wi-Fi, turn on phone pairing in Settings, and allow Meldmind on private networks in Windows Firewall.";
async function apiFetch(url, opts) {
  try { return await fetch(url, opts); }
  catch (e) {
    if (e?.name === "AbortError") throw e;
    if (phoneSide()) throw new Error(PHONE_FETCH);
    throw new Error(HUB ? `Could not reach the hub at ${HUB}. Check the connection and try again.` : "Could not reach Meldmind's engine. Check that the app is still running, then try again.");
  }
}
function httpError(r, j) { return j?.error || (r.status === 404 ? "Not found (404)" : `Request failed (HTTP ${r.status}${r.statusText ? " " + r.statusText : ""})`); }
// Fetch a non-JSON API response (download, QR image) with the same auth headers; returns a blob: URL.
async function apiBlobUrl(path) {
  const r = await apiFetch(HUB + "/api" + path, { headers: await apiHeaders() });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(httpError(r, j)); }
  return URL.createObjectURL(await r.blob());
}
function downloadBlob(url, filename) { const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function showUpgrade(message) {
  if (document.getElementById("cc-upgrade")) return;
  const box = document.createElement("div");
  box.id = "cc-upgrade";
  box.innerHTML = `<div class="card" role="dialog" aria-labelledby="cc-upgrade-title"><h4 id="cc-upgrade-title">That is a Pro feature</h4><p>${esc(message || "This is part of Pro.")}</p><div style="margin-top:12px">${compareTable(esc)}</div><p class="dim small" style="margin-top:8px">Upgrade means adding a license key in Settings.</p><div class="row" style="margin-top:12px;gap:8px"><button class="btn primary" type="button" id="cc-upgrade-go">Open Settings</button><button class="btn" type="button" id="cc-upgrade-close">Not now</button></div></div>`;
  document.body.appendChild(box);
  box.querySelector("#cc-upgrade-close").addEventListener("click", () => box.remove());
  box.querySelector("#cc-upgrade-go").addEventListener("click", () => { box.remove(); S.view = "settings"; render(); setTimeout(() => document.getElementById("lic-key")?.focus(), 50); });
}
function toastNeedKey() {
  noteToast();
  const t = document.createElement("div");
  t.className = "toast err";
  t.setAttribute("role", "alert");
  t.append(document.createTextNode("Add at least one API key first. "));
  const a = document.createElement("a");
  a.href = "#";
  a.textContent = "Turn on demo mode";
  a.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/demo", { method: "POST", body: { on: true } });
      S.demo = r.demo;
      toast("Demo AIs online");
      await refresh();
    } catch (err) { toast(err.message, true); }
  });
  t.append(a);
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 8000);
}
function toast(msg, err = false, link = null, ttl = 0) {
  noteToast();
  if (err && !link && document.getElementById("cc-upgrade") && /part of Pro/.test(String(msg || ""))) return;
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : "");
  t.append(document.createTextNode(msg));
  if (link?.label && typeof link.onClick === "function") {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "toast-link";
    a.textContent = link.label;
    a.addEventListener("click", (ev) => { ev.preventDefault(); link.onClick(); t.remove(); });
    t.append(a);
  }
  if (err) t.setAttribute("role", "alert"); // errors are announced right away; the rest via the polite #toasts region
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), ttl || (err ? 6000 : 3500));
}
// A click handler that forgot its try/catch still tells the person what went wrong instead of failing silently.
// The same message is shown at most once every 10 s, so a failing background poll cannot flood the screen.
const lastUnhandled = new Map();
window.addEventListener("unhandledrejection", (e) => {
  const err = e.reason;
  if (!err || err.name === "AbortError") return;
  const msg = String(err.message || err);
  console.warn("[unhandled]", err);
  if (Date.now() - (lastUnhandled.get(msg) || 0) < 10000) return;
  lastUnhandled.set(msg, Date.now());
  toast(msg, true);
});
// Keyboard: anything drawn as a clickable card or row (role="button", not a real <button>) opens with Enter or Space.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.getAttribute("role") !== "button" || /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  e.preventDefault(); el.click();
});
// Segmented choices (Single / Council / Mission and the like) tell screen readers which one is on.
function markSeg(box) { if (box) $$("button", box).forEach((x) => x.setAttribute("aria-pressed", String(x.classList.contains("on")))); }

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
  s = s.replace(/\[([^\]]+)\]\(((?:https?:|\/)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.split(/\n{2,}/).map((p) => (/^<(h\d|ul|ol|pre|table|blockquote)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("\n");
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[i]);
  return s;
}

// ---------------- reload guard (v0.3.2) ----------------
// Every automatic reload goes through here: at most one per reason per session, and each one is
// written to the desktop app's main log. This is what stops a "restart loop".
function safeReload(reason, { manual = false } = {}) {
  const key = "cc.reload." + reason.replace(/[^a-z]+/gi, "-").slice(0, 40);
  if (!manual && sessionStorage.getItem(key)) { window.ccDesktop?.logReload?.(`blocked repeat reload: ${reason}`); return false; }
  sessionStorage.setItem(key, String(Date.now()));
  window.ccDesktop?.logReload?.(`${manual ? "reload (clicked)" : "auto reload"}: ${reason}`);
  location.reload();
  return true;
}

// ---------------- engine down panel (v0.3.2) ----------------
// After about 15 s of "reconnecting", stop spinning: say why and offer "Restart engine" (desktop app)
// or "Try again" (browser / phone). The desktop main process also offers this in a dialog and the tray.
const ENGINE_TIMEOUT_MS = 15000;
let downSince = 0, desktopReason = null;
window.ccDesktop?.onEngine?.((st) => { desktopReason = st.reason || null; if (st.stuck) engineDown(true); });
async function engineReason() {
  if (desktopReason) return desktopReason;
  try { const r = await fetch(`${HUB || ""}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) }); return r.ok ? "the live connection keeps dropping, although the engine answers" : `the engine answered HTTP ${r.status}`; }
  catch { return phoneSide() ? PHONE_FETCH : HUB ? `the hub at ${HUB} cannot be reached (offline, or the hub is down)` : `the local engine at ${location.host} is not answering (it stopped or never started)`; }
}
async function engineDown(on) {
  let el = document.getElementById("engine-down");
  if (!on) { downSince = 0; desktopReason = null; el?.remove(); return; }
  const secs = Math.round((Date.now() - (downSince || Date.now())) / 1000);
  const reason = await engineReason();
  if (!downSince && !desktopReason) return; // came back while we were asking
  if (!el) { el = document.createElement("div"); el.id = "engine-down"; el.setAttribute("role", "alertdialog"); el.style.cssText = "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(5,8,13,.78)"; document.body.appendChild(el); }
  const desk = !!window.ccDesktop?.restart;
  el.innerHTML = `<div class="panel" style="max-width:520px;padding:24px">
    <h3 style="margin:0 0 8px">Meldmind's engine is not responding</h3>
    <div class="small muted">Still trying to reconnect${secs ? ` (${secs} s)` : ""}. Reason: <span class="mono" id="ed-reason"></span></div>
    <div class="row" style="margin-top:14px;gap:8px">${desk ? `<button class="btn primary" id="ed-restart">Restart engine</button><button class="btn" id="ed-update">Check for updates</button>` : `<button class="btn primary" id="ed-retry">Try again</button>`}<button class="btn" id="ed-wait" style="margin-left:auto">Keep waiting</button></div>
    <div class="dim small" style="margin-top:10px" id="ed-msg">${desk ? "Restarting keeps your settings, keys and history." : "If this is the desktop app's address, open the app or restart it from its tray icon."}</div></div>`;
  $("#ed-reason", el).textContent = reason;
  $("#ed-restart", el)?.addEventListener("click", () => { $("#ed-msg", el).textContent = "Restarting..."; window.ccDesktop.restart(); });
  $("#ed-update", el)?.addEventListener("click", async () => { $("#ed-msg", el).textContent = "Checking for updates..."; try { const st = await window.ccDesktop.checkForUpdates(); $("#ed-msg", el).textContent = st?.version ? `Update ready, restart: v${st.version}. Use Install now in the update window.` : st?.error ? "Couldn't check for updates" : "You have the newest version."; } catch (e) { $("#ed-msg", el).textContent = e.message; } });
  $("#ed-retry", el)?.addEventListener("click", () => { el.remove(); clearTimeout(wsTimer); connect(); });
  $("#ed-wait", el).addEventListener("click", () => { el.remove(); downSince = Date.now(); });
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
    engineDown(false);
  };
  ws.onclose = (e) => { if (e.code === 4401 || e.code === 4403) return; $("#conn-dot").className = "dot red"; $("#conn-txt").textContent = "reconnecting"; downSince ||= Date.now(); clearTimeout(wsTimer); wsTimer = setTimeout(connect, 1500); if (Date.now() - downSince > ENGINE_TIMEOUT_MS) engineDown(true); else setTimeout(() => { if (downSince && Date.now() - downSince > ENGINE_TIMEOUT_MS) engineDown(true); }, ENGINE_TIMEOUT_MS + 200); };
  ws.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "auth.error") {
      if (CONFIG.mode === "hosted") return signOut(false, ev.error || "Sign in again.");
      // local: the server was relaunched with a new token; reload ONCE per session to pick it up.
      // A second mismatch means the page itself is stale: stop and show the engine panel (no loop).
      if (safeReload("session token changed (engine restarted)")) return;
      $("#conn-dot").className = "dot red"; $("#conn-txt").textContent = "reload the page";
      try { ws.onclose = null; ws.close(); } catch {}
      downSince = Date.now() - ENGINE_TIMEOUT_MS - 1; desktopReason = "this window's session does not match the engine; use Restart engine";
      engineDown(true);
      return;
    }
    handle(ev);
  };
}
function noteOnboarding(ob) {
  if (!ob?.notice) return;
  const at = ob.noticeAt || ob.notice;
  if (S.onboardingNoticeAt === at) return;
  S.onboardingNoticeAt = at;
  toast(ob.notice);
  api("/onboarding/ack", { method: "POST" }).catch(() => {});
}
function syncUiMode() {
  const fresh = isFreshInstall({ onboarding: S.onboarding, settings: S.settings });
  S.uiMode = resolveProjectMode((S.projects || []).find((p) => p.id === S.project), S.settings, { fresh });
  S.askMode = shouldAskMode(S.settings, { fresh });
  if (document.body) document.body.dataset.ui = S.uiMode;
}
function applyState(st) {
  S.settingsLoaded = true;
  const settings = st.settings || S.settings || {};
  const providers = hideDemoBots(st.providers, { demoKeep: !!settings.demoKeep, realAi: st.realAi === undefined ? !!S.realAi : !!st.realAi });
  S.councilOffer = st.councilOffer || S.councilOffer || null;
  Object.assign(S, { mode: st.mode, user: st.user, hub: st.hub, license: st.license, update: st.update, version: st.version, rules: st.rules, scheduled: st.scheduled, demo: st.demo, providers, ledger: st.ledger, subscriptions: st.subscriptions || [], subscriptionTotals: st.subscriptionTotals, subscriptionsLocked: !!st.subscriptionsLocked, projects: st.projects, deletedProjects: st.deletedProjects || [], flags: st.flags || {}, hq: st.hq, missions: st.missions, settings: st.settings, projectMedia: st.projectMedia === true, skills: st.skills, vault: st.vault, capabilities: st.capabilities, hqDir: st.hqDir, onboarding: st.onboarding || null, pairing: st.pairing || null, connectSetup: st.connectSetup || null, proPlans: st.proPlans || null, realAi: st.realAi === undefined ? !!S.realAi : !!st.realAi, cli: Array.isArray(st.cli) ? st.cli : (S.cli || []) });
  S.plugins = st.plugins || [];
  S.flags = st.flags || S.flags || {};
  if (!S.project && Array.isArray(S.projects) && S.projects.length) {
    const sample = S.projects.find((p) => p.sample) || S.projects[0];
    if (sample?.id) S.project = sample.id;
  }
  S.demoBanner = demoBannerOn({ demoBanner: st.demoBanner, demo: !!st.demo, demoKeep: !!settings.demoKeep, realAi: S.realAi });
  renderDemoBanner();
  syncUiMode();
  noteOnboarding(S.onboarding);
  if (st.settings?.demoNotice && !S.demoNoticeShown) { S.demoNoticeShown = true; toast("Demo AIs removed now that your own keys are set up. You can turn demo mode back on in Settings."); api("/demo/ack", { method: "POST" }).catch(() => {}); }
  if (S.flags?.finishpath) syncFinishBar();
  for (const f of window.CC?.features || []) { if (f.onState) { try { f.onState(S); } catch (e) { console.warn(`[feature ${f.id}]`, e); } } }
}
function handle(ev) {
  for (const f of window.CC?.features || []) { if (f.onEvent) { try { f.onEvent(ev); } catch (e) { console.warn(`[feature ${f.id}]`, e); } } }
  // Start a project examples and the walk overlay are for the live view. They are not missions.
  if (ev?.example === true || ev?.overlay === true) return;
  switch (ev.type) {
    case "hello": {
      applyState(ev.state);
      S.feed = (ev.state.recent || []).filter((e) => ["log", "agent.msg", "agent.error", "agent.start", "agent.done", "provider.status", "ledger.entry"].includes(e.type)).slice(-60);
      const run = ev.state.lastRun;
      const runFinished = run && ["done", "done-with-errors", "failed", "aborted", "cancelled"].includes(run.status);
      if (run && !S.live.id && !runFinished) { if (run.kind === "council") { S.live = newLive(); S.live.id = run.id; S.live.kind = "council"; S.live.council = run; S.live.status = run.status; if (run.verdict?.text) S.live.deliverable = run.verdict.text; } else { S.live = newLive(); S.live.id = run.id; S.live.kind = run.kind; S.live.mission = run; S.live.status = run.status; for (const t of run.tasks || []) S.live.tasks[t.id] = t; S.live.deliverable = run.deliverable || ""; } }
      if (S.mode !== "hosted" && !S.visitedSetup && (S.onboarding ? S.onboarding.show === true : !S.settings?.onboarded)) { S.visitedSetup = true; S.connectWizard = false; S.view = "setup"; }
      else if (S.mode !== "hosted" && !S.visitedConnect && !S.settings?.onboarded && S.connectSetup?.show) { S.visitedConnect = true; S.connectWizard = true; S.view = "setup"; }
      document.body.classList.toggle("hosted", S.mode === "hosted");
      const setupTab = $("#tab-setup"); if (setupTab) setupTab.style.display = S.mode === "hosted" ? "none" : "";
      renderAll(); return;
    }
    case "tick": {
      const providers = hideDemoBots(ev.providers, { demoKeep: !!S.settings?.demoKeep, realAi: !!S.realAi });
      Object.assign(S, { ledger: ev.ledger, subscriptions: ev.subscriptions || [], subscriptionTotals: ev.subscriptionTotals, subscriptionsLocked: !!ev.subscriptionsLocked, providers });
      renderStrip(); renderBudget(); syncGraph();
      if (["credits", "subscriptions"].includes(S.view) && !window.CC?.byKind?.("tab").some((f) => f.id === S.view)) render();
      return;
    }
    case "provider.status": {
      const p = P(ev.provider);
      if (p) {
        p.status = { status: ev.status, detail: ev.detail, latencyMs: ev.latencyMs, balance: ev.balance };
        if (p.access && isPausedStatus(ev.status, ev.detail)) { p.access.paused = true; p.access.label = PAUSE_LABEL; }
        else if (p.access?.label === PAUSE_LABEL) { p.access.paused = false; p.access.label = p.keyed ? null : p.access.label; }
      }
      renderStrip();
      if (!quietProvider(p)) graph?.setStatus(ev.provider, ev.status);
      if (!(p && isPausedStatus(ev.status, ev.detail))) pushFeed(ev);
      return;
    }
    case "agent.start": if (quietProvider(P(ev.provider))) return; onAgentStart(ev); pushFeed(ev); return;
    case "agent.delta": onAgentDelta(ev); return;
    case "agent.done": if (quietProvider(P(ev.provider))) return; onAgentEnd(ev, false); pushFeed(ev); return;
    case "agent.error": onAgentEnd(ev, true); pushFeed(ev); return;
    case "agent.msg": graph?.pulse(ev.from, ev.to, ev.text); pushFeed(ev); return;
    case "task.update": onTask(ev); return;
    case "mission.update": onMission(ev.mission); return;
    case "council.update": onCouncil(ev.council); return;
    case "ledger.entry": {
      const entry = ev.entry;
      if (S.ledger && entry.kind === "call") { S.ledger.month += entry.cost; S.ledger.today += entry.cost; S.ledger.calls++; const b = S.ledger.byProvider[entry.provider]; if (b) { b.month += entry.cost; b.today += entry.cost; b.calls++; if (isUsageJob(entry) && (entry.ts || Date.now()) >= windowStart()) b.calls30 = (b.calls30 || 0) + 1; } renderBudget(); renderStrip(); }
      else if (S.ledger && isUsageJob(entry)) { const b = S.ledger.byProvider[entry.provider]; if (b && (entry.ts || Date.now()) >= windowStart()) b.calls30 = (b.calls30 || 0) + 1; }
      noteRunJob(entry);
      refreshGraphUsage();
      return;
    }
    case "log": pushFeed(ev); return;
    case "update.state": S.update = ev.update; renderUpdateBar(); renderUpdateBox(); return;
    case "onboarding.notice": noteOnboarding({ notice: ev.text, noticeAt: ev.at }); if (S.onboarding) S.onboarding = { ...S.onboarding, notice: ev.text, noticeAt: ev.at }; return;
  }
}

// ---------------- live run handling ----------------
let graph = null;
let taskTouchN = 0;
// Drafts for the reply boxes. A live update redraws Live Ops, and the text the person is typing stays.
const replyDrafts = {};
// Jobs logged for the mission on screen. Kept until that mission ends, so a finished AI stays large while the run is still going.
let runJobs = {};
function activeIds() { return Object.entries(S.activeByProvider).filter(([, n]) => n > 0).map(([id]) => id); }
function graphRun() { const ids = activeIds(); return { live: ids.length > 0, runCounts: runJobs, activeIds: ids }; }
function refreshGraphUsage() { graph?.setUsage(usageFromSummary(S.ledger), graphRun()); }
function noteRunJob(entry) {
  if (!isUsageJob(entry) || !S.live.id) return;
  if (entry.missionId && entry.missionId !== S.live.id) return;
  runJobs[entry.provider] = (Number(runJobs[entry.provider]) || 0) + 1;
}
function isQuiet(id) {
  return !!(id && S.backgroundQuiet?.has(id) && S.live?.id !== id);
}
function ensureLive(id, kind) {
  if (isQuiet(id)) return;
  if (S.live.id !== id) { S.live = newLive(); S.live.id = id; S.live.kind = kind || (id?.startsWith("c-") ? "council" : id?.startsWith("m-") ? "mission" : id?.startsWith("r-") ? "research" : "single"); runJobs = {}; graph?.resetAll(); S.activeByProvider = {}; if (S.view === "command") renderOps(); }
}
function onAgentStart(ev) {
  if (isQuiet(ev.missionId)) return;
  if (quietProvider(P(ev.provider))) return;
  ensureLive(ev.missionId);
  S.live.agents[ev.agent] = { ...ev, text: "", done: false };
  if (ev.role === "followup" || ev.followup) {
    S.live.replying = { scope: ev.scope || "job", target: ev.target || "" };
    S.activeByProvider[ev.provider] = (S.activeByProvider[ev.provider] || 0) + 1;
    graph?.activate(ev.provider, "replying");
    refreshGraphUsage();
    renderStrip();
    if (S.view === "command") renderOps();
    return;
  }
  if (["chair", "assemble", "answer"].includes(ev.role) && (S.live.kind !== "council" || ev.role === "chair")) S.live.primary = ev.agent;
  if (S.live.kind === "single") S.live.primary = ev.agent;
  S.activeByProvider[ev.provider] = (S.activeByProvider[ev.provider] || 0) + 1;
  graph?.activate(ev.provider, ev.label?.replace(/^[^:]+:\s*/, "") || ev.role);
  refreshGraphUsage();
  renderStrip();
  if (S.view === "command") renderOps();
}
function onAgentDelta(ev) {
  if (ev.role === "followup" || ev.followup) {
    const a = S.live.agents[ev.agent] || (S.live.agents[ev.agent] = { ...ev, text: "", done: false });
    a.text += ev.text;
    const slot = document.querySelector(`[data-reply-live="${CSS.escape((ev.scope || "job") + ":" + (ev.target || ""))}"]`);
    if (slot) { slot.hidden = false; slot.innerHTML = md(a.text); }
    return;
  }
  const a = S.live.agents[ev.agent]; if (!a) return;
  a.text += ev.text;
  if (S.view !== "command") return;
  if (ev.agent === S.live.primary) { const o = $("#out-md"); const dp = $("#deliv-panel"); if (dp && a.text) dp.hidden = false; if (o) { o.innerHTML = md(a.text); o.classList.add("cursor"); o.scrollTop = o.scrollHeight; } }
  if (S.live.kind === "council" && a.role === "answer") { const c = $(`[data-ans="${CSS.escape(a.model)}"] .body`); if (c) { c.innerHTML = md(a.text); c.scrollTop = c.scrollHeight; } }
  if (S.live.kind === "mission" && ev.taskId) { const t = $(`[data-task="${ev.taskId}"] .bar i`); if (t) { const cur = parseFloat(t.style.width) || 0; t.style.width = Math.max(cur, Math.min(96, 10 + a.text.length / 40)) + "%"; } }
}
function onAgentEnd(ev, err) {
  if (isQuiet(ev.missionId)) return;
  const a = S.live.agents[ev.agent]; if (a) { a.done = true; a.error = ev.error; a.ms = ev.ms; a.cost = ev.cost; }
  S.activeByProvider[ev.provider] = Math.max(0, (S.activeByProvider[ev.provider] || 1) - 1);
  // A finished AI stays in this run's tally while someone else is still working, then the resting sizes return.
  if (activeIds().length && ev.provider) runJobs[ev.provider] = Math.max(Number(runJobs[ev.provider]) || 0, 1);
  if (activeIds().length) refreshGraphUsage();
  graph?.deactivate(ev.provider, err ? "error" : ev.ms ? `${(ev.ms / 1000).toFixed(1)}s` : "");
  if (!activeIds().length) refreshGraphUsage();
  renderStrip();
  if (S.view === "command" && ev.agent === S.live.primary) $("#out-md")?.classList.remove("cursor");
}
function onTask(ev) {
  if (isQuiet(ev.missionId)) return;
  ensureLive(ev.missionId, "mission");
  S.live.tasks[ev.task.id] = ev.task;
  (S.live.touched ||= {})[ev.task.id] = ++taskTouchN;
  if (S.view === "command") { renderTasks(); syncOpsPanel(); }
}
function replyTurns(run) {
  if (!run) return 0;
  let n = (run.thread || []).length + (run.answerThread || []).length;
  for (const t of run.tasks || []) n += (t.thread || []).length;
  for (const a of Object.values(run.answers || {})) n += (a.thread || []).length;
  return n;
}
function onMission(m) {
  if (m.kind === "council") return; // councils arrive through council.update
  if (isQuiet(m.id)) {
    const i = S.missions.findIndex((x) => x.id === m.id);
    const summ = { id: m.id, kind: m.kind, title: m.title, projectId: m.projectId, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt, cost: m.cost, tasks: (m.tasks || []).length, providers: [...new Set((m.tasks || []).map((t) => t.provider))].concat(m.provider ? [m.provider] : []) };
    if (i >= 0) S.missions[i] = summ; else S.missions.unshift(summ);
    return;
  }
  const before = S.live.id === m.id ? replyTurns(S.live.mission) : 0;
  ensureLive(m.id, m.kind);
  S.live.mission = m; S.live.status = m.status;
  for (const t of m.tasks || []) S.live.tasks[t.id] = t;
  if (m.deliverable) S.live.deliverable = m.deliverable;
  if (replyTurns(m) > before) S.live.replying = null;
  const i = S.missions.findIndex((x) => x.id === m.id);
  const summ = { id: m.id, kind: m.kind, title: m.title, projectId: m.projectId, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt, cost: m.cost, tasks: (m.tasks || []).length, providers: [...new Set((m.tasks || []).map((t) => t.provider))].concat(m.provider ? [m.provider] : []) };
  if (i >= 0) S.missions[i] = summ; else S.missions.unshift(summ);
  if (m.status) S.awaitingRun = false;
  syncSendButton();
  if (S.view === "command") { renderTasks(); renderOutput(); renderOpsHead(); }
  if (m.status === "cancelled") toast("Scheduled mission cancelled");
  if (m.status === "paused" && S.live.pauseStamp !== m.pausedAt) {
    S.live.pauseStamp = m.pausedAt;
    toast("Mission paused. You can edit the steps that have not finished, then resume.");
  }
  if (["done", "done-with-errors", "failed", "aborted"].includes(m.status)) {
    const stamp = `${m.id}|${m.status}|${m.finishedAt || 0}|${replyTurns(m)}`;
    if (S.live.finishStamp !== stamp) {
      S.live.finishStamp = stamp;
      graph?.resetAll(); S.activeByProvider = {}; runJobs = {}; refreshGraphUsage(); renderStrip();
      if (m.status === "done" || m.status === "done-with-errors") window.CC?.tour?.onAnswer?.(m.id);
      const simpleFail = S.uiMode === "simple" && (m.status === "failed" || (m.status === "aborted" && m.kind !== "single"));
      const cost = Number(m.cost) || 0;
      const noun = m.kind === "single" ? "Answer" : m.kind === "research" ? "Deep research" : m.kind === "opinion" ? "Second opinion" : "Mission";
      const stateWord = (m.kind === "research" || m.kind === "single") && m.status === "aborted" ? "stopped" : m.status.replace("-", " ");
      if (simpleFail) {
        S.simpleFail = { provider: m.provider || (m.tasks || []).find((t) => t.provider)?.provider || "", text: S.lastOrders || "" };
        if (S.view === "command") renderOutput();
      } else {
        const failed = m.status === "failed";
        const base = replyTurns(m) > 0 ? `Reply in · ${money(m.cost, 4)}` : `${noun} ${stateWord} · ${money(m.cost, 4)}`;
        toast(failed && m.error ? m.error : base, failed);
      }
      maybeNotifyFinish("Meldmind finished a run", m.status === "failed" && cost === 0 ? "Nothing was charged" : `${noun} ${stateWord}`);
    }
  }
}
function onCouncil(c) {
  if (isQuiet(c?.id)) return;
  const before = S.live.id === c.id ? replyTurns(S.live.council) : 0;
  ensureLive(c.id, "council");
  S.live.council = c; S.live.status = c.status;
  if (c.verdict?.text) S.live.deliverable = c.verdict.text;
  if (replyTurns(c) > before) S.live.replying = null;
  if (c.status) S.awaitingRun = false;
  syncSendButton();
  if (S.view === "command") { renderCouncil(); renderOpsHead(); if (c.verdict || replyTurns(c) > 0) renderOutput(); }
  if (c.status === "done") {
    const i = S.missions.findIndex((x) => x.id === c.id);
    const summ = { id: c.id, kind: "council", title: c.prompt.slice(0, 90), projectId: c.projectId, status: c.status, startedAt: c.startedAt, finishedAt: c.finishedAt, cost: c.cost, members: c.members.map((m) => m.provider) };
    if (i >= 0) S.missions[i] = summ; else S.missions.unshift(summ);
    const stamp = `${c.id}|${c.status}|${c.finishedAt || 0}|${replyTurns(c)}`;
    if (S.live.finishStamp !== stamp) {
      S.live.finishStamp = stamp;
      graph?.resetAll(); S.activeByProvider = {}; runJobs = {}; refreshGraphUsage(); renderStrip();
      toast(replyTurns(c) > 0 ? `Reply in · ${money(c.cost, 4)}` : `Council done · ${money(c.cost, 4)}`);
      maybeNotifyFinish("Meldmind finished a run", "Council done");
    }
  }
}

// ---------------- feed ----------------
function pushFeed(ev) {
  S.feed.push(ev); if (S.feed.length > 80) S.feed.shift();
  const list = $("#feed-list"); if (!list) return;
  const node = feedNode(ev); if (!node) return;
  list.querySelector(".feed-empty")?.remove();
  list.appendChild(node);
  while (list.children.length > 80) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}
function feedNode(ev) {
  const d = document.createElement("div");
  const t = new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let who = "", txt = "", cls = "", color = "";
  switch (ev.type) {
    case "log": who = "Meldmind"; txt = ev.text; cls = ev.level === "error" ? "err" : ""; color = "#22d3ee"; break;
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
  if (!list.children.length) list.innerHTML = `<div class="empty feed-empty">Quiet for now. When your AIs start, finish or hand work to each other, it shows up here.</div>`;
  list.scrollTop = list.scrollHeight;
}

// ---------------- strip + budget ----------------
function renderStrip() {
  const strip = $("#strip");
  // the AIs, then the outside agents (Grok Bot, the browser helper), then media tools
  const order = S.providers.filter((p) => p.kind === "text").concat(S.providers.filter((p) => p.kind === "agent"), S.providers.filter((p) => p.kind !== "text" && p.kind !== "agent"));
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
    if (pausedNow(p)) line = PAUSE_LABEL;
    else if (p.access?.label) line = p.access.label;
    const needsOwnKey = p.kind === "text" && !p.keyed && !p.noKey && !p.demo && !["handoff", "local", "mcp", "oauth"].includes(p.access?.auth);
    if (needsOwnKey) line = "No key";
    const active = S.activeByProvider[p.id] > 0 && !quietProvider(p);
    if (active) badge = `${S.activeByProvider[p.id]} working`;
    const isConnected = !!(p.keyed || p.access?.connected || p.connect?.mcp?.configured);
    const connBadge = isNavStateEnabled(S) && !active && isConnected ? `<span class="badge ok tile-connected">Connected</span>` : "";
    const stLight = needsOwnKey ? "grey" : pausedNow(p) ? "amber" : p.kind !== "text" && st === "grey" && sub ? (sub.signal === "low" || sub.signal === "attention" ? "red" : sub.signal === "renewing" ? "amber" : "green") : st;
    const lightWord = pausedNow(p) ? "paused" : (p.access?.label || { green: "working", amber: "warning", red: "problem", grey: "no key" }[stLight] || stLight);
    return `<div class="tile ${active ? "active" : ""}" style="--c:${p.color}" data-p="${p.id}" title="${esc(p.status?.detail || "")}" role="button" tabindex="0" aria-label="${esc(`${p.name}: ${lightWord}, ${line}${badge ? `, ${badge}` : ""}. Open its settings`)}">
      <div class="top"><span class="light ${stLight}" aria-hidden="true"></span><span class="name">${esc(p.name)}</span></div>
      <div class="sub">${esc(line)}</div>
      <div class="meter"><i style="width:${meter.toFixed(0)}%;background:${p.color}"></i></div>
      ${badge ? `<span class="badge">${badge}</span>` : connBadge}
    </div>`;
  }).join("");
  $$(".tile", strip).forEach((t) => {
    t.addEventListener("click", () => openProviderSetup(t.dataset.p));
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProviderSetup(t.dataset.p); } });
  });
  renderStripAfter();
}
function openProviderSetup(providerId) {
  if (!providerId) return;
  S.connectWizard = false;
  S.openProject = null;
  S.settingsMore = true;
  S.view = "settings";
  S.focusProvider = providerId;
  render();
}
function renderStripAfter() {
  renderComposerAis();
}
function renderBudget() {
  const b = S.settings.budgetMonthly || 0, m = S.ledger?.month || 0;
  $("#budget-val").textContent = `${money(m)} / ${money(b, 0)}`;
  $("#budget-pill").style.borderColor = m > b ? "var(--red)" : m > b * 0.8 ? "var(--amber)" : "var(--line)";
  const spend = $("#cc-spend");
  if (spend) spend.textContent = spendLine(m);
}

// ---------------- views ----------------
function renderUpdateBar() {
  const u = S.update, bar = $("#update-bar"); if (!bar) return;
  // A failed check is a quiet one-line notice in its own row (offline is normal). Hide closes it for this session.
  if (u?.error && !u?.available) {
    if (S.updateErrorHidden) { bar.style.display = "none"; return; }
    bar.style.display = "";
    bar.classList.add("quiet");
    const href = esc(u.downloadUrl || "https://github.com/everbornproductions-stack/command-center-releases/releases/latest");
    bar.innerHTML = `<div><b>Couldn't check for updates</b> <span class="small">You can keep working.</span></div><a class="btn sm" id="upd-dl" href="${href}" target="_blank" rel="noopener">Download</a><button class="ghost small" type="button" id="upd-hide">Hide</button>`;
    $("#upd-hide")?.addEventListener("click", () => { S.updateErrorHidden = true; bar.style.display = "none"; });
    return;
  }
  bar.classList.remove("quiet");
  if (!u?.available || S.updateDismissed === u.latest) { bar.style.display = "none"; return; }
  bar.style.display = "";
  const busy = u.phase === "downloading" || u.phase === "installing";
  const action = u.desktop
    ? `<button class="btn sm primary" style="margin-left:auto" id="upd-go" ${busy ? "disabled" : ""}>${u.phase === "downloading" ? `Downloading ${u.progress ?? 0}%` : u.phase === "installing" ? "Restarting..." : "Update ready, restart"}</button>`
    : `<a class="btn sm primary" style="margin-left:auto" href="${esc(u.url || "#")}" target="_blank" rel="noopener">Download</a>`;
  bar.innerHTML = `<span>↑</span><div><b>Update ready, restart</b> Meldmind v${esc(u.latest)} (you have v${esc(u.current)}). ${esc(u.notes || "")}${u.error ? ` <span style="color:var(--amber)">${esc(u.error)}</span>` : ""}</div>${action}${busy ? "" : `<button class="ghost small" id="upd-later">later</button>`}`;
  $("#upd-go")?.addEventListener("click", installUpdate);
  $("#upd-later")?.addEventListener("click", () => { S.updateDismissed = u.latest; bar.style.display = "none"; });
}
// Help > About: current version, Check for updates, and the install button when one is waiting
function updateBoxHtml() {
  const u = S.update || {};
  const busy = u.phase === "downloading" || u.phase === "installing";
  const status = u.phase === "downloading" ? `Downloading v${esc(u.latest)}: ${u.progress ?? 0}%`
    : u.phase === "installing" ? "Installing; the app restarts in a moment"
    : u.available ? `Update ready, restart: v${esc(u.latest)}`
    : u.checkedAt && !u.error ? "You are on the latest version" : "";
  return `<b>Meldmind</b> v${esc(S.version || u.current || "")} <span class="dim">(an Everborn product by Everborn Productions. Take command of all your AIs.)</span> <button class="btn sm" id="s-upd" ${busy ? "disabled" : ""}>Check for updates</button>`
    + (u.available && u.desktop ? ` <button class="btn sm primary" id="s-upd-go" ${busy ? "disabled" : ""}>Update ready, restart</button>` : "")
    + (status ? ` <span class="dim">${status}</span>` : "")
    + (u.error && !u.available ? ` <span>Couldn't check for updates</span> <a class="btn sm" href="${esc(u.downloadUrl || "https://github.com/everbornproductions-stack/command-center-releases/releases/latest")}" target="_blank" rel="noopener">Download</a>` : (u.error ? ` <span class="dim">(last check failed: ${esc(u.error)})</span>` : ""));
}
function renderUpdateBox() {
  const box = $("#s-upd-box"); if (!box) return;
  box.innerHTML = updateBoxHtml();
  $("#s-upd")?.addEventListener("click", async (e) => { e.preventDefault(); try { S.update = await api("/update/check", { method: "POST" }); } catch (err) { return toast(err.message, true); } S.updateDismissed = null; renderUpdateBar(); renderUpdateBox(); toast(S.update.available ? `Update ready, restart: v${S.update.latest}` : S.update.error ? "Couldn't check for updates" : "You are on the latest version", !!S.update.error); });
  $("#s-upd-go")?.addEventListener("click", installUpdate);
}
async function installUpdate() {
  try { S.update = await api("/update/install", { method: "POST" }); toast("Downloading the update; the app restarts when it is ready"); }
  catch (e) { toast(e.message, true); }
  renderUpdateBar(); renderUpdateBox();
}
function renderAll() { renderStrip(); renderBudget(); renderFeed(); renderUpdateBar(); render(); }
// The active tab is marked for screen readers as well as by colour.
function markTabs() { if (S.view !== "command" || S.uiMode !== "expert") S.cmdShortcut = ""; $$("#mobile-nav button[data-view], #mobile-more button").forEach((b) => { const on = b.dataset.view === S.view; b.classList.toggle("active", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }); markNav($("#tabs"), S.view, S.navMenu, S.cmdShortcut); }
function btnLabel(btn, text) {
  if (!btn) return;
  const icon = btn.querySelector("i");
  btn.textContent = "";
  if (icon) btn.appendChild(icon);
  btn.append(document.createTextNode(text));
}
function syncChrome() {
  const simple = S.uiMode !== "expert";
  if (document.body) {
    document.body.dataset.ui = simple ? "simple" : "expert";
    document.body.classList.toggle("show-ais", simple && !!S.settings?.simpleStrip);
  }
  $("#mode-simple")?.setAttribute("aria-pressed", String(simple));
  $("#mode-expert")?.setAttribute("aria-pressed", String(!simple));
  btnLabel($("#mobile-nav button[data-view='command']"), simple ? "Chat" : "Command");
  $$("#mobile-nav [data-expert-nav]").forEach((b) => { b.hidden = simple; });
  const create = $("#mobile-nav [data-simple-create]");
  if (create) create.hidden = !simple;
  const more = $("#mobile-nav [data-more]");
  if (more) more.hidden = simple;
  if (simple) $("#mobile-more")?.classList.remove("open");
  if (!simple) $("#simple-create")?.classList.remove("open");
}
function renderAsk() {
  document.getElementById("cc-mode-ask")?.remove();
}
function setUiMode(mode, opts = {}) {
  if (mode !== "simple" && mode !== "expert") return;
  const prev = S.uiMode;
  const firstExpert = mode === "expert" && prev !== "expert" && !S.settings?.expertConfirmed;
  if (firstExpert && !opts.confirmed && !opts.fromSetup) {
    if (!confirm("Expert shows every menu, councils, missions, and settings. You can switch back any time. Continue?")) return;
  }
  S.uiMode = mode;
  S.askMode = false;
  const patch = { uiMode: mode, uiModeChosen: true };
  if (mode === "expert") patch.expertConfirmed = true;
  // Switching while on Settings keeps Settings in view: no "Expert setup 1 of 5" over it (bug 7).
  const openExpert = mode === "expert" && !opts.fromSetup && prev !== "expert" && !S.settings?.expertSetup?.done && S.view !== "settings";
  S.settings = { ...(S.settings || {}), ...patch };
  if (mode === "simple" && !simpleAllows(S.view)) {
    S.returnView = S.view;
    S.view = "command";
  } else if (mode === "expert" && prev !== "expert" && S.returnView && !openExpert) {
    S.view = S.returnView;
    S.returnView = null;
  }
  if (openExpert) {
    S.connectWizard = false;
    S.view = "setup";
    S.setup = S.setup || {};
    S.setup.phase = "expert";
    S.setup.expertStep = S.settings.expertSetup?.step || "ais";
  }
  const root = $("#tabs");
  if (root) root.dataset.nav = "";
  render();
  window.CC?.tour?.onMode?.();
  if (mode === "expert" && prev === "simple" && !opts.fromSetup) toast("You are in Expert. Back to Simple any time.");
  api("/settings", { method: "POST", body: patch })
    .then((saved) => { if (saved && typeof saved === "object") S.settings = { ...S.settings, ...saved, ...patch }; })
    .catch((e) => toast(e.message, true));
  const activeProj = (S.projects || []).find((p) => p.id === S.project);
  if (activeProj) {
    activeProj.uiMode = mode;
    api("/projects", { method: "POST", body: { id: activeProj.id, uiMode: mode } }).catch(() => {});
  }
  Promise.resolve({})
    .then((saved) => { if (saved && typeof saved === "object") S.settings = { ...S.settings, ...saved, ...patch }; })
    .catch((e) => toast(e.message, true));
}
function toggleSimpleCreate() {
  let sheet = document.getElementById("simple-create");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "simple-create";
    sheet.setAttribute("role", "menu");
    sheet.setAttribute("aria-label", "Create");
    document.body.appendChild(sheet);
  }
  if (sheet.classList.contains("open")) { sheet.classList.remove("open"); return; }
  const items = [
    ["prompts", "Pro prompts"],
    ["images", "Images"],
    ["media", "Media"],
    ["publish", "Publish"],
  ];
  sheet.innerHTML = items.map(([view, label]) => `<button type="button" data-view="${view}">${esc(label)}</button>`).join("");
  sheet.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    sheet.classList.remove("open");
    S.view = b.dataset.view;
    S.openProject = null;
    S.navMenu = "create";
    render();
  }));
  sheet.classList.add("open");
}
// A menu item with data-focus opens its page scrolled to that panel.
function focusNavTarget() {
  if (!S.navFocus || S.view === "settings") return;
  const sel = S.navFocus;
  S.navFocus = "";
  setTimeout(() => document.querySelector(sel)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}
const navHistory = createNavHistory({ historyApi: typeof history !== "undefined" ? history : null });
function goBackView() {
  const v = $("#view");
  if (S.renderedView && v) captureViewDraft(S.renderedView, v);
  const prev = navHistory.back();
  if (!prev) return false;
  S.view = prev.view || "command";
  S.openProject = prev.openProject ?? null;
  if (typeof prev.settingsMore === "boolean") S.settingsMore = prev.settingsMore;
  if (prev.navFocus !== undefined) S.navFocus = prev.navFocus;
  if (prev.cmdMode) S.cmdMode = prev.cmdMode;
  render();
  return true;
}
function syncBackBtn() {
  const v = $("#view");
  if (!v) return;
  let btn = $("#nav-back");
  if (!isNavStateEnabled(S) || !navHistory.canGoBack()) {
    if (btn) btn.hidden = true;
    return;
  }
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "nav-back";
    btn.className = "ghost small";
    btn.setAttribute("data-nav-back", "1");
    btn.title = "Back to previous screen";
    btn.textContent = "← Back";
    btn.addEventListener("click", () => goBackView());
    const topRight = $(".top-right") || $(".topbar");
    if (topRight) topRight.prepend(btn);
  }
  btn.hidden = false;
}
if (typeof window !== "undefined") {
  window.addEventListener("popstate", (e) => {
    if (!isNavStateEnabled(S)) return;
    const st = navHistory.back();
    if (!st) return;
    const v = $("#view");
    if (S.renderedView && v) captureViewDraft(S.renderedView, v);
    S.view = st.view || "command";
    S.openProject = st.openProject ?? null;
    if (typeof st.settingsMore === "boolean") S.settingsMore = st.settingsMore;
    render();
  });
}
function render() {
  if (S.mode === "hosted" && isDesktopOnly(S.view)) S.view = "command";
  document.body.classList.toggle("light-mode", !!S.settings?.lightMode);
  const cc = window.CC;
  const light = !!S.settings?.lightMode;
  if (cc?.viewReady && !cc.viewReady(S.view, { light })) {
    const token = (cc._paintToken = (cc._paintToken || 0) + 1);
    cc.ensureView(S.view, { light }).then(() => {
      if (cc._paintToken === token) render();
    }).catch((e) => console.warn("[features]", e));
    return;
  }
  syncChrome();
  renderAsk();
  markTabs();
  syncProjectBar();
  $("#feed")?.classList.remove("open");
  const v = $("#view");
  if (isNavStateEnabled(S) && S.renderedView && v) captureViewDraft(S.renderedView, v);
  if (S.view === "help" && S.renderedView && S.renderedView !== "help") S.lastView = S.renderedView;
  if (isNavStateEnabled(S)) navHistory.record({ view: S.view, openProject: S.openProject || null, settingsMore: !!S.settingsMore, navFocus: S.navFocus || "", cmdMode: S.cmdMode || "" });
  graph = null;
  ensureFeatureTabs();
  const ft = window.CC?.byKind?.("tab").find((f) => f.id === S.view);
  if (ft) { try { ft.tab.render(v); focusNavTarget(); window.CC?.syncAssetTray?.(S.view); } catch (e) { console.warn(`[feature ${ft.id}]`, e); v.innerHTML = `<div class="empty" role="alert">The ${esc(ft.tab.label || ft.id)} tab could not open: ${esc(e.message)}<br><button class="btn sm" id="tab-retry" style="margin-top:10px">Try again</button></div>`; $("#tab-retry", v)?.addEventListener("click", render); } S.renderedView = S.view; restoreViewDraft(S.view, v); syncBackBtn(); return; }
  if (S.view === "command") renderCommand(v);
  else if (S.view === "projects") renderProjects(v);
  else if (S.view === "credits") renderCredits(v);
  else if (S.view === "subscriptions") renderSubscriptions(v);
  else if (S.view === "settings") renderSettings(v);
  else if (S.view === "setup" && S.connectWizard && window.CC.connectSetup) window.CC.connectSetup.render(v);
  else if (S.view === "setup") renderSetup(v);
  S.renderedView = S.view;
  if (isNavStateEnabled(S)) restoreViewDraft(S.view, v);
  syncBackBtn();
  window.CC?.syncAssetTray?.(S.view);
}
// Feature tabs register themselves (web/features/*.js). The top bar is grouped menus.
// Phones keep the bottom bar and put the rest in a More sheet, grouped the same way.
const NAV_ORDER = ["command", "projects", "compare", "pipelines", "agents", "liveview", "schedules", "libraries", "artifacts", "history", "everyday-inbox", "everyday-plan", "everyday-work", "refocus", "brain", "prompts", "marketplace", "images", "media", "publish", "remix", "builders", "webbuilders", "subscriptions", "credits", "workspaces", "together", "userchat", "reports", "community", "help", "settings", "setup"];
function knownViews() {
  const have = new Set(NAV_ORDER);
  for (const b of $$("#tabs button[data-view]")) if (!b.dataset.focus) have.add(b.dataset.view);
  for (const f of window.CC?.byKind?.("tab") || []) have.add(f.id);
  let ordered = NAV_ORDER.filter((id) => have.has(id));
  for (const id of have) if (!ordered.includes(id)) ordered.push(id);
  if (S.mode === "hosted") ordered = ordered.filter((id) => !isDesktopOnly(id));
  return ordered;
}
function ensureMobileMore() {
  let more = $("#mobile-more");
  if (more) return more;
  more = document.createElement("div");
  more.id = "mobile-more";
  more.className = "mobile-more";
  document.body.appendChild(more);
  const mb = document.createElement("button");
  mb.dataset.more = "1";
  mb.innerHTML = `<i>⋯</i>More`;
  mb.addEventListener("click", () => more.classList.toggle("open"));
  $("#mobile-nav").insertBefore(mb, $("#mobile-nav button[data-view=settings]"));
  return more;
}
// The width check is an estimate, so the real bar decides. A promoted page that
// overflows goes back to its menu (last one first). If there is room, the next one
// in the order comes up. Runs only when the wanted row changes.
function fitPromoted(root, views, mode, layout, surface, promote) {
  const order = promotable(mode, views, surface).map((p) => p.id);
  let shrank = false;
  while (promote.length && rowOverflows(root)) {
    promote = promote.slice(0, -1);
    shrank = true;
    installNav(root, views, mode, layout, surface, promote);
  }
  while (!shrank && promote.length < order.length && !rowOverflows(root)) {
    const next = order.slice(0, promote.length + 1);
    installNav(root, views, mode, layout, surface, next);
    if (rowOverflows(root)) { installNav(root, views, mode, layout, surface, promote); break; }
    promote = next;
  }
  return promote;
}
function ensureFeatureTabs() {
  const root = $("#tabs");
  const mode = S.uiMode === "expert" ? "expert" : "simple";
  let layout = currentNavLayout();
  if (layout !== "normal") layout = "narrow";
  if (root && root.dataset.navLayout && root.dataset.navLayout !== layout && !S.navFocus) S.navMenu = "";
  const surface = S.mode === "hosted" ? "web" : "";
  const views = knownViews();
  let promote = currentNavPromote(mode, views, layout, surface);
  if (root) {
    const want = promote.join(",");
    // Same width as last time: keep the row that already fit instead of rebuilding and trimming again.
    const kept = root.dataset.nav === "1" && root.dataset.navPromoteWant === want && root.dataset.uiMode === mode && root.dataset.navLayout === layout && (root.dataset.navSurface || "") === surface;
    if (kept) promote = (root.dataset.navPromote || "").split(",").filter(Boolean);
    root.dataset.navPromoteWant = want;
    installNav(root, views, mode, layout, surface, promote);
    if (!kept && root.clientWidth > 0) fitPromoted(root, views, mode, layout, surface, promote);
  }
  // Eight menus that still overflow this window merge back to the compact row.
  // A zero clientWidth means the bar has not been laid out yet, so it must not lock the compact row.
  if (mode === "expert" && root && root.dataset.navLayout === "normal" && root.clientWidth > 0 && rowOverflows(root)) {
    root.dataset.nav = "";
    installNav(root, views, mode, "narrow", surface);
  }
  for (const f of window.CC?.byKind?.("tab") || []) {
    if (S.mode === "hosted" && isDesktopOnly(f.id)) continue;
    placeNavItem(root, f.id, f.tab?.label || f.id);
    if (mode === "simple") continue;
    if ($(`#mobile-more button[data-view="${f.id}"]`) || $(`#mobile-nav button[data-view="${f.id}"]`)) continue;
    const more = ensureMobileMore();
    const gid = groupFor(f.id);
    let group = more.querySelector(`[data-mgroup="${gid}"]`);
    if (!group) {
      const label = document.createElement("div");
      label.className = "mobile-more-label";
      label.textContent = GROUPS[gid]?.label || gid;
      group = document.createElement("div");
      group.className = "mobile-more-group";
      group.dataset.mgroup = gid;
      more.append(label, group);
    }
    const b = document.createElement("button");
    b.dataset.view = f.id;
    b.innerHTML = `<i>${f.tab?.icon || "✦"}</i>${esc(f.tab?.short || f.tab?.label || f.id)}`;
    b.addEventListener("click", () => { more.classList.remove("open"); S.view = f.id; S.navMenu = gid; S.openProject = null; render(); });
    group.appendChild(b);
  }
  markNav(root, S.view, S.navMenu, S.cmdShortcut);
  markLocks(root, S.license?.limits);
  markTabs();
  $("#mobile-more")?.classList.remove("open");
  squeezeTopbar();
}
// The top bar never overlaps (0.4.17). When the menus do not fit (a narrow window, Large text,
// an update button), it drops extras in steps: 1 hides the name, Cloud and the clock, 2 hides
// the status pills, and 3 folds every menu under one Menu button. Phones use the bottom bar.
function squeezeTopbar() {
  const bar = $(".topbar"), root = $("#tabs");
  if (!bar || !root) return;
  const open = bar.classList.contains("nav-open");
  bar.classList.remove("nav-collapsed", "nav-open");
  bar.dataset.squeeze = String(squeezeLevel(bar, root));
  if (bar.dataset.squeeze === "3") { bar.classList.add("nav-collapsed"); if (open) bar.classList.add("nav-open"); }
  const toggle = $("#nav-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", String(bar.classList.contains("nav-open")));
}
function squeezeLevel(bar, root) {
  for (let level = 0; level < 3; level++) {
    bar.dataset.squeeze = String(level);
    if (!(root.clientWidth > 0)) return 0;
    if (!rowOverflows(root)) return level;
  }
  return 3;
}
let squeezeFrame = 0;
// Large and Extra large text change the menu widths without a resize.
new MutationObserver(() => { const root = $("#tabs"); if (root) root.dataset.nav = ""; ensureFeatureTabs(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-text"] });
window.addEventListener("resize", () => { cancelAnimationFrame(squeezeFrame); squeezeFrame = requestAnimationFrame(squeezeTopbar); });
$("#nav-toggle")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const bar = $(".topbar");
  bar?.classList.toggle("nav-open");
  e.currentTarget.setAttribute("aria-expanded", String(!!bar?.classList.contains("nav-open")));
});
$("#tabs")?.addEventListener("click", (e) => { if (e.target.closest("button[data-view]")) $(".topbar")?.classList.remove("nav-open"); });
function renderExtras(kind, sel, ...args) {
  const box = $(sel); if (!box) return;
  box.innerHTML = "";
  if (S.settings?.lightMode && (kind === "command" || kind === "deliverable")) return;
  const simple = S.uiMode === "simple";
  for (const f of window.CC?.byKind?.(kind) || []) {
    if (S.mode === "hosted" && isDesktopOnly(f.id)) continue;
    if (simple && kind === "command" && !SIMPLE_COMMAND.has(f.id)) continue;
    if (simple && kind === "settings" && EXPERT_SETTINGS.has(f.id)) continue;
    const d = document.createElement("div"); d.dataset.feature = f.id; box.appendChild(d); try { f[kind].render(d, ...args); } catch (e) { d.innerHTML = `<div class="dim small">${esc(f.id)}: ${esc(e.message)}</div>`; }
  }
}
function renderFeature(kind, id, sel) {
  const box = $(sel); if (!box) return;
  box.innerHTML = "";
  const f = (window.CC?.byKind?.(kind) || []).find((x) => x.id === id);
  if (!f) return;
  const d = document.createElement("div"); d.dataset.feature = f.id; box.appendChild(d);
  try { f[kind].render(d); } catch (e) { d.innerHTML = `<div class="dim small">${esc(f.id)}: ${esc(e.message)}</div>`; }
}
function projectOptions(sel) {
  return projectOptionsHtml(S.projects, sel);
}
function projectField() {
  return `<label class="lbl">Project</label>
    <div class="row" id="proj-row">
      <select id="proj" aria-label="Project" style="flex:1;width:auto;min-width:160px">${projectOptions(S.project)}</select>
      <button type="button" class="btn sm" id="proj-rename"${S.project ? "" : " hidden"}>Rename</button>
    </div>
    <form id="proj-form" hidden style="margin-top:6px">
      <div class="row">
        <input type="text" id="proj-name" aria-label="Project name" maxlength="80" autocomplete="off" placeholder="Project name" style="flex:1;min-width:140px">
        <button type="submit" class="btn sm primary" id="proj-save">Create</button>
        <button type="button" class="ghost small" id="proj-cancel">Cancel</button>
      </div>
      <div class="small" id="proj-err" role="alert" style="color:var(--red)"></div>
    </form>`;
}
// Open is a click on the Saved note. Saving itself stays on the command bar.
function openSavedProject(id) {
  if (!id) return;
  S.openProject = id;
  S.view = "projects";
  render();
}
function toastSaved(id) {
  const link = id ? { label: "Open", onClick: () => openSavedProject(id) } : null;
  toast("Saved", false, link);
}
function wireProjectPicker() {
  const sel = $("#proj");
  const form = $("#proj-form");
  const input = $("#proj-name");
  const err = $("#proj-err");
  const saveBtn = $("#proj-save");
  const renameBtn = $("#proj-rename");
  if (!sel || !form || !input) return;
  let mode = "create";
  const close = () => {
    form.hidden = true;
    err.textContent = "";
    input.value = "";
    if (sel.value === NEW_PROJECT) sel.value = S.project || "";
  };
  const open = (next) => {
    mode = next;
    form.hidden = false;
    err.textContent = "";
    const current = (S.projects || []).find((p) => p.id === S.project);
    input.value = next === "rename" ? (current?.name || "") : "";
    input.setAttribute("aria-label", next === "rename" ? "New name" : "Project name");
    saveBtn.textContent = next === "rename" ? "Save" : "Create";
    input.focus();
    if (next === "rename") input.select();
  };
  sel.addEventListener("change", () => {
    if (sel.value === NEW_PROJECT) { sel.value = S.project || ""; open("create"); return; }
    close();
    S.project = sel.value;
    localStorage.setItem("cc.project", S.project);
    if (renameBtn) renameBtn.hidden = !S.project;
    syncProjectBar();
    const pickedProj = (S.projects || []).find((p) => p.id === S.project);
    if (pickedProj?.uiMode && pickedProj.uiMode !== S.uiMode) {
      S.uiMode = pickedProj.uiMode;
      syncChrome();
      render();
    }
    if (renameBtn) renameBtn.hidden = !S.project;
  });
  renameBtn?.addEventListener("click", () => { if (!S.project) return; sel.value = S.project; open("rename"); });
  $("#proj-cancel")?.addEventListener("click", close);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    const exceptId = mode === "rename" ? S.project : "";
    const problem = projectNameError(name, S.projects, exceptId);
    if (problem) { err.textContent = problem; input.focus(); return; }
    saveBtn.disabled = true;
    let savedId = "";
    try {
      if (mode === "rename") {
        await api("/projects", { method: "POST", body: { id: S.project, name } });
        savedId = S.project;
      } else {
        const created = await api("/projects", { method: "POST", body: { name, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
        if (created?.id) { S.project = created.id; localStorage.setItem("cc.project", S.project); savedId = created.id; }
      }
      await refresh();
      toastSaved(savedId);
    } catch (ex) { err.textContent = ex.message; saveBtn.disabled = false; }
  });
}

// ----- Working-in bar, Continue this project, Recently Deleted (flag: projectbar) -----
function clearActiveProject(id) {
  if (S.project !== id) return;
  S.project = "";
  try { localStorage.removeItem("cc.project"); } catch { /* storage can be blocked */ }
}
function syncOtherPickers() {
  for (const sel of ["#proj", "#im-proj", "#md-proj"]) {
    const el = $(sel);
    if (el && [...el.options].some((o) => o.value === (S.project || ""))) el.value = S.project || "";
  }
  const rn = $("#proj-rename");
  if (rn) rn.hidden = !S.project;
}
function setWorkingProject(id) {
  S.project = id || "";
  try { if (S.project) localStorage.setItem("cc.project", S.project); else localStorage.removeItem("cc.project"); } catch { /* storage can be blocked */ }
  syncOtherPickers();
  syncProjectBar();
}
// Finish path (flag finishpath): the always-visible Finish button and the progress pill. Loaded only when on.
function syncFinishBar() {
  if (!S.flags?.finishpath) { $("#fpbar")?.remove(); return; }
  import("./finishpath-ui.js").then((m) => m.syncBar()).catch((e) => console.warn("[finishpath]", e));
}
function syncProjectBar() {
  syncFinishBar();
  let bar = $("#projbar");
  if (!barShows(S.view, S.flags?.projectbar) || S.openProject) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "projbar";
    bar.className = "projbar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Project");
    $("#view").before(bar);
  }
  bar.dataset.view = S.view; // on Chat the picker lives in the chat card, so the bar shows one picker only
  const hadFocus = document.activeElement?.id === "pb-select";
  bar.innerHTML = barHtml({ projects: S.projects || [], selected: S.project, view: S.view });
  const sel = $("#pb-select", bar);
  sel.addEventListener("change", () => setWorkingProject(sel.value));
  if (hadFocus) sel.focus();
  $("#pb-continue", bar)?.addEventListener("click", () => continueProject(S.project));
  $$("[data-pb-go]", bar).forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.pbGo; S.openProject = null; render(); }));
}
// One click: the project is selected, its last words are back in the box, and Chat is open
// with the tools for that project one click away in the bar.
async function continueProject(id) {
  const p = (S.projects || []).find((x) => x.id === id);
  if (!p) return;
  setWorkingProject(id);
  const last = lastRunFor(S.missions, id);
  let words = last?.title || "";
  if (last?.id) {
    try { const m = await api(`/missions/${last.id}`); words = m?.prompt || m?.question || words; } catch { /* the short title is enough */ }
  }
  if (words) S.lastOrders = String(words);
  S.openProject = null;
  S.view = "command";
  render();
  toast(words ? `Back in ${p.name}. Your last request is in the box.` : `Back in ${p.name}.`);
}
async function restoreDeleted(id) {
  try {
    const r = await api(`/projects-deleted/${encodeURIComponent(id)}/restore`, { method: "POST", body: {} });
    await refresh();
    toast(`Brought back ${r?.project?.name || "the project"}.`);
  } catch (e) { toast(e.message, true); }
}
async function deleteForGood(item) {
  if (!confirm(`Delete "${item.name}" for good?\n\nIts links and project files are removed. Chats stay in My chats. AI keys are not touched.\nThis cannot be undone.`)) return;
  try {
    const done = await api(`/projects-deleted/${encodeURIComponent(item.id)}?confirm=yes`, { method: "DELETE" });
    toast((done.receipt?.lines || ["Project deleted for good."]).join(" "));
    await refresh();
  } catch (e) { toast(e.message, true); }
}
async function deleteProjectSoft(p) {
  if (!confirm(`Delete project "${p.name}"?\n\nIt moves to Recently Deleted for 30 days, and you can bring it back there. Chats and AI keys are not touched.`)) return false;
  try {
    await api(`/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    clearActiveProject(p.id);
    if (S.openProject === p.id) S.openProject = null;
    await refresh();
    toast(`Deleted "${p.name}".`, false, { label: "Undo", onClick: () => restoreDeleted(p.id) });
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
function recentlyDeletedHtml() {
  const rows = S.deletedProjects || [];
  if (!S.flags?.projectbar || !rows.length) return "";
  return `<div class="panel" id="recently-deleted"><h3>Recently Deleted <span class="right">kept 30 days</span></h3>
    ${rows.map((d) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);gap:8px"><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(d.name)}</span><span class="dim">${ago(d.deletedAt)} ago</span><button type="button" class="btn sm" data-rd-restore="${esc(d.id)}">Bring back</button><button type="button" class="btn sm danger" data-rd-purge="${esc(d.id)}">Delete for good</button></div>`).join("")}
  </div>`;
}
function wireRecentlyDeleted(v) {
  $$("[data-rd-restore]", v).forEach((b) => b.addEventListener("click", () => restoreDeleted(b.dataset.rdRestore)));
  $$("[data-rd-purge]", v).forEach((b) => b.addEventListener("click", () => { const item = (S.deletedProjects || []).find((d) => d.id === b.dataset.rdPurge); if (item) deleteForGood(item); }));
}

// ----- Command -----
const REPLIED = new Set(["done", "done-with-errors", "failed", "aborted"]);
function replyReady() { return !!(S.live?.id && REPLIED.has(S.live.status)); }
function draftKey(scope, target) { return `${S.live?.id || ""}|${scope}:${target || ""}`; }
function grokWaitHtml() { return `<div class="grok-wait">waiting on Grok Bot</div>`; }
function isGrokId(x) { return x === "grokbot" || x?.provider === "grokbot" || x?.model === "grokbot" || x?.id === "grokbot"; }
function partBody(p) {
  if (p?.error) return `<div class="small" style="color:var(--red)">${esc(p.error)}</div>`;
  if (p?.pending && isGrokId(p)) return grokWaitHtml();
  return `<div class="md">${md(p?.text || "")}</div>`;
}
function turnHtml(t) {
  if (!t) return "";
  const who = t.role === "user" ? "You" : (t.label || "Reply");
  const parts = (t.parts || []).map((p) => `<div class="reply-part"><span class="dim small">${esc(p.name || p.model || "AI")}</span>${partBody(p)}</div>`).join("");
  const body = t.error ? `<div class="small" style="color:var(--red)">${esc(t.error)}</div>` : (t.text ? `<div class="md">${md(t.text)}</div>` : "");
  return `<div class="reply-turn ${t.role === "user" ? "reply-you" : "reply-ai"}"><span class="dim small">${esc(who)}</span>${body}${parts}</div>`;
}
function jobThread() {
  if (S.live?.kind === "council") return S.live.council?.thread || [];
  return S.live?.mission?.thread || [];
}
function partsFor(key) {
  const out = [];
  if (!key) return out;
  for (const t of jobThread()) {
    for (const p of t?.parts || []) {
      if (p && (p.target === key || p.model === key || p.provider === key)) out.push(p);
    }
  }
  return out;
}
function grokReplyHtml(key) {
  return partsFor(key).filter((p) => isGrokId(p) && !p.pending && (p.text || p.error)).map((p) => `<div class="reply-part"><span class="dim small">Grok Bot</span>${partBody(p)}</div>`).join("");
}
function threadHtml(turns) {
  if (!turns?.length) return "";
  return `<div class="reply-thread">${turns.map(turnHtml).join("")}</div>`;
}
function liveSlot(scope, target) {
  return `<div class="reply-live md" data-reply-live="${esc(`${scope}:${target || ""}`)}" hidden></div>`;
}
function replyForm({ scope, target, label, placeholder }) {
  const key = `${scope}:${target || ""}`;
  const busy = !!S.live.replying;
  const field = `reply-${scope}-${(target || "job").replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return `<form class="reply-box" data-reply-scope="${esc(scope)}" data-reply-target="${esc(target || "")}">
    <label class="lbl" for="${esc(field)}">${esc(label)}</label>
    <textarea id="${esc(field)}" class="reply-text" rows="2" placeholder="${esc(placeholder)}" ${busy ? "disabled" : ""}>${esc(replyDrafts[draftKey(scope, target)] || "")}</textarea>
    ${liveSlot(scope, target)}
    <button class="btn sm primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "Sending" : "Send reply"}</button>
  </form>`;
}
function answerReply(target, label) {
  if (!replyReady() || !target) return "";
  return replyForm({ scope: "answer", target, label: label || "Reply to this AI", placeholder: "Write a reply to this AI." });
}
function jobReply() {
  if (!replyReady()) return "";
  const kind = S.live.kind;
  const label = "Reply to all";
  const replyLabel = S.uiMode === "simple" ? "Reply" : label;
  const placeholder = kind === "council" ? "This goes to every AI on the council." : kind === "mission" ? "This goes to every AI on the mission." : "This goes to the AI on this chat.";
  const extra = [];
  if (kind === "council") extra.push(...(S.live.council?.members || []).map((m) => m.model), "chair");
  if (kind === "mission") extra.push(...Object.values(S.live.tasks || {}).filter((t) => t.output && t.status === "done" && !t.agent).map((t) => t.id));
  return `${extra.map((t) => liveSlot("job", t)).join("")}${replyForm({ scope: "job", target: "", label: replyLabel, placeholder })}`;
}
function mergedSingleTurns(run) {
  return [...(run?.answerThread || []), ...(run?.thread || [])].filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
}
function renderSimpleChat(v) {
  v.innerHTML = `
  <div class="cmd simple-chat">
    <div class="orders">
      <div class="panel" style="display:flex;flex-direction:column;gap:10px">
        <h3>Chat</h3>
        <textarea id="orders" aria-label="What do you want?" aria-describedby="mask-line" placeholder="${esc(PLACEHOLDER)}">${esc(S.lastOrders || "")}</textarea>
        <p class="hint" id="mask-line" role="note">${esc(maskNotice(S.lastOrders || ""))}</p>
        <p class="hint" id="send-hint" role="note">Press Ctrl+Enter to send (Cmd+Enter on a Mac).</p>
        <div id="cc-emp-hint" aria-live="polite"></div>
        <div class="row" id="cc-starters" style="flex-wrap:wrap;gap:6px">${STARTERS.slice(0, SIMPLE_STARTER_COUNT).map((s) => `<button type="button" class="btn sm" data-starter="${esc(s.id)}">${esc(s.label)}</button>`).join("")}</div>
        ${projectField()}
        <div id="cc-spend" class="dim small">${esc(spendLine(S.ledger?.month || 0))}</div>
        <div id="cmd-extras"></div>
        <div class="row simple-send-row" style="padding-top:4px">
          <button class="btn sm" type="button" id="vo-mic" data-simple-mic aria-pressed="false">Mic</button>
          <button class="btn sm" type="button" id="cc-show-ais">${S.settings?.simpleStrip ? "Hide AIs" : "Show AIs"}</button>
          <button class="btn" id="stop-research" type="button" style="display:none" title="Stop this deep research run">Stop</button>
          <button class="btn" id="stop-chat" type="button" style="display:none" title="Stop this answer. What is written so far is kept.">Stop</button>
          <button class="btn primary" id="go" style="margin-left:auto" ${runBusy() ? "disabled" : ""}>${runBusy() ? "Still working..." : "Send"}</button>
        </div>
        <div id="cc-composer-ais" class="composer-ais" aria-label="Connected AIs"></div>
      </div>
    </div>
    <div class="panel output" id="simple-answer" ${S.live?.id ? "" : "hidden"}>
      <h3>Answer <span class="right" id="out-head"></span><button class="ghost small" id="copy">copy</button></h3>
      <div class="md" id="out-md"></div>
      <div id="cc-answer-line" class="answer-line small"></div>
      <div id="out-follow"></div>
      <div id="cc-fail-slot"></div>
      <div id="deliv-extras"></div>
    </div>
    <div id="simple-home">${simpleDayHtml()}<div id="simple-recent"></div></div>
  </div>`;
  wireProjectPicker();
  $("#orders").addEventListener("input", (e) => { S.lastOrders = e.target.value; paintStarters(); const note = $("#mask-line"); if (note) note.textContent = maskNotice(e.target.value); });
  $("#orders").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendOrders(); });
  $$("[data-day]", v).forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.day; S.navMenu = "myday"; S.openProject = null; render(); }));
  $$("[data-starter]", v).forEach((b) => b.addEventListener("click", () => {
    const item = STARTERS.find((s) => s.id === b.dataset.starter);
    if (!item) return;
    const box = $("#orders");
    box.value = item.text;
    S.lastOrders = item.text;
    paintStarters();
    const note = $("#mask-line");
    if (note) note.textContent = maskNotice(item.text);
    box.focus();
  }));
  $("#cc-show-ais")?.addEventListener("click", async () => {
    const on = !S.settings?.simpleStrip;
    S.settings = { ...(S.settings || {}), simpleStrip: on };
    syncChrome();
    const btn = $("#cc-show-ais");
    if (btn) btn.textContent = on ? "Hide AIs" : "Show AIs";
    try { const saved = await api("/settings", { method: "POST", body: { simpleStrip: on } }); if (saved) S.settings = { ...S.settings, ...saved, simpleStrip: on }; }
    catch (e) { toast(e.message, true); }
  });
  // AI employees: the best helper for what was typed, one click to use it for this chat
  wireEmployeeHint({ box: $("#cc-emp-hint"), input: $("#orders"), state: S, api, esc });
  $("#go").addEventListener("click", sendOrders);
  $("#stop-chat")?.addEventListener("click", stopChat);
  $("#stop-research").addEventListener("click", stopResearch);
  $("#copy").addEventListener("click", () => copyDeliverable());
  paintStarters();
  renderOutput();
  renderExtras("command", "#cmd-extras");
  renderComposerAis();
}
// My day on the Simple chat page: the same pages as the My day menu.
function simpleDayHtml() {
  const have = new Set(knownViews());
  const labels = { "everyday-inbox": "Inbox and tasks", "everyday-plan": "Day plan", userchat: "People" };
  const items = DAY_VIEWS.filter((view) => have.has(view));
  if (!items.length) return "";
  return `<div class="panel" id="simple-day"><h3>My day</h3><div class="row" style="flex-wrap:wrap;gap:6px">${items.map((view) => `<button type="button" class="btn sm" data-day="${esc(view)}">${esc(labels[view])}</button>`).join("")}</div></div>`;
}
function paintStarters() {
  const box = $("#cc-starters");
  if (!box) return;
  box.hidden = !!($("#orders")?.value.trim() || S.live?.id);
}
function renderCommand(v) {
  if (S.uiMode !== "expert") return renderSimpleChat(v);
  const modeSel = S.cmdMode || "mission";
  v.innerHTML = `
  <div class="cmd">
    <div class="orders">
      <div class="panel orders-panel">
        <div id="graduate-slot"></div>
        <h3 id="cmd-mode-banner" data-mode-banner="${esc(S.cmdShortcut || "")}">${esc(commandHeading(S.cmdShortcut, S.uiMode))} <span class="right" id="cls-hint"></span></h3>
        <textarea id="orders" aria-label="Marching orders" aria-describedby="mask-line" placeholder="Tell the team what you want. One line is enough.&#10;&#10;e.g. Plan the Instagram week for our new product launch: 5 post ideas, captions, hashtags and a posting schedule.">${esc(S.lastOrders || "")}</textarea>
        <p class="hint" id="mask-line" role="note">${esc(maskNotice(S.lastOrders || ""))}</p>
        <p class="hint" id="send-hint" role="note">Press Ctrl+Enter to send (Cmd+Enter on a Mac).</p>
        <div id="pp-popular"></div>
        <label class="lbl">How to run it</label>
        <div class="seg" id="run-mode" role="group" aria-label="How to run it">
          <button data-m="single" class="${modeSel === "single" ? "on" : ""}" title="Best single AI for the job">Single</button>
          <button data-m="council" class="${modeSel === "council" ? "on" : ""}" title="Several AIs answer, review each other, chair writes the verdict">Council</button>
          <button data-m="mission" class="${modeSel === "mission" ? "on" : ""}" title="Plan → assign to specialists → QA → assemble">Mission</button>
          <button data-m="research" class="${modeSel === "research" ? "on" : ""}" title="Search the web and answer with numbered sources">Research</button>
          <button data-m="opinion" class="${modeSel === "opinion" ? "on" : ""}" title="Two AIs answer the same orders. Differences are shown in plain words. Both answers stay.">Second opinion</button>
        </div>
        <label class="lbl">Priority</label>
        <div class="seg" id="cost-mode" role="group" aria-label="Priority">
          ${PRIORITY.map(([m, label]) => `<button data-m="${m}" class="${priorityNow() === m ? "on" : ""}">${label}</button>`).join("")}
        </div>
        <label class="lbl">When</label>
        <div class="seg" id="when-mode" role="group" aria-label="When">
          <button data-m="now" class="${(S.whenMode || "now") === "now" ? "on" : ""}">Now</button>
          <button data-m="offpeak" class="${S.whenMode === "offpeak" ? "on" : ""}" title="Queue the mission for the next discount window (e.g. DeepSeek off-peak, 50% off)">Off-peak</button>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="row small" style="gap:6px"><input type="checkbox" id="qa" ${S.settings.qa !== false ? "checked" : ""}> AI-to-AI QA</label>
          <label class="row small" style="gap:6px;margin-left:auto">Cap $<input type="number" id="budget" value="${S.settings.missionBudget || 2}" step="0.5" min="0.1" style="width:70px;padding:4px 6px"></label>
        </div>
        ${projectField()}
        <div id="route" class="route" style="margin-top:10px;display:none"></div>
        <div id="cmd-extras"></div>
        <div class="row" style="margin-top:auto;padding-top:10px">
          <button class="btn" id="preview">Preview route</button>
          <button class="btn" id="stop-chat" type="button" style="display:none" title="Stop this answer. What is written so far is kept.">Stop</button>
          <button class="btn primary" id="go" style="margin-left:auto" ${runBusy() ? "disabled" : ""}>${runBusy() ? "Still working..." : "Send orders"}</button>
        </div>
        <div id="cc-composer-ais" class="composer-ais" aria-label="Connected AIs"></div>
      </div>
    </div>
    <div class="cmd-side">
      <div class="panel deliv-wait" id="deliv-wait"><h3>Deliverable <span class="right">Shows here when there is a result</span></h3></div>
      <div class="panel output" id="deliv-panel" hidden>
        <h3>Deliverable <span class="right" id="out-head"></span><button class="ghost small" id="copy">copy</button></h3>
        <div class="md" id="out-md"></div>
        <div id="out-follow"></div>
        <div id="deliv-extras"></div>
      </div>
      <div class="panel ops" id="ops-panel">
        <h3>Live ops <span id="ops-head" class="right"></span><button class="ghost small" id="ops-pause" type="button" style="display:none" title="Pro. Pause, edit the steps that have not finished, then resume.">Pause</button><button class="ghost small" id="ops-resume" type="button" style="display:none">Resume</button><button class="ghost small" id="abort" type="button" aria-label="Stop" style="display:none;color:var(--red)">Stop</button></h3>
        <div class="graph-wrap" id="graph"></div>
        <div id="tasks" class="tasks"></div>
        <div id="council"></div>
      </div>
    </div>
  </div>`;
  graph = new AgentGraph($("#graph"));
  syncGraph(true);
  graph.onNodeClick = (id) => { S.view = "settings"; S.focusProvider = id; render(); };
  for (const [pid, n] of Object.entries(S.activeByProvider)) if (n > 0 && !quietProvider(P(pid))) graph.activate(pid, "working");
  refreshGraphUsage();
  $("#run-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.cmdMode = b.dataset.m; S.cmdShortcut = COMMAND_MODES[b.dataset.m] ? b.dataset.m : ""; const head = $("#cmd-mode-banner"); if (head) { head.dataset.modeBanner = S.cmdShortcut; if (head.firstChild) head.firstChild.textContent = `${commandHeading(S.cmdShortcut, S.uiMode)} `; } $$("#run-mode button").forEach((x) => x.classList.toggle("on", x === b)); markSeg($("#run-mode")); markTabs(); });
  $("#cost-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.costMode = b.dataset.m; $$("#cost-mode button").forEach((x) => x.classList.toggle("on", x === b)); markSeg($("#cost-mode")); });
  $("#when-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.whenMode = b.dataset.m; $$("#when-mode button").forEach((x) => x.classList.toggle("on", x === b)); markSeg($("#when-mode")); });
  ["#run-mode", "#cost-mode", "#when-mode"].forEach((s) => markSeg($(s)));
  wireProjectPicker();
  $("#orders").addEventListener("input", (e) => { S.lastOrders = e.target.value; const note = $("#mask-line"); if (note) note.textContent = maskNotice(e.target.value); });
  $("#orders").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendOrders(); });
  $("#go").addEventListener("click", sendOrders);
  $("#stop-chat")?.addEventListener("click", stopChat);
  $("#preview").addEventListener("click", previewRoute);
  $("#copy").addEventListener("click", () => copyDeliverable());
  $("#abort").addEventListener("click", () => { if (!S.live.id) return; if (S.live.kind === "research") return stopResearch(); api(`/mission/${S.live.id}/abort`, { method: "POST" }).catch((e) => toast(e.message, true)); });
  $("#ops-pause")?.addEventListener("click", async () => {
    if (!S.live.id) return;
    try { await api(`/mission/${S.live.id}/pause`, { method: "POST" }); }
    catch (e) { toast(e.message, true); }
  });
  $("#ops-resume")?.addEventListener("click", async () => {
    if (!S.live.id) return;
    try { await api(`/mission/${S.live.id}/resume`, { method: "POST" }); toast("Mission resumed."); }
    catch (e) { toast(e.message, true); }
  });
  renderOps();
  renderExtras("command", "#cmd-extras");
  renderComposerAis();
  focusNavTarget();
  if (S.focusOrders) { S.focusOrders = false; $("#orders")?.focus(); }
}
function syncGraph(force = false) {
  if (!graph || S.view !== "command") return;
  const next = graphNodes(S.providers, S.subscriptions, { demoKeep: !!S.settings?.demoKeep, realAi: !!S.realAi });
  const sig = next.map((p) => p.id).join(",");
  if (!force && S.graphSig === sig) return;
  S.graphSig = sig;
  graph.setProviders(next);
}
function renderComposerAis() {
  const box = $("#cc-composer-ais");
  if (!box) return;
  const chips = composerAis(S.providers);
  if (!chips.length) {
    // Right after Try it now the practice AIs can be a moment behind. Never say "No AI" then.
    box.innerHTML = S.demo ? `<div class="composer-empty dim small">Practice AIs are on. Nothing is spent.</div>` : `<div class="composer-empty dim small">No AI connected yet. Add a key in Settings.</div>`;
    return;
  }
  box.innerHTML = chips.map((c) => {
    const model = c.model ? `<span class="composer-model">${esc(c.model)}</span>` : "";
    const hint = c.demo ? "Demo AI. Connect a real one and this leaves." : "Connected. Open its settings.";
    return `<button type="button" class="composer-ai${c.demo ? " demo" : ""}" data-p="${esc(c.id)}" title="${esc(hint)}"><span class="dot ${c.demo ? "grey" : "green"}" aria-hidden="true"></span><span class="composer-name">${esc(c.name)}</span>${model}</button>`;
  }).join("");
  $$(".composer-ai", box).forEach((b) => b.addEventListener("click", () => openProviderSetup(b.dataset.p)));
}
function renderOps() { if (S.uiMode !== "expert") { renderOutput(); return; } renderOpsHead(); renderTasks(); renderCouncil(); renderOutput(); }
// Idle Live ops is one line. The graph shows only while a run is going.
function syncOpsPanel() {
  const panel = $("#ops-panel"); if (!panel) return;
  const idle = opsState(S.live) === "idle";
  panel.classList.toggle("idle", idle);
  const g = $("#graph");
  if (g) g.hidden = idle || ["done", "done-with-errors", "failed", "aborted"].includes(S.live.status);
}
function stopResearch() {
  if (!S.live.id || S.live.kind !== "research") return;
  api(`/research/${S.live.id}/abort`, { method: "POST" }).catch((e) => toast(e.message, true));
}
function syncResearchStop() {
  const l = S.live;
  const researchLive = !!(l.id && l.kind === "research" && l.status === "running");
  const stop = $("#stop-research");
  if (stop) stop.style.display = researchLive ? "" : "none";
  const abort = $("#abort");
  const pause = $("#ops-pause");
  const resume = $("#ops-resume");
  const show = (el, on) => { if (el) el.style.display = on ? "" : "none"; };
  const mission = l.kind === "mission";
  const missionLive = !!(l.id && mission && ["scheduled", "planning", "running", "assembling"].includes(l.status));
  show(pause, mission && ["planning", "running", "assembling"].includes(l.status));
  show(resume, mission && l.status === "paused");
  show(abort, researchLive || missionLive || (mission && l.status === "paused"));
  if (abort) {
    abort.textContent = researchLive ? "Stop" : "abort";
    abort.title = researchLive ? "Stop this deep research run" : "";
  }
}
function renderOpsHead() {
  const h = $("#ops-head");
  const l = S.live;
  if (h) {
    if (opsState(l) === "idle") h.textContent = IDLE_LINE;
    else {
      const cost = l.mission?.cost ?? l.council?.cost ?? 0;
      h.textContent = `${l.kind} · ${l.status || "running"} · ${money(cost, 4)}`;
    }
  }
  syncResearchStop();
  syncOpsPanel();
}
function renderTasks() {
  const box = $("#tasks"); if (!box) return;
  const tasks = Object.values(S.live.tasks);
  if (S.live.kind === "mission" && S.live.status === "scheduled" && S.live.mission?.scheduledFor) { box.innerHTML = `<div class="empty" style="color:var(--amber)">Queued for ${new Date(S.live.mission.scheduledFor).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${esc(S.live.mission.reason || "")}<br><span class="hint">Click Stop to cancel.</span></div>`; return; }
  if ((S.live.kind !== "mission" && S.live.kind !== "research") || !tasks.length) { box.innerHTML = (S.live.kind === "mission" || S.live.kind === "research") && (S.live.status === "planning" || S.live.status === "running") && !tasks.length ? `<div class="empty">${S.live.kind === "research" ? "Researching…" : "Planning…"}</div>` : ""; return; }
  const paused = S.live.status === "paused";
  const editable = paused ? tasks.filter((t) => t.status !== "done" && t.status !== "waiting" && t.status !== "failed") : [];
  // Live ops has no inner scrollbar: the newest few steps, then See all.
  const showAll = S.opsAllFor === S.live.id;
  const { shown, total } = newestTasks(S.live.tasks, S.live.touched, showAll ? 0 : OPS_SHOWN);
  const more = total > OPS_SHOWN ? `<button type="button" class="ghost small ops-more" id="ops-more" aria-expanded="${showAll}">${showAll ? "Show newest only" : `See all (${total})`}</button>` : "";
  box.innerHTML = shown.map((t) => {
    const pct = t.status === "done" ? 100 : t.status === "failed" ? 100 : t.status === "review" ? 85 : t.status === "running" ? 30 : 0;
    const rv = t.review ? `<span class="chip ${t.review.pass ? "green" : "amber"}" title="${esc((t.review.issues || []).join("; "))}">QA ${t.review.score ?? ""}${t.review.pass ? " ✓" : " ✎"}</span>` : "";
    const isGrok = isGrokId(t);
    const wrote = t.output && t.status === "done" && !t.agent;
    const grokWaiting = isGrok && !t.output && t.status !== "failed";
    const grokPending = isGrok && !!t.output && (t.followPending || partsFor(t.id).some((p) => p.pending) || partsFor("grokbot").some((p) => p.pending));
    const grokBlock = isGrok ? `<div class="task-follow">${grokWaiting ? grokWaitHtml() : `<div class="task-answer"><div class="md">${md(t.output || "")}</div></div>`}${grokPending ? grokWaitHtml() : ""}${grokReplyHtml(t.id)}${threadHtml(t.thread)}</div>` : "";
    const follow = wrote ? `<div class="task-follow"><div class="task-answer"><div class="md">${md(t.output)}</div>${threadHtml(t.thread)}</div>${answerReply(t.id, "Reply to this AI")}</div>` : grokBlock;
    return `<div class="task" data-task="${t.id}">
      <span class="st ${t.status}"></span>
      <div><div>${esc(t.title)} ${t.retried ? '<span class="chip amber">re-assigned</span>' : ""} ${t.revised ? '<span class="chip violet">revised</span>' : ""} ${rv}${t.agentJob ? ` <span class="chip ${t.agentJob.status === "needs_approval" ? "amber" : t.agentJob.status === "failed" ? "red" : "violet"}" title="Results are async and can take minutes">${esc({ queued: "queued", working: "working", needs_approval: "needs your approval", done: "done", failed: "failed" }[t.agentJob.status] || t.agentJob.status)}${t.late ? ", arrived later" : t.status === "waiting" ? ", still out" : ""}</span>` : ""}</div><div class="who" style="color:${pcolor(t.provider)}">${esc(t.agentName || pname(t.provider))} · ${esc(t.model)}${t.deps?.length ? ` · after ${t.deps.join(", ")}` : ""}</div></div>
      <span class="chip">${t.capability}</span>
      <span class="cost">${money(t.cost || t.estCost || 0, 4)}</span>
      <div class="bar"><i style="width:${pct}%;background:${t.status === "failed" ? "var(--red)" : pcolor(t.provider)}"></i></div>
      ${follow}
    </div>`;
  }).join("") + more + (paused ? `<form id="pause-edit" style="margin-top:12px">
      <div class="small">Done steps stay as they are. Edit the goal or a step that has not finished, then resume.</div>
      <label class="lbl" for="pause-goal">Goal</label>
      <textarea id="pause-goal" rows="2">${esc(S.live.mission?.prompt || "")}</textarea>
      ${editable.map((t) => `<label class="lbl" for="pause-task-${esc(t.id)}">${esc(t.title || t.id)}</label><textarea id="pause-task-${esc(t.id)}" data-pause-task="${esc(t.id)}" rows="2">${esc(t.instructions || "")}</textarea>`).join("")}
      <div class="row" style="margin-top:8px"><button class="btn sm primary" type="submit">Save and resume</button></div>
    </form>` : "");
  box.querySelector("#ops-more")?.addEventListener("click", () => { S.opsAllFor = showAll ? null : S.live.id; renderTasks(); });
  box.querySelector("#pause-edit")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const goal = box.querySelector("#pause-goal")?.value || "";
    const taskEdits = [...box.querySelectorAll("[data-pause-task]")].map((el) => ({ id: el.dataset.pauseTask, instructions: el.value }));
    try {
      await api(`/mission/${S.live.id}/edit`, { method: "POST", body: { goal, tasks: taskEdits } });
      await api(`/mission/${S.live.id}/resume`, { method: "POST" });
      toast("Saved. Mission resumed.");
    } catch (err) { toast(err.message, true); }
  });
}
// A council seat reached through one OpenRouter key carries its family label ("Gemini via OpenRouter").
function seatName(c, a) {
  return a?.label || (c?.members || []).find((m) => m.model === a?.model)?.label || pname(a?.provider);
}
function renderCouncil() {
  const box = $("#council"); if (!box) return;
  const c = S.live.council;
  if (S.live.kind !== "council" || !c) { box.innerHTML = ""; return; }
  // outside agents (Grok Bot) sit next to the AIs; their answers arrive asynchronously
  const agentText = (g) => `*${g.name}: ${{ queued: "queued", working: "working", needs_approval: "needs your approval in Grok Bot", failed: "failed" }[g.status] || g.status}. Results are async and can take minutes; this answer joins the council when it comes back.*`;
  const answers = c.members.map((m) => c.answers?.[m.model] || { provider: m.provider, model: m.model, letter: "?" })
    .concat((c.agents || []).map((g) => {
      const a = c.answers?.[g.id];
      if (a?.text || a?.error) return a;
      if (g.id === "grokbot") return { ...(a || {}), provider: g.id, model: g.id, letter: g.letter || a?.letter, agent: true };
      return { provider: g.id, model: g.id, letter: g.letter, text: agentText(g) };
    }));
  box.innerHTML = `<div class="cat-h" style="margin-top:14px">Answers ${c.classification ? `<span class="chip">${c.classification.capability}</span>` : ""}</div>
  <div class="council-cols">${answers.map((a) => {
    const sb = c.scoreboard?.[a.model];
    const live = Object.values(S.live.agents).find((x) => x.model === a.model && x.role === "answer");
    const text = a.text || live?.text || (a.error ? `**Error:** ${a.error}` : "");
    const stored = c.answers?.[a.model];
    const isGrok = isGrokId(a);
    const can = stored?.text && !stored.pending && !stored.agent;
    const waiting = isGrok && !text && !a.error;
    const subWait = !text && stored?.waiting ? (window.CC.subWaitHtml?.(stored.waiting) || "") : "";
    const subTag = stored?.viaSubscription?.tag ? (window.CC.subTagHtml?.(stored.viaSubscription.tag) || "") : "";
    const followWait = isGrok && !!text && (stored?.followPending || partsFor(a.model).some((p) => p.pending));
    return `<div class="ans ${c.winner === a.model ? "winner" : ""}" style="--c:${pcolor(a.provider)}" data-ans="${esc(a.model)}">
      <div class="hd"><span class="dot" style="background:${pcolor(a.provider)}"></span>Written by ${esc(seatName(c, a))} <span class="dim small">${esc(a.letter || "")}</span>
      <span class="score">${sb?.avg != null ? `${sb.late ? "judge" : "peer"} ${sb.avg}/10${c.winner === a.model ? " ★" : ""}` : a.ms ? `${(a.ms / 1000).toFixed(1)}s` : ""}${a.late ? " · arrived later" : ""}</span>${subTag}</div>
      <div class="body md">${subWait || (waiting ? grokWaitHtml() : md(text))}</div>
      ${followWait ? grokWaitHtml() : ""}
      ${grokReplyHtml(a.model)}
      ${threadHtml(stored?.thread)}
      ${can ? answerReply(a.model, "Reply to this AI") : ""}
    </div>`;
  }).join("")}</div>
  ${Object.keys(c.reviews || {}).length ? `<div class="cat-h">Where they disagreed</div><div class="small muted">${Object.values(c.reviews).map((r) => `<div><b style="color:${pcolor(r.provider)}">${esc(pname(r.provider))}</b>: ${esc(r.disagreement || "none")}</div>`).join("")}</div>` : ""}`;
}
function renderOutput() {
  const o = $("#out-md"), h = $("#out-head"); if (!o) return;
  syncResearchStop();
  const follow = $("#out-follow");
  const l = S.live;
  const prim = l.primary ? l.agents[l.primary] : null;
  const text = l.deliverable || prim?.text || "";
  const panel = $("#deliv-panel");
  if (panel) panel.hidden = !showDeliverable(l, text);
  // Simple: the answer sits right under the chat box, and only when there is one.
  const simpleAnswer = $("#simple-answer");
  if (simpleAnswer) simpleAnswer.hidden = !l.id;
  paintAnswerLine(l, text);
  const wait = $("#deliv-wait");
  if (wait && panel) wait.hidden = !panel.hidden;
  const paintFollow = (html) => { if (follow) follow.innerHTML = html || ""; };
  if (!l.id) { o.innerHTML = S.uiMode === "simple" ? `<div class="empty">Say what you want in the box. Meldmind picks an AI, and the answer shows up here.</div>` : `<div class="empty">Send orders to see the team work. Single = best AI for the job. Council = several AIs answer and judge each other. Mission = plan, assign, QA, assemble. Second opinion asks two AIs and keeps both answers.</div>`; h.textContent = ""; paintFollow(""); paintFailure(); return; }
  h.textContent = prim ? `Written by ${pname(prim.provider)} · ${prim.model}` : "";
  // out of API credits: the waiting box (single chat, and council seats in Simple mode, where seats are not shown)
  const subWait = subWaitingHtml(l);
  if (subWait) {
    if (panel) panel.hidden = false;
    if (wait) wait.hidden = true;
    o.innerHTML = `${text ? md(text) : ""}${subWait}`;
    o.classList.remove("cursor");
    if (!text) { if (l.mission?.provider) h.textContent = `Waiting on ${pname(l.mission.provider)}`; paintFollow(""); paintFailure(); return; }
    paintFollow(`${outputFollowHtml()}${chargeNote(l)}`);
    paintFailure();
    return;
  }
  if (!text && !(S.uiMode !== "expert" && (l.council || l.mission))) {
    if (l.kind === "research" && l.status === "aborted") o.innerHTML = `<div class="empty">Deep research stopped.</div>`;
    else if (l.kind === "research" && l.status === "failed") o.innerHTML = `<div class="empty">${esc(l.mission?.error || "Deep research failed.")}</div>`;
    else if (l.kind === "research" && l.status === "running") o.innerHTML = `<div class="empty">Deep research is running. Stop ends it. You can keep using the chat.</div>`;
    else o.innerHTML = l.kind === "mission" ? `<div class="empty">The deliverable appears here once the assembler starts.</div>` : `<div class="empty">Waiting…</div>`;
    paintFollow("");
    paintFailure();
    return;
  }
  o.innerHTML = text ? md(text) : "";
  if (prim && !prim.done && prim.role !== "followup") o.classList.add("cursor"); else o.classList.remove("cursor");
  paintFollow(`${outputFollowHtml()}${chargeNote(l)}`);
  paintFailure();
  const finished = ["done", "done-with-errors", "failed", "aborted"].includes(l.status) || (prim && prim.done && l.kind === "single");
  renderExtras("deliverable", "#deliv-extras", finished ? l : null);
  if (finished && text) arrangeAnswerActions($("#deliv-extras"), { onCopy: () => copyDeliverable(), open: !!S.answerMoreOpen, onToggle: (on) => { S.answerMoreOpen = on; } });
}
// Simple says who answered. With two AI companies, or one OpenRouter key, it offers Ask a council.
function paintAnswerLine(l, text) {
  const box = $("#cc-answer-line");
  if (!box) return;
  const done = ["done", "done-with-errors"].includes(l.status) || (l.kind === "single" && l.primary && l.agents[l.primary]?.done);
  if (S.uiMode === "expert" || !l.id || !text || !done || l.kind === "research") { box.innerHTML = ""; return; }
  const c = l.council;
  const answeredBy = l.kind === "council" && c
    ? { kind: "council", names: (c.members || []).map((m) => m.label || pname(m.provider)) }
    : (l.primary ? pname(l.agents[l.primary]?.provider) : pname(l.mission?.provider || ""));
  const line = simpleAnswerLine(S.councilOffer, answeredBy);
  box.innerHTML = `<span class="dim">${esc(line.text)}</span>${line.offer ? ` <button type="button" class="btn sm" id="cc-ask-council">${esc(line.offer)}</button>` : ""}`;
  $("#cc-ask-council", box)?.addEventListener("click", askCouncil);
}
async function askCouncil() {
  const prompt = S.lastPrompt || l0Prompt();
  if (!prompt) return toast("Type the question again, then Send.", true);
  const req = councilRequest(prompt, { projectId: $("#proj")?.value || null });
  try {
    await api(req.path, { method: "POST", body: req.body });
    S.live = newLive();
    S.live.status = "running";
    renderOps();
    toast("Asking a council. Each AI answers, then they check each other.");
  } catch (e) { toast(e.message, true); }
}
function l0Prompt() {
  const m = S.live?.mission || S.live?.council || {};
  return String(m.prompt || m.goal || m.title || "").trim();
}
function subWaitingHtml(l) {
  const box = window.CC.subWaitHtml;
  if (!box) return "";
  if (l.kind === "single" && l.mission?.status === "waiting" && l.mission.waiting) return box(l.mission.waiting);
  if (l.kind === "council" && l.council && S.uiMode !== "expert") {
    return Object.values(l.council.answers || {}).filter((a) => a?.waiting).map((a) => box(a.waiting)).join("");
  }
  return "";
}
function paintFailure() {
  const slot = $("#cc-fail-slot");
  if (!slot) return;
  if (S.uiMode === "expert" || !S.simpleFail) { slot.innerHTML = ""; return; }
  slot.innerHTML = `<div class="route" id="cc-fail" style="margin-top:10px"><b>${esc(FAILURE.title)}</b><div class="row" style="margin-top:8px;gap:8px"><button class="btn sm primary" type="button" id="cc-fail-retry">${esc(FAILURE.retry)}</button><button class="btn sm" type="button" id="cc-fail-other">${esc(FAILURE.other)}</button></div></div>`;
  $("#cc-fail-retry")?.addEventListener("click", () => { S.pendingAvoid = ""; sendOrders(); });
  $("#cc-fail-other")?.addEventListener("click", () => { S.pendingAvoid = S.simpleFail?.provider || ""; sendOrders(); });
}
function outputFollowHtml() {
  const l = S.live;
  const simple = S.uiMode !== "expert";
  if (simple) {
    const has = !!(l.deliverable || (l.primary && l.agents[l.primary]?.text));
    if (!has) return "";
    return jobReply();
  }
  const blocks = [];
  if (l.kind === "single") {
    const run = l.mission || {};
    blocks.push(threadHtml(mergedSingleTurns({ answerThread: run.answerThread, thread: run.thread || l.thread })));
    if (run.model || l.agents?.[l.primary]?.model) blocks.push(answerReply(run.model || l.agents?.[l.primary]?.model, "Reply to this AI"));
    blocks.push(jobReply());
    return blocks.join("");
  }
  if (simple && l.kind === "council" && l.council) {
    const c = l.council;
    blocks.push((c.members || []).map((m) => {
      const a = c.answers?.[m.model];
      if (!a?.text) return "";
      return `<div class="ans" style="--c:${pcolor(a.provider)}" data-ans="${esc(a.model)}"><div class="hd"><span class="dot" style="background:${pcolor(a.provider)}"></span>Written by ${esc(seatName(c, a))}</div><div class="body md">${md(a.text)}</div>${threadHtml(a.thread)}${answerReply(a.model, "Reply to this AI")}</div>`;
    }).join(""));
    blocks.push((c.agents || []).filter((g) => g.id === "grokbot").map(() => {
      const a = c.answers?.grokbot || {};
      const waiting = !a.text && !a.error;
      const followWait = !!a.text && (a.followPending || partsFor("grokbot").some((p) => p.pending));
      return `<div class="ans" data-ans="grokbot"><div class="hd"><span class="dot" style="background:${pcolor("grokbot")}"></span>${esc(pname("grokbot"))}</div><div class="body md">${waiting ? grokWaitHtml() : (a.error ? `<div class="small" style="color:var(--red)">${esc(a.error)}</div>` : md(a.text))}</div>${followWait ? grokWaitHtml() : ""}${grokReplyHtml("grokbot")}${threadHtml(a.thread)}</div>`;
    }).join(""));
  }
  if (simple && l.kind === "mission") {
    blocks.push(Object.values(l.tasks || {}).filter((t) => (t.output && t.status === "done" && !t.agent) || isGrokId(t)).map((t) => {
      if (isGrokId(t)) {
        const waiting = !t.output && t.status !== "failed";
        const followWait = !!t.output && (t.followPending || partsFor(t.id).some((p) => p.pending));
        return `<div class="task-follow"><div class="who" style="color:${pcolor(t.provider)}">${esc(t.agentName || pname(t.provider))}</div>${waiting ? grokWaitHtml() : `<div class="task-answer"><div class="md">${md(t.output || "")}</div></div>`}${followWait ? grokWaitHtml() : ""}${grokReplyHtml(t.id)}${threadHtml(t.thread)}</div>`;
      }
      return `<div class="task-follow"><div class="who" style="color:${pcolor(t.provider)}">${esc(t.agentName || pname(t.provider))}</div><div class="task-answer"><div class="md">${md(t.output)}</div>${threadHtml(t.thread)}</div>${answerReply(t.id, "Reply to this AI")}</div>`;
    }).join(""));
  }
  const jobTurns = l.kind === "council" ? (l.council?.thread || []) : (l.mission?.thread || []);
  if (l.kind !== "single") blocks.push(threadHtml(jobTurns));
  blocks.push(jobReply());
  return blocks.join("");
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
      ${r.cheaper?.batchNote ? `<div class="adv">${esc(r.cheaper.batchNote)}</div>` : ""}
      ${r.agent?.fits ? `<div class="adv" style="color:#c4b5fd">${r.agent.needs.length ? `Needs ${esc(r.agent.needs.map((n) => n.label).join(", "))}: ` : ""}${esc(r.agent.name)} fits this job${r.agent.ready ? (r.agent.auto ? " and joins a council or mission on its own." : ". Pick Always under Grok Bot, or use Send to Grok Bot.") : ` but is ${esc(r.agent.detail)}.`}</div>` : ""}
      ${d ? `<div class="adv" style="color:var(--amber)">Not urgent? Off-peak at ${new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${esc(d.model)} at ${d.pct}% off saves about ${d.saving}% (${money(d.laterCost, 4)} vs ${money(d.nowCost, 4)}). Pick "Off-peak" under When.</div>` : ""}
      ${r.search?.note ? `<div class="small" style="margin-top:4px">${esc(r.search.note)}</div>` : ""}
      <div class="small dim" style="margin-top:4px">${r.ranked.slice(0, 4).map((m) => `${esc(m.name)} ${m.score}`).join(" · ")}</div>
      ${(r.apps || []).length ? `<div class="small" style="margin-top:4px">Allowed programs: ${(r.apps || []).slice(0, 4).map((m) => `${esc(m.name)} ${m.score}`).join(" · ")}</div>` : ""}
      ${r.whoWillRead ? `<div class="small" style="margin-top:6px"><b>${esc(r.whoWillRead.heading || "Who will read this")}</b>: ${r.whoWillRead.readers?.length ? `${r.whoWillRead.readers.map((x) => esc(x.name)).join(", ")}. ` : ""}${esc(r.whoWillRead.note || "Nothing is sent until you click.")}</div>` : ""}`;
    $("#cls-hint").textContent = c.source === "heuristic" ? "classified locally" : `classified by ${c.source}`;
  } catch (e) { box.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
}
const BUSY_STATUS = new Set(["running", "planning", "assembling"]);
function runBusy() {
  if (S.awaitingRun) return true;
  const st = S.live?.status;
  return !!(S.live?.id && BUSY_STATUS.has(st));
}
// Stop for a normal chat or a mission: the server stops the run and keeps what was written.
async function stopChat() {
  const id = S.live?.id || S.stopId;
  if (!id) return;
  const btn = $("#stop-chat");
  if (btn) btn.disabled = true;
  try {
    const r = await api(`/mission/${encodeURIComponent(id)}/abort`, { method: "POST" });
    toast(r?.aborted ? "Stopped. What was written so far is kept." : "Nothing is running to stop.");
    if (r?.aborted) { S.awaitingRun = false; S.stopId = ""; }
  } catch (e) { toast(e.message, true); }
  if (btn) btn.disabled = false;
  syncSendButton();
}
function syncSendButton() {
  const g = $("#go");
  if (!g) return;
  const busy = runBusy();
  const stop = $("#stop-chat");
  if (stop) {
    const kind = S.live?.kind;
    const stoppable = busy && (S.stopId || (S.live?.id && (kind === "single" || kind === "mission")));
    stop.style.display = stoppable ? "" : "none";
  }
  g.disabled = busy;
  g.textContent = busy ? "Still working..." : (S.uiMode === "simple" ? "Send" : "Send orders");
  g.setAttribute("aria-busy", busy ? "true" : "false");
}
async function confirmRisky(text) {
  const projectId = $("#proj")?.value || S.project || null;
  let neverSay = "";
  let scf = false;
  try {
    const profile = await api("/prompts/profile");
    neverSay = String(profile.profile?.neverSay || "");
    scf = profile.profile?.scf === true || profile.profile?.scf === "true";
  } catch { /* a missing profile still lets the copy go through */ }
  if (projectId) {
    try {
      const mem = await api(`/memory/project/${encodeURIComponent(projectId)}`);
      if (mem?.never) neverSay = [neverSay, mem.never].filter(Boolean).join("\n");
    } catch { /* project memory is optional */ }
  }
  const hits = riskyHits(text, { neverSay, scf });
  if (!hits.length) return true;
  return confirm(`This includes a word to avoid: ${hits.map((h) => h.word).join(", ")}. Continue anyway?`);
}
async function copyDeliverable() {
  const t = S.live.deliverable || $("#out-md")?.innerText || "";
  if (!S.live.id || !t.trim()) return toast("Nothing to copy yet", true);
  if (!(await confirmRisky(t))) return;
  try { await navigator.clipboard.writeText(t); toast("Copied"); }
  catch { toast("Could not copy: select the text and press Ctrl+C", true); }
}
function chargeNote(l) {
  if (!l || (l.status !== "failed" && l.status !== "done-with-errors")) return "";
  const cost = Number(l.mission?.cost ?? l.council?.cost ?? 0);
  if (cost > 0) return "";
  return `<p class="hint" id="cc-no-charge" role="status">Nothing was charged</p>`;
}
function maybeNotifyFinish(title, body) {
  if (typeof Notification === "undefined") return;
  if (!document.hidden && document.hasFocus()) return;
  if (Notification.permission !== "granted") return;
  try { new Notification(title, { body, tag: "meldmind-run" }); } catch { /* the in-app toast already said it */ }
}
function askNotify() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try { Notification.requestPermission(); } catch { /* desktop alerts stay off */ }
}
async function sendOrders() {
  if (runBusy()) return;
  const prompt = $("#orders").value.trim(); if (!prompt) return toast("Type the orders first", true);
  if (!(await confirmRisky(prompt))) return;
  S.lastPrompt = prompt;
  const simple = S.uiMode === "simple";
  const mode = simple ? "single" : (S.cmdMode || "mission"), costMode = S.costMode || S.settings.defaultMode;
  const qa = simple ? S.settings.qa !== false : $("#qa").checked;
  const budgetUsd = simple ? (Number(S.settings.missionBudget) || 2) : (Number($("#budget").value) || 2);
  const projectId = $("#proj")?.value || null;
  // Asked to make a website, an app or another project: chat starts the project steps (idea, questions, plan, build, review).
  if (mode === "single" && !S.skipProjectStart && !S.pendingAvoid) {
    const kind = projectIntent(prompt);
    if (kind) {
      // The chat box is cleared first: the Start screen replaces the chat view, so #orders may no longer exist afterwards.
      const draftBox = $("#orders");
      if (draftBox) draftBox.value = "";
      S.lastOrders = "";
      try {
        await window.CC.ensureView?.("start");
        if (window.CC.startProject?.startFromChat) {
          await window.CC.startProject.startFromChat(kind, prompt);
          toast("Started a project for this. Answer a few questions to go on.");
          return;
        }
      } catch (e) { S.lastOrders = prompt; toast(e.message, true); return; }
      S.lastOrders = prompt;
      if (draftBox && draftBox.isConnected) draftBox.value = prompt;
    }
  }
  S.skipProjectStart = false;
  if (!S.providers.some((p) => p.kind === "text" && p.keyed)) { S.view = "settings"; render(); return toastNeedKey(); }
  const pp = window.CC?.promptPack;
  const attached = attachPack(pp);
  const ask = window.CC.searchAsk?.() || {};
  const background = !!$("#bg-run")?.checked;
  askNotify();
  S.awaitingRun = true;
  syncSendButton();
  const noteBackground = (started) => {
    if (background && started && !started.scheduled) {
      const rid = started.runId || started.id;
      if (rid) S.backgroundQuiet.add(rid);
      S.awaitingRun = false;
      toast("Running in the background. You will get an alert when it is done.");
      S.live = newLive();
      renderOps();
      return;
    }
    S.live = newLive();
    S.live.status = "running";
    renderOps();
  };
  try {
    const priv = !!S.settings?.privateMode;
    let skip = [];
    if (!simple && (mode === "council" || mode === "mission") && window.CC?.desk?.beforeSend) {
      const allowed = await window.CC.desk.beforeSend({ mode, prompt });
      if (!allowed || allowed.ok === false) { S.awaitingRun = false; return; }
      if (Array.isArray(allowed.skip)) skip = allowed.skip;
    }
    const packBody = attached ? { promptPack: attached } : (pp?.removed ? { promptPack: { removed: true } } : {});
    if (ask.searchMode === "deep") {
      const started = await api("/research/deep", { method: "POST", body: { prompt, projectId, filter: ask.filter } });
      S.live = newLive();
      S.live.id = started.id;
      S.live.kind = "research";
      S.live.status = "running";
      renderOps();
      toast("Deep research started. You will get an alert when the report is ready.");
      S.awaitingRun = false;
    }
    // project memory (brand voice, offers, never-say list) is added by the server for the selected project
    else if (mode === "single" || mode === "research") {
      // The Command bar choice counts only after a click. Simple mode has no priority bar, so it keeps Default.
      const picked = !simple && S.costMode ? { mode: S.costMode } : {};
      const avoid = S.pendingAvoid || "";
      S.pendingAvoid = "";
      S.simpleFail = null;
      if (avoid) packBody.avoid = avoid;
      // an AI employee picked from the Simple hint answers this chat with its script
      if (simple && S.employee?.id) packBody.employee = S.employee.id;
      const searchOpts = mode === "research" ? { ...ask, searchMode: ask.searchMode || "pro" } : ask;
      const started = await api("/chat", { method: "POST", body: { prompt, projectId, private: priv, ...picked, ...packBody, ...searchOpts, background, getItDone: !!window.CC?.getDoneChoice?.on, sendMessages: !!window.CC?.getDoneChoice?.send } });
      S.stopId = started?.runId || started?.id || "";
      noteBackground(started);
    }
    // grokbot / browser: true (always include Grok Bot / the browser helper), false (leave it out), undefined (the router decides by what the job needs)
    else if (mode === "council") {
      const started = await api("/council", { method: "POST", body: { prompt, projectId, qa, mode: costMode, lite: costMode === "savings" || costMode === "economy", grokbot: S.grokbotChoice, browser: S.browserChoice, private: priv, skip, ...packBody, ...ask, background, getItDone: !!window.CC?.getDoneChoice?.on, sendMessages: !!window.CC?.getDoneChoice?.send } });
      noteBackground(started);
    }
    else if (mode === "opinion") {
      const started = await api("/opinion", { method: "POST", body: { prompt, projectId, ...packBody } });
      toast("Second opinion started. Both answers stay.");
      S.live = newLive();
      if (started?.id) S.live.id = started.id;
      S.live.status = "running";
      renderOps();
    }
    else {
      const started = await api("/mission", { method: "POST", body: { goal: prompt, mode: costMode, projectId, qa, budgetUsd, runAt: S.whenMode || "now", grokbot: S.grokbotChoice, browser: S.browserChoice, employees: S.missionEmployees?.length ? S.missionEmployees : undefined, private: priv, skip, ...packBody, ...ask, background, getItDone: !!window.CC?.getDoneChoice?.on, sendMessages: !!window.CC?.getDoneChoice?.send } });
      if (started.scheduled) toast(`Queued for ${new Date(started.scheduled.scheduledFor).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${started.scheduled.reason}`);
      noteBackground(started);
    }
  } catch (e) {
    S.awaitingRun = false;
    if (e.code === "prompt_halt") toast([e.message, ...(e.questions || []).slice(0, 3)].filter(Boolean).join(" "), true);
    else toast(e.message, true);
  }
  finally { syncSendButton(); }
}

// ----- Projects -----
function recentRunRows(rows) {
  return (rows || []).map((m) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer" data-run="${m.id}" role="button" tabindex="0"><span class="chip ${m.status === "done" ? "green" : m.status?.startsWith("fail") ? "red" : ""}">${m.kind}</span>${m.demo ? `<span class="chip" title="Made with the pretend demo AIs">demo</span>` : ""}<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title)}</span><span class="mono dim">${money(m.cost, 3)}</span></div>`).join("") || `<div class="dim small">No runs yet.</div>`;
}
function wireRunRows(v) {
  $$("[data-run]", v).forEach((r) => r.addEventListener("click", () => openRun(r.dataset.run)));
  $$("[data-subproject-open]", v).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); S.openProject = b.dataset.subprojectOpen; render(); }));
  $$("[data-subproject-add]", v).forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = await askText("Sub-project name");
    if (!name) return;
    try {
      await api("/projects", { method: "POST", body: { name, parentId: b.dataset.subprojectAdd, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
      await refresh();
      render();
    } catch (err) { toast(err.message, true); }
  }));
}
function renderProjects(v) {
  if (S.openProject) return renderProjectDetail(v, S.projects.find((p) => p.id === S.openProject));
  const hq = S.hq;
  v.innerHTML = `<div class="grid" style="grid-template-columns: 1fr 360px">
    <div>
      <div class="row" style="margin-bottom:12px"><h3 style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Projects</h3><button class="btn sm" id="newp" style="margin-left:auto">+ New project</button></div>
      <div class="pcards">${S.projects.map((p) => {
        const runs = S.missions.filter((m) => m.projectId === p.id);
        const tasks = (hq?.tasks || []).filter((t) => t.client === p.hqClient);
        const flowOn = !!(S.settings?.flag_flowstages || S.settings?.flags?.flag_flowstages);
        const subProjects = flowOn ? S.projects.filter((x) => x.parentId === p.id) : [];
        const parentProj = flowOn && p.parentId ? S.projects.find((x) => x.id === p.parentId) : null;
        const expanded = flowOn && S.expandedProjects?.has?.(p.id);
        const expData = flowOn ? S.projectExpansions?.[p.id] : null;
        return `<div class="pcard" style="--c:${p.color}" data-id="${p.id}" role="button" tabindex="0" aria-label="Open project ${esc(p.name)}">
          <h4>${esc(p.name)}</h4><div class="muted small">${esc(p.summary || "")}</div>
          <div class="cats">${p.categories.map((c) => `<span class="chip">${esc(c.name)} · ${c.links.length}</span>`).join("")}</div>
          <div class="row small dim" style="margin-top:10px;gap:14px"><span>${runs.length} AI run${runs.length === 1 ? "" : "s"}</span>${tasks.length ? `<span>${tasks.length} open HQ task${tasks.length === 1 ? "" : "s"}</span>` : ""}${flowOn && subProjects.length ? `<span>${subProjects.length} sub-project${subProjects.length === 1 ? "" : "s"}</span>` : ""}${parentProj ? `<span>Sub-project of ${esc(parentProj.name)}</span>` : ""}<span style="margin-left:auto">${runs[0] ? ago(runs[0].startedAt) + " ago" : ""}</span></div>
          ${S.flags?.projectbar ? `<div class="row" style="margin-top:10px;gap:8px"><button type="button" class="btn sm" data-continue="${esc(p.id)}">Continue this project</button><button type="button" class="btn sm danger" data-del="${esc(p.id)}" aria-label="Delete project ${esc(p.name)}">Delete</button></div>` : ""}
          ${flowOn ? `<div class="row small" style="margin-top:8px;gap:6px"><button type="button" class="btn sm" data-pcard-expand="${esc(p.id)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Collapse" : "Expand"}</button><button type="button" class="btn sm" data-subproject-add="${esc(p.id)}">+ Sub-project</button></div>` : ""}
          ${expanded ? `<div class="pcard-expand small" data-pcard-details="${esc(p.id)}" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
            <div><b>Prompts:</b> ${(expData?.prompts || runs).length} · <b>Images:</b> ${(expData?.images || []).length} · <b>Videos:</b> ${(expData?.videos || []).length} · <b>Automations:</b> ${(expData?.automations || []).length} · <b>Documents:</b> ${(expData?.documents || []).length}</div>
            ${subProjects.length ? `<div style="margin-top:6px"><b>Sub-projects:</b> ${subProjects.map((sp) => `<button type="button" class="btn sm" data-subproject-open="${esc(sp.id)}" style="margin-left:4px">${esc(sp.name)}</button>`).join("")}</div>` : `<div class="dim" style="margin-top:4px">No sub-projects yet.</div>`}
          </div>` : ""}
        </div>`; }).join("") || `<div class="empty">No projects yet. Click + New project to group links, runs and files for one client or campaign.</div>`}</div>
    </div>
    <div class="grid">
      <div class="panel"><h3>Waiting on you <span class="right">HQ board</span></h3>
        ${hq?.available ? (hq.decisions.length ? hq.decisions.map((d) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="mono dim small">${d.id} · ${d.date}</div><div>${esc(d.question)}</div>${d.recommendation ? `<div class="small" style="color:var(--green)">→ ${esc(d.recommendation)}</div>` : ""}</div>`).join("") : `<div class="dim small">Nothing open.</div>`) : S.hqDir ? `<div class="dim small">No HQ board found in the linked folder.</div>` : `<div class="dim small">Optional: link a task-board folder with the CC_HQ_DIR setting to see open tasks and decisions here.</div>`}
      </div>
      ${recentlyDeletedHtml()}
      <div class="panel"><h3>Recent runs</h3>
        <input id="run-search" placeholder="Search all history" value="${esc(S.runQuery || "")}" style="width:100%;margin-bottom:8px" aria-label="Search all history">
        <div id="run-search-note" class="dim small"></div>
        <div id="run-list">${recentRunRows(S.missions.slice(0, 12))}</div>
      </div>
    </div></div>`;
  $$(".pcard", v).forEach((c) => c.addEventListener("click", (e) => { if (e.target.closest("[data-pcard-expand],[data-subproject-add],[data-subproject-open],[data-continue],[data-del]")) return; S.openProject = c.dataset.id; render(); }));
  $$("[data-continue]", v).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); continueProject(b.dataset.continue); }));
  $$(".pcard [data-del]", v).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const p = S.projects.find((x) => x.id === b.dataset.del); if (p) deleteProjectSoft(p); }));
  wireRecentlyDeleted(v);
  $$("[data-pcard-expand]", v).forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const pid = b.dataset.pcardExpand;
    if (!S.expandedProjects) S.expandedProjects = new Set();
    if (!S.projectExpansions) S.projectExpansions = {};
    if (S.expandedProjects.has(pid)) {
      S.expandedProjects.delete(pid);
      render();
      return;
    }
    S.expandedProjects.add(pid);
    try { S.projectExpansions[pid] = await api(`/projects/${encodeURIComponent(pid)}/expand`); } catch { /* fallback counts used */ }
    render();
  }));
  $$("[data-subproject-add]", v).forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const parentId = b.dataset.subprojectAdd;
    const name = await askText("Sub-project name");
    if (!name) return;
    try {
      await api("/projects", { method: "POST", body: { name, parentId, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
      await refresh();
      render();
    } catch (err) { toast(err.message, true); }
  }));
  $$("[data-subproject-open]", v).forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    S.openProject = b.dataset.subprojectOpen;
    render();
  }));
  wireRunRows(v);
  $("#run-search")?.addEventListener("input", async (e) => {
    const q = e.target.value;
    S.runQuery = q;
    const note = $("#run-search-note");
    const list = $("#run-list");
    if (!q.trim()) {
      if (note) note.textContent = "";
      if (list) list.innerHTML = recentRunRows(S.missions.slice(0, 12));
      wireRunRows(v);
      return;
    }
    try {
      const rows = await api("/missions?q=" + encodeURIComponent(q.trim()));
      if (note) note.textContent = "";
      if (list) list.innerHTML = recentRunRows(rows);
      wireRunRows(v);
    } catch (err) {
      if (note) note.textContent = err.message;
      if (list) list.innerHTML = "";
    }
  });
  $("#newp").addEventListener("click", async () => { const name = await askText("Project name"); if (!name) return; try { const made = await api("/projects", { method: "POST", body: { name, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } }); await refresh(); if (made?.id) { S.openProject = made.id; render(); } } catch (e) { toast(e.message, true); } });
}
function renderProjectDetail(v, p) {
  if (!p) { S.openProject = null; return renderProjects(v); }
  const runs = S.missions.filter((m) => m.projectId === p.id);
  const tasks = (S.hq?.tasks || []).filter((t) => t.client === p.hqClient);
  const credits = S.hq?.credits?.byProject || {};
  const projCredits = Object.entries(credits).filter(([k]) => p.id.includes(k.split("-")[0]) || k.includes(p.id));
  const flowOn = !!(S.settings?.flag_flowstages || S.settings?.flags?.flag_flowstages);
  const subProjects = flowOn ? S.projects.filter((x) => x.parentId === p.id) : [];
  const parentProj = flowOn && p.parentId ? S.projects.find((x) => x.id === p.parentId) : null;
  v.innerHTML = `<div class="row" style="margin-bottom:14px"><button class="ghost" id="back">← Projects</button><h2 style="margin:0;font-size:20px;border-left:4px solid ${p.color};padding-left:10px">${esc(p.name)}</h2><span class="muted">${esc(p.summary || "")}</span>
    <select id="proj-sel" style="width:auto;margin-left:auto"><option value="${p.id}">Set as active project</option></select><button class="btn sm" id="use">${S.uiMode === "simple" ? "Use in Chat" : "Use in Command"}</button>${S.flags?.projectbar ? `<button class="btn sm primary" id="pcont">Continue this project</button>` : ""}<button class="btn sm danger" id="del">Delete</button></div>
  <div class="grid" style="grid-template-columns: 1fr 340px">
    <div>
      ${p.categories.map((c) => `<div class="cat-h">${esc(c.name)} <button class="ghost small" data-add="${c.id}">+ link</button></div>
        <div class="links">${c.links.map((l) => `<a class="linkt" href="${esc(l.url)}" target="_blank" rel="noopener"><img src="${favicon(l.url)}" alt=""><span>${esc(l.name)}</span><span class="x" data-rm="${c.id}" data-url="${esc(l.url)}">✕</span></a>`).join("") || `<div class="dim small">No links yet.</div>`}</div>`).join("")}
      <div class="cat-h">Add category <button class="ghost small" id="addcat">+ category</button></div>
    </div>
    <div class="grid">
      <div class="panel" id="proj-team"></div>
      ${flowOn ? `<div class="panel" id="proj-subprojects"><h3>Sub-projects <span class="right">${subProjects.length}</span></h3>
        ${parentProj ? `<div class="small dim" style="margin-bottom:6px">Parent: <button type="button" class="btn sm" data-subproject-open="${esc(parentProj.id)}">${esc(parentProj.name)}</button></div>` : ""}
        ${subProjects.map((sp) => `<div class="row small" style="padding:4px 0;border-bottom:1px solid var(--line)"><button type="button" class="btn sm" data-subproject-open="${esc(sp.id)}">${esc(sp.name)}</button><span class="dim">${esc(sp.summary || "")}</span></div>`).join("") || `<div class="dim small">No sub-projects yet.</div>`}
        <div style="margin-top:8px"><button type="button" class="btn sm" data-subproject-add="${esc(p.id)}">+ Sub-project</button></div>
      </div>` : ""}
      <div class="panel"><h3>Open HQ tasks <span class="right">${tasks.length}</span></h3>${tasks.slice(0, 15).map((t) => `<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><span class="mono dim">${t.id}</span> ${esc(t.title)} <span class="chip">${t.status.replace(/_/g, " ")}</span>${t.owner ? ` <span class="dim">${t.owner}</span>` : ""}</div>`).join("") || `<div class="dim small">None.</div>`}</div>
      ${projCredits.length ? `<div class="panel"><h3>Media credits (HQ log)</h3>${projCredits.map(([k, val]) => `<div class="row small"><span>${esc(k)}</span><span class="mono" style="margin-left:auto">${fmtN(val)}</span></div>`).join("")}</div>` : ""}
      <div class="panel"><h3>AI runs <span class="right">${runs.length}</span></h3>${runs.slice(0, 20).map((m) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer" data-run="${m.id}" role="button" tabindex="0"><span class="chip ${m.status === "done" ? "green" : ""}">${m.kind}</span><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(m.title)}</span><span class="mono dim">${money(m.cost, 3)}</span></div>`).join("") || `<div class="dim small">Pick this project in Command and send orders.</div>`}</div>
    </div></div>`;
  $("#back").addEventListener("click", () => { S.openProject = null; render(); });
  renderProjectTeam($("#proj-team"), p, { api, esc, toast, onSaved: (ids) => { p.team = ids; } });
  $("#use").addEventListener("click", () => { S.project = p.id; localStorage.setItem("cc.project", p.id); S.view = "command"; render(); });
  $("#pcont")?.addEventListener("click", () => continueProject(p.id));
  $("#del").addEventListener("click", async () => {
    if (S.flags?.projectbar) { await deleteProjectSoft(p); return; }
    let lines = `Delete project "${p.name}"? Links on this card go away. Chats stay in My chats. AI keys are not touched.`;
    try {
      const preview = await api(`/desk/project-receipt?id=${encodeURIComponent(p.id)}`);
      if (preview?.lines?.length) lines = preview.lines.join("\n");
    } catch { /* the short line above is enough to confirm */ }
    if (!confirm(`${lines}\n\nDelete this project?`)) return;
    try {
      const done = await api(`/projects/${p.id}`, { method: "DELETE" });
      const file = done.receipt?.file;
      if (file?.text) {
        const blob = new Blob([file.text], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name || "meldmind-receipt.txt";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      }
      toast((done.receipt?.lines || ["Project deleted."]).join(" "));
      S.openProject = null;
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  $$("[data-add]", v).forEach((b) => b.addEventListener("click", async () => { const url = await askText("Link URL"); if (!url) return; const name = await askText("Name", url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) || url; await api(`/projects/${p.id}/links`, { method: "POST", body: { categoryId: b.dataset.add, name, url } }); await refresh(); }));
  $$("[data-rm]", v).forEach((x) => x.addEventListener("click", async (e) => { e.preventDefault(); e.stopPropagation(); await api(`/projects/${p.id}/links?category=${encodeURIComponent(x.dataset.rm)}&url=${encodeURIComponent(x.dataset.url)}`, { method: "DELETE" }); await refresh(); }));
  $("#addcat").addEventListener("click", async () => { const name = await askText("Category name (e.g. Social Posts, Music Videos, Ads)"); if (!name) return; p.categories.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, links: [] }); await api("/projects", { method: "POST", body: p }); await refresh(); });
  $$("[data-run]", v).forEach((r) => r.addEventListener("click", () => openRun(r.dataset.run)));
  $$("[data-subproject-open]", v).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); S.openProject = b.dataset.subprojectOpen; render(); }));
  $$("[data-subproject-add]", v).forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = await askText("Sub-project name");
    if (!name) return;
    try {
      await api("/projects", { method: "POST", body: { name, parentId: b.dataset.subprojectAdd, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
      await refresh();
      render();
    } catch (err) { toast(err.message, true); }
  }));
  window.CC?.mountProjectMedia?.(v, p);
}
async function openRun(id) {
  try {
    S.backgroundQuiet?.delete(id);
    const m = await api(`/missions/${id}`);
    S.live = newLive(); S.live.id = m.id; S.live.kind = m.kind; S.live.status = m.status;
    if (m.kind === "council") { S.live.council = m; S.live.deliverable = m.verdict?.text || ""; }
    else if (m.kind === "mission") { S.live.mission = m; for (const t of m.tasks || []) S.live.tasks[t.id] = t; S.live.deliverable = m.deliverable || ""; }
    else { S.live.mission = m; S.live.deliverable = m.deliverable || ""; S.live.agents.x = { provider: m.provider, model: m.model, text: m.deliverable, done: true, role: "answer" }; S.live.primary = "x"; }
    S.view = "command"; render();
  } catch (e) { toast(e.message, true); }
}

// ----- Credits -----
// One skills-matrix cell: the score, then what council votes and the person's own ratings each changed (R4).
const signed = (n) => (n > 0 ? `+${n}` : String(n));
function skillCell(m, c, best) {
  const vv = m.caps[c] || 0, lead = vv === best;
  const council = m.learned?.council?.[c], human = m.learned?.human?.[c];
  const parts = [council != null ? `council ${signed(council)}` : "", human != null ? `you ${signed(human)}` : ""].filter(Boolean);
  const title = parts.length ? `baseline ${m.base?.[c] ?? vv}; ${parts.join("; ")}` : "baseline";
  return `<div class="cell" style="background:${lead ? "#113b3a" : "#0d1420"};color:${lead ? "var(--green)" : "#c7d0dd"};text-align:center" title="${esc(title)}">${vv}${parts.length ? `<div class="dim" style="font-size:10px;line-height:1.2">${parts.map(esc).join("<br>")}</div>` : ""}</div>`;
}
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
  <div id="credits-extras" style="margin-bottom:16px"></div>
  <div class="grid cols-2">
    <div class="panel"><h3>Daily API spend <span class="right">last 30 days</span></h3>
      <div class="sparks">${L.series.map((d) => `<i style="height:${Math.max(2, (d.v / max) * 100)}%" data-v="${d.d.slice(5)} ${money(d.v, 3)}"></i>`).join("")}</div></div>
    <div class="panel"><h3>Spend by AI <span class="right">this month</span></h3>
      <table class="tbl"><thead><tr><th>AI</th><th class="right">Calls</th><th class="right">Tokens in / out</th><th class="right">Spend</th><th>Balance</th></tr></thead><tbody>
      ${textP.map((p) => { const b = L.byProvider[p.id] || {}; return `<tr><td><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}</td><td class="right mono">${b.calls || 0}</td><td class="right mono dim">${fmtN(b.inTok)} / ${fmtN(b.outTok)}</td><td class="right mono">${money(b.month || 0, 3)}</td><td class="small muted">${p.status?.balance?.left != null ? money(p.status.balance.left) + " left" : p.keyed ? "no balance API" : "no key"}</td></tr>`; }).join("")}
      </tbody></table></div>
  </div>
  <div class="grid cols-2" style="margin-top:16px">
    <div class="panel"><h3>Who's best at what <span class="right">baseline + council votes + your ratings</span></h3>
      <div class="skillgrid" style="grid-template-columns: 170px repeat(${caps.length}, 1fr)">
        <div class="cell hd"></div>${caps.map((c) => `<div class="cell hd" style="text-align:center">${c}</div>`).join("")}
        ${allModels.map((m) => `<div class="cell hd" style="color:${m.color}">${esc(m.name)}</div>${caps.map((c) => skillCell(m, c, bestPer[c])).join("")}`).join("")}
      </div>
      ${allModels.length ? `<div class="dim small" style="margin-top:8px">Under each score: <b>council</b> is what council votes added or took away, <b>you</b> is what your thumbs up / down did. Each counts after 2 signals.</div>` : `<div class="empty">Add API keys to see the matrix.</div>`}
    </div>
    <div class="grid">
      <div class="panel"><h3>Log media credits <span class="right">Kling · Suno · Flow · Sync</span></h3>
        <div class="row"><select id="cr-p" style="width:160px">${S.providers.filter((p) => p.kind !== "text" && p.kind !== "agent").map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
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
  renderExtras("credits", "#credits-extras");
  $$("[data-rule]", v).forEach((cb) => cb.addEventListener("change", async () => { const rules = (S.rules || []).map((r) => ({ ...r, enabled: r.id === cb.dataset.rule ? cb.checked : r.enabled })); for (const r of rules) { delete r.providerName; delete r.color; delete r.activeNow; delete r.nextStart; } S.rules = await api("/rules", { method: "POST", body: { rules } }); toast("Rules saved"); }));
  $("#cr-go").addEventListener("click", async () => { const units = Number($("#cr-u").value); if (!units) return; await api("/credits", { method: "POST", body: { provider: $("#cr-p").value, units, note: $("#cr-n").value, project: S.project } }); toast("Logged"); await refresh(); });
}

// ----- Subscriptions -----
function openPayLink(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    window.open(u.toString(), "_blank", "noopener");
    return true;
  } catch { return false; }
}
function chooseProPlan(which) {
  const plans = S.proPlans || {};
  const all = [plans.monthly, plans.yearly, plans.extremeMonthly, plans.extremeYearly, plans.lifetime].filter(Boolean);
  const plan = all.find((p) => p.id === which) || (which === "yearly" ? plans.yearly : which === "lifetime" ? plans.lifetime : null);
  if (!plan) { toast("That plan is not available. Nothing was charged."); return; }
  if (plan.open === false) { toast("Lifetime founder is sold out at 500. Nothing was charged."); return; }
  if (plan.payLink && plan.checkout !== false && openPayLink(plan.payLink)) return;
  const name = plan.button || plan.label || "This plan";
  toast(name + ". The checkout link is not published yet. Nothing was charged.");
}
// After an Upgrade link opens, re-check the license every few seconds for two minutes, and on focus.
const paidWatch = createPaidWatch({
  current: () => S.license,
  check: async () => { S.license = await api("/license/recheck", { method: "POST" }); return S.license; },
  onUnlock: (lic) => { toast(`Unlocked: ${lic.tier}. Thank you.`); refresh().catch(() => {}); },
});
window.addEventListener("focus", () => { paidWatch.focus(); });
function bindProPlans(root) {
  $$("[data-pro-plan]", root).forEach((b) => b.addEventListener("click", () => chooseProPlan(b.dataset.proPlan)));
  $$("[data-upgrade-link]", root).forEach((a) => a.addEventListener("click", () => paidWatch.start()));
  $$("[data-paid-now]", root).forEach((b) => b.addEventListener("click", async () => {
    const before = S.license?.tier || "free";
    const lic = await paidWatch.check();
    if (!lic) { toast("Could not reach the license server. Try again in a moment.", true); return; }
    if ((lic.tier || "free") !== before && lic.status === "active") { toast(`Unlocked: ${lic.tier}. Thank you.`); refresh().catch(() => {}); return; }
    toast(lic.canUnlockByEmail ? "No new payment found yet. Give it a minute, then try again. Use the same email you paid with." : "Sign in with Google or Microsoft (Settings), using the email you paid with. Or type your license key.", true);
  }));
}
function upgradeBlock(primary) {
  const tier = S.license?.tier || "free";
  return `<div class="upgrade-dialog" role="region" aria-label="Upgrade">${planCompareHtml(S.proPlans?.compare)}
      <div class="row" style="justify-content:center;margin-top:18px;gap:10px;flex-wrap:wrap">${upgradeButtonsHtml({ plans: S.proPlans, tier, primary })}<button class="btn" data-paid-now="1">I paid, check now</button><button class="btn" id="sub-lic">I have a license key</button></div>
      ${founderSpotsHtml(S.proPlans)}
      ${extremeExtrasHtml()}
      <div class="dim small" style="margin-top:8px">Pro, Extreme, Developer, and the $349 lifetime button open a secure Stripe checkout with your sign-in email filled in. Pay with the same email you sign in with and this app unlocks by itself. After the first 100, the $499 lifetime button stays on this page.</div></div>`;
}

function renderSubscriptions(v) {
  if (S.subscriptionsLocked) {
    v.innerHTML = `<div class="panel" style="max-width:720px;margin:24px auto;text-align:center;padding:36px 28px">
      <div style="font-size:28px;margin-bottom:8px">🔒</div>
      <h2 style="margin:0 0 8px;font-size:20px">The Subscriptions tracker is part of Pro</h2>
      <div class="muted">What you pay for every AI subscription, when it renews, credits left, burn per day, runway, and a plain keep / watch / cancel signal. Pro also unlocks Mission mode, unlimited councils and projects, and the off-peak scheduler. Extreme adds more AIs per council, more runs at once, and the rows in the table.</div>
      ${upgradeBlock(true)}
    </div>`;
    $("#sub-lic").addEventListener("click", () => { S.view = "settings"; render(); });
    bindProPlans(v);
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
    <td><input type="text" data-f="plan" aria-label="${esc(s.name)} plan" value="${esc(s.plan || "")}" style="width:150px;padding:4px 6px"></td>
    <td><input type="number" data-f="monthly" aria-label="${esc(s.name)} dollars per month" value="${s.monthly ?? ""}" placeholder="${s.listPrice != null ? "~" + s.listPrice : "?"}" style="width:80px;padding:4px 6px"></td>
    <td><input type="date" data-f="renews" aria-label="${esc(s.name)} renews on" value="${s.renews || ""}" style="width:140px;padding:4px 6px"></td>
    <td><div class="row" style="gap:4px"><input type="number" data-f="credits" aria-label="${esc(s.name)} credits left" value="${s.credits ?? ""}" style="width:80px;padding:4px 6px"><span class="dim">/</span><input type="number" data-f="creditsTotal" aria-label="${esc(s.name)} credits in the plan" value="${s.creditsTotal ?? ""}" style="width:80px;padding:4px 6px"></div>${s.pctLeft != null ? `<div class="meter" style="height:3px;background:var(--sunk-bg,#1a2333);border-radius:3px;margin-top:4px"><i style="display:block;height:100%;width:${s.pctLeft}%;background:${s.pctLeft < 20 ? "var(--red)" : "var(--green)"}"></i></div>` : ""}</td>
    <td class="mono small">${s.burnPerDay != null ? `${s.burnPerDay}${s.runway != null ? ` · ${s.runway}d left` : ""}` : "<span class='dim'>-</span>"}</td>
    <td><span class="sig ${s.signal}">${s.signal}</span><div class="dim small">${esc(s.why || "")}</div></td>
    <td class="right"><button class="ghost small" data-save>save</button> <button class="ghost small" data-del style="color:var(--red)" aria-label="Remove ${esc(s.name)} from the tracker">Remove</button></td>
  </tr>`).join("") || `<tr><td colspan="8" class="dim">Nothing tracked yet. Click + Add, or use Setup to find the AI tools you already pay for.</td></tr>`}
  </tbody></table>
  <div class="dim small" style="margin-top:8px">Prices marked "?" are unknown; the grey "~" placeholder is the public list price, used only for the estimate. Credits left update automatically for services with a balance API (OpenRouter, DeepSeek, ElevenLabs) and from logged generations otherwise.</div></div>`;
  $$("tr[data-id]", v).forEach((tr) => {
    const id = tr.dataset.id;
    const collect = () => { const o = { id }; $$("[data-f]", tr).forEach((i) => { o[i.dataset.f] = i.value === "" ? null : i.type === "number" ? Number(i.value) : i.value; }); return o; };
    $("[data-save]", tr).addEventListener("click", async () => { await api("/subscriptions", { method: "POST", body: collect() }); toast("Saved"); await refresh(); });
    $("[data-del]", tr).addEventListener("click", async () => { if (!confirm("Remove this subscription from the tracker?")) return; await api(`/subscriptions/${id}`, { method: "DELETE" }); await refresh(); });
    $$("input", tr).forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") $("[data-save]", tr).click(); }));
  });
  $("#addsub").addEventListener("click", async () => { const name = await askText("Service name"); if (!name) return; await api("/subscriptions", { method: "POST", body: { name, plan: "", monthly: null, unit: "credits" } }); await refresh(); });
}

// ----- Settings -----
function hubFields() {
  return `<label class="lbl">Hub address</label>
    <div class="row"><input type="text" id="hub-addr" value="${esc(hubAddress())}" placeholder="https://your-hub.fly.dev" style="flex:1;font-family:var(--mono)"><button class="btn sm" id="hub-save" type="button">Use this hub</button>${HUB ? `<button class="btn sm" id="hub-reset" type="button" title="Go back to the hub that served this page">Reset</button>` : ""}</div>`;
}
function phonePanel() {
  if (S.mode === "hosted") {
    return `<div class="panel" id="phone-pair"><h3>Phone &amp; other devices <span class="right">pairing</span></h3>
      <div class="grid" style="grid-template-columns: 1fr 150px; gap: 14px; align-items: start">
        <div>
          ${hubFields()}
          <div class="dim small" style="margin-top:8px">Scan the code with your phone camera to open this hub there, then Share → Add to Home Screen (iPhone) or Install app (Android). Any browser works: the phone talks to the hub, so your PC can be off.</div>
          <div class="row small" style="margin-top:8px"><a href="${esc(hubAddress())}" target="_blank" rel="noopener" class="mono">${esc(hubAddress())}</a><button class="ghost small" id="hub-copy" type="button">copy link</button></div>
        </div>
        <img id="hub-qr" alt="QR code for ${esc(hubAddress())}" style="width:150px;height:150px;background:#fff;border-radius:10px;padding:6px">
      </div></div>`;
  }
  const p = S.pairing || {};
  const err = p.error ? `<div id="pair-error" role="alert" class="small" style="margin-top:8px;color:var(--amber)">${esc(p.error)}</div>` : "";
  const live = p.on && p.url ? `<div style="margin-top:12px">
      <img id="pair-qr" alt="QR code for phone pairing" style="width:150px;height:150px;background:#fff;border-radius:10px;padding:6px;display:block">
      <div id="pair-url" class="mono small">${esc(p.url)}</div>
      <button class="btn sm" id="pair-copy" type="button">Copy</button>
      <div class="dim small" style="margin-top:8px">The phone and this PC need the same Wi-Fi. Scan the code, or copy the address under it. The code opens a short address. The address under the code also works. Both include the pairing code. A Wi-Fi address is used ahead of a virtual adapter.</div>
    </div>` : `<div class="dim small" style="margin-top:8px">Turn this on to show a code your phone can scan. Until then, this PC answers only on this computer.</div>`;
  return `<div class="panel" id="phone-pair"><h3>Phone &amp; other devices <span class="right">pairing</span></h3>
    <label class="row small" style="gap:8px"><input type="checkbox" id="pair-on" ${p.on ? "checked" : ""}> Phone pairing</label>
    ${live}${err}
    <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Use a hosted hub instead</summary>
      <div style="margin-top:8px">${hubFields()}</div>
      <div class="dim small" style="margin-top:8px">A hosted hub is a server elsewhere. The phone can use that address when this PC is off.</div>
    </details></div>`;
}
function licenceCloudFields() {
  if (S.mode === "hosted") return "";
  if (S.uiMode !== "expert") {
    return `<div class="dim small" style="margin-top:8px">The license connection ships with the app. The setup fields stay in Expert.</div>`;
  }
  const missing = S.license?.configured ? "" : `<div class="dim small" style="margin-top:8px">No license server is configured, so this copy runs on the Free tier. The desktop build ships with the connection built in. When running from source, enter the project URL and publishable key below, or set CC_SUPABASE_URL and CC_SUPABASE_ANON_KEY.</div>`;
  return `${missing}<details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">License server connection${S.license?.cloudSource ? ` · using ${esc(S.license.cloudSource)}` : ""}</summary>
    <div class="row" style="margin-top:8px"><input type="text" id="cl-url" placeholder="https://your-project.example" value="${esc(S.settings.cloud?.url || S.license?.cloudUrl || "")}" style="flex:1"><input type="password" id="cl-key" placeholder="publishable key (required)" style="flex:1" autocomplete="off"><button class="btn sm" id="cl-save">Save</button></div>
    <div class="dim small" style="margin-top:6px">Both fields are required. Changing the project never raises the tier: the license is re-checked against the new server.</div></details>`;
}
function openSettingsMore(focus) {
  S.settingsMore = true;
  S.navFocus = focus || "";
  S.view = "settings";
  render();
}
function planWord() {
  const tier = String(S.license?.tier || "free").toLowerCase();
  if (tier === "extreme") return "Extreme";
  if (tier === "pro") return "Pro";
  return "Free";
}
function renderSimpleBasics(v) {
  const keyed = (S.providers || []).filter((p) => p.keyed && !p.demo);
  const aiLine = keyed.length ? `Connected: ${keyed.slice(0, 3).map((p) => p.name).join(", ")}.` : "No AI connected yet. You can try a practice answer until you add one.";
  const on = !!S.settings?.privateMode;
  v.innerHTML = `<div class="settings-basics">
    <div class="panel basics-card" id="basics-ai"><h3>Your AI</h3>
      <p class="small" style="margin:0 0 10px">${esc(aiLine)}</p>
      <button type="button" class="btn primary" id="basics-ai-go">${keyed.length ? "Fix an AI" : "Add an AI"}</button>
    </div>
    <div class="panel basics-card" id="basics-reading"><h3>Text and reading</h3><div id="basics-reading-body"></div></div>
    <div class="panel basics-card" id="basics-privacy"><h3>Privacy</h3>
      <label class="row small" style="gap:8px"><input type="checkbox" id="basics-private" ${on ? "checked" : ""}> Private mode</label>
      <p class="dim small" id="basics-private-line" style="margin:6px 0">${on ? "Private mode is on. This stays on this computer." : "A chat can stay on this computer."}</p>
      <label class="row small" style="gap:8px"><input type="checkbox" id="basics-share"> Share anonymous track records</label>
      <p class="dim small" style="margin:6px 0">Helping Meldmind get smarter: anonymous results only, never your text. This shares the task type, which AI, and the score (counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id). It never shares your words or keys (no prompts, answers, file names, emails, keys, or identifying ids).</p>
      <label class="row small" style="gap:8px"><input type="checkbox" id="basics-content-optin"> Share real prompts and answers for our own-AI program</label>
      <p class="dim small" style="margin:6px 0">Optional explicit opt-in, never pre-checked. Source-tagged, closed-AI outputs excluded.</p>
      <button type="button" class="btn sm" id="basics-leaves">What leaves this PC</button>
    </div>
    <div class="panel basics-card" id="basics-plan"><h3>Your plan</h3>
      <p class="small" style="margin:0 0 10px">You are on ${esc(planWord())}.</p>
      <button type="button" class="btn sm" id="basics-upgrade">Upgrade</button>
    </div>
    <div class="panel basics-card" id="basics-help"><h3>Get help</h3>
      <p class="small" style="margin:0 0 10px">The tour, setup, updates, and What's new are in the Help menu.</p>
      <button type="button" class="btn sm" id="basics-help-go">Search help</button>
    </div>
    <p style="margin:0"><button type="button" class="btn" id="basics-more">More options</button></p>
  </div>`;
  $("#basics-ai-go").addEventListener("click", () => openSettingsMore("#settings-keys"));
  $("#basics-upgrade").addEventListener("click", () => openSettingsMore("#settings-plan"));
  $("#basics-more").addEventListener("click", () => openSettingsMore(""));
  renderFeature("settings", "a11y", "#basics-reading-body");
  $("#basics-private").addEventListener("change", async (e) => {
    const next = !!e.target.checked;
    try {
      const r = await api("/desk/private", { method: "POST", body: { on: next } });
      S.settings.privateMode = !!r.privateMode;
      const line = $("#basics-private-line");
      if (line) line.textContent = r.line || (next ? "Private mode is on. This stays on this computer." : "A chat can stay on this computer.");
    } catch (err) { e.target.checked = !next; toast(err.message, true); }
  });
  api("/privacy").then((d) => {
    const box = $("#basics-share");
    if (box) box.checked = !!d?.levels?.qualitySignals;
    const cbox = $("#basics-content-optin");
    if (cbox) cbox.checked = d?.levels?.contentOptIn === true;
  }).catch(() => {});
  $("#basics-share").addEventListener("change", async (e) => {
    try { await api("/privacy", { method: "POST", body: { qualitySignals: !!e.target.checked } }); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  });
  $("#basics-content-optin")?.addEventListener("change", async (e) => {
    try { await api("/privacy", { method: "POST", body: { contentOptIn: !!e.target.checked } }); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  });
  $("#basics-leaves").addEventListener("click", () => { S.helpArticle = "security"; S.view = "help"; render(); });
  $("#basics-help-go").addEventListener("click", () => { S.view = "help"; render(); });
}
function renderSettings(v) {
  if (S.uiMode === "simple" && S.settingsMore !== true) return renderSimpleBasics(v);
  const textP = S.providers.filter((p) => p.kind === "text"), mediaP = S.providers.filter((p) => p.kind !== "text" && p.kind !== "agent");
  const card = (p) => `<div class="pcard-set" style="--c:${p.color}" id="prov-${p.id}">
    <div class="hd"><span class="dot ${p.id === "google" && !p.keyed ? "grey" : (p.status?.status || "grey")}"></span><span class="nm">${esc(p.name)}</span><span class="vd">${esc(p.vendor)}</span>
      <span class="chip ${p.access?.paused || p.status?.status === "red" ? "red" : ""}" style="margin-left:auto" title="${esc(p.access?.label || p.status?.detail || "")}">${esc(p.access?.label || p.status?.detail || "no key")}</span>${p.access?.paused && p.access.billing ? `<a class="small" href="${esc(p.access.billing)}" target="_blank" rel="noopener">Billing</a>` : ""}</div>
    ${p.custom ? `<div class="row small dim" style="margin-top:6px;gap:8px"><span class="mono">${esc(p.baseUrl || "")}</span><span>· ${p.api === "anthropic" ? "Anthropic-compatible" : "OpenAI-compatible"}</span><button class="ghost small" data-cp-edit="${p.id}" style="margin-left:auto">Edit</button><button class="ghost small" data-cp-del="${p.id}">Delete</button></div>` : ""}
    ${p.id === "google" && !p.keyed ? `<div class="dim small" style="margin-top:8px">Not connected. A free allowance needs your own AI Studio key.</div>` : ""}
    ${p.connect?.council ? `<div class="dim small" style="margin-top:8px">${esc(p.connect.note)}</div>` : ""}
    ${p.connect?.both ? `<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn sm ${p.connect.active === "key" ? "primary" : ""}" data-conn="key" data-prov="${p.id}">Connect with API key</button>
      <button type="button" class="btn sm ${p.connect.active === "mcp" ? "primary" : ""}" data-conn="mcp" data-prov="${p.id}">Connect with MCP</button>
      <button type="button" class="btn sm" data-conn-test="${p.id}">Test connection</button>
      <span class="small dim">Active: ${p.connect.active === "mcp" ? "MCP" : "API key"}${p.connect.key?.configured && p.connect.mcp?.configured ? " · both set up, the other is the fallback" : ""}</span>
    </div>
    <div class="dim small" style="margin-top:4px">${esc(p.connect.note || "")} ${p.connect.key?.configured ? `API key saved (${esc(p.connect.key.masked || "")}).` : "No API key yet."} ${p.connect.mcp?.configured ? `MCP: ${esc(p.connect.mcp.name || "connected")}.` : "No MCP server yet."}</div>
    <div id="conn-mcp-${p.id}" style="margin-top:8px;${p.connect.active === "mcp" ? "" : "display:none"}">
      <div class="row" style="gap:8px">
        <select data-conn-transport="${p.id}" style="width:auto"><option value="http" ${p.connect.mcp?.transport === "http" ? "selected" : ""}>Remote HTTP</option><option value="sse" ${p.connect.mcp?.transport === "sse" ? "selected" : ""}>Remote SSE</option><option value="stdio" ${p.connect.mcp?.transport === "stdio" ? "selected" : ""}>Local command</option></select>
        <input data-conn-target="${p.id}" placeholder="https://server/mcp or a start command" value="${esc(p.connect.mcp?.url || "")}" style="flex:1" autocomplete="off">
        <button type="button" class="btn sm" data-conn-save="${p.id}">Save MCP</button>
      </div>
      <input type="password" data-conn-headers="${p.id}" placeholder="Header (optional): Authorization: Bearer ..." style="width:100%;margin-top:6px" autocomplete="off">
      <div class="dim small" style="margin-top:4px">The header is sealed in the vault with your other MCP secrets. This is the same Tools connection, not a second one.</div>
    </div>` : ""}
    ${p.access?.note && ["mcp", "oauth", "handoff", "local"].includes(p.access.auth) ? `<div class="dim small" style="margin-top:8px">${esc(p.access.note)}</div>` : ""}
    ${(p.access?.auth === "mcp" || p.access?.auth === "oauth") && p.access.connect ? `<div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-mcp-connect="${p.id}">Connect</button></div>` : ""}
    ${p.links?.keys && !p.keyed && (p.hasApi || p.connect?.both || p.access?.auth === "key") ? `<div class="row small" style="margin-top:8px"><a class="btn sm" href="${esc(p.links.keys)}" target="_blank" rel="noopener">Get a ${esc(p.name)} API key</a><span class="dim">then paste it below</span></div>` : ""}
    ${p.access?.auth === "key" || p.hasApi || p.connect?.both || p.noKey ? `<div class="row" style="margin-top:10px">
      ${p.noKey ? `<span class="small dim" style="flex:1">No key needed (runs on this PC)</span>` : `<input type="password" placeholder="${p.keyed ? `saved: ${p.masked}` : p.keyHint || "API key"}" data-key="${p.id}" style="flex:1" autocomplete="off">`}
      ${p.id === "kling" ? `<input type="password" placeholder="secret key" data-secret="${p.id}" style="flex:1" autocomplete="off">` : ""}
      ${p.id === "anthropic" ? `<input type="text" placeholder="workspace ID (optional)" value="${esc(p.workspaceId || "")}" data-ws="${p.id}" style="width:170px;font-family:var(--mono)" autocomplete="off" title="Only for keys that must name a workspace. Sent as anthropic-workspace-id on every Claude request.">` : ""}
      ${p.noKey ? "" : `<button class="btn sm" data-save-key="${p.id}">Save &amp; test</button>`}
      ${p.keyed && p.keyScope !== "managed" ? `<button class="btn sm" data-test="${p.id}">Test</button><button class="btn sm danger" data-rm-key="${p.id}">Remove</button>` : ""}
    </div>` : (["handoff", "local", "mcp", "oauth"].includes(p.access?.auth) ? "" : `<div class="dim small" style="margin-top:8px">No public API: credits are tracked from what you log, and the links below open the real thing.</div>`)}
    ${p.kind !== "agent" ? `<label class="row small" style="margin-top:8px;gap:8px">Plan <select data-plan="${p.id}" aria-label="Plan for ${esc(p.name)}">${[["unknown", "Unknown"], ["free", "Free"], ["paid", "Paid"]].map(([v, lab]) => `<option value="${v}" ${p.plan === v ? "selected" : ""}>${lab}</option>`).join("")}</select>${p.planSource === "guess" ? `<span class="dim">guessed</span>` : ""}</label>` : ""}
    <div class="row small" style="margin-top:8px;gap:12px">${Object.entries(p.links || {}).filter(([, u]) => u).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${k}</a>`).join("")}</div>
    ${p.kind === "text" ? `<div class="models">${p.models.map((m) => `<div class="mrow" data-model="${esc(m.id)}"><span class="mono" title="${esc(m.id)}">${esc(m.name)} <span class="dim">· ${m.tier}</span></span><input type="number" step="0.01" value="${m.in}" data-in title="$ per 1M input tokens"><input type="number" step="0.01" value="${m.out}" data-out title="$ per 1M output tokens"><button class="ghost small" data-price>save $</button></div>`).join("")}
      ${p.liveModels?.length ? `<div class="dim small" style="margin-top:6px">Your account can also see: ${p.liveModels.slice(0, 14).map(esc).join(", ")}${p.liveModels.length > 14 ? "…" : ""}</div>` : ""}
      ${p.custom ? `<div class="dim small" style="margin-top:6px">Matching tasks go to this app or AI${p.addedCapabilities?.length ? ` (${p.addedCapabilities.join(", ")})` : ""}. ${p.addedStrengths?.length ? `Scores have raised ${[...new Set(p.addedStrengths.map((s) => s.capability))].join(", ")}.` : "Scores from your jobs make the pick sharper."}</div>` : ""}</div>` : ""}
  </div>`;
  const moreBar = S.uiMode === "simple" ? `<div class="panel" id="settings-more-bar"><div class="row" style="gap:8px"><button type="button" class="btn sm" id="settings-back">Back to basics</button><input type="search" id="settings-find" placeholder="Find a setting" aria-label="Find a setting" style="flex:1"></div></div>` : "";
  const activeProjObj = (S.projects || []).find((p) => p.id === S.project);
  const groupsNav = `<div class="panel" id="settings-groups-bar" style="margin-bottom:12px"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><span class="dim small">Sections:</span><button type="button" class="btn sm" data-settings-jump="#settings-group-my-ais">My AIs</button><button type="button" class="btn sm" data-settings-jump="#settings-group-projects-media">Projects &amp; Media</button><button type="button" class="btn sm" data-settings-jump="#settings-group-privacy">Privacy</button><button type="button" class="btn sm" data-settings-jump="#settings-group-notifications">Notifications</button><button type="button" class="btn sm" data-settings-jump="#settings-group-advanced">Advanced</button></div></div>`;
  v.innerHTML = `
  ${moreBar}
  ${groupsNav}
  <div class="grid" style="grid-template-columns: 1fr 1fr">
    <div class="grid" style="align-content:start">
      <div class="panel" id="settings-keys"><div id="settings-group-my-ais" class="cat-h" style="margin-bottom:4px">My AIs</div><h3>Chat &amp; reasoning AIs <span class="right">${S.mode === "hosted" ? "keys encrypted in your hub" : "keys stay on this PC"} · ${esc(S.vault?.method || "")}</span></h3>
        <div class="dim small">Claude, ChatGPT, Grok and Gemini need an API key, or an OpenRouter key, to take part in the council. An MCP server does not take their place there. Tools such as Kling can use an API key or an MCP server.</div>
        ${openRouterStartCard()}
        ${anyKeyHtml()}
        <div class="grid" style="gap:10px;margin-top:10px">${textP.map(card).join("")}</div>
        ${S.mode === "hosted" ? "" : `<div class="row" style="margin-top:10px"><button class="btn sm" id="cp-add">+ Add custom provider</button><span class="dim small">Any OpenAI- or Anthropic-compatible API: OpenRouter, Groq, Together, Fireworks, DeepSeek, Mistral, Perplexity, Ollama, LM Studio, Aider, OpenCode, or a company gateway. Freebuff is not used.</span></div><div id="cp-form"></div>`}</div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>General</h3>
        ${S.uiMode === "simple" ? `<div class="dim small">Spend caps, router scores, MCP, and webhooks are in Expert. Use the switch in the top bar.</div>` : `<div class="grid cols-3">
          <div><label class="lbl">Monthly API budget $</label><input type="number" id="s-budget" value="${S.settings.budgetMonthly}"><div class="dim small">Paid calls stop when this month's spending reaches it. Free and practice AIs keep working.</div></div>
          <div><label class="lbl">Default priority</label><select id="s-mode">${PRIORITY.map(([m, label]) => `<option value="${m}" ${(S.settings.defaultMode === m || (m === "savings" && S.settings.defaultMode === "economy")) ? "selected" : ""}>${label}</option>`).join("")}</select></div>
          <div><label class="lbl">Mission cap $</label><input type="number" id="s-mcap" value="${S.settings.missionBudget}" step="0.5"><div class="dim small">One run stops when it reaches this.</div></div>
        </div>`}
        <div class="row" style="margin-top:10px"><button class="btn sm" id="s-save">Save</button><button class="btn sm" id="s-check">Re-check all AIs</button>
          <label class="row small" style="gap:6px;margin-left:auto"><input type="checkbox" id="s-demo" ${S.demo ? "checked" : ""}> Demo mode (3 pretend AIs, no spend)</label></div>
        <div class="dim small" style="margin-top:6px">${S.mode === "hosted" ? "" : `${S.hqDir ? `HQ folder: ${esc(S.hqDir)} · ` : ""}<a href="#" id="s-setup">${esc(RESTART_SETUP_LABEL)}</a> · <a href="#" id="s-find-ais">Find my AIs</a> · `}Version, Check for updates, and About are in Help.</div>
        ${S.mode === "hosted"
          ? `<div class="dim small" style="margin-top:8px">Your API keys are encrypted (AES-256-GCM) before they are stored and are only decrypted inside the hub to call the provider you gave them to. They are never sent to this browser.</div>`
          : S.vault?.canSave === false
            ? `<div class="small" style="margin-top:8px;color:var(--amber)">Keys cannot be saved here: ${esc(S.vault?.method || "")} Keys are only ever stored encrypted by the operating system; use the desktop app.</div>`
            : `<div class="dim small" style="margin-top:8px">Vault file: <span class="mono">${esc(S.vault?.file || "")}</span>. Keys are sealed with ${esc(S.vault?.method || "the operating system")} for your user account and never leave this machine except to the provider you gave them to.</div>`}
      </div>
      ${S.mode === "hosted" ? `<div class="panel"><h3>Account <span class="right">${esc(S.user?.email || "")}</span></h3>
        <div class="row"><span class="small muted">Signed in to the hub at <span class="mono">${esc(hubAddress())}</span>.</span><button class="btn sm" id="acct-out" style="margin-left:auto">Sign out</button></div></div>` : ""}
      ${phonePanel()}
      <div class="panel" id="settings-plan"><h3>License &amp; cloud <span class="right">tier: ${esc(S.license?.tier || "free")}${S.license?.configured ? "" : " · no license server"}</span></h3>
        <label class="small" for="lic-key"><b>License key or promo code</b></label>
        <div class="row" style="margin-top:4px"><input type="text" id="lic-key" placeholder="${S.license?.key ? `active: ${esc(S.license.key)}` : "EVB-XXXX-XXXX-XXXX or a promo code"}" style="flex:1;font-family:var(--mono)" autocomplete="off">${S.mode === "hosted" ? "" : `<input type="email" id="lic-email" placeholder="your email (for promo codes)" value="${esc(S.license?.email || "")}" style="flex:1">`}<button class="btn sm primary" id="lic-go" data-busy-label="Checking...">Activate</button></div>
        <div class="dim small" style="margin-top:4px">Paste the key or code you were given into this one box. ${S.mode === "hosted" ? `Codes are linked to ${esc(S.user?.email || "your account")}.` : "A promo code also needs your email."}</div>
        <div class="small muted" style="margin-top:6px">${esc(S.license?.message || "")} ${S.license?.email ? `· ${esc(S.license.email)}` : ""} ${(S.license?.tier || "free") === "free" ? `· Free tier: Single mode, ${S.license?.limits?.councilsPerMonth ?? 5} councils/month, ${S.license?.limits?.projects ?? 3} projects, ${S.license?.limits?.connectedServices ?? 1} connected service.` : ""}</div>
        ${(S.license?.tier || "free") === "free" || (S.license?.tier || "free") === "pro" ? `<div style="margin-top:10px">${upgradeBlock(false)}</div>` : `<div style="margin-top:10px">${planCompareHtml(S.proPlans?.compare)}${extremeExtrasHtml()}${founderSpotsHtml(S.proPlans)}</div>`}
        <div class="row" style="margin-top:8px"><button class="btn sm" id="lic-re" data-busy-label="Checking...">Re-check my license</button></div>
        ${licenceCloudFields()}
      </div>
      <div id="settings-extras" class="grid" style="gap:16px"></div>
      <div class="panel" id="settings-group-projects-media"><h3>Projects &amp; Media <span class="right">credits tracked · API where one exists</span></h3>
        <div class="row small" style="margin-bottom:10px;gap:10px;flex-wrap:wrap;align-items:center">
          <span>Active project: <b>${esc(activeProjObj?.name || S.project || "None")}</b></span>
          ${activeProjObj ? `<label class="row small" style="gap:6px">Project mode <select id="s-proj-uimode" data-proj-uimode="${esc(activeProjObj.id)}" aria-label="Project UI mode"><option value="" ${!activeProjObj.uiMode ? "selected" : ""}>Use global (${esc(S.uiMode)})</option><option value="simple" ${activeProjObj.uiMode === "simple" ? "selected" : ""}>Simple</option><option value="expert" ${activeProjObj.uiMode === "expert" ? "selected" : ""}>Expert</option></select></label>` : ""}
        </div>
        <div class="grid" style="gap:10px">${mediaP.map(card).join("")}</div></div>
      <div class="panel" id="settings-group-privacy"><h3>Privacy</h3>
        <label class="row small" style="gap:8px"><input type="checkbox" id="s-private-mode" ${S.settings?.privateMode ? "checked" : ""}> Private mode (keep chats on this computer)</label>
        <div class="dim small" style="margin-top:6px">Keys and vault files stay sealed on this machine. Manage what leaves this PC in the Privacy controls above or in Help.</div>
      </div>
      <div class="panel" id="settings-group-notifications"><h3>Notifications</h3>
        <label class="row small" style="gap:8px"><input type="checkbox" id="s-notify-done" ${S.settings?.notifyOnDone !== false ? "checked" : ""}> Notify when a long mission or research run finishes</label>
        <div class="dim small" style="margin-top:6px">Shows a quiet completion notice when background work finishes.</div>
      </div>
      <div class="panel" id="settings-group-advanced"><h3>Advanced</h3>
        <div class="dim small">Spend caps, custom model pricing, MCP connections, and feature panels are grouped under Advanced.</div>
      </div>
    </div>
  </div>`;
  $$("[data-plan]", v).forEach((sel) => sel.addEventListener("change", async () => {
    try { await api("/access/plan", { method: "POST", body: { provider: sel.dataset.plan, plan: sel.value } }); await refresh(); }
    catch (e) { toast(e.message, true); }
  }));
  $$("[data-mcp-connect]", v).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.mcpConnect;
    b.disabled = true;
    try {
      const r = await api("/connect/mcp", { method: "POST", body: { provider: id } });
      if (r.oauthUrl) { localStorage.setItem("cc.mcp.oauth", r.serverId); window.open(r.oauthUrl, "_blank", "noopener"); toast("Sign in, then come back to this page."); }
      else if (r.ok) toast("Connected");
      else toast(r.error || r.detail || "Could not connect", !r.quiet);
      await refresh();
    } catch (e) { toast(e.quiet ? e.message : (P(id)?.access?.note || e.message), true); b.disabled = false; }
  }));
  $$("[data-save-key]", v).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.saveKey; const key = $(`[data-key="${id}"]`, v).value.trim(); const secret = $(`[data-secret="${id}"]`, v)?.value.trim();
    const wsEl = $(`[data-ws="${id}"]`, v); const workspaceId = wsEl ? wsEl.value.trim() : undefined;
    const wsOnly = !key && wsEl && P(id)?.keyed && workspaceId !== (P(id)?.workspaceId || "");
    if (!key && !wsOnly) return toast("Paste the key first", true);
    const sug = key ? await suggestKey(key) : null;
    if (sug && sug.provider !== id && sug.confidence === "high" && confirm(`This looks like a ${sug.name} key, not ${pname(id)}. Save it as ${sug.name} instead?`)) return saveKeyAs(sug, key);
    b.disabled = true; b.textContent = "Testing…";
    try { const r = await api("/keys", { method: "POST", body: { provider: id, key, secret, workspaceId } }); keyToast(id, r); await refresh(); }
    catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Save & test"; }
  }));
  $$("[data-test]", v).forEach((b) => b.addEventListener("click", async () => { b.textContent = "…"; const r = await api(`/check/${b.dataset.test}`, { method: "POST" }); toast(`${pname(b.dataset.test)}: ${r.status} · ${r.detail}`, r.status === "red"); await refresh(); }));
  $$("[data-rm-key]", v).forEach((b) => b.addEventListener("click", async () => { if (!confirm(`Remove the ${pname(b.dataset.rmKey)} key from the vault?`)) return; await api(`/keys/${b.dataset.rmKey}`, { method: "DELETE" }); await refresh(); }));
  $$("[data-conn]", v).forEach((b) => b.addEventListener("click", async () => {
    try { await api("/connect/active", { method: "POST", body: { provider: b.dataset.prov, mode: b.dataset.conn } }); await refresh(); }
    catch (e) { toast(e.message, true); }
  }));
  $$("[data-conn-test]", v).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.connTest; const mode = P(id)?.connect?.active || "key";
    b.disabled = true;
    try { const r = await api("/connect/test", { method: "POST", body: { provider: id, mode } }); toast(`${pname(id)}: ${r.detail}`, !r.ok); await refresh(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $$("[data-conn-save]", v).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.connSave;
    const transport = $(`[data-conn-transport="${id}"]`, v).value;
    const target = $(`[data-conn-target="${id}"]`, v).value.trim();
    const headers = $(`[data-conn-headers="${id}"]`, v).value.trim();
    if (!target) return toast(transport === "stdio" ? "Type the start command" : "Paste the MCP server address", true);
    const body = { provider: id, transport };
    if (transport === "stdio") {
      const parts = target.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^["']|["']$/g, "")) || [];
      body.command = parts[0] || ""; body.args = parts.slice(1);
    } else body.url = target;
    if (headers) body.headers = headers;
    b.disabled = true;
    try { const r = await api("/connect/mcp", { method: "POST", body }); toast(r.ok ? `${pname(id)}: MCP connected` : (r.error || "Saved, could not reach the server"), !r.ok); await refresh(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $$("[data-price]", v).forEach((b) => b.addEventListener("click", async () => { const row = b.closest(".mrow"); await api("/pricing", { method: "POST", body: { model: row.dataset.model, in: Number($("[data-in]", row).value), out: Number($("[data-out]", row).value) } }); toast("Price saved"); }));
  $("#s-save").addEventListener("click", async () => {
    const body = {
      budgetMonthly: $("#s-budget") ? Number($("#s-budget").value) : S.settings.budgetMonthly,
      defaultMode: $("#s-mode") ? $("#s-mode").value : S.settings.defaultMode,
      missionBudget: $("#s-mcap") ? Number($("#s-mcap").value) : S.settings.missionBudget,
    };
    try {
      const budgetChanged = Number.isFinite(body.budgetMonthly) && body.budgetMonthly > 0 && body.budgetMonthly !== S.settings.budgetMonthly;
      S.settings = await api("/settings", { method: "POST", body });
      // typing a monthly budget turns the stop on, so the number is a real limit and not only a label
      if (budgetChanged) await api("/cost-guard", { method: "POST", body: { on: true, cap: body.budgetMonthly } });
      renderBudget(); toast("Saved");
    } catch (e) { toast(e.message, true); }
  });
  $("#s-check").addEventListener("click", async () => { toast("Checking every AI…"); await api("/check", { method: "POST" }); await refresh(); });
  $("#s-setup")?.addEventListener("click", (e) => { e.preventDefault(); restartFullSetup(); });
  $("#s-find-ais")?.addEventListener("click", (e) => { e.preventDefault(); S.connectWizard = false; S.setup = S.setup || {}; S.setup.fullFlow = false; S.setup.phase = "scan"; S.view = "setup"; render(); });
  $("#acct-out")?.addEventListener("click", () => signOut(true, "Signed out."));
  $("#hub-save")?.addEventListener("click", () => { const v = $("#hub-addr").value.trim().replace(/\/$/, ""); if (!/^https?:\/\//.test(v)) return toast("Enter a full address, e.g. https://your-hub.fly.dev", true); localStorage.setItem("cc.hub", v); location.reload(); });
  $("#hub-reset")?.addEventListener("click", () => { localStorage.removeItem("cc.hub"); location.reload(); });
  $("#hub-copy")?.addEventListener("click", () => { navigator.clipboard.writeText(hubAddress()); toast("Link copied"); });
  if ($("#hub-qr")) apiBlobUrl(`/pair/qr.svg?u=${encodeURIComponent(hubAddress())}`).then((u) => { const img = $("#hub-qr"); if (img) img.src = u; }).catch(() => {});
  $("#pair-on")?.addEventListener("change", async (e) => {
    const box = e.target;
    box.disabled = true;
    try {
      const r = await api("/pairing", { method: "POST", body: { on: box.checked } });
      S.pairing = r;
      if (r.error) toast(r.error, true);
      render();
    } catch (err) {
      toast(err.message, true);
      box.checked = !box.checked;
      box.disabled = false;
    }
  });
  $("#pair-copy")?.addEventListener("click", async () => {
    const url = S.pairing?.url || $("#pair-url")?.textContent || "";
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch { toast("Could not copy. Select the address and copy it.", true); }
  });
  if ($("#pair-qr")) apiBlobUrl("/pairing/qr.svg").then((u) => { const img = $("#pair-qr"); if (img) img.src = u; }).catch((e) => { const el = $("#pair-error"); if (el) el.textContent = e.message; });
  bindProPlans(v);
  $("#sub-lic")?.addEventListener("click", () => { $("#lic-key")?.focus(); });
  // One box: the server tells a license key from a promo code (EVERBORN-OWNER, TEST-...).
  $("#lic-go")?.addEventListener("click", async () => {
    const value = $("#lic-key").value.trim();
    if (!value) { toast("Enter your license key or promo code.", true); $("#lic-key").focus(); return; }
    try { S.license = await api("/license", { method: "POST", body: { key: value, email: $("#lic-email")?.value || S.user?.email } }); toast(S.license.status === "active" ? `License active: ${S.license.tier}` : (S.license.message || "License checked"), S.license.status !== "active"); render(); } catch (e) { toast(e.message, true); }
  });
  $("#lic-re")?.addEventListener("click", async () => { try { S.license = await api("/license/recheck", { method: "POST" }); toast(S.license.message || "Re-checked"); render(); } catch (e) { toast(e.message, true); } });
  $("#cl-save")?.addEventListener("click", async () => { try { const r = await api("/cloud", { method: "POST", body: { url: $("#cl-url").value, anonKey: $("#cl-key").value } }); S.settings.cloud = r.cloud; S.license = r.license; toast("License server saved; re-checking the license"); render(); } catch (e) { toast(e.message, true); } });
  renderUpdateBox();
  $("#s-demo").addEventListener("change", async (e) => { const r = await api("/demo", { method: "POST", body: { on: e.target.checked } }); S.demo = r.demo; toast(r.demo ? "Demo AIs online" : "Demo AIs offline"); await refresh(); });
  wireOpenRouterStart(v);
  wireAnyKey(v);
  $("#cp-add")?.addEventListener("click", () => openCustomForm());
  $$("[data-cp-edit]", v).forEach((b) => b.addEventListener("click", () => openCustomForm(b.dataset.cpEdit)));
  $$("[data-cp-del]", v).forEach((b) => b.addEventListener("click", async () => { if (!confirm(`Delete the custom provider ${pname(b.dataset.cpDel)} and its saved key? Past runs stay in history.`)) return; try { await api(`/providers/custom/${encodeURIComponent(b.dataset.cpDel)}`, { method: "DELETE" }); toast("Custom provider deleted"); await refresh(); } catch (e) { toast(e.message, true); } }));
  renderExtras("settings", "#settings-extras");
  $("#settings-back")?.addEventListener("click", () => { S.settingsMore = false; S.navFocus = ""; render(); });
  $("#settings-find")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$(".panel", v).forEach((p) => {
      if (p.id === "settings-more-bar") return;
      p.hidden = !!q && !p.textContent.toLowerCase().includes(q);
    });
  });
  if (S.focusProvider) { const el = $(`#prov-${S.focusProvider}`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.animate([{ boxShadow: "0 0 0 2px var(--accent)" }, { boxShadow: "none" }], { duration: 1600 }); el?.querySelector?.('[data-key], input:not([type="hidden"]):not([disabled])')?.focus?.(); S.focusProvider = null; }
  // Section chips filter the long page: pick one and only that section shows; "Show all" brings the rest back (bug 12).
  const groupIds = ["settings-group-my-ais", "settings-group-projects-media", "settings-group-privacy", "settings-group-notifications", "settings-group-advanced"];
  const groupOf = new Map();
  const first = $("#settings-keys", v);
  if (first?.parentElement) {
    let cur = "";
    for (const child of first.parentElement.children) {
      if (child.id === "settings-groups-bar") continue;
      const hit = groupIds.find((g) => child.id === g || child.querySelector?.(`#${g}`));
      if (hit) cur = hit;
      groupOf.set(child, cur);
    }
  }
  const showGroup = (g) => { for (const [el, grp] of groupOf) el.hidden = !!g && grp !== g; $("#settings-show-all", v)?.toggleAttribute("hidden", !g); };
  const chipBar = $("#settings-groups-bar .row", v);
  if (chipBar && groupOf.size) chipBar.insertAdjacentHTML("beforeend", `<button type="button" class="btn sm" id="settings-show-all" hidden>Show all</button>`);
  $("#settings-show-all", v)?.addEventListener("click", () => showGroup(""));
  $$("[data-settings-jump]", v).forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.settingsJump.slice(1);
    if (groupOf.size && groupIds.includes(g)) showGroup(g);
    const target = $(b.dataset.settingsJump, v); target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $("#s-proj-uimode", v)?.addEventListener("change", async (e) => {
    const pid = e.target.dataset.projUimode;
    const modeVal = e.target.value || null;
    const proj = (S.projects || []).find((p) => p.id === pid);
    if (proj) proj.uiMode = modeVal;
    try {
      await api("/projects", { method: "POST", body: { id: pid, uiMode: modeVal } });
      if (modeVal === "simple" || modeVal === "expert") { S.uiMode = modeVal; syncChrome(); }
      toast("Project mode saved");
    } catch (err) { toast(err.message, true); }
  });
  $("#s-private-mode", v)?.addEventListener("change", async (e) => {
    try {
      const r = await api("/desk/private", { method: "POST", body: { on: !!e.target.checked } });
      S.settings.privateMode = !!r.privateMode;
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  });
  $("#s-notify-done", v)?.addEventListener("change", async (e) => {
    const notifyOnDone = !!e.target.checked;
    S.settings = { ...(S.settings || {}), notifyOnDone };
    api("/settings", { method: "POST", body: { notifyOnDone } }).catch(() => {});
  });
  if (S.navFocus) { const el = document.querySelector(S.navFocus); el?.scrollIntoView({ behavior: "smooth", block: "center" }); S.navFocus = ""; }
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
function openRouterStartCard() {
  const on = !!P("openrouter")?.keyed;
  return `<div class="route" id="or-start">
    <span class="chip green">Recommended</span>
    <div style="margin-top:6px"><b>One key to start: OpenRouter</b></div>
    <div class="dim small" style="margin-top:4px">One key reaches Claude, GPT, Gemini, Grok, DeepSeek, Llama and more, with free models available.</div>
    ${S.uiMode === "simple" ? `<div class="row" style="margin-top:6px"><button type="button" class="ghost small" id="or-whats">What's this?</button></div><p class="hint" id="or-whats-note" hidden>One password that reaches several AIs. Meldmind does not charge extra for it.</p>` : ""}
    <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
      <a class="btn sm" href="https://openrouter.ai/keys" target="_blank" rel="noopener">Get an OpenRouter key</a>
      ${on ? `<span class="chip green">Connected</span>` : `<button type="button" class="btn sm primary" id="or-start-go">Add OpenRouter key</button>`}
    </div>
  </div>`;
}
function wireOpenRouterStart(root) {
  $("#or-start-go", root)?.addEventListener("click", () => window.CC.keysetup?.open?.("openrouter"));
  $("#or-whats", root)?.addEventListener("click", () => {
    const note = $("#or-whats-note", root);
    if (note) note.hidden = !note.hidden;
  });
}
function anyKeyHtml() {
  return `<div class="route" style="margin-top:4px"><div class="small muted" style="margin-bottom:6px">Paste any API key and the app works out which provider it belongs to (AQ. and AIza are Google Gemini, sk-ant- is Claude, sk- and sk-proj- are ChatGPT, xai- is Grok, sk-or- is OpenRouter, gsk_ is Groq).</div>
    <div class="row"><input type="password" id="anykey" placeholder="paste any API key" style="flex:1" autocomplete="off"><button class="btn sm primary" id="anykey-go">Detect &amp; save</button></div>
    <div class="small" id="anykey-out" style="margin-top:6px"></div></div>`;
}
function unknownKeyHtml() {
  const opts = (S.providers || []).filter((p) => !p.demo && !p.noKey && (p.hasApi || p.kind === "text"));
  const pick = opts.length ? `<div class="row" style="margin-top:6px"><label class="small">Provider <select id="anykey-pick" aria-label="Provider">${opts.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label><button class="btn sm" type="button" id="anykey-pick-save">Save and test</button></div>` : "";
  return `Could not tell which provider this key is for. Pick one and it is tested with a cheap call, or <a href="#" id="anykey-custom">add it as a custom provider</a>.${pick}`;
}
function wireAnyKey(root) {
  const go = $("#anykey-go", root); if (!go) return;
  go.addEventListener("click", async () => {
    const key = $("#anykey", root).value.trim(); const out = $("#anykey-out", root);
    if (!key) return toast("Paste the key first", true);
    const sug = await suggestKey(key);
    if (!sug) {
      out.innerHTML = unknownKeyHtml();
      $("#anykey-custom", root)?.addEventListener("click", (e) => { e.preventDefault(); openCustomForm(null, { key }); });
      $("#anykey-pick-save", root)?.addEventListener("click", async () => {
        const id = $("#anykey-pick", root)?.value;
        if (!id) return;
        await saveKeyAs({ provider: id, name: pname(id), builtin: true, confidence: "high" }, key);
      });
      return;
    }
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
  const f = existing || (pr ? { name: pr.name, baseUrl: pr.baseUrl, api: pr.api, noKey: pr.noKey, keysUrl: pr.keys, note: pr.note } : { api: "openai" });
  box.innerHTML = `<div class="route" style="margin-top:10px"><div class="cat-h">${existing ? `Edit ${esc(existing.name)}` : "Add custom provider"}</div>
    ${existing ? "" : `<div class="row small" style="flex-wrap:wrap;gap:6px;margin-bottom:8px"><span class="dim">Presets:</span>${presets.map((x) => `<button class="ghost small" data-preset="${x.id}" title="${esc(x.baseUrl)}">${esc(x.name)}${x.builtin ? " (built in)" : ""}</button>`).join("")}</div>`}
    ${f.note ? `<p class="small dim" style="margin:0 0 8px">${esc(f.note)}</p>` : ""}
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
      <label class="small">Name<input type="text" id="cp-name" value="${esc(f.name || "")}" placeholder="My gateway" style="width:100%"></label>
      <label class="small">API style<select id="cp-api" style="width:100%"><option value="openai" ${f.api !== "anthropic" ? "selected" : ""}>OpenAI-compatible (most providers)</option><option value="anthropic" ${f.api === "anthropic" ? "selected" : ""}>Anthropic-compatible</option></select></label>
      <label class="small" style="grid-column:1/3">Base URL<input type="text" id="cp-url" value="${esc(f.baseUrl || "")}" placeholder="https://api.example.com/v1" style="width:100%;font-family:var(--mono)"></label>
      <label class="small">API key<input type="password" id="cp-key" value="${esc(pre.key || "")}" placeholder="${existing?.keyed ? "saved (leave empty to keep)" : "API key"}" style="width:100%" autocomplete="off" ${f.noKey ? "disabled" : ""}></label>
      <label class="row small" style="gap:6px;align-self:end"><input type="checkbox" id="cp-nokey" ${f.noKey ? "checked" : ""}> No key needed (Ollama, LM Studio, Aider, OpenCode)</label>
      <label class="small" style="grid-column:1/3">Models (comma separated; leave empty to discover from /models)<div class="row"><input type="text" id="cp-models" value="${esc((f.models || []).join(", "))}" placeholder="e.g. llama-3.3-70b, qwen3-32b" style="flex:1;font-family:var(--mono)"><button class="btn sm" id="cp-discover">Discover models</button></div></label>
      <div class="small" style="grid-column:1/3">Good at <span class="dim">Leave none ticked to learn from the name. Tick the task types you know.</span><div class="row" id="cp-caps" style="flex-wrap:wrap;gap:8px;margin-top:4px">${["reasoning", "code", "writing", "research", "creative", "analysis", "math", "fast"].map((c) => `<label class="row small" style="gap:4px"><input type="checkbox" data-cap="${c}" ${(f.capabilities || []).includes(c) ? "checked" : ""}> ${c}</label>`).join("")}</div></div>
      <p class="small dim" style="grid-column:1/3;margin:0">Meldmind learns what this app or AI is good at and sends matching tasks to it. Scores from your jobs make the pick sharper.</p>
      <label class="small" style="grid-column:1/3">Extra headers (optional, one per line as Name: value; stored encrypted)<textarea id="cp-headers" rows="2" style="width:100%;font-family:var(--mono)" placeholder="${existing?.headerNames?.length ? `saved: ${esc(existing.headerNames.join(", "))} (leave empty to keep)` : "X-Org-Id: 1234"}"></textarea></label>
    </div>
    ${f.keysUrl ? `<div class="small" style="margin-top:6px"><a href="${esc(f.keysUrl)}" target="_blank" rel="noopener">Get a key for ${esc(f.name)}</a></div>` : ""}
    <div class="row" style="margin-top:8px"><button class="btn sm primary" id="cp-save">${existing ? "Save changes" : "Add provider"}</button><button class="btn sm" id="cp-cancel">Cancel</button><span class="small dim" id="cp-msg"></span></div></div>`;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  $$("[data-preset]", box).forEach((b) => b.addEventListener("click", () => { const x = presets.find((y) => y.id === b.dataset.preset); if (x.builtin) { S.focusProvider = x.builtin; box.innerHTML = ""; render(); return toast(`${x.name} is built in: paste the key into its card.`); } openCustomForm(null, { preset: x.id, key: $("#cp-key", box).value }); }));
  $("#cp-nokey", box).addEventListener("change", (e) => { $("#cp-key", box).disabled = e.target.checked; });
  $("#cp-cancel", box).addEventListener("click", () => { box.innerHTML = ""; });
  const headers = () => { const t = $("#cp-headers", box).value.trim(); if (!t) return existing ? undefined : {}; return Object.fromEntries(t.split(/\n/).map((l) => l.split(/:(.*)/s)).filter((x) => x[0]?.trim()).map(([n, v]) => [n.trim(), (v || "").trim()])); };
  let capsTouched = false;
  $$("[data-cap]", box).forEach((el) => el.addEventListener("change", () => { capsTouched = true; }));
  const body = () => ({ id: existing?.id, name: $("#cp-name", box).value, baseUrl: $("#cp-url", box).value, api: $("#cp-api", box).value, key: $("#cp-key", box).value, noKey: $("#cp-nokey", box).checked, models: $("#cp-models", box).value, headers: headers(), keysUrl: f.keysUrl || null, ...(capsTouched ? { capabilities: [...$$("[data-cap]:checked", box)].map((el) => el.dataset.cap) } : {}) });
  $("#cp-discover", box).addEventListener("click", async () => { const m = $("#cp-msg", box); m.textContent = "Asking the provider for its models..."; try { const r = await api("/providers/discover", { method: "POST", body: body() }); $("#cp-models", box).value = r.models.slice(0, 40).join(", "); m.textContent = `${r.models.length} model${r.models.length === 1 ? "" : "s"} found. Trim the list to the ones you want.`; } catch (e) { m.textContent = e.message; } });
  $("#cp-save", box).addEventListener("click", async (e) => { const b = e.target; b.disabled = true; $("#cp-msg", box).textContent = "Saving and testing..."; try { const r = await api("/providers/custom", { method: "POST", body: body() }); box.innerHTML = ""; keyToast(r.provider.id, r); S.focusProvider = r.provider.id; await refresh(); } catch (err) { $("#cp-msg", box).textContent = err.message; b.disabled = false; } });
}

// ---------------- boot ----------------
$("#tabs").addEventListener("click", (e) => {
  const root = $("#tabs");
  const trigger = e.target.closest(".nav-trigger");
  if (trigger && root.contains(trigger)) {
    const menu = trigger.closest(".nav-menu");
    const wasOpen = menu.classList.contains("open");
    closeNav(root);
    if (!wasOpen) { menu.classList.add("open"); trigger.setAttribute("aria-expanded", "true"); }
    return;
  }
  const b = e.target.closest("button");
  if (!b || !root.contains(b)) return;
  // Each data-action is listed in MENU_ACTIONS (web/nav.js). updates is handled in web/features/updates.js.
  if (b.dataset.action === "tour") { closeNav(root); window.CC.tour?.start?.(); return; }
  if (b.dataset.action === "connect-setup") { closeNav(root); window.CC.connectSetup?.open?.(); return; }
  if (b.dataset.action === "news") { closeNav(root); window.CC.tour?.openNews?.(); return; }
  if (b.dataset.action === "demo-on") { closeNav(root); if (S.demo) toast("Demo mode is already on. Use Exit demo mode at the top to leave it."); else setDemo(true); return; }
  if (!b.dataset.view) return;
  S.connectWizard = false;
  if (b.dataset.view === "setup") { S.setup = S.setup || {}; S.setup.fullFlow = false; S.setup.phase = "scan"; }
  S.view = b.dataset.view;
  S.openProject = null;
  S.navFocus = b.dataset.focus || "";
  // Missions and Councils on a wide Expert bar open Command with that run mode picked.
  if (b.dataset.runMode) S.cmdMode = b.dataset.runMode;
  const sc = S.uiMode === "expert" ? shortcutModeOf(b) : "";
  if (sc) { S.cmdMode = sc; S.cmdShortcut = sc; S.focusOrders = true; }
  else S.cmdShortcut = "";
  // A Connect or Connections link opens Settings past the Simple basics, at that panel.
  if (b.dataset.view === "settings" && S.navFocus) S.settingsMore = true;
  // A promoted page is lit on the bar, not on the menu it left.
  S.navMenu = b.closest(".nav-menu")?.dataset.menu || (b.classList.contains("nav-promoted") ? "" : groupFor(b.dataset.view));
  closeNav(root);
  render();
});
document.addEventListener("click", (e) => { const root = $("#tabs"); if (root && !root.contains(e.target)) closeNav(root); });
watchNavLayout((layout) => {
  const root = $("#tabs");
  if (!root) return;
  let next = layout;
  if (next === "normal" && root.clientWidth > 0 && rowOverflows(root)) next = "narrow";
  const mode = S.uiMode === "expert" ? "expert" : "simple";
  const want = currentNavPromote(mode, knownViews(), next, S.mode === "hosted" ? "web" : "").join(",");
  if (root.dataset.navLayout === next && root.dataset.nav === "1" && (root.dataset.navPromoteWant || "") === want) return;
  if (!S.navFocus) S.navMenu = "";
  root.dataset.nav = "";
  ensureFeatureTabs();
});
$("#feed-clear").addEventListener("click", () => { S.feed = []; renderFeed(); });
document.addEventListener("input", (e) => {
  const form = e.target.closest?.(".reply-box");
  if (!form || e.target.tagName !== "TEXTAREA" || !S.live?.id) return;
  replyDrafts[`${S.live.id}|${form.dataset.replyScope}:${form.dataset.replyTarget || ""}`] = e.target.value;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
  const form = e.target.closest?.(".reply-box");
  if (!form) return;
  e.preventDefault();
  form.requestSubmit();
});
document.addEventListener("submit", (e) => {
  const form = e.target?.closest?.(".reply-box") || (e.target?.classList?.contains("reply-box") ? e.target : null);
  if (!form) return;
  e.preventDefault();
  sendReply(form);
});
async function sendReply(form) {
  const text = form.querySelector("textarea")?.value.trim() || "";
  if (!text) return toast("Type a reply first", true);
  if (!S.live?.id) return;
  const scope = form.dataset.replyScope;
  const target = form.dataset.replyTarget || "";
  const key = `${S.live.id}|${scope}:${target}`;
  S.live.replying = { scope, target };
  replyDrafts[key] = "";
  renderOps();
  try {
    await api("/followup", { method: "POST", body: { runId: S.live.id, text, scope, target: target || undefined } });
  } catch (err) {
    S.live.replying = null;
    replyDrafts[key] = text;
    renderOps();
    toast(err.message, true);
  }
}
$("#mode-toggle")?.addEventListener("click", (e) => { const b = e.target.closest("button[data-ui-mode]"); if (!b) return; setUiMode(b.dataset.uiMode); });
$("#mobile-nav").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-simple-create")) { toggleSimpleCreate(); return; }
  document.getElementById("simple-create")?.classList.remove("open");
  if (b.hasAttribute("data-feed")) { $("#feed").classList.toggle("open"); return; }
  if (!b.dataset.view) return;
  S.connectWizard = false;
  if (b.dataset.view === "setup") { S.setup = S.setup || {}; S.setup.fullFlow = false; S.setup.phase = "scan"; }
  S.view = b.dataset.view; S.openProject = null; render();
});
// PWA (browser / phone only): a new service worker waits until the person clicks Refresh; only that
// click activates it, and the page then reloads once. The desktop app never uses a service worker:
// old workers and caches from earlier versions (or another program on the same port) are removed,
// because a stale worker there caused a reload loop in v0.3.1.
let swRefreshing = false;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  if (window.ccDesktop?.desktop) {
    navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {});
    if (window.caches) caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("cc-shell-")).map((k) => caches.delete(k)))).catch(() => {});
  } else {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      const offer = (w) => { if (w && navigator.serviceWorker.controller) showRefreshPrompt(w); };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => { if (w.state === "installed") offer(w); }); });
      setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
    }).catch(() => {});
    // reload only when the person asked for it, and only once
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (swRefreshing) { swRefreshing = false; safeReload("new version activated", { manual: true }); } });
  }
}
// Demo mode on: a banner at the top of every screen with one click out. Off: no banner.
// Help > Try demo mode turns it back on (setDemo below).
function renderDemoBanner() {
  let d = $("#demo-bar");
  if (!S.demoBanner) { d?.remove(); return; }
  if (d) return;
  d = document.createElement("div"); d.id = "demo-bar"; d.className = "update-bar demo-bar"; d.setAttribute("role", "status");
  d.innerHTML = `<div><b>${esc(DEMO_BANNER_TEXT)}</b> <span class="dim small">Nothing is spent.</span></div><button class="btn sm primary" type="button" style="margin-left:auto" id="demo-bar-off" data-busy-label="Exiting...">${esc(DEMO_BANNER_ACTION)}</button>`;
  const bar = $("#update-bar"); if (bar) bar.after(d); else document.body.prepend(d);
  $("#demo-bar-off").addEventListener("click", () => setDemo(false));
}
async function setDemo(on) {
  try {
    const r = await api("/demo", { method: "POST", body: { on } });
    S.demo = r.demo;
    toast(on ? "Demo mode is on: three pretend AIs, nothing is spent." : "Demo mode is off.");
    await refresh();
  } catch (e) { toast(e.message, true); }
}
function showRefreshPrompt(worker) {
  if ($("#sw-refresh")) return;
  const d = document.createElement("div"); d.id = "sw-refresh"; d.className = "update-bar"; d.setAttribute("role", "status");
  d.innerHTML = `<span>↑</span><div><b>New version available</b></div><button class="btn sm primary" style="margin-left:auto" id="sw-refresh-go">Refresh</button><button class="ghost small" id="sw-refresh-later">later</button>`;
  const bar = $("#update-bar"); if (bar) bar.after(d); else document.body.prepend(d);
  $("#sw-refresh-go").addEventListener("click", () => { if (worker) { swRefreshing = true; worker.postMessage({ type: "SKIP_WAITING" }); setTimeout(() => { if (swRefreshing) safeReload("refresh clicked", { manual: true }); }, 3000); } else safeReload("refresh clicked", { manual: true }); });
  $("#sw-refresh-later").addEventListener("click", () => d.remove());
}
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; const b = document.createElement("button"); b.className = "btn sm"; b.textContent = "Install app"; b.style.marginLeft = "4px"; b.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; b.remove(); }; $(".top-right").prepend(b); });
// the clock shows minutes, so the page is only touched when the minute changes
setInterval(() => { const c = $("#clock"), t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); if (c && c.textContent !== t) c.textContent = t; }, 1000);

// ----- sign-in gate (hosted mode) -----
function renderGate(message = "") {
  const g = $("#gate"); g.style.display = "";
  $("#app").style.visibility = "hidden";
  const unreachable = !CONFIG.supabase;
  g.innerHTML = `<div class="gate-card">
    <div class="brand" style="justify-content:center;margin-bottom:6px"><span class="brand-mark"></span><span class="brand-name" title="Take command of all your AIs.">Meldmind</span></div>
    <div class="muted small" style="text-align:center;margin-bottom:18px">${unreachable ? `Cannot reach the hub at <span class="mono">${esc(hubAddress())}</span>.` : `Sign in to your hub at <span class="mono">${esc(hubAddress())}</span>`}</div>
    ${tipHtml(localStorage)}
    ${unreachable ? "" : `<label class="lbl">Email</label>
    <form id="gate-form" class="row" style="gap:8px"><input type="email" id="gate-email" aria-label="Email" requiredplaceholder="you@example.com" style="flex:1" autocomplete="email" value="${esc(localStorage.getItem("cc.email") || "")}"><button class="btn primary" type="submit" id="gate-go">Email me a sign-in link</button></form>
    <div class="small muted" style="margin-top:10px">No password. We email you a link; open it on this device and you are in. New here? The same link creates your account.</div>
    ${(CONFIG.sso || []).length ? `<div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">${CONFIG.sso.map((p) => `<button class="btn" type="button" data-sso="${esc(p.id)}" style="flex:1">Continue with ${esc(p.name)}</button>`).join("")}</div>
    <div class="small muted" style="margin-top:6px">Your team may ask you to use your work Google or Microsoft account.</div>` : ""}`}
    <div class="dim small" style="text-align:center;margin-top:16px">Meldmind, an Everborn product by Everborn Productions<br>Take command of all your AIs.</div>
    <div id="gate-msg" class="small" role="status" style="margin-top:12px;min-height:18px;color:${message ? "var(--amber)" : "var(--green)"}">${esc(message)}</div>
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
    } catch (err) { $("#gate-msg").style.color = "var(--red)"; $("#gate-msg").textContent = err instanceof TypeError ? "Could not reach the sign-in service. Check the connection and try again." : err.message; b.disabled = false; b.textContent = "Email me a sign-in link"; }
  });
  // Google / Microsoft sign-in (Phase 24): the hub sends the browser to Supabase Auth and back here with the session
  $$("[data-sso]", g).forEach((b) => b.addEventListener("click", () => {
    const back = location.origin + location.pathname;
    location.href = HUB && HUB !== location.origin
      ? `${CONFIG.supabase.url}/auth/v1/authorize?${new URLSearchParams({ provider: b.dataset.sso, redirect_to: back, scopes: "openid email profile" })}`
      : `/api/sso/start?${new URLSearchParams({ provider: b.dataset.sso, redirect: back })}`;
  }));
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
installClickTracking(document);
window.CC = { ask: askText, withBusy, get S() { return S; }, get state() { return S; }, get graph() { return graph; }, renderOps: () => renderOps(), openRun, api, apiBlobUrl, downloadBlob, toast, md, esc, money, fmtN, ago, favicon, P, pname, pcolor, $, $$, render, refresh, renderOutput, confirmRisky, renderSubscriptionsCore: (v) => renderSubscriptions(v), uiMode: () => S.uiMode || "simple", askingMode: () => !!S.askMode, navBack: () => goBackView(), openProviderSetup: (id) => openProviderSetup(id), flag: (name) => name === "flag_navstate" ? isNavStateEnabled(S) : Boolean(S.flags?.[name] ?? S.settings?.[name]), continueProject, setWorkingProject, syncProjectBar, go: (view) => { S.view = view; S.openProject = null; render(); }, updateBoxHtml: () => updateBoxHtml(), renderUpdateBox: () => renderUpdateBox(), openSettings: (focus) => { S.connectWizard = false; S.openProject = null; S.navMenu = groupFor("settings"); openSettingsMore(focus); }, restartFullSetup: () => restartFullSetup(), guideBuiltins: ["hub", "council", "mission", "phone", "whats-new"], passwordTipHtml: () => tipHtml(localStorage) };
installPasswordTip(document, localStorage);
import("/features/index.js").then(() => { if (S.providers.length) render(); }).catch((e) => console.warn("[features]", e));
boot();

// ----- Setup (first run) -----
function restartFullSetup() {
  S.connectWizard = false;
  S.setup = {
    ...(S.setup || {}),
    step: 1,
    result: null,
    busy: false,
    phase: setupPhase({ fresh: false, fullRestart: true }),
    fullFlow: true,
    afterScan: "",
  };
  S.firstRunDone = true;
  S.view = "setup";
  window.CC?.tour?.sync?.();
  render();
}
async function advanceFromScanToConnections() {
  if (S.setup) {
    S.setup.fullFlow = false;
    S.setup.phase = "";
  }
  try {
    const saved = await api("/setup/done", { method: "POST" });
    S.settings = { ...(S.settings || {}), ...(saved || {}), onboarded: true };
    if (saved?.sampleProject) {
      const sp = saved.sampleProject;
      S.projects = Array.isArray(S.projects) ? S.projects.filter((p) => p.id !== sp.id).concat([sp]) : [sp];
      if (!S.project) {
        S.project = sp.id;
        try { localStorage.setItem("cc.project", sp.id); } catch {}
      }
      if (!S.lastOrders && sp.starterPrompt) S.lastOrders = sp.starterPrompt;
    }
    if (S.onboarding) S.onboarding.show = false;
    S.visitedSetup = true;
  } catch (e) { toast(e.message, true); }
  if (window.CC.connectSetup?.open) {
    await window.CC.connectSetup.open();
  } else {
    S.connectWizard = true;
    S.visitedConnect = true;
    S.view = "setup";
    render();
  }
}
async function saveShareChoice() {
  const st = S.setup;
  const on = !!$("#su-share")?.checked;
  if (st) st.shareOptIn = on;
  if (!st || on === !!st.shareSaved) return;
  await api("/brain/settings", { method: "POST", body: { shareOptIn: on } });
  st.shareSaved = on;
}
async function saveNewsChoice() {
  if (S.setup?.newsOptIn !== true) return;
  await api("/community/newsletter", { method: "POST", body: { optedIn: true } });
}
async function saveSetupUsername(useDefault) {
  const st = S.setup;
  const input = $("#su-username");
  const suggestion = input?.dataset.suggestion || st?.usernameDefault || "";
  const typed = input?.value?.trim() || "";
  const saved = st?.usernameSaved || "";
  if (saved) {
    if (useDefault || !st?.usernameTouched || !typed || typed === saved) return;
    if (!confirm(`Change your saved username from "${saved}" to "${typed}"?`)) return;
  }
  const username = useDefault ? (suggestion || typed) : (typed || suggestion);
  if (!username) return;
  await api("/account/username", { method: "POST", body: { username } });
}
function setupState() {
  // Track records start off here too. The server keeps the person's saved choice (privacy rule, 0.4.17).
  const st = S.setup || (S.setup = { step: 1, history: false, keys: true, bookmarks: true, desktop: false, days: 180, result: null, busy: false, shareOptIn: false, shareSaved: false, newsOptIn: false });
  if (st.history === undefined) st.history = false;
  if (typeof st.newsOptIn !== "boolean") st.newsOptIn = false;
  if (!st.phase) {
    const fresh = isFreshInstall({ onboarding: S.onboarding, settings: S.settings });
    st.phase = setupPhase({ fresh, expertSetup: S.settings?.expertSetup || null });
    if (st.phase === "scan" && S.settings?.expertSetup?.pendingScan) st.afterScan = "expert";
  }
  return st;
}
// One welcome screen instead of five stops: look, text size, first AI, apps, and a slot for
// later steps, with Skip setup on top. Decision 20 is unchanged: finishing writes the
// onboarding flag, so this shows once.
function welcomeLookHtml() {
  const mode = S.uiMode === "expert" ? "expert" : "simple";
  const current = document.documentElement.dataset.text || "default";
  return `<div class="welcome-block" id="su-look"><h3>${esc(WELCOME.lookTitle)}</h3>
    <div class="seg" id="su-mode" role="group" aria-label="Simple or Expert">
      <button type="button" data-ui-pick="simple" class="${mode === "simple" ? "on" : ""}" aria-pressed="${mode === "simple"}">${esc(MODE_STEP.simple)}</button>
      <button type="button" data-ui-pick="expert" class="${mode === "expert" ? "on" : ""}" aria-pressed="${mode === "expert"}">${esc(MODE_STEP.expert)}</button>
    </div>
    <div class="dim small" style="margin-top:6px">${esc(mode === "expert" ? MODE_STEP.expertLine : MODE_STEP.simpleLine)} ${esc(MODE_STEP.note)}</div>
    ${mode === "expert" ? `<div class="dim small" style="margin-top:4px">Expert extras (find AI keys on this PC, browser history, bookmarks) are in the Settings menu under Find my AIs.</div>` : ""}
    <div class="lbl" style="margin-top:12px">${esc(WELCOME.textTitle)}</div>
    <div class="row" id="su-text-sizes" style="gap:8px;flex-wrap:wrap">${TEXT_SIZES.map(([id, label]) => `<button type="button" class="btn sm ${current === id ? "primary" : ""}" data-text="${id}" aria-pressed="${current === id}">${label}</button>`).join("")}<span class="small" id="su-text-preview">This is how text looks.</span></div>
  </div>`;
}
function welcomeAiHtml(st) {
  const keyed = !!P("openrouter")?.keyed;
  const connectedNames = (S.providers || []).filter((p) => p.keyed && !p.demo).map((p) => p.name);
  const envDetected = Object.keys(st.detectedKeys || {}).map((id) => pname(id)).filter((n) => !connectedNames.includes(n));
  const cliDetected = (st.detectedCli || S.cli || []).filter(Boolean);
  const detectedList = [...new Set([...connectedNames, ...envDetected, ...cliDetected])];
  const detectedRow = detectedList.length ? `<div class="route small" id="su-detected-ais" style="margin-bottom:10px"><b>Detected on this PC:</b> ${detectedList.map((n) => `<span class="chip green" style="margin-left:4px">${esc(n)}</span>`).join("")}</div>` : `<div class="dim small" id="su-detected-ais" style="margin-bottom:8px">Detected on this PC: checking for connected AIs and keys...</div>`;
  return `<div class="welcome-block" id="su-ai"><h3>${esc(WELCOME.aiTitle)}</h3>
    ${detectedRow}
    <button type="button" class="btn primary" id="su-try">${esc(WELCOME.tryIt)}</button>
    <div class="dim small" style="margin-top:6px">${esc(WELCOME.tryLine)}</div>
    <div class="lbl" style="margin-top:12px">${esc(WELCOME.keyLabel)}</div>
    ${keyed ? `<span class="chip green">OpenRouter connected</span>` : `<div class="row" style="gap:8px;flex-wrap:wrap">
      <input type="password" id="su-or-key" autocomplete="off" placeholder="sk-or-..." aria-label="OpenRouter key" value="${esc(st.orKey || "")}" style="flex:1;min-width:12rem">
      <button type="button" class="btn sm" id="su-or-save">Save key</button>
      <a class="btn sm" href="https://openrouter.ai/keys" target="_blank" rel="noopener">${esc(WELCOME.getKey)}</a>
    </div>`}
    <div class="dim small" style="margin-top:6px">${esc(WELCOME.keyLine)} One key from one AI company gives one AI. A council needs two AI companies, or one OpenRouter key.</div>
  </div>`;
}
function welcomeAppsHtml() {
  const body = window.CC.appSignIn?.html ? window.CC.appSignIn.html({ providers: ["google", "microsoft"] }) : `<div class="dim small">Loading sign-in buttons...</div>`;
  return `<div class="welcome-block" id="su-apps-signin"><h3>${esc(WELCOME.appsTitle)}</h3><div class="dim small" style="margin-bottom:8px">${esc(WELCOME.appsLine)}</div><div id="su-signin-box">${body}</div></div>`;
}
async function saveWelcomeKey(st) {
  const key = ($("#su-or-key")?.value || st.orKey || "").trim();
  if (!key) return false;
  if (P("openrouter")?.keyed && !confirm("An OpenRouter key is already saved in the vault. Replace it?")) return false;
  const r = await api("/keys", { method: "POST", body: { provider: "openrouter", key } });
  st.orKey = "";
  keyToast("openrouter", r);
  await refresh();
  return true;
}
function openPrivacyList() {
  if (window.CC.openPrivacy) return window.CC.openPrivacy();
  import("/features/privacy.js").then((m) => (window.CC.openPrivacy || m.openPrivacy)?.()).catch((e) => toast(e.message, true));
}
function renderWelcome(v, st) {
  if (!st.privacyKnown && !st.privacyLoading) {
    st.privacyLoading = true;
    api("/privacy").then((d) => {
      if (!st.qualityTouched && typeof d?.levels?.qualitySignals === "boolean") st.qualitySignals = d.levels.qualitySignals;
      if (!st.contentTouched) st.contentOptIn = d?.levels?.contentOptIn === true;
      st.privacyKnown = true;
      if (S.view === "setup" && st.phase === "welcome") render();
    }).catch(() => { st.privacyKnown = true; }).finally(() => { st.privacyLoading = false; });
  }
  if (!st.detectChecked && !st.detectLoading) {
    st.detectLoading = true;
    api("/setup/detect").then((d) => { st.detectedKeys = d?.keys || {}; st.detectedCli = d?.cli || []; st.detectChecked = true; if (S.view === "setup" && st.phase === "welcome") render(); }).catch(() => { st.detectChecked = true; }).finally(() => { st.detectLoading = false; });
  }
  const qualityChecked = typeof st.qualitySignals === "boolean" ? st.qualitySignals : true;
  const contentChecked = st.contentOptIn === true;
  v.innerHTML = `<div class="welcome" id="su-welcome">
    <div class="panel" style="padding:22px">
      <div class="row" style="align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:14rem"><h2 style="margin:0 0 4px;font-size:22px">${esc(WELCOME.title)}</h2><div class="muted">${esc(WELCOME.lead)}</div></div>
        <button type="button" class="btn" id="su-skip-all">${esc(WELCOME.skip)}</button>
      </div>
      <div class="welcome-grid">
        ${welcomeLookHtml()}
        ${welcomeAiHtml(st)}
        ${welcomeAppsHtml()}
        <!-- Reserved slot: 0.4.16 adds "Backup when credits run out" here with CC.register({ welcome: { order, render(el) } }). -->
        <section class="welcome-slot" id="su-backup-slot" data-slot="credit-backup" aria-label="More setup"></section>
      </div>
      <div class="welcome-block" id="su-privacy-box" style="margin-top:14px">
        <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start">
          <input type="checkbox" id="su-quality-signals" ${qualityChecked ? "checked" : ""}>
          <span><b>${esc(WELCOME.privacyLine)}</b> <span class="dim">${esc(WELCOME.privacyDetail)}</span></span>
        </label>
        <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start;margin-top:8px">
          <input type="checkbox" id="su-content-optin" ${contentChecked ? "checked" : ""}>
          <span><b>${esc(WELCOME.contentOptInLabel)}</b> <span class="dim">${esc(WELCOME.contentOptInLine)}</span></span>
        </label>
      </div>
      <div class="row" style="margin-top:16px;gap:10px;flex-wrap:wrap;align-items:center">
        <span class="dim small">${esc(WELCOME.privacyLine)} <a href="#" id="su-privacy">${esc(WELCOME.privacyLink)}</a></span>
        <button type="button" class="btn primary" id="su-start" style="margin-left:auto">${esc(WELCOME.start)}</button>
      </div>
    </div>
  </div>`;
  $("#su-quality-signals")?.addEventListener("change", (e) => {
    st.qualityTouched = true;
    st.qualitySignals = !!e.target.checked;
    api("/privacy", { method: "POST", body: { qualitySignals: st.qualitySignals, noticeSeen: true } }).catch(() => {});
  });
  $("#su-content-optin")?.addEventListener("change", (e) => {
    st.contentTouched = true;
    st.contentOptIn = !!e.target.checked;
    api("/privacy", { method: "POST", body: { contentOptIn: st.contentOptIn } }).catch(() => {});
  });
  $("#su-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ui-pick]");
    if (!b) return;
    st.orKey = $("#su-or-key")?.value || st.orKey || "";
    setUiMode(b.dataset.uiPick, { fromSetup: true, confirmed: true });
  });
  $("#su-text-sizes").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-text]");
    if (!b) return;
    applyTextSize(b.dataset.text);
    $$("#su-text-sizes button[data-text]").forEach((x) => { const on = x === b; x.classList.toggle("primary", on); x.setAttribute("aria-pressed", String(on)); });
  });
  $("#su-or-key")?.addEventListener("input", (e) => { st.orKey = e.target.value; });
  $("#su-or-key")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#su-or-save")?.click(); } });
  $("#su-or-save")?.addEventListener("click", async () => {
    try { if (!(await saveWelcomeKey(st))) toast("Paste the key first", true); }
    catch (e) { toast(e.message, true); }
  });
  $("#su-try").addEventListener("click", async () => {
    try {
      const r = await api("/demo", { method: "POST", body: { on: true } });
      S.demo = r.demo;
      // Load the practice AIs before chat opens, so the chat never says "No AI connected yet".
      await refresh();
      await finishWelcome();
    } catch (e) { toast(e.message, true); }
  });
  $("#su-skip-all").addEventListener("click", () => finishWelcome({ skipped: true }));
  $("#su-start").addEventListener("click", async () => {
    try { await saveWelcomeKey(st); }
    catch (e) { toast(e.message, true); return; }
    await finishWelcome();
  });
  $("#su-privacy").addEventListener("click", (e) => { e.preventDefault(); openPrivacyList(); });
  const box = $("#su-signin-box");
  const wireSignIn = () => { if (!box?.isConnected || !window.CC.appSignIn) return; box.innerHTML = window.CC.appSignIn.html({ providers: ["google", "microsoft"] }); window.CC.appSignIn.wire(box); };
  if (window.CC.appSignIn) window.CC.appSignIn.wire(box);
  else import("/features/app-signin.js").then(wireSignIn).catch(() => { if (box) box.innerHTML = `<div class="dim small">Sign-in buttons are in Settings.</div>`; });
  // 0.4.16 Backup when API credits run out: the same panel as Settings, in the reserved slot.
  renderExtras("welcome", "#su-backup-slot");
  const slot = $("#su-backup-slot");
  if (slot && window.CC.renderBackupPanel) { const box = document.createElement("div"); box.id = "su-backup"; box.className = "welcome-block"; slot.prepend(box); window.CC.renderBackupPanel(box, { setup: true }); }
}
// Escape skips the welcome screen when the focus is not in a field.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || S.view !== "setup" || S.setup?.phase !== "welcome") return;
  if (document.querySelector("#cc-privacy, [role='dialog']")) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
  finishWelcome({ skipped: true });
});
async function finishWelcome({ skipped = false } = {}) {
  // Simple is the default. Saving it here keeps a later launch from asking again.
  if (!S.settings?.uiModeChosen) {
    const mode = S.uiMode === "expert" ? "expert" : "simple";
    S.settings = { ...(S.settings || {}), uiMode: mode, uiModeChosen: true };
    api("/settings", { method: "POST", body: { uiMode: mode, uiModeChosen: true } }).catch(() => {});
  }
  if (S.setup?.fullFlow) {
    S.setup.phase = nextRestartPhase("welcome");
    S.setup.step = 1;
    S.setup.result = null;
    S.firstRunDone = true;
    S.connectWizard = false;
    S.view = "setup";
    window.CC?.tour?.sync?.();
    render();
    return;
  }
  await finishAiSetup("command", { quiet: skipped });
}
function applyTextSize(id) {
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem("cc.a11y") || "{}"); } catch {}
  const next = { textSize: id, contrast: !!prev.contrast };
  try { localStorage.setItem("cc.a11y", JSON.stringify(next)); } catch {}
  window.__ccTextChosen = true;
  document.documentElement.dataset.text = id;
  window.CC.a11y?.apply?.(next, { user: true });
  api("/a11y", { method: "POST", body: next }).catch(() => {});
}
async function saveExpert(patch) {
  const expertSetup = { ...(S.settings?.expertSetup || {}), ...patch };
  S.settings = { ...(S.settings || {}), expertSetup };
  try {
    const saved = await api("/settings", { method: "POST", body: { expertSetup } });
    if (saved && typeof saved === "object") S.settings = { ...S.settings, ...saved, expertSetup };
  } catch (e) { toast(e.message, true); }
}
function renderExpertExtra(v, st) {
  const stepId = st.expertStep || S.settings?.expertSetup?.step || "ais";
  const i = Math.max(0, EXPERT_SETUP.findIndex((s) => s.id === stepId));
  const step = EXPERT_SETUP[i];
  const last = i === EXPERT_SETUP.length - 1;
  v.innerHTML = `<div style="max-width:760px;margin:0 auto"><div class="panel" style="padding:26px">
    <div class="dim small">Expert setup ${i + 1} of ${EXPERT_SETUP.length}. You can skip this.</div>
    <h2 style="margin:6px 0;font-size:22px">${esc(step.title)}</h2>
    <div class="muted">${esc(step.body)}</div>
    ${step.id === "ais" ? `<div style="margin-top:14px">${openRouterStartCard()}${anyKeyHtml()}</div>` : ""}
    ${step.id === "integrations" ? `<div class="row" style="margin-top:14px"><button class="btn sm" type="button" id="ex-connect">Get everything connected</button></div>` : ""}
    ${step.id === "backup" ? `<div id="ex-backup" style="margin-top:14px"><div class="dim small">Checking this PC...</div></div>` : ""}
    ${step.id === "profile" ? `<div style="margin-top:14px"><div class="dim small">Every field is optional. You can fill this in later under Pro prompts.</div><button class="btn sm" type="button" id="ex-profile" style="margin-top:8px">Open business profile</button></div>` : ""}
    <div class="row" style="margin-top:18px"><button class="btn" type="button" id="ex-skip">Skip</button><button class="btn primary" type="button" id="ex-next" style="margin-left:auto">${last ? "Finish" : "Next"}</button></div>
  </div></div>`;
  if (step.id === "ais") { wireOpenRouterStart(v); wireAnyKey(v); }
  if (step.id === "backup") window.CC.renderBackupPanel?.($("#ex-backup"), { setup: true });
  $("#ex-profile")?.addEventListener("click", () => { S.view = "prompts"; render(); });
  $("#ex-connect")?.addEventListener("click", async () => {
    try {
      const offer = await api("/connectsetup/begin", { method: "POST" });
      S.connectSetup = offer;
      S.connectWizard = true;
      S.visitedConnect = true;
      await saveExpert({ step: "integrations", done: true, skipped: false });
      S.view = "setup";
      render();
    } catch (e) { toast(e.message, true); }
  });
  $("#ex-skip").addEventListener("click", async () => { await saveExpert({ step: step.id, skipped: true, done: true }); finishAiSetup("command"); });
  $("#ex-next").addEventListener("click", async () => {
    if (!last) {
      const next = EXPERT_SETUP[i + 1].id;
      st.expertStep = next;
      await saveExpert({ step: next, done: false, skipped: false });
      render();
      return;
    }
    await saveExpert({ step: step.id, done: true, skipped: false });
    finishAiSetup("command");
  });
}
function renderSetup(v) {
  const st = setupState();
  if (st.desktop === undefined) st.desktop = false;
  if (st.phase === "welcome") return renderWelcome(v, st);
  if (st.phase === "expert") return renderExpertExtra(v, st);
  if (!st.shareKnown && !st.shareLoading) {
    st.shareLoading = true;
    api("/brain/settings").then((d) => {
      if (st.shareTouched) return;
      st.shareOptIn = !!d?.settings?.shareOptIn;
      st.shareSaved = st.shareOptIn;
      st.shareKnown = true;
      if (S.view === "setup" && !S.connectWizard && !st.result) render();
    }).catch(() => { st.shareKnown = true; }).finally(() => { st.shareLoading = false; });
  }
  if (!st.usernameKnown && !st.usernameLoading) {
    st.usernameLoading = true;
    api("/account").then((d) => {
      st.usernameSaved = d?.username || "";
      st.usernameDefault = d?.username || d?.suggestion || "";
      if (!st.usernameTouched) st.usernameValue = st.usernameDefault;
      st.usernameKnown = true;
      if (S.view === "setup" && !S.connectWizard && !st.result) render();
    }).catch(() => { st.usernameKnown = true; }).finally(() => { st.usernameLoading = false; });
  }
  if (st.step === 1 || !st.result) {
    v.innerHTML = `<div style="max-width:860px;margin:0 auto">
      <div class="panel" style="padding:26px">
        <div class="row" style="gap:14px;align-items:flex-start"><span class="brand-mark" style="margin-top:6px"></span><div>
          <h2 style="margin:0 0 6px;font-size:22px">Let's connect the AIs you already use</h2>
          <div class="muted">These steps are optional. The scans below run on this PC only; nothing from them is uploaded.</div>
          <div class="dim small" style="margin-top:8px">Claude, ChatGPT, Grok and Gemini need an API key, or an OpenRouter key, to take part in the council. An MCP server does not take their place there. Tools such as Kling can use an API key or an MCP server. You make that choice in the guided setup, and you can switch later in Settings.</div></div></div>
        <div id="su-share-block" style="margin-top:18px">
          <label class="route row" id="su-share-row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-share" ${st.shareOptIn ? "checked" : ""} style="margin-top:4px"><div><b>I am willing to share anonymous track records</b><div class="dim small">Meldmind learns from every job you run. Anonymous track records (the task type, which AI, and the score) help it pick the best AI for everyone. We never share prompts, content, or keys. You can change this any time in Settings.</div><div class="dim small" id="su-share-note" ${st.shareOptIn ? "hidden" : ""} style="margin-top:6px">Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share.</div></div></label>
          <div class="small" style="margin-top:6px"><a href="#what-we-share" id="su-share-what">What we share</a></div>
        </div>
        <div id="su-news-block" style="margin-top:14px">
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-news" ${st.newsOptIn ? "checked" : ""} style="margin-top:4px"><div><b>Email me the weekly AI News note</b><div class="dim small">Off until you tick this. The app writes a copy of the weekly note. It does not send email. You can change this any time in Settings.</div></div></label>
        </div>
        <div id="su-username-block" style="margin-top:14px">
          <label>Public username <input id="su-username" maxlength="20" autocomplete="off" aria-label="Public username" data-suggestion="${esc(st.usernameDefault || "")}" value="${esc(st.usernameValue || "")}"></label>
          <div class="dim small">A friendly name is suggested. Skip keeps that name. People see it in chat, on shared prompts, in the Builders gallery, and on AI News. Your email is not shown. You can change it in Settings.</div>
        </div>
        <div class="grid" style="margin-top:22px;gap:12px">
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-h" ${st.history ? "checked" : ""} style="margin-top:4px"><div><b>Look at my browser history to find the AIs and creative tools I use</b><div class="dim small">Reads Chrome / Edge / Brave history files locally for the last <input type="number" id="su-days" value="${st.days}" style="width:64px;padding:2px 6px;display:inline"> days, counts visits to known AI sites, then deletes the temporary copy. You see the list and choose what to connect.</div></div></label>
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-k" ${st.keys ? "checked" : ""} style="margin-top:4px"><div><b>Check whether any AI API keys are already on this PC</b><div class="dim small">Looks at environment variables such as ANTHROPIC_API_KEY or OPENAI_API_KEY. Found keys are shown masked; you decide which to import into the sealed vault.</div></div></label>
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-b" ${st.bookmarks ? "checked" : ""} style="margin-top:4px"><div><b>Organize my AI bookmarks</b><div class="dim small">Builds a "🤖 AI" bookmark folder (chat, video, music, dev, billing pages) from what was found. You can download it as an import file or let the app add it to Chrome directly (that closes and reopens Chrome). The next page also offers to sort the bookmarks you already have into folders by topic, with a preview before anything changes.</div></div></label>
          <label class="route row" style="gap:14px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="su-desktop" ${S.license?.limits?.appScan && st.desktop ? "checked" : ""} ${S.license?.limits?.appScan ? "" : "disabled"} style="margin-top:4px"><div><b>Let Meldmind use your desktop</b><div class="dim small">${S.license?.limits?.appScan ? "Lists installed programs by name. On Windows that is the uninstall list and the Start menu, plus command-line tools on PATH. File contents are not read. You allow each app on the next page. Nothing is installed or bought." : "Program scan is part of Pro. Add a license key in Settings. Nothing is installed or bought."}</div></div></label>
        </div>
        <div class="panel" id="su-desktop-card" style="margin-top:16px">
          <h3 style="margin:0 0 6px">Let Meldmind use your desktop</h3>
          <div class="dim small">Meldmind can use apps on this PC that have no API, after you allow each one. You confirm before a send, a buy, or a delete. A banner says Meldmind is using that app, with Stop. Passwords are not stored. Google Antigravity is the first app. Install and connect runs Google's installer, then opens sign-in in your browser. You sign in once. Skip this and change it later in Settings.</div>
          ${S.license?.limits?.desktop ? `<div class="row" style="margin-top:10px">
            <button class="btn sm primary" id="su-agy-allow" type="button">Allow Antigravity</button>
            ${(S.cli || []).some((x) => /antigravity|agy/i.test(x)) || P("antigravity")?.status?.status === "green" ? `<span class="chip green" id="su-agy-connected">Antigravity connected</span>` : `<button class="btn sm" id="su-agy-install" type="button">Install and connect</button>`}
          </div>` : `<div class="dim small" style="margin-top:8px">Desktop control is part of Pro. Add a license key in Settings.</div>`}
        </div>
        <div id="su-prompts" style="margin-top:16px"></div>
        <div class="row" style="margin-top:22px"><button class="btn primary" id="su-go" ${st.busy ? "disabled" : ""}>${st.busy ? "Scanning…" : "Start"}</button><button class="btn" id="su-skip">Skip, I'll add keys myself</button><span class="dim small" style="margin-left:auto">You can run this again from Settings.</span></div>
      </div></div>`;
    $("#su-share")?.addEventListener("change", () => {
      st.shareTouched = true;
      st.shareOptIn = !!$("#su-share").checked;
      const note = $("#su-share-note");
      if (note) note.hidden = st.shareOptIn;
    });
    $("#su-news")?.addEventListener("change", () => { st.newsOptIn = !!$("#su-news").checked; });
    $("#su-username")?.addEventListener("input", () => {
      st.usernameTouched = true;
      st.usernameValue = $("#su-username").value;
    });
    $("#su-share-what")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      S.helpArticle = "getting-started";
      S.view = "help";
      render();
    });
    $("#su-go").addEventListener("click", async () => {
      st.history = $("#su-h").checked; st.keys = $("#su-k").checked; st.bookmarks = $("#su-b").checked; st.desktop = !!$("#su-desktop")?.checked; st.days = Number($("#su-days").value) || 180;
      st.newsOptIn = !!$("#su-news")?.checked;
      st.usernameValue = $("#su-username")?.value ?? st.usernameValue ?? "";
      st.busy = true; render();
      try {
        await saveSetupUsername(false);
        await saveShareChoice();
        await saveNewsChoice();
        st.result = await api("/setup/scan", { method: "POST", body: { history: st.history, keys: st.keys, days: st.days } });
        if (st.desktop && S.license?.limits?.appScan) {
          try { await api("/apps/opt-in", { method: "POST", body: { on: true } }); }
          catch (e) { toast(e.message, true); }
        }
        st.step = 2;
      }
      catch (e) { toast(e.message, true); }
      st.busy = false; render();
    });
    $("#su-agy-allow")?.addEventListener("click", async () => {
      try { await api("/antigravity/allow", { method: "POST", body: { allow: true } }); toast("Antigravity is allowed. Change this any time in Settings."); }
      catch (e) { toast(e.message, true); }
    });
    $("#su-agy-install")?.addEventListener("click", async () => {
      if (!window.confirm("Install Antigravity with Google's installer, then open sign-in in your browser? Meldmind does not see your password.")) return;
      try {
        const r = await api("/antigravity/install", { method: "POST", body: { confirm: true } });
        toast(r.message || "Installer finished", !r.ok);
        if (r.ok) {
          await api("/antigravity/allow", { method: "POST", body: { allow: true } });
          const s = await api("/antigravity/signin", { method: "POST", body: { confirm: true } });
          toast(s.message || "Sign-in opened", !s.ok);
        }
      } catch (e) { toast(e.message, true); }
    });
    $("#su-skip").addEventListener("click", async () => {
      st.newsOptIn = !!$("#su-news")?.checked;
      try { await saveSetupUsername(true); }
      catch (e) { toast(e.message, true); }
      try { await saveShareChoice(); await saveNewsChoice(); }
      catch (e) { toast(e.message, true); return; }
      if (st.fullFlow) { await advanceFromScanToConnections(); return; }
      finishAiSetup("settings");
    });
    window.CC.mountPromptInterview?.($("#su-prompts"));
    return;
  }
  const r = st.result, scan = r.scan, keys = r.keys || {};
  const provRows = (scan?.providers || []).map((e) => {
    const p = P(e.provider); const k = keys[e.provider];
    const linked = p?.keyed;
    return `<div class="route" style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border-left:3px solid ${p?.color || "#4b5563"}">
      <div><b>${esc(e.name)}</b> <span class="dim small">· ${fmtN(e.visits)} visits · last ${ago(e.lastVisit)} ago · ${esc(e.profiles.join(", "))}</span>
        <div class="small" style="margin-top:4px">${linked || p?.connect?.mcp?.configured ? `<span class="chip green">linked ✓</span>` : k ? `<span class="chip violet">key found on this PC (${esc(k.source)}, ${esc(k.masked)})</span>` : p?.connect?.both ? `<span class="chip">API key or MCP</span>` : p?.hasApi ? `<span class="chip">needs an API key</span>` : `<span class="chip">no public API · tracked by credits</span>`}${p?.connect?.council ? `<div class="dim" style="margin-top:4px">${esc(p.connect.note)}</div>` : ""}${p?.connect?.both ? `<div class="dim" style="margin-top:4px">Active: ${p.connect.active === "mcp" ? "MCP" : "API key"}. Switch any time.</div>` : ""}</div></div>
      <div class="row" style="justify-content:flex-end">
        ${!linked && k ? `<button class="btn sm primary" data-import="${e.provider}">Import key</button>` : ""}
        ${!linked && (p?.hasApi || p?.connect?.both) ? `<button class="btn sm" data-open="${e.provider}">Open key page</button><input type="password" placeholder="paste key" data-paste="${e.provider}" style="width:170px;padding:5px 8px"><button class="btn sm" data-savek="${e.provider}">Save</button>` : ""}
        ${p?.connect?.both ? `<button class="btn sm" data-setup-mcp="${e.provider}">Connect with MCP</button><button class="btn sm" data-setup-key="${e.provider}">Connect with API key</button>` : ""}
        ${p && !p.hasApi && !p.connect?.both ? `<button class="btn sm" data-track='${esc(JSON.stringify({ name: e.name, provider: e.provider, url: e.url, visits: e.visits }))}'>Track credits</button>` : ""}
      </div></div>`; }).join("");
  const toolRows = (scan?.tools || []).map((e) => `<label class="row small" style="padding:4px 0"><input type="checkbox" data-tool='${esc(JSON.stringify({ name: e.name, url: e.url, visits: e.visits }))}'> <b>${esc(e.name)}</b> <span class="dim">· ${fmtN(e.visits)} visits · ${esc(e.cat)}</span></label>`).join("");
  const folder = r.folder || [];
  const profiles = r.profiles || [];
  v.innerHTML = `<div style="max-width:980px;margin:0 auto" class="grid">
    <div class="panel"><h3>AIs you use <span class="right">${scan ? `${scan.days} days · ${scan.scanned.length} browser profile${scan.scanned.length === 1 ? "" : "s"} scanned` : "history scan skipped"}</span></h3>
      ${openRouterStartCard()}
      <div class="dim small" style="margin-top:10px">Other keys are optional.</div>
      <div class="grid" style="gap:8px;margin-top:8px">${provRows || `<div class="empty">No known AI sites found in the history window. Add keys in Settings instead.</div>`}</div>
      ${anyKeyHtml()}
      <div class="dim small" style="margin-top:8px">Not listed? Paste the key above, or add any provider (Google Gemini, OpenRouter, Groq, Ollama...) in <a href="#" id="setup-settings">Settings</a>. "Open key page" opens the provider's API-key page in your browser. Copy the key, paste it here, Save. Keys are sealed by the operating system (${esc(S.vault?.method || "Windows DPAPI")}) and never leave this PC.</div></div>
    ${toolRows ? `<div class="panel"><h3>Other AI &amp; creative tools found <span class="right">tick to track as subscriptions</span></h3><div class="row" style="margin-bottom:6px;gap:8px;align-items:center">${isNavStateEnabled(S) ? `<button type="button" class="btn sm" id="su-tools-toggle" data-setup-tools-toggle="1">Select All</button><span class="dim small">Toggle all discovered tools</span>` : ""}</div>${toolRows}<div class="row" style="margin-top:8px"><button class="btn sm" id="su-track">Track selected</button></div></div>` : ""}
    ${st.bookmarks && folder.length ? `<div class="panel"><h3>Your AI bookmark folder <span class="right">${folder.reduce((a, c) => a + c.links.length, 0)} links</span></h3>
      <div class="grid cols-3" style="gap:10px">${folder.map((c) => `<div><div class="cat-h" style="margin:4px 0 6px">${esc(c.name)}</div>${c.links.map((l) => `<div class="small" style="padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><img src="${favicon(l.url)}" style="width:12px;height:12px;vertical-align:-1px;margin-right:6px">${esc(l.name)}</div>`).join("")}</div>`).join("")}</div>
      <div class="row" style="margin-top:14px"><button class="btn sm" id="su-dl">Download import file</button>
        <select id="su-prof" style="width:auto">${profiles.map((x) => `<option value="${x.browser}|${x.dir}" ${x.synced ? "disabled" : ""}>${esc(x.browserName)} · ${esc(x.name)}${x.email ? ` (${esc(x.email)})` : ""}${x.synced ? " · synced, use import" : ""}</option>`).join("")}</select>
        <button class="btn sm primary" id="su-apply">Add to this browser now</button><span class="dim small">closes and reopens the browser, keeps your tabs, backs up first</span></div></div>` : ""}
    ${st.bookmarks ? `<div id="su-extras"></div>` : ""}
    <div id="su-apps"></div>
    <div class="row"><button class="btn" id="su-back">← Back</button><button class="btn primary" id="su-done" style="margin-left:auto">Finish setup</button></div></div>`;
  $$("[data-import]", v).forEach((b) => b.addEventListener("click", async () => { const r2 = await api("/setup/import-keys", { method: "POST", body: { providers: [b.dataset.import] } }); toast(r2.imported.length ? `${pname(b.dataset.import)} linked` : "Nothing imported", !r2.imported.length); await refresh(); }));
  $$("[data-setup-mcp]", v).forEach((b) => b.addEventListener("click", () => window.CC.keysetup?.open?.(b.dataset.setupMcp, { mode: "mcp" })));
  $$("[data-setup-key]", v).forEach((b) => b.addEventListener("click", () => window.CC.keysetup?.open?.(b.dataset.setupKey, { mode: "key" })));
  $$("[data-open]", v).forEach((b) => b.addEventListener("click", async () => { const r2 = await api("/setup/open", { method: "POST", body: { provider: b.dataset.open } }); toast(`Opened ${r2.url}`); }));
  wireOpenRouterStart(v);
  wireAnyKey(v);
  renderExtras("setup", "#su-extras");
  renderFeature("setup", "apps", "#su-apps");
  $("#setup-settings", v)?.addEventListener("click", (e) => { e.preventDefault(); S.view = "settings"; render(); });
  $$("[data-savek]", v).forEach((b) => b.addEventListener("click", async () => { const key = $(`[data-paste="${b.dataset.savek}"]`, v).value.trim(); if (!key) return toast("Paste the key first", true); if (P(b.dataset.savek)?.keyed && !confirm(`A ${pname(b.dataset.savek)} key is already saved in the vault. Replace it?`)) return; b.textContent = "…"; try { const r2 = await api("/keys", { method: "POST", body: { provider: b.dataset.savek, key } }); keyToast(b.dataset.savek, r2); await refresh(); } catch (e) { toast(e.message, true); b.textContent = "Save"; } }));
  $$("[data-track]", v).forEach((b) => b.addEventListener("click", async () => { try { await api("/setup/track", { method: "POST", body: { tools: [JSON.parse(b.dataset.track)] } }); toast("Added to Subscriptions"); await refresh(); } catch (e) { toast(e.message, true); } }));
  $("#su-track")?.addEventListener("click", async () => { const tools = $$("[data-tool]:checked", v).map((c) => JSON.parse(c.dataset.tool)); if (!tools.length) return toast("Tick a tool first", true); try { const r2 = await api("/setup/track", { method: "POST", body: { tools } }); toast(`Tracking ${r2.added.join(", ")}`); await refresh(); } catch (e) { toast(e.message, true); } });
  $("#su-tools-toggle", v)?.addEventListener("click", (e) => {
    const boxes = $$("[data-tool]", v);
    const next = !boxes.every((c) => c.checked);
    boxes.forEach((c) => { c.checked = next; });
    e.currentTarget.textContent = next ? "Deselect All" : "Select All";
  });
  $("#su-apply")?.addEventListener("click", async () => { const [browser, profile] = $("#su-prof").value.split("|"); if (!confirm(`This will close ${browser} (gracefully, tabs restore on relaunch), add the 🤖 AI folder to profile "${profile}", and reopen it. Continue?`)) return; try { const r2 = await api("/setup/bookmarks/apply", { method: "POST", body: { browser, profile } }); toast(`Bookmarks added. Backup saved.${r2.relaunched ? " Browser relaunched." : ""}`); } catch (e) { toast(e.message, true); } });
  $("#su-dl")?.addEventListener("click", async () => { try { downloadBlob(await apiBlobUrl("/setup/bookmarks.html"), "ai-bookmarks.html"); } catch (e) { toast(e.message, true); } });
  $("#su-back").addEventListener("click", () => { st.step = 1; st.result = null; render(); });
  $("#su-done").addEventListener("click", async () => {
    if (st.fullFlow) {
      await advanceFromScanToConnections();
      return;
    }
    if ((st.afterScan === "expert" || S.settings?.expertSetup?.pendingScan) && !S.settings?.expertSetup?.done) {
      st.afterScan = "";
      st.phase = "expert";
      st.expertStep = S.settings?.expertSetup?.step && S.settings.expertSetup.step !== "ais" ? S.settings.expertSetup.step : "ais";
      await saveExpert({ pendingScan: false, step: st.expertStep, done: false, skipped: false });
      render();
      return;
    }
    finishAiSetup("command");
  });
}
// Setup finishes into chat. Get everything connected opens only from the Expert integrations step.
async function finishAiSetup(nextView, { quiet = false } = {}) {
  try {
    const saved = await api("/setup/done", { method: "POST" });
    S.settings = { ...(S.settings || {}), ...(saved || {}), onboarded: true };
    if (saved?.sampleProject) {
      const sp = saved.sampleProject;
      S.projects = Array.isArray(S.projects) ? S.projects.filter((p) => p.id !== sp.id).concat([sp]) : [sp];
      if (!S.project) {
        S.project = sp.id;
        try { localStorage.setItem("cc.project", sp.id); } catch {}
      }
      if (!S.lastOrders && sp.starterPrompt) S.lastOrders = sp.starterPrompt;
    }
    if (S.onboarding) S.onboarding.show = false;
    S.visitedSetup = true;
    S.connectWizard = false;
    // After the welcome screen: no desktop card and no tour this session (0.4.17).
    if (S.setup?.phase === "welcome") { S.setup.phase = ""; S.firstRunDone = true; window.CC?.tour?.sync?.(); }
    S.view = nextView;
    if (nextView === "command" && !quiet) toast("Setup complete. You are in Chat. Type below.", false, null, 6000);
    render();
  } catch (e) { toast(e.message, true); }
}

// Daily-spend labels. A ::after inside the chart panel is trapped by that panel's backdrop-filter
// and can paint under the next panel. This one is attached to body.
function mountSparkTip() {
  if (document.getElementById("cc-spark-tip")) return;
  const tip = document.createElement("div");
  tip.id = "cc-spark-tip";
  tip.className = "cc-spark-tip";
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;
  const hide = () => { current = null; tip.hidden = true; };
  const show = (bar) => {
    const text = bar?.getAttribute?.("data-v");
    if (!text) return hide();
    current = bar;
    tip.textContent = text;
    tip.hidden = false;
    const r = bar.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.top - h - 2;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 2);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  const barOf = (node) => (node instanceof Element ? node.closest(".sparks i") : null);
  document.addEventListener("pointerover", (e) => { const bar = barOf(e.target); if (bar) show(bar); });
  document.addEventListener("pointerout", (e) => {
    const bar = barOf(e.target);
    if (!bar || bar !== current) return;
    const next = barOf(e.relatedTarget);
    if (next) show(next); else hide();
  });
  window.addEventListener("scroll", () => { if (current) show(current); }, true);
  window.addEventListener("resize", () => { if (current) show(current); });
}
mountSparkTip();
