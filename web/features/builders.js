// Guided builders. One main button on each screen.
// Describe, then preview the AIs, then Build, Test, and Publish.
// Extra choices sit under More options. Nothing is sent until the last click.
const { api, toast, esc, go } = window.CC;

const css = `
.gb-wrap { display: flex; flex-direction: column; gap: 14px; max-width: 760px; }
.gb-card, .gb-panel { border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: #0e1726; }
.gb-card h3, .gb-panel h3 { margin: 0 0 6px; font-size: 16px; }
.gb-rail { display: flex; flex-wrap: wrap; gap: 6px; }
.gb-rail span { font-size: 12px; color: var(--dim); padding: 3px 8px; border-radius: 999px; border: 1px solid var(--line); }
.gb-rail span.on { color: var(--text); border-color: var(--accent); }
.gb-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.gb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.gb-item { text-align: left; border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: #0e1726; }
.gb-item h4 { margin: 0 0 4px; font-size: 15px; }
.gb-preview { width: 100%; min-height: 180px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
.gb-warn { padding: 8px 10px; border-radius: 10px; background: #3a2a12; border: 1px solid #a16207; color: #fde68a; }
.gb-more { margin-top: 8px; }
.gb-more summary { cursor: pointer; color: var(--dim); }
.gb-ai { padding: 8px 0; border-bottom: 1px solid var(--line); }
#gb-suggest:empty { display: none; }
`;
if (!document.getElementById("gb-style")) {
  const style = document.createElement("style");
  style.id = "gb-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const SCREENS = [
  ["describe", "Describe"],
  ["preview", "Preview"],
  ["build", "Build"],
  ["test", "Test"],
  ["publish", "Publish"],
];

let jobId = "";
let watchTimer = 0;

function rail(step) {
  const current = step === "done" ? "publish" : step;
  return `<div class="gb-rail" aria-label="Steps">${SCREENS.map(([id, label]) => `<span class="${id === current ? "on" : ""}">${label}</span>`).join("")}</div>`;
}

function verb(builderId, info) {
  if (builderId === "email") return "Send";
  if (builderId === "social" && info?.hosts?.postiz && info?.postizUrl) return "Send";
  if (["ads", "static", "health", "seo", "reel", "social"].includes(builderId)) return "Save";
  return "Publish";
}

function finishLine(builderId, info) {
  if (builderId === "email") return "This sends the series. Each email keeps the unsubscribe line and your address.";
  if (builderId === "social" && info?.hosts?.postiz && info?.postizUrl) return "This sends the posts to your Postiz service.";
  if (builderId === "social") return "This saves the posts on this computer. Nothing is sent.";
  if (builderId === "ads") return "This saves the ads here. Nothing is posted to an ad account.";
  if (builderId === "static") return "This saves Astro files here. Astro is not downloaded.";
  if (builderId === "reel") return "This saves the reel plan here. Nothing is posted.";
  if (builderId === "health" || builderId === "seo") return "This saves the page here. Nothing is published.";
  const host = info?.job?.options?.host === "vercel" ? "Vercel" : "Netlify";
  return `This sends the site to ${host}. Nothing is sent until you click Publish.`;
}

async function paintSuggest(el) {
  const root = el.querySelector("#gb-suggest");
  if (!root) return;
  const draft = document.getElementById("orders")?.value || "";
  let data;
  try { data = await api(`/builders?draft=${encodeURIComponent(draft.slice(0, 500))}`); }
  catch { root.innerHTML = ""; return; }
  const card = data.suggestion;
  if (!card) { root.innerHTML = ""; return; }
  const item = (data.gallery || []).find((row) => row.id === card.id);
  const locked = !!item?.locked;
  const also = (data.also || []).map((row) => esc(row.name)).join(", ");
  root.innerHTML = `<div class="gb-card" id="gb-card">
    <h3>${esc(card.title)}</h3>
    <p>${esc(card.body)}</p>
    ${locked ? `<p class="small">${esc(item.lock)}</p>` : ""}
    ${also ? `<p class="small dim">Also: ${also}</p>` : ""}
    <div class="gb-actions">
      ${locked ? "" : `<button class="btn primary" type="button" id="gb-yes">Help me build it</button>`}
      <button class="btn sm" type="button" id="gb-no">Not now</button>
    </div>
  </div>`;
  root.querySelector("#gb-yes")?.addEventListener("click", () => openBuilder(card.id));
  root.querySelector("#gb-no")?.addEventListener("click", async () => {
    try {
      await api(`/builders/dismiss?draft=${encodeURIComponent(draft.slice(0, 500))}`, { method: "POST", body: { signal: card.signal } });
      await paintSuggest(el);
    } catch (e) { toast(e.message, true); }
  });
}

