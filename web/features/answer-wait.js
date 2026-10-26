// Backup when API credits run out. The waiting box (single answer, council seat, side-by-side column), its
// buttons, the Settings panel and the first-run Setup step. One source of truth: GET /api/answerwait.
// Continue in copies the prompt and opens the AI's page only on the person's click. In the desktop app, while
// a box is waiting, the clipboard is read once each time the window comes back into focus, and only a
// "MELDMIND ANSWER <job id>" block for a waiting job is used: just the text inside it is sent, nothing else is kept.
import { panelHtml, waitBoxHtml, findBlock, elapsed } from "../backup-panel.js";
const { S, api, toast, esc } = window.CC;

const css = `
.cc-aw { border: 1px dashed var(--line-2, #273449); border-radius: 10px; padding: 10px 12px; margin: 6px 0; }
.cc-aw-steps { margin: 6px 0 0 18px; padding: 0; }
.cc-aw-steps li { opacity: .6; }
.cc-aw-steps li.on { opacity: 1; font-weight: 600; }
.cc-aw-steps li.done { text-decoration: line-through; }
.cc-aw-tag { margin-left: 6px; }
`;
const style = document.createElement("style"); style.id = "cc-answer-wait-style"; style.textContent = css; document.head.appendChild(style);

let view = null;
let loading = null;
const jobsById = () => Object.fromEntries((view?.jobs || []).map((j) => [j.id, j]));
const waitingIds = () => (view?.jobs || []).filter((j) => j.status === "waiting").map((j) => j.id);

async function load(refresh = false) {
  if (loading && !refresh) return loading;
  loading = api(`/answerwait${refresh ? "?refresh=1" : ""}`).then((v) => { view = v; return v; }).catch(() => view).finally(() => { loading = null; });
  return loading;
}

// The box for a slot. The slot's own record says which job; the job list has the newest step.
function boxFor(w) {
  if (!w?.jobId) return "";
  const j = jobsById()[w.jobId];
  if (j && j.status !== "waiting") return "";
  const merged = j ? { ...w, step: j.step, trying: j.trying, headline: j.headline, website: j.website, ai: j.ai || w.ai } : w;
  return waitBoxHtml(merged, { esc });
}
window.CC.subWaitHtml = boxFor;
window.CC.subTagHtml = (tag) => (tag ? `<span class="chip cc-aw-tag">${esc(tag)}</span>` : "");

async function openPage(url) {
  if (!url) return;
  const desk = window.ccDesktop;
  if (desk && typeof desk.openExternal === "function") { await desk.openExternal(url); return; }
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) w.opener = null;
}

async function onContinue(id) {
  const info = await api(`/answerwait/${encodeURIComponent(id)}`);
  try { await navigator.clipboard.writeText(info.prompt); toast(info.url ? `Copied. Paste it into ${info.ai} and send it.` : `Copied. Paste it into ${info.ai} and send it. Meldmind has no page to open for it.`); }
  catch { toast("Could not copy. Use Paste reply when the answer is ready.", true); }
  if (info.url) { try { await openPage(info.url); } catch (e) { toast(e.message || "Could not open the page", true); } }
}
async function saveReply(id, text, route = "paste") {
  await api(`/answerwait/${encodeURIComponent(id)}/answer`, { method: "POST", body: { text, route, confirm: route === "paste" } });
  await load();
  toast("The answer is in.");
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest?.("[data-aw-continue],[data-aw-paste],[data-aw-stop],[data-aw-save]");
  if (!t) return;
  e.preventDefault();
  try {
    if (t.dataset.awContinue) await onContinue(t.dataset.awContinue);
    else if (t.dataset.awPaste) { const box = document.querySelector(`[data-aw-box="${CSS.escape(t.dataset.awPaste)}"]`); if (box) { box.hidden = !box.hidden; if (box.hidden) drafts.delete(t.dataset.awPaste); else { drafts.set(t.dataset.awPaste, box.querySelector("textarea")?.value || ""); box.querySelector("textarea")?.focus(); } } }
    else if (t.dataset.awStop) { await api(`/answerwait/${encodeURIComponent(t.dataset.awStop)}/stop`, { method: "POST" }); await load(); toast("Stopped waiting."); }
    else if (t.dataset.awSave) {
      const text = document.querySelector(`[data-aw-box="${CSS.escape(t.dataset.awSave)}"] textarea`)?.value || "";
      if (!text.trim()) return toast("Paste the reply first.", true);
      await saveReply(t.dataset.awSave, text, "paste");
      drafts.delete(t.dataset.awSave);
    }
  } catch (err) { toast(err.message, true); }
});

