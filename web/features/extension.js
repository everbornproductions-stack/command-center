// Chrome / Edge extension (Phase 24). Settings > Browser extension: how to load it, pair a browser (the code
// is shown once), unpair. Command: pages and selections sent with "Put it in Marching orders" wait here until
// you use them; nothing runs until you press Send.
const { S, api, toast, esc, ago, $ } = window.CC;

let inbox = [];
async function loadInbox() { try { inbox = (await api("/extension/inbox")).items || []; } catch { inbox = []; } return inbox; }

function useItem(item) {
  window.CC.go("command");
  setTimeout(() => {
    const box = $("#orders"); if (!box) return;
    box.value = item.prompt; S.lastOrders = item.prompt; box.focus();
    api(`/extension/inbox/${item.id}`, { method: "DELETE" }).then(() => { inbox = inbox.filter((x) => x.id !== item.id); }).catch(() => {});
    toast("In Marching orders: check it, then press Send");
  }, 60);
}

async function renderCommand(el) {
  if (S.mode === "hosted") { el.innerHTML = ""; return; }
  await loadInbox();
  if (!inbox.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="route" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="small muted">From your browser:</span>
    ${inbox.slice(0, 5).map((it) => `<span class="chip" title="${esc(it.url || "")}">${it.kind === "selection" ? "selection" : it.kind === "link" ? "link" : "page"} · ${esc((it.title || it.url || "untitled").slice(0, 50))} · ${esc(ago(it.at))}
      <button class="ghost small" data-ext-use="${it.id}">use</button><button class="ghost small" data-ext-drop="${it.id}" title="Remove">x</button></span>`).join("")}</div>`;
  el.querySelectorAll("[data-ext-use]").forEach((b) => b.addEventListener("click", () => useItem(inbox.find((x) => x.id === b.dataset.extUse))));
  el.querySelectorAll("[data-ext-drop]").forEach((b) => b.addEventListener("click", async () => { await api(`/extension/inbox/${b.dataset.extDrop}`, { method: "DELETE" }).catch(() => {}); renderCommand(el); }));
}

async function renderSettings(el) {
  if (S.mode === "hosted") { el.innerHTML = ""; return; }
  let d;
  try { d = await api("/extension/info"); } catch (e) { el.innerHTML = `<div class="panel"><h3>Browser extension</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  el.innerHTML = `<div class="panel"><h3>Browser extension <span class="right">${d.pairings.length} paired</span></h3>
    <div class="small muted">Send the page you are on, or a selection, from Chrome or Edge to a chat or a council here. The extension talks only to this app on this PC (port ${d.port}) with a pairing code made here; nothing is sent anywhere else. You choose in the extension whether a page waits in Marching orders (the default) or is asked right away.</div>
    <ol class="small" style="margin:8px 0 0 18px;padding:0">
      <li>Open <span class="mono">chrome://extensions</span> (or <span class="mono">edge://extensions</span>) and switch on Developer mode.</li>
      <li>Click "Load unpacked" and pick this folder: <span class="mono" style="user-select:all">${esc(d.folder)}</span> <button class="ghost small" id="ext-open">open folder</button></li>
      <li>Click "Pair a browser" below, then paste the code into the extension (its icon in the toolbar).</li>
    </ol>
    <div class="row small" style="gap:8px;margin-top:10px"><input type="text" id="ext-name" placeholder="Name, e.g. Chrome on my laptop" style="width:240px"><button class="btn sm primary" id="ext-pair">Pair a browser</button></div>
    <div id="ext-code"></div>
    ${d.pairings.length ? `<div class="cat-h" style="margin-top:12px">Paired browsers</div>${d.pairings.map((p) => `<div class="row small" style="gap:8px;padding:3px 0"><b>${esc(p.name)}</b><span class="dim">paired ${esc(ago(p.createdAt))}${p.lastUsed ? ` · last used ${esc(ago(p.lastUsed))} · ${p.sends} sent` : " · not used yet"}</span><button class="ghost small" data-ext-unpair="${p.id}" style="margin-left:auto">unpair</button></div>`).join("")}` : ""}
  </div>`;
  el.querySelector("#ext-open").addEventListener("click", () => api("/open", { method: "POST", body: { path: d.folder } }).catch((e) => toast(e.message, true)));
  el.querySelector("#ext-pair").addEventListener("click", async () => {
    try {
      const r = await api("/extension/pairings", { method: "POST", body: { name: el.querySelector("#ext-name").value } });
      await renderSettings(el);
      el.querySelector("#ext-code").innerHTML = `<div class="route small" style="margin-top:8px">Pairing code for <b>${esc(r.name)}</b>, shown only now: <span class="mono" style="user-select:all;word-break:break-all">${esc(r.code)}</span> <button class="ghost small" id="ext-copy">copy</button></div>`;
      el.querySelector("#ext-copy").addEventListener("click", () => navigator.clipboard.writeText(r.code).then(() => toast("Copied")).catch(() => {}));
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-ext-unpair]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Unpair this browser? Its code stops working at once.")) return; await api(`/extension/pairings/${b.dataset.extUnpair}`, { method: "DELETE" }); toast("Unpaired"); renderSettings(el); }));
}

window.CC.register({
  id: "extension",
  command: { order: 6, render: renderCommand },
  settings: { order: 36, render: renderSettings },
  onEvent(ev) {
    if (ev.type !== "extension.draft" || !ev.item) return;
    inbox = [ev.item, ...inbox.filter((x) => x.id !== ev.item.id)];
    const box = $("#orders");
    if (S.view === "command" && box && !box.value.trim()) useItem(ev.item);
    else toast(`From your browser: ${ev.item.title || "a page"} is waiting in Command`);
  },
});
