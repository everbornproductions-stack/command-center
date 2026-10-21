// Side-by-side comparison (Phase 17): one prompt to 2 to 6 models, answers streaming into parallel columns
// with cost and latency per column, "Pick winner" (a rating the router learns from) and saved model sets.
const { api, toast, md, esc, money, ago } = window.CC;

const MAX = 6, MIN = 2;
const st = { models: [], presets: [], cols: [], prompt: "", maxTokens: 1200, run: null, history: [], loaded: false };
const key = (c) => `${c.provider}|${c.model}`;
const secs = (ms) => (ms == null ? "n/a" : ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const STATUS = { queued: ["waiting", ""], streaming: ["answering", "amber"], done: ["done", "green"], error: ["failed", "red"], skipped: ["skipped", ""] };

async function load() {
  try {
    const [m, p, h] = await Promise.all([api(`/compare/models?chars=${st.prompt.length || 400}&maxTokens=${st.maxTokens}`), api("/compare/presets"), api("/compare")]);
    st.models = m.models; st.presets = p.items; st.history = h.items;
  } catch (e) { toast(e.message, true); }
  // start with the first usable model of up to three different AIs
  if (!st.cols.length) {
    const seen = new Set();
    for (const m of st.models) { if (!m.keyed || m.capped || seen.has(m.provider)) continue; seen.add(m.provider); st.cols.push({ provider: m.provider, model: m.model }); if (st.cols.length >= 3) break; }
    while (st.cols.length < MIN) st.cols.push({ provider: "", model: "" });
  }
  st.loaded = true;
}

function options(sel) {
  const by = {};
  for (const m of st.models) (by[m.providerName] ||= []).push(m);
  return `<option value="">Pick a model</option>` + Object.entries(by).map(([pn, list]) => `<optgroup label="${esc(pn)}">${list.map((m) => `<option value="${esc(key(m))}" ${key(m) === sel ? "selected" : ""} ${m.keyed ? "" : "disabled"}>${esc(m.name)}${m.keyed ? "" : " (no key)"}${m.capped ? " (spend cap reached)" : ""} · about ${money(m.estCost, 4)}</option>`).join("")}</optgroup>`).join("");
}

function estimate() {
  const picked = st.cols.map((c) => st.models.find((m) => key(m) === key(c))).filter(Boolean);
  const live = picked.filter((m) => m.keyed && !m.capped);
  const total = live.reduce((a, m) => a + m.estCost, 0);
  const skip = picked.length - live.length;
  return `Estimated ${money(total, 4)} for ${live.length} model${live.length === 1 ? "" : "s"}${skip ? `, ${skip} will be skipped (no key or spend cap reached)` : ""}. Charged to your own keys; every call goes in the ledger.`;
}

function columnHtml(c, run) {
  const [label, tone] = STATUS[c.status] || [c.status, ""];
  const won = run.winner && run.winner.i === c.i;
  const canPick = run.status === "done" && !run.winner && c.status === "done";
  return `<div class="panel cmp-col" data-col="${c.i}" style="min-width:240px;display:flex;flex-direction:column;${won ? "outline:2px solid var(--green, #22c55e)" : ""}">
    <h3 style="gap:6px"><span class="dot" style="background:${c.color || "var(--muted)"}"></span>${esc(c.name)} <span class="dim small">${esc(c.providerName)}</span>
      <span class="right">${won ? `<span class="chip green">winner</span>` : `<span class="chip ${tone}">${label}</span>`}</span></h3>
    ${c.note ? `<div class="small ${c.status === "error" ? "" : "dim"}" style="margin-bottom:6px">${esc(c.note)}</div>` : ""}
    <div class="body md" style="flex:1;max-height:460px;overflow:auto">${c.text ? md(c.text) : c.status === "skipped" ? "" : `<span class="dim small">${c.status === "queued" ? "Waiting to start" : "Waiting for the first words"}</span>`}</div>
    <div class="small dim" style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">
      ${c.status === "done" ? `<b class="mono">${money(c.cost, 5)}</b>${c.exact ? " ✓" : ""} · first words ${secs(c.ttftMs)} · total ${secs(c.ms)} · ${c.inTok} in / ${c.outTok} out tokens` : c.status === "error" ? `failed after ${secs(c.ms)}, nothing billed by this app` : c.status === "skipped" ? "not called, no cost" : "cost and time when it finishes"}
    </div>
    ${canPick ? `<button class="btn sm primary" data-win="${c.i}" style="margin-top:8px">Pick winner</button>` : ""}
  </div>`;
}

function renderCols(view) {
  const box = view.querySelector("#cmp-cols"); if (!box) return;
  const run = st.run;
  if (!run) { box.innerHTML = `<div class="panel"><div class="empty">Pick 2 to 6 models, type a prompt and click Compare. The answers appear here side by side.</div></div>`; return; }
  const done = run.status !== "running";
  box.innerHTML = `<div class="panel"><h3>${esc(run.prompt.slice(0, 120))}${run.prompt.length > 120 ? "…" : ""} <span class="right small">${done ? `${run.status === "done" ? "finished" : "failed"} · total ${money(run.cost, 5)}` : "running"}</span></h3>
      <div class="small dim">${done && !run.winner && run.status === "done" ? "Pick the winner: it counts as a thumbs-up for that model on this kind of work, and the router learns from it." : run.winner ? `Winner: ${esc(run.winner.name)}. The router will favour it for ${esc(run.capability)} work.` : "Answers stream in as each model writes."}</div></div>
    <div style="display:grid;grid-template-columns:repeat(${run.columns.length}, minmax(240px, 1fr));gap:12px;overflow-x:auto;align-items:stretch">${run.columns.map((c) => columnHtml(c, run)).join("")}</div>`;
  box.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", async () => {
    try { const r = await api(`/compare/${run.id}/winner`, { method: "POST", body: { column: Number(b.dataset.win) } }); st.run = r.run; toast(`${r.run.winner.name} picked. The router will favour it for this kind of work.`); renderCols(view); renderHistory(view); }
    catch (e) { toast(e.message, true); }
  }));
}

