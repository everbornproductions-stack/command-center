// Onboarding tour: a first-run walkthrough with a spotlight on each part of the console and a
// sample run on the demo AIs (no keys, no spend). State lives on the server (/api/tour); the tour
// offers itself once with a small invite and can be restarted from Settings.
import { countsAsRealAi } from "../composer-ais.js";

const { S, api, toast, esc, go, refresh } = window.CC;

const STEPS = [
  { id: "mode", for: "both", target: "#mode-toggle", view: "command", title: "Simple or Expert", body: "Simple is one chat box. You say what you want and the council picks the AI. Expert shows the debate, the scores, spend caps, the live map, marketplace, MCP, webhooks, and every menu. This switch is on every screen. One click changes it, and nothing you already did is lost." },
  { id: "ways", for: "both", view: "command", title: "Single, Council, Mission, Pipelines", body: "Single: the best AI for the job answers. Council: several answer at once, review each other anonymously, and a chair writes the verdict. Mission: a planner splits the goal, specialists work in parallel, a different AI checks each piece, and an assembler compiles the result. Pipelines: a pipeline is a saved mission with the steps already chosen. Pick one, fill a few blanks, and run it. Nothing starts until you click Run." },
  { id: "simple-welcome", for: "simple", title: "Welcome to Meldmind", body: "Meldmind is an Everborn product. Take command of all your AIs. You are in Simple. Type what you want in the chat box. The council picks the AI. This tour uses pretend AIs, so nothing is spent." },
  { id: "simple-nav", for: "simple", target: "#tabs", view: "command", title: "Chat, Projects, Create, and Settings", body: "Chat, Projects, Create, and Settings stay at the top, and Help sits with them. Chat is this box. Projects keeps one client or campaign together. Create holds prompts, images, media, and publishing. Settings is where a key goes. Everything else is one click away in Expert." },
  { id: "help-tab", for: "both", target: "#help-search", view: "help", title: "Help", body: "Search the guides here. Ask Meldmind answers from these articles with a connected AI. If no AI is connected, you get the search only. Take the tour again, Check for updates, and Run setup again are on this page." },
  { id: "simple-chat", for: "simple", target: "#orders", view: "command", title: "One chat box", body: "Say what you want in plain words. You do not pick a model. The council picks the AI and the answer shows up below. The chips under the box are only the AIs you have connected. Demo shows there only until a real one is connected. Ctrl+Enter sends it." },
  { id: "simple-answer", for: "simple", target: "#out-md", view: "command", title: "The answer", body: "The answer lands here. Copy it when you want. Switch to Expert any time to see the debate, the scores, and the live map." },
  { id: "simple-settings", for: "simple", target: "#settings-keys", view: "settings", title: "Add a key when you are ready", body: "Settings is where a real key goes. Until then, demo AIs can answer and nothing is spent. MCP, webhooks, and spend caps stay in Expert.", action: "keys" },
  { id: "welcome", title: "Welcome to Meldmind", body: "Meldmind is an Everborn product. Take command of all your AIs. One console for every AI you pay for. Give orders once; the console picks the right AI for each part, lets them check each other's work, and keeps score of what everything costs. This tour uses three pretend AIs, so nothing is spent." },
  { id: "menus", target: "#tabs", view: "command", title: "Dropdown menus", body: "The top bar is grouped dropdown menus. It uses the width it has. A wide window shows about eight menus on one row. A narrower window shows about five. The row never wraps. Every page lives in one of those menus. Open a menu with a click, or with the arrow keys once it has focus." },
  { id: "strip", target: "#strip", view: "command", title: "The status strip", body: "One tile per AI. Green: the key works. Amber: an incident, slow, or low balance. Red: key rejected or out of credits. Grey: no key yet. A tile pulses while that AI is working." },
  { id: "orders", target: "#orders", view: "command", title: "Marching orders", body: "Type what you want in plain words. Auto-detect can suggest a Pro prompt from what you type and show it as a chip. Remove the chip if you want your own words only. The router still classifies the job and sends each part to the best available AI." },
  { id: "start-project", for: "both", target: "#sp-home", view: "command", title: "Start a project", body: "Start a project walks you from an idea to a finished deliverable. Pick Website, Music video, Marketing campaign, App/software, Business plan, or Social media reels. Watch an example first if you want a full sample. It works in Simple mode and in Expert mode. The same entry is in the Work menu, next to Projects, and on the Help page." },
  { id: "files", target: "#pf-drop", view: "command", title: "Files in this project", body: "Drop a PDF, Word doc, text file, or image here. Meldmind shows what it will read and the cost. Nothing is added until you confirm. Later answers in this project can cite those files. A mission that makes a video, image, or voice clip also shows the price first, and a paid step waits until you click Approve." },
  { id: "prompts", target: "#pp-list", view: "prompts", title: "Pro prompts", body: "Pre-built pro prompts, written by our team, so you get expert-level results without being a prompt expert. Search the pack here. Auto-detect on the order box can suggest one; you can remove that chip and write your own." },
  { id: "sample", target: "#graph", view: "command", title: "Run the sample", body: "Three demo AIs plan a one-week Instagram launch for a coffee roaster. The sample runs only while no real AI is connected, so nothing is spent.", action: "sample" },
  { id: "ops", target: "#graph", view: "command", title: "Live ops", body: "Watch who is working and who is talking to whom. Tasks fill in as they finish; a check can send a piece back for one revision when it falls short." },
  { id: "live", target: "#lv-open", view: "command", title: "Open live view", body: "The Open live view button is at the bottom-right of Live Ops. It opens the full live map. Live is also in the Work menu." },
  { id: "deliverable", target: "#out-md", view: "command", title: "The deliverable", body: "The assembled result lands here. Copy it, see the savings receipt under it, and find it later under the project it was filed to. The top bar shows You saved this month and all time." },
  { id: "pipelines", target: "#pl-form", view: "pipelines", title: "Pipelines", body: "A pipeline is a saved mission with the steps already chosen. Pick one, fill a few blanks, and run it. Nothing starts until you click Run." },
  { id: "schedules", target: "#sch-root", view: "schedules", title: "Scheduled agents", body: "Schedules run an agent, a chat, or a mission on a clock, from a webhook, or when a file lands in a folder. A result that would be sent somewhere waits until you approve it. Desktop schedules only run while the app is open." },
  { id: "publish", target: "#pub-tour", view: "publish", title: "Publishing preview", body: "Publishing always shows a preview first. Nothing posts, schedules, or saves until you click Confirm. If credentials are not saved yet, the preview says it will record a dry run. Connect Google Drive, Instagram, HighLevel and Slack with your own sign-in in Settings, Publishing." },
  { id: "marketplace", view: "marketplace", title: "Marketplace", body: "Browse and install templates other people shared. Every template is signed and checked before it installs, and nothing runs until you start it. You can share one of your own pipelines here too." },
  { id: "keys", target: "#settings-keys", view: "settings", title: "API keys and MCP", body: "Add an API key here, or connect an MCP server from Connect, then Tools (MCP). The guided setup shows where to get each key, you paste it, the console tests it, then seals it in the vault. Keys never leave this machine and are never shown again. A custom provider can be marked Good at the task types it should take.", action: "keys" },
  { id: "phone", for: "both", target: "#phone-pair", view: "settings", title: "Phone pairing", body: "Settings, Phone and other devices, turns on a link for a phone on the same Wi-Fi. The QR code and the address under it include the pairing code. It stays off until you turn it on. Copy works if the camera cannot scan." },
];

