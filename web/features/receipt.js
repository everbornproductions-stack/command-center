// Savings receipt under every finished run, a You saved figure in the top bar (this month and all
// time), a breakdown on the Credits tab, and a PNG of the summary. Styles are injected here; the
// shell files stay as they are.
const { S, api, toast, esc, money, fmtN, pname, pcolor } = window.CC;
const LABEL = "Estimated, based on token counts and list prices.";
// Hover text for the header counter. Dollars are estimates unless a provider reported an exact bill.
const SAVED_TIP = "Estimate. For each run, saved is what the same input and output tokens would have cost on the reference model, minus what the run actually cost. This month and all time add those differences. The reference model defaults to the most expensive flagship you have a key for. You can change it in Settings. New runs use the new reference. Older runs keep the baseline they stored. A free or local run costs $0, so the reference price counts as saved. A prompt-cache read is priced at the cache rate when the provider reports it, which lowers the actual cost. A cheaper seller for the same model lowers the actual cost. Batch half price counts only when that call was billed as a batch. A run you send now pays the live price. When the provider reports an exact bill, that bill is the actual cost. Otherwise the actual cost is estimated from token counts and list prices.";
let creditsCache = null;
let barAt = 0;

const css = `
.cc-money-saved { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 1px; margin-right: 2px; padding: 3px 8px; border: 1px solid var(--line, #1f2937); border-radius: 10px; background: #0a0f18; line-height: 1.15; max-width: 240px; min-width: 0; flex: 0 1 240px; cursor: help; }
.cc-money-saved .cc-ms-top { display: flex; align-items: baseline; gap: 6px; flex-wrap: nowrap; min-width: 0; overflow: hidden; }
.cc-money-saved .cc-ms-you, .cc-money-saved .cc-ms-when, .cc-money-saved .cc-ms-v, .cc-money-saved .cc-ms-est, .cc-money-saved .cc-ms-k, .cc-money-saved .cc-ms-all { white-space: nowrap; }
.cc-money-saved .cc-ms-you { font-size: 12px; font-weight: 650; color: var(--text, #e5e7eb); }
.cc-money-saved .cc-ms-when { font-size: 10px; color: var(--muted, #8b95a7); }
.cc-money-saved .cc-ms-k { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim, #5b667a); }
.cc-money-saved .cc-ms-v { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; font-weight: 700; color: var(--green, #34d399); }
.cc-money-saved .cc-ms-sub { display: flex; align-items: baseline; gap: 6px; font-size: 11px; color: var(--muted, #8b95a7); min-width: 0; overflow: hidden; white-space: nowrap; }
.cc-money-saved .cc-ms-all { font-family: var(--mono, ui-monospace, monospace); font-size: 12px; font-weight: 700; color: var(--green, #34d399); }
.cc-money-saved .cc-ms-est { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: var(--amber, #fbbf24); }
.cc-money-saved .cc-ms-note { font-size: 9px; color: var(--muted, #8b95a7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cc-money-saved .cc-ms-tip { display: none; position: absolute; z-index: 40; top: calc(100% + 6px); right: 0; width: min(380px, 78vw); padding: 8px 10px; border: 1px solid var(--line, #1f2937); border-radius: 10px; background: #0b111b; color: var(--text, #e5e7eb); font-size: 12px; font-weight: 450; line-height: 1.4; letter-spacing: 0; text-transform: none; white-space: normal; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
.cc-money-saved:hover .cc-ms-tip, .cc-money-saved:focus .cc-ms-tip, .cc-money-saved:focus-within .cc-ms-tip { display: block; }
body[data-ui="simple"] .cc-money-saved { display: none; }
.cc-ms-label { color: var(--muted, #8b95a7); font-size: 12px; margin-top: 6px; }
html[data-theme="light"] .cc-money-saved { background: #fff; }
html[data-theme="light"] .cc-money-saved .cc-ms-tip { background: #fff; }
.app { grid-template-rows: auto minmax(0, 1fr) var(--strip-h); }
.topbar { height: auto; min-height: 56px; padding-top: 6px; padding-bottom: 6px; }
@media (max-width: 760px) {
  .app, body[data-ui="simple"] .app { grid-template-rows: auto minmax(0, 1fr) var(--strip-h) 56px; grid-template-areas: "top" "view" "strip" "nav"; }
  .topbar { min-height: 48px; }
  .top-right { flex-wrap: wrap; justify-content: flex-end; }
  .cc-money-saved { max-width: none; flex: 1 1 100%; }
  .cc-money-saved .cc-ms-note { font-size: 10px; }
}
`;
if (!document.getElementById("cc-money-saved-style")) {
  const style = document.createElement("style");
  style.id = "cc-money-saved-style";
  style.textContent = css;
  document.head.appendChild(style);
}

