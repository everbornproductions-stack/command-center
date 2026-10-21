// Test with personas (0.4.14). After any output (a chat answer, a mission result, a draft, a post, a
// page, a design brief) a "Test with personas" button runs it past the Meldmind persona panel. Simple
// steps: the smart default picks the right people for this kind of output (choosing them yourself is
// under "Choose people myself"), then each person's reaction and fixes show, with Apply on each fix and
// Apply all. Applying makes a revised version; "Use this version" puts it back where it came from.
// Other pages call window.CC.testWithPersonas({ text, kind, onUse }) for their own outputs.
const { api, toast, esc, md } = window.CC;
const S = () => window.CC.S;

const st = { panel: null };
async function panel() {
  if (!st.panel) st.panel = await api("/personas");
  return st.panel;
}
const LABELS = { chat: "answer", mission: "mission result", report: "report", draft: "draft", email: "email", post: "post", page: "page", design: "design", script: "script", code: "code" };

// The button other pages drop under an output. getText is read on click, so it is always current.
export function personaButton({ getText, kind, onUse, label = "Test with personas" } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn sm";
  b.dataset.personaTest = kind || "auto";
  b.textContent = label;
  b.title = "See how real people would react, then fix it in one click";
  b.addEventListener("click", () => {
    const text = String((typeof getText === "function" ? getText() : getText) || "").trim();
    if (!text) return toast("There is nothing to test yet.", true);
    openTest({ text, kind, onUse });
  });
  return b;
}

