// "Share live link" under the deliverable: creates an expiring read-only link (with your brand kit).
// A link built from this PC only works on this PC. Say so, and offer the text as a copy or a file.
const { api, toast, esc } = window.CC;
import { localOnlyHost } from "../copy-guard.js";

const cache = new Map(); // missionId -> { ts, items }

function deliverableText() {
  const live = window.CC.S.live || {};
  return String(live.deliverable || document.getElementById("out-md")?.innerText || "").trim();
}

function downloadText(name, text) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

function fallbackBox(url) {
  return `<div class="hint" id="sh-local" role="note">This link only works on this PC. Copy the text or export a file if someone else needs it.</div>
    <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap">
      <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
      <button class="btn sm" type="button" id="sh-copy-text">Copy the text</button>
      <button class="btn sm" type="button" id="sh-export">Export</button>
    </div>`;
}

CC.register({
  id: "share",
  deliverable: { order: 5, render(el, run) {
    if (window.CC.uiMode?.() === "simple") { el.innerHTML = ""; return; }
    const live = window.CC.S.live; const id = live?.id;
    if (!id) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn sm" id="sh-make" type="button">Share live link</button><button class="btn sm" id="sh-public" type="button">Public link (Pro)</button><select id="sh-ttl" aria-label="How long the link lasts" style="width:auto"><option value="60">1 hour</option><option value="1440" selected>24 hours</option><option value="10080">7 days</option></select><label class="row small" style="gap:4px"><input type="checkbox" id="sh-costs"> show costs</label><span class="dim" id="sh-out"></span></div><div class="dim small">Read-only, with your brand kit. Keys are never shown; costs only if you tick the box. A public link is a Pro page anyone with the link can open. Nothing is posted until you copy it.</div><div id="sh-list"></div>`;
    const ttlBody = () => ({ missionId: id, ttlMinutes: Number(el.querySelector("#sh-ttl").value), showCosts: el.querySelector("#sh-costs").checked });
    el.querySelector("#sh-make").addEventListener("click", async () => {
      try {
        const r = await api("/share/create", { method: "POST", body: ttlBody() });
        const url = location.origin + r.url;
        const local = localOnlyHost(location.hostname);
        const out = el.querySelector("#sh-out");
        if (local) {
          out.innerHTML = fallbackBox(url);
          toast("This link only works on this PC");
          out.querySelector("#sh-copy-text").addEventListener("click", async () => {
            const text = deliverableText();
            if (!text) return toast("Nothing to copy yet", true);
            if (window.CC.confirmRisky && !(await window.CC.confirmRisky(text))) return;
            try { await navigator.clipboard.writeText(text); toast("Text copied"); }
            catch { toast("Could not copy: select the answer and press Ctrl+C", true); }
          });
          out.querySelector("#sh-export").addEventListener("click", async () => {
            const text = deliverableText();
            if (!text) return toast("Nothing to export yet", true);
            if (window.CC.confirmRisky && !(await window.CC.confirmRisky(text))) return;
            downloadText("meldmind-share.md", text);
            toast("Exported");
          });
        } else {
          try { await navigator.clipboard.writeText(url); toast("Share link copied"); } catch { toast("Share link ready"); }
          out.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
        }
        listLinks(el, id, true);
      } catch (e) { toast(e.message, true); }
    });
    el.querySelector("#sh-public").addEventListener("click", async () => {
      try {
        const r = await api("/share/public", { method: "POST", body: ttlBody() });
        const url = r.publicUrl || (r.url.startsWith("http") ? r.url : location.origin + r.url);
        try { await navigator.clipboard.writeText(url); toast(r.note || "Share link copied"); } catch { toast(r.note || "Share link ready"); }
        el.querySelector("#sh-out").innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
        listLinks(el, id, true);
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
