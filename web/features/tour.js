// Short tour: one idea per step, a Try it button, skip any time, replay from Help.
// Steps come from web/features/guide.js and hide when their page is not in this app.
import { liveProbe, rememberWalks, tourSteps } from "./guide.js";
import { desktopClick, desktopPromptBlocked, markSessionClosed, sessionClosed } from "../desktop-prompt-flow.js";

const { S, api, toast, esc, go } = window.CC;

// Short Simple tour. Each body stays at 30 words or fewer, with no expert jargon.
export const SIMPLE_STEPS = [
  { id: "s-type", for: "simple", target: "#orders", view: "command", title: "Type your question here", body: "Type what you want in the box. Then tap Send. Meldmind picks an AI for you." },
  { id: "s-example", for: "simple", target: "#cc-starters", view: "command", title: "Or tap an example", body: "Or tap an example under the box. It fills the words. You can change them before you send." },
  { id: "s-answer", for: "simple", target: "#out-md", view: "command", title: "Your answer shows here", body: "Your answer shows here. Tap Read aloud to hear it." },
  { id: "s-help", for: "simple", target: "#help-search", view: "help", title: "Help is here, any time", body: "Help is here, any time. Type a question in your own words." },
  { id: "s-text", for: "simple", target: "#basics-reading", view: "settings", title: "Make text bigger", body: "Make text bigger in Settings. Open Text and reading, then pick Large or Extra large." },
];

const css = `
#cc-tour { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
#cc-tour .spot { position: fixed; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(3,6,12,.58), 0 0 0 2px var(--accent); transition: all .25s ease; }
#cc-tour .spot.none { box-shadow: 0 0 0 9999px rgba(3,6,12,.58); width: 0; height: 0; left: 50%; top: 50%; }
#cc-tour .card { position: fixed; width: 380px; max-width: calc(100vw - 24px); background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 18px; box-shadow: 0 24px 60px rgba(0,0,0,.45); pointer-events: auto; font-size: 0.8438rem; line-height: 1.5; }
#cc-tour .card h4 { margin: 0 0 6px; font-size: 1rem; }
#cc-tour .card .step { color: var(--dim); font-family: var(--mono); font-size: 0.6875rem; margin-left: auto; }
#cc-tour .plan { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; }
#cc-tour .card .note { margin-top: 6px; }
.cc-tour-invite.quiet { position: static; display: flex; justify-content: center; gap: 8px; align-items: center; margin: 14px auto 0; max-width: 720px; background: transparent; border: 0; box-shadow: none; padding: 4px; }
.cc-tour-invite { position: fixed; left: 18px; bottom: calc(var(--strip-h) + 16px); z-index: 45; display: flex; gap: 10px; align-items: center; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 12px; padding: 10px 14px; box-shadow: 0 12px 30px rgba(0,0,0,.35); font-size: 0.8125rem; }
#cc-whats-new, #cc-desktop-prompt { position: fixed; inset: 0; z-index: 80; background: rgba(3,6,12,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
#cc-whats-new .card, #cc-desktop-prompt .card { width: 460px; max-width: calc(100vw - 32px); min-width: 0; box-sizing: border-box; max-height: calc(100vh - 32px); overflow: auto; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 18px 20px; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
#cc-whats-new h4, #cc-desktop-prompt h4 { margin: 0 0 6px; font-size: 1.125rem; }
#cc-desktop-prompt .card { position: relative; }
#cc-desktop-prompt h4 { padding-right: 72px; }
#cc-desktop-prompt .x { position: absolute; top: 10px; right: 10px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); font-size: 0.8125rem; line-height: 1.2; cursor: pointer; }
#cc-desktop-prompt .x:hover, #cc-desktop-prompt .x:focus { background: var(--card-hover, #1a2436); color: var(--text); }
#cc-whats-new h5 { margin: 14px 0 2px; font-size: 0.875rem; font-weight: 650; text-transform: none; letter-spacing: 0; }
#cc-whats-new ul, #cc-desktop-prompt ul { margin: 8px 0 0; padding-left: 18px; }
#cc-whats-new li, #cc-desktop-prompt li { margin: 6px 0; }
#cc-whats-new .ver + .ver { border-top: 1px solid var(--line-2); margin-top: 10px; }
@media (max-width: 760px) { #cc-tour .card { left: 12px !important; right: 12px; bottom: calc(var(--strip-h) + 64px); top: auto !important; width: auto; } .cc-tour-invite { left: 12px; right: 12px; bottom: calc(var(--strip-h) + 66px); } }
`;
const style = document.createElement("style"); style.id = "cc-tour-style"; style.textContent = css; document.head.appendChild(style);

