// Home for returning users, private mode, who will read a prompt, backup file,
// Do this again, Double-check this, tone buttons, plain credits, and My chats.
const { S, api, toast, esc } = window.CC;

const css = `
#cc-home { margin: 0 0 12px; }
#cc-home h3 { margin: 0 0 4px; }
#cc-home .cc-home-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
#cc-home button.row, #cc-desk-chats button.row { width: 100%; text-align: left; }
/* Home list rows (chats, councils, missions) follow the theme. A bare button paints the browser's white over light theme text. */
#cc-home .cc-home-list button.row { background: var(--bg-2); color: var(--text); border: 1px solid var(--line-2); border-radius: 10px; padding: 8px 10px; cursor: pointer; font-size: 0.875rem; }
#cc-home .cc-home-list button.row:hover { border-color: var(--accent); }
#cc-home .cc-home-list button.row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#cc-home .cc-home-list .chip { background: var(--panel-solid); border-color: var(--line-2); color: var(--text); }
#cc-home .cc-home-list .lbl { font-size: 0.6875rem; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
#cc-home .dim { color: var(--muted); }
#cc-readers { position: fixed; inset: 0; z-index: 80; background: rgba(3,6,12,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
#cc-readers .card { width: min(520px, 100%); background: var(--panel-solid, #0e1522); color: var(--text, #e5e7eb); border: 1px solid var(--line, #1f2937); border-radius: 14px; padding: 16px 18px; }
#cc-readers p { margin: 8px 0; line-height: 1.45; }
.cc-desk-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
#cc-readers .cc-reader { justify-content: space-between; gap: 8px; }
#cc-tones button.on { outline: 2px solid var(--accent, #22d3ee); }
`;
if (!document.getElementById("cc-desk-style")) {
  const style = document.createElement("style");
  style.id = "cc-desk-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function writerName() {
  const live = S.live || {};
  if (live.kind === "council") {
    const c = live.council || {};
    const key = c.winner || c.chair?.model;
    const a = (key && c.answers?.[key]) || null;
    const id = a?.provider || c.chair?.provider;
    return id ? (window.CC.pname ? window.CC.pname(id) : id) : "";
  }
  const run = live.mission || {};
  const id = live.agents?.[live.primary]?.provider || run.provider || run.assembler?.provider;
  if (!id) return "";
  return window.CC.pname ? window.CC.pname(id) : id;
}

function paintHome(host) {
  const cmd = host.closest?.(".cmd") || document.querySelector("#view .cmd");
  const old = document.getElementById("cc-home");
  if (!cmd || S.live?.id) { old?.remove(); return; }
  api("/desk/home").then((card) => {
    if (!document.body.contains(cmd) || S.live?.id || !card?.show) { document.getElementById("cc-home")?.remove(); return; }
    let el = document.getElementById("cc-home");
    if (!el) {
      el = document.createElement("div");
      el.id = "cc-home";
      el.className = "panel";
      // Expert: under Live ops in the right column, so any Live ops strip sits above Welcome back.
      // Simple: under the chat box and My day, so Chat stays at the top.
      const ops = cmd.querySelector("#ops-panel");
      const recent = cmd.querySelector("#simple-recent");
      if (ops) ops.after(el); else if (recent) recent.appendChild(el); else cmd.prepend(el);
    }
    const chats = (card.chats || []).map((c) => `<button type="button" class="row" data-chat="${esc(c.id)}"><span class="chip">${esc(c.kind)}</span>${c.private ? `<span class="chip">Private</span>` : ""}<span style="flex:1">${esc(c.title)}</span></button>`).join("");
    const projects = (card.projects || []).map((p) => `<button type="button" class="btn sm" data-proj="${esc(p.id)}">${esc(p.name)}</button>`).join("");
    el.innerHTML = `<h3>${esc(card.title || "Welcome back")}</h3><p class="dim" style="margin:0">${esc(card.line || "")}</p><div class="cc-home-list" id="cc-desk-chats"><div class="lbl">My chats</div>${chats || `<div class="dim small">No chats yet.</div>`}</div><div class="cc-desk-row">${projects}</div><div class="cc-desk-row"><button type="button" class="btn sm" id="cc-home-new">New chat</button></div>`;
    el.querySelectorAll("[data-chat]").forEach((b) => b.addEventListener("click", () => openChat(b.dataset.chat)));
    el.querySelectorAll("[data-proj]").forEach((b) => b.addEventListener("click", () => { S.view = "projects"; S.openProject = b.dataset.proj; if (window.CC.render) window.CC.render(); }));
    el.querySelector("#cc-home-new")?.addEventListener("click", () => { el.remove(); const box = document.querySelector("#orders"); box?.focus(); });
  }).catch(() => {});
}