// How long each box has waited, kept current only while a box is on screen.
let ticking = false;
function tick() {
  const spans = document.querySelectorAll("[data-aw-since]");
  if (!spans.length) { ticking = false; return; }
  for (const s of spans) s.textContent = elapsed(Date.now() - Number(s.dataset.awSince));
  setTimeout(tick, 15000);
}
const startTick = () => { if (!ticking) { ticking = true; setTimeout(tick, 15000); } };
// A redraw keeps an open Paste reply box and what was typed in it.
const drafts = new Map(); // job id -> text, this page only
document.addEventListener("input", (e) => { const box = e.target.closest?.("[data-aw-box]"); if (box) drafts.set(box.dataset.awBox, e.target.value); });
new MutationObserver(() => {
  if (document.querySelector("[data-aw-since]")) startTick();
  for (const box of document.querySelectorAll("[data-aw-box]")) {
    if (!drafts.has(box.dataset.awBox) || !box.hidden) continue;
    box.hidden = false;
    const ta = box.querySelector("textarea");
    if (ta && !ta.value) ta.value = drafts.get(box.dataset.awBox);
  }
}).observe(document.body, { childList: true, subtree: true });

// The desktop app reads the clipboard once when the window comes back, only while a box waits.
let lastClip = "";
async function checkClipboard() {
  if (!window.ccDesktop) return; // a plain browser would ask for permission: Paste reply is the way there
  const ids = waitingIds();
  if (!ids.length) return;
  let text = "";
  try { text = await navigator.clipboard.readText(); } catch { return; }
  const hit = findBlock(text, ids);
  text = "";
  if (!hit) return;
  const stamp = `${hit.jobId}:${hit.answer.length}`;
  if (stamp === lastClip) return;
  lastClip = stamp;
  try {
    await api(`/answerwait/${encodeURIComponent(hit.jobId)}/answer`, { method: "POST", body: { route: "clipboard", text: `MELDMIND ANSWER ${hit.jobId}\n${hit.answer}\nEND MELDMIND ANSWER` } });
    await load();
    toast("The answer you copied is in its box.");
  } catch (e) { toast(e.message, true); }
}
window.addEventListener("focus", () => { checkClipboard(); });

// ---------- Settings and Setup: the same panel ----------
async function renderPanel(el, { setup = false } = {}) {
  if (!el) return;
  if (!view) await load(true);
  el.innerHTML = panelHtml(view || {}, { esc, setup });
  const post = async (body) => { view = await api("/answerwait/settings", { method: "POST", body }); renderPanel(el, { setup }); };
  el.querySelector("#cc-aw-on")?.addEventListener("change", (e) => post({ on: e.target.checked }).catch((x) => toast(x.message, true)));
  el.querySelector("#cc-aw-planfirst")?.addEventListener("change", async (e) => {
    try { await api("/settings", { method: "POST", body: { planFirst: e.target.checked } }); await api("/answerwait/check", { method: "POST" }); view = await api("/answerwait?refresh=1"); renderPanel(el, { setup }); }
    catch (x) { e.target.checked = !e.target.checked; toast(x.message, true); }
  });
  el.querySelectorAll("[data-aw-route-on]").forEach((b) => b.addEventListener("change", () => post({ routes: { [b.dataset.awRouteOn]: b.checked } }).catch((x) => toast(x.message, true))));
  el.querySelectorAll("[data-aw-setup]").forEach((b) => b.addEventListener("click", () => openPage(b.dataset.awSetup).catch(() => {})));
  el.querySelector("#cc-aw-check")?.addEventListener("click", async () => { try { view = await api("/answerwait/check", { method: "POST" }); renderPanel(el, { setup }); } catch (x) { toast(x.message, true); } });
  el.querySelector("#cc-aw-website")?.addEventListener("change", async (e) => {
    if (e.target.checked) {
      if (!confirm(`${view?.websiteWarning || ""}\n\nTurn on website mode anyway?`)) { e.target.checked = false; return; }
      return post({ website: true, confirm: true }).catch((x) => { e.target.checked = false; toast(x.message, true); });
    }
    return post({ website: false }).catch((x) => toast(x.message, true));
  });
}
window.CC.renderBackupPanel = renderPanel;

function rerenderOpen() {
  if (S.view === "command") window.CC.renderOps?.();
  const set = document.querySelector('[data-feature="answer-wait"] #cc-aw-settings');
  if (set) renderPanel(set.parentElement);
}

CC.register({
  id: "answer-wait",
  settings: { order: 10, render: (el) => renderPanel(el) },
  onEvent(ev) {
    if (ev.type === "answerwait.update" && ev.job) {
      const list = view?.jobs || [];
      const i = list.findIndex((j) => j.id === ev.job.id);
      if (i >= 0) list[i] = ev.job; else list.unshift(ev.job);
      if (view) view.jobs = list; else load();
      if (ev.job.runId === S.live?.id) rerenderOpen();
    }
  },
  onState() { if (!view) load(); },
});
load();