function watchOrders() {
  const box = document.getElementById("orders");
  if (!box || box.dataset.gbWatch) return;
  box.dataset.gbWatch = "1";
  box.addEventListener("input", () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      const el = document.querySelector("[data-feature='builders']");
      if (el) paintSuggest(el);
    }, 400);
  });
}

async function openBuilder(id) {
  try {
    const data = await api("/builders/open", { method: "POST", body: { id } });
    jobId = data.job.id;
    go("builders");
  } catch (e) { toast(e.message, true); }
}

function moreOptions(job, info) {
  const opt = job?.options || {};
  const showRemotion = job?.builderId === "reel";
  const showHost = ["site", "page", "publish"].includes(job?.builderId);
  const showEmail = job?.builderId === "email";
  const showSocial = job?.builderId === "social";
  return `<details class="gb-more">
    <summary>More options</summary>
    <div class="gb-panel" style="margin-top:8px">
      <label class="row"><input type="checkbox" id="gb-ask" ${opt.askAi === false ? "" : "checked"}> Ask an AI to write the words</label>
      ${showHost ? `<label class="lbl">Where to publish</label><select id="gb-host"><option value="netlify" ${opt.host === "vercel" ? "" : "selected"}>Netlify</option><option value="vercel" ${opt.host === "vercel" ? "selected" : ""}>Vercel</option></select>` : ""}
      ${showEmail ? `<label class="lbl">Send through</label><select id="gb-channel"><option value="highlevel" ${opt.channel === "listmonk" ? "" : "selected"}>HighLevel</option><option value="listmonk" ${opt.channel === "listmonk" ? "selected" : ""}>listmonk</option></select>` : ""}
      ${showSocial ? `<label class="lbl">Postiz address</label><input id="gb-postiz" type="url" placeholder="https://your-postiz.example" value="${esc(info?.postizUrl || "")}"><p class="small dim">Postiz stays a separate service. Its code is not part of Meldmind.</p>` : ""}
      ${showRemotion ? `<label class="row"><input type="checkbox" id="gb-remotion" ${info?.remotion ? "checked" : ""}> Allow Remotion for this reel</label><p class="small dim">Remotion uses a company license. It stays off unless you tick this. The package is not installed.</p>` : ""}
      <label class="lbl">Token</label>
      <div class="row">
        <select id="gb-token-host" aria-label="Token for">
          <option value="netlify">Netlify</option>
          <option value="vercel">Vercel</option>
          <option value="postiz">Postiz</option>
          <option value="listmonk">listmonk</option>
          <option value="highlevel">HighLevel</option>
        </select>
        <input id="gb-token" type="password" autocomplete="off" placeholder="Paste a token" aria-label="Token">
        <button class="btn sm" type="button" id="gb-save-token">Save token</button>
      </div>
      <p class="small dim">The token stays in the vault. It is not shown again.</p>
    </div>
  </details>`;
}

function optionsFrom(root, job) {
  return {
    askAi: root.querySelector("#gb-ask") ? root.querySelector("#gb-ask").checked : job?.options?.askAi !== false,
    host: root.querySelector("#gb-host")?.value || job?.options?.host || "netlify",
    channel: root.querySelector("#gb-channel")?.value || job?.options?.channel || "highlevel",
    remotion: !!root.querySelector("#gb-remotion")?.checked,
  };
}

