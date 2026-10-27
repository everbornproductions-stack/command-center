// "Type it, get the finished thing" (0.4.21): in chat, a request to make a picture, a video or a voice runs the
// right maker at once and the finished result plays INLINE in the answer panel. No Estimate step: one price
// line with a small Stop, a practice run is free, and a price above the person's guard is asked once, inline.
// Follow-ups in the same chat ("make it sunset", "another one") add a new result under the old one, linked in
// MindMedia as versions of the same item. The DOM ids are listed in docs/make-in-chat.md.
//   CC.makeChat.handle(prompt) -> true when the chat message was handled here
//   CC.makeChat.reset()        -> forget the made things (a normal chat answer follows)
//   CC.makeChat.mount()        -> put the results back after the view was redrawn
import { makeIntent, followupIntent, priceLine } from "../make-intent.js";
const { S, api, apiBlobUrl, toast, esc, go } = window.CC;

const LABEL = { image: "Picture", video: "Video", audio: "Voice" };
const MAKING = { image: "Making your image...", video: "Making your video...", audio: "Making your voice..." };
const CSS = `
#simple-answer.mk-on > #out-md, #simple-answer.mk-on > #cc-answer-line, #simple-answer.mk-on > #out-follow, #simple-answer.mk-on > #cc-fail-slot, #simple-answer.mk-on > #deliv-extras, #simple-answer.mk-on > h3 { display: none; }
#mk-root { display: flex; flex-direction: column; gap: 14px; }
.mk-tile { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--line-2, var(--line)); border-radius: var(--radius, 10px); background: var(--panel-solid, transparent); color: var(--text); }
.mk-head { font-size: .85rem; color: var(--muted); overflow-wrap: anywhere; }
.mk-price { font-size: .95rem; }
.mk-progress { color: var(--muted); display: flex; align-items: center; gap: 8px; }
.mk-progress::before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line-2, var(--line)); border-top-color: var(--accent, currentColor); animation: mk-spin 1s linear infinite; }
@keyframes mk-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mk-progress::before { animation: none; } }
.mk-media { display: flex; justify-content: center; }
.mk-media img, .mk-media video { max-width: 100%; max-height: 70vh; border-radius: 8px; background: #0003; }
.mk-media audio { width: 100%; }
.mk-actions, .mk-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mk-change { display: flex; gap: 8px; }
.mk-change input { flex: 1; min-width: 0; }
.mk-how summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
.mk-how p { margin: 6px 0 0; font-size: .85rem; overflow-wrap: anywhere; }
.mk-fail { color: var(--text); }
.mk-note { color: var(--muted); font-size: .8rem; }
.mk-link { background: none; border: 0; padding: 0; color: var(--muted); font-size: .8rem; text-decoration: underline; cursor: pointer; }
`;
if (!document.getElementById("mk-css")) { const st = document.createElement("style"); st.id = "mk-css"; st.textContent = CSS; document.head.appendChild(st); }

