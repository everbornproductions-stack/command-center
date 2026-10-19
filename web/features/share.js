// "Share live link" under the deliverable: creates an expiring read-only link and copies it.
const { api, toast, esc } = window.CC;

CC.register({
  id: "share",
  deliverable: { order: 5, render(el, run) {
    const live = window.CC.S.live; const id = live?.id;
    if (!id) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="row small" style="margin-top:10px;gap:8px"><button class="btn sm" id="sh-make">Share live link</button><select id="sh-ttl" style="width:auto"><option value="60">1 hour</option><option value="1440" selected>24 hours</option><option value="10080">7 days</option></select><label class="row small" style="gap:4px"><input type="checkbox" id="sh-costs"> show costs</label><span class="dim" id="sh-out"></span></div>`;
    el.querySelector("#sh-make").addEventListener("click", async () => {
      try {
        const r = await api("/share/create", { method: "POST", body: { missionId: id, ttlMinutes: Number(el.querySelector("#sh-ttl").value), showCosts: el.querySelector("#sh-costs").checked } });
        const url = location.origin + r.url;
        try { await navigator.clipboard.writeText(url); toast("Share link copied"); } catch { toast("Share link ready"); }
        el.querySelector("#sh-out").innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`;
      } catch (e) { toast(e.message, true); }
    });
  } },
});
