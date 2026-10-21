// Remix. One path: what to make, a starting point, preview, Build, Test, Publish.
// Extra choices stay under More options. Nothing runs until the main button is pressed.
const { api, toast, esc } = window.CC;

const SCRATCH_NOTE = "Remix rebuilds from scratch. It does not copy the app or game you show. It does not decompile, extract, or reuse that app's code, assets, names, or brand.";
const STEPS = ["make", "start", "preview", "built", "tested", "published"];
const TITLES = {
  make: "What do you want to make?",
  start: "Choose a starting point",
  preview: "Preview who receives this",
  built: "Build",
  tested: "Publish",
  published: "Saved",
};
const TIPS = {
  make: "Use your own name. Remix does not keep the other name.",
  start: "Pick one. You can add more later under More options.",
  preview: "Nothing is sent until you press Build. Rebuild from scratch.",
  built: "Your project is on this computer. Test it before you share it.",
  tested: "Nothing is posted until you press Publish. A token is stored with your keys.",
  published: "You can start another one.",
};
const BUTTONS = { make: "Next", start: "Next", preview: "Build", built: "Test", tested: "Publish", published: "Make another" };

let info = null;
let step = "make";
let preview = null;
let previewKey = "";
let picksTouched = false;
let built = null;
let tested = null;
let published = null;

function fieldValue(root, id) {
  return root.querySelector(id)?.value?.trim() || "";
}
function selected(root, name) {
  return root.querySelector(`input[name='${name}']:checked`)?.value || "";
}
function allowed(id) {
  const row = (info?.parts || []).find((p) => p.id === id);
  return row ? !!row.allowed : false;
}
function sourceFor(start) {
  if (start === "recording") return "recording";
  if (start === "desktop") return "desktop";
  return "screenshots";
}
function payload(root) {
  const idea = fieldValue(root, "#remix-idea");
  const start = selected(root, "remix-start");
  const artName = fieldValue(root, "#remix-art-file");
  const blendName = fieldValue(root, "#remix-blend-name");
  return {
    source: sourceFor(start),
    start,
    url: "",
    looks: fieldValue(root, "#remix-looks") || idea,
    plays: fieldValue(root, "#remix-plays") || (start === "recording" ? idea : ""),
    works: fieldValue(root, "#remix-works"),
    appType: fieldValue(root, "#remix-type") || "app",
    originalName: fieldValue(root, "#remix-original"),
    originalCharacters: fieldValue(root, "#remix-original-characters"),
    originalLook: fieldValue(root, "#remix-original-look"),
    own: {
      name: fieldValue(root, "#remix-name"),
      characters: fieldValue(root, "#remix-characters"),
      look: fieldValue(root, "#remix-own-look"),
      ideas: fieldValue(root, "#remix-ideas") || idea,
      art: fieldValue(root, "#remix-art"),
    },
    engineId: fieldValue(root, "#remix-engine"),
    packIds: [...root.querySelectorAll("input[name='remix-pack']:checked")].map((el) => el.value),
    modId: fieldValue(root, "#remix-mod"),
    pulls: [],
    designText: fieldValue(root, "#remix-design"),
    usePhaser: !!root.querySelector("#remix-phaser")?.checked,
    useBevy: !!root.querySelector("#remix-bevy")?.checked,
    levels: !!root.querySelector("#remix-levels")?.checked,
    voice: fieldValue(root, "#remix-voice"),
    styleOnly: !!root.querySelector("#remix-style")?.checked,
    fork: !!root.querySelector("#remix-fork")?.checked,
    multiplayer: !!root.querySelector("#remix-online")?.checked,
    installer: fieldValue(root, "#remix-installer"),
    blend: blendName ? { name: blendName, looks: fieldValue(root, "#remix-blend-looks"), ideas: "" } : null,
    artFiles: artName ? [{ name: artName, source: fieldValue(root, "#remix-art-source") || "kenney", license: "CC0" }] : [],
  };
}
function formKey(body) {
  return JSON.stringify(body);
}
function applyStartDefaults(root) {
  if (picksTouched) return;
  const start = selected(root, "remix-start");
  const type = root.querySelector("#remix-type");
  const engine = root.querySelector("#remix-engine");
  if (start === "game" && type) type.value = "game";
  const kind = type?.value || "app";
  if (engine) engine.value = kind === "game" ? "godot" : "scratch-page";
  root.querySelectorAll("input[name='remix-pack']").forEach((el) => { el.checked = kind === "game" && el.value === "kenney-cc0"; });
}

