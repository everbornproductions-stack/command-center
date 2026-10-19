// Side-by-side comparison (Phase 17). One prompt, 2 to 6 models, columns with cost and speed.
// Pick winner writes a rating the router reads. Presets save a set of models for next time.
const { api, toast, esc, md, money, ago, pcolor, go } = window.CC;

const css = `
.cc-cmp-models { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 4px; }
.cc-cmp-models .grp { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.cc-cmp-models label { cursor: pointer; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
.cc-cmp .ans { display: flex; flex-direction: column; overflow: hidden; }
.cc-cmp .ans .hd { flex-wrap: wrap; }
.cc-cmp .ans .body { overflow: auto; flex: 1; min-height: 120px; max-height: 360px; }
.cc-cmp .ans.skipped { opacity: .85; }
.cc-cmp-note { color: var(--amber); }
`;
const style = document.createElement("style");
style.id = "cc-compare-style";
style.textContent = css;
document.head.appendChild(style);

let root = null;
let current = null;
let catalog = null;

const keyOf = (provider, model) => `${provider}\0${model}`;

function checkedModels(el) {
  return [...el.querySelectorAll(".cc-cmp-models input:checked")].map((i) => ({ provider: i.dataset.provider, model: i.dataset.model }));
}

function estimateOf(el) {
  const picked = checkedModels(el);
  if (!catalog || picked.length < 2) return picked.length ? "Pick at least 2 models." : "Pick 2 to 6 models.";
  let sum = 0;
  for (const m of picked) {
    const spec = catalog.models.find((x) => x.provider === m.provider && x.model === m.model);
    if (spec) sum += (600 / 1e6) * spec.in + (800 / 1e6) * spec.out;
  }
  const capped = picked.filter((m) => catalog.models.find((x) => x.provider === m.provider && x.model === m.model)?.capped);
  const capNote = capped.length ? ` ${capped.length} at the spend cap (those columns will be skipped, not called).` : "";
  return `About ${money(sum, 4)} for a typical answer from the ${picked.length} selected model${picked.length === 1 ? "" : "s"}.${capNote} Nothing is called until you click Compare.`;
}

function refreshEstimate(el) {
  const n = el.querySelector("#cc-cmp-count");
  const est = el.querySelector("#cc-cmp-est");
  const picked = checkedModels(el);
  if (n) n.textContent = `${picked.length} selected`;
  if (est) est.textContent = estimateOf(el);
}

function paintBoard(board, run) {
  if (!board) return;
  if (!run) { board.innerHTML = ""; board.dataset.id = ""; return; }
  board.dataset.id = run.id;
  const status = run.status === "running"
    ? "Running. Answers stream in as each model writes."
    : run.status === "failed"
      ? (run.error || "The comparison failed.")
      : `Done in ${(((run.finishedAt || Date.now()) - run.startedAt) / 1000).toFixed(1)}s · ${money(run.cost, 4)}${run.classification?.capability ? ` · ${run.classification.capability}` : ""}`;
  board.innerHTML = `<div class="row" style="margin:14px 0 8px"><h3 style="margin:0;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)">Columns</h3><span class="dim small cc-cmp-status" style="margin-left:8px">${esc(status)}</span></div>
    <div class="council-cols">${run.columns.map((c) => `<div class="ans ${run.winner === c.model ? "winner" : ""} ${c.status === "skipped" ? "skipped" : ""}" style="--c:${pcolor(c.provider)}" data-col="${esc(c.id)}">
      <div class="hd"><span class="dot" style="background:${pcolor(c.provider)}"></span>${esc(c.providerName || c.provider)} <span class="dim small">${esc(c.modelName || c.model)}</span><span class="score" data-meta></span><span data-actions></span></div>
      <div class="body md" data-body></div>
    </div>`).join("")}</div>`;
  for (const c of run.columns) patchColumn(board, run, c, true);
  board.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.pick)));
}

function patchColumn(board, run, col, force) {
  const el = board.querySelector(`[data-col="${CSS.escape(col.id)}"]`);
  if (!el) return;
  el.classList.toggle("winner", run.winner === col.model);
  el.classList.toggle("skipped", col.status === "skipped");
  const meta = el.querySelector("[data-meta]");
  if (meta) {
    const bits = [];
    if (col.ms != null) bits.push(`${(col.ms / 1000).toFixed(1)}s`);
    if (col.cost != null) bits.push(money(col.cost, 4));
    if (col.status === "running") bits.push("answering");
    if (col.status === "queued") bits.push("waiting");
    meta.textContent = bits.join(" · ");
  }
  const actions = el.querySelector("[data-actions]");
  if (actions) {
    if (run.winner === col.model) actions.innerHTML = `<span class="chip green">Winner</span>`;
    else if (run.status !== "running" && col.status === "done" && col.text) actions.innerHTML = `<button class="btn sm" data-pick="${esc(col.model)}">Pick winner</button>`;
    else actions.innerHTML = "";
  }
  const body = el.querySelector("[data-body]");
  if (!body) return;
  body.classList.toggle("cursor", col.status === "running");
  const len = String((col.text || "").length) + ":" + col.status;
  if (!force && body.dataset.len === len) return;
  body.dataset.len = len;
  if (col.text) body.innerHTML = md(col.text);
  else body.innerHTML = `<div class="${col.status === "skipped" || col.status === "error" ? "cc-cmp-note" : "dim"}">${esc(col.note || (col.status === "running" ? "Answering..." : "Waiting..."))}</div>`;
  body.scrollTop = body.scrollHeight;
}

