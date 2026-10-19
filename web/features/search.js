// Live web search with cited sources (Phase 15).
// Command: "Search the web" toggles for Single, Council and Mission (off by default) and the engine in use.
// Deliverable: numbered source chips ([1], [2], ...) that open the page, and [n] marks in the text become links.
// Settings > Web search: engine choice, keys (one test search, then the vault), monthly caps, price per search.
const { S, api, toast, esc, money } = window.CC;

const css = `
.cc-src { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cc-src a.chip { text-decoration: none; max-width: 100%; }
.cc-src a.chip .n { color: var(--accent, #22d3ee); font-weight: 600; }
.cc-src a.chip .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
.md a.cc-cite { text-decoration: none; font-size: .78em; vertical-align: super; padding: 0 3px; border-radius: 4px; background: #16202f; border: 1px solid #243044; color: var(--accent, #22d3ee); margin-left: 1px; }
.md a.cc-cite:hover { background: #1f2d40; }
#cc-search-cmd label { cursor: pointer; }
`;
const style = document.createElement("style"); style.id = "cc-search-style"; style.textContent = css; document.head.appendChild(style);

let data = null; // last /api/search view
async function load() { data = await api("/search"); return data; }
const engineLabel = (d) => (d?.active?.engine ? `${d.active.name}${d.active.demo ? " (demo)" : ""}` : "no search provider yet");

// ---------- Command: the toggles ----------
async function renderCommand(el) {
  try { await load(); } catch { el.innerHTML = ""; return; }
  const d = data;
  const anyOn = Object.values(d.on).some(Boolean);
  el.innerHTML = `<div class="route" id="cc-search-cmd" style="margin-top:8px">
    <div class="row small" style="gap:12px;flex-wrap:wrap"><span class="muted">Search the web:</span>
      ${d.modes.map((m) => `<label class="row small" style="gap:5px"><input type="checkbox" data-mode="${m}" ${d.on[m] ? "checked" : ""}> ${m === "single" ? "Single" : m === "council" ? "Council" : "Mission"}</label>`).join("")}
      <span class="chip ${d.active.engine ? (d.active.demo ? "" : "green") : anyOn ? "amber" : ""}" style="margin-left:auto" title="${esc(d.active.reason || "Results are numbered and cited as [1], [2] in the answer.")}">${esc(engineLabel(d))}</span></div>
    ${anyOn && !d.active.engine ? `<div class="small" style="color:var(--amber);margin-top:4px">${esc(d.active.reason)}</div>` : ""}
  </div>`;
  el.querySelectorAll("[data-mode]").forEach((cb) => cb.addEventListener("change", async () => {
    try { data = await api("/search/toggle", { method: "POST", body: { mode: cb.dataset.mode, on: cb.checked } }); renderCommand(el); }
    catch (e) { toast(e.message, true); cb.checked = !cb.checked; }
  }));
}

// ---------- Deliverable: sources and clickable citations ----------
function sourcesOfLive() {
  const l = S.live; if (!l?.id) return [];
  if (l.kind === "council") return l.council?.sources || [];
  return l.mission?.sources || [];
}
// Turn "[3]" in rendered text into a link to source 3. Text nodes only; links, code and pre are left alone.
function linkify(root, sources) {
  if (!root || !sources.length) return;
  const byN = new Map(sources.map((s) => [String(s.n), s]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : /\[\d{1,2}\]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    let last = 0; const text = node.nodeValue; const re = /\[(\d{1,2})\]/g; let m;
    while ((m = re.exec(text))) {
      const s = byN.get(m[1]); if (!s) continue;
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement("a"); a.className = "cc-cite"; a.href = s.url; a.target = "_blank"; a.rel = "noopener"; a.title = `${s.title}${s.host ? ` (${s.host})` : ""}`; a.textContent = m[1];
      frag.appendChild(a); last = m.index + m[0].length;
    }
    if (!last) continue;
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}
function renderDeliverable(el) {
  const sources = sourcesOfLive();
  if (!sources.length) { el.innerHTML = ""; return; }
  const l = S.live;
  const name = l.kind === "council" ? l.council?.searchEngine : l.mission?.searchEngine;
  el.innerHTML = `<div class="cc-src"><span class="small muted" style="width:100%">Sources${name ? ` · ${esc(name)}` : ""} · click a number to open the page</span>
    ${sources.map((s) => `<a class="chip" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.snippet || s.url)}"><span class="n">[${s.n}]</span><span class="t">${esc(s.title || s.host || s.url)}</span><span class="dim">${esc(s.host || "")}</span></a>`).join("")}</div>`;
  linkify(document.getElementById("out-md"), sources);
  document.querySelectorAll("#council .ans .body").forEach((b) => linkify(b, sources));
}