const css = `
#cc-tour { position: fixed; inset: 0; z-index: 70; pointer-events: none; }
#cc-tour .spot { position: fixed; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(3,6,12,.58), 0 0 0 2px var(--accent); transition: all .25s ease; }
#cc-tour .spot.none { box-shadow: 0 0 0 9999px rgba(3,6,12,.58); width: 0; height: 0; left: 50%; top: 50%; }
#cc-tour .card { position: fixed; width: 380px; max-width: calc(100vw - 24px); background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px 18px; box-shadow: 0 24px 60px rgba(0,0,0,.45); pointer-events: auto; font-size: 13.5px; line-height: 1.5; }
#cc-tour .card h4 { margin: 0 0 6px; font-size: 16px; }
#cc-tour .card .step { color: var(--dim); font-family: var(--mono); font-size: 11px; margin-left: auto; }
#cc-tour .card .msg { margin-top: 8px; font-size: 12.5px; }
#cc-tour .dots { display: flex; gap: 5px; margin-top: 12px; }
#cc-tour .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--line-2); }
#cc-tour .dots i.on { background: var(--accent); }
#cc-tour .dots i.done { background: var(--muted); }
.cc-tour-invite { position: fixed; left: 18px; bottom: calc(var(--strip-h) + 16px); z-index: 45; display: flex; gap: 10px; align-items: center; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 12px; padding: 10px 14px; box-shadow: 0 12px 30px rgba(0,0,0,.35); font-size: 13px; }
#cc-whats-new { position: fixed; inset: 0; z-index: 80; background: rgba(3,6,12,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
#cc-whats-new .card { width: 460px; max-width: 100%; max-height: calc(100vh - 32px); overflow: auto; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 18px 20px; box-shadow: 0 24px 60px rgba(0,0,0,.45); }
#cc-whats-new h4 { margin: 0 0 6px; font-size: 18px; }
#cc-whats-new ul { margin: 10px 0 0; padding-left: 18px; }
#cc-whats-new li { margin: 6px 0; }
@media (max-width: 760px) { #cc-tour .card { left: 12px !important; right: 12px; bottom: calc(var(--strip-h) + 64px); top: auto !important; width: auto; } .cc-tour-invite { left: 12px; right: 12px; bottom: calc(var(--strip-h) + 66px); } }
`;
const style = document.createElement("style"); style.id = "cc-tour-style"; style.textContent = css; document.head.appendChild(style);

