// Look (0.4.19, flag_look): the glass look, its setting, the graphics check and the startup screen.
// With the flag off this module does nothing at all. Rules live in /look-core.js, styles in /look.css.
// No always-on loop: one 1 second frame test, one event-driven long-frame watcher, one debounced observer.
import { normalizeChoice, scoreGraphics, scoreFrames, combineTier, finalTier, decideLook, stutterVerdict, signature, OFFERS, TEST_MS } from "/look-core.js";

const { api, toast, esc } = window.CC;
const LS = "cc.look";
const SPLASH_KEY = "cc.look.splash";
const MAX_LIVE = 3;
const TIER_WORDS = { good: "Good", borderline: "A little slow", weak: "Weak" };

let cfg = null;      // { flag, choice, check }
let info = null;
let tier = "borderline";
let tierReason = "";      // why Auto chose Classic, shown in Settings > Look
let decision = null;
let offered = false;
let watcher = null;
let longFrames = [];

function readLocal() { try { return JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch { return {}; } }
function writeLocal(patch) { try { localStorage.setItem(LS, JSON.stringify({ ...readLocal(), ...patch })); } catch {} }
const still = () => { try { return !!matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const lowPower = () => document.body.classList.contains("light-mode");

// Feature test, not a renderer-name guess: can this window draw backdrop-filter at all?
export function backdropSupported() {
  try {
    if (typeof CSS === "undefined" || !CSS.supports) return true;
    return CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)");
  } catch { return true; }
}

export function graphicsInfo() {
  let renderer = "", accelerated;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) accelerated = false;
    else {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "");
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch { accelerated = undefined; }
  return {
    renderer, accelerated, backdrop: backdropSupported(),
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: navigator.deviceMemory || 0,
    width: screen.width || 0, height: screen.height || 0, dpr: window.devicePixelRatio || 1,
  };
}

function savedCheck() {
  const c = readLocal().check || cfg?.check || null;
  return c && c.sig === signature(info) ? c : null;
}

export function currentChoice() { return normalizeChoice(readLocal().choice ?? cfg?.choice); }

export function apply() {
  const root = document.documentElement;
  if (!cfg?.flag) { root.removeAttribute("data-look"); return null; }
  decision = decideLook(currentChoice(), { tier, reducedMotion: still(), lowPower: lowPower(), backdrop: info ? info.backdrop : true });
  root.dataset.look = decision.look;
  root.dataset.motion = decision.still ? "still" : "full";
  root.dataset.blur = decision.blur && decision.look === "glass" ? "on" : "off";
  refreshLights();
  return decision;
}

async function saveChoice(choice) {
  const c = normalizeChoice(choice);
  writeLocal({ choice: c });
  if (cfg) cfg.choice = c;
  try { await api("/look", { method: "POST", body: { choice: c } }); } catch {}
}
async function saveCheck(check) {
  writeLocal({ check });
  if (cfg) cfg.check = check;
  try { await api("/look", { method: "POST", body: { check } }); } catch {}
}

// At most MAX_LIVE outlines roll at once. The rest stay still.
export function refreshLights() {
  const live = document.documentElement.dataset.look === "glass";
  const all = document.querySelectorAll(".rolling-light");
  let n = 0;
  all.forEach((el) => {
    const on = live && el.dataset.state === "working" && n < MAX_LIVE;
    if (on) n++;
    el.classList.toggle("mm-live", on);
  });
}

function toastUndo(message, undo) {
  const host = document.getElementById("toasts");
  if (!host) { toast(message); return; }
  const t = document.createElement("div");
  t.className = "toast";
  t.append(document.createTextNode(message + " "));
  const a = document.createElement("a");
  a.href = "#"; a.className = "toast-link"; a.textContent = "Undo";
  a.addEventListener("click", (ev) => { ev.preventDefault(); t.remove(); undo(); });
  t.append(a);
  host.appendChild(t);
  setTimeout(() => t.remove(), 10000);
}

// A bounded burst of animation frames with a blurred pane and one rolling light on screen.
export function frameTest(ms = TEST_MS) {
  return new Promise((resolve) => {
    // A window that is hidden or in the background gets slowed frames from the system; that says nothing about the graphics.
    if (document.hidden || (typeof document.hasFocus === "function" && !document.hasFocus())) { resolve({ fps: 0, stutter: false, ok: true, measured: false }); return; }
    const probe = document.createElement("div");
    probe.id = "cc-look-probe";
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
    const deltas = [];
    let last = 0;
    const t0 = performance.now();
    const step = (now) => {
      if (last) deltas.push(now - last);
      last = now;
      if (now - t0 < ms) requestAnimationFrame(step);
      else { probe.remove(); resolve(scoreFrames(deltas)); }
    };
    requestAnimationFrame(step);
  });
}

async function runCheck() {
  const lookup = scoreGraphics(info);
  const frames = await frameTest();
  const fin = finalTier(lookup.tier, frames, info.backdrop);
  tier = fin.tier; tierReason = fin.reason;
  const check = { tier, fps: frames.fps, sig: signature(info), at: Date.now() };
  await saveCheck(check);
  apply();
  maybeOffer();
  return { check, lookup, frames };
}

function offerBar(text, buttons) {
  document.getElementById("cc-look-offer")?.remove();
  // 0.4.21 (F15, M23): no tip on a phone, and on a computer it is docked in the notices row above the page, in
  // normal flow, so it pushes the page down a little and can never sit over Send or any other control.
  if (window.innerWidth <= 760) return;
  const bar = document.createElement("div");
  bar.id = "cc-look-offer";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Look");
  const p = document.createElement("span");
  p.textContent = text;
  bar.append(p);
  for (const b of buttons) {
    const el = document.createElement("button");
    el.type = "button"; el.className = "btn sm"; el.textContent = b.label;
    el.addEventListener("click", () => { bar.remove(); b.run(); });
    bar.append(el);
  }
  const dock = document.getElementById("notices");
  if (dock) { bar.classList.add("docked"); dock.appendChild(bar); } else document.body.appendChild(bar);
  // One quiet line: it goes away by itself so it can never sit over a button for long.
  setTimeout(() => { try { bar.remove(); } catch {} }, 20000);
}

function maybeOffer() {
  if (offered || !decision || !decision.ask) return;
  const sig = signature(info);
  if (readLocal().asked === sig) return;
  offered = true;
  writeLocal({ asked: sig });
  if (decision.ask === "offer-classic") {
    offerBar(OFFERS["offer-classic"], [
      { label: "Yes", run: async () => { await saveChoice("classic"); apply(); } },
      { label: "No", run: async () => { await saveChoice("glass"); apply(); } },
    ]);
  } else if (decision.ask === "offer-glass") {
    offerBar("Meldmind started in the classic look because your graphics are slow. You can try the new look any time.", [
      { label: OFFERS["offer-glass"], run: async () => { await saveChoice("glass"); apply(); } },
      { label: "Not now", run: () => {} },
    ]);
  }
}

// Safety net: long frames while the glass look is on. Never switches silently.
function startWatcher() {
  if (watcher || typeof PerformanceObserver !== "function") return;
  try {
    watcher = new PerformanceObserver((list) => {
      if (document.documentElement.dataset.look !== "glass" || document.hidden) return;
      for (const e of list.getEntries()) longFrames.push({ start: e.startTime, duration: e.duration });
      if (longFrames.length > 60) longFrames = longFrames.slice(-60);
      if (!offered && stutterVerdict(longFrames, performance.now())) {
        offered = true;
        offerBar("The new look is running slowly. Switch to the classic look?", [
          { label: "Switch to classic", run: async () => { await saveChoice("classic"); apply(); } },
          { label: "Keep it", run: () => {} },
        ]);
      }
    });
    watcher.observe({ type: "longtask", buffered: false });
  } catch { watcher = null; }
}

// Startup screen timing (0.4.20, Chris): it stays up at least twice as long as before (2.6 s, or 1.8 s on the
// quiet look) and at least twice as long as the app took to load, then fades out slowly.
// The 2x hold is capped at SPLASH_MAX_MS (12 s) so a very slow start never traps anyone behind the start screen.
const SPLASH_BASE_MS = 2600, SPLASH_BASE_QUIET_MS = 1800, SPLASH_FADE_MS = 900, SPLASH_MAX_MS = 12000;
function splashHold(loadMs, quiet) {
  const base = quiet ? SPLASH_BASE_QUIET_MS : SPLASH_BASE_MS;
  const load = Number.isFinite(loadMs) && loadMs > 0 ? loadMs : 0;
  return Math.min(SPLASH_MAX_MS, Math.max(2 * base, 2 * load));
}

function showStartup() {
  try { if (sessionStorage.getItem(SPLASH_KEY)) return null; sessionStorage.setItem(SPLASH_KEY, "1"); } catch {}
  if (/[?&]nosplash\b/.test(location.search)) return null;
  const quiet = still() || lowPower();
  // 0.4.21: web/index.html already painted this screen from the first frame; adopt it. Build it only if it is missing.
  let el = document.getElementById("cc-startup");
  if (!el) {
    el = document.createElement("div");
    el.id = "cc-startup";
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", "Meldmind.ai. Are you game?");
    el.innerHTML = `<div class="mm-name" aria-hidden="true">Meldmind.ai</div>
    <p class="mm-tag" aria-hidden="true">Are you g<span class="mm-gold">A</span>m<span class="mm-gold">I</span>e?</p>
    <p class="mm-sub" aria-hidden="true">Meldmind never just stops.</p>
    <span class="mm-sr">Are you game?</span>`;
    document.body.appendChild(el);
  }
  el.dataset.owned = "1";
  if (quiet) el.dataset.still = "1";
  let done = false, held = false;
  const close = () => {
    if (done) return;
    done = true;
    document.removeEventListener("keydown", early, true);
    el.classList.add("mm-out");
    setTimeout(() => el.remove(), SPLASH_FADE_MS + 100);
  };
  // A tap or key press can only skip the screen after its minimum time has passed.
  const early = () => { if (held) close(); };
  el.addEventListener("click", early);
  el.addEventListener("touchstart", early, { passive: true });
  document.addEventListener("keydown", early, true);
  const hold = splashHold(performance.now(), quiet);
  setTimeout(() => { held = true; close(); }, hold);
  return el;
}

function panel(el) {
  if (!cfg?.flag) { el.innerHTML = ""; return; }
  const choice = currentChoice();
  const isGlass = document.documentElement.dataset.look === "glass";
  const chk = savedCheck();
  const speed = chk ? `Graphics check: ${esc(TIER_WORDS[chk.tier] || chk.tier)}${chk.fps ? `, about ${chk.fps} frames a second` : ""}.` : "Graphics check has not run yet.";
  el.innerHTML = `<div class="panel" id="cc-look-panel"><h3>Look</h3>
    <label class="row small" style="gap:8px"><input type="checkbox" role="switch" id="look-switch" ${isGlass ? "checked" : ""}> Use the new glass look</label>
    <div class="dim small" id="look-warn" style="margin-top:6px">${decision?.warn ? esc(decision.warn) : ""}</div>
    ${choice === "auto" && decision?.look === "classic" ? `<div class="look-fallback small" id="look-fallback" role="status"><b>Meldmind chose the Classic look for you.</b> ${esc(tierReason || "Your graphics test came back slow.")} The glass look can still work on many screens.
      <label class="row small" style="gap:8px;margin-top:6px"><input type="checkbox" role="switch" id="look-anyway"> Try glass anyway</label></div>` : ""}
    <label class="lbl">Choose a look</label>
    <div class="seg" id="look-seg" role="group" aria-label="Look">${[["auto", "Auto"], ["glass", "Full glass"], ["classic", "Classic"]].map(([id, label]) => `<button type="button" data-look="${id}" class="${choice === id ? "on" : ""}" aria-pressed="${choice === id}">${label}</button>`).join("")}</div>
    <div class="dim small">Auto picks for you. Classic is the look from before: solid panels, no blur, no moving light.</div>
    <div class="row small" style="gap:8px;margin-top:8px"><span class="dim" id="look-speed">${speed}</span><button class="btn sm" type="button" id="look-retest">Test my graphics</button></div>
  </div>`;
  const change = async (next) => {
    const prev = currentChoice();
    await saveChoice(next);
    const d = apply();
    if (d?.warn) toast(d.warn);
    toastUndo("Look changed.", async () => { await saveChoice(prev); apply(); panel(el); });
    panel(el);
  };
  el.querySelector("#look-anyway")?.addEventListener("change", (e) => { if (e.target.checked) change("glass"); });
  el.querySelector("#look-switch").addEventListener("change", (e) => change(e.target.checked ? "glass" : "classic"));
  el.querySelector("#look-seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-look]"); if (b) change(b.dataset.look); });
  el.querySelector("#look-retest").addEventListener("click", async (e) => {
    e.target.disabled = true;
    el.querySelector("#look-speed").textContent = "Testing for about a second.";
    await runCheck();
    panel(el);
  });
}