async function openChat(id) {
  try {
    const m = await api(`/missions/${id}`);
    S.live = { id: null, kind: null, status: null, agents: {}, tasks: {}, mission: null, council: null, deliverable: "", primary: null };
    S.live.id = m.id;
    S.live.kind = m.kind;
    S.live.status = m.status;
    if (m.kind === "council") { S.live.council = m; S.live.deliverable = m.verdict?.text || ""; }
    else { S.live.mission = m; S.live.deliverable = m.deliverable || ""; if (m.kind !== "mission") S.live.agents = { x: { provider: m.provider, model: m.model, text: m.deliverable, done: true, role: "answer" } }; S.live.primary = "x"; }
    S.view = "command";
    if (window.CC.render) window.CC.render();
  } catch (e) { toast(e.message, true); }
}

const TONE_BUTTONS = [["shorter", "Shorter"], ["warmer", "Warmer"], ["direct", "More direct"], ["plain", "Plain words"]];

function beforeSend({ mode, prompt }) {
  return new Promise((resolve) => {
    api("/desk/readers", { method: "POST", body: { mode, prompt } }).then((info) => {
      const old = document.getElementById("cc-readers");
      old?.remove();
      const readers = (info.readers || []).map((r) => ({ id: r.id || "", name: r.name || "", on: true }));
      const wrap = document.createElement("div");
      wrap.id = "cc-readers";
      const paint = () => {
        const keepPrivate = wrap.querySelector("#cc-readers-private");
        const privateOn = keepPrivate ? keepPrivate.checked : !!info.privateOn;
        const rows = readers.map((r, i) => `<div class="row cc-reader" data-id="${esc(r.id)}"><span>${esc(r.name)}</span>${r.on ? `<button type="button" class="btn sm" data-remove="${i}">Remove</button>` : `<span class="dim small">Removed</span>`}</div>`).join("");
        wrap.innerHTML = `<div class="card" role="dialog" aria-labelledby="cc-readers-title">
          <h3 id="cc-readers-title">${esc(info.title || "Who will read this")}</h3>
          <p>${esc(info.line || "")}</p>
          <div id="cc-reader-list">${rows || `<p class="dim">No AI is connected yet. Add a key in Settings.</p>`}</div>
          <p>${esc(info.toolsLine || "No tools are on.")}</p>
          <p>${esc(info.servicesLine || "No connected service will receive this prompt.")}</p>
          ${info.explain ? `<p>${esc(info.explain)}</p>` : ""}
          ${info.private ? `<p>${esc(info.private)}</p>` : ""}
          <label class="row small" style="gap:6px"><input type="checkbox" id="cc-readers-private" ${privateOn ? "checked" : ""}> Private mode</label>
          <div class="cc-desk-row">
            <button type="button" class="btn sm" id="cc-readers-cancel">Cancel</button>
            <button type="button" class="btn sm primary" id="cc-readers-go">Send</button>
          </div>
        </div>`;
        wrap.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
          const still = readers.filter((r) => r.on);
          if (still.length <= 1) { toast("Keep at least one AI."); return; }
          readers[Number(b.dataset.remove)].on = false;
          paint();
        }));
        wrap.querySelector("#cc-readers-cancel").addEventListener("click", () => finish(false));
        wrap.querySelector("#cc-readers-go").addEventListener("click", send);
      };
      const finish = (value) => { wrap.remove(); resolve(value); };
      const send = async () => {
        const on = !!wrap.querySelector("#cc-readers-private")?.checked;
        try {
          if (!!S.settings.privateMode !== on) {
            await api("/settings", { method: "POST", body: { privateMode: on } });
            S.settings.privateMode = on;
          }
          if (info.explain) {
            await api("/settings", { method: "POST", body: { councilIntro: true } });
            S.settings.councilIntro = true;
          }
        } catch (e) { toast(e.message, true); }
        const skip = readers.filter((r) => !r.on && r.id).map((r) => r.id);
        finish({ ok: true, skip });
      };
      document.body.appendChild(wrap);
      paint();
    }).catch((e) => { toast(e.message, true); resolve(false); });
  });
}

window.CC.desk = { beforeSend };