let tour = null;
let synced = false;
let idx = -1;
let el = null;
let timer = null;
let pinned = null;
let fullTour = false;
let newsOpen = false;
let newsDismissed = false;
let desktopOpen = false;
let desktopDismissed = false;
let desktopBusy = false;
const session = () => { try { return window.sessionStorage; } catch { return null; } };
// S.firstRunDone: the welcome screen just finished. First run never shows the desktop card (0.4.17).
const desktopBlocked = () => desktopPromptBlocked({ dismissed: desktopDismissed || !!S.firstRunDone || sessionClosed(session()), busy: desktopBusy, view: S.view });

// Stops for controls the guide does not list. Each shows only in its own mode.
const APP_STEPS = [
  { id: "simple-chat", for: "simple", target: "#orders", view: "command", title: "One chat box", body: "Say what you want in plain words. You do not pick a model. Meldmind picks one AI, says which one answered, and the answer shows up right under the box. Upload adds a file, a screenshot, or a document. Voice writes what you say into the box. Edit the words before you send. A picture or video can be retouched or described after you see the plan. The chips under the box are only the AIs you have connected. Demo shows there only until a real one is connected. Ctrl+Enter sends it." },
  { id: "orders", target: "#orders", view: "command", title: "Marching orders", body: "Type what you want in plain words. After a few letters, prompts that match what you are making show under this box. Picking one keeps your words, and Undo puts them back. Nothing is sent until you click Send. Upload adds a file, a screenshot, or a document. Voice writes what you say into the box. Edit the words before you send. A picture or video can be retouched or described after you see the plan. Auto-detect can suggest a Pro prompt from what you type and show it as a chip. Remove the chip if you want your own words only. The router still classifies the job and sends each part to the best available AI." },
  { id: "plain-request", for: "both", target: "#plain-request", view: "command", title: "Try saying...", body: "Try saying: email this client and put it on my calendar. A cheap fast AI drafts the email and the event. You see the cost, usually a fraction of a cent. Meldmind sends the email and adds the event only after you click Approve once. No outside AI touches your Gmail or Calendar." },
  { id: "desktop-apps", for: "both", target: "#app-discovery", view: "settings", title: "Programs on this PC", body: "When you turn on desktop control, Meldmind lists installed programs. On Windows that is the uninstall list and the Start menu, plus command-line tools on PATH. File contents are not read. Allow each app you want. Allowed apps are scored and join the router's choices, the same as a tool you add. While you plan a mission or client work, a card can suggest a program with a short reason, Free or Paid, and the official link. Dismiss hides that suggestion. Nothing is installed or bought. Program scan is part of Pro. Turn suggestions off in Settings." },
  { id: "devices", for: "both", target: "#settings-devices", view: "settings", title: "Computers on this key", body: "Settings, Devices, lists the computers using your license. A key works on 2 computers, a PC and a laptop. Remove one there to free a spot. Each person has their own key, including each Extreme team seat." },
  { id: "builders", for: "both", target: "#builders-root", view: "builders", title: "Builders", body: "Builders show up when a need is detected. Describe what you want, preview which AIs would see it, then Build, Test, and Publish. Nothing is sent, posted, or charged until you click Publish. HighLevel, receipts, invoices, a booking, meeting notes, a contract, a review, or a website chat each bring up their own builder." },
  { id: "report-back", for: "both", view: "command", title: "When another AI finishes", body: "When you hand a job to another AI, that AI can tell Meldmind it is finished. You get a notice, and the summary shows in the job. If it cannot call back, use Paste result. Nothing is saved from that paste until you click Save." },
  { id: "get-it-done", for: "both", view: "command", title: "Get it done", body: "Get it done lets one job run its steps without asking. It ends when the job ends. You can also say get it done, don't ask me. Spending money and a permanent delete still need one tap. Sending a message stays off unless you turn that on. Stop and the activity log stay on. Always for this kind of job is in Settings, and you can revoke it any time." },
  { id: "community", for: "both", target: "#cc-community", view: "community", title: "Community and AI News", body: "Community chat has General, Prompts, Builders, Help, and Show and tell. AI News sits next to them and updates weekly. Your account has one public username. First-run setup asks for it, and Skip keeps the suggested name. Your email is never shown. The same name is used in chat, on shared prompts, in the Builders gallery, and on AI News. Change it in Settings. Click Send to post. Share a prompt, a builder, or a mission with one click. Keys and private files are refused. The weekly email is off until you tick it." },
];

