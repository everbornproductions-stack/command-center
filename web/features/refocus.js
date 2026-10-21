// Refocus: type a topic, see the related work from oldest to newest, then rebuild on a click.
const { api, toast, esc } = window.CC;

const st = { gate: null, found: null, busy: false };

function when(t) {
  const n = Number(t);
  if (!n) return "No date";
  try { return new Date(n).toLocaleDateString(); } catch { return "No date"; }
}

function statusChip(status) {
  const label = status === "finished" || status === "partial" || status === "abandoned" ? status : "partial";
  return `<span class="chip">${esc(label)}</span>`;
}

function rows(list, empty) {
  if (!list?.length) return `<div class="small dim">${esc(empty)}</div>`;
  return list.map((row) => `<div class="small" style="margin-top:6px"><b>${esc(row.source || "")}</b> ${row.status ? statusChip(row.status) : ""} <span class="dim">${esc(when(row.date))}</span><div>${esc(row.summary || "")}</div><div class="dim">${esc(row.why || "")}</div></div>`).join("");
}

function readerLine(pack) {
  const readers = pack?.readers || [];
  if (!readers.length) return `<div class="small dim">${esc(pack?.note || "Nothing is sent until you click.")}</div>`;
  return `<div class="small" style="margin-top:6px">${readers.map((r) => {
    const where = [r.mission ? "mission" : "", r.council ? "council" : ""].filter(Boolean).join(" and ") || "this run";
    return `<div><b>${esc(r.name)}</b> <span class="dim">${esc(r.kind === "service" ? "service" : "AI")} · ${esc(where)} · receives ${esc(r.receives || "the orders")}</span></div>`;
  }).join("")}</div><div class="small dim" style="margin-top:6px">${esc(pack.note || "Nothing is sent until you click.")}</div>`;
}

function page(view) {
  const g = st.gate || { find: false, rebuild: false, upgrade: "Refocus is part of Pro. Add a licence key in Settings." };
  const f = st.found;
  if (!g.find) {
    view.innerHTML = `<div class="panel" id="rf-root"><h3>Refocus</h3>
      <p>Finish what you started. Type a topic and Meldmind lists the related chats, files, and saved work from oldest to newest.</p>
      <div class="route" style="border-left:3px solid var(--amber)">${esc(g.upgrade || "")}</div>
      <div class="small dim" style="margin-top:8px">Finding, the timeline, and the status labels are part of Pro. The full rebuild is part of Extreme. Nothing is searched until you can use Pro.</div>
    </div>`;
    return;
  }
  view.innerHTML = `<div class="grid" id="rf-root">
    <div class="panel"><h3>Refocus <span class="right small dim">Finish what you started</span></h3>
      <p class="small">Type a topic, such as music videos or half-done reels. Meldmind looks through saved chats, imported chats, project files, saved outputs, and Google Drive when it is already connected. The list is oldest first. Nothing is sent until you click Rebuild it.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <input id="rf-topic" type="text" placeholder="music videos" value="${esc(f?.topic || "")}" style="flex:1;min-width:220px" ${st.busy ? "disabled" : ""}>
        <button class="btn primary" id="rf-find" ${st.busy ? "disabled" : ""}>Find</button>
      </div>
      ${g.rebuild ? "" : `<div class="route" style="margin-top:10px;border-left:3px solid var(--amber)">${esc(g.rebuildUpgrade || "")}</div>`}
    </div>
    ${f ? `<div class="panel"><h3>Timeline <span class="right small dim">${f.items.length} item${f.items.length === 1 ? "" : "s"}${f.skippedPrivate ? `, ${f.skippedPrivate} private left out` : ""}</span></h3>
      ${f.items.length ? f.items.map((item) => `<div class="small" style="margin-top:8px">${statusChip(item.status)} <b>${esc(item.source)}</b> <span class="dim">${esc(when(item.date))}</span><div>${esc(item.title)}</div><div>${esc(item.summary)}</div></div>`).join("") : `<div class="small dim">Nothing related turned up. Try a shorter topic, or import a chat export first.</div>`}
      <div class="small dim" style="margin-top:8px">${f.drive?.connected ? `Google Drive was read on this computer (${f.drive.count} file${f.drive.count === 1 ? "" : "s"}). Drive does not receive a copy.` : "Google Drive is not connected, so Drive files were not included."}${f.drive?.error ? ` ${esc(f.drive.error)}` : ""}</div>
    </div>
    <div class="panel"><h3>Complete version</h3>
      <div class="small dim">${esc(f.plan?.note || "")}</div>
      <h4 style="margin:12px 0 0">Kept</h4>${rows(f.plan?.kept, "No finished piece matched this topic.")}
      <h4 style="margin:12px 0 0">Improved</h4>${rows(f.plan?.improved, "No later pass added to an earlier one.")}
      <h4 style="margin:12px 0 0">Still missing</h4>${rows(f.plan?.missing, "Nothing unfinished matched this topic.")}
    </div>
    <div class="panel"><h3>Who will read this</h3>
      ${readerLine(f.whoWillRead)}
      <div class="row" style="margin-top:10px"><button class="btn primary" id="rf-rebuild" ${!g.rebuild || st.busy ? "disabled" : ""}>Rebuild it</button></div>
    </div>` : ""}
  </div>`;
  view.querySelector("#rf-find")?.addEventListener("click", () => find(view));
  view.querySelector("#rf-topic")?.addEventListener("keydown", (e) => { if (e.key === "Enter") find(view); });
  view.querySelector("#rf-rebuild")?.addEventListener("click", () => rebuild(view));
}

async function load(view) {
  try { st.gate = await api("/refocus"); } catch (e) { st.gate = { find: false, upgrade: e.message }; }
  page(view);
}

async function find(view) {
  const topic = view.querySelector("#rf-topic")?.value.trim();
  if (!topic) return toast("Type a topic first.", true);
  st.busy = true; page(view);
  try { st.found = await api("/refocus/find", { method: "POST", body: { topic } }); }
  catch (e) { toast(e.message, true); }
  st.busy = false; page(view);
}

async function rebuild(view) {
  const topic = st.found?.topic || view.querySelector("#rf-topic")?.value.trim();
  if (!topic) return toast("Find a topic first.", true);
  if (!st.gate?.rebuild) return toast(st.gate?.rebuildUpgrade || "The full rebuild is part of Extreme.", true);
  st.busy = true; page(view);
  try {
    const r = await api("/refocus/rebuild", { method: "POST", body: { topic } });
    toast("Rebuild started. It runs as a mission. Nothing else is sent.");
    if (r.whoWillRead) st.found = { ...(st.found || { topic }), whoWillRead: r.whoWillRead };
    window.CC.go?.("command");
  } catch (e) { toast(e.message, true); }
  st.busy = false;
}

window.CC.register({
  id: "refocus",
  tab: { label: "Refocus", order: 16, render: (view) => { load(view); } },
});
