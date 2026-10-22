// Builders hub. Suggested builders come from the server. Show all reveals the rest.
// One main button walks Describe, Preview the AIs, Build, Test, and Publish.
const { api, toast, esc, go } = window.CC;

const NEXT = {
  describe: "Preview the AIs",
  preview: "Build",
  build: "Test",
  test: "Publish",
  done: "Start again",
};
const RAIL = [
  ["describe", "Describe"],
  ["preview", "Preview the AIs"],
  ["build", "Build"],
  ["test", "Test"],
  ["publish", "Publish"],
];
const TIER = { free: "Free", pro: "Pro", extreme: "Extreme" };
const REGULATED_IDS = new Set(["ad-copy", "social-calendar", "reel-maker"]);

const css = `
.bd-wrap { display: flex; flex-direction: column; gap: 12px; max-width: 980px; }
.bd-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
.bd-card, .bd-suggest { text-align: left; background: #0e1726; border: 1px solid var(--line); border-radius: 12px; padding: 12px; color: var(--text); cursor: pointer; }
.bd-card:hover, .bd-card:focus, .bd-suggest:hover, .bd-suggest:focus { border-color: var(--accent); outline: none; }
.bd-card h4, .bd-suggest h4 { margin: 0 0 4px; font-size: 15px; }
.bd-rail { display: flex; flex-wrap: wrap; gap: 6px; }
.bd-rail span { font-size: 12px; color: var(--dim); padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); }
.bd-rail span.on { color: var(--text); border-color: var(--accent); }
.bd-rail span.done { color: var(--muted); }
.bd-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 340px); gap: 12px; }
.bd-issue { padding: 8px 0; border-bottom: 1px solid var(--line); }
.bd-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#bd-form textarea, #bd-form input[type="text"], #bd-form input[type="password"], #bd-form input[type="number"], #bd-form select { width: 100%; }
@media (max-width: 720px) {
  .bd-grid { grid-template-columns: 1fr; }
  #bd-go, #bd-suggest-go { width: 100%; }
}
`;
if (!document.getElementById("bd-style")) {
  const style = document.createElement("style");
  style.id = "bd-style";
  style.textContent = css;
  document.head.appendChild(style);
}

// The words of a built page (or ad copy) for Test with personas: tags, styles and scripts left out.
function pageText(artifact) {
  if (!artifact) return "";
  const html = artifact.html || (artifact.pages || []).map((p) => p.html || "").join("\n\n");
  const plain = String(html || "").replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  if (plain) return plain.slice(0, 20000);
  return Object.values(artifact).filter((v) => typeof v === "string").join("\n\n").slice(0, 20000);
}

function tierName(tier) {
  return TIER[tier] || tier || "";
}

