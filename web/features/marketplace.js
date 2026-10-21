// Marketplace tab (Phase 10): local and demo catalog. Install, import, submit and report
// happen only when a button is clicked. Nothing is sent off this computer.
const { api, toast, esc } = window.CC;

let selected = null;
let lastExport = null;

function priceLabel(price, paidEnabled) {
  if (!price || price.type === "free") return "Free";
  if (price.type === "bundle") return "Bundle (not sold)";
  const usd = price.usd == null ? "" : `$${price.usd}`;
  return paidEnabled ? `${usd} placeholder` : `${usd} placeholder, checkout off`;
}

async function renderTab(view) {
  view.innerHTML = `<div class="empty">Loading Marketplace…</div>`;
  let data, pipes;
  try {
    [data, pipes] = await Promise.all([api("/marketplace"), api("/pipelines")]);
  } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const paid = !!data.paidEnabled;
  const cats = [...new Set(data.catalog.map((c) => c.category))];
  const pipeOpts = pipes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  const catOpts = data.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const priceOpts = `<option value="free">Free</option>${data.prices.map((n) => `<option value="once:${n}">$${n} one-time (placeholder)</option>`).join("")}<option value="bundle">Included in a bundle (not sold)</option>`;
  view.innerHTML = `
  <style>
    .mkt-grid { display:grid; grid-template-columns: minmax(0,1fr) 340px; gap:16px; align-items:start; }
    @media (max-width: 860px) { .mkt-grid { grid-template-columns: 1fr; } }
    .mkt-card { cursor:pointer; }
    .mkt-card.on { outline:1px solid var(--accent); }
  </style>
  <div class="row" style="margin-bottom:8px"><h3 style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Marketplace</h3></div>
  <p class="small muted" style="margin-top:0">${esc(data.copy.banner)} ${esc(data.copy.install)}</p>
  <p class="small dim" style="margin-top:0">${esc(data.copy.revenue)} ${esc(data.copy.payout)} ${esc(paid ? data.copy.paidOn : data.copy.paidOff)}</p>
  <div class="mkt-grid">
    <div>
      ${data.catalog.length ? cats.map((c) => `<div class="cat-h">${esc(c)}</div><div class="pcards">${data.catalog.filter((p) => p.category === c).map((p) => `
        <div class="pcard mkt-card ${selected === p.id ? "on" : ""}" data-open="${esc(p.id)}">
          <h4>${esc(p.title)}</h4>
          <div class="muted small">${esc(p.promise)}</div>
          <div class="cats" style="margin-top:8px">${p.steps.map((s) => `<span class="chip">${esc(s.title)} · ${esc(s.capability)}</span>`).join("")}</div>
          <div class="row small dim" style="margin-top:8px"><span>${esc(priceLabel(p.price, paid))}</span><span>${esc(p.seller.name)}</span><span style="margin-left:auto">${p.stats.rating.count ? `${p.stats.rating.average} stars` : "No ratings yet"}</span></div>
        </div>`).join("")}</div>`).join("") : `<div class="empty">The catalog is empty.</div>`}
      <div class="panel" style="margin-top:16px"><h3>Installed</h3>
        ${data.installed.length ? data.installed.map((i) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap">
          <span>${esc(i.title)}</span>
          <span class="dim">v${esc(String(i.installedVersion))}${i.version ? ` of ${esc(String(i.version))}` : ""}</span>
          ${i.pulled ? `<span class="dim">Pulled pending review</span>` : ""}
          ${i.updateAvailable ? `<button class="btn sm" data-update="${esc(i.listingId)}">Update</button>` : ""}
        </div>${i.updateAvailable && i.diff ? `<div class="dim small" style="margin:0 0 8px">${diffText(i.diff)}</div>` : ""}`).join("") : `<div class="dim small">Nothing installed yet.</div>`}
      </div>
    </div>
    <div class="grid" style="align-content:start;gap:12px">
      <div class="panel" id="mkt-detail">${detailHtml(data, paid)}</div>
      <div class="panel"><h3>List one of yours</h3>
        <label class="lbl">Pipeline</label><select id="mkt-pipe">${pipeOpts}</select>
        <label class="lbl">Category</label><select id="mkt-cat">${catOpts}</select>
        <label class="lbl">One-line promise</label><input id="mkt-promise" type="text" maxlength="140" placeholder="What the buyer gets">
        <label class="lbl">Example of a result (text only)</label><textarea id="mkt-example" style="min-height:60px" maxlength="500" placeholder="A sentence from a real run"></textarea>
        <label class="lbl">Price</label><select id="mkt-price">${priceOpts}</select>
        <div class="dim small" style="margin:6px 0">${esc(data.copy.paidOff)} ${esc(data.copy.revenue)}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn sm" id="mkt-draft">Save draft</button><button class="btn sm primary" id="mkt-submit">Submit for review</button></div>
      </div>
      <div class="panel"><h3>Waiting for review</h3>
        ${queueHtml(data)}
      </div>
      <div class="panel"><h3>Signed template</h3>
        <div class="dim small">${esc(data.copy.share)}</div>
        <label class="lbl">Export a pipeline</label><select id="mkt-exp">${pipeOpts}</select>
        <button class="btn sm" id="mkt-export" style="margin-top:8px">Export signed file</button>
        ${lastExport ? `<label class="lbl">Share path</label><input id="mkt-share" type="text" readonly value="${esc(lastExport.share.path)}?t=${esc(lastExport.share.token)}"><div class="dim small">Token shown once. Copy it here if you need it.</div><textarea id="mkt-out" readonly style="min-height:70px;font-family:ui-monospace,Consolas,monospace;font-size:11px">${esc(JSON.stringify(lastExport.file))}</textarea>` : ""}
        <label class="lbl">Import a signed file</label><input id="mkt-file" type="file" accept="application/json,.json"><textarea id="mkt-json" style="min-height:70px" placeholder="Paste the signed JSON"></textarea>
        <button class="btn sm" id="mkt-import" style="margin-top:8px">Import</button>
      </div>
    </div>
  </div>`;

  view.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => { selected = el.dataset.open; renderTab(view); }));
  view.querySelectorAll("[data-update]").forEach((b) => b.addEventListener("click", async () => {
    try { const r = await api("/marketplace/update", { method: "POST", body: { listingId: b.dataset.update } }); toast(r.already ? "Already on this version" : "Updated. Nothing ran."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  }));
  const detail = view.querySelector("#mkt-detail");
  detail.querySelector("[data-install]")?.addEventListener("click", async () => {
    const id = detail.querySelector("[data-install]").dataset.install;
    try { const r = await api("/marketplace/install", { method: "POST", body: { listingId: id } }); toast(r.already ? "Already installed. Nothing ran." : "Installed. Nothing ran and nothing was charged."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  detail.querySelector("[data-report]")?.addEventListener("click", async () => {
    const reason = detail.querySelector("#mkt-reason")?.value || "";
    try { await api(`/marketplace/listings/${encodeURIComponent(detail.querySelector("[data-report]").dataset.report)}/report`, { method: "POST", body: { reason } }); toast("Pulled pending review."); selected = null; renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  detail.querySelector("[data-rate]")?.addEventListener("click", async () => {
    const stars = Number(detail.querySelector("#mkt-stars").value);
    try { await api("/marketplace/rate", { method: "POST", body: { listingId: detail.querySelector("[data-rate]").dataset.rate, stars } }); toast("Rating saved."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  const formBody = () => {
    const raw = view.querySelector("#mkt-price").value;
    const priceType = raw.startsWith("once:") ? "once" : raw;
    const priceUsd = raw.startsWith("once:") ? Number(raw.slice(5)) : undefined;
    return { pipelineId: view.querySelector("#mkt-pipe").value, category: view.querySelector("#mkt-cat").value, promise: view.querySelector("#mkt-promise").value, example: view.querySelector("#mkt-example").value, priceType, priceUsd };
  };
  view.querySelector("#mkt-draft").addEventListener("click", async () => {
    try { await api("/marketplace/listings", { method: "POST", body: formBody() }); toast("Draft saved. Nothing was published."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelector("#mkt-submit").addEventListener("click", async () => {
    try { await api("/marketplace/listings", { method: "POST", body: { ...formBody(), submit: true } }); toast("Submitted for review. It is not in the catalog yet."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll("[data-mod]").forEach((b) => b.addEventListener("click", async () => {
    const reason = b.closest("div").querySelector("[data-why]")?.value || "";
    try { await api(`/marketplace/listings/${encodeURIComponent(b.dataset.id)}/moderate`, { method: "POST", body: { action: b.dataset.mod, reason } }); toast(b.dataset.mod === "approve" ? "Approved for this computer's catalog." : "Rejected."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  }));
  view.querySelector("#mkt-export").addEventListener("click", async () => {
    try { lastExport = await api("/marketplace/export", { method: "POST", body: { pipelineId: view.querySelector("#mkt-exp").value } }); toast("Signed file ready. Nothing was sent."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelector("#mkt-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    view.querySelector("#mkt-json").value = await file.text();
  });
  view.querySelector("#mkt-import").addEventListener("click", async () => {
    const raw = view.querySelector("#mkt-json").value.trim();
    if (!raw) return toast("Paste a signed file first.", true);
    let file; try { file = JSON.parse(raw); } catch { return toast("That file is not JSON.", true); }
    try { const r = await api("/marketplace/import", { method: "POST", body: { file } }); toast(r.already ? "Already imported." : "Imported. Nothing ran."); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
}

function diffText(diff) {
  const bits = [];
  for (const s of diff.added || []) bits.push(`Added step ${s.n}: ${s.title}`);
  for (const s of diff.removed || []) bits.push(`Removed step ${s.n}: ${s.title}`);
  for (const s of diff.changed || []) bits.push(`Step ${s.n}: ${s.from} to ${s.to}`);
  return esc(bits.join(". ") || "Steps changed.");
}

function detailHtml(data, paid) {
  const row = data.catalog.find((c) => c.id === selected) || data.mine.find((c) => c.id === selected);
  if (!row) return `<h3>Listing</h3><div class="empty">Pick a listing.</div>`;
  const inCatalog = data.catalog.some((c) => c.id === row.id);
  const installed = data.installed.find((i) => i.listingId === row.id);
  return `<h3>${esc(row.title)}</h3>
    <div class="muted small">${esc(row.promise)}</div>
    ${row.example ? `<div class="small" style="margin-top:8px">${esc(row.example)}</div>` : ""}
    <div class="cats" style="margin-top:8px">${(row.steps || []).map((s) => `<span class="chip">${esc(s.title)} · ${esc(s.capability)}</span>`).join("")}</div>
    <div class="small" style="margin-top:8px">${esc(priceLabel(row.price, paid))}. ${esc(data.copy.revenue)}</div>
    <div class="dim small">${esc(row.payout?.note || data.copy.payout)} ${esc(row.stats?.avgCostNote || "No receipt average yet")}.</div>
    <div class="dim small">Version ${esc(String(row.version))}${row.demo ? " · Demo catalog" : ""}${row.status && row.status !== "listed" ? ` · ${esc(row.status)}` : ""}</div>
    ${row.rejection ? `<div class="small">${esc(row.rejection)}</div>` : ""}
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
      ${inCatalog ? `<button class="btn sm primary" data-install="${esc(row.id)}">${row.price?.type === "free" ? "Install" : (paid ? "Install (placeholder checkout)" : "Install (checkout off)")}</button>` : ""}
      ${installed ? `<label class="row small" style="gap:6px">Stars <select id="mkt-stars">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select><button class="btn sm" data-rate="${esc(row.id)}">Rate</button></label>` : ""}
    </div>
    ${inCatalog ? `<label class="lbl">Report</label><input id="mkt-reason" type="text" maxlength="300" placeholder="Why it should come down"><button class="btn sm" data-report="${esc(row.id)}" style="margin-top:6px">Report and pull</button>` : ""}`;
}

function queueHtml(data) {
  const rows = data.queue.listings || [];
  const reports = data.queue.reports || [];
  if (!rows.length && !reports.length) return `<div class="dim small">Nothing is waiting for review.</div>`;
  const line = (r) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
    <div class="small"><b>${esc(r.title)}</b> <span class="dim">${esc(r.status)}${r.demo ? " · demo" : ""}</span></div>
    ${r.reason ? `<div class="dim small">${esc(r.reason)}</div>` : ""}
    <div class="row" style="gap:6px;margin-top:4px"><input data-why type="text" placeholder="${r.status === "pending" ? "Reason if you reject" : "Reason if it stays hidden"}" style="flex:1"><button class="btn sm" data-mod="approve" data-id="${esc(r.id)}">Approve</button><button class="btn sm" data-mod="reject" data-id="${esc(r.id)}">Reject</button></div>
  </div>`;
  return rows.map(line).join("") + (reports.length ? `<div class="dim small" style="margin-top:6px">Open reports</div>` + reports.map((r) => `<div class="small">${esc(r.title)}: ${esc(r.reason)}</div>`).join("") : "");
}

CC.register({
  id: "marketplace",
  tab: { label: "Marketplace", short: "Market", icon: "◈", order: 16, render: renderTab },
});