function renderHistory(view) {
  const box = view.querySelector("#cmp-hist"); if (!box) return;
  box.innerHTML = st.history.length ? st.history.slice(0, 12).map((h) => `<div class="row small" style="padding:4px 0;cursor:pointer;gap:6px" data-run="${esc(h.id)}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.title)}</span><span class="dim">${h.winner ? "★ " : ""}${ago(h.startedAt)} ago</span></div>`).join("") : `<div class="dim small">No comparisons yet.</div>`;
  box.querySelectorAll("[data-run]").forEach((r) => r.addEventListener("click", async () => { try { st.run = await api(`/compare/${r.dataset.run}`); renderCols(view); } catch (e) { toast(e.message, true); } }));
}

async function renderTab(view) {
  if (!st.loaded) { view.innerHTML = `<div class="empty">Loading…</div>`; await load(); }
  view.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 300px">
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Side-by-side</h3>
        <div class="small muted">One prompt goes to every model you pick, at the same time. Each column shows its answer, what it cost and how long it took. Each column uses exactly the model you picked, with no stand-ins: an AI without a key or at its monthly spend cap is skipped with a note.</div>
        <textarea id="cmp-prompt" rows="4" placeholder="Type the prompt to compare" style="width:100%;margin-top:10px">${esc(st.prompt)}</textarea>
        <div id="cmp-pickers" style="margin-top:8px">${st.cols.map((c, i) => `<div class="row" style="gap:6px;margin-top:4px"><span class="small dim" style="width:18px">${i + 1}</span><select data-pick="${i}" style="flex:1">${options(key(c))}</select>${st.cols.length > MIN ? `<button class="btn sm" data-rm="${i}" title="Remove">Remove</button>` : ""}</div>`).join("")}</div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
          ${st.cols.length < MAX ? `<button class="btn sm" id="cmp-add">+ Add a model</button>` : `<span class="small dim">${MAX} models at most</span>`}
          <label class="small dim row" style="gap:4px">Max answer tokens <input type="number" id="cmp-max" min="100" max="4000" step="100" value="${st.maxTokens}" style="width:80px"></label>
        </div>
        <div class="small dim" id="cmp-est" style="margin-top:8px">${estimate()}</div>
        <button class="btn primary" id="cmp-run" style="margin-top:8px" ${st.run?.status === "running" ? "disabled" : ""}>Compare</button>
      </div>
      <div id="cmp-cols"></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><h3>Model sets</h3>
        ${st.presets.length ? st.presets.map((p) => `<div class="row small" style="gap:6px;padding:3px 0"><button class="btn sm" data-load="${esc(p.id)}" style="flex:1;text-align:left" title="${esc(p.columns.map((c) => c.model).join(", "))}">${esc(p.name)} <span class="dim">(${p.columns.length})</span></button><button class="btn sm" data-del="${esc(p.id)}" title="Delete">Delete</button></div>`).join("") : `<div class="dim small">No saved sets yet.</div>`}
        <div class="row" style="gap:6px;margin-top:8px"><input type="text" id="cmp-pname" placeholder="Name this set" maxlength="60" style="flex:1"><button class="btn sm" id="cmp-psave">Save</button></div>
      </div>
      <div class="panel"><h3>Recent comparisons</h3><div id="cmp-hist"></div></div>
    </div></div>`;
  renderCols(view); renderHistory(view);
  const $v = (s) => view.querySelector(s);
  const refreshEst = () => { const e = $v("#cmp-est"); if (e) e.textContent = estimate(); };
  $v("#cmp-prompt").addEventListener("input", (e) => { st.prompt = e.target.value; });
  $v("#cmp-prompt").addEventListener("change", async () => { try { st.models = (await api(`/compare/models?chars=${st.prompt.length || 400}&maxTokens=${st.maxTokens}`)).models; refreshEst(); } catch {} });
  $v("#cmp-max").addEventListener("change", async (e) => { st.maxTokens = Math.min(4000, Math.max(100, Number(e.target.value) || 1200)); try { st.models = (await api(`/compare/models?chars=${st.prompt.length || 400}&maxTokens=${st.maxTokens}`)).models; refreshEst(); } catch {} });
  view.querySelectorAll("[data-pick]").forEach((s) => s.addEventListener("change", () => { const [provider, model] = s.value.split("|"); st.cols[Number(s.dataset.pick)] = { provider: provider || "", model: model || "" }; refreshEst(); }));
  view.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { st.cols.splice(Number(b.dataset.rm), 1); renderTab(view); }));
  $v("#cmp-add")?.addEventListener("click", () => { st.cols.push({ provider: "", model: "" }); renderTab(view); });
  $v("#cmp-run").addEventListener("click", async () => {
    const columns = st.cols.filter((c) => c.provider && c.model);
    if (!st.prompt.trim()) return toast("Type a prompt first.", true);
    if (columns.length < MIN) return toast(`Pick at least ${MIN} models.`, true);
    try { st.run = await api("/compare", { method: "POST", body: { prompt: st.prompt, columns, maxTokens: st.maxTokens } }); $v("#cmp-run").disabled = true; renderCols(view); }
    catch (e) { toast(e.message, true); }
  });
  $v("#cmp-psave").addEventListener("click", async () => {
    const name = $v("#cmp-pname").value.trim();
    if (!name) return toast("Give the set a name.", true);
    try { await api("/compare/presets", { method: "POST", body: { name, columns: st.cols.filter((c) => c.provider && c.model) } }); st.presets = (await api("/compare/presets")).items; toast(`Saved "${name}".`); renderTab(view); }
    catch (e) { toast(e.message, true); }
  });
  view.querySelectorAll("[data-load]").forEach((b) => b.addEventListener("click", () => { const p = st.presets.find((x) => x.id === b.dataset.load); if (!p) return; st.cols = p.columns.map((c) => ({ ...c })); renderTab(view); }));
  view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    const p = st.presets.find((x) => x.id === b.dataset.del);
    if (!p || !confirm(`Delete the set "${p.name}"?`)) return;
    try { st.presets = (await api(`/compare/presets/${p.id}`, { method: "DELETE" })).items; renderTab(view); } catch (e) { toast(e.message, true); }
  }));
}

function onEvent(ev) {
  const view = document.querySelector("#view");
  if (ev.type === "compare.delta" && st.run?.id === ev.runId) {
    const c = st.run.columns.find((x) => x.i === ev.i); if (!c) return;
    c.text += ev.text; if (c.status === "queued") c.status = "streaming";
    const body = view?.querySelector(`.cmp-col[data-col="${ev.i}"] .body`);
    if (body) { body.innerHTML = md(c.text); body.scrollTop = body.scrollHeight; }
  } else if (ev.type === "compare.update" && ev.run) {
    const h = st.history.findIndex((x) => x.id === ev.run.id);
    const sum = { id: ev.run.id, title: ev.run.prompt.slice(0, 90), status: ev.run.status, startedAt: ev.run.startedAt, winner: ev.run.winner?.model || null };
    if (h >= 0) st.history[h] = sum; else st.history.unshift(sum);
    if (st.run?.id !== ev.run.id) return;
    st.run = ev.run;
    if (!view?.querySelector("#cmp-cols")) return;
    renderCols(view); renderHistory(view);
    const btn = view.querySelector("#cmp-run"); if (btn) btn.disabled = ev.run.status === "running";
  }
}

CC.register({ id: "compare", tab: { label: "Compare", short: "Compare", icon: "⫴", order: 12, render: renderTab }, onEvent });