function mountBar() {
  const host = document.querySelector(".topbar .top-right") || document.querySelector(".topbar");
  if (!host || document.getElementById("cc-money-saved")) return;
  const el = document.createElement("div");
  el.id = "cc-money-saved";
  el.className = "cc-money-saved";
  el.setAttribute("role", "status");
  el.tabIndex = 0;
  el.innerHTML = `<span class="cc-ms-top"><span class="cc-ms-you">You saved</span><span class="cc-ms-v" data-cc-ms="month">$0.00</span><span class="cc-ms-when">this month</span><span class="cc-ms-est">Estimate</span></span><span class="cc-ms-sub"><span class="cc-ms-k">All time</span><span class="cc-ms-all" data-cc-ms="all">$0.00</span></span><span class="cc-ms-note"></span><span class="cc-ms-tip"></span>`;
  el.querySelector(".cc-ms-note").textContent = LABEL;
  el.querySelector(".cc-ms-tip").textContent = SAVED_TIP;
  el.title = SAVED_TIP;
  el.setAttribute("aria-label", `You saved $0.00 this month. All time $0.00. Estimate. ${LABEL}`);
  host.prepend(el);
}

function savedMoney(n) {
  const v = Number(n) || 0;
  return money(v, v !== 0 && Math.abs(v) < 0.01 ? 4 : 2);
}
function paintBar(monthSaved, allSaved) {
  const el = document.getElementById("cc-money-saved");
  if (!el) return;
  const month = savedMoney(monthSaved);
  const all = savedMoney(allSaved);
  const mv = el.querySelector("[data-cc-ms='month']");
  const av = el.querySelector("[data-cc-ms='all']");
  if (mv) mv.textContent = month;
  if (av) av.textContent = all;
  el.title = SAVED_TIP;
  el.setAttribute("aria-label", `You saved ${month} this month. All time ${all}. Estimate. ${LABEL}`);
}

async function refreshBar() {
  mountBar();
  const now = Date.now();
  if (now - barAt < 4000 && document.getElementById("cc-money-saved")?.dataset.ready === "1") return;
  barAt = now;
  try {
    const t = await api("/receipt/totals");
    paintBar(t.month?.saved, t.allTime?.saved);
    const el = document.getElementById("cc-money-saved");
    if (el) el.dataset.ready = "1";
  } catch { /* the label stays up even before the engine answers */ }
}

function marks(r) {
  const bits = [];
  if (r.manual) bits.push(`${r.manual} manual`);
  if (r.free) bits.push(`${r.free} free`);
  return bits.length ? `<span class="dim"> · ${bits.join(", ")}</span>` : "";
}

function card(r, title) {
  const rows = Object.entries(r.byModel || {}).sort((a, b) => b[1].cost - a[1].cost);
  return `<div class="route" style="margin-top:12px;border-left:3px solid var(--green)" id="rcpt">
    <div class="row"><b>Savings receipt</b><span class="dim small">${esc(title || "")}</span><button class="ghost small" id="rcpt-png" style="margin-left:auto">save as image</button></div>
    <div class="kpi" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
      <div class="k"><div class="l">This run cost</div><div class="v" style="font-size:18px">${money(r.actual, 4)}${r.estimated ? "~" : ""}</div><div class="s">${r.calls} calls · ${fmtN(r.inTok + r.outTok)} tokens${marks(r)}</div></div>
      <div class="k"><div class="l">All on ${esc(r.flagship?.name || "the flagship")}</div><div class="v" style="font-size:18px">${money(r.flagshipCost, 4)}</div><div class="s">price table ${esc(r.priceAsOf || "")}</div></div>
      <div class="k" style="border-color:#1d4d3b"><div class="l">Saved</div><div class="v" style="font-size:18px;color:var(--green)">${money(r.saved, 4)} · ${r.savedPct}%</div><div class="s">routing + council</div></div>
    </div>
    <div class="small" style="margin-top:8px">${rows.map(([m, b]) => `<span class="chip" style="margin:2px"><span class="dot" style="background:${pcolor(b.provider)}"></span>${esc(m)} ${money(b.cost, 4)}${b.manual ? " manual" : ""}${b.free ? " free" : ""}</span>`).join(" ")}</div>
    <div class="cc-ms-label">${esc(LABEL)}</div>
  </div>`;
}

