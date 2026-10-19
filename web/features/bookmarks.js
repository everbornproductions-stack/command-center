// Organize my existing browser bookmarks (Phase 13).
// Setup (first run, next to the AI bookmark folder) and Settings: pick a browser profile, allow reading it,
// pick the AI that sorts (your own key, an estimate first), preview the folders, rename them, move or untick
// bookmarks, tick duplicates to merge, then apply (browser closed, backup first) or download an import file.
// Undo puts the backup back. No favicons here: the app's favicon helper asks Google, and these addresses go
// only to the AI the person picked.
const { api, toast, esc, money, ago } = window.CC;

const css = `
.cc-bm .opts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.cc-bm .opts select, .cc-bm .opts input[type=text] { width: auto; }
.cc-bm details { border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; margin-top: 6px; }
.cc-bm summary { display: flex; gap: 8px; align-items: center; cursor: pointer; }
.cc-bm summary input { width: 220px; padding: 3px 8px; }
.cc-bm .it { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 2px 0; font-size: 12px; }
.cc-bm .it .t { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cc-bm .it.off .t { opacity: .45; text-decoration: line-through; }
.cc-bm .it select { width: 150px; padding: 2px 6px; font-size: 11px; }
.cc-bm .warn { border-left: 3px solid var(--amber, #f59e0b); padding: 6px 10px; margin-top: 8px; }
`;
const style = document.createElement("style"); style.id = "cc-bookmarks-style"; style.textContent = css; document.head.appendChild(style);

const st = { view: null, src: "", allow: false, draft: null, models: null, model: "", business: "", busy: "", folders: null, off: new Set(), merge: new Set(), open: new Set(), where: "bar", removeEmpty: true, allowSynced: false, setupOpen: false };
const host = (u) => { try { return new URL(u).host || u.slice(0, 30); } catch { return u.slice(0, 30); } };
const itemsById = () => new Map((st.draft?.items || []).map((i) => [i.id, i]));
const modelLabel = (m) => `${m.providerName} · ${m.name}${m.capped ? " (at its spend cap)" : ` · about ${money(m.estCost)}`}`;

async function load() { st.view = await api("/bookmarks"); if (!st.src && st.view.sources[0]) st.src = `${st.view.sources[0].browser}|${st.view.sources[0].profile}`; }

function planBody() {
  return { folders: st.folders.map((f) => ({ name: f.name, items: f.items.filter((x) => !st.off.has(x)) })), merge: [...st.merge], where: st.where, removeEmpty: st.removeEmpty };
}