// ---------- Settings ----------
async function renderSettings(el) {
  try { await load(); } catch (e) { el.innerHTML = `<div class="panel"><h3>Web search</h3><div class="dim small">${esc(e.message)}</div></div>`; return; }
  const d = data;
  const opt = (v, label) => `<option value="${v}" ${d.engine === v ? "selected" : ""}>${label}</option>`;
  el.innerHTML = `<div class="panel"><h3>Web search <span class="right">${d.searchesMonth} search${d.searchesMonth === 1 ? "" : "es"} this month · ${money(d.searchMonth, 3)}</span></h3>
    <div class="small muted" style="margin-bottom:8px">Live results with numbered sources, injected into the prompt when "Search the web" is on in Command (off by default). Each search is a line in the ledger with its cost and counts against the caps below.</div>
    <div class="row" style="gap:10px;flex-wrap:wrap"><label class="row small" style="gap:6px">Engine <select id="ws-engine" style="width:auto">${opt("auto", "Auto (first engine with a key, else the model's own, else demo)")}${Object.values(ENGINES_UI(d)).map((e) => opt(e.id, e.name)).join("")}${opt("model", "The model's own search (Perplexity, Grok)")}</select></label>
      <label class="row small" style="gap:6px">Results per search <input type="number" id="ws-max" min="1" max="10" value="${d.maxResults}" style="width:64px;padding:4px 6px"></label>
      <span class="chip ${d.active.engine ? "green" : "amber"}" title="${esc(d.active.reason || "")}">now: ${esc(engineLabel(d))}</span></div>
    <div class="cat-h" style="margin-top:14px">Engines (your own key)</div>
    ${d.engines.map((e) => `<div class="row small" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap" data-eng="${e.id}">
      <span class="dot ${e.keyed ? (e.capStopped ? "red" : "green") : "grey"}"></span><b style="width:110px">${esc(e.name)}</b>
      ${e.keyed ? `<span class="mono dim">${esc(e.masked || "")}</span>${e.fromEnv ? `<span class="chip">from env</span>` : ""}<button class="ghost small" data-rm="${e.id}">remove</button>` : `<input type="password" data-key="${e.id}" placeholder="paste the key (${esc(e.looks)})" style="width:220px" autocomplete="off"><button class="btn sm" data-save="${e.id}">Test and save</button>`}
      <a class="small" href="${esc(e.keysUrl)}" target="_blank" rel="noopener">get a key</a>
      <span style="margin-left:auto" class="dim small">$<input type="number" data-price="${e.id}" value="${e.perSearch}" step="0.001" min="0" style="width:70px;padding:3px 5px" title="${esc(e.note)} List price ${e.listPrice}; edit if yours differs."> per search · cap $<input type="number" data-cap="${e.id}" value="${e.cap ?? ""}" placeholder="none" min="0" step="1" style="width:64px;padding:3px 5px" title="Monthly cap: amber at 80%, searches stop at 100%."> / month${e.cap ? ` · ${money(e.spendMonth, 3)} used` : ""}</span>
      <div class="dim small" style="width:100%;margin-left:22px" data-result="${e.id}"></div>
    </div>`).join("")}
    <div class="cat-h" style="margin-top:14px">Built into the model</div>
    ${d.native.map((n) => `<div class="row small" style="gap:8px;padding:4px 0"><span class="dot ${n.keyed ? "green" : "grey"}"></span><b style="width:110px">${esc(n.providerName)}</b><span class="muted">${esc(n.name)}: ${esc(n.note)}</span><span style="margin-left:auto" class="dim small">$<input type="number" data-price="${n.provider}" value="${n.perSearch}" step="0.001" min="0" style="width:70px;padding:3px 5px"> per ${esc(n.unit)}</span></div>`).join("")}
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn sm primary" id="ws-save">Save settings</button>
      <input type="text" id="ws-q" placeholder="try a search (costs one search)" style="width:240px;margin-left:auto"><button class="btn sm" id="ws-try">Search now</button></div>
    <div id="ws-try-out" class="small" style="margin-top:8px"></div>
    <div class="dim small" style="margin-top:8px">Keys are sealed in the vault after one test search and never shown again (only the first and last four characters). Prices are list prices on 2026-10-18; edit them to match your plan. ${d.demo ? "Demo mode uses a pretend engine with no network and no cost when no key is saved." : ""}</div>
  </div>`;
  el.querySelector("#ws-save").addEventListener("click", async () => {
    const prices = {}, caps = {};
    el.querySelectorAll("[data-price]").forEach((i) => { prices[i.dataset.price] = i.value === "" ? null : Number(i.value); });
    el.querySelectorAll("[data-cap]").forEach((i) => { if (i.value !== "") caps[i.dataset.cap] = Number(i.value); });
    try { data = await api("/search/settings", { method: "POST", body: { engine: el.querySelector("#ws-engine").value, maxResults: Number(el.querySelector("#ws-max").value) || 5, prices, caps } }); toast("Web search settings saved"); renderSettings(el); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const eng = b.dataset.save; const inp = el.querySelector(`[data-key="${eng}"]`); const key = inp?.value.trim();
    if (!key) return toast("Paste the key first", true);
    b.disabled = true; b.textContent = "Testing…";
    const out = el.querySelector(`[data-result="${eng}"]`);
    try {
      const r = await api("/search/key", { method: "POST", body: { engine: eng, key } });
      if (r.kept) { toast(`${eng}: key works`); data = r.view; renderSettings(el); }
      else { out.innerHTML = `<span style="color:var(--${r.tone === "red" ? "red" : "amber"})">${esc(r.label)}.</span> ${esc(r.detail || "")} Nothing was saved.`; b.disabled = false; b.textContent = "Test and save"; }
    } catch (e) { out.textContent = e.message; b.disabled = false; b.textContent = "Test and save"; }
  }));
  el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => { try { data = await api(`/search/key/${b.dataset.rm}`, { method: "DELETE" }); renderSettings(el); } catch (e) { toast(e.message, true); } }));
  el.querySelector("#ws-try").addEventListener("click", async () => {
    const q = el.querySelector("#ws-q").value.trim(); if (!q) return;
    const out = el.querySelector("#ws-try-out"); out.textContent = "Searching…";
    try {
      const r = await api("/search/test", { method: "POST", body: { q } });
      out.innerHTML = `<div class="muted">${esc(r.name)}${r.demo ? " (demo)" : ""}: ${r.sources.length} results in ${(r.ms / 1000).toFixed(1)}s, ${money(r.cost, 4)}</div><div class="cc-src">${r.sources.map((s) => `<a class="chip" href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.snippet || "")}"><span class="n">[${s.n}]</span><span class="t">${esc(s.title)}</span><span class="dim">${esc(s.host)}</span></a>`).join("")}</div>`;
    } catch (e) { out.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
  });
}
const ENGINES_UI = (d) => d.engines;

CC.register({
  id: "search",
  command: { order: 15, render: renderCommand },
  deliverable: { order: 5, render: renderDeliverable },
  settings: { order: 8, render: renderSettings },
});