function refOptions(ref) {
  const cur = ref?.current;
  const choices = ref?.choices || [];
  const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const auto = opt("auto", "Automatic: most expensive flagship you have a key for", !cur || cur.auto);
  const rest = choices.map((m) => opt(m.id, `${m.flagship ? "Flagship: " : ""}${m.name} (${m.providerName})`, !cur?.auto && cur?.model === m.id)).join("");
  return auto + rest;
}

function drawCanvas(draw, filename) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = draw.toDataURL("image/png");
  a.click();
}

function toPng(r) {
  if (!r) return;
  const W = 1080, H = 1200, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, "#0f1a2b"); grad.addColorStop(1, "#090d14"); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#22d3ee"; g.font = "600 34px Inter, Arial"; g.fillText("MELDMIND · SAVINGS RECEIPT", 70, 110);
  g.fillStyle = "#8b95a7"; g.font = "400 22px Inter, Arial"; g.fillText("an Everborn product  ·  Take command of all your AIs.", 70, 150);
  g.fillStyle = "#e5e7eb"; g.font = "700 72px Inter, Arial"; g.fillText(`${r.savedPct}% cheaper`, 70, 260);
  g.font = "400 36px Inter, Arial"; g.fillStyle = "#8b95a7"; g.fillText(`${money(r.actual, 4)} instead of ${money(r.flagshipCost, 4)} on ${r.flagship?.name || "the flagship"}`, 70, 330);
  g.fillText(`${r.calls} AI calls · ${fmtN((r.inTok || 0) + (r.outTok || 0))} tokens`, 70, 390);
  g.font = "400 28px Inter, Arial"; g.fillText(LABEL, 70, 450);
  let y = 540; g.font = "500 34px Inter, Arial";
  for (const [m, b] of Object.entries(r.byModel || {}).sort((a, bb) => bb[1].cost - a[1].cost).slice(0, 8)) {
    g.fillStyle = pcolor(b.provider); g.beginPath(); g.arc(90, y - 12, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e5e7eb"; g.fillText(`${pname(b.provider)} · ${m}${b.manual ? " (manual)" : ""}${b.free ? " (free)" : ""}`, 130, y);
    g.fillStyle = "#8b95a7"; g.fillText(money(b.cost, 4), 820, y); y += 60;
  }
  g.fillStyle = "#4b5563"; g.font = "400 28px Inter, Arial"; g.fillText("One console for every AI you pay for  ·  everbornproductions.com", 70, H - 70);
  drawCanvas(c, `savings-receipt-${r.missionId}.png`);
}

function summaryPng(t) {
  if (!t) return;
  const prov = (t.byProvider || []).slice(0, 8);
  const proj = (t.byProject || []).slice(0, 8);
  const W = 1080, H = 780 + (prov.length + proj.length) * 52;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, "#0f1a2b"); grad.addColorStop(1, "#090d14"); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#22d3ee"; g.font = "600 34px Inter, Arial"; g.fillText("MELDMIND · MONEY SAVED", 70, 100);
  g.fillStyle = "#8b95a7"; g.font = "400 22px Inter, Arial"; g.fillText("an Everborn product  ·  Take command of all your AIs.", 70, 140);
  g.font = "400 26px Inter, Arial"; g.fillText(LABEL, 70, 190);
  const blocks = [["Today", t.day], ["This month", t.month], ["All time", t.allTime]];
  blocks.forEach((b, i) => {
    const x = 70 + i * 320;
    g.fillStyle = "#8b95a7"; g.font = "500 24px Inter, Arial"; g.fillText(b[0], x, 270);
    g.fillStyle = "#34d399"; g.font = "700 48px Inter, Arial"; g.fillText(savedMoney(b[1]?.saved), x, 330);
    g.fillStyle = "#8b95a7"; g.font = "400 22px Inter, Arial"; g.fillText(`${money(b[1]?.actual, 4)} spent`, x, 370);
  });
  let y = 460;
  g.fillStyle = "#e5e7eb"; g.font = "600 28px Inter, Arial"; g.fillText("By provider", 70, y); y += 48;
  g.font = "400 26px Inter, Arial";
  for (const p of prov) { g.fillStyle = "#e5e7eb"; g.fillText(pname(p.provider), 70, y); g.fillStyle = "#34d399"; g.fillText(savedMoney(p.saved), 700, y); y += 46; }
  y += 20;
  g.fillStyle = "#e5e7eb"; g.font = "600 28px Inter, Arial"; g.fillText("By project", 70, y); y += 48;
  g.font = "400 26px Inter, Arial";
  for (const p of proj) { g.fillStyle = "#e5e7eb"; g.fillText(String(p.name || "No project").slice(0, 40), 70, y); g.fillStyle = "#34d399"; g.fillText(savedMoney(p.saved), 700, y); y += 46; }
  g.fillStyle = "#4b5563"; g.font = "400 24px Inter, Arial"; g.fillText(`Reference: ${t.flagship || "flagship"}  ·  everbornproductions.com`, 70, H - 60);
  drawCanvas(c, "money-saved.png");
}