function dialog(html) {
  document.querySelector(".cc-persona-dlg")?.remove();
  const el = document.createElement("div");
  el.className = "cc-persona-dlg";
  el.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:70";
  el.innerHTML = `<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pt-title" style="width:min(680px,94vw);max-height:88vh;overflow:auto">${html}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") el.remove(); });
  document.body.appendChild(el);
  el.querySelector("button")?.focus();
  return el;
}

// Step 1: who reads it. Step 2: their reactions and fixes. Step 3: the revised version.
export async function openTest({ text, kind, onUse } = {}) {
  let p;
  try { p = await panel(); } catch (e) { return toast(e.message, true); }
  let pick;
  try { pick = await api(`/personas/pick?kind=${encodeURIComponent(kind || "")}&text=${encodeURIComponent(String(text).slice(0, 1500))}`); }
  catch { pick = { kind: kind || "chat", kindLabel: "this", personas: [] }; }
  const nameOf = (id) => p.personas.find((x) => x.id === id)?.name || id;
  const flow = { text, original: text, kind: pick.kind, history: [], applied: new Set(), result: null, onUse };
  const el = dialog(`<h3 id="pt-title">Test with personas</h3>
    <p class="small" style="margin:4px 0 10px">See how real people would react to this ${esc(LABELS[pick.kind] || "output")}, then fix it in one click.</p>
    <div class="panel" style="margin:0" id="pt-step1">
      <div class="small"><b>Step 1.</b> Who reads it</div>
      <label class="row small" style="gap:6px;margin-top:6px"><input type="radio" name="pt-who" value="smart" checked> <span><b>Smart pick:</b> ${pick.personas.map((id) => esc(nameOf(id))).join(", ")} <span class="dim">(best for ${esc(pick.kindLabel)})</span></span></label>
      <details style="margin-top:6px" id="pt-more"><summary class="small">Choose people myself</summary>
        <div class="small dim" style="margin:4px 0">Pick up to ${p.max}.</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px">${p.personas.map((x) => `<label class="row small" style="gap:6px;align-items:flex-start"><input type="checkbox" data-persona="${esc(x.id)}" ${pick.personas.includes(x.id) ? "checked" : ""}> <span><b>${esc(x.name)}</b> <span class="dim">${esc(x.who)}</span></span></label>`).join("")}</div>
      </details>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn primary" id="pt-run">Run the test</button><button class="btn" data-close>Close</button></div>
    </div>
    <div id="pt-results" aria-live="polite"></div>
    <div id="pt-revised"></div>
    <p class="small dim" style="margin-top:8px">${esc(p.note)} Nothing is sent or posted.</p>`);
  const $e = (s) => el.querySelector(s);
  $e("#pt-more").addEventListener("toggle", (e) => { if (e.target.open) el.querySelector('input[name="pt-who"]').checked = false; });
  el.querySelectorAll("[data-persona]").forEach((c) => c.addEventListener("change", () => {
    const on = el.querySelectorAll("[data-persona]:checked");
    if (on.length > p.max) { c.checked = false; toast(`${p.max} people at most.`, true); }
  }));
  const chosen = () => {
    if ($e('input[name="pt-who"]').checked || !$e("#pt-more").open) return undefined;
    const ids = [...el.querySelectorAll("[data-persona]:checked")].map((c) => c.dataset.persona);
    return ids.length ? ids : undefined;
  };
  const run = async () => {
    const btn = $e("#pt-run");
    btn.disabled = true; btn.textContent = "Reading...";
    $e("#pt-results").innerHTML = `<div class="small dim" style="margin-top:10px">The panel is reading it...</div>`;
    try {
      flow.result = await api("/personas/test", { method: "POST", body: { text: flow.text, kind: flow.kind, personas: chosen() } });
      flow.applied = new Set();
      paintResults(el, flow);
    } catch (e) { $e("#pt-results").innerHTML = ""; toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = "Run the test"; }
  };
  $e("#pt-run").addEventListener("click", run);
  return el;
}

const allFixes = (flow) => (flow.result?.reactions || []).flatMap((r) => r.fixes || []);
function paintResults(el, flow) {
  const box = el.querySelector("#pt-results");
  const rs = flow.result.reactions || [];
  const left = allFixes(flow).filter((f) => !flow.applied.has(f.id));
  box.innerHTML = `<div class="panel" style="margin:10px 0 0">
    <div class="row small" style="gap:8px;flex-wrap:wrap"><b>Step 2.</b> What they think
      ${allFixes(flow).length ? `<button class="btn sm primary" id="pt-all" style="margin-left:auto" ${left.length ? "" : "disabled"}>${left.length ? `Apply all fixes (${left.length})` : "All fixes applied"}</button>` : ""}</div>
    ${rs.map((r) => `<div style="border-top:1px solid var(--line);padding:8px 0;margin-top:6px">
      <div class="row small" style="gap:6px;flex-wrap:wrap"><b>${esc(r.name)}</b> <span class="dim">${esc(r.who)}</span>${r.score ? `<span class="chip" style="margin-left:auto" aria-label="Score ${r.score} of 5">${r.score} of 5</span>` : ""}</div>
      ${r.missing ? `<div class="small dim">No reaction came back from ${esc(r.name)}.</div>` : `<div class="small" style="margin-top:4px">${esc(r.reaction)}</div>`}
      ${(r.fixes || []).map((f) => `<div class="row small" style="gap:6px;margin-top:6px;align-items:flex-start"><span style="flex:1">${esc(f.fix)}${f.why ? ` <span class="dim">${esc(f.why)}</span>` : ""}</span>
        <button class="btn sm" data-fix="${esc(f.id)}" ${flow.applied.has(f.id) ? "disabled" : ""}>${flow.applied.has(f.id) ? "Applied" : "Apply"}</button></div>`).join("")}
    </div>`).join("")}
  </div>`;
  box.querySelector("#pt-all")?.addEventListener("click", () => applyFixes(el, flow, allFixes(flow).filter((f) => !flow.applied.has(f.id))));
  box.querySelectorAll("[data-fix]").forEach((b) => b.addEventListener("click", () => applyFixes(el, flow, allFixes(flow).filter((f) => f.id === b.dataset.fix))));
}

async function applyFixes(el, flow, fixes) {
  if (!fixes.length) return;
  const btns = el.querySelectorAll("#pt-results button");
  btns.forEach((b) => { b.disabled = true; });
  el.querySelector("#pt-revised").innerHTML = `<div class="small dim" style="margin-top:10px">Making the revised version...</div>`;
  try {
    const r = await api("/personas/apply", { method: "POST", body: { text: flow.text, kind: flow.kind, fixes: fixes.map((f) => ({ fix: f.fix, by: f.by })) } });
    flow.history.push({ text: flow.text, ids: fixes.map((f) => f.id) });
    flow.text = r.text;
    for (const f of fixes) flow.applied.add(f.id);
    paintRevised(el, flow);
  } catch (e) { el.querySelector("#pt-revised").innerHTML = ""; toast(e.message, true); }
  paintResults(el, flow);
}

function paintRevised(el, flow) {
  const box = el.querySelector("#pt-revised");
  box.innerHTML = `<div class="panel" style="margin:10px 0 0">
    <div class="small"><b>Step 3.</b> Your revised version <span class="dim">(${flow.applied.size} fix${flow.applied.size === 1 ? "" : "es"} applied)</span></div>
    <div class="md small" style="margin-top:6px;max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:6px;padding:8px" id="pt-text">${md(flow.text)}</div>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
      ${flow.onUse ? `<button class="btn primary" id="pt-use">Use this version</button>` : ""}
      <button class="btn" id="pt-copy">Copy</button>
      <button class="btn" id="pt-again" title="Run the same people on the revised version">Test again</button>
      <button class="btn" id="pt-undo" ${flow.history.length ? "" : "disabled"}>Undo last change</button>
    </div></div>`;
  box.querySelector("#pt-use")?.addEventListener("click", () => { try { flow.onUse(flow.text); toast("Using the revised version."); el.remove(); } catch (e) { toast(e.message, true); } });
  box.querySelector("#pt-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(flow.text); toast("Copied"); } catch { toast("Could not copy: select the text and press Ctrl+C", true); } });
  box.querySelector("#pt-again").addEventListener("click", () => { el.querySelector("#pt-run")?.click(); });
  box.querySelector("#pt-undo").addEventListener("click", () => {
    const last = flow.history.pop();
    if (!last) return;
    flow.text = last.text;
    for (const id of last.ids) flow.applied.delete(id);
    if (flow.history.length) paintRevised(el, flow); else box.innerHTML = "";
    paintResults(el, flow);
  });
}

window.CC.testWithPersonas = (opts) => openTest(opts || {});
window.CC.personaButton = personaButton;

// Under every finished chat answer and mission result.
function renderDeliverable(el, run) {
  if (!run) { el.innerHTML = ""; return; }
  const textOf = (r) => String(r?.deliverable || r?.agents?.[r?.primary]?.text || "");
  if (!textOf(run).trim()) { el.innerHTML = ""; return; }
  el.innerHTML = "";
  const row = document.createElement("div");
  row.className = "row small";
  row.style.cssText = "gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center";
  row.appendChild(personaButton({
    getText: () => textOf(S().live),
    kind: run.kind === "mission" ? "mission" : "",
    onUse: (text) => { S().live.deliverable = text; window.CC.renderOutput(); },
  }));
  const hint = document.createElement("span");
  hint.className = "dim";
  hint.textContent = "See how real people would react, then fix it in one click.";
  row.appendChild(hint);
  el.appendChild(row);
}

window.CC.register({ id: "personas", deliverable: { order: 4, render: renderDeliverable } });
