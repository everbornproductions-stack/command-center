// Savings receipt under every finished run, a totals tile in Command, and a PNG export for Reels.
const { S, api, toast, esc, money, fmtN, pname, pcolor } = window.CC;
let creditsCache = null;

function card(r, title) {
  const rows = Object.entries(r.byModel).sort((a, b) => b[1].cost - a[1].cost);
  return `<div class="route" style="margin-top:12px;border-left:3px solid var(--green)" id="rcpt">
    <div class="row"><b>Savings receipt</b><span class="dim small">${esc(title || "")}</span><button class="ghost small" id="rcpt-png" style="margin-left:auto">save as image</button></div>
    <div class="kpi" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
      <div class="k"><div class="l">This run cost</div><div class="v" style="font-size:18px">${money(r.actual, 4)}${r.estimated ? "~" : ""}</div><div class="s">${r.calls} calls · ${fmtN(r.inTok + r.outTok)} tokens</div></div>
      <div class="k"><div class="l">All on ${esc(r.flagship?.name || "the flagship")}</div><div class="v" style="font-size:18px">${money(r.flagshipCost, 4)}</div><div class="s">the manual way</div></div>
      <div class="k" style="border-color:#1d4d3b"><div class="l">Saved</div><div class="v" style="font-size:18px;color:var(--green)">${money(r.saved, 4)} · ${r.savedPct}%</div><div class="s">routing + council</div></div>
    </div>
    <div class="small" style="margin-top:8px">${rows.map(([m, b]) => `<span class="chip" style="margin:2px"><span class="dot" style="background:${pcolor(b.provider)}"></span>${esc(m)} ${money(b.cost, 4)}</span>`).join(" ")}</div>
  </div>`;
}

function toPng(r) {
  // draw a simple receipt image with canvas (no html2canvas): title, three numbers, model chips
  if (!r) return;
  const W = 1080, H = 1080, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, "#0f1a2b"); grad.addColorStop(1, "#090d14"); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#22d3ee"; g.font = "600 34px Inter, Arial"; g.fillText("COMMAND AI · SAVINGS RECEIPT", 70, 110);
  g.fillStyle = "#e5e7eb"; g.font = "700 72px Inter, Arial"; g.fillText(`${r.savedPct}% cheaper`, 70, 260);
  g.font = "400 36px Inter, Arial"; g.fillStyle = "#8b95a7"; g.fillText(`${money(r.actual, 4)} instead of ${money(r.flagshipCost, 4)} on ${r.flagship?.name || "the flagship"}`, 70, 330);
  g.fillText(`${r.calls} AI calls · ${fmtN(r.inTok + r.outTok)} tokens`, 70, 390);
  let y = 500; g.font = "500 34px Inter, Arial";
  for (const [m, b] of Object.entries(r.byModel).sort((a, bb) => bb[1].cost - a[1].cost).slice(0, 8)) { g.fillStyle = pcolor(b.provider); g.beginPath(); g.arc(90, y - 12, 12, 0, Math.PI * 2); g.fill(); g.fillStyle = "#e5e7eb"; g.fillText(`${pname(b.provider)} · ${m}`, 130, y); g.fillStyle = "#8b95a7"; g.fillText(money(b.cost, 4), 820, y); y += 60; }
  g.fillStyle = "#4b5563"; g.font = "400 28px Inter, Arial"; g.fillText("One console for every AI you pay for  ·  everbornproductions.com", 70, H - 70);
  const a = document.createElement("a"); a.download = `savings-receipt-${r.missionId}.png`; a.href = c.toDataURL("image/png"); a.click();
}

CC.register({
  id: "receipt",
  deliverable: { order: 10, async render(el, run) {
    if (!run?.id) { el.innerHTML = ""; return; }
    try { const r = await api(`/receipt/${run.id}`); el.innerHTML = card(r, run.kind); el.querySelector("#rcpt-png").addEventListener("click", () => toPng(r)); }
    catch { el.innerHTML = ""; }
  } },
  // Credits tab: month and all-time savings, plus a receipt line per recent run (the tab redraws on every
  // tick, so the numbers are fetched at most every 30 s)
  credits: { order: 10, async render(el) {
    const now = Date.now();
    if (!creditsCache || now - creditsCache.at > 30000) {
      try { creditsCache = { at: now, t: await api("/receipt/totals"), runs: await api("/receipt/recent?limit=8") }; }
      catch { el.innerHTML = ""; return; }
    }
    const { t, runs } = creditsCache;
    const title = (id) => S.missions.find((m) => m.id === id)?.title || id;
    el.innerHTML = `<div class="panel"><h3>Savings receipts <span class="right">vs ${esc(t.flagship || "the flagship")} for everything</span></h3>
      <div class="kpi" style="grid-template-columns:repeat(3,1fr)">
        <div class="k"><div class="l">Saved this month</div><div class="v" style="color:var(--green)">${money(t.month.saved)}</div><div class="s">${money(t.month.actual)} spent instead of ${money(t.month.flagship)}</div></div>
        <div class="k"><div class="l">Saved all time</div><div class="v" style="color:var(--green)">${money(t.allTime.saved)}</div><div class="s">${money(t.allTime.actual)} spent instead of ${money(t.allTime.flagship)}</div></div>
        <div class="k"><div class="l">Runs with a receipt</div><div class="v">${t.runs}</div><div class="s">chats, councils and missions</div></div>
      </div>
      ${runs.length ? `<table class="tbl" style="margin-top:10px"><thead><tr><th>Run</th><th class="right">This cost</th><th class="right">Flagship-only</th><th class="right">Saved</th><th></th></tr></thead><tbody>${runs.map((r, i) => `<tr><td class="small">${esc(title(r.missionId))}</td><td class="right mono">${money(r.actual, 4)}${r.estimated ? "~" : ""}</td><td class="right mono dim">${money(r.flagshipCost, 4)}</td><td class="right mono" style="color:var(--green)">${money(r.saved, 4)} · ${r.savedPct}%</td><td class="right"><button class="ghost small" data-rpng="${i}">save as image</button></td></tr>`).join("")}</tbody></table>` : `<div class="dim small" style="margin-top:8px">No runs yet. Each chat, council or mission gets a receipt here.</div>`}
    </div>`;
    el.querySelectorAll("[data-rpng]").forEach((b) => b.addEventListener("click", () => toPng(runs[Number(b.dataset.rpng)])));
  } },
  command: { order: 30, async render(el) {
    try { const t = await api("/receipt/totals"); el.innerHTML = `<div class="route" style="margin-top:8px;display:flex;gap:14px;align-items:center"><span class="small">Saved this month vs ${esc(t.flagship || "flagship")}-only:</span><b style="color:var(--green)">${money(t.month.saved)}</b><span class="dim small">all time ${money(t.allTime.saved)} over ${t.runs} runs</span></div>`; }
    catch { el.innerHTML = ""; }
  } },
});
