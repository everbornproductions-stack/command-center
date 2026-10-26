// Finish router panel on the Publish page (flag_finishrouter, 0.4.19). It looks at the work sent to
// Finish, names the editor that fits, asks when it is not sure, explains why, and lets the person
// change it. Nothing is published or sent from here.
const CC = window.CC;

const STYLE = `
.fr-card{margin-bottom:12px;overflow-wrap:anywhere;word-break:break-word}
.fr-card textarea{width:100%;min-height:70px;box-sizing:border-box}
.fr-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.fr-why{margin-top:8px}
.fr-why li{margin:2px 0;overflow-wrap:anywhere}
.fr-gen textarea{width:100%;min-height:90px;box-sizing:border-box}
.fr-check{display:flex;gap:8px;align-items:center;margin:4px 0}
.fr-check span{flex:1;min-width:0;overflow-wrap:anywhere}
`;

function ensureStyle() {
  if (document.getElementById("fr-style")) return;
  const s = document.createElement("style");
  s.id = "fr-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const wordsFor = (r) => (r.decision === "direct" ? "Sure" : r.decision === "confirm" ? "Probably" : "Not sure");

export function mountFinishRouter(view) {
  if (!view || !CC.S?.flags?.finishrouter) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  view.querySelector(":scope > .fr-card")?.remove();
  const seed = CC._finishText || {};
  const card = document.createElement("div");
  card.className = "panel fr-card";
  card.setAttribute("aria-label", "Pick the Finish editor");
  card.innerHTML = `<h3>Which editor fits this work?</h3>
    <label class="lbl" for="fr-text">Paste the work or describe it</label>
    <textarea id="fr-text" placeholder="A caption, a page, a song, a spreadsheet...">${esc(seed.text || "")}</textarea>
    <div class="fr-row"><input type="text" id="fr-name" placeholder="File name (optional), like menu.pdf" style="flex:1;min-width:160px"><button type="button" class="btn sm primary" id="fr-go">Re-classify</button></div>
    <div id="fr-out" class="small" aria-live="polite"></div><div id="fr-gen"></div><div id="fr-hist" class="small dim"></div>`;
  view.prepend(card);
  const out = card.querySelector("#fr-out");
  const text = card.querySelector("#fr-text");
  const name = card.querySelector("#fr-name");
  let cats = [];
  let last = null;
  const input = () => ({ text: text.value, name: name.value.trim(), kind: seed.kind || "" });

  async function history() {
    try {
      if (!cats.length) cats = (await api("/finishrouter/categories")).categories || [];
      const h = await api("/finishrouter/history");
      const rows = (h.items || []).slice(0, 5);
      card.querySelector("#fr-hist").innerHTML = rows.length
        ? `<div>Your changes on this PC <button type="button" class="ghost small" id="fr-clear">Clear</button></div><ul>${rows.map((r) => `<li>${esc(label(r.original))} to ${esc(label(r.corrected))}</li>`).join("")}</ul>`
        : "";
      card.querySelector("#fr-clear")?.addEventListener("click", async () => { await api("/finishrouter/history", { method: "DELETE" }); history(); });
    } catch {}
  }
  const label = (id) => cats.find((c) => c.id === id)?.label || "General";

  async function choose(id) {
    try {
      await api("/finishrouter/override", { method: "POST", body: { original: last?.category, corrected: id, ...input() } });
      toast(`Using ${label(id)}. Meldmind will remember this on this PC.`);
      last = { ...last, category: id, label: label(id), decision: "direct", confidence: 1, confirmed: true, signals: [{ why: "you picked it", weight: 1, tier: "you" }] };
      draw();
      history();
    } catch (e) { toast(e.message, true); }
  }

  function draw() {
    const r = last;
    if (!r) return;
    const chip = r.decision === "confirm" && !r.confirmed
      ? `<div class="fr-row"><span class="chip amber">${esc(wordsFor(r))}: ${esc(r.label)}</span><span>Is this right?</span><button type="button" class="btn sm primary" data-yes>Yes</button></div>`
      : `<div class="fr-row"><span class="chip ${r.decision === "general" ? "" : "green"}">${esc(r.decision === "general" ? "General" : r.label)}</span><span class="dim">${r.decision === "general" ? "Not sure, so it opens in the General workspace." : "Opens in the " + esc(r.editor || r.label) + " editor."}</span></div>`;
    out.innerHTML = `${chip}
      <div class="fr-row"><label for="fr-pick">Change it</label><select id="fr-pick">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === r.category ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
      <details class="fr-why"><summary>Why this editor?</summary>
        <div>Match: ${Math.round((r.confidence || 0) * 100)} percent${r.tier && r.tier !== "none" ? ", found by " + esc(r.tier === "rules" ? "clear rules" : r.tier === "you" ? "your choice" : "matching words") : ""}.</div>
        <ul>${(r.signals || []).filter((s) => !r.category || s.category === r.category || s.tier === "you").map((s) => `<li>${esc(s.why)} (${Math.round(s.weight * 100)})</li>`).join("") || "<li>Nothing clear to go on.</li>"}</ul>
        ${(r.secondary || []).length ? `<div>Next best: ${r.secondary.map((s) => esc(s.label) + " " + Math.round(s.confidence * 100)).join(", ")}</div>` : ""}
      </details>`;
    out.querySelector("[data-yes]")?.addEventListener("click", () => { last = { ...last, confirmed: true }; toast(`Using ${last.label}.`); draw(); });
    out.querySelector("#fr-pick")?.addEventListener("change", (e) => { if (e.target.value !== r.category) choose(e.target.value); });
    drawGeneral();
  }

  async function drawGeneral() {
    const host = card.querySelector("#fr-gen");
    if (!last || last.category !== "general") { host.innerHTML = ""; return; }
    const ref = seed.ref || "main";
    let g = { notes: "", checklist: [], ready: false };
    try { g = await api("/finishrouter/general?ref=" + encodeURIComponent(ref)); } catch {}
    const rows = () => g.checklist.map((c, i) => `<div class="fr-check"><input type="checkbox" data-i="${i}" ${c.done ? "checked" : ""} aria-label="Done"><span>${esc(c.text)}</span><button type="button" class="ghost small" data-del="${i}" aria-label="Remove">x</button></div>`).join("");
    host.innerHTML = `<div class="fr-gen"><h4>General workspace</h4>
      <label class="lbl" for="fr-notes">Notes</label><textarea id="fr-notes">${esc(g.notes)}</textarea>
      <label class="lbl" for="fr-item">Checklist</label><div id="fr-list">${rows()}</div>
      <div class="fr-row"><input type="text" id="fr-item" placeholder="Add a step" style="flex:1;min-width:140px"><button type="button" class="btn sm" id="fr-add">Add</button></div>
      <div class="fr-row"><button type="button" class="btn sm" id="fr-save">Save</button><button type="button" class="btn sm primary" id="fr-ready">Ready to finish</button><span class="dim small" id="fr-gnote">Ready only marks it. Nothing is exported or shared until you choose to.</span></div></div>`;
    const save = async (ready) => {
      g.notes = host.querySelector("#fr-notes").value;
      try { g = await api("/finishrouter/general", { method: "PUT", body: { ref, notes: g.notes, checklist: g.checklist, ready } }); toast(ready ? (g.ready ? "Marked ready." : "Tick every step first.") : "Saved."); drawGeneral(); } catch (e) { toast(e.message, true); }
    };
    host.querySelector("#fr-add").addEventListener("click", () => { const v = host.querySelector("#fr-item").value.trim(); if (!v) return; g.checklist.push({ text: v, done: false }); g.notes = host.querySelector("#fr-notes").value; save(false); });
    host.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("change", () => { g.checklist[+b.dataset.i].done = b.checked; save(false); }));
    host.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { g.checklist.splice(+b.dataset.del, 1); save(false); }));
    host.querySelector("#fr-save").addEventListener("click", () => save(false));
    host.querySelector("#fr-ready").addEventListener("click", () => save(true));
  }

  async function run() {
    const body = input();
    if (!body.text.trim() && !body.name) { out.innerHTML = `<span class="dim">Add some words or a file name first.</span>`; return; }
    try {
      if (!cats.length) cats = (await api("/finishrouter/categories")).categories || [];
      last = await api("/finishrouter/reclassify", { method: "POST", body });
      draw();
    } catch (e) { toast(e.message, true); }
  }
  card.querySelector("#fr-go").addEventListener("click", run);
  history();
  if (seed.text) run();
}

CC.mountFinishRouter = mountFinishRouter;
CC.register({ id: "finish-router" });
