// Live model pricing (Phase 24). Settings > Model prices: the live list prices from OpenRouter (checked once
// a day), the built-in ones and your own, which always win. The router, ledger estimates and savings
// receipts use the price in the "in use" column.
const { api, toast, esc, ago } = window.CC;

const css = `
#cc-price table { width: 100%; border-collapse: collapse; margin-top: 8px; }
#cc-price td, #cc-price th { padding: 4px; border-bottom: 1px solid var(--line); text-align: left; font-weight: normal; }
#cc-price th { color: var(--muted); font-size: 11px; }
#cc-price td.num { font-family: var(--mono); white-space: nowrap; }
#cc-price .src-live { color: var(--green); }
#cc-price .src-override { color: var(--amber); }
`;
const style = document.createElement("style"); style.id = "cc-pricing-style"; style.textContent = css; document.head.appendChild(style);

const pair = (p) => (p ? `$${p.in} / $${p.out}` : "");
const SRC = { live: "live", override: "your price", "built-in": "built-in" };

async function renderSettings(el) {
  let d;
  try { d = await api("/pricing/live"); } catch (e) { el.innerHTML = `<div class="panel"><h3>Model prices</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const hosted = window.CC.S.mode === "hosted";
  const rows = d.rows.filter((r) => r.matchable || r.override);
  el.innerHTML = `<div class="panel" id="cc-price"><h3>Model prices <span class="right">${d.matched} live · ${rows.filter((r) => r.override).length} yours</span></h3>
    <div class="small muted">List prices per 1M tokens (in / out) from the ${esc(d.source)}, checked once a day. They feed the router, the cost estimates in the ledger and the savings receipts. A price you set yourself always wins; Groq, custom providers and the variable OpenRouter routes keep their own prices. Only the public price list is fetched; nothing about you or your keys is sent.</div>
    <div class="row small" style="gap:12px;margin-top:8px;flex-wrap:wrap">
      ${hosted ? "" : `<label class="row" style="gap:6px"><input type="checkbox" id="lp-on" ${d.on ? "checked" : ""}> Use live prices</label>`}
      <span class="dim">${d.fetchedAt ? `Updated ${esc(ago(d.fetchedAt))}` : "Not fetched yet"}${d.listed ? ` · ${d.listed} models listed by OpenRouter` : ""}</span>
      ${d.error ? `<span class="chip amber" title="The last good prices stay in use">${esc(d.error)}</span>` : ""}
      <button class="btn sm" id="lp-refresh" style="margin-left:auto">Refresh now</button>
    </div>
    <table><tr><th>Model</th><th>Built-in</th><th>Live</th><th>Yours</th><th>In use</th><th></th></tr>
    ${rows.map((r) => `<tr>
      <td class="small"><b>${esc(r.name)}</b> <span class="dim">${esc(r.providerName)}</span></td>
      <td class="num small dim">${pair(r.builtIn)}</td>
      <td class="num small" title="${esc(r.live?.orId || "")}">${r.live ? pair(r.live) : `<span class="dim">${d.on ? "not listed" : "off"}</span>`}</td>
      <td class="num small">${pair(r.override)}</td>
      <td class="num small src-${r.source === "override" ? "override" : r.source === "live" ? "live" : "builtin"}">${pair(r.used)} <span class="dim">${SRC[r.source]}</span></td>
      <td>${r.override ? `<button class="ghost small" data-unset="${esc(r.model)}">use ${r.live ? "live" : "built-in"}</button>` : ""}</td>
    </tr>`).join("")}</table>
    <div class="dim small" style="margin-top:6px">Set your own price for a model under the AI's card above (the price boxes next to each model).</div>
  </div>`;
  el.querySelector("#lp-on")?.addEventListener("change", async (e) => { try { await api("/pricing/live/settings", { method: "POST", body: { on: e.target.checked } }); toast(e.target.checked ? "Live prices on" : "Live prices off: built-in prices apply"); renderSettings(el); } catch (err) { toast(err.message, true); } });
  el.querySelector("#lp-refresh").addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Checking…";
    try { const v = await api("/pricing/live/refresh", { method: "POST" }); toast(`Prices updated: ${v.matched} models`); }
    catch (err) { toast(err.message, true); }
    renderSettings(el);
  });
  el.querySelectorAll("[data-unset]").forEach((b) => b.addEventListener("click", async () => { try { await api(`/pricing/override/${encodeURIComponent(b.dataset.unset)}`, { method: "DELETE" }); toast("Your price removed"); renderSettings(el); } catch (err) { toast(err.message, true); } }));
}

window.CC.register({ id: "pricing", settings: { order: 34, render: renderSettings } });