async function init() {
  try { cfg = await api("/look"); } catch { document.getElementById("cc-startup")?.remove(); return; }
  if (!cfg?.flag) { document.getElementById("cc-startup")?.remove(); return; }
  info = graphicsInfo();
  const chk = savedCheck();
  if (chk) tier = chk.tier; else tier = finalTier(scoreGraphics(info).tier, null, info.backdrop).tier;
  if (tier === "weak") tierReason = info.backdrop === false ? "This window cannot draw see-through glass." : "Graphics acceleration is off, so glass could be slow.";
  apply();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) document.documentElement.dataset.hidden = "1"; else document.documentElement.removeAttribute("data-hidden");
  });
  const view = document.getElementById("view");
  if (view && typeof MutationObserver === "function") {
    let timer = 0;
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(refreshLights, 150); })
      .observe(view, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
  }
  const splash = showStartup();
  if (!chk) {
    // The frame test runs while the startup screen plays, after its first fade-in has started.
    setTimeout(() => { runCheck().catch(() => {}); }, splash ? 700 : 0);
  } else maybeOffer();
  startWatcher();
}

window.CC.look = { splashHold, apply, refreshLights, frameTest, choice: currentChoice, graphicsInfo };

CC.register({
  id: "look",
  settings: { order: 2, render: panel },
  onState() { if (cfg?.flag) apply(); },
});

init();
