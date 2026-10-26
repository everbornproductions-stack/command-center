// Settings > Privacy: what leaves this computer and the three learning levels.
// A shell module, so the first-run welcome screen can open the same list before
// Settings has ever loaded:
//   window.CC.openPrivacy()  opens it as a dialog over the current page (Escape or Close ends it).
//   window.CC.privacyHtml(view) returns the list markup for a view from GET /api/privacy.
const { api, esc, toast } = window.CC;
const TITLE = "Privacy: what leaves this computer";

function stateLabel(row) {
  if (row.state === "switch") return row.on === true ? "On" : row.on === false ? "Off" : "Switch";
  if (row.state === "always") return "Always, no personal data";
  return "Only when you use it";
}

function levelsHtml(view) {
  const lv = view?.levels || {};
  const onDevice = lv.onDevice !== false;
  const qualityOn = lv.qualitySignals === true;
  const contentOn = lv.contentOptIn === true;
  return `<div class="pv-levels" style="margin-top:10px;display:grid;gap:8px">
    <div class="route">
      <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start">
        <input type="checkbox" id="pv-on-device" ${onDevice ? "checked" : ""}>
        <span><b>Level 1: On-device learning</b></span>
      </label>
      <div class="dim small" style="margin-top:4px">The router learns from your own jobs on this computer. Nothing leaves this PC.</div>
    </div>
    <div class="route">
      <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start">
        <input type="checkbox" id="pv-quality-signals" ${qualityOn ? "checked" : ""}>
        <span><b>Level 2: Helping Meldmind get smarter: anonymous results only, never your text</b></span>
      </label>
      <div class="dim small" style="margin-top:4px">Counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id. No prompts, answers, file names, emails, keys, or identifying ids. Default on with this notice (off and ask in consent-first regions such as the EU and the UK). Your choice is saved, but this version does not send these counts anywhere yet. Nothing leaves this computer until a later update turns sending on, and the notice here will say so.</div>
    </div>
    <div class="route">
      <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start">
        <input type="checkbox" id="pv-content-optin" ${contentOn ? "checked" : ""}>
        <span><b>Level 3: Share real prompts and answers for our own-AI program</b></span>
      </label>
      <div class="dim small" style="margin-top:4px">Optional explicit opt-in, never pre-checked. Source-tagged, closed-AI outputs excluded. Nothing collects prompts or answers without a clear yes.</div>
    </div>
  </div>`;
}

function listHtml(view) {
  const items = view?.items || [];
  const connected = Array.isArray(view?.connected) && view.connected.length
    ? `<div class="dim small" style="margin-top:6px">Keys saved for: ${esc(view.connected.join(", "))}.</div>`
    : `<div class="dim small" style="margin-top:6px">No AI key is saved yet, so no AI company receives anything.</div>`;
  return `<div class="muted small">${esc(view?.lead || "")}</div>${connected}${levelsHtml(view)}
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

function wireLevelSwitches(root, refreshFn) {
  const bind = (sel, key) => {
    const el = root.querySelector(sel);
    if (!el) return;
    el.addEventListener("change", async (e) => {
      const next = !!e.target.checked;
      try {
        await api("/privacy", { method: "POST", body: { [key]: next } });
        if (refreshFn) await refreshFn();
        toast?.("Privacy setting saved");
      } catch (err) {
        e.target.checked = !next;
        toast?.(err.message, true);
      }
    });
  };
  bind("#pv-on-device", "onDevice");
  bind("#pv-quality-signals", "qualitySignals");
  bind("#pv-content-optin", "contentOptIn");
}

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
  wireLevelSwitches(el, () => renderSettings(el));
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
  const body = box.querySelector("#cc-privacy-body");
  const paint = async () => {
    try {
      body.innerHTML = listHtml(await load());
      wireLevelSwitches(body, paint);
    } catch (e) {
      body.innerHTML = `<div class="dim small">${esc(e.message)}</div>`;
    }
  };
  await paint();
}
window.CC.openPrivacy = openPrivacy;

window.CC.register({
  id: "privacy",
  settings: { order: 0, render: renderSettings },
});