function choice(name, value, label, detail, extra) {
  return `<label class="remix-choice"><input type="radio" name="${name}" value="${esc(value)}" ${extra || ""}><span><b>${esc(label)}</b><span class="dim small">${esc(detail)}</span></span></label>`;
}

function shell(gate) {
  const engines = (info?.catalog || []).filter((c) => c.kind === "engine" || c.kind === "template");
  const packs = (info?.catalog || []).filter((c) => c.kind === "art");
  const mods = info?.mods || [];
  const extreme = (id) => allowed(id) ? "" : "disabled";
  const extremeNote = (id) => allowed(id) ? "" : " On Extreme.";
  return `<div id="remix-root" class="remix-flow" data-step="make">
    <style>
      .remix-flow { max-width: 640px; margin: 0 auto; }
      .remix-flow h3 { margin: 8px 0; }
      .remix-choice { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line-2); border-radius: 12px; padding: 10px 12px; margin: 8px 0; }
      .remix-choice span { display: flex; flex-direction: column; gap: 2px; }
      .remix-choice input { margin-top: 4px; }
      #remix-next { min-width: 148px; }
      @media (max-width: 640px) { #remix-next, #remix-back { width: 100%; } .remix-actions { flex-direction: column; align-items: stretch; } }
    </style>
    <div class="panel">
      <p class="small" id="remix-note" style="margin-top:0">${esc(SCRATCH_NOTE)}</p>
      <p class="dim small" id="remix-gate" style="margin:0">${esc(gate?.message || "")}</p>
      <p class="dim small" id="remix-progress" style="margin:8px 0 0"></p>
      <h3 id="remix-title"></h3>
      <p class="small" id="remix-tip"></p>
      <form id="remix-form">
        <section data-step="make">
          <label class="lbl" for="remix-name">Your name for it</label>
          <input id="remix-name" type="text" maxlength="80" autocomplete="off" style="width:100%" placeholder="Your title">
          <label class="lbl" for="remix-idea">In one sentence</label>
          <textarea id="remix-idea" style="min-height:72px;width:100%" placeholder="What it is, in your own words"></textarea>
          <div class="lbl">What kind is it?</div>
          ${choice("remix-kind", "app", "An app", "A screen people use.", "checked")}
          ${choice("remix-kind", "game", "A game", "Something people play.")}
          ${choice("remix-kind", "tool", "A tool", "Something that does one job.")}
        </section>
        <section data-step="start" hidden>
          ${choice("remix-start", "screenshot", "A screenshot", "A picture of a screen becomes a new layout.")}
          ${choice("remix-start", "recording", "A recording", `A recording becomes a clickable preview.${extremeNote("recording-prototype")}`, extreme("recording-prototype"))}
          ${choice("remix-start", "design", "Your design file", "Bring in a design you made.")}
          ${choice("remix-start", "game", "A game type", "Start from a game shape, then make it yours.")}
          ${choice("remix-start", "description", "A description", "Use the sentence you already wrote.")}
          <div id="remix-design-box" hidden>
            <label class="lbl" for="remix-design">Paste your design</label>
            <textarea id="remix-design" style="min-height:64px;width:100%" placeholder="SVG from your design file. Penpot is not included."></textarea>
          </div>
        </section>
        <section data-step="preview" hidden>
          <div id="remix-preview" aria-live="polite"></div>
          <label class="small" id="remix-ack-row" hidden style="margin-top:8px"><input type="checkbox" id="remix-ack"> I have read the warning. This still rebuilds from scratch.</label>
        </section>
        <section data-step="built" hidden><div id="remix-built" aria-live="polite"></div></section>
        <section data-step="tested" hidden>
          <div id="remix-tested" aria-live="polite"></div>
          <div class="lbl">Where should it go?</div>
          ${choice("remix-publish", "computer", "This computer", "The usual choice. Nothing is posted.", "checked")}
          ${choice("remix-publish", "vercel", "A website", "Uses your website token.")}
          ${choice("remix-publish", "itch", "itch.io", "Uses your itch.io token.")}
          ${choice("remix-publish", "phone", "A phone app", `This is an Extreme choice.${extremeNote("publish-phone")}`, extreme("publish-phone"))}
          <label class="lbl" for="remix-token">Token, if this place asks for one</label>
          <input id="remix-token" type="password" autocomplete="off" style="width:100%" placeholder="Stored with your keys. Not shown again.">
        </section>
        <section data-step="published" hidden><div id="remix-published" aria-live="polite"></div></section>
        <details id="remix-more" style="margin-top:12px">
          <summary>More options</summary>
          <label class="lbl" for="remix-type">Kind</label>
          <select id="remix-type" style="width:100%"><option value="app">An app</option><option value="game">A game</option><option value="tool">A tool</option></select>
          <label class="lbl" for="remix-looks">How it looks</label>
          <textarea id="remix-looks" style="min-height:56px;width:100%"></textarea>
          <label class="lbl" for="remix-plays">How it plays</label>
          <textarea id="remix-plays" style="min-height:56px;width:100%"></textarea>
          <label class="lbl" for="remix-works">How it works</label>
          <textarea id="remix-works" style="min-height:56px;width:100%"></textarea>
          <label class="lbl" for="remix-characters">Your characters</label>
          <input id="remix-characters" type="text" maxlength="500" autocomplete="off" style="width:100%">
          <label class="lbl" for="remix-own-look">Your look</label>
          <input id="remix-own-look" type="text" maxlength="500" autocomplete="off" style="width:100%">
          <label class="lbl" for="remix-ideas">Your ideas</label>
          <textarea id="remix-ideas" style="min-height:56px;width:100%"></textarea>
          <label class="lbl" for="remix-art">Your art</label>
          <input id="remix-art" type="text" maxlength="500" autocomplete="off" style="width:100%" placeholder="Sketches you made. Not taken from the other app.">
          <label class="lbl" for="remix-engine">Starter</label>
          <select id="remix-engine" style="width:100%">${engines.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}<option value="none">No outside starter</option></select>
          <div class="lbl">Free art</div>
          ${packs.map((c) => `<label class="small" style="display:block;margin:4px 0"><input type="checkbox" name="remix-pack" value="${esc(c.id)}"> ${esc(c.name)}</label>`).join("")}
          <label class="lbl" for="remix-art-file">One art file to check</label>
          <input id="remix-art-file" type="text" maxlength="120" autocomplete="off" style="width:100%" placeholder="File name only">
          <label class="lbl" for="remix-art-source">Where that file is from</label>
          <select id="remix-art-source" style="width:100%"><option value="kenney">Kenney</option><option value="opengameart">OpenGameArt</option></select>
          <p class="dim small">Only CC0 files are kept. Downloads wait until you approve them.</p>
          <button type="button" class="btn sm" id="remix-approve-art">Approve art</button>
          <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="remix-phaser" ${extreme("phaser-create")}> Browser game starter. It is not included. Its license is not confirmed.</label>
          <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="remix-bevy" ${extreme("bevy-starter")}> Desktop game starter.${extremeNote("bevy-starter")}</label>
          <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="remix-levels" ${extreme("level-maker")}> Make new levels.${extremeNote("level-maker")}</label>
          <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="remix-online" ${extreme("multiplayer")}> Play together.${extremeNote("multiplayer")}</label>
          <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="remix-style"> Colors and type only.</label>
          <label class="small" style="display:block;margin:8px 0"><input type="checkbox" id="remix-fork" checked> Save a version on this computer.</label>
          <label class="lbl" for="remix-voice">Voice</label>
          <select id="remix-voice" style="width:100%" ${extreme("voices")}><option value="">No voice</option><option value="piper">Piper, as its own program</option><option value="coqui">Coqui, as its own program</option></select>
          <button type="button" class="btn sm" id="remix-approve-voice">Approve voice</button>
          <label class="lbl" for="remix-installer">Installer</label>
          <select id="remix-installer" style="width:100%" ${extreme("installer")}><option value="">No installer</option><option value="tauri">Desktop installer</option><option value="electron">Another desktop installer</option></select>
          <label class="lbl" for="remix-blend-name">A second idea</label>
          <input id="remix-blend-name" type="text" maxlength="80" autocomplete="off" style="width:100%" placeholder="Only if you want two ideas in one new project" ${extreme("blend")}>
          <textarea id="remix-blend-looks" style="min-height:48px;width:100%" placeholder="What the second idea looks like"></textarea>
          <label class="lbl" for="remix-mod">Official mod tool</label>
          <select id="remix-mod" style="width:100%"><option value="">No mod. Build a new project.</option>${mods.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select>
          <p class="dim small" id="remix-mod-note"></p>
          <label class="lbl" for="remix-original">Name of what you showed</label>
          <input id="remix-original" type="text" maxlength="80" autocomplete="off" style="width:100%" placeholder="Used only to warn you. It is not saved.">
          <label class="lbl" for="remix-original-characters">Their characters</label>
          <input id="remix-original-characters" type="text" maxlength="300" autocomplete="off" style="width:100%">
          <label class="lbl" for="remix-original-look">Their look and layout</label>
          <input id="remix-original-look" type="text" maxlength="500" autocomplete="off" style="width:100%">
          <div id="remix-past" style="margin-top:10px"></div>
        </details>
        <div class="row remix-actions" style="margin-top:12px">
          <button type="button" class="btn sm" id="remix-back" hidden>Back</button>
          <button type="button" class="btn primary" id="remix-next">Next</button>
        </div>
      </form>
    </div>
  </div>`;
}