// Guide steps first, then these stops and the short steps the everyday pages add for this mode.
function extraSteps() {
  const mode = window.CC.uiMode?.() || "expert";
  const extra = Array.isArray(window.CC.everydaySteps) ? window.CC.everydaySteps : [];
  return [...APP_STEPS, ...extra]
    .filter((s) => s.for === "both" || s.for === mode || (!s.for && mode === "expert"))
    .map((s) => ({ ...s, open: s.open || (s.view ? { view: s.view, focus: s.target || "" } : null) }));
}
function fullSteps() {
  return [...tourSteps(liveProbe()), ...extraSteps()];
}
// Simple gets the five short steps. See what else it can do opens the full tour.
function steps() {
  if (pinned) return pinned;
  const mode = window.CC.uiMode?.() || "expert";
  if (mode === "simple" && !fullTour) return SIMPLE_STEPS;
  return fullSteps();
}
// The tour is offered once, later, as a quiet link: after a few answers, never during first run.
export const TOUR_AFTER_ANSWERS = 3;
let offeredThisSession = false;
function answeredEnough() {
  let counted = 0;
  try { counted = Number(localStorage.getItem("cc.answers")) || 0; } catch { /* storage can be off */ }
  const done = (S.missions || []).filter((m) => m.status === "done" || m.status === "done-with-errors").length;
  return Math.max(counted, done) >= TOUR_AFTER_ANSWERS;
}

async function sync() {
  try { tour = await api("/tour"); } catch { /* invite waits until the next state tick */ }
  await rememberWalks(api);
  synced = true;
  maybeInvite();
}

function hideNews() {
  const box = document.getElementById("cc-whats-new");
  if (box?._newsKey) document.removeEventListener("keydown", box._newsKey);
  box?.remove();
  newsOpen = false;
}
function maybeInvite() {
  if (idx >= 0) return;
  if (window.CC.askingMode?.()) { hideNews(); hideDesktop(); document.querySelector(".cc-tour-invite")?.remove(); return; }
  if (S.view === "setup") { hideNews(); hideDesktop(); document.querySelector(".cc-tour-invite")?.remove(); return; }
  if (!newsDismissed && tour?.whatsNew) { showNews(); return; }
  if (newsOpen) return;
  if (!desktopBlocked() && tour?.desktopPrompt) { showDesktop(); return; }
  if (desktopOpen) return;
  const existing = document.querySelector(".cc-tour-invite");
  const show = tour && !tour.completed && !tour.skippedAt && S.view !== "setup";
  if (!show) { existing?.remove(); return; }
  if (!answeredEnough()) { existing?.remove(); return; }
  if (tour.offeredAt && !offeredThisSession) { existing?.remove(); return; }
  const host = document.getElementById("view");
  if (!host || S.view !== "command") { existing?.remove(); return; }
  if (existing && existing.parentNode === host) return;
  existing?.remove();
  const d = document.createElement("div"); d.className = "cc-tour-invite quiet";
  d.innerHTML = `<span class="dim small">New here?</span><button type="button" class="ghost small" id="cc-tour-go">Take a short tour</button><button type="button" class="ghost small" id="cc-tour-later">Not now</button>`;
  host.appendChild(d);
  if (!offeredThisSession) { offeredThisSession = true; api("/tour/offered", { method: "POST" }).then((t) => { if (t) tour = t; }).catch(() => { /* the link still works this session */ }); }
  d.querySelector("#cc-tour-go").addEventListener("click", () => start());
  d.querySelector("#cc-tour-later").addEventListener("click", async () => { d.remove(); try { tour = await api("/tour/skip", { method: "POST" }); } catch { /* the next visit can offer it again after a reset */ } });
}

