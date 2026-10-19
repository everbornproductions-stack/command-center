// Onboarding tour: a first-run walkthrough with a spotlight on each part of the console and a
// sample run on the demo AIs (no keys, no spend). State lives on the server (/api/tour); the tour
// offers itself once with a small invite and can be restarted from Settings.
const { S, api, toast, esc, go, refresh } = window.CC;

const STEPS = [
  { id: "welcome", title: "Welcome to Meldmind", body: "Take command of all your AIs. One console for every AI you pay for. Give orders once; the console picks the right AI for each part, lets them check each other's work, and keeps score of what everything costs. This tour takes two minutes and uses three pretend AIs, so nothing is spent." },
  { id: "strip", target: "#strip", view: "command", title: "The status strip", body: "One tile per AI. Green: the key works. Amber: an incident, slow, or low balance. Red: key rejected or out of credits. Grey: no key yet. A tile pulses while that AI is working." },
  { id: "orders", target: "#orders", view: "command", title: "Marching orders", body: "Type what you want in plain words. The router classifies the job (what kind of work, how hard, needs the web?) and sends each part to the best available AI for it." },
  { id: "modes", target: "#run-mode", view: "command", title: "Single, Council or Mission", body: "Single: the best AI for the job answers. Council: several answer at once, review each other anonymously, and a chair writes the verdict. Mission: a planner splits the goal, specialists work in parallel, a different AI QA-checks each piece, an assembler compiles the result." },
  { id: "sample", target: "#graph", view: "command", title: "Run the sample", body: "Three demo AIs plan a one-week Instagram launch for a coffee roaster. Demo mode turns on by itself; no keys are needed and nothing is spent.", action: "sample" },
  { id: "ops", target: "#graph", view: "command", title: "Live ops", body: "Watch who is working and who is talking to whom. Tasks fill in as they finish; QA sends a piece back for one revision when it falls short." },
  { id: "deliverable", target: "#out-md", view: "command", title: "The deliverable", body: "The assembled result lands here. Copy it, see the savings receipt under it, and find it later under the project it was filed to." },
  { id: "tabs", target: "#tabs", view: "command", title: "Projects, Credits, Subscriptions", body: "Projects link to where the work really lives. Credits shows spend by day and by AI plus who is best at what. Subscriptions tracks what you pay, renewals, credits left and runway." },
  { id: "keys", title: "Ready for real answers?", body: "Add your own API keys with the guided setup: it shows where to get each key, you paste it, the console tests it, then seals it in the vault. Keys never leave this machine and are never shown again.", action: "keys" },
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
@media (max-width: 760px) { #cc-tour .card { left: 12px !important; right: 12px; bottom: calc(var(--strip-h) + 64px); top: auto !important; width: auto; } .cc-tour-invite { left: 12px; right: 12px; bottom: calc(var(--strip-h) + 66px); } }
`;
const style = document.createElement("style"); style.id = "cc-tour"; style.textContent = css; document.head.appendChild(style);

let tour = null;      // server state
let synced = false;
let idx = -1;         // current step (-1 = closed)
let el = null;        // overlay root
let timer = null;     // reposition loop
let msg = "";         // message under the current step (sample result etc.)
let busy = false;

async function sync() { try { tour = await api("/tour"); synced = true; } catch {} maybeInvite(); }

// ---- the invite pill (shown once, until started or dismissed) ----
function maybeInvite() {
  const existing = document.querySelector(".cc-tour-invite");
  const show = tour && !tour.completed && !tour.skippedAt && idx < 0 && S.view !== "setup";
  if (!show) { existing?.remove(); return; }
  if (existing) return;
  const d = document.createElement("div"); d.className = "cc-tour-invite";
  d.innerHTML = `<span>👋</span><span>New here? <b>Take the two-minute tour</b>: it runs a sample on pretend AIs.</span><button class="btn sm primary" id="cc-tour-go">Start</button><button class="ghost small" id="cc-tour-later">Not now</button>`;
  document.body.appendChild(d);
  d.querySelector("#cc-tour-go").addEventListener("click", () => start());
  d.querySelector("#cc-tour-later").addEventListener("click", async () => { d.remove(); try { tour = await api("/tour/skip", { method: "POST" }); } catch {} });
}
// Views re-render into #view; re-check whether the invite should show (e.g. after leaving Setup).
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
async function skip() { close(); try { tour = await api("/tour/skip", { method: "POST" }); } catch {} toast("Tour skipped. Restart it any time from Settings."); }
async function finish() { close(); try { tour = await api("/tour/complete", { method: "POST" }); } catch {} toast("Tour done. Add a key in Settings when you are ready for real answers."); }
function next() { if (idx >= STEPS.length - 1) return finish(); msg = ""; show(idx + 1); }
function back() { if (idx > 0) { msg = ""; show(idx - 1); } }

function show(i) {
  idx = i; const st = STEPS[i];
  if (st.view && S.view !== st.view) { go(st.view); }
  const last = i === STEPS.length - 1;
  const card = el.querySelector(".card");
  card.innerHTML = `<div class="row" style="gap:8px"><h4>${esc(st.title)}</h4><span class="step">${i + 1} / ${STEPS.length}</span></div>
    <div class="muted">${esc(st.body)}</div>
    ${st.action === "sample" ? `<div class="row" style="margin-top:10px"><button class="btn sm primary" id="cc-tour-sample" ${busy ? "disabled" : ""}>${busy ? "Starting…" : "Run the sample now"}</button><span class="dim small">about 30 seconds</span></div>` : ""}
    ${st.action === "keys" ? `<div class="row" style="margin-top:10px"><button class="btn sm primary" id="cc-tour-keys">Set up my keys</button><span class="dim small">or finish and do it later in Settings</span></div>` : ""}
    ${msg ? `<div class="msg">${msg}</div>` : ""}
    <div class="dots">${STEPS.map((_, k) => `<i class="${k === i ? "on" : k < i ? "done" : ""}"></i>`).join("")}</div>
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
  const st = STEPS[idx]; const spot = el.querySelector(".spot"), card = el.querySelector(".card");
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

async function runSample() {
  if (busy) return; busy = true; show(idx);
  try {
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
    <div class="row"><button class="btn sm" id="cc-tour-start">Take the tour</button><span class="dim small">Nine stops, two minutes, sample run on the demo AIs.${t.sampleRuns ? ` Sample run ${t.sampleRuns}×.` : ""}</span>${t.completed || t.skippedAt ? `<button class="ghost small" id="cc-tour-reset" style="margin-left:auto">reset</button>` : ""}</div>
  </div>`;
  el2.querySelector("#cc-tour-start").addEventListener("click", () => { go("command"); setTimeout(() => start(), 120); });
  el2.querySelector("#cc-tour-reset")?.addEventListener("click", async () => { try { tour = await api("/tour/reset", { method: "POST" }); renderPanel(el2); maybeInvite(); } catch (e) { toast(e.message, true); } });
}

window.CC.tour = { start, open: start, state: () => tour };

CC.register({
  id: "tour",
  settings: { order: 7, render: renderPanel },
  onState() { if (!synced) sync(); else maybeInvite(); },
});
if (S.providers.length && !synced) sync();
