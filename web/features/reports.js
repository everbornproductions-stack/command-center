// Reports tab: the latest weekly report, history, run now, email preference.
const { S, api, toast, esc, md, money } = window.CC;

async function renderTab(view) {
  view.innerHTML = `<div class="empty">Loading…</div>`;
  let d; try { d = await api("/reports/latest"); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const r = d.latest;
  view.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 320px">
    <div class="panel"><h3>Weekly report <span class="right">${r ? new Date(r.ts).toLocaleString() : "not run yet"}</span><button class="btn sm primary" id="rp-run" style="margin-left:8px">Run now</button></h3>
      ${r ? `<div class="kpi" style="margin-bottom:12px"><div class="k"><div class="l">This week</div><div class="v">${money(r.totals.thisWeek)}</div><div class="s">${r.totals.calls} calls</div></div><div class="k"><div class="l">Last week</div><div class="v">${money(r.totals.lastWeek)}</div></div><div class="k"><div class="l">Runs shipped</div><div class="v">${r.totals.runs}</div></div><div class="k"><div class="l">Needs attention</div><div class="v">${r.low + r.renewals}</div><div class="s">${r.low} low · ${r.renewals} renewing</div></div></div><div class="md">${md(r.markdown)}</div>` : `<div class="empty">Runs every Monday at 7:00, or click Run now.</div>`}
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Delivery</h3>
        <label class="row small" style="gap:6px"><input type="checkbox" id="rp-emailon" ${d.prefs?.emailOn ? "checked" : ""}> Email me the report</label>
        <input type="text" id="rp-email" placeholder="you@example.com" value="${esc(d.prefs?.email || "")}" style="margin-top:6px">
        <div class="dim small" style="margin-top:6px">Also appears in the live feed and, if push is enabled in Settings → Spend caps &amp; alerts, on your phone.</div></div>
      <div class="panel"><h3>History</h3>${(d.history || []).slice(0, 12).map((h) => `<div class="row small" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${new Date(h.ts).toLocaleDateString()}</span><span class="dim">${esc(h.reason || "")}</span><span class="mono" style="margin-left:auto">${money(h.totals?.thisWeek || 0)}</span></div>`).join("") || `<div class="dim small">No reports yet.</div>`}</div>
    </div></div>`;
  view.querySelector("#rp-run").addEventListener("click", async () => { try { await api("/reports/run-now", { method: "POST" }); toast("Report ready"); renderTab(view); } catch (e) { toast(e.message, true); } });
  const prefs = async () => { try { await api("/reports/prefs", { method: "POST", body: { emailOn: view.querySelector("#rp-emailon").checked, email: view.querySelector("#rp-email").value } }); toast("Saved"); } catch (e) { toast(e.message, true); } };
  view.querySelector("#rp-emailon").addEventListener("change", prefs); view.querySelector("#rp-email").addEventListener("change", prefs);
}

CC.register({ id: "reports", tab: { label: "Reports", short: "Reports", icon: "▤", order: 35, render: renderTab } });
