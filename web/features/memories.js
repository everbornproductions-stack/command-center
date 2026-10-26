// Memories (0.4.21): Settings > Memories, and the small "Remembered: ..." line with Undo.
// What Meldmind remembers about you and your projects lives on this computer (server/memories.js).
// Three groups: About me, This project, Knowledge. Star a memory to keep it. Turn memory off any time.
const { S, api, toast, esc } = window.CC;

const GROUPS = [
  ["about-me", "About me", "Things about you that stay true in every chat."],
  ["project", "This project", "Things about the project you have open."],
  ["knowledge", "Knowledge", "Facts and notes worth keeping."],
];
let data = null;
let query = "";

const css = `
#mem-line { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); z-index: 80; max-width: min(640px, 92vw); display: flex; gap: 10px; align-items: center; background: var(--panel-solid, #0d1420); color: var(--text, #e6edf7); border: 1px solid var(--line-2, #2a3a52); border-radius: 12px; padding: 8px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); font-size: .875rem; }
#mem-line .mem-text { overflow: hidden; text-overflow: ellipsis; }
.mem-item { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--line, #1f2b3d); }
.mem-item .mem-body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.mem-item textarea { width: 100%; min-height: 54px; }
.mem-item .btn { white-space: nowrap; }
.mem-star[aria-pressed="true"] { color: var(--accent, #22d3ee); font-weight: 700; }
.mem-ro { opacity: .8; }
`;
if (!document.getElementById("mem2-style")) {
  const st = document.createElement("style");
  st.id = "mem2-style";
  st.textContent = css;
  document.head.appendChild(st);
}

// ---------- the "Remembered: ..." line ----------
let lineTimer = null;
function showLine({ text, undoLabel = "Undo", undo, ms = 14000 }) {
  document.getElementById("mem-line")?.remove();
  clearTimeout(lineTimer);
  const el = document.createElement("div");
  el.id = "mem-line";
  el.setAttribute("role", "status");
  el.innerHTML = `<span class="mem-text">${esc(text)}</span>${undo ? `<button type="button" class="btn sm" id="mem-undo">${esc(undoLabel)}</button>` : ""}<button type="button" class="btn sm" id="mem-line-x" aria-label="Close">Close</button>`;
  document.body.appendChild(el);
  el.querySelector("#mem-line-x").addEventListener("click", () => el.remove());
  el.querySelector("#mem-undo")?.addEventListener("click", async () => { try { await undo(); } catch (e) { toast(e.message, true); } el.remove(); });
  lineTimer = setTimeout(() => el.remove(), ms);
}

function onSaved(ev) {
  const saved = ev.saved || [], gone = ev.forgotten || [];
  if (saved.length) {
    const ids = saved.map((m) => m.id);
    showLine({
      text: `Remembered: ${saved.map((m) => m.text).join("; ")}`.slice(0, 220),
      undo: async () => { for (const id of ids) await api(`/memories/${id}`, { method: "DELETE" }); toast("Forgotten."); refreshPanel(); },
    });
  } else if (gone.length) {
    showLine({
      text: `Forgot: ${gone.map((m) => m.text).join("; ")}`.slice(0, 220),
      undoLabel: "Undo",
      undo: async () => { for (const m of gone) await api("/memories/restore", { method: "POST", body: { memory: m } }); toast("Remembered again."); refreshPanel(); },
    });
  } else if (ev.refused) showLine({ text: ev.message || "I will not remember passwords or account numbers.", ms: 8000 });
  refreshPanel();
}

// ---------- Settings > Memories ----------
let host = null;
function refreshPanel() { if (host && host.isConnected) paint(host).catch(() => {}); }