function previewHtml(data) {
  const who = data.recipients || { ais: [], services: [], withheld: [] };
  const ais = who.ais?.length
    ? who.ais.map((a) => `<li><b>${esc(a.providerName)}</b> ${esc(a.name)}</li>`).join("")
    : "<li>No AI is connected. Nothing will be sent. The project can still be saved here.</li>";
  const used = (data.pieces || []).map((p) => `<li>${esc(p.name)}</li>`).join("") || "<li>No outside piece was added.</li>";
  const dropped = (data.rejected || []).map((p) => `<li>${esc(p.name)}: ${esc(p.reason)}</li>`).join("");
  const warnings = (data.closeness?.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
  const block = data.abilityGate && data.abilityGate.ok === false ? `<p class="small">${esc(data.abilityGate.message || "")}</p>` : "";
  return `${block}<p class="small">${esc(data.gate?.message || "")}</p>
    <div class="lbl">Who will see your words</div><ul class="small">${ais}</ul>
    <div class="lbl">Not sent</div><ul class="small">${(who.withheld || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <div class="lbl">Pieces that passed</div><ul class="small">${used}</ul>
    ${dropped ? `<div class="lbl">Not used</div><ul class="small">${dropped}</ul>` : ""}
    ${warnings ? `<div class="lbl">Too close</div><ul class="small">${warnings}</ul>` : ""}
    <details><summary class="small">Credits</summary><pre class="small" style="white-space:pre-wrap">${esc(data.creditsText || "")}</pre></details>`;
}

function pastHtml() {
  const runs = info?.runs || [];
  if (!runs.length) return `<div class="dim small">Ratings stay on this computer and teach the next remix.</div>`;
  return `<div class="lbl">What worked before</div>` + runs.slice(0, 6).map((r) => `<div class="row small" style="gap:6px;margin-top:6px"><span>${esc(r.appType)}</span>
    <button type="button" class="btn sm" data-rate="${esc(r.id)}" data-up="1">Worked</button>
    <button type="button" class="btn sm" data-rate="${esc(r.id)}" data-up="0">Needs work</button></div>`).join("");
}

function paint(root) {
  const title = root.querySelector("#remix-title");
  const tip = root.querySelector("#remix-tip");
  const btn = root.querySelector("#remix-next");
  const back = root.querySelector("#remix-back");
  const progress = root.querySelector("#remix-progress");
  const n = STEPS.indexOf(step) + 1;
  if (title) title.textContent = TITLES[step];
  if (tip) tip.textContent = TIPS[step];
  if (progress) progress.textContent = `Step ${n} of 6. Make, Start, Preview, Build, Test, Publish.`;
  root.dataset.step = step;
  root.querySelectorAll("section[data-step]").forEach((el) => { el.hidden = el.dataset.step !== step; });
  const more = root.querySelector("#remix-more");
  if (more) more.hidden = step === "built" || step === "tested" || step === "published";
  if (back) back.hidden = step === "make" || step === "published";
  const dirty = step === "preview" && (!preview || previewKey !== formKey(payload(root)));
  if (btn) {
    btn.textContent = dirty ? "Update preview" : BUTTONS[step];
    const blockedGate = preview && preview.gate && preview.gate.ok === false;
    const blockedAbility = preview && preview.abilityGate && preview.abilityGate.ok === false;
    const needsAck = !!preview?.closeness?.close && !root.querySelector("#remix-ack")?.checked;
    btn.disabled = step === "preview" && !dirty && (!preview || blockedGate || blockedAbility || needsAck);
  }
  const ack = root.querySelector("#remix-ack-row");
  if (ack) {
    const show = step === "preview" && !!preview?.closeness?.close;
    ack.hidden = !show;
  }
}

async function loadPreview(root) {
  const body = payload(root);
  if (!body.own.name) return toast("Give it your own name.", true);
  if (!body.looks && !body.plays && !body.works) return toast("Say what you want to make.", true);
  if (!body.start) return toast("Choose a starting point.", true);
  try {
    preview = await api("/remix/preview", { method: "POST", body });
    previewKey = formKey(body);
    const box = root.querySelector("#remix-preview");
    if (box) box.innerHTML = previewHtml(preview);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function build(root) {
  const body = payload(root);
  if (formKey(body) !== previewKey) return toast("Look at the preview again before you build.", true);
  try {
    built = await api("/remix/run", { method: "POST", body: { ...body, confirm: true, acknowledgeClose: !!root.querySelector("#remix-ack")?.checked } });
    const box = root.querySelector("#remix-built");
    if (box) box.innerHTML = `<p><b>${esc(built.projectName || "Project")}</b> is saved on this computer.</p><p class="small">${esc(built.ai?.reason || "")}</p>`;
    step = "built";
    info = await api("/remix");
    const past = root.querySelector("#remix-past");
    if (past) past.innerHTML = pastHtml();
    wirePast(root);
    toast("Saved on this computer.");
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function runTest(root) {
  try {
    tested = await api("/remix/test", { method: "POST", body: { confirm: true, projectId: built?.projectId || "" } });
    const box = root.querySelector("#remix-tested");
    const grade = tested.report?.grade || "Ready";
    const checks = (tested.report?.checks || []).map((c) => `<li>${esc(c.name)}: ${c.ok ? "OK" : "Needs a look"}</li>`).join("");
    if (box) box.innerHTML = `<p><b>${esc(tested.report?.title || "Can people use it?")}</b> ${esc(grade)}</p><ul class="small">${checks}</ul><p class="dim small">The extra checkers were not started. Nothing was downloaded.</p>`;
    step = "tested";
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function publish(root) {
  const target = selected(root, "remix-publish") || "computer";
  const token = fieldValue(root, "#remix-token");
  try {
    published = await api("/remix/publish", { method: "POST", body: { confirm: true, target, projectId: built?.projectId || "", token } });
    const tokenBox = root.querySelector("#remix-token");
    if (tokenBox) tokenBox.value = "";
    const box = root.querySelector("#remix-published");
    if (box) box.innerHTML = `<p>${esc(published.message || "Nothing was posted.")}</p>`;
    step = "published";
    toast("Nothing was posted.");
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function loadRate(root, id, up) {
  try {
    await api("/remix/rate", { method: "POST", body: { id, up, fix: !up } });
    info = await api("/remix");
    const past = root.querySelector("#remix-past");
    if (past) past.innerHTML = pastHtml();
    wirePast(root);
    toast(up ? "Saved. The next remix can start from this." : "Saved. The next remix will try a different fit.");
  } catch (e) { toast(e.message, true); }
}
function wirePast(root) {
  root.querySelectorAll("[data-rate]").forEach((btn) => btn.addEventListener("click", () => loadRate(root, btn.dataset.rate, btn.dataset.up === "1")));
}

async function onNext(root) {
  if (step === "make") {
    const kind = selected(root, "remix-kind") || "app";
    const type = root.querySelector("#remix-type");
    if (type && !picksTouched) type.value = kind;
    if (!fieldValue(root, "#remix-name")) return toast("Give it your own name.", true);
    if (!fieldValue(root, "#remix-idea") && !fieldValue(root, "#remix-looks")) return toast("Say what you want to make.", true);
    step = "start";
  } else if (step === "start") {
    if (!selected(root, "remix-start")) return toast("Choose a starting point.", true);
    applyStartDefaults(root);
    step = "preview";
    const ok = await loadPreview(root);
    if (!ok) step = "start";
  } else if (step === "preview") {
    const dirty = previewKey !== formKey(payload(root));
    if (dirty) await loadPreview(root);
    else {
      const ok = await build(root);
      if (!ok) return paint(root);
    }
  } else if (step === "built") {
    const ok = await runTest(root);
    if (!ok) return paint(root);
  } else if (step === "tested") {
    const ok = await publish(root);
    if (!ok) return paint(root);
  } else {
    step = "make";
    preview = null;
    previewKey = "";
    built = null;
    tested = null;
    published = null;
    picksTouched = false;
  }
  paint(root);
}

async function render(view) {
  view.innerHTML = `<div id="remix-root"><div class="panel"><p class="small" id="remix-note">${esc(SCRATCH_NOTE)}</p><p class="dim small">Loading Remix.</p></div></div>`;
  try { info = await api("/remix"); } catch (e) { toast(e.message, true); info = null; }
  step = "make";
  preview = null;
  previewKey = "";
  picksTouched = false;
  built = null;
  tested = null;
  published = null;
  view.innerHTML = shell(info?.gate);
  const root = view.querySelector("#remix-root");
  const past = root.querySelector("#remix-past");
  if (past) past.innerHTML = pastHtml();
  wirePast(root);
  const engine = root.querySelector("#remix-engine");
  if (engine) engine.value = "scratch-page";
  paint(root);
  root.querySelector("#remix-form").addEventListener("submit", (e) => e.preventDefault());
  root.querySelector("#remix-form").addEventListener("input", (e) => {
    if (e.target?.id === "remix-engine" || e.target?.name === "remix-pack" || e.target?.id === "remix-phaser") picksTouched = true;
    if (e.target?.name === "remix-kind") {
      const type = root.querySelector("#remix-type");
      if (type && !picksTouched) type.value = e.target.value;
    }
    if (step === "preview" && e.target?.id !== "remix-ack") previewKey = "";
    paint(root);
  });
  root.querySelector("#remix-form").addEventListener("change", (e) => {
    if (e.target?.name === "remix-start") {
      const box = root.querySelector("#remix-design-box");
      if (box) box.hidden = e.target.value !== "design";
    }
    if (e.target?.id === "remix-mod") {
      const mod = info?.mods?.find((m) => m.id === fieldValue(root, "#remix-mod"));
      const note = root.querySelector("#remix-mod-note");
      if (note) note.textContent = mod?.note || "";
    }
    if (step === "preview" && e.target?.id !== "remix-ack") previewKey = "";
    paint(root);
  });
  root.querySelector("#remix-back").addEventListener("click", () => {
    const i = STEPS.indexOf(step);
    if (i > 0 && step !== "published") step = STEPS[i - 1];
    paint(root);
  });
  root.querySelector("#remix-next").addEventListener("click", () => onNext(root));
  root.querySelector("#remix-approve-art").addEventListener("click", async () => {
    const body = payload(root);
    try {
      const out = await api("/remix/media", { method: "POST", body: { confirm: true, files: body.artFiles } });
      toast(out.message || "Approved. Nothing was downloaded.");
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#remix-approve-voice").addEventListener("click", async () => {
    const kind = fieldValue(root, "#remix-voice");
    if (!kind) return toast("Choose a voice first.", true);
    try {
      const out = await api("/remix/voice", { method: "POST", body: { confirm: true, kind } });
      toast(out.message || "Approved. Nothing was started.");
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#remix-name")?.focus();
}

CC.register({
  id: "remix",
  tab: { label: "Remix", short: "Remix", icon: "✦", order: 24, render },
});