function patchBoard(board, run) {
  if (!board || board.dataset.id !== run.id) return paintBoard(board, run);
  const status = board.querySelector(".cc-cmp-status");
  if (status) {
    status.textContent = run.status === "running"
      ? "Running. Answers stream in as each model writes."
      : `Done in ${(((run.finishedAt || Date.now()) - run.startedAt) / 1000).toFixed(1)}s · ${money(run.cost, 4)}${run.winner ? " · winner picked" : ""}`;
  }
  let missing = false;
  for (const c of run.columns) if (!board.querySelector(`[data-col="${CSS.escape(c.id)}"]`)) missing = true;
  if (missing) return paintBoard(board, run);
  for (const c of run.columns) patchColumn(board, run, c, false);
  board.querySelectorAll("[data-pick]").forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", () => pick(b.dataset.pick));
  });
}

function boardEl() { return root?.isConnected ? root.querySelector("#cc-cmp-board") : null; }

function show(run) {
  current = run;
  const board = boardEl();
  if (!board) return;
  if (board.dataset.id === run.id) patchBoard(board, run);
  else paintBoard(board, run);
}

async function pick(model) {
  if (!current?.id) return;
  try {
    current = await api(`/compare/${current.id}/winner`, { method: "POST", body: { model } });
    show(current);
    toast("Winner saved. The router will favour it for this kind of work.");
    refreshRecent();
  } catch (e) { toast(e.message, true); }
}

async function refreshRecent() {
  const box = root?.isConnected ? root.querySelector("#cc-cmp-recent") : null;
  if (!box) return;
  let runs = [];
  try { runs = (await api("/compare")).runs || []; } catch { return; }
  box.innerHTML = runs.slice(0, 8).map((r) => `<button class="ghost small" data-open="${esc(r.id)}" style="display:flex;width:100%;justify-content:space-between;padding:4px 0"><span>${esc(r.prompt || "Comparison")}${r.winner ? " · winner" : ""}</span><span class="dim">${ago(r.startedAt)} · ${money(r.cost, 4)}</span></button>`).join("") || `<div class="dim small">None yet.</div>`;
  box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", async () => {
    try { show(await api(`/compare/${b.dataset.open}`)); } catch (e) { toast(e.message, true); }
  }));
}

function renderModels(models) {
  const groups = new Map();
  for (const m of models) {
    if (!groups.has(m.provider)) groups.set(m.provider, { name: m.providerName, color: m.color, models: [] });
    groups.get(m.provider).models.push(m);
  }
  if (!groups.size) return `<div class="dim small">Turn on demo mode, or add keys for at least two models, to compare them.</div>`;
  return [...groups.values()].map((g) => `<div class="grp"><span class="dot" style="background:${g.color}"></span><b>${esc(g.name)}</b>${g.models.map((m) => `<label><input type="checkbox" data-provider="${esc(m.provider)}" data-model="${esc(m.model)}" ${m.capped ? "data-capped=\"1\"" : ""}> ${esc(m.name)}${m.capped ? ` <span class="chip amber">at cap</span>` : ""}</label>`).join("")}</div>`).join("");
}

function applyPreset(el, preset) {
  const want = new Set((preset?.models || []).map((m) => keyOf(m.provider, m.model)));
  el.querySelectorAll(".cc-cmp-models input").forEach((i) => { i.checked = want.has(keyOf(i.dataset.provider, i.dataset.model)); });
  refreshEstimate(el);
}