function phraseHit(text, phrase) {
  const t = String(text || "").toLowerCase();
  const p = String(phrase || "").toLowerCase();
  if (!p || !t) return false;
  if (p.includes(" ")) return t.includes(p);
  return new RegExp(`(?:^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i").test(t);
}

function fieldHtml(field, defaults) {
  const value = defaults?.[field.id] ?? "";
  const id = `bd-${field.id}`;
  if (field.type === "textarea") {
    return `<label class="lbl" for="${id}">${esc(field.label)}</label><textarea id="${id}" data-field="${esc(field.id)}" placeholder="${esc(field.placeholder || "")}">${esc(String(value || ""))}</textarea>`;
  }
  if (field.type === "checkbox") {
    return `<label class="small" style="display:block;margin:6px 0"><input type="checkbox" id="${id}" data-field="${esc(field.id)}"> ${esc(field.label)}</label>`;
  }
  if (field.type === "select") {
    const options = (field.options || []).map((option) => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("");
    return `<label class="lbl" for="${id}">${esc(field.label)}</label><select id="${id}" data-field="${esc(field.id)}">${options}</select>`;
  }
  if (field.type === "password") {
    return `<label class="lbl" for="${id}">${esc(field.label)}</label><input id="${id}" data-connect="token" type="password" autocomplete="off" placeholder="${esc(field.placeholder || "")}">`;
  }
  const type = field.type === "number" ? "number" : "text";
  return `<label class="lbl" for="${id}">${esc(field.label)}</label><input id="${id}" data-field="${esc(field.id)}" type="${type}" value="${esc(String(value ?? ""))}" placeholder="${esc(field.placeholder || "")}">`;
}

function cardHtml(row) {
  return `<button type="button" class="bd-card" data-open="${esc(row.id)}">
    <h4>${esc(row.title)}</h4>
    <div class="dim small">${esc(tierName(row.tier))}</div>
    <p class="small" style="margin:6px 0">${esc(row.summary)}</p>
    ${row.reason ? `<div class="dim small">${esc(row.reason)}</div>` : ""}
  </button>`;
}

function shell() {
  return `<div id="webbuilders-root" class="bd-wrap">
    <div id="bd-hub">
      <div class="panel">
        <h3 style="margin-top:0">Builders</h3>
        <p class="small" style="margin:0 0 8px">Describe what you want, preview which AIs would help, then build, test, and publish. Nothing is sent until you click the button.</p>
        <label class="lbl" for="bd-notice">What are you working on?</label>
        <div class="bd-actions">
          <input id="bd-notice" type="text" autocomplete="off" placeholder="A website, posts, a reel, or an ad" style="flex:1;min-width:180px">
          <button type="button" class="btn sm primary" id="bd-suggest-go">Suggest builders</button>
          <button type="button" class="btn sm" id="bd-show-all">Show all</button>
        </div>
      </div>
      <div class="panel" id="bd-suggested-panel">
        <h3 style="margin-top:0">Suggested for you</h3>
        <div id="bd-suggested" class="dim small">Looking...</div>
      </div>
      <div class="panel" id="bd-all-panel" hidden>
        <h3 style="margin-top:0">All builders</h3>
        <div id="bd-all"></div>
      </div>
    </div>
    <div id="bd-flow" hidden>
      <div class="bd-actions"><button type="button" class="btn sm" id="bd-back">All builders</button></div>
      <div class="bd-rail" id="bd-rail"></div>
      <div class="bd-grid">
        <form id="bd-form" class="panel"></form>
        <div>
          <div class="panel" id="bd-side" aria-live="polite"></div>
          <p class="dim small" id="bd-wait" style="margin:8px 0 0">Nothing is sent until you click Publish.</p>
          <div class="bd-actions" style="margin-top:8px"><button type="button" class="btn primary" id="bd-go">Preview the AIs</button></div>
        </div>
      </div>
    </div>
  </div>`;
}

function boot(view, openId) {
  const root = view.querySelector("#webbuilders-root") || view;
  let pack = null;
  let showAll = false;
  let current = null;
  let step = "describe";
  let preview = null;
  let draft = null;
  let publishNote = "";
  let serverRegulated = false;

  const hub = () => root.querySelector("#bd-hub");
  const flow = () => root.querySelector("#bd-flow");

  function textBlob() {
    const notice = root.querySelector("#bd-notice")?.value || "";
    const remembered = pack?.notice || "";
    const fields = [...root.querySelectorAll("[data-field]")].map((el) => el.value || "").join(" ");
    return `${fields} ${notice} ${remembered}`;
  }

  function needsBoxes() {
    if (!current || !REGULATED_IDS.has(current.builder.id)) return false;
    if (serverRegulated) return true;
    const words = pack?.regulatedWords || [];
    return words.some((word) => phraseHit(textBlob(), word));
  }

  function toggleBoxes() {
    const box = root.querySelector("#bd-boxes");
    if (box) box.hidden = !needsBoxes();
  }

  function payload() {
    const body = {};
    for (const el of root.querySelectorAll("[data-field]")) {
      body[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
    }
    body.compliance = {
      noPromises: !!root.querySelector("#bd-box-noPromises")?.checked,
      followLaws: !!root.querySelector("#bd-box-followLaws")?.checked,
      notAdvice: !!root.querySelector("#bd-box-notAdvice")?.checked,
    };
    return body;
  }

  async function saveConnection(body) {
    const token = root.querySelector("[data-connect='token']")?.value.trim() || "";
    const url = String(body.serviceUrl || "").trim();
    let service = "";
    if (current?.builder?.id === "social-calendar") service = "postiz";
    else if (current?.builder?.id === "email-sequences" && body.service && body.service !== "highlevel") service = body.service;
    else if (body.target === "netlify" || body.target === "vercel") service = body.target;
    if (!service) return;
    if ((service === "netlify" || service === "vercel") && !token) return;
    if (!token && !url) return;
    await api("/webbuilders/connect", { method: "POST", body: { service, token, url } });
    const field = root.querySelector("[data-connect='token']");
    if (field) field.value = "";
    toast(token ? "Connection saved. The token stays in the vault." : "Service address saved.");
  }

  function rail() {
    const order = RAIL.map(([id]) => id);
    const at = step === "done" ? order.length : order.indexOf(step);
    root.querySelector("#bd-rail").innerHTML = RAIL.map(([id, label], index) => {
      const cls = index < at || step === "done" ? "done" : index === at ? "on" : "";
      return `<span class="${cls}">${esc(label)}</span>`;
    }).join("");
  }

  function side() {
    const box = root.querySelector("#bd-side");
    if (step === "describe" || !preview) {
      box.innerHTML = `<h3 style="margin-top:0">Preview</h3><p class="dim small">The next click lists the AIs and the tools. Nothing runs yet.</p>`;
      return;
    }
    const who = preview.recipients || { ais: [], services: [] };
    const ais = who.ais.length
      ? who.ais.map((ai) => `<li><b>${esc(ai.providerName)}</b> ${esc(ai.name)}: ${esc(ai.receives)}</li>`).join("")
      : `<li>No AI is connected. The draft can still be built here.</li>`;
    const services = (who.services || []).map((row) => `<li><b>${esc(row.name)}</b> (${esc(row.license)}): ${esc(row.receives)}</li>`).join("");
    const issues = draft?.issues || [];
    const fixes = issues.map((issue) => `<div class="bd-issue"><b>${esc(issue.title)}</b><div class="dim small">${esc(issue.detail || "")}</div>${issue.fixable ? `<button type="button" class="btn sm" data-fix="${esc(issue.id)}">Fix it</button>` : ""}</div>`).join("");
    const scores = draft?.artifact?.scores;
    const scoreLine = scores ? `<p class="small">Page check: ${esc(String(scores.seo))} of 100. Lighthouse was not started.</p>` : "";
    const banner = preview.compliance?.banner && (needsBoxes() || preview.compliance.required) ? `<p class="small">${esc(preview.compliance.banner)}</p>` : "";
    box.innerHTML = `<h3 style="margin-top:0">${step === "describe" ? "Preview" : esc(NEXT[step] === "Start again" ? "Done" : "Preview")}</h3>
      ${banner}
      <p class="small">${esc(preview.note || "")}</p>
      <p class="small">${esc(preview.gate?.message || "")}</p>
      <div class="lbl">AIs</div><ul class="small">${ais}</ul>
      <div class="lbl">Tools</div><ul class="small">${services}</ul>
      ${scoreLine}
      ${fixes}
      ${publishNote ? `<p class="small">${esc(publishNote)}</p>` : ""}
      ${draft?.artifact ? `<div class="row small" id="bd-personas" style="margin-top:8px"></div>` : ""}`;
    // Test with personas: the panel reads the page's words and suggests fixes
    const pt = box.querySelector("#bd-personas");
    if (pt && window.CC.personaButton) pt.appendChild(window.CC.personaButton({ getText: () => pageText(draft?.artifact), kind: current?.builder?.id === "ad-copy" ? "post" : "page" }));
    box.querySelectorAll("[data-fix]").forEach((btn) => btn.addEventListener("click", () => onFix(btn.dataset.fix)));
  }

  function buttonLabel() {
    const btn = root.querySelector("#bd-go");
    const blocking = (draft?.issues || []).some((issue) => issue.blocking);
    btn.textContent = NEXT[step] || "Preview the AIs";
    btn.disabled = step === "test" && blocking;
  }

  function paintFlowBits() {
    rail();
    side();
    buttonLabel();
    toggleBoxes();
  }

  async function onFix(issueId) {
    try {
      const out = await api(`/webbuilders/${current.builder.id}/fix`, { method: "POST", body: { draftId: draft.id, issueId, confirm: true } });
      draft = out.draft;
      paintFlowBits();
      toast("Fixed on this computer.");
    } catch (e) { toast(e.message, true); }
  }

  async function onGo() {
    const btn = root.querySelector("#bd-go");
    btn.disabled = true;
    try {
      if (step === "done") {
        step = "describe";
        preview = null;
        draft = null;
        publishNote = "";
        paintFlowBits();
        return;
      }
      const body = payload();
      await saveConnection(body);
      if (step === "describe") {
        preview = await api(`/webbuilders/${current.builder.id}/preview`, { method: "POST", body });
        serverRegulated = !!preview.compliance?.required;
        step = "preview";
      } else if (step === "preview") {
        const out = await api(`/webbuilders/${current.builder.id}/build`, { method: "POST", body: { ...body, confirm: true } });
        draft = out.draft;
        step = "build";
      } else if (step === "build") {
        const out = await api(`/webbuilders/${current.builder.id}/test`, { method: "POST", body: { draftId: draft.id } });
        draft = out.draft;
        step = "test";
      } else if (step === "test") {
        const out = await api(`/webbuilders/${current.builder.id}/publish`, { method: "POST", body: { draftId: draft.id, confirmed: true, target: body.target || draft.publishDefault || "local" } });
        draft = out.draft;
        publishNote = out.note || "";
        step = "done";
      }
      paintFlowBits();
    } catch (e) {
      toast(e.message, true);
      buttonLabel();
    }
  }

  function openBuilder(id) {
    api(`/webbuilders/${id}`).then((detail) => {
      current = detail;
      step = "describe";
      preview = null;
      draft = null;
      publishNote = "";
      serverRegulated = false;
      hub().hidden = true;
      flow().hidden = false;
      const fields = detail.fields || { main: [], more: [] };
      const defaults = detail.defaults || {};
      const tools = (detail.builder?.tools || []).map((tool) => `${tool.name} (${tool.license})`).join(", ");
      root.querySelector("#bd-form").innerHTML = `<h3 style="margin-top:0">${esc(detail.builder.title)}</h3>
        <p class="small" style="margin-top:0">${esc(detail.builder.summary)}</p>
        <p class="dim small">${esc(detail.gate?.message || "")} ${esc(tools)}</p>
        ${fields.main.map((field) => fieldHtml(field, defaults)).join("")}
        <div id="bd-boxes" hidden>
          <p class="small">Meldmind does not give legal, credit, or insurance advice. These boxes are a reminder, not a review.</p>
          <label class="small" style="display:block;margin:4px 0"><input type="checkbox" id="bd-box-noPromises"> I will not promise a result I cannot stand behind.</label>
          <label class="small" style="display:block;margin:4px 0"><input type="checkbox" id="bd-box-followLaws"> I will follow the rules for this kind of ad.</label>
          <label class="small" style="display:block;margin:4px 0"><input type="checkbox" id="bd-box-notAdvice"> This is my ad. It is not advice from Meldmind.</label>
        </div>
        <details style="margin-top:10px">
          <summary class="small">More options</summary>
          ${fields.more.map((field) => fieldHtml(field, defaults)).join("") || `<p class="dim small">Nothing else to set.</p>`}
          ${detail.builder.id === "email-sequences" ? `<p class="dim small">HighLevel uses the token already saved in Publishing. The footer and the unsubscribe line stay on every email.</p>` : ""}
          ${detail.builder.id === "reel-maker" ? `<label class="small" style="display:block;margin:6px 0"><input type="checkbox" id="bd-remotionAck" data-field="remotionAck"> I have a paid Remotion license.</label>` : ""}
        </details>
        <div id="bd-build-all" style="margin-top:10px"></div>`;
      // Build it all for me: preview, build, test and publish in one go. Posting
      // in public still waits unless Also allow posting is on.
      import("/build-all-ui.js").then(({ mountBuildAll }) => mountBuildAll(root.querySelector("#bd-build-all"), {
        surface: "webbuilder",
        payload: () => { const input = payload(); return { builderId: detail.builder.id, description: String(input.about || input.topic || ""), input }; },
        onEnd: (j) => toast(j.status === "done" ? "Built it all. Saved on this computer." : (j.waiting?.reason || j.error || "Build it all for me stopped.")),
      })).catch(() => { /* the step by step button still works */ });
      const notice = (root.querySelector("#bd-notice")?.value || pack?.notice || "").trim();
      if (notice) {
        const topic = root.querySelector("[data-field='topic']");
        const about = root.querySelector("[data-field='about']");
        if (topic && !topic.value.trim()) topic.value = notice.slice(0, 200);
        else if (about && !about.value.trim()) about.value = notice.slice(0, 600);
      }
      root.querySelector("#bd-form").oninput = () => {
        if (step !== "describe") {
          step = "describe";
          preview = null;
          draft = null;
          publishNote = "";
        }
        toggleBoxes();
        paintFlowBits();
      };
      paintFlowBits();
    }).catch((e) => toast(e.message, true));
  }

  function renderHub() {
    const suggested = pack?.suggested || [];
    const all = pack?.all || [];
    const suggestedIds = new Set(suggested.map((row) => row.id));
    const box = root.querySelector("#bd-suggested");
    box.className = suggested.length ? "bd-cards" : "dim small";
    box.innerHTML = suggested.length
      ? suggested.map(cardHtml).join("")
      : "Nothing is suggested yet. Builders show up when you talk about a website, a post, a reel, or an ad, or when you connect a site or a social account.";
    const hidden = all.filter((row) => !suggestedIds.has(row.id));
    root.querySelector("#bd-all").innerHTML = ["web", "marketing"].map((group) => {
      const rows = hidden.filter((row) => row.group === group);
      if (!rows.length) return "";
      const label = group === "web" ? "Web" : "Marketing";
      return `<h4>${label}</h4><div class="bd-cards">${rows.map(cardHtml).join("")}</div>`;
    }).join("");
    root.querySelector("#bd-all-panel").hidden = !showAll;
    root.querySelector("#bd-show-all").textContent = showAll ? "Show suggested only" : "Show all";
    root.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => openBuilder(btn.dataset.open)));
  }

  async function loadHub() {
    pack = await api("/webbuilders");
    renderHub();
  }

  root.querySelector("#bd-show-all").addEventListener("click", () => {
    showAll = !showAll;
    renderHub();
  });
  root.querySelector("#bd-suggest-go").addEventListener("click", async () => {
    const text = root.querySelector("#bd-notice").value.trim();
    try {
      if (text) await api("/webbuilders/notice", { method: "POST", body: { text } });
      await loadHub();
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#bd-back").addEventListener("click", async () => {
    flow().hidden = true;
    hub().hidden = false;
    current = null;
    try { await loadHub(); } catch (e) { toast(e.message, true); }
  });
  root.querySelector("#bd-go").addEventListener("click", () => onGo());

  loadHub().then(() => { if (openId) openBuilder(openId); }).catch((e) => toast(e.message, true));
}

window.CC.register({
  id: "webbuilders",
  tab: { label: "Web and marketing", order: 46, render: (view) => { view.innerHTML = shell(); boot(view, window.__bdOpen || ""); window.__bdOpen = ""; } },
  command: {
    order: 8,
    render(container) {
      container.innerHTML = "";
      api("/webbuilders").then((data) => {
        const rows = (data?.suggested || []).slice(0, 4);
        if (!container.isConnected || !rows.length) return;
        container.innerHTML = `<div class="panel" id="bd-command"><div class="row" style="justify-content:space-between"><b>Suggested for you</b><button type="button" class="btn sm" id="bd-command-all">Web and marketing</button></div><div class="bd-actions" style="margin-top:8px">${rows.map((row) => `<button type="button" class="bd-suggest" data-open="${esc(row.id)}">${esc(row.title)}</button>`).join("")}</div></div>`;
        container.querySelector("#bd-command-all").addEventListener("click", () => go("webbuilders"));
        container.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => { window.__bdOpen = btn.dataset.open; go("webbuilders"); }));
      }).catch(() => {});
    },
  },
});
