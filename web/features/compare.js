// Side-by-side comparison (Phase 17). One prompt, 2 to 6 models, columns stream in together.
// Cost and time come from the run; Pick winner writes a rating the router already reads.
const { api, toast, md, esc, money, go } = window.CC;

const css = `
.cc-cmp-models { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
.cc-cmp-pick { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--line-2); border-radius: 10px; background: #0d1420; color: var(--text); cursor: pointer; font: inherit; }
.cc-cmp-pick:hover { border-color: var(--accent); }
.cc-cmp-pick.on { border-color: var(--accent); background: #102433; box-shadow: inset 0 0 0 1px var(--accent); }
.cc-cmp-pick .mark { width: 14px; text-align: center; color: var(--dim); }
.cc-cmp-pick.on .mark { color: var(--accent); }
.cc-cmp .ans .meta { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--muted); }
.cc-cmp .ans.skipped { background: #12100c; }
`;
const style = document.createElement("style"); style.id = "cc-compare-style"; style.textContent = css; document.head.appendChild(style);

let form = null; // { models, presets, min, max }
let current = null;
let busy = false;

const keyOf = (c) => `${c.provider}:${c.model}`;

async function loadForm() {
  form = await api("/compare");
  if (form.active && (!current || current.id !== form.active)) {
    try { current = await api(`/compare/${form.active}`); } catch {}
  }
  return form;
}

function selected() {
  return [...document.querySelectorAll("#cc-cmp-models .cc-cmp-pick.on")].map((el) => ({ provider: el.dataset.provider, model: el.dataset.model }));
}

function paintColumns() {
  const box = document.getElementById("cc-cmp-cols");
  if (!box) return;
  const run = current;
  if (!run) { box.innerHTML = ""; return; }
  const cap = run.classification?.capability ? `<span class="chip">${esc(run.classification.capability)}</span>` : "";
  box.innerHTML = `<div class="cat-h" style="margin-top:14px">Answers ${cap} <span class="right">${esc(run.status)} · ${money(run.cost || 0, 4)}</span></div>
    <div class="small muted" style="margin-bottom:8px">${esc(run.prompt)}</div>
    <div class="council-cols">${run.columns.map((c, i) => {
      const meta = c.status === "skipped" || c.status === "error" ? "" : c.ms ? `${(c.ms / 1000).toFixed(1)}s · ${money(c.cost || 0, 4)}` : (c.status === "streaming" ? "streaming" : "waiting");
      const body = c.status === "skipped" || (c.status === "error" && !c.text)
        ? `<div class="small" style="color:${c.status === "error" ? "var(--red)" : "var(--amber)"}">${esc(c.note || "Skipped.")}</div>`
        : `<div class="body md">${md(c.text || (c.status === "streaming" ? "" : ""))}</div>`;
      const pick = c.status === "done" && c.text ? `<button class="btn sm ${c.winner ? "primary" : ""}" data-pick="${i}">${c.winner ? "Winner" : "Pick winner"}</button>` : "";
      return `<div class="ans ${c.winner ? "winner" : ""} ${c.status === "skipped" ? "skipped" : ""}" style="--c:${esc(c.color || "#22d3ee")}" data-cmp="${i}">
        <div class="hd"><span class="dot" style="background:${esc(c.color || "#22d3ee")}"></span>${esc(c.providerName)} <span class="dim small">${esc(c.modelName)}</span><span class="meta">${esc(meta)}</span></div>
        ${body}
        <div class="row" style="margin-top:8px">${pick}</div>
      </div>`;
    }).join("")}</div>`;
  box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pickWinner(run.columns[Number(b.dataset.pick)])));
}

function patchDelta(ev) {
  if (!current || current.id !== ev.id) return;
  const col = current.columns.find((c) => c.provider === ev.provider && c.model === ev.model);
  if (!col) return;
  col.text = (col.text || "") + ev.text;
  const i = current.columns.indexOf(col);
  const body = document.querySelector(`#cc-cmp-cols [data-cmp="${i}"] .body`);
  if (body) { body.innerHTML = md(col.text); body.scrollTop = body.scrollHeight; }
}