async function saveExtras(root, info) {
  const body = {};
  const postiz = root.querySelector("#gb-postiz");
  if (postiz && postiz.value.trim() !== (info?.postizUrl || "")) body.postizUrl = postiz.value.trim();
  const remotion = root.querySelector("#gb-remotion");
  if (remotion) body.remotion = remotion.checked;
  if (Object.keys(body).length) await api("/builders/settings", { method: "POST", body });
}

function previewHtml(job) {
  const html = job?.result?.html;
  if (!html) return "";
  return `<iframe class="gb-preview" sandbox title="Page preview" id="gb-frame"></iframe>`;
}

function mountFrame(root, html) {
  const frame = root.querySelector("#gb-frame");
  if (frame) frame.srcdoc = html || "";
}

function issuesHtml(job) {
  const issues = job?.test?.issues || job?.result?.audit?.issues || [];
  if (!issues.length) return `<p>Nothing easy to fix.</p>`;
  return issues.map((issue) => `<div class="row" style="justify-content:space-between;gap:8px;margin:6px 0">
    <span>${esc(issue.title)}</span>
    ${issue.fixable ? `<button class="btn sm" type="button" data-fix="${esc(issue.id)}">Fix it</button>` : ""}
  </div>`).join("");
}

function adsHtml(job) {
  const warning = job?.result?.warning;
  const platforms = job?.result?.platforms || {};
  const rows = Object.values(platforms).map((platform) => {
    const fields = (platform.fields || []).map((field) => `<div class="small">${esc(platform.label)} ${esc(field.id)}: ${field.length}/${field.limit}${field.over ? " (shortened)" : ""}<br>${esc(field.text)}</div>`).join("");
    return fields;
  }).join("");
  return `${warning ? `<div class="gb-warn">${esc(warning.warning)}</div>` : ""}<div>${rows}</div><p class="small dim">Nothing is posted to an ad account.</p>`;
}

function screenBody(job, info) {
  if (!job || job.step === "describe") {
    return `<label class="lbl" for="gb-brief">Describe it</label>
      <textarea id="gb-brief" rows="5" placeholder="Say what you want, in plain words.">${esc(job?.brief || "")}</textarea>
      ${job?.builderId === "email" ? `<label class="lbl" for="gb-address">Postal address</label><input id="gb-address" type="text" value="${esc(info?.address || "")}" placeholder="Street, city, postal code"><p class="small dim">Marketing email has to include a real address and an unsubscribe line.</p>` : ""}
      ${moreOptions(job, info)}`;
  }
  if (job.step === "preview") {
    const ais = job.preview?.ais || [];
    const list = ais.length
      ? ais.map((ai) => `<div class="gb-ai"><b>${esc(ai.name)}</b><div class="small dim">${esc(ai.why)}</div></div>`).join("")
      : `<p>No AI is connected yet. You can still build a simple draft.</p>`;
    const warn = job.builderId === "ads" ? "" : "";
    return `<p>${esc(job.preview?.note || "These AIs can help.")}</p>${list}${warn}${moreOptions(job, info)}`;
  }
  if (job.step === "build") {
    if (job.builderId === "ads") return adsHtml(job);
    if (job.builderId === "social") {
      const posts = (job.result?.posts || []).map((post) => `<div class="gb-ai"><b>${esc(post.day)}</b><div>${esc(post.text)}</div><div class="small dim">Draft</div></div>`).join("");
      return `<p class="small dim">${esc(job.result?.engine?.note || "")}</p>${posts}`;
    }
    if (job.builderId === "email") {
      const emails = (job.result?.emails || []).map((email) => `<div class="gb-ai"><b>${esc(email.subject)}</b><div class="small">${esc(email.text)}</div></div>`).join("");
      return `<p>Every email includes an unsubscribe line.</p>${emails}`;
    }
    if (job.builderId === "reel") {
      const lines = (job.result?.transcript || []).map((row) => `<div class="small">${esc(row.text)}</div>`).join("");
      return `<p>${esc(job.result?.remotion?.note || "")}</p>${lines}`;
    }
    if (job.builderId === "static") return `<p>${esc(job.result?.engine?.note || "")}</p>${previewHtml(job)}`;
    return previewHtml(job);
  }
  if (job.step === "test") {
    if (job.builderId === "ads") return `${adsHtml(job)}<p>Read the warning, then continue.</p>`;
    if (["site", "page", "publish", "static", "health", "seo"].includes(job.builderId)) {
      const scores = job.test?.scores;
      const scoreLine = scores ? `SEO ${scores.seo}. Accessibility ${scores.accessibility}.` : "";
      return `<p>${esc(job.test?.engine?.note || "Check")}</p><p>${esc(scoreLine)}</p>${issuesHtml(job)}${previewHtml(job)}`;
    }
    if (job.builderId === "email") return `<p>${job.test?.unsubscribe ? "Unsubscribe line is in every email." : "The unsubscribe line is missing."}</p>`;
    return `<p>The draft looks ready to save.</p>`;
  }
  const done = job.step === "done";
  return `<p>${done ? esc(job.publish?.note || (job.publish?.sent ? "Sent." : "Saved.")) : finishLine(job.builderId, { ...info, job })}</p>
    ${job.builderId === "email" && !done ? `<label class="lbl" for="gb-address">Postal address</label><input id="gb-address" type="text" value="${esc(info?.address || "")}">` : ""}
    ${done ? "" : moreOptions(job, info)}`;
}