let tour = null;      // server state
let synced = false;
let idx = -1;         // current step (-1 = closed)
let el = null;        // overlay root
let timer = null;     // reposition loop
let msg = "";         // message under the current step (sample result etc.)
let busy = false;
let newsOpen = false;
let newsDismissed = false;

async function sync() { try { tour = await api("/tour"); synced = true; } catch {} maybeInvite(); }

// What's new first, then the tour invite. Never both at once. Seen version lives in the data folder.
function hideNews() {
  const box = document.getElementById("cc-whats-new");
  if (box?._newsKey) document.removeEventListener("keydown", box._newsKey);
  box?.remove();
  newsOpen = false;
}
function steps() {
  const mode = window.CC.uiMode?.() || "expert";
  return STEPS.filter((s) => s.for === "both" || s.for === mode || (!s.for && mode === "expert"));
}
function maybeInvite() {
  if (idx >= 0) return;
  if (window.CC.askingMode?.()) { hideNews(); document.querySelector(".cc-tour-invite")?.remove(); return; }
  if (S.view === "setup") { hideNews(); document.querySelector(".cc-tour-invite")?.remove(); return; }
  if (!newsDismissed && tour?.whatsNew) { showNews(); return; }
  if (newsOpen) return;
  const existing = document.querySelector(".cc-tour-invite");
  const show = tour && !tour.completed && !tour.skippedAt && S.view !== "setup";
  if (!show) { existing?.remove(); return; }
  if (existing) return;
  const d = document.createElement("div"); d.className = "cc-tour-invite";
  d.innerHTML = `<span>👋</span><span>New here? <b>Take the tour</b>: it runs a sample on pretend AIs.</span><button class="btn sm primary" id="cc-tour-go">Start</button><button class="ghost small" id="cc-tour-later">Not now</button>`;
  document.body.appendChild(d);
  d.querySelector("#cc-tour-go").addEventListener("click", () => start());
  d.querySelector("#cc-tour-later").addEventListener("click", async () => { d.remove(); try { tour = await api("/tour/skip", { method: "POST" }); } catch {} });
}
// Views re-render into #view; re-check whether the invite should show (e.g. after leaving Setup).
function showNews() {
  const n = tour?.whatsNew;
  if (!n || idx >= 0 || S.view === "setup") return;
  document.querySelector(".cc-tour-invite")?.remove();
  let box = document.getElementById("cc-whats-new");
  if (box) return;
  newsOpen = true;
  box = document.createElement("div");
  box.id = "cc-whats-new";
  box.innerHTML = `<div class="card" role="dialog" aria-labelledby="cc-news-title"><h4 id="cc-news-title">${esc(n.title)}</h4><div class="dim small">Version ${esc(n.version)}. This note shows once for this version.</div><ul>${(n.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul><div class="row" style="margin-top:14px"><button class="btn sm" id="cc-news-tour">Take the tour</button><button class="btn sm primary" id="cc-news-ok" style="margin-left:auto">Got it</button></div></div>`;
  document.body.appendChild(box);
  const onKey = (e) => { if (e.key === "Escape") dismissNews(false); };
  document.addEventListener("keydown", onKey);
  box._newsKey = onKey;
  box.querySelector("#cc-news-ok").addEventListener("click", () => dismissNews(false));
  box.querySelector("#cc-news-tour").addEventListener("click", () => dismissNews(true));
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

new MutationObserver(() => { if (synced) maybeInvite(); }).observe(document.getElementById("view") || document.body, { childList: true });

// ---- the tour itself ----
export function start(at = 0) {
  document.querySelector(".cc-tour-invite")?.remove();
  if (!el) {
    el = document.createElement("div"); el.id = "cc-tour"; el.innerHTML = `<div class="spot none"></div><div class="card"></div>`; document.body.appendChild(el);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    document.addEventListener("keydown", onKey);
    timer = setInterval(position, 400);
  }
  msg = ""; show(at);
}
function close() {
  if (!el) return;
  el.remove(); el = null; idx = -1; clearInterval(timer); timer = null;
  window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("keydown", onKey);
}
function onKey(e) { if (e.key === "Escape") skip(); else if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft") back(); }
async function skip() { close(); try { tour = await api("/tour/skip", { method: "POST" }); } catch {} toast("Tour skipped. Take the tour again from the Settings menu, or from the Settings page."); }
async function finish() { close(); try { tour = await api("/tour/complete", { method: "POST" }); } catch {} toast("Tour done. Add a key in Settings when you are ready for real answers."); }
function next() { const list = steps(); if (idx >= list.length - 1) return finish(); msg = ""; show(idx + 1); }
function back() { if (idx > 0) { msg = ""; show(idx - 1); } }

function show(i) {
  const list = steps();
  if (!list.length) return close();
  if (i >= list.length) i = list.length - 1;
  idx = i; const st = list[i];
  if (st.view && S.view !== st.view) { go(st.view); }
  const last = i === list.length - 1;
  const card = el.querySelector(".card");
  card.innerHTML = `<div class="row" style="gap:8px"><h4>${esc(st.title)}</h4><span class="step">${i + 1} / ${list.length}</span></div>
    <div class="muted">${esc(st.body)}</div>
    ${st.action === "sample" ? `<div class="row" style="margin-top:10px"><button class="btn sm primary" id="cc-tour-sample" ${busy ? "disabled" : ""}>${busy ? "Starting…" : "Run the sample now"}</button><span class="dim small">about 30 seconds</span></div>` : ""}
    ${st.action === "keys" ? `<div class="row" style="margin-top:10px"><button class="btn sm primary" id="cc-tour-keys">Set up my keys</button><span class="dim small">or finish and do it later in Settings</span></div>` : ""}
    ${msg ? `<div class="msg">${msg}</div>` : ""}
    <div class="dots">${list.map((_, k) => `<i class="${k === i ? "on" : k < i ? "done" : ""}"></i>`).join("")}</div>
    <div class="row" style="margin-top:12px"><button class="ghost small" id="cc-tour-skip">Skip tour</button><span style="margin-left:auto"></span>${i > 0 ? `<button class="btn sm" id="cc-tour-back">Back</button>` : ""}<button class="btn sm primary" id="cc-tour-next">${last ? "Finish" : "Next →"}</button></div>`;
  card.querySelector("#cc-tour-skip").addEventListener("click", skip);
  card.querySelector("#cc-tour-back")?.addEventListener("click", back);
  card.querySelector("#cc-tour-next").addEventListener("click", next);
  card.querySelector("#cc-tour-sample")?.addEventListener("click", runSample);
  card.querySelector("#cc-tour-keys")?.addEventListener("click", async () => { await finish(); go("settings"); setTimeout(() => window.CC.keysetup?.open?.(), 150); });
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
    if (top + ch > vh - 10) top = r.top - ch - pad;                       // above
    if (top < 10) { top = Math.max(10, Math.min(vh - ch - 10, r.top)); left = r.right + pad; }   // beside
    if (left + cw > vw - 10) left = Math.max(10, vw - cw - 10);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  } else {
    spot.className = "spot none";
    if (vw <= 760) return;
    card.style.left = `${Math.max(10, (vw - cw) / 2)}px`; card.style.top = `${Math.max(10, (vh - ch) / 2 - 40)}px`;
  }
}

function realAiOn() {
  return !!(S.realAi || (S.providers || []).some(countsAsRealAi));
}

async function runSample() {
  if (busy) return; busy = true; show(idx);
  try {
    if (realAiOn()) {
      msg = `<span class="chip amber">skipped</span> A real AI is connected, so the sample stays off. Demo mode was not turned on.`;
      busy = false; show(idx); return;
    }
    if (!S.demo) { const r = await api("/demo", { method: "POST", body: { on: true } }); S.demo = r.demo; await refresh(); go("command"); }
    const r = await api("/tour/sample", { method: "POST" });
    if (r.kind === "single") { await api("/chat", { method: "POST", body: { prompt: r.prompt } }); msg = `<span class="chip green">running</span> ${esc(r.note || "")} Watch the graph light up, then press Next.`; }
    else msg = `<span class="chip green">running</span> The planner is splitting the goal; tasks appear in Live ops in a few seconds. Press Next when you like.`;
    toast("Sample started on the demo AIs");
  } catch (e) {
    msg = `<span class="chip amber">skipped</span> ${esc(e.message)}`;
  }
  busy = false; show(idx);
}

function renderPanel(el2) {
  const t = tour || {};
  el2.innerHTML = `<div class="panel"><h3>Onboarding tour <span class="right">${t.completed ? `finished ${t.completedAt ? new Date(t.completedAt).toLocaleDateString() : ""}` : t.skippedAt ? "skipped" : "not taken yet"}</span></h3>
    <div class="row"><button class="btn sm" id="cc-tour-start">Take the tour again</button><span class="dim small">${steps().length} stops, sample run on the demo AIs.${t.sampleRuns ? ` Sample run ${t.sampleRuns}×.` : ""}</span>${t.completed || t.skippedAt ? `<button class="ghost small" id="cc-tour-reset" style="margin-left:auto">reset</button>` : ""}</div>
  </div>`;
  el2.querySelector("#cc-tour-start").addEventListener("click", () => { go("command"); setTimeout(() => start(), 120); });
  el2.querySelector("#cc-tour-reset")?.addEventListener("click", async () => { try { tour = await api("/tour/reset", { method: "POST" }); renderPanel(el2); maybeInvite(); } catch (e) { toast(e.message, true); } });
}

function onMode() { if (idx >= 0) { msg = ""; show(0); } }
window.CC.tour = { start, open: start, state: () => tour, onMode };

CC.register({
  id: "tour",
  settings: { order: 7, render: renderPanel },
  onState() { if (!synced) sync(); else maybeInvite(); },
});
if (S.providers.length && !synced) sync();
