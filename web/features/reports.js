// Reports tab: the latest weekly report, history, run now, and an email draft / export.
// Nothing is sent from here: "Email draft" opens the person's own mail app with the report filled in.
const { S, api, toast, esc, md, money } = window.CC;

async function renderTab(view) {
  view.innerHTML = `<div class="empty">Loading…</div>`;
  let d; try { d = await api("/reports/latest"); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const r = d.latest;
  view.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 320px">
    <div class="panel"><h3>Weekly report <span class="right">${r ? new Date(r.ts).toLocaleString() : "not run yet"}</span><button class="btn sm primary" id="rp-run" style="margin-left:8px">Run now</button></h3>
      ${r ? `<div class="kpi" style="margin-bottom:12px"><div class="k"><div class="l">This week</div><div class="v">${money(r.totals.thisWeek)}</div><div class="s">${r.totals.calls} calls</div></div><div class="k"><div class="l">Last week</div><div class="v">${money(r.totals.lastWeek)}</div></div><div class="k"><div class="l">Runs shipped</div><div class="v">${r.totals.runs}</div></div><div class="k"><div class="l">Needs attention</div><div class="v">${r.low + r.renewals}</div><div class="s">${r.low} low · ${r.renewals} renewing</div></div></div>
      <div class="row small" style="gap:8px;margin-bottom:10px"><button class="btn sm" id="rp-draft">Email draft</button><button class="btn sm" id="rp-export">Export .md</button><button class="btn sm" id="rp-copy">Copy</button></div>
      <div class="md">${md(r.markdown)}</div>` : `<div class="empty">Made every Monday from 7:00 (or the next time the app runs), or click Run now.</div>`}
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Email draft</h3>
        <label class="lbl" for="rp-email">Send-to address for the draft</label>
        <input type="text" id="rp-email" placeholder="you@example.com" value="${esc(d.prefs?.email || "")}">
        <div class="dim small" style="margin-top:6px">Nothing is emailed automatically. Email draft opens your own mail app with the report filled in; you decide whether to send it.</div></div>
      <div class="panel"><h3>History</h3>${(d.history || []).slice(0, 12).map((h) => `<div class="row small" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${new Date(h.ts).toLocaleDateString()}</span><span class="dim">${esc(h.reason || "")}</span><span class="mono" style="margin-left:auto">${money(h.totals?.thisWeek || 0)}</span></div>`).join("") || `<div class="dim small">No reports yet.</div>`}</div>
    </div></div>`;
  view.querySelector("#rp-run").addEventListener("click", async () => { try { await api("/reports/run-now", { method: "POST" }); toast("Report ready"); renderTab(view); } catch (e) { toast(e.message, true); } });
  view.querySelector("#rp-email").addEventListener("change", async () => { try { await api("/reports/prefs", { method: "POST", body: { email: view.querySelector("#rp-email").value } }); toast("Saved"); } catch (e) { toast(e.message, true); } });
  if (!r) return;
  view.querySelector("#rp-draft").addEventListener("click", async () => {
    // the desktop shell hands mailto: to the system mail app
    try { const dr = await api("/reports/draft"); location.href = dr.mailto; toast("Draft opened in your mail app"); } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#rp-export").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown" }));
    a.download = `weekly-report-${new Date(r.ts).toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  view.querySelector("#rp-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(r.markdown); toast("Report copied"); } catch { toast("Copy failed: use Export instead", true); } });
}

CC.register({ id: "reports", tab: { label: "Reports", short: "Reports", icon: "▤", order: 35, render: renderTab } });