const blobs = new Map();
const blobOf = (url) => { if (!blobs.has(url)) blobs.set(url, apiBlobUrl(url)); return blobs.get(url); };
const st = () => (S.make ||= { active: false, tiles: [], last: null, seq: 0, again: {} });
const find = (id) => st().tiles.find((t) => t.id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = () => document.getElementById("simple-answer") || document.getElementById("deliv-panel");

function extOf(t) {
  const n = String(t.fileName || "").match(/\.([a-z0-9]{2,4})$/i);
  if (n) return n[1].toLowerCase();
  return t.kind === "video" ? "mp4" : t.kind === "audio" ? "wav" : "png";
}
const isStill = (t) => t.kind === "image" || /^(svg|png|jpe?g|webp|gif)$/.test(extOf(t));

// ---------- painting ----------
function tileHtml(t, isLast) {
  const head = t.change ? `Change: ${t.change}` : t.another ? `Another ${LABEL[t.kind].toLowerCase()}` : `${LABEL[t.kind]}: ${t.request}`;
  let body = "";
  if (t.state === "planning") body = `<div class="mk-progress" role="status">Getting ready...</div>`;
  else if (t.state === "ask") body = `<div class="mk-price" role="status">This one costs about $${Number(t.usd).toFixed(2)}. Make it?</div><div class="mk-row"><button type="button" data-mk="ask-yes" class="btn sm primary mk-ask-yes">Yes, make it</button><button type="button" data-mk="ask-no" class="btn sm mk-ask-no">No thanks</button></div>`;
  else if (t.state === "working") body = `<div class="mk-price">${esc(t.priceLine)}</div><div class="mk-progress" role="status" aria-live="polite">${esc(t.progress || MAKING[t.kind])}</div><div class="mk-row"><button type="button" data-mk="stop" class="btn sm mk-stop" title="Stop waiting for this">Stop</button></div>`;
  else if (t.state === "done") {
    const media = t.src ? (isStill(t) ? `<img class="mk-img" alt="${esc(t.request)}" src="${esc(t.src)}">` : t.kind === "video" ? `<video class="mk-video" controls playsinline src="${esc(t.src)}"></video>` : `<audio class="mk-audio" controls src="${esc(t.src)}"></audio>`) : `<span class="mk-note">Loading...</span>`;
    const practiceNote = t.practice ? `<div class="mk-note">${t.kind === "image" ? "Practice picture: free, and drawn on your computer. Connect a picture maker for a real one." : t.kind === "video" ? "Practice video: a still frame, nothing was spent. Connect a video maker for a real clip." : "Practice voice: a silent clip, nothing was spent. Connect a voice maker for a real voice."}</div>` : "";
    body = `<div class="mk-media">${media}</div>${practiceNote}
      ${window.CC.resultHero ? window.CC.resultHero.actionsHtml(t) : `<div class="mk-actions"><button type="button" data-mk="dl" class="btn sm primary mk-dl">Download</button><button type="button" data-mk="again" class="btn sm mk-again">Make another</button><button type="button" data-mk="open" class="btn sm mk-open">Open in MindMedia</button></div>`}
      ${`<div class="mk-change"><input class="mk-change-input" type="text" aria-label="Change it" placeholder="${t.kind === "image" ? "Change it: make the sky darker" : t.kind === "video" ? "Change it: make it slower" : "Change it: warmer voice"}"><button type="button" data-mk="change-go" class="btn sm mk-change-go">Change it</button></div>`}
      <details class="mk-how"><summary>How it was made</summary><p>${esc(t.providerName || "")}${t.practice ? " (practice)" : t.usd ? `, about $${Number(t.usd).toFixed(2)}` : ""}.</p>${t.kind !== "audio" ? `<p><b>Prompt used:</b> ${esc(t.generatorPrompt || "")}</p>` : ""}<p class="mk-note">Saved in MindMedia as "${esc(t.name || "")}".</p></details>`;
  } else if (t.state === "error") {
    body = `<div class="mk-fail" role="alert">${esc(t.error || "That did not work.")}</div>${t.next ? `<div class="mk-row"><button type="button" data-mk="next" class="btn sm primary mk-next">${esc(t.next.label)}</button></div>` : ""}`;
  } else if (t.state === "stopped") body = `<div class="mk-note" role="status">Stopped. If it had already started, it still shows up in MindMedia.</div>`;
  const foot = isLast && t.state !== "planning" ? `<div><button type="button" data-mk="chat-instead" class="mk-link mk-chat-instead">I wanted an answer in words</button></div>` : "";
  return `<section class="mk-tile" data-id="${esc(t.id)}" data-kind="${t.kind}" data-state="${t.state}"><div class="mk-head">${esc(head)}</div>${body}${foot}</section>`;
}

function paint() {
  const root = document.getElementById("mk-root"); if (!root) return;
  const keep = new Map([...root.querySelectorAll(".mk-change-input")].map((i) => [i.closest(".mk-tile")?.dataset.id, i.value]));
  const tiles = st().tiles;
  root.innerHTML = tiles.map((t, i) => tileHtml(t, i === tiles.length - 1)).join("");
  for (const i of root.querySelectorAll(".mk-change-input")) { const v = keep.get(i.closest(".mk-tile")?.dataset.id); if (v) i.value = v; }
}

function ensureRoot() {
  const panel = target(); if (!panel) return null;
  let root = document.getElementById("mk-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "mk-root";
    root.setAttribute("aria-label", "Made in chat");
    panel.prepend(root);
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList?.contains("mk-change-input")) { e.preventDefault(); root.querySelector(`.mk-tile[data-id="${e.target.closest(".mk-tile").dataset.id}"] .mk-change-go`)?.click(); } });
  }
  panel.classList.add("mk-on");
  panel.hidden = false;
  return root;
}

function mount() {
  const s = S.make; if (!s?.active || !s.tiles.length) return;
  if (document.getElementById("mk-root")) return;
  if (!ensureRoot()) return;
  paint();
  for (const t of s.tiles) if (t.state === "done" && t.fileUrl && !t.src) fill(t);
}