function itemRow(m) {
  const star = m.importance >= 5;
  if (m.readOnly) return `<div class="mem-item mem-ro" data-id="${esc(m.id)}"><div class="mem-body">${esc(m.text)}<div class="dim small">From your project notes. Edit them on the project.</div></div></div>`;
  return `<div class="mem-item" data-id="${esc(m.id)}">
    <div class="mem-body"><span class="mem-view">${esc(m.text)}</span>
      <div class="dim small">${star ? "Kept (starred)" : `Importance ${m.importance} of 5`} · ${esc(m.source || "")} · ${new Date(m.createdAt).toLocaleDateString()}</div></div>
    <button type="button" class="btn sm mem-star" data-mem-star="${esc(m.id)}" aria-pressed="${star}" aria-label="${star ? "Unstar" : "Star to keep"}: ${esc(m.text.slice(0, 40))}">${star ? "Starred" : "Star"}</button>
    <button type="button" class="btn sm" data-mem-edit="${esc(m.id)}" aria-label="Edit: ${esc(m.text.slice(0, 40))}">Edit</button>
    <button type="button" class="btn sm" data-mem-del="${esc(m.id)}" aria-label="Delete: ${esc(m.text.slice(0, 40))}">Delete</button>
  </div>`;
}

function listHtml() {
  const q = query.trim().toLowerCase();
  const match = (m) => !q || m.text.toLowerCase().includes(q);
  const projName = (id) => data.projects.find((p) => p.id === id)?.name || id;
  return GROUPS.map(([b, label, hint]) => {
    const rows = [...data.items.filter((m) => m.bucket === b), ...(b === "project" ? data.linked : [])].filter(match);
    let body;
    if (b === "project") {
      const byProj = new Map();
      for (const m of rows) { const k = m.projectId || ""; (byProj.get(k) || byProj.set(k, []).get(k)).push(m); }
      body = [...byProj.entries()].map(([pid, ms]) => `<div class="dim small" style="margin-top:6px"><b>${esc(projName(pid))}</b></div>${ms.map(itemRow).join("")}`).join("");
    } else body = rows.map(itemRow).join("");
    return `<div class="panel" data-mem-bucket="${b}" style="margin-top:10px"><h4 style="margin:0">${esc(label)} <span class="dim small">(${rows.length})</span></h4>
      <div class="dim small">${esc(hint)}</div>${body || `<div class="dim small" style="margin-top:6px">Nothing here yet.</div>`}</div>`;
  }).join("");
}

async function paint(el) {
  data = await api("/memories");
  const sm = data.smarter || {};
  const proj = S.project || data.projects[0]?.id || "";
  el.innerHTML = `<div class="panel" id="mem2-panel"><h3>Memories <span class="right dim small">stays on this computer</span></h3>
    <p class="small">Meldmind remembers lasting things you tell it, like your business or how you like things written, and uses them in every chat and every AI it hands work to. It never keeps passwords, keys or account numbers.</p>
    <label class="row" style="gap:8px"><input type="checkbox" id="mem-on" ${data.enabled ? "checked" : ""}> Memory on</label>
    <div class="dim small" id="mem-on-note">${data.enabled ? "Meldmind saves lasting things you say and uses them." : "Memory is off. Nothing is saved or used."}</div>
    <label class="row" style="gap:8px;margin-top:8px"><input type="checkbox" id="mem-smarter" ${sm.on ? "checked" : ""} ${sm.available ? "" : "disabled"}> ${esc(sm.label || "Smarter recall (uses your OpenAI or Gemini key)")}</label>
    ${sm.available ? "" : `<div class="dim small" id="mem-smarter-note">${esc(sm.note || "Needs a key")}</div>`}
    <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
      <input type="search" id="mem-search" placeholder="Search memories" aria-label="Search memories" value="${esc(query)}" style="flex:1;min-width:160px">
      <button type="button" class="btn sm" id="mem-clear" ${data.count ? "" : "disabled"}>Clear all</button>
    </div>
    <div id="mem-add-row" class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
      <input type="text" id="mem-add-text" maxlength="300" placeholder="Add something to remember" aria-label="Something to remember" style="flex:1;min-width:200px">
      <select id="mem-add-bucket" aria-label="Where it belongs">${GROUPS.map(([b, l]) => `<option value="${b}">${esc(l)}</option>`).join("")}</select>
      <select id="mem-add-proj" aria-label="Project">${data.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === proj ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <button type="button" class="btn sm primary" id="mem-add">Add</button>
    </div>
    <div class="dim small" id="mem-add-note" aria-live="polite"></div>
    <div id="mem-list">${listHtml()}</div></div>`;
  wire(el);
}