function newsMarkup(n) {
  const versions = Array.isArray(n.versions) && n.versions.length ? n.versions : [{ version: n.version, title: n.title, bullets: n.bullets || [] }];
  const many = versions.length > 1;
  const title = many ? "What's new" : (n.title || "What's new");
  const lead = many
    ? `${n.from ? `Since ${esc(n.from)}, newest first. ` : "Newest first. "}These notes are saved in the app, so they work offline.`
    : `Version ${esc(n.version)}. This note shows once for this version.`;
  const body = many
    ? versions.map((v) => `<section class="ver"><h5>${esc(v.title || "What's new")}</h5><div class="dim small">Version ${esc(v.version)}</div><ul>${(v.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul></section>`).join("")
    : `<ul>${(n.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  return `<div class="card" role="dialog" aria-labelledby="cc-news-title"><h4 id="cc-news-title">${esc(title)}</h4><div class="dim small">${lead}</div>${body}<div class="row" style="margin-top:14px"><button class="btn sm" id="cc-news-tour">Take the tour</button><button class="btn sm primary" id="cc-news-ok" style="margin-left:auto">Got it</button></div></div>`;
}
function showNews(n = tour?.whatsNew) {
  if (!n || idx >= 0 || S.view === "setup") return false;
  document.querySelector(".cc-tour-invite")?.remove();
  let box = document.getElementById("cc-whats-new");
  if (box) return true;
  newsOpen = true;
  box = document.createElement("div");
  box.id = "cc-whats-new";
  box.innerHTML = newsMarkup(n);
  document.body.appendChild(box);
  const onKey = (e) => { if (e.key === "Escape") dismissNews(false); };
  document.addEventListener("keydown", onKey);
  box._newsKey = onKey;
  box.querySelector("#cc-news-ok").addEventListener("click", () => dismissNews(false));
  box.querySelector("#cc-news-tour").addEventListener("click", () => dismissNews(true));
  return true;
}
async function openNews() {
  if (S.view === "setup" || idx >= 0) return;
  let n = null;
  try { n = (await api("/tour/whats-new")).whatsNew; }
  catch (e) { toast(e.message, true); return; }
  if (!n) { toast("No What's new notes for this version yet"); return; }
  newsDismissed = true;
  hideNews();
  showNews(n);
}
async function dismissNews(thenTour) {
  newsDismissed = true;
  const box = document.getElementById("cc-whats-new");
  if (box?._newsKey) document.removeEventListener("keydown", box._newsKey);
  box?.remove();
  newsOpen = false;
  try { tour = await api("/tour/whats-new/seen", { method: "POST" }); } catch {}
  if (thenTour) start();
  else maybeInvite();
}
function hideDesktop() {
  const box = document.getElementById("cc-desktop-prompt");
  if (box?._deskKey) document.removeEventListener("keydown", box._deskKey);
  box?.remove();
  desktopOpen = false;
}
function showDesktop() {
  const p = tour?.desktopPrompt;
  if (!p || idx >= 0 || desktopBlocked()) return;
  document.querySelector(".cc-tour-invite")?.remove();
  if (document.getElementById("cc-desktop-prompt")) return;
  desktopOpen = true;
  const box = document.createElement("div");
  box.id = "cc-desktop-prompt";
  box.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="cc-desktop-title"><button type="button" class="x" id="cc-desktop-x" aria-label="Close"><span aria-hidden="true">×</span> Close</button><h4 id="cc-desktop-title">${esc(p.title)}</h4><div class="muted">${esc(p.body)}</div><ul>${(p.safety || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn sm primary" id="cc-desktop-allow">Allow Antigravity</button><button class="btn sm" id="cc-desktop-install">Install and connect</button><button class="btn sm" id="cc-desktop-settings">Open settings</button><button class="btn sm" id="cc-desktop-later">Not now</button><button class="ghost small" id="cc-desktop-never">Never</button></div></div>`;
  document.body.appendChild(box);
  const onKey = (e) => { if (e.key === "Escape") desktopChoice("close"); };
  document.addEventListener("keydown", onKey);
  box._deskKey = onKey;
  box.addEventListener("click", (e) => { if (e.target === box) desktopChoice("close"); });
  for (const id of ["x", "allow", "install", "settings", "later", "never"]) {
    box.querySelector(`#cc-desktop-${id}`).addEventListener("click", () => desktopChoice(id === "x" ? "close" : id));
  }
  box.querySelector("#cc-desktop-allow").focus();
}
// Every choice closes the card before anything slow runs, and it stays closed for this session.
async function desktopChoice(button) {
  const step = desktopClick(button);
  desktopDismissed = true;
  markSessionClosed(session());
  hideDesktop();
  if (step.view) {
    if (window.CC.openSettings) window.CC.openSettings(step.focus);
    else go(step.view);
  }
  try { tour = await api("/tour/desktop", { method: "POST", body: { action: step.server } }); } catch { /* the card is already closed for this session */ }
  if (step.run) await runDesktop(step.run === "install");
  maybeInvite();
}
async function runDesktop(install) {
  const openSettings = { label: "Open settings", onClick: () => (window.CC.openSettings ? window.CC.openSettings("[data-feature='antigravity']") : go("settings")) };
  desktopBusy = true;
  try {
    await api("/antigravity/allow", { method: "POST", body: { allow: true } });
    if (!install) { toast("Antigravity is allowed. Change this any time in Settings.", false, openSettings); return; }
    if (!window.confirm("Install Antigravity with Google's installer, then open sign-in in your browser? Meldmind does not see your password.")) {
      toast("Nothing was installed. Install and connect is in Settings.", false, openSettings);
      return;
    }
    toast("Installing Antigravity. This can take a minute. You can keep working.");
    const r = await api("/antigravity/install", { method: "POST", body: { confirm: true } });
    toast(r.message || "Installer finished", !r.ok, r.ok ? null : openSettings);
    if (r.ok) {
      const s = await api("/antigravity/signin", { method: "POST", body: { confirm: true } });
      toast(s.message || "Sign-in opened", !s.ok);
    }
  } catch (err) { toast(err.message, true, openSettings); }
  finally { desktopBusy = false; }
}