function reset() {
  S.make = null;
  document.getElementById("mk-root")?.remove();
  document.getElementById("simple-answer")?.classList.remove("mk-on");
}

// ---------- the flow ----------
async function fill(t) {
  try { t.src = t.remoteUrl || await blobOf(t.fileUrl); } catch (e) { t.state = "error"; t.error = e.message || "Could not open the file."; }
  paint();
}

function failTile(t, e) {
  t.state = "error"; t.error = e.message || "That did not work."; t.next = e.next || null;
  if (!t.next && (e.code === "needs_ok")) t.next = null;
  paint();
}

function saved(t) {
  const where = t.projectId && t.projectId !== "unfiled" ? "your project" : "Unfiled";
  t.saved = true;
  window.dispatchEvent(new CustomEvent("cc:mindmedia-saved", { detail: { ok: true, projectId: t.projectId, items: [{ id: t.assetId }], savedWhere: `Saved in MindMedia, ${where}.` } }));
}

async function pollJob(t) {
  const deadline = Date.now() + 25 * 60 * 1000;
  let n = 0;
  while (t.state === "working" && Date.now() < deadline) {
    await sleep(n++ < 5 ? 1200 : 3000);
    if (t.state !== "working") return;
    let j;
    try { j = await api(`/make/job/${encodeURIComponent(t.jobId)}`); } catch (e) { if (n > 3) return failTile(t, e); continue; }
    if (j.state === "done") {
      t.fileUrl = j.fileUrl; t.remoteUrl = j.remoteUrl; t.fileName = j.fileName; t.practice = j.practice; t.state = "done";
      if (!t.fileUrl && !t.remoteUrl) return failTile(t, new Error("It finished, but there is no file to show."));
      saved(t); paint(); await fill(t);
      if (t.kind === "video" && !t.practice && document.hidden) toast("Your video is ready.", false, { label: "Show", onClick: () => document.querySelector(`.mk-tile[data-id="${t.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }) });
      else if (t.kind === "video" && !t.practice) toast("Your video is ready.");
      return;
    }
    if (j.state === "error") return failTile(t, new Error(j.error || "It could not be made. Nothing was saved."));
    t.progress = j.progress ? `Making your ${t.kind === "audio" ? "voice" : t.kind}... ${j.progress}` : MAKING[t.kind];
    const el = document.querySelector(`.mk-tile[data-id="${t.id}"] .mk-progress`); if (el) el.textContent = t.progress;
  }
  if (t.state === "working") failTile(t, new Error("This is taking longer than expected. It may still finish: look in MindMedia in a few minutes."));
}

async function execute(t, plan) {
  t.state = "working"; t.priceLine = priceLine(plan.usd, plan.practice); t.progress = MAKING[t.kind]; t.usd = plan.usd; t.practice = plan.practice;
  t.providerName = plan.providerName; t.generatorPrompt = plan.generatorPrompt; paint();
  // a paid job waits a moment first, so Stop costs nothing
  if (plan.usd > 0) { await sleep(1400); if (t.state !== "working") return; }
  t.ctl = new AbortController();
  try {
    const r = await api("/make/run", { method: "POST", signal: t.ctl.signal, body: { ...t.req, generatorPrompt: plan.generatorPrompt, writtenBy: plan.writtenBy, okUsd: plan.usd, projectId: S.project || null } });
    if (t.state !== "working") return;
    Object.assign(t, { assetId: r.assetId, projectId: r.projectId, name: r.name, generatorPrompt: r.generatorPrompt, providerName: r.providerName, usd: r.usd, practice: r.practice });
    st().last = t;
    if (r.state === "done") {
      Object.assign(t, { state: "done", fileUrl: r.fileUrl, fileName: r.fileName });
      saved(t); paint(); await fill(t);
    } else { t.jobId = r.jobId; paint(); pollJob(t); }
  } catch (e) {
    if (e?.name === "AbortError" || t.state !== "working") return;
    failTile(t, e);
  }
}

async function begin(spec) {
  const s = st();
  if (!ensureRoot()) return false;
  s.active = true;
  const id = "mk" + (++s.seq);
  const base = spec.from || s.last;
  const root = spec.root || base?.root || spec.request;
  const version = spec.change || spec.another ? (s.tiles.filter((x) => x.root === root).length + 1) : 1;
  const t = { id, kind: spec.kind, request: spec.request, change: spec.change || "", another: spec.another || 0, root, state: "planning", seconds: spec.seconds || 5 };
  t.req = { kind: spec.kind, request: spec.change ? `${root}, ${spec.change}` : spec.request, rootRequest: root, seconds: t.seconds, version, change: spec.change || undefined, another: spec.another || undefined, previousPrompt: (spec.change || spec.another) ? (base?.generatorPrompt || "") : "", parentAssetId: (spec.change || spec.another) ? (base?.assetId || "") : "" };
  s.tiles.push(t);
  paint();
  document.querySelector(`.mk-tile[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  try {
    const plan = await api("/make/plan", { method: "POST", body: t.req });
    if (t.state === "stopped") return true;
    if (plan.needsOk) { t.state = "ask"; t.usd = plan.usd; t.plan = plan; paint(); return true; }
    await execute(t, plan);
  } catch (e) { failTile(t, e); }
  return true;
}

// ---------- clicks ----------
async function download(t) {
  try {
    const u = t.src || await blobOf(t.fileUrl);
    const a = document.createElement("a"); a.href = u; a.download = `${(t.name || "meldmind").replace(/[\\/:*?"<>|]+/g, " ").trim()}.${extOf(t)}`; document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast(e.message, true); }
}
function onClick(e) {
  const tileEl = e.target.closest(".mk-tile"); if (!tileEl) return;
  const t = find(tileEl.dataset.id); if (!t) return;
  const has = (c) => e.target.closest(c);
  if (window.CC.resultHero?.handleClick(e, { tile: t, change: (change) => begin({ kind: t.kind, request: t.request, root: t.root, change, from: t, seconds: t.seconds }), openRoute: () => window.CC.resultHero.openRoute({ kind: t.kind, projectId: t.projectId, assetId: t.assetId, name: t.name, box: tileEl.querySelector(".rh-pubbox") || tileEl.appendChild(Object.assign(document.createElement("div"), { className: "rh-pubbox" })) }) })) return;
  if (has(".mk-ask-yes")) { t.state = "working"; execute(t, t.plan); return; }
  if (has(".mk-ask-no")) { t.state = "stopped"; paint(); return; }
  if (has(".mk-stop")) { t.state = "stopped"; t.ctl?.abort(); paint(); return; }
  if (has(".mk-dl")) return void download(t);
  if (has(".mk-open")) return void window.CC.openMindMedia?.(t.projectId, t.assetId);
  if (has(".mk-again")) { const s = st(); s.again[t.root] = (s.again[t.root] || 1) + 1; return void begin({ kind: t.kind, request: t.request, root: t.root, another: s.again[t.root], from: t, seconds: t.seconds }); }
  if (has(".mk-change-go")) {
    const input = tileEl.querySelector(".mk-change-input"); const change = input.value.trim();
    if (!change) { input.focus(); toast("Say what to change, like \"make the sky darker\".", true); return; }
    input.value = "";
    return void begin({ kind: t.kind, request: t.request, root: t.root, change, from: t, seconds: t.seconds });
  }
  if (has(".mk-next")) { const g = t.next?.go; if (g) go(g); return; }
  if (has(".mk-chat-instead")) {
    const asked = t.root || t.request;
    reset(); S.skipMake = true;
    const box = document.getElementById("orders"); if (box) { box.value = asked; S.lastOrders = asked; }
    document.getElementById("go")?.click();
  }
}

// ---------- the one entry point from the chat send ----------
async function handle(prompt) {
  const text = String(prompt || "").trim();
  const intent = makeIntent(text);
  const s = S.make;
  if (intent && intent.kind === "music") {
    if (!ensureRoot()) return false;
    const t = { id: "mk" + (++st().seq), kind: "audio", request: text, state: "error", error: "Meldmind can make a spoken voice or narration, but not songs or music yet. You can ask it to read the words as a voiceover.", next: null, root: text };
    st().active = true; st().tiles.push(t); paint(); return true;
  }
  if (intent) return begin({ kind: intent.kind, request: intent.subject || text, seconds: intent.seconds, root: intent.subject || text });
  const fu = s?.active && s.last && followupIntent(text);
  if (fu) {
    const base = s.last;
    return fu.type === "another"
      ? (s.again[base.root] = (s.again[base.root] || 1) + 1, begin({ kind: base.kind, request: base.request, root: base.root, another: s.again[base.root], from: base, seconds: base.seconds }))
      : begin({ kind: base.kind, request: base.request, root: base.root, change: fu.change, from: base, seconds: base.seconds });
  }
  return false;
}

window.CC.makeChat = { handle, reset, mount, intent: makeIntent };