function periodBox(label, bucket) {
  return `<div class="k"><div class="l">${label}</div><div class="v" style="color:var(--green)">${savedMoney(bucket?.saved)}</div><div class="s">${money(bucket?.actual, 4)} spent, baseline ${money(bucket?.baseline ?? bucket?.flagship, 4)}</div></div>`;
}

function bindReference(el, onSaved) {
  const sel = el.querySelector("[data-rcpt-ref]");
  if (!sel) return;
  sel.addEventListener("change", async () => {
    sel.disabled = true;
    try {
      await api("/receipt/reference", { method: "POST", body: { model: sel.value } });
      creditsCache = null;
      toast("Reference model saved. New runs use it. Saved totals from earlier runs stay as they were.");
      if (onSaved) await onSaved();
    } catch (e) { toast(e.message || "Could not save the reference model"); }
    finally { sel.disabled = false; }
  });
}

mountBar();
// The socket hello can arrive before this module registers, and later ticks do not call onState.
// Fetch the total now, and keep trying until the first answer paints, so the bar is not stuck on $0.00.
refreshBar();
let barTries = 0;
const barBoot = setInterval(() => {
  if (document.getElementById("cc-money-saved")?.dataset.ready === "1" || barTries > 12) { clearInterval(barBoot); return; }
  barTries += 1;
  refreshBar();
}, 1500);

