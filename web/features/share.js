// "Share live link" under the deliverable: creates an expiring read-only link (with your brand kit) and
// copies it. The links already made for this run are listed with Revoke.
const { api, toast, esc } = window.CC;

// the deliverable area redraws while a run streams, so the list is fetched at most every 20 s per run
const cache = new Map(); // missionId -> { ts, items }
async function listLinks(el, id, fresh = false) {
  const box = el.querySelector("#sh-list"); if (!box) return;
  let c = cache.get(id);
  if (fresh || !c || Date.now() - c.ts > 20000) {
    c = { ts: Date.now(), items: c?.items || [] }; cache.set(id, c);
    try { c.items = await api(`/share/list?missionId=${encodeURIComponent(id)}`); } catch { return; }
  }
  const items = c.items;
  if (!box.isConnected) return;
  box.innerHTML = items.map((l) => `<div class="row small" style="gap:8px;padding:3px 0"><a href="${esc(location.origin + l.url)}" target="_blank" rel="noopener" class="mono">${esc(l.token.slice(0, 8))}…</a><span class="dim">${l.expired ? "expired" : `until ${esc(new Date(l.expiresAt).toLocaleString())}`}${l.showCosts ? " · costs shown" : ""}</span>${l.expired ? "" : `<button class="btn sm" data-revoke="${esc(l.token)}">Revoke</button>`}</div>`).join("");
  box.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/share/t/${encodeURIComponent(b.dataset.revoke)}`, { method: "DELETE" }); toast("Link revoked"); listLinks(el, id, true); } catch (e) { toast(e.message, true); }
  }));
}

CC.register({
  id: "share",
  deliverable: { order: 5, render(el, run) {
    const live = window.CC.S.live; const id = live?.id;
    if (!id) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn sm" id="sh-make">Share live link</button><button class="btn sm" id="sh-public">Public link (Pro)</button><select id="sh-ttl" style="width:auto"><option value="60">1 hour</option><option value="1440" selected>24 hours</option><option value="10080">7 days</option></select><label class="row small" style="gap:4px"><input type="checkbox" id="sh-costs"> show costs</label><span class="dim" id="sh-out"></span></div><div class="dim small">Read-only, with your brand kit. Keys are never shown; costs only if you tick the box. A public link is a Pro page anyone with the link can open. Nothing is posted until you copy it.</div><div id="sh-list"></div>`;
    const copyLink = async (path, body) => {
      const r = await api(path, { method: "POST", body });
      const url = r.publicUrl || (r.url.startsWith("http") ? r.url : location.origin + r.url);
      try { await navigator.clipboard.writeText(url); toast(r.note || "Share link copied"); } catch { toast(r.note || "Share link ready"); }
      el.querySelector("#sh-out").innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
      listLinks(el, id, true);
    };
    el.querySelector("#sh-make").addEventListener("click", async () => {
      try {
        await copyLink("/share/create", { missionId: id, ttlMinutes: Number(el.querySelector("#sh-ttl").value), showCosts: el.querySelector("#sh-costs").checked });
      } catch (e) { toast(e.message, true); }
    });
    el.querySelector("#sh-public").addEventListener("click", async () => {
      try {
        await copyLink("/share/public", { missionId: id, ttlMinutes: Number(el.querySelector("#sh-ttl").value), showCosts: el.querySelector("#sh-costs").checked });
      } catch (e) { toast(e.message, true); }
    });
    listLinks(el, id);
  } },
  settings: { order: 42, render(el) {
    el.innerHTML = `<div class="panel" id="sh-settings"><h3>Share</h3>
      <div class="small dim">A public link uses this https address, for example the hosted page or a tunnel you already run. The link is copied when you click Public link. Nothing is posted.</div>
      <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input id="sh-base" type="text" placeholder="https://share.example.com" style="width:280px" aria-label="Public share address"><button class="btn sm" id="sh-save" type="button">Save address</button></div>
      <div class="dim small" id="sh-reach"></div>
    </div>`;
    api("/share/settings").then((r) => {
      const input = el.querySelector("#sh-base");
      if (input && r.publicBase) input.value = r.publicBase;
      const note = el.querySelector("#sh-reach");
      if (note) note.textContent = r.reach === "public" ? "Public links use this address." : "No public address yet. Links stay on this computer.";
    }).catch(() => {});
    el.querySelector("#sh-save").addEventListener("click", async () => {
      try {
        const r = await api("/share/settings", { method: "POST", body: { publicBase: el.querySelector("#sh-base").value } });
        toast(r.reach === "public" ? "Public address saved." : "Address cleared. Links stay on this computer.");
      } catch (e) { toast(e.message, true); }
    });
  } },
});