function wire(el) {
  const note = (t) => { const n = el.querySelector("#mem-add-note"); if (n) n.textContent = t; };
  el.querySelector("#mem-on").addEventListener("change", async (e) => {
    try { await api("/memories/enabled", { method: "POST", body: { on: e.target.checked } }); toast(e.target.checked ? "Memory is on" : "Memory is off"); } catch (err) { toast(err.message, true); }
    paint(el);
  });
  el.querySelector("#mem-smarter")?.addEventListener("change", async (e) => {
    try { await api("/memories/smarter", { method: "POST", body: { on: e.target.checked } }); } catch (err) { toast(err.message, true); }
    paint(el);
  });
  el.querySelector("#mem-search").addEventListener("input", (e) => { query = e.target.value; el.querySelector("#mem-list").innerHTML = listHtml(); wireList(el); });
  el.querySelector("#mem-clear").addEventListener("click", async () => {
    if (!(await window.CC.confirm("Forget everything Meldmind has remembered? This cannot be undone.", { danger: true, ok: "Clear all" }))) return;
    try { const r = await api("/memories/clear", { method: "POST", body: { confirm: true } }); toast(`Cleared ${r.removed} memor${r.removed === 1 ? "y" : "ies"}`); } catch (err) { toast(err.message, true); }
    paint(el);
  });
  el.querySelector("#mem-add").addEventListener("click", async () => {
    const text = el.querySelector("#mem-add-text").value.trim();
    if (!text) { note("Write what to remember."); return; }
    const bucket = el.querySelector("#mem-add-bucket").value;
    try {
      await api("/memories", { method: "POST", body: { text, bucket, projectId: bucket === "project" ? el.querySelector("#mem-add-proj").value : null } });
      toast("Remembered");
      paint(el);
    } catch (err) { note(err.message); }
  });
  el.querySelector("#mem-add-text").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.querySelector("#mem-add").click(); } });
  wireList(el);
}

function wireList(el) {
  el.querySelectorAll("[data-mem-star]").forEach((b) => b.addEventListener("click", async () => {
    const m = data.items.find((x) => x.id === b.dataset.memStar);
    try { await api(`/memories/${m.id}`, { method: "POST", body: { starred: m.importance < 5 } }); } catch (err) { toast(err.message, true); }
    paint(el);
  }));
  el.querySelectorAll("[data-mem-del]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/memories/${b.dataset.memDel}`, { method: "DELETE" }); toast("Deleted"); } catch (err) { toast(err.message, true); }
    paint(el);
  }));
  el.querySelectorAll("[data-mem-edit]").forEach((b) => b.addEventListener("click", () => {
    const row = b.closest(".mem-item");
    const m = data.items.find((x) => x.id === b.dataset.memEdit);
    row.querySelector(".mem-body").innerHTML = `<textarea aria-label="Edit memory" maxlength="300">${esc(m.text)}</textarea><div class="row" style="gap:6px;margin-top:6px"><button type="button" class="btn sm primary" data-mem-save="${esc(m.id)}">Save</button><button type="button" class="btn sm" data-mem-cancel>Cancel</button></div><div class="dim small" data-mem-err></div>`;
    row.querySelector("[data-mem-cancel]").addEventListener("click", () => paint(el));
    row.querySelector("[data-mem-save]").addEventListener("click", async () => {
      try { await api(`/memories/${m.id}`, { method: "POST", body: { text: row.querySelector("textarea").value } }); toast("Saved"); paint(el); }
      catch (err) { row.querySelector("[data-mem-err]").textContent = err.message; }
    });
    row.querySelector("textarea").focus();
  }));
}

function renderSettings(el) {
  host = el;
  el.innerHTML = `<div class="panel" id="mem2-panel"><h3>Memories</h3><div class="dim small">Loading...</div></div>`;
  paint(el).catch((e) => { el.innerHTML = `<div class="panel" id="mem2-panel"><h3>Memories</h3><div class="dim small">${esc(e.message)}</div></div>`; });
}

window.CC.memories = { show: showLine, refresh: refreshPanel };

window.CC.register({
  id: "memories",
  settings: { order: 19, render: renderSettings },
  onEvent(ev) { if (ev.type === "memory.saved") onSaved(ev); },
});