function toneLabel(id) {
  return (TONE_BUTTONS.find((t) => t[0] === id) || [])[1] || "";
}

function renderCommand(container) {
  paintHome(container);
  // Simple shows recent chats only. Private mode and tones stay in Expert and Settings.
  if (S.uiMode === "simple") { container.innerHTML = ""; return; }
  const on = !!S.settings?.privateMode;
  const armed = S.settings?.nextTone || "";
  const tones = TONE_BUTTONS.map(([id, label]) => `<button type="button" class="btn sm ${armed === id ? "on" : ""}" data-tone="${id}">${label}</button>`).join("");
  const toneLine = armed ? `Next answer: ${toneLabel(armed)}. This does not send.` : "These set the tone of the next answer only. They do not send.";
  container.innerHTML = `<label class="row small" style="gap:6px"><input type="checkbox" id="cc-private" ${on ? "checked" : ""}> Private mode</label><p class="dim small" id="cc-private-line" style="margin:4px 0 0">${on ? "Private mode is on. This stays on this computer. It is not used to teach the router, and it is left out of sync." : "A council or mission lists who will read the prompt before it is sent. You can remove one reader."}</p><div class="cc-desk-row" id="cc-tones">${tones}</div><p class="dim small" id="cc-tone-line">${esc(toneLine)}</p><div class="cc-desk-row"><button type="button" class="btn sm" id="cc-my-chats">My chats</button></div><div id="cc-chat-list"></div>`;
  container.querySelector("#cc-private").addEventListener("change", async (e) => {
    const next = !!e.target.checked;
    try {
      const r = await api("/desk/private", { method: "POST", body: { on: next } });
      S.settings.privateMode = !!r.privateMode;
      const line = container.querySelector("#cc-private-line");
      if (line) line.textContent = r.line || "";
    } catch (err) { e.target.checked = !next; toast(err.message, true); }
  });
  container.querySelector("#cc-my-chats").addEventListener("click", async () => {
    const box = container.querySelector("#cc-chat-list");
    try {
      const r = await api("/desk/chats");
      const rows = r.chats || [];
      box.innerHTML = rows.length ? rows.slice(0, 12).map((c) => `<button type="button" class="row" data-chat="${esc(c.id)}" style="width:100%;text-align:left"><span class="chip">${esc(c.kind)}</span>${c.private ? `<span class="chip">Private</span>` : ""}<span style="flex:1">${esc(c.title)}</span></button>`).join("") : `<div class="dim small">No chats yet.</div>`;
      box.querySelectorAll("[data-chat]").forEach((b) => b.addEventListener("click", () => openChat(b.dataset.chat)));
    } catch (err) { toast(err.message, true); }
  });
  container.querySelectorAll("#cc-tones [data-tone]").forEach((b) => b.addEventListener("click", () => setTone(b.dataset.tone, container)));
}

async function setTone(tone, container) {
  try {
    const r = await api("/desk/tone", { method: "POST", body: { tone } });
    S.settings.nextTone = r.tone || null;
    container.querySelectorAll("#cc-tones [data-tone]").forEach((b) => b.classList.toggle("on", b.dataset.tone === (r.tone || "")));
    const line = container.querySelector("#cc-tone-line");
    if (line) line.textContent = r.line || "";
    toast(r.line || "Tone saved.");
  } catch (e) { toast(e.message, true); }
}

