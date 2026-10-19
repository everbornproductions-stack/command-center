// Project memory editor (Settings panel + a badge in Command). The server injects it into every prompt for
// the project: single chats, councils, missions, pipelines, schedules and side-by-side comparisons.
// The HQ import fills empty sections (and ones still as the last import left them); edits are kept.
const { S, api, toast, esc } = window.CC;
const FIELDS = [["voice", "Brand voice", "Short, direct, no hype. Lead with the result."], ["offers", "Offers and calls to action", "Free 15-minute call · link in bio"], ["never", "Never say / never do", "No invented numbers. No 'guaranteed'. No hashtags in the first line."], ["winners", "Past winners (what worked)", "Hook: 'I loved you in the dark' over rain shot; carousel of 3 before/after"], ["facts", "Facts to keep straight", "Licensed in CA. Founded 2024. Owner: Chris Magee."]];

async function panel(el) {
  const projects = S.projects || [];
  el.innerHTML = `<div class="panel"><h3>Project memory <span class="right">injected into every prompt for that project</span></h3>
    <div class="row"><select id="mem-proj" style="width:auto;min-width:220px">${projects.map((p) => `<option value="${p.id}" ${p.id === S.project ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button class="btn sm" id="mem-import">Import from HQ client file</button></div>
    <div id="mem-fields" style="margin-top:8px"></div>
    <div class="row" style="margin-top:10px"><button class="btn sm primary" id="mem-save">Save memory</button><span class="dim small" id="mem-stamp"></span></div></div>`;
  const sel = el.querySelector("#mem-proj");
  const load = async () => {
    const pid = sel.value; if (!pid) return;
    let m = {}; try { m = await api(`/memory/project/${pid}`); } catch {}
    el.querySelector("#mem-fields").innerHTML = FIELDS.map(([k, label, ph]) => `<label class="lbl">${label}</label><textarea data-f="${k}" placeholder="${esc(ph)}" style="min-height:64px">${esc(m[k] || "")}</textarea>`).join("");
    el.querySelector("#mem-stamp").textContent = m.updatedAt ? `saved ${new Date(m.updatedAt).toLocaleString()}${m.importedFrom ? ` · imported ${m.importedFrom.join(", ")}` : ""}` : "nothing saved yet";
  };
  sel.addEventListener("change", load);
  el.querySelector("#mem-save").addEventListener("click", async () => { const body = {}; el.querySelectorAll("[data-f]").forEach((t) => { body[t.dataset.f] = t.value; }); try { await api(`/memory/project/${sel.value}`, { method: "POST", body }); toast("Memory saved"); load(); } catch (e) { toast(e.message, true); } });
  el.querySelector("#mem-import").addEventListener("click", async () => {
    try {
      const r = await api("/memory/import-hq", { method: "POST", body: { projectId: sel.value } });
      const name = (k) => FIELDS.find((f) => f[0] === k)?.[1] || k;
      toast(`Imported from HQ${r.filled?.length ? `: ${r.filled.map(name).join(", ")}` : ": nothing new"}${r.kept?.length ? `. Kept your edits in ${r.kept.map(name).join(", ")}` : ""}`);
      load();
    } catch (e) { toast(e.message, true); }
  });
  load();
}

CC.register({
  id: "memory",
  settings: { order: 20, render: panel },
  command: { order: 20, async render(el) {
    const pid = S.project; if (!pid) { el.innerHTML = ""; return; }
    let m = {}; try { m = await api(`/memory/project/${pid}`); } catch {}
    const has = ["voice", "offers", "never", "winners", "facts"].filter((k) => m[k]?.trim()).length;
    el.innerHTML = `<div class="row small" style="margin-top:6px"><span class="chip ${has ? "violet" : ""}">${has ? `project memory: ${has} section${has === 1 ? "" : "s"} in use` : "no project memory yet"}</span></div>`;
  } },
});