new MutationObserver(() => { if (synced) maybeInvite(); }).observe(document.getElementById("view") || document.body, { childList: true });

export async function start(at = 0, opts = {}) {
  fullTour = !!opts.full;
  document.querySelector(".cc-tour-invite")?.remove();
  await rememberWalks(api);
  pinned = null;
  pinned = steps();
  if (!pinned.length) {
    pinned = null;
    toast("The tour is empty because those pages are not in this app yet.");
    return;
  }
  if (!el) {
    el = document.createElement("div"); el.id = "cc-tour"; el.innerHTML = `<div class="spot none"></div><div class="card"></div>`; document.body.appendChild(el);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    document.addEventListener("keydown", onKey);
    timer = setInterval(position, 400);
  }
  show(at);
}
export function startFull() { start(0, { full: true }); }
function close() {
  pinned = null;
  if (!el) return;
  el.remove(); el = null; idx = -1; clearInterval(timer); timer = null;
  window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("keydown", onKey);
}
function onKey(e) { if (e.key === "Escape") skip(); else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") back(); }
async function skip() { close(); try { tour = await api("/tour/skip", { method: "POST" }); } catch { /* skip still closes the card */ } toast("Tour skipped. Take the tour from Help."); }
async function finish() { close(); try { tour = await api("/tour/complete", { method: "POST" }); } catch { /* the card is already closed */ } toast("Tour done. Replay it any time from Help."); }
function next() { const list = steps(); if (idx >= list.length - 1) return finish(); show(idx + 1); }
function back() { if (idx > 0) show(idx - 1); }

function follow(open) {
  if (!open) return;
  if (open.article) {
    window.CC.openHelp?.(open.article);
    return;
  }
  if (open.view && S.view !== open.view) go(open.view);
  if (open.focus) setTimeout(() => document.querySelector(open.focus)?.scrollIntoView({ block: "center" }), 60);
}

function show(i) {
  const list = steps();
  if (!list.length) return close();
  if (i >= list.length) i = list.length - 1;
  idx = i; const st = list[i];
  if (st.target === "#basics-reading") S.settingsMore = false;
  if (st.view && S.view !== st.view) go(st.view);
  else if (st.target === "#basics-reading" && S.view === "settings") go("settings");
  const last = i === list.length - 1;
  const simpleShort = (window.CC.uiMode?.() || "expert") === "simple" && !fullTour;
  const price = !st.tier ? "" : st.tier === "free" ? "Free" : `${esc(st.tierLabel)}, ${esc(st.price)}`;
  const card = el.querySelector(".card");
  card.innerHTML = `<div class="row" style="gap:8px"><h4>${esc(st.title)}</h4><span class="step">${i + 1} / ${list.length}</span></div>
    ${price ? `<div class="plan"><span class="chip">${price}</span></div>` : ""}
    <div class="muted">${esc(st.body)}</div>
    ${st.priceNote ? `<div class="note dim small">${esc(st.priceNote)}</div>` : ""}
    ${st.open ? `<div class="row" style="margin-top:10px"><button class="btn sm primary" id="cc-tour-try" type="button">Try it</button></div>` : ""}
    <div class="row" style="margin-top:12px"><button class="ghost small" id="cc-tour-skip">Skip tour</button><span style="margin-left:auto"></span>${simpleShort && last ? `<button class="btn sm" id="cc-tour-more" type="button">See what else it can do</button>` : ""}${i > 0 ? `<button class="btn sm" id="cc-tour-back">Back</button>` : ""}<button class="btn sm primary" id="cc-tour-next">${last ? "Finish" : "Next"}</button></div>`;
  card.querySelector("#cc-tour-skip").addEventListener("click", skip);
  card.querySelector("#cc-tour-more")?.addEventListener("click", () => { fullTour = true; pinned = fullSteps(); show(0); });
  card.querySelector("#cc-tour-back")?.addEventListener("click", back);
  card.querySelector("#cc-tour-next").addEventListener("click", next);
  card.querySelector("#cc-tour-try")?.addEventListener("click", () => { follow(st.open); requestAnimationFrame(position); });
  requestAnimationFrame(position);
}

function position() {
  if (!el) return;
  const st = steps()[idx]; const spot = el.querySelector(".spot"), card = el.querySelector(".card");
  const t = st?.target ? document.querySelector(st.target) : null;
  const r = t?.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth || 380, ch = card.offsetHeight || 220, pad = 14;
  if (r && r.width && r.height) {
    spot.className = "spot"; spot.style.left = `${r.left - 6}px`; spot.style.top = `${r.top - 6}px`; spot.style.width = `${r.width + 12}px`; spot.style.height = `${r.height + 12}px`;
    if (vw <= 760) return;
    let top = r.bottom + pad, left = r.left;
    if (top + ch > vh - 10) top = r.top - ch - pad;
    if (top < 10) { top = Math.max(10, Math.min(vh - ch - 10, r.top)); left = r.right + pad; }
    if (left + cw > vw - 10) left = Math.max(10, vw - cw - 10);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  } else {
    spot.className = "spot none";
    if (vw <= 760) return;
    card.style.left = `${Math.max(10, (vw - cw) / 2)}px`; card.style.top = `${Math.max(10, (vh - ch) / 2 - 40)}px`;
  }
}

function renderPanel(el2) {
  const t = tour || {};
  const n = steps().length;
  el2.innerHTML = `<div class="panel"><h3>Onboarding tour <span class="right">${t.completed ? `finished ${t.completedAt ? new Date(t.completedAt).toLocaleDateString() : ""}` : t.skippedAt ? "skipped" : "not taken yet"}</span></h3>
    <div class="row"><button class="btn sm" id="cc-tour-start">Take the tour</button><button class="btn sm" id="cc-tour-full" type="button">See what else it can do</button><button class="btn sm" id="cc-news-open">What's new</button><span class="dim small">${n} steps in this app. Each one has a Try it button. Skip any time, and replay from Help.</span>${t.completed || t.skippedAt ? `<button class="ghost small" id="cc-tour-reset" style="margin-left:auto">reset</button>` : ""}</div>
  </div>`;
  el2.querySelector("#cc-tour-start").addEventListener("click", () => { go("command"); setTimeout(() => start(), 120); });
  el2.querySelector("#cc-news-open").addEventListener("click", () => openNews());
  el2.querySelector("#cc-tour-full").addEventListener("click", () => { go("command"); setTimeout(() => startFull(), 120); });
  el2.querySelector("#cc-tour-reset")?.addEventListener("click", async () => { try { tour = await api("/tour/reset", { method: "POST" }); renderPanel(el2); maybeInvite(); } catch (e) { toast(e.message, true); } });
  if (!Array.isArray(window.CC.guideWalks)) rememberWalks(api).then(() => { if (el2.isConnected) renderPanel(el2); });
}

function onMode() { if (idx >= 0) { pinned = null; pinned = steps(); show(0); } }
const answeredIds = new Set();
function markFirstAnswer(id) {
  const fresh = id && !answeredIds.has(id);
  if (id) answeredIds.add(id);
  try {
    localStorage.setItem("cc.firstAnswer", "1");
    if (fresh) localStorage.setItem("cc.answers", String((Number(localStorage.getItem("cc.answers")) || 0) + 1));
  } catch { /* storage can be off */ }
  maybeInvite();
}
window.CC.firstAnswer = markFirstAnswer;
window.CC.tour = { start, startFull, open: start, openNews, sync, state: () => tour, onMode, onAnswer: markFirstAnswer, simpleSteps: () => SIMPLE_STEPS.slice() };

CC.register({
  id: "tour",
  settings: { order: 7, render: renderPanel },
  onState() { if (!synced) sync(); else maybeInvite(); },
});
if (S.providers.length && !synced) sync();