async function pickWinner(col) {
  if (!current || !col) return;
  try {
    const r = await api(`/compare/${current.id}/winner`, { method: "POST", body: { provider: col.provider, model: col.model } });
    current = r.compare;
    paintColumns();
    toast(`${col.modelName} picked. The router will favour it for ${r.capability}.`);
  } catch (e) { toast(e.message, true); }
}

async function render(view) {
  view.innerHTML = `<div class="empty">Loading comparison…</div>`;
  try { await loadForm(); } catch (e) { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const f = form;
  const groups = new Map();
  for (const m of f.models) { if (!groups.has(m.provider)) groups.set(m.provider, []); groups.get(m.provider).push(m); }
  view.innerHTML = `<div class="cc-cmp">
    <div class="panel">
      <h3>Side by side <span class="right">${f.min} to ${f.max} models</span></h3>
      <div class="small muted" style="margin-bottom:8px">One prompt goes to the models you pick. Answers stream next to each other with the cost and the time each one took. Pick the winner to teach the router. A model at its monthly spend cap is skipped and not called.</div>
      ${f.models.length < f.min ? `<div class="empty">Add at least two API keys in Settings, or turn on demo mode, to compare models.</div>` : `
      <label class="lbl">Models</label>
      <div class="small dim" style="margin-bottom:4px">Click a model to include it. Pick ${f.min} to ${f.max}.</div>
      <div class="cc-cmp-models" id="cc-cmp-models">${[...groups.entries()].map(([, ms]) => ms.map((m) => `<button type="button" class="cc-cmp-pick" data-provider="${esc(m.provider)}" data-model="${esc(m.model)}" aria-pressed="false"><span class="mark">+</span><span class="dot" style="background:${esc(m.color)}"></span>${esc(m.providerName)} <span class="dim">${esc(m.modelName)}</span>${m.capped ? `<span class="chip amber" title="At its monthly spend cap. It will be skipped.">at cap</span>` : ""}</button>`).join("")).join("")}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="cc-cmp-preset" style="width:auto;min-width:160px"><option value="">Saved presets</option>${f.presets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
        <button class="btn sm" id="cc-cmp-use" type="button">Use preset</button>
        <button class="ghost small" id="cc-cmp-del" type="button">Delete</button>
        <input id="cc-cmp-name" placeholder="Preset name" style="width:160px;margin-left:auto">
        <button class="btn sm" id="cc-cmp-save" type="button">Save preset</button>
      </div>`}
      <label class="lbl" style="margin-top:10px">Prompt</label>
      <textarea id="cc-cmp-prompt" placeholder="The same prompt is sent to every model you picked." style="min-height:90px"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" id="cc-cmp-go" type="button">Compare</button></div>
    </div>
    <div id="cc-cmp-cols"></div>
    <div class="panel" style="margin-top:14px"><h3>Recent comparisons</h3>
      ${(f.recent || []).map((r) => `<div class="row small" style="padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer" data-open="${esc(r.id)}"><span class="chip ${r.status === "done" ? "green" : r.status === "failed" ? "red" : ""}">${esc(r.status)}</span><span style="flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc((r.prompt || "").slice(0, 90))}</span><span class="mono dim">${money(r.cost || 0, 4)}</span></div>`).join("") || `<div class="dim small">None yet.</div>`}
    </div>
  </div>`;
  paintColumns();
  const setOn = (el, on) => { el.classList.toggle("on", on); el.setAttribute("aria-pressed", on ? "true" : "false"); el.querySelector(".mark").textContent = on ? "✓" : "+"; };
  view.querySelectorAll("#cc-cmp-models .cc-cmp-pick").forEach((el) => el.addEventListener("click", () => {
    const on = el.classList.contains("on");
    if (!on && selected().length >= f.max) { toast(`Pick at most ${f.max} models.`, true); return; }
    setOn(el, !on);
  }));
  view.querySelector("#cc-cmp-use")?.addEventListener("click", async () => {
    const id = view.querySelector("#cc-cmp-preset").value;
    if (!id) return toast("Choose a preset first.", true);
    try {
      const preset = await api(`/compare/presets/${id}`);
      const want = new Set(preset.models.map(keyOf));
      view.querySelectorAll("#cc-cmp-models .cc-cmp-pick").forEach((el) => setOn(el, want.has(`${el.dataset.provider}:${el.dataset.model}`)));
      const have = new Set(selected().map(keyOf));
      const missing = preset.models.filter((m) => !have.has(keyOf(m)));
      toast(missing.length ? `Loaded ${preset.name}. ${missing.length} model${missing.length === 1 ? "" : "s"} from that preset ${missing.length === 1 ? "is" : "are"} not available right now.` : `Loaded ${preset.name}.`);
    } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#cc-cmp-del")?.addEventListener("click", async () => {
    const id = view.querySelector("#cc-cmp-preset").value;
    if (!id) return;
    try { await api(`/compare/presets/${id}`, { method: "DELETE" }); toast("Preset deleted."); render(view); } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#cc-cmp-save")?.addEventListener("click", async () => {
    const models = selected();
    const name = view.querySelector("#cc-cmp-name").value.trim();
    if (!name) return toast("Name the preset.", true);
    if (models.length < f.min || models.length > f.max) return toast(`A preset needs ${f.min} to ${f.max} models.`, true);
    try { await api("/compare/presets", { method: "POST", body: { name, models } }); toast("Preset saved."); render(view); } catch (e) { toast(e.message, true); }
  });
  view.querySelector("#cc-cmp-go")?.addEventListener("click", async () => {
    const models = selected();
    const prompt = view.querySelector("#cc-cmp-prompt").value.trim();
    if (!prompt) return toast("Type a prompt first.", true);
    if (models.length < f.min || models.length > f.max) return toast(`Choose ${f.min} to ${f.max} models.`, true);
    const btn = view.querySelector("#cc-cmp-go");
    btn.disabled = true; busy = true;
    try {
      const r = await api("/compare", { method: "POST", body: { prompt, models } });
      current = r.compare;
      paintColumns();
    } catch (e) { toast(e.message, true); }
    finally { busy = false; const b = document.getElementById("cc-cmp-go"); if (b) b.disabled = false; }
  });
  view.querySelectorAll("[data-open]").forEach((row) => row.addEventListener("click", async () => {
    try { current = await api(`/compare/${row.dataset.open}`); paintColumns(); } catch (e) { toast(e.message, true); }
  }));
}

function renderCommand(el) {
  el.innerHTML = `<div class="route" style="margin-top:8px"><div class="row small" style="gap:8px"><span class="muted">Side by side:</span><span style="flex:1">Send one prompt to 2 to 6 models and compare the answers, the cost and the speed.</span><button class="btn sm" type="button" id="cc-cmp-open">Compare</button></div></div>`;
  el.querySelector("#cc-cmp-open").addEventListener("click", () => go("compare"));
}

function onEvent(ev) {
  if (ev.type === "compare.delta") { patchDelta(ev); return; }
  if (ev.type === "compare.update" && ev.compare) {
    if (current && current.id === ev.compare.id) {
      const local = new Map(current.columns.map((c) => [keyOf(c), c.text || ""]));
      current = ev.compare;
      for (const c of current.columns) {
        const prev = local.get(keyOf(c)) || "";
        if (prev.length > (c.text || "").length) c.text = prev;
      }
    } else if (!current || current.status !== "running") current = ev.compare;
    paintColumns();
  }
}

window.CC.register({
  id: "compare",
  tab: { label: "Compare", short: "Compare", icon: "⧉", order: 18, render },
  command: { order: 12, render: renderCommand },
  onEvent,
});
