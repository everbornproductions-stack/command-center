// Settings > Privacy: what leaves this computer. A shell module, so the first-run
// welcome screen can open the same list before Settings has ever loaded:
//   window.CC.openPrivacy()  opens it as a dialog over the current page (Escape or Close ends it).
//   window.CC.privacyHtml(view) returns the list markup for a view from GET /api/privacy.
const { api, esc } = window.CC;
const TITLE = "Privacy: what leaves this computer";

function stateLabel(row) {
  if (row.state === "switch") return row.on === true ? "On" : row.on === false ? "Off" : "Switch";
  if (row.state === "always") return "Always, no personal data";
  return "Only when you use it";
}

function listHtml(view) {
  const items = view?.items || [];
  const connected = Array.isArray(view?.connected) && view.connected.length
    ? `<div class="dim small" style="margin-top:6px">Keys saved for: ${esc(view.connected.join(", "))}.</div>`
    : `<div class="dim small" style="margin-top:6px">No AI key is saved yet, so no AI company receives anything.</div>`;
  return `<div class="muted small">${esc(view?.lead || "")}</div>${connected}
    <div class="pv-list" style="margin-top:12px">${items.map((r) => `
      <div class="route pv-row" data-privacy="${esc(r.id)}">
        <div class="row" style="gap:8px;align-items:baseline"><b>${esc(r.name)}</b><span class="chip ${r.state === "switch" && r.on ? "green" : ""}" style="margin-left:auto">${esc(stateLabel(r))}</span></div>
        <div class="small" style="margin-top:4px"><b>What:</b> ${esc(r.what)}</div>
        <div class="small"><b>To:</b> ${esc(r.to)}</div>
        <div class="small"><b>When:</b> ${esc(r.when)}</div>
        <div class="dim small"><b>Turn it off:</b> ${esc(r.off)}</div>
      </div>`).join("")}</div>`;
}
window.CC.privacyHtml = listHtml;

async function load() {
  return api("/privacy");
}

async function renderSettings(el) {
  el.innerHTML = `<div class="panel" id="privacy-panel"><h3>${TITLE}</h3><div class="dim small">Loading...</div></div>`;
  let view;
  try { view = await load(); } catch (e) {
    el.innerHTML = `<div class="panel" id="privacy-panel"><h3>${TITLE}</h3><div class="dim small">${esc(e.message)}</div></div>`;
    return;
  }
  el.innerHTML = `<div class="panel" id="privacy-panel"><h3>${TITLE}</h3>${listHtml(view)}</div>`;
}

function close() {
  const box = document.getElementById("cc-privacy");
  if (box?._key) document.removeEventListener("keydown", box._key);
  box?.remove();
}

export async function openPrivacy() {
  close();
  const box = document.createElement("div");
  box.id = "cc-privacy";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "cc-privacy-title");
  box.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto";
  box.innerHTML = `<div class="panel" style="max-width:720px;width:100%;padding:22px;margin:auto 0">
    <div class="row" style="align-items:center"><h3 id="cc-privacy-title" style="margin:0">${TITLE}</h3><button type="button" class="btn sm" id="cc-privacy-close" style="margin-left:auto">Close</button></div>
    <div id="cc-privacy-body" style="margin-top:10px"><div class="dim small">Loading...</div></div>
  </div>`;
  document.body.appendChild(box);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  box._key = onKey;
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  box.querySelector("#cc-privacy-close").addEventListener("click", close);
  box.querySelector("#cc-privacy-close").focus();
  try { box.querySelector("#cc-privacy-body").innerHTML = listHtml(await load()); }
  catch (e) { box.querySelector("#cc-privacy-body").innerHTML = `<div class="dim small">${esc(e.message)}</div>`; }
}
window.CC.openPrivacy = openPrivacy;

window.CC.register({
  id: "privacy",
  settings: { order: 0, render: renderSettings },
});
