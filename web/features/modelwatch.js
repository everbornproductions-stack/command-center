// Model watch (Phase 32). A settings panel: check on click, read the notes, accept or undo a switch.
const { api, toast, esc, ago } = window.CC;

function when(ts) {
  if (!ts) return "Not checked yet";
  try { return `Last check ${ago(ts)}`; } catch { return "Checked"; }
}

async function renderSettings(el) {
  let d;
  try { d = await api("/modelwatch"); }
  catch (e) { el.innerHTML = `<div class="panel" id="model-watch"><h3>Model watch</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const open = (d.suggestions || []).filter((s) => s.status !== "accepted");
  const accepted = (d.suggestions || []).filter((s) => s.status === "accepted");
  const newsLine = d.news === "shared"
    ? "These notes are also in News."
    : "This is the model news list on this computer.";
  el.innerHTML = `<div class="panel" id="model-watch"><h3>Model watch <span class="right">${esc(when(d.checkedAt))}</span></h3>
    <div class="small muted">${esc(d.note || "")} ${esc(newsLine)}</div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      <button class="btn sm" id="mw-check" type="button">Check now</button>
      <span class="dim small">${d.reason ? esc(d.reason) : (d.nextAt ? `Next check after ${esc(new Date(d.nextAt).toLocaleString())}` : "A check runs at most once a day.")}</span>
    </div>
    <div class="cat-h" style="margin-top:12px">Suggested switches</div>
    ${open.length ? open.map((s) => `<div class="row small" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
      <span style="flex:1">${esc(s.title)}. ${esc(s.body)}</span>
      <button class="btn sm" type="button" data-accept="${esc(s.id)}">Accept</button>
    </div>`).join("") : `<div class="dim small">No switch is waiting.</div>`}
    ${accepted.length ? `<div class="cat-h" style="margin-top:12px">Accepted</div>` + accepted.map((s) => `<div class="row small" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line)">
      <span style="flex:1">${esc(s.title)}</span>
      <button class="ghost small" type="button" data-undo="${esc(s.id)}">Undo</button>
    </div>`).join("") : ""}
    <div class="cat-h" style="margin-top:12px">Model news</div>
    ${(d.notes || []).length ? (d.notes || []).map((n) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${esc(n.title)}</b><div class="dim">${esc(n.body)}</div></div>`).join("") : `<div class="dim small">No notes yet. Check now after a key is saved.</div>`}
  </div>`;
  el.querySelector("#mw-check").addEventListener("click", async (ev) => {
    ev.target.disabled = true;
    try {
      const v = await api("/modelwatch/check", { method: "POST", body: {} });
      toast(v.skipped ? (v.reason || "Already checked today.") : (v.watched ? "Model list checked." : (v.reason || "Nothing to check yet.")));
    } catch (err) { toast(err.message, true); }
    renderSettings(el);
  });
  el.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/modelwatch/accept", { method: "POST", body: { id: b.dataset.accept } }); toast("Switch accepted"); renderSettings(el); }
    catch (err) { toast(err.message, true); }
  }));
  el.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/modelwatch/undo", { method: "POST", body: { id: b.dataset.undo } }); toast("Switch undone"); renderSettings(el); }
    catch (err) { toast(err.message, true); }
  }));
}

window.CC.register({ id: "modelwatch", settings: { order: 36, render: renderSettings } });
