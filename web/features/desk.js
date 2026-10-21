// Home for returning users, private mode, who will read a prompt, backup file,
// Do this again, Double-check this, tone buttons, plain credits, and My chats.
const { S, api, toast, esc } = window.CC;

const css = `
#cc-home { margin: 0 0 12px; }
#cc-home h3 { margin: 0 0 4px; }
#cc-home .cc-home-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
#cc-home button.row, #cc-desk-chats button.row { width: 100%; text-align: left; }
#cc-readers { position: fixed; inset: 0; z-index: 80; background: rgba(3,6,12,.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
#cc-readers .card { width: min(520px, 100%); background: var(--panel-solid, #0e1522); color: var(--text, #e5e7eb); border: 1px solid var(--line, #1f2937); border-radius: 14px; padding: 16px 18px; }
#cc-readers p { margin: 8px 0; line-height: 1.45; }
.cc-desk-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
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
      cmd.prepend(el);
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

function beforeSend({ mode, prompt }) {
  return new Promise((resolve) => {
    api("/desk/readers", { method: "POST", body: { mode, prompt } }).then((info) => {
      const old = document.getElementById("cc-readers");
      old?.remove();
      const wrap = document.createElement("div");
      wrap.id = "cc-readers";
      wrap.innerHTML = `<div class="card" role="dialog" aria-labelledby="cc-readers-title">
        <h3 id="cc-readers-title">${esc(info.title || "Who will read this")}</h3>
        <p>${esc(info.line || "")}</p>
        ${info.explain ? `<p>${esc(info.explain)}</p>` : ""}
        ${info.private ? `<p>${esc(info.private)}</p>` : ""}
        <label class="row small" style="gap:6px"><input type="checkbox" id="cc-readers-private" ${info.privateOn ? "checked" : ""}> Private mode</label>
        <div class="cc-desk-row">
          <button type="button" class="btn sm" id="cc-readers-cancel">Cancel</button>
          <button type="button" class="btn sm primary" id="cc-readers-go">Send</button>
        </div>
      </div>`;
      document.body.appendChild(wrap);
      const finish = (ok) => { wrap.remove(); resolve(ok); };
      wrap.querySelector("#cc-readers-cancel").addEventListener("click", () => finish(false));
      wrap.querySelector("#cc-readers-go").addEventListener("click", async () => {
        const on = !!wrap.querySelector("#cc-readers-private").checked;
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
        finish(true);
      });
    }).catch((e) => { toast(e.message, true); resolve(false); });
  });
}

window.CC.desk = { beforeSend };

function renderCommand(container) {
  paintHome(container);
  const on = !!S.settings?.privateMode;
  container.innerHTML = `<label class="row small" style="gap:6px"><input type="checkbox" id="cc-private" ${on ? "checked" : ""}> Private mode</label><p class="dim small" id="cc-private-line" style="margin:4px 0 0">${on ? "Private mode is on. This stays on this computer. It is not used to teach the router, and it is left out of sync." : "A council or mission lists who will read the prompt before it is sent."}</p><div class="cc-desk-row"><button type="button" class="btn sm" id="cc-my-chats">My chats</button></div><div id="cc-chat-list"></div>`;
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
}

function renderDeliverable(container, live) {
  if (!live?.id) { container.innerHTML = ""; return; }
  const id = live.id;
  const name = writerName();
  const review = (S.live.council || S.live.mission || {}).doubleCheck;
  container.innerHTML = `<div class="cc-desk-tools">
    ${name ? `<p class="small" style="margin:6px 0">Written by ${esc(name)}.</p>` : ""}
    ${review?.text ? `<div class="panel"><h3>Double-check</h3><p class="small">${esc(review.line || "")}</p><div class="md">${esc(review.text)}</div></div>` : ""}
    <div class="cc-desk-row">
      <button type="button" class="btn sm" id="cc-again">Do this again</button>
      <button type="button" class="btn sm" id="cc-check">Double-check this</button>
      <button type="button" class="btn sm" data-tone="shorter">Shorter</button>
      <button type="button" class="btn sm" data-tone="warmer">Warmer</button>
      <button type="button" class="btn sm" data-tone="direct">More direct</button>
      <button type="button" class="btn sm" data-tone="plain">Plain words</button>
    </div>
  </div>`;
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
  container.querySelectorAll("[data-tone]").forEach((b) => b.addEventListener("click", async () => {
    try {
      const r = await api("/desk/tone", { method: "POST", body: { id, tone: b.dataset.tone } });
      toast(r.tone ? `${r.tone} is on the way.` : "Asked for a rewrite.");
    } catch (e) { toast(e.message, true); }
  }));
}

function renderCredits(container) {
  api("/desk/credits").then((r) => {
    const rows = (r.rows || []).map((row) => `<div class="small">${esc(row.line)}</div>`).join("");
    container.innerHTML = `<div class="panel"><h3>In plain words</h3><p>${esc(r.line || "")}</p>${rows}</div>`;
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
    <p class="dim small">Do this again is part of Pro. Double-check this is free. A council or mission lists who will read the prompt before it is sent. The first council is explained in plain words.</p>
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
      if (!confirm("Restore this backup? Projects in the file replace the project list. Chats in the file are put back. AI keys on this computer stay.")) return;
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