async function renderTab(view) {
  root = view;
  const keepPrompt = view.querySelector("#cc-cmp-prompt")?.value || "";
  const keepChecks = new Set([...view.querySelectorAll(".cc-cmp-models input:checked")].map((i) => keyOf(i.dataset.provider, i.dataset.model)));
  view.innerHTML = `<div class="empty">Loading comparison...</div>`;
  try { catalog = await api("/compare"); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  view.innerHTML = `<div class="cc-cmp">
    <div class="panel">
      <h3>Side by side <span class="right" id="cc-cmp-count">0 selected</span></h3>
      <div class="small muted" style="margin-bottom:8px">One prompt goes to 2 to 6 models at once. Each column shows the answer, what it cost, and how long it took. Pick a winner to teach the router, the same way a thumbs up does. A model at its monthly spend cap is skipped and not called.</div>
      <div class="cc-cmp-models">${renderModels(catalog.models)}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        <select id="cc-cmp-preset" style="width:auto;min-width:160px"><option value="">Presets</option>${catalog.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
        <button class="btn sm" id="cc-cmp-use">Use preset</button>
        <button class="ghost small" id="cc-cmp-del">Delete preset</button>
        <input type="text" id="cc-cmp-pname" placeholder="Preset name" style="width:160px;margin-left:auto">
        <button class="btn sm" id="cc-cmp-save">Save preset</button>
      </div>
      <label class="lbl">Prompt</label>
      <textarea id="cc-cmp-prompt" placeholder="One prompt for every model" style="min-height:90px"></textarea>
      <div class="row" style="margin-top:10px;gap:10px;align-items:center">
        <button class="btn primary" id="cc-cmp-go">Compare</button>
        <span class="dim small" id="cc-cmp-est"></span>
      </div>
    </div>
    <div id="cc-cmp-board"></div>
    <div class="panel" style="margin-top:14px"><h3>Recent comparisons</h3><div id="cc-cmp-recent"></div></div>
  </div>`;
  if (keepPrompt) view.querySelector("#cc-cmp-prompt").value = keepPrompt;
  if (keepChecks.size) view.querySelectorAll(".cc-cmp-models input").forEach((i) => { i.checked = keepChecks.has(keyOf(i.dataset.provider, i.dataset.model)); });
  refreshEstimate(view);
  view.querySelector(".cc-cmp-models").addEventListener("change", (e) => {
    const boxes = [...view.querySelectorAll(".cc-cmp-models input:checked")];
    if (boxes.length > 6 && e.target?.checked) { e.target.checked = false; toast("Pick at most 6 models.", true); }
    refreshEstimate(view);
  });
  view.querySelector("#cc-cmp-use").addEventListener("click", () => {
    const id = view.querySelector("#cc-cmp-preset").value;
    const preset = catalog.presets.find((p) => p.id === id);
    if (!preset) return toast("Choose a preset first.", true);
    applyPreset(view, preset);
  });
  view.querySelector("#cc-cmp-del").addEventListener("click", async () => {
    const id = view.querySelector("#cc-cmp-preset").value;
    if (!id) return toast("Choose a preset first.", true);
    try { const r = await api(`/compare/presets/${id}`, { method: "DELETE" }); catalog.presets = r.presets; toast("Preset deleted"); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelector("#cc-cmp-save").addEventListener("click", async () => {
    const name = view.querySelector("#cc-cmp-pname").value.trim();
    const models = checkedModels(view);
    if (!name) return toast("Name the preset first.", true);
    if (models.length < 2 || models.length > 6) return toast("Pick 2 to 6 models.", true);
    try { const r = await api("/compare/presets", { method: "POST", body: { name, models } }); catalog.presets = r.presets; toast("Preset saved"); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelector("#cc-cmp-go").addEventListener("click", async () => {
    const prompt = view.querySelector("#cc-cmp-prompt").value.trim();
    const models = checkedModels(view);
    if (!prompt) return toast("Write a prompt first.", true);
    if (models.length < 2 || models.length > 6) return toast("Pick 2 to 6 models.", true);
    const btn = view.querySelector("#cc-cmp-go");
    btn.disabled = true;
    try {
      const r = await api("/compare", { method: "POST", body: { prompt, models } });
      show(r.compare);
      toast("Comparing. Columns fill in as each model answers.");
      refreshRecent();
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; }
  });
  await refreshRecent();
  if (current?.id) {
    try { show(await api(`/compare/${current.id}`)); } catch { /* the board stays empty */ }
  } else if (catalog.runs[0]) {
    try { show(await api(`/compare/${catalog.runs[0].id}`)); } catch { /* no prior run */ }
  }
}

function onEvent(ev) {
  if (ev.type !== "compare.update" || !ev.compare) return;
  if (current && ev.compare.id !== current.id) return;
  show(ev.compare);
  if (ev.compare.status !== "running") refreshRecent();
}

CC.register({
  id: "compare",
  tab: { label: "Compare", short: "Compare", icon: "▦", order: 18, render: renderTab },
  command: { order: 12, render(el) {
    el.innerHTML = `<div class="row small" style="margin-top:8px"><span class="dim">Compare 2 to 6 models on one prompt:</span><button class="btn sm" id="cc-cmp-open">Side by side</button></div>`;
    el.querySelector("#cc-cmp-open").addEventListener("click", () => go("compare"));
  } },
  onEvent,
});