function buttonLabel(job, info) {
  if (!job || job.step === "describe") return "Next";
  if (job.step === "preview") return "Build";
  if (job.step === "build") return "Test";
  if (job.step === "test") return "Next";
  if (job.step === "publish") return verb(job.builderId, info);
  return "Start again";
}

async function paintFlow(view) {
  const root = view.querySelector("#gb-flow") || view;
  let info = null;
  let job = null;
  try { info = await api("/builders"); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (jobId) {
    job = (info.jobs || []).find((row) => row.id === jobId) || null;
    if (!job) {
      try { job = (await api(`/builders/jobs/${jobId}/preview`, { method: "POST", body: {} })).job; }
      catch { job = null; }
    }
  }
  if (!job) {
    root.innerHTML = `<div class="gb-wrap"><div class="gb-panel"><h3>Builders</h3><p>When a chat mentions a website, a reel, a post schedule, or an email series, a card offers help. You can also open any builder from Settings.</p><button class="btn primary" type="button" id="gb-settings">Open Settings</button></div></div>`;
    root.querySelector("#gb-settings")?.addEventListener("click", () => go("settings"));
    return;
  }
  root.innerHTML = `<div class="gb-wrap">
    <div class="gb-panel">
      <h3>${esc(job.name)}</h3>
      ${rail(job.step)}
      <div id="gb-screen" style="margin-top:12px">${screenBody(job, info)}</div>
      <div class="gb-actions" style="margin-top:12px">
        <button class="btn primary" type="button" id="gb-next">${esc(buttonLabel(job, info))}</button>
      </div>
    </div>
  </div>`;
  mountFrame(root, job.result?.html || "");
  root.querySelector("#gb-save-token")?.addEventListener("click", async () => {
    const token = root.querySelector("#gb-token")?.value || "";
    const host = root.querySelector("#gb-token-host")?.value;
    try {
      await api("/builders/token", { method: "POST", body: { host, token } });
      const input = root.querySelector("#gb-token");
      if (input) input.value = "";
      toast("Token saved");
    } catch (e) { toast(e.message, true); }
  });
  root.querySelectorAll("[data-fix]").forEach((button) => button.addEventListener("click", async () => {
    try {
      const data = await api(`/builders/jobs/${job.id}/fix`, { method: "POST", body: { fixId: button.dataset.fix } });
      jobId = data.job.id;
      paintFlow(view);
    } catch (e) { toast(e.message, true); }
  }));
  root.querySelector("#gb-next")?.addEventListener("click", () => next(view, job, info, root));
}

async function next(view, job, info, root) {
  const button = root.querySelector("#gb-next");
  if (button) button.disabled = true;
  try {
    if (!job || job.step === "done") {
      const opened = await api("/builders/open", { method: "POST", body: { id: job?.builderId || "ads" } });
      jobId = opened.job.id;
    } else if (job.step === "describe") {
      const address = root.querySelector("#gb-address");
      if (address) await api("/builders/settings", { method: "POST", body: { address: address.value } });
      await saveExtras(root, info);
      const data = await api(`/builders/jobs/${job.id}/describe`, { method: "POST", body: { brief: root.querySelector("#gb-brief")?.value || "", ...optionsFrom(root, job) } });
      jobId = data.job.id;
    } else if (job.step === "preview") {
      await saveExtras(root, info);
      const data = await api(`/builders/jobs/${job.id}/build`, { method: "POST", body: {} });
      jobId = data.job.id;
    } else if (job.step === "build") {
      const data = await api(`/builders/jobs/${job.id}/test`, { method: "POST", body: {} });
      jobId = data.job.id;
    } else if (job.step === "test") {
      const data = await api(`/builders/jobs/${job.id}/ready`, { method: "POST", body: {} });
      jobId = data.job.id;
    } else if (job.step === "publish") {
      const address = root.querySelector("#gb-address");
      if (address) await api("/builders/settings", { method: "POST", body: { address: address.value } });
      await saveExtras(root, info);
      const data = await api(`/builders/jobs/${job.id}/publish`, {
        method: "POST",
        body: { confirm: true, ...optionsFrom(root, job) },
      });
      jobId = data.job.id;
      toast(data.job.publish?.sent ? "Sent" : "Saved");
    }
    await paintFlow(view);
  } catch (e) {
    toast(e.message, true);
    if (button) button.disabled = false;
  }
}

async function renderSettings(el) {
  let data;
  try { data = await api("/builders"); }
  catch (e) { el.innerHTML = `<div class="panel"><h3>Builders</h3><p>${esc(e.message)}</p></div>`; return; }
  el.innerHTML = `<div class="panel" id="gb-gallery">
    <h3>Builders</h3>
    <p class="small dim">A builder shows up on the chat only when it looks useful. You can turn that off. The full list stays here.</p>
    <label class="row"><input type="checkbox" id="gb-suggest-on" ${data.suggestionsOn ? "checked" : ""}> Suggest a builder when it would help</label>
    <div class="gb-grid" style="margin-top:10px">
      ${(data.gallery || []).map((item) => `<div class="gb-item">
        <h4>${esc(item.name)}</h4>
        <p class="small">${esc(item.plain)}</p>
        <p class="small dim">${esc(item.engine?.name || "")}${item.engine?.license ? ` (${esc(item.engine.license)})` : ""}</p>
        ${item.locked ? `<p class="small">${esc(item.lock)}</p>` : `<button class="btn sm primary" type="button" data-open="${esc(item.id)}">Open</button>`}
      </div>`).join("")}
    </div>
  </div>`;
  el.querySelector("#gb-suggest-on")?.addEventListener("change", async (event) => {
    try { await api("/builders/settings", { method: "POST", body: { suggestions: event.target.checked } }); toast(event.target.checked ? "Suggestions on" : "Suggestions off"); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openBuilder(button.dataset.open)));
}

window.CC.register({
  id: "builders",
  tab: { label: "Builders", short: "Builders", icon: "✎", order: 36, render: renderTab },
  command: { order: 4, render: renderCommand },
  settings: { order: 12, render: renderSettings },
});

function renderCommand(el) {
  el.innerHTML = `<div id="gb-suggest"></div>`;
  watchOrders();
  paintSuggest(el);
}

function renderTab(view) {
  view.innerHTML = `<div id="gb-flow" class="gb-wrap"><div class="empty">Loading…</div></div>`;
  paintFlow(view);
}