function html() {
  const v = st.view;
  if (!v) return `<div class="dim small">Loading…</div>`;
  if (v.hosted) return `<div class="dim small">Organizing bookmarks works in the desktop app on your own computer.</div>`;
  const d = st.draft, src = v.sources.find((x) => `${x.browser}|${x.profile}` === st.src);
  const m = st.models?.models.find((x) => `${x.provider}/${x.model}` === st.model);
  const pickRow = `<div class="opts">
      <select id="bm-src">${v.sources.length ? v.sources.map((x) => `<option value="${esc(x.browser)}|${esc(x.profile)}" ${`${x.browser}|${x.profile}` === st.src ? "selected" : ""}>${esc(x.browserName)} · ${esc(x.name)}${x.kind === "firefox" ? " (import file only)" : ""}</option>`).join("") : `<option value="">No Chrome, Edge, Brave or Firefox bookmarks found</option>`}</select>
      <label class="row small" style="gap:6px"><input type="checkbox" id="bm-allow" ${st.allow ? "checked" : ""}> Allow Command AI to read this browser's bookmarks</label>
      <button class="btn sm" id="bm-read" ${!src || !st.allow || st.busy ? "disabled" : ""}>${st.busy === "read" ? "Reading…" : "Read bookmarks"}</button></div>`;
  let body = "";
  if (d) {
    const who = m ? esc(m.providerName) : "the AI you pick";
    body += `<div class="small" style="margin-top:10px"><b>${d.count}</b> bookmarks read from ${esc(d.browserName)} (${esc(d.profile)})${d.duplicates.length ? `, ${d.duplicates.length} address${d.duplicates.length === 1 ? "" : "es"} saved more than once` : ""}.</div>
      <div class="opts"><select id="bm-model">${(st.models?.models || []).map((x) => `<option value="${esc(x.provider)}/${esc(x.model)}" ${`${x.provider}/${x.model}` === st.model ? "selected" : ""} ${x.capped ? "disabled" : ""}>${esc(modelLabel(x))}</option>`).join("") || `<option value="">Add an API key in Settings first (or turn on demo mode)</option>`}</select>
        <input type="text" id="bm-biz" placeholder="Your business name (optional)" value="${esc(st.business)}">
        <button class="btn sm primary" id="bm-sort" ${!m || st.busy ? "disabled" : ""}>${st.busy === "sort" ? "Sorting…" : st.folders ? "Sort again" : "Sort into folders"}</button></div>
      <div class="dim small" style="margin-top:4px">Privacy: the titles and addresses go only to ${who}, to sort them, and nowhere else. Anything after ? or # in an address is cut off first, and bookmarklet code is never sent. The cost goes to your own key and shows in Credits.</div>`;
  }
  if (d && st.folders) {
    const byId = itemsById();
    const opts = (cur) => st.folders.map((f, i) => `<option value="${i}" ${i === cur ? "selected" : ""}>${esc(f.name || "(no name)")}</option>`).join("");
    const kept = st.folders.reduce((a, f) => a + f.items.filter((x) => !st.off.has(x)).length, 0);
    body += `<div class="small" style="margin-top:10px"><b>Proposed folders</b> <span class="dim">by ${esc(d.proposal.by.providerName)} · ${esc(d.proposal.by.name)} · ${money(d.proposal.cost)}. Rename a folder, move a bookmark with its menu, or untick it to leave it where it is.</span></div>
      ${st.folders.map((f, fi) => `<details data-f="${fi}" ${st.open.has(fi) ? "open" : ""}><summary><input type="text" data-name="${fi}" value="${esc(f.name)}"><span class="dim small">${f.items.filter((x) => !st.off.has(x)).length} of ${f.items.length}</span></summary>
        ${st.open.has(fi) ? f.items.map((id) => { const it = byId.get(id); if (!it) return ""; return `<div class="it ${st.off.has(id) ? "off" : ""}"><input type="checkbox" data-tick="${esc(id)}" ${st.off.has(id) ? "" : "checked"}><div class="t" title="${esc(it.url)}">${esc(it.title || it.url)} <span class="dim">${esc(host(it.url))} · now in ${esc(it.path)}</span></div><select data-move="${esc(id)}" data-from="${fi}">${opts(fi)}</select></div>`; }).join("") : ""}</details>`).join("")}
      <div class="opts"><input type="text" id="bm-newf" placeholder="New folder name"><button class="btn sm" id="bm-addf">Add folder</button></div>
      ${d.duplicates.length ? `<div class="small" style="margin-top:10px"><b>Saved more than once</b> <span class="dim">Tick an address to keep one copy and remove the others. Nothing is merged unless you tick it.</span></div>
        ${d.duplicates.map((x) => `<label class="row small" style="gap:6px;padding:2px 0"><input type="checkbox" data-merge="${esc(x.url)}" ${st.merge.has(x.url) ? "checked" : ""}> ${esc(x.url)} <span class="dim">(${x.items.length} copies)</span></label>`).join("")}` : ""}
      <div class="opts small"><label class="row" style="gap:6px"><input type="radio" name="bm-where" value="bar" ${st.where === "bar" ? "checked" : ""}> on the bookmarks bar</label>
        <label class="row" style="gap:6px"><input type="radio" name="bm-where" value="other" ${st.where === "other" ? "checked" : ""}> under Other bookmarks</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="bm-empty" ${st.removeEmpty ? "checked" : ""}> remove folders this leaves empty</label></div>
      ${d.canApply && d.kind !== "demo" ? `<div class="warn small">Close ${esc(d.browserName)} completely before you apply: it rewrites its bookmarks file while it runs. Command AI checks and will not apply while it is open. The original file is backed up first (next to it and in the app data folder) and Undo puts it back.</div>` : ""}
      ${d.synced ? `<div class="warn small">This profile syncs bookmarks with an account. The browser may put the old layout back or bring duplicates from the cloud. The import file is the safer choice. <label class="row" style="gap:6px;margin-top:4px"><input type="checkbox" id="bm-synced" ${st.allowSynced ? "checked" : ""}> Apply anyway</label></div>` : ""}
      ${d.kind === "firefox" ? `<div class="warn small">Firefox's bookmark database cannot be rewritten safely, so you get an import file: Firefox, Bookmarks, Manage bookmarks, Import and Backup, Import Bookmarks from HTML. It adds an "Organized by Command AI" folder; your old bookmarks stay as they are.</div>` : ""}
      <div class="opts">${d.canApply ? `<button class="btn primary" id="bm-apply" ${st.busy ? "disabled" : ""}>${st.busy === "apply" ? "Applying…" : `Apply ${kept} bookmarks to ${esc(d.browserName)}`}</button>` : ""}
        <button class="btn sm" id="bm-export" ${st.busy ? "disabled" : ""}>Download import file</button><button class="btn sm" id="bm-cancel">Cancel</button></div>`;
  }
  const hist = (v.history || []).slice(0, 6);
  const histHtml = hist.length ? `<div class="small" style="margin-top:12px"><b>Recent changes</b></div>${hist.map((h) => `<div class="row small" style="gap:8px;padding:2px 0"><span>${esc(h.browserName)} · ${esc(h.profile)} · ${ago(h.at)} ago · ${h.moved} moved into ${h.folders} folders${h.merged ? `, ${h.merged} duplicates merged` : ""}</span>${h.undoneAt ? `<span class="chip">undone</span>` : `<button class="btn sm" data-undo="${esc(h.id)}" style="margin-left:auto">Undo</button>`}</div>`).join("")}` : "";
  return `<div class="cc-bm">${pickRow}${body}${histHtml}</div>`;
}

function mount(el) {
  const draw = () => { el.innerHTML = html(); wire(); };
  const run = async (what, fn) => { st.busy = what; draw(); try { await fn(); } catch (e) { toast(e.message, true); } finally { st.busy = ""; draw(); } };
  const reset = () => { st.draft = null; st.folders = null; st.models = null; st.off = new Set(); st.merge = new Set(); st.open = new Set(); st.allowSynced = false; };
  function wire() {
    const q = (s) => el.querySelector(s);
    q("#bm-src")?.addEventListener("change", (e) => { st.src = e.target.value; st.allow = false; reset(); draw(); });
    q("#bm-allow")?.addEventListener("change", (e) => { st.allow = e.target.checked; draw(); });
    q("#bm-read")?.addEventListener("click", () => run("read", async () => {
      const [browser, profile] = st.src.split("|");
      reset();
      st.draft = await api("/bookmarks/read", { method: "POST", body: { browser, profile, allow: st.allow } });
      st.models = await api(`/bookmarks/models?draft=${encodeURIComponent(st.draft.id)}`);
      const s = st.models.suggested; st.model = s ? `${s.provider}/${s.model}` : "";
    }));
    q("#bm-model")?.addEventListener("change", (e) => { st.model = e.target.value; draw(); });
    q("#bm-biz")?.addEventListener("input", (e) => { st.business = e.target.value; });
    q("#bm-sort")?.addEventListener("click", () => run("sort", async () => {
      const [provider, ...rest] = st.model.split("/");
      st.draft = await api("/bookmarks/categorize", { method: "POST", body: { draft: st.draft.id, provider, model: rest.join("/"), business: st.business } });
      st.folders = st.draft.proposal.folders.map((f) => ({ name: f.name, items: [...f.items] }));
      st.off = new Set(); st.open = new Set();
    }));
    el.querySelectorAll("details[data-f]").forEach((dt) => dt.addEventListener("toggle", () => { const i = Number(dt.dataset.f); const was = st.open.has(i); if (dt.open) st.open.add(i); else st.open.delete(i); if (dt.open !== was) draw(); }));
    el.querySelectorAll("[data-name]").forEach((i) => { i.addEventListener("click", (e) => e.preventDefault()); i.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") e.stopPropagation(); }); i.addEventListener("input", () => { st.folders[Number(i.dataset.name)].name = i.value; }); });
    el.querySelectorAll("[data-tick]").forEach((c) => c.addEventListener("change", () => { if (c.checked) st.off.delete(c.dataset.tick); else st.off.add(c.dataset.tick); draw(); }));
    el.querySelectorAll("[data-move]").forEach((s) => s.addEventListener("change", () => {
      const from = st.folders[Number(s.dataset.from)], to = st.folders[Number(s.value)], id = s.dataset.move;
      from.items = from.items.filter((x) => x !== id); to.items.push(id); draw();
    }));
    q("#bm-addf")?.addEventListener("click", () => { const n = q("#bm-newf").value.trim(); if (!n) return toast("Type a folder name first", true); if (st.folders.some((f) => f.name.toLowerCase() === n.toLowerCase())) return toast("There is already a folder with that name", true); st.folders.push({ name: n, items: [] }); draw(); });
    el.querySelectorAll("[data-merge]").forEach((c) => c.addEventListener("change", () => { if (c.checked) st.merge.add(c.dataset.merge); else st.merge.delete(c.dataset.merge); }));
    el.querySelectorAll("[name=bm-where]").forEach((r) => r.addEventListener("change", () => { st.where = r.value; }));
    q("#bm-empty")?.addEventListener("change", (e) => { st.removeEmpty = e.target.checked; });
    q("#bm-synced")?.addEventListener("change", (e) => { st.allowSynced = e.target.checked; });
    q("#bm-cancel")?.addEventListener("click", () => { reset(); draw(); });
    q("#bm-export")?.addEventListener("click", () => run("export", async () => {
      const r = await api("/bookmarks/export", { method: "POST", body: { draft: st.draft.id, plan: planBody() } });
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([r.html], { type: "text/html" })); a.download = "organized-bookmarks.html"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("Import file downloaded");
    }));
    q("#bm-apply")?.addEventListener("click", () => {
      const d = st.draft, merges = st.merge.size;
      if (st.folders.some((f) => !f.name.trim() && f.items.some((x) => !st.off.has(x)))) return toast("Every folder needs a name", true);
      if (!confirm(`Reorganize ${d.browserName} (${d.profile}) into ${st.folders.length} folders${merges ? ` and merge ${merges} duplicate address${merges === 1 ? "" : "es"}` : ""}? Nothing else is deleted. The original file is backed up first, and Undo puts it back.`)) return;
      run("apply", async () => {
        const r = await api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: planBody(), allowSynced: st.allowSynced } });
        toast(`Bookmarks organized: ${r.applied.moved} moved. Backup saved. Open ${d.browserName} to see them.`);
        reset(); await load();
      });
    });
    el.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => run("undo", async () => {
      try { await api("/bookmarks/undo", { method: "POST", body: { id: b.dataset.undo } }); }
      catch (e) {
        if (!/changed after they were organized/.test(e.message) || !confirm(e.message)) throw e;
        await api("/bookmarks/undo", { method: "POST", body: { id: b.dataset.undo, force: true } });
      }
      toast("Bookmarks put back as they were"); await load();
    })));
  }
  draw();
  load().then(draw).catch((e) => { el.innerHTML = `<div class="dim small">${esc(e.message)}</div>`; });
}

const intro = `Sorts the bookmarks you already have into folders by topic (your business, insurance, banking, tools, social...) with an AI you pick. You see every folder before anything changes, and nothing is deleted.`;
CC.register({
  id: "bookmarks",
  settings: { order: 60, render(el) { el.innerHTML = `<div class="panel" id="prov-bookmarks"><h3>Organize my bookmarks</h3><div class="dim small">${intro}</div><div data-bm></div></div>`; mount(el.querySelector("[data-bm]")); } },
  // first run: offered next to the AI bookmark folder
  setup: { order: 10, render(el) {
    if (!st.setupOpen) {
      el.innerHTML = `<div class="panel"><h3>Organize the bookmarks you already have?</h3><div class="dim small">${intro}</div><div class="row" style="margin-top:10px"><button class="btn sm" id="bm-setup-open">Yes, show me</button><span class="dim small">Optional. Also in Settings later.</span></div></div>`;
      el.querySelector("#bm-setup-open").addEventListener("click", () => { st.setupOpen = true; this.render(el); });
      return;
    }
    el.innerHTML = `<div class="panel"><h3>Organize the bookmarks you already have</h3><div data-bm></div></div>`;
    mount(el.querySelector("[data-bm]"));
  } },
});