CC.register({
  id: "receipt",
  onState() { mountBar(); refreshBar(); },
  onEvent(ev) { if (ev?.type === "ledger.entry" || ev?.type === "mission.update") refreshBar(); },
  deliverable: { order: 10, async render(el, run) {
    if (!run?.id) { el.innerHTML = ""; return; }
    try {
      const r = await api(`/receipt/${run.id}`);
      el.innerHTML = card(r, run.kind);
      el.querySelector("#rcpt-png").addEventListener("click", () => toPng(r));
    } catch { el.innerHTML = ""; }
  } },
  credits: { order: 10, async render(el) {
    const now = Date.now();
    if (!creditsCache || now - creditsCache.at > 30000) {
      try {
        creditsCache = { at: now, t: await api("/receipt/totals"), runs: await api("/receipt/recent?limit=8"), ref: await api("/receipt/reference") };
      } catch { el.innerHTML = ""; return; }
    }
    const { t, runs, ref } = creditsCache;
    const sig = JSON.stringify({ saved: t.allTime?.saved, day: t.day?.saved, ref: ref?.current?.model, auto: ref?.current?.auto, n: runs.length });
    if (el.dataset.sig === sig && el.querySelector("[data-rcpt-ref]")) return;
    el.dataset.sig = sig;
    const title = (id) => S.missions.find((m) => m.id === id)?.title || id;
    const providerRows = (t.byProvider || []).map((p) => `<tr><td class="small">${esc(pname(p.provider))}${p.manual ? " · manual" : ""}${p.free ? " · free" : ""}</td><td class="right mono">${money(p.actual, 4)}</td><td class="right mono dim">${money(p.baseline, 4)}</td><td class="right mono" style="color:var(--green)">${savedMoney(p.saved)}</td></tr>`).join("");
    const projectRows = (t.byProject || []).map((p) => `<tr><td class="small">${esc(p.name || "No project")}</td><td class="right mono">${money(p.actual, 4)}</td><td class="right mono dim">${money(p.baseline, 4)}</td><td class="right mono" style="color:var(--green)">${savedMoney(p.saved)}</td></tr>`).join("");
    el.innerHTML = `<div class="panel"><div class="row"><h3 style="margin:0">Savings receipts</h3><span class="right dim small">reference: ${esc(t.flagship || "the flagship")}${t.reference?.auto ? " (automatic)" : ""}</span><button class="ghost small" id="rcpt-summary-png">save summary as image</button></div>
      <div class="cc-ms-label">${esc(LABEL)}</div>
      <label class="lbl" style="display:block;margin-top:10px">Reference model <select data-rcpt-ref style="margin-left:8px">${refOptions(ref)}</select></label>
      <div class="dim small" style="margin-top:4px">${t.manual?.calls ? `${t.manual.calls} manual (counted as $0). ` : ""}${t.free?.calls ? `${t.free.calls} free.` : ""}</div>
      <div class="kpi" style="grid-template-columns:repeat(3,1fr);margin-top:8px">
        ${periodBox("Saved today", t.day)}
        ${periodBox("Saved this month", t.month)}
        ${periodBox("Saved all time", t.allTime)}
      </div>
      <h3 style="margin-top:14px">By provider</h3>
      ${providerRows ? `<table class="tbl"><thead><tr><th>Provider</th><th class="right">Spent</th><th class="right">Baseline</th><th class="right">Saved</th></tr></thead><tbody>${providerRows}</tbody></table>` : `<div class="dim small">No calls yet.</div>`}
      <h3 style="margin-top:14px">By project</h3>
      ${projectRows ? `<table class="tbl"><thead><tr><th>Project</th><th class="right">Spent</th><th class="right">Baseline</th><th class="right">Saved</th></tr></thead><tbody>${projectRows}</tbody></table>` : `<div class="dim small">No calls yet.</div>`}
      ${runs.length ? `<table class="tbl" style="margin-top:14px"><thead><tr><th>Run</th><th class="right">This cost</th><th class="right">Flagship-only</th><th class="right">Saved</th><th></th></tr></thead><tbody>${runs.map((r, i) => `<tr><td class="small">${esc(title(r.missionId))}${r.manual ? " · manual" : ""}${r.free ? " · free" : ""}</td><td class="right mono">${money(r.actual, 4)}${r.estimated ? "~" : ""}</td><td class="right mono dim">${money(r.flagshipCost, 4)}</td><td class="right mono" style="color:var(--green)">${money(r.saved, 4)} · ${r.savedPct}%</td><td class="right"><button class="ghost small" data-rpng="${i}">save as image</button></td></tr>`).join("")}</tbody></table>` : `<div class="dim small" style="margin-top:8px">No runs yet. Each chat, council or mission gets a receipt here.</div>`}
    </div>`;
    el.querySelector("#rcpt-summary-png").addEventListener("click", () => summaryPng(t));
    el.querySelectorAll("[data-rpng]").forEach((b) => b.addEventListener("click", () => toPng(runs[Number(b.dataset.rpng)])));
    bindReference(el, async () => { creditsCache = null; el.dataset.sig = ""; barAt = 0; refreshBar(); });
  } },
  settings: { order: 36, async render(el) {
    let ref = null;
    try { ref = await api("/receipt/reference"); } catch { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="panel"><h3>Money saved</h3>
      <div class="cc-ms-label">${esc(LABEL)}</div>
      <label class="lbl" style="display:block;margin-top:10px">Reference model <select data-rcpt-ref style="margin-left:8px">${refOptions(ref)}</select></label>
      <div class="dim small" style="margin-top:6px">The default is the most expensive flagship you have a key for. New runs use the model you pick. Earlier runs keep the baseline they stored.</div>
    </div>`;
    bindReference(el);
  } },
  command: { order: 30, async render(el) {
    try {
      const t = await api("/receipt/totals");
      el.innerHTML = `<div class="route" style="margin-top:8px" title="${esc(SAVED_TIP)}"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><span class="small">You saved</span><b style="color:var(--green)">${savedMoney(t.month.saved)}</b><span class="small">this month</span><span class="dim small">All time ${savedMoney(t.allTime.saved)} over ${t.runs} runs</span><span class="cc-ms-est">Estimate</span></div><div class="cc-ms-label">${esc(LABEL)}</div></div>`;
    } catch { el.innerHTML = ""; }
  } },
});
