// Category finishers panel on the Publish page (flag_finishers, 0.4.19). Small editors for documents,
// accounting tables, automations, music, presentations, programs and games. Nothing is sent, booked,
// paid, posted or deployed from here without a clearly labelled confirm click.
const CC = window.CC;

const STYLE = `
.fz-card{margin-bottom:12px;overflow-wrap:anywhere;word-break:break-word}
.fz-card textarea,.fz-card input[type=text],.fz-card select{max-width:100%;box-sizing:border-box}
.fz-card textarea{width:100%;min-height:90px}
.fz-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.fz-row>*{min-width:0}
.fz-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.fz-item{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)}
.fz-item span{flex:1;min-width:120px;overflow-wrap:anywhere}
.fz-box{border:1px solid var(--line);border-radius:8px;padding:8px;margin:8px 0;overflow-wrap:anywhere}
.fz-tbl{width:100%;border-collapse:collapse;table-layout:fixed}
.fz-tbl td,.fz-tbl th{padding:4px;text-align:left;overflow-wrap:anywhere;vertical-align:top}
.fz-tbl input,.fz-tbl select{width:100%}
.fz-ok{color:var(--green)}.fz-bad{color:var(--red)}
`;

function ensureStyle() {
  if (document.getElementById("fz-style")) return;
  const s = document.createElement("style");
  s.id = "fz-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const WORDS = { document: "Write-up or report", accounting: "Money table", automation: "Repeating job", music: "Sound mix", presentation: "Slides", program: "Program", game: "Game items" };
const THEMES = ["light", "dark", "warm"];
const GAME_TYPES = ["character", "enemy", "weapon", "item", "level"];

export function mountFinishers(view) {
  if (!view || !CC.S?.flags?.finishers) return;
  ensureStyle();
  const { api, esc, toast } = CC;
  view.querySelector(":scope > .fz-card")?.remove();
  const card = document.createElement("div");
  card.className = "panel fz-card";
  card.setAttribute("aria-label", "Finish editors");
  view.prepend(card);
  let kinds = [];
  let items = [];
  let cur = null; // the open item
  let busy = false;

  const kindLabel = (id) => WORDS[id] || kinds.find((k) => k.id === id)?.label || id;
  const num = (el) => Number(el.value);
  const act = async (fn, okMsg) => {
    if (busy) return;
    busy = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); } finally { busy = false; }
  };
  const download = (f) => {
    const bin = atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    a.download = f.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const exportAs = async (format) => { const f = await api(`/finishers/items/${cur.id}/export`, { method: "POST", body: { format } }); download(f); };

  async function loadList() {
    if (!kinds.length) kinds = (await api("/finishers/kinds")).kinds || [];
    items = (await api("/finishers/items")).items || [];
  }
  async function open(id) { cur = await api("/finishers/items/" + id); drawEditor(); }
  async function save(data) { cur = await api("/finishers/items/" + cur.id, { method: "PUT", body: { data } }); }

  function drawList() {
    cur = null;
    card.innerHTML = `<h3>Finish editors</h3>
      <div class="dim small">Pick a kind of work and make it ready. Nothing is sent or turned on until you press a confirm button.</div>
      <div class="fz-row"><select id="fz-kind" aria-label="Kind of work">${kinds.map((k) => `<option value="${esc(k.id)}">${esc(kindLabel(k.id))}</option>`).join("")}</select>
      <input type="text" id="fz-title" placeholder="Name (optional)" style="flex:1;min-width:140px"><button type="button" class="btn sm primary" data-act="new">Start</button></div>
      <div class="fz-list">${items.map((i) => `<div class="fz-item"><span><b>${esc(i.title)}</b> <span class="dim small">${esc(kindLabel(i.kind))}</span></span>${i.approved ? '<span class="chip green">approved</span>' : ""}${i.active ? '<span class="chip green">on</span>' : ""}<button type="button" class="btn sm" data-act="open" data-id="${esc(i.id)}">Open</button><button type="button" class="ghost small" data-act="del" data-id="${esc(i.id)}" aria-label="Delete">x</button></div>`).join("") || '<div class="dim small">Nothing here yet.</div>'}</div>`;
  }

  const head = () => `<div class="fz-row"><button type="button" class="ghost small" data-act="back">Back to list</button><b>${esc(cur.title)}</b><span class="dim small">${esc(kindLabel(cur.kind))}</span>${cur.approved ? '<span class="chip green">approved</span>' : ""}</div>`;
  const approveBox = (why) => `<div class="fz-box"><div class="small">${esc(why)}</div><div class="fz-row">${cur.approved ? '<button type="button" class="btn sm" data-act="unapprove">Take approval back</button>' : '<button type="button" class="btn sm primary" data-act="approve">Approve this</button>'}</div></div>`;
  const checks = (r) => (r ? `<ul class="small">${r.checks.map((c) => `<li class="${c.ok ? "fz-ok" : "fz-bad"}">${esc(c.text)}</li>`).join("")}</ul>` : "");

  const EDITORS = {
    document() {
      const secs = cur.data.sections;
      return `${secs.map((s, i) => `<div class="fz-box"><input type="text" data-f="title" data-i="${i}" value="${esc(s.title)}" aria-label="Section title" ${s.level ? "" : "disabled"}><textarea data-f="text" data-i="${i}" aria-label="Section text">${esc(s.text)}</textarea><div class="fz-row"><button type="button" class="btn sm" data-act="sec" data-i="${i}">Save this section</button></div></div>`).join("")}
        <div class="fz-box"><b>Check the facts</b><div class="dim small">Lines with numbers, dates or sources. Tick each one once you have checked it yourself.</div>${(cur.claims || []).map((c, n) => `<label class="fz-row"><input type="checkbox" data-act="claim" data-n="${n}" ${cur.data.checked.includes(c) ? "checked" : ""}><span>${esc(c)}</span></label>`).join("") || '<div class="dim small">Nothing to check.</div>'}</div>
        <div class="fz-row"><button type="button" class="btn sm" data-act="exp" data-f="md">Save as text</button><button type="button" class="btn sm" data-act="exp" data-f="docx">Save as Word</button><button type="button" class="btn sm" data-act="exp" data-f="pdf">Save as PDF</button></div>`;
    },
    accounting() {
      const t = cur.totals || { rows: [], subtotal: 0, tax: 0, total: 0 };
      return `<div class="fz-row"><label for="fz-party">Who is it for</label><input type="text" id="fz-party" value="${esc(cur.data.party)}" style="flex:1;min-width:140px"><label for="fz-tax">Tax percent</label><input type="text" id="fz-tax" value="${esc(cur.data.taxRate)}" style="width:70px"></div>
        <table class="fz-tbl"><thead><tr><th style="width:40%">What</th><th>How many</th><th>Price</th><th>Amount</th><th style="width:36px"></th></tr></thead><tbody>${t.rows.map((r, i) => `<tr><td><input type="text" data-r="${i}" data-f="description" value="${esc(r.description)}" aria-label="What"></td><td><input type="text" data-r="${i}" data-f="qty" value="${esc(r.qty)}" aria-label="How many"></td><td><input type="text" data-r="${i}" data-f="price" value="${esc(r.price)}" aria-label="Price"></td><td>${r.amount.toFixed(2)}</td><td><button type="button" class="ghost small" data-act="rowdel" data-i="${i}" aria-label="Remove row">x</button></td></tr>`).join("")}</tbody></table>
        <div class="fz-row"><button type="button" class="btn sm" data-act="rowadd">Add a row</button><button type="button" class="btn sm" data-act="acsave">Save table</button></div>
        <div class="small">Subtotal ${t.subtotal.toFixed(2)}, tax ${t.tax.toFixed(2)}, <b>total ${t.total.toFixed(2)}</b></div>
        ${approveBox("Approve when the numbers are right. Any edit takes the approval away. Saving a file needs the approval.")}
        <div class="fz-row"><button type="button" class="btn sm" data-act="exp" data-f="csv" ${cur.approved ? "" : "disabled"}>Save as spreadsheet (CSV)</button><span class="dim small">Nothing is sent to anyone from here.</span></div>`;
    },
    automation() {
      const w = cur.data.when || {};
      return `<label class="lbl" for="fz-steps">Steps, one per line</label><textarea id="fz-steps">${esc(cur.data.steps.map((s) => s.text).join("\n"))}</textarea>
        <div class="fz-row"><label for="fz-cron">Repeats (like 0 9 * * 1-5, or @daily)</label><input type="text" id="fz-cron" value="${esc(w.cron || "")}" style="flex:1;min-width:140px"><label for="fz-cap">Monthly spend limit (USD)</label><input type="text" id="fz-cap" value="${esc(cur.data.capUsd)}" style="width:70px"></div>
        <div class="fz-row"><button type="button" class="btn sm" data-act="aused">Save</button><button type="button" class="btn sm" data-act="test">Test run</button><button type="button" class="btn sm" data-act="sched">Save the repeat</button></div>
        ${cur.tested ? `<div class="fz-box"><b>Test run: ${cur.testOk ? "passed" : "needs work"}</b>${checks(cur.test.result)}<div class="dim small">A test only lists what would happen. It never does it.</div></div>` : '<div class="dim small">Test it before you turn it on. An edit clears the test.</div>'}
        ${approveBox("Approve when you are happy with the steps and the repeat.")}
        <div class="fz-box">${cur.activeScheduleId ? '<div class="small">It is on and will run by itself.</div><button type="button" class="btn sm" data-act="deact">Turn off</button>' : '<div class="small">Turning it on lets it run by itself and use your AI credit, up to the spend limit.</div><button type="button" class="btn sm primary" data-act="activate">Confirm and turn on</button>'}</div>`;
    },
    music() {
      return `<table class="fz-tbl"><thead><tr><th style="width:24%">Track</th><th>Start (s)</th><th>Length (s)</th><th>Volume %</th><th>Fade in</th><th>Fade out</th><th style="width:36px"></th></tr></thead><tbody>${cur.data.tracks.map((t, i) => `<tr><td><input type="text" data-r="${i}" data-f="name" value="${esc(t.name)}" aria-label="Track name"></td>${["start", "length", "volume", "fadeIn", "fadeOut"].map((f) => `<td><input type="text" data-r="${i}" data-f="${f}" value="${esc(t[f])}" aria-label="${f}"></td>`).join("")}<td><button type="button" class="ghost small" data-act="trkdel" data-i="${i}" aria-label="Remove track">x</button></td></tr>`).join("")}</tbody></table>
        <div class="fz-row"><button type="button" class="btn sm" data-act="trkadd">Add a track</button><button type="button" class="btn sm" data-act="musave">Save</button></div>
        <label class="lbl" for="fz-mnotes">Notes</label><textarea id="fz-mnotes">${esc(cur.data.notes)}</textarea>
        <div class="fz-box"><b>Cue sheet</b><pre class="small" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc((cur.plan?.cues || []).join("\n") || "No tracks yet.")}</pre><div class="dim small">Meldmind does not mix the audio. The sheet and a ready command go to your editor or to ffmpeg.</div></div>
        <div class="fz-row"><button type="button" class="btn sm" data-act="exp" data-f="txt">Save cue sheet</button></div>`;
    },
    presentation() {
      const sl = cur.data.slides;
      return `<div class="fz-row"><label for="fz-theme">Look</label><select id="fz-theme">${THEMES.map((t) => `<option ${t === cur.data.theme ? "selected" : ""}>${esc(t)}</option>`).join("")}</select><button type="button" class="btn sm" data-act="slsave">Save</button><button type="button" class="btn sm" data-act="sladd">Add a slide</button></div>
        ${sl.map((s, i) => `<div class="fz-box"><div class="fz-row"><b>${i + 1}</b><input type="text" data-r="${i}" data-f="title" value="${esc(s.title)}" aria-label="Slide title" style="flex:1;min-width:120px"><button type="button" class="ghost small" data-act="slup" data-i="${i}" ${i ? "" : "disabled"} aria-label="Move up">Up</button><button type="button" class="ghost small" data-act="sldn" data-i="${i}" ${i < sl.length - 1 ? "" : "disabled"} aria-label="Move down">Down</button><button type="button" class="ghost small" data-act="sldel" data-i="${i}" aria-label="Remove slide">x</button></div><textarea data-r="${i}" data-f="bullets" aria-label="Points, one per line">${esc(s.bullets.join("\n"))}</textarea><textarea data-r="${i}" data-f="notes" aria-label="Speaker notes" placeholder="Speaker notes">${esc(s.notes)}</textarea></div>`).join("")}
        <div class="fz-row"><button type="button" class="btn sm" data-act="exp" data-f="html">Save as web slides</button><button type="button" class="btn sm" data-act="exp" data-f="md">Save as text outline</button></div>`;
    },
    program() {
      const t = cur.tested ? `<div class="fz-box"><b>Test: ${cur.testOk ? "passed" : "needs work"}</b>${checks(cur.test.result)}</div>` : '<div class="dim small">Run the test before approving. An edit clears the test.</div>';
      return `<div class="fz-row"><label for="fz-lang">Language</label><select id="fz-lang">${["javascript", "python", "json", "other"].map((l) => `<option ${l === cur.data.language ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <textarea id="fz-code" style="min-height:200px;font-family:monospace" aria-label="Code">${esc(cur.data.code)}</textarea>
        ${(cur.notes || []).length ? `<div class="fz-box"><b>Review notes</b><ul class="small">${cur.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
        <div class="fz-row"><button type="button" class="btn sm" data-act="pgsave">Save</button><button type="button" class="btn sm" data-act="test">Test (reads it, never runs it)</button><button type="button" class="btn sm" data-act="exp" data-f="code">Save the file</button></div>${t}
        ${approveBox("Approve means it passed your test and is ready for you to deploy yourself. Meldmind does not deploy it from here.")}`;
    },
    game() {
      return `<table class="fz-tbl"><thead><tr><th style="width:24%">Name</th><th>Kind</th><th>Health</th><th>Attack</th><th>Speed</th><th style="width:36px"></th></tr></thead><tbody>${cur.data.items.map((it, i) => `<tr><td><input type="text" data-r="${i}" data-f="name" value="${esc(it.name)}" aria-label="Name"></td><td><select data-r="${i}" data-f="type" aria-label="Kind">${GAME_TYPES.map((t) => `<option ${t === it.type ? "selected" : ""}>${t}</option>`).join("")}</select></td>${["hp", "attack", "speed"].map((f) => `<td><input type="text" data-r="${i}" data-f="${f}" value="${esc(it[f])}" aria-label="${f}"></td>`).join("")}<td><button type="button" class="ghost small" data-act="gmdel" data-i="${i}" aria-label="Remove item">x</button></td></tr><tr><td colspan="6"><input type="text" data-r="${i}" data-f="description" value="${esc(it.description)}" placeholder="What it is" aria-label="Description"></td></tr>`).join("")}</tbody></table>
        ${(cur.problems || []).length ? `<ul class="small fz-bad">${cur.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
        <div class="fz-row"><button type="button" class="btn sm" data-act="gmadd">Add an item</button><button type="button" class="btn sm" data-act="gmsave">Save</button><button type="button" class="btn sm" data-act="exp" data-f="json">Save as data file</button></div>
        ${approveBox("Approve when the list has no problems.")}`;
    },
  };

  function drawEditor() {
    card.innerHTML = `<h3>Finish editors</h3>${head()}<div id="fz-body">${EDITORS[cur.kind]()}</div>`;
  }

  // Read the open editor's fields back into rows. A row that gets no fields is dropped.
  const readTable = (shape) => {
    const rows = [];
    card.querySelectorAll("[data-r]").forEach((el) => { const i = +el.dataset.r; rows[i] = rows[i] || {}; rows[i][el.dataset.f] = el.value; });
    return rows.filter(Boolean).map(shape);
  };
  const slidesNow = () => readTable((r) => ({ ...r, bullets: String(r.bullets || "").split(/\r?\n/) }));
  async function saveAutomation() {
    const cron = card.querySelector("#fz-cron").value.trim();
    await save({ steps: card.querySelector("#fz-steps").value.split(/\r?\n/).filter((x) => x.trim()).map((text) => ({ text })), when: cron ? { type: "cron", cron } : { type: "manual" }, capUsd: num(card.querySelector("#fz-cap")) || 1 });
  }
  async function moveSlide(i, d) {
    const s = slidesNow();
    [s[i], s[i + d]] = [s[i + d], s[i]];
    await save({ theme: card.querySelector("#fz-theme").value, slides: s });
    drawEditor();
  }
  const post = async (name, body = {}) => { cur = await api(`/finishers/items/${cur.id}/${name}`, { method: "POST", body }); drawEditor(); };
  const actions = {
    new: async () => { cur = await api("/finishers/items", { method: "POST", body: { kind: card.querySelector("#fz-kind").value, title: card.querySelector("#fz-title").value } }); drawEditor(); },
    open: (b) => open(b.dataset.id),
    del: async (b) => { await api("/finishers/items/" + b.dataset.id, { method: "DELETE" }); await loadList(); drawList(); },
    back: async () => { await loadList(); drawList(); },
    approve: () => post("approve", { confirmed: true }),
    unapprove: () => post("unapprove"),
    test: async () => { if (cur.kind === "automation") await saveAutomation(); else if (cur.kind === "program") await save({ language: card.querySelector("#fz-lang").value, code: card.querySelector("#fz-code").value }); await post("test"); },
    exp: (b) => exportAs(b.dataset.f),
    sec: async (b) => { const i = b.dataset.i; await post("section", { index: +i, title: card.querySelector(`[data-f=title][data-i="${i}"]`).value, text: card.querySelector(`[data-f=text][data-i="${i}"]`).value }); },
    rowadd: async () => { await save({ ...cur.data, rows: [...cur.data.rows, { description: "", qty: 1, price: 0 }] }); drawEditor(); },
    rowdel: async (b) => { await save({ ...cur.data, rows: cur.data.rows.filter((_, i) => i !== +b.dataset.i) }); drawEditor(); },
    acsave: async () => { await save({ ...cur.data, party: card.querySelector("#fz-party").value, taxRate: num(card.querySelector("#fz-tax")), rows: readTable((r) => r) }); drawEditor(); },
    aused: async () => { await saveAutomation(); drawEditor(); },
    sched: async () => { await saveAutomation(); await post("schedule", { cron: card.querySelector("#fz-cron").value }); },
    activate: () => post("activate", { confirmed: true }),
    deact: () => post("deactivate"),
    trkadd: async () => { await save({ ...cur.data, tracks: [...cur.data.tracks, { name: "Track", start: 0, length: 30, volume: 100, fadeIn: 0, fadeOut: 0 }] }); drawEditor(); },
    trkdel: async (b) => { await save({ ...cur.data, tracks: cur.data.tracks.filter((_, i) => i !== +b.dataset.i) }); drawEditor(); },
    musave: async () => { await save({ tracks: readTable((r) => r), notes: card.querySelector("#fz-mnotes").value }); drawEditor(); },
    slsave: async () => { await save({ theme: card.querySelector("#fz-theme").value, slides: slidesNow() }); drawEditor(); },
    sladd: async () => { await save({ theme: card.querySelector("#fz-theme").value, slides: [...slidesNow(), { title: "New slide", bullets: [], notes: "" }] }); drawEditor(); },
    sldel: async (b) => { await save({ theme: card.querySelector("#fz-theme").value, slides: slidesNow().filter((_, i) => i !== +b.dataset.i) }); drawEditor(); },
    slup: (b) => moveSlide(+b.dataset.i, -1),
    sldn: (b) => moveSlide(+b.dataset.i, 1),
    pgsave: async () => { await save({ language: card.querySelector("#fz-lang").value, code: card.querySelector("#fz-code").value }); drawEditor(); },
    gmadd: async () => { await save({ items: [...readTable((r) => r), { name: "New item", type: "item", description: "", hp: 0, attack: 0, speed: 0 }] }); drawEditor(); },
    gmdel: async (b) => { await save({ items: readTable((r) => r).filter((_, i) => i !== +b.dataset.i) }); drawEditor(); },
    gmsave: async () => { await save({ items: readTable((r) => r) }); drawEditor(); },
  };
  const said = { approve: "Approved.", activate: "Turned on.", deact: "Turned off.", test: "Test finished.", acsave: "Saved.", aused: "Saved.", musave: "Saved.", slsave: "Saved.", pgsave: "Saved.", gmsave: "Saved.", sec: "Section saved.", sched: "Repeat saved.", exp: "File saved to your downloads." };
  card.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b || b.type === "checkbox" || !card.contains(b)) return;
    const fn = actions[b.dataset.act];
    if (fn) act(() => fn(b), said[b.dataset.act]);
  });
  card.addEventListener("change", (ev) => {
    const b = ev.target;
    if (b.dataset?.act !== "claim") return;
    act(async () => {
      const c = cur.claims[+b.dataset.n];
      const set = new Set(cur.data.checked);
      if (b.checked) set.add(c); else set.delete(c);
      await save({ ...cur.data, checked: [...set] });
      drawEditor();
    });
  });

  act(async () => { await loadList(); drawList(); });
}

CC.mountFinishers = mountFinishers;
CC.register({ id: "finishers" });