function answerProviderId() {
  const live = S.live || {};
  if (live.kind === "council") {
    const c = live.council || {};
    const key = c.winner || c.chair?.model;
    const a = (key && c.answers?.[key]) || null;
    return a?.provider || c.chair?.provider || "";
  }
  const run = live.mission || {};
  return live.agents?.[live.primary]?.provider || run.provider || run.assembler?.provider || "";
}
function isPractice(id, name) {
  if (String(id || "").startsWith("demo-")) return true;
  const p = window.CC.P?.(id);
  if (p?.demo) return true;
  return /\(demo\)/i.test(String(name || ""));
}
function renderDeliverable(container, live) {
  if (!live?.id) { container.innerHTML = ""; return; }
  const id = live.id;
  const name = writerName();
  const practice = isPractice(answerProviderId(), name);
  const review = (S.live.council || S.live.mission || {}).doubleCheck;
  container.innerHTML = `<div class="cc-desk-tools">
    ${practice ? `<div class="panel" id="cc-practice" role="status"><p class="small" style="margin:0 0 8px">Sample answer: add a key for real answers. Nothing was spent.</p><button type="button" class="btn sm" id="cc-practice-go">Get real answers</button></div>` : ""}
    ${name ? `<p class="small cc-written" style="margin:6px 0">Written by ${esc(name)}.</p>` : ""}
    ${review?.text ? `<div class="panel"><h3>Double-check</h3><p class="small">${esc(review.line || "")}</p><div class="md">${esc(review.text)}</div></div>` : ""}
    <div class="cc-desk-row">
      <button type="button" class="btn sm" id="cc-again">Do this again</button>
      <button type="button" class="btn sm" id="cc-check">Double-check this</button>
    </div>
  </div>`;
  container.querySelector("#cc-practice-go")?.addEventListener("click", () => {
    S.settingsMore = true;
    S.navFocus = "#settings-keys";
    S.view = "settings";
    if (window.CC.render) window.CC.render();
  });
  container.querySelector("#cc-again").addEventListener("click", async () => {
    try {
      const r = await api("/desk/repeat", { method: "POST", body: { id } });
      toast(r.ok ? "Running that again." : "Could not repeat that.");
    } catch (e) { toast(e.message, true); }
  });
  container.querySelector("#cc-check").addEventListener("click", async () => {
    try {
      const r = await api("/desk/review", { method: "POST", body: { id } });
      const target = S.live.council || S.live.mission;
      if (target) target.doubleCheck = r.review;
      toast(r.review?.line || "Checked.");
      if (window.CC.render) window.CC.render();
    } catch (e) { toast(e.message, true); }
  });
}

function renderCredits(container) {
  api("/desk/credits").then((r) => {
    const rows = (r.rows || []).map((row) => `<div class="small">${esc(row.line)}</div>`).join("");
    const leftRows = r.left || [];
    const left = leftRows.length
      ? leftRows.map((row) => `<div class="small">${esc(row.line)}</div>`).join("")
      : `<div class="small">This AI does not tell Meldmind its balance.</div>`;
    container.innerHTML = `<div class="panel"><h3>AI credits</h3><p>${esc(r.line || "")}</p>${rows}${left}</div>`;
  }).catch(() => {});
}

function renderSettings(container) {
  const on = !!S.settings?.privateMode;
  container.innerHTML = `<div class="panel" id="cc-desk-settings">
    <h3>Backup and restore</h3>
    <p class="dim small">One file for your projects, chats, and settings. AI keys are not in this file. Private chats are included and stay marked private.</p>
    <div class="cc-desk-row">
      <button type="button" class="btn sm" id="cc-backup">Download backup</button>
      <label class="btn sm">Restore<input id="cc-restore" type="file" accept="application/json,.json" hidden></label>
    </div>
    <label class="row small" style="gap:6px;margin-top:10px"><input type="checkbox" id="cc-set-private" ${on ? "checked" : ""}> Private mode</label>
    <p class="dim small">Do this again is part of Pro. Double-check this is free. A council or mission lists who will read the prompt before it is sent. You can remove one reader. Tone buttons set the next answer only and do not send. AI credits shows what is left for each AI.</p>
  </div>`;
  container.querySelector("#cc-backup").addEventListener("click", async () => {
    try {
      const file = await api("/desk/backup");
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "meldmind-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
      toast("Backup downloaded. AI keys are not in this file.");
    } catch (e) { toast(e.message, true); }
  });
  container.querySelector("#cc-restore").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      if (!(await window.CC.confirm("Restore this backup? Projects in the file replace the project list. Chats in the file are put back. AI keys on this computer stay."))) return;
      const r = await api("/desk/restore", { method: "POST", body: data });
      toast(`Restored ${r.projects} projects and ${r.chats} chats. Keys were not in the file.`);
      if (window.CC.refresh) window.CC.refresh();
    } catch (err) { toast(err.message, true); }
  });
  container.querySelector("#cc-set-private").addEventListener("change", async (e) => {
    const next = !!e.target.checked;
    try {
      const r = await api("/desk/private", { method: "POST", body: { on: next } });
      S.settings.privateMode = !!r.privateMode;
    } catch (err) { e.target.checked = !next; toast(err.message, true); }
  });
}

window.CC.register({
  id: "desk",
  command: { order: 4, render: renderCommand },
  deliverable: { order: 15, render: renderDeliverable },
  credits: { order: 5, render: renderCredits },
  settings: { order: 12, render: renderSettings },
});
