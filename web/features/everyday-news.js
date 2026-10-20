// What's new card and the suggestion box. Send is a separate click. Nothing connects from here.
const { api, toast, esc, go } = window.CC;

const css = `
.en-wrap { display: flex; flex-direction: column; gap: 12px; max-width: 920px; }
.en-card { background: #0e1726; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.en-card h3, .en-card h4 { margin: 0 0 6px; }
.en-say { font-family: var(--mono); font-size: 13px; margin: 6px 0; }
.en-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.en-wrap textarea, .en-wrap input[type="text"], .en-wrap select { width: 100%; }
#ea-news-overlay { position: fixed; inset: 0; z-index: 75; background: rgba(3,6,12,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
#ea-news-overlay .sheet { width: 560px; max-width: 100%; max-height: calc(100vh - 32px); overflow: auto; background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 18px 20px; }
@media (max-width: 640px) { .en-row .btn { width: 100%; } #ea-news-overlay .sheet { width: 100%; } }
`;
if (!document.getElementById("en-style")) {
  const style = document.createElement("style");
  style.id = "en-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const TOUR = [
  { id: "ea-news", title: "What's new", body: "Try saying: What needs me today in all my inboxes? After an update, try a sample, skip, or remind later. Nothing connects or sends from this card." },
  { id: "ea-suggest", title: "Suggest a connection or idea", body: "Try saying: I want a connection for my calendar. You see the exact note before Send. Nothing is sent until that click." },
];
window.CC.everydaySteps = [...(window.CC.everydaySteps || []), ...TOUR.map((s) => ({
  id: s.id, for: "both", view: "settings", target: s.id === "ea-suggest" ? "#ea-suggest-root" : "#ea-news-root", title: s.title, body: s.body,
}))];

let tourAt = -1;
let shownKey = "";
let overlayData = null;

function suggestForm(prefix) {
  return `<div id="${prefix}-suggest">
    <h4>Suggest a connection or idea</h4>
    <div class="en-say">Try saying: I want a connection for my calendar</div>
    <textarea id="${prefix}-text" rows="3" maxlength="2000" aria-label="Suggestion" placeholder="A connection or an action you want"></textarea>
    <div class="en-row" style="margin-top:8px">
      <label class="small">Category
        <select id="${prefix}-cat" aria-label="Category">
          <option value="connection">connection</option>
          <option value="action">action</option>
          <option value="bug">bug</option>
          <option value="other" selected>other</option>
        </select>
      </label>
      <label class="small">Email, optional<input type="text" id="${prefix}-email" aria-label="Email for a reply" maxlength="120"></label>
    </div>
    <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="${prefix}-meta" checked> Include app version and OS. No chat.</label>
    <div class="en-row" style="margin-top:8px"><button type="button" class="btn sm" id="${prefix}-preview">Show exactly what is sent</button></div>
    <pre id="${prefix}-exact" class="small" style="white-space:pre-wrap;display:none"></pre>
    <button type="button" class="btn sm primary" id="${prefix}-send" style="display:none;margin-top:8px">Send</button>
    <div id="${prefix}-thanks" class="small" style="margin-top:8px"></div>
  </div>`;
}

function itemCard(item, prefix) {
  const say = item.say ? `<div class="en-say">Try saying: ${esc(item.say)}</div>` : "";
  const primary = item.kind === "connection"
    ? `<button type="button" class="btn sm primary" data-connect="${esc(item.id)}">Connect</button>`
    : `<button type="button" class="btn sm primary" data-try="${esc(item.id)}">Try it</button>`;
  return `<div class="en-card" data-item="${esc(item.id)}">
    <b>${esc(item.title)}</b>
    ${item.detail ? `<div class="dim small">${esc(item.detail)}</div>` : ""}
    ${say}
    <div class="en-row" style="margin-top:8px">${primary}<button type="button" class="btn sm" data-skip="${esc(item.id)}">Skip</button><button type="button" class="btn sm" data-later="${esc(item.id)}">Remind me later</button></div>
    <div class="dim small" id="${prefix}-msg-${esc(item.id)}"></div>
  </div>`;
}

function wireSuggest(root, prefix, after) {
  let payload = null;
  const text = root.querySelector(`#${prefix}-text`);
  const clear = () => {
    payload = null;
    const pre = root.querySelector(`#${prefix}-exact`);
    const send = root.querySelector(`#${prefix}-send`);
    if (pre) { pre.style.display = "none"; pre.textContent = ""; }
    if (send) send.style.display = "none";
  };
  text?.addEventListener("input", clear);
  root.querySelector(`#${prefix}-cat`)?.addEventListener("change", clear);
  root.querySelector(`#${prefix}-email`)?.addEventListener("input", clear);
  root.querySelector(`#${prefix}-meta`)?.addEventListener("change", clear);
  root.querySelector(`#${prefix}-preview`)?.addEventListener("click", async () => {
    try {
      const body = fields(root, prefix);
      const r = await api("/everyday-news/suggestions/preview", { method: "POST", body });
      payload = r.payload;
      const pre = root.querySelector(`#${prefix}-exact`);
      pre.style.display = "block";
      pre.textContent = JSON.stringify(payload, null, 2);
      root.querySelector(`#${prefix}-send`).style.display = "inline-block";
    } catch (e) { toast(e.message, true); }
  });
  root.querySelector(`#${prefix}-send`)?.addEventListener("click", async () => {
    if (!payload) return toast("Read the exact note first.", true);
    try {
      const r = await api("/everyday-news/suggestions/send", { method: "POST", body: { ...fields(root, prefix), confirm: true, payload } });
      const note = r.delivered ? "" : " Saved on this computer until it can be delivered.";
      root.querySelector(`#${prefix}-thanks`).textContent = `${r.thanks || ""}${note}`;
      clear();
      if (text) text.value = "";
      if (after) after();
    } catch (e) { toast(e.message, true); }
  });
}

function fields(root, prefix) {
  return {
    text: root.querySelector(`#${prefix}-text`)?.value || "",
    category: root.querySelector(`#${prefix}-cat`)?.value || "other",
    email: root.querySelector(`#${prefix}-email`)?.value || "",
    includeMeta: !!root.querySelector(`#${prefix}-meta`)?.checked,
  };
}

function wireItems(root, prefix) {
  const act = async (path, id) => {
    try {
      const r = await api(path, { method: "POST", body: {} });
      const box = root.querySelector(`#${prefix}-msg-${id}`);
      if (r.sample) { if (box) box.textContent = r.sample; toast("Sample only. Nothing was sent."); }
      else if (r.started === false) { if (box) box.textContent = r.message || ""; toast(r.message || "Sign-in starts from the checklist."); }
      refreshOverlay();
    } catch (e) { toast(e.message, true); }
  };
  root.querySelectorAll("[data-try]").forEach((b) => b.addEventListener("click", () => act(`/everyday-news/items/${encodeURIComponent(b.dataset.try)}/try`, b.dataset.try)));
  root.querySelectorAll("[data-connect]").forEach((b) => b.addEventListener("click", () => act(`/everyday-news/items/${encodeURIComponent(b.dataset.connect)}/connect`, b.dataset.connect)));
  root.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => act(`/everyday-news/items/${encodeURIComponent(b.dataset.skip)}/skip`, b.dataset.skip)));
  root.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", () => act(`/everyday-news/items/${encodeURIComponent(b.dataset.later)}/later`, b.dataset.later)));
}

function renderSuggest(el) {
  el.innerHTML = `<div class="en-card" id="ea-suggest-mount">${suggestForm("ea-slot")}</div>`;
  wireSuggest(el, "ea-slot");
}
window.CC.everydaySuggest = { mount: renderSuggest };

function paintSettings(el, data) {
  const say = data?.trySaying || {};
  el.innerHTML = `<div class="en-wrap" id="ea-news-root">
    <div class="en-card">
      <h3>What's new</h3>
      <div class="dim small">${esc(data?.safety || "")}</div>
      <div class="en-say">Try saying: ${esc(say.news || "")}</div>
      <div class="en-row"><button type="button" class="btn sm" id="en-tour">Show the examples</button><button type="button" class="ghost small" id="en-help">Help</button></div>
      ${tourAt >= 0 ? `<div class="en-card" id="en-spot"><b>${esc(TOUR[tourAt].title)}</b><div>${esc(TOUR[tourAt].body)}</div><button type="button" class="btn sm" id="en-next" style="margin-top:8px">${tourAt === TOUR.length - 1 ? "Finish" : "Next"}</button></div>` : ""}
    </div>
    ${(data?.settings || []).map((item) => `<div class="en-card"><b>${esc(item.title)}</b><div class="dim small">In Settings. This one stopped asking.</div>${item.say ? `<div class="en-say">Try saying: ${esc(item.say)}</div>` : ""}</div>`).join("")}
    <div class="en-card" id="ea-suggest-root">${suggestForm("ea-set")}</div>
    <h3 style="margin:0">How to</h3>
    ${(data?.howto || []).map((h) => `<div class="en-card"><h3>How to: ${esc(h.title)}</h3><div class="en-say">Try saying: ${esc(h.say)}</div><ol>${(h.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("")}
  </div>`;
  el.querySelector("#en-tour")?.addEventListener("click", () => { tourAt = 0; paintSettings(el, data); });
  el.querySelector("#en-next")?.addEventListener("click", () => { tourAt = tourAt >= TOUR.length - 1 ? -1 : tourAt + 1; paintSettings(el, data); });
  el.querySelector("#en-help")?.addEventListener("click", () => go("help"));
  wireSuggest(el, "ea-set");
}

function showOverlay(data) {
  document.getElementById("ea-news-overlay")?.remove();
  const box = document.createElement("div");
  box.id = "ea-news-overlay";
  box.innerHTML = `<div class="sheet" role="dialog" aria-label="What's new">
    <h4>What's new</h4>
    <div class="dim small">${esc(data.safety || "")} Remind me later waits 3 days, then 7 days, then the item moves to Settings.</div>
    <div id="ea-news-items" style="margin-top:10px">${(data.prompt || []).map((item) => itemCard(item, "ea-ov")).join("")}</div>
    <div class="en-row" style="margin:10px 0"><button type="button" class="btn sm" id="ea-skip-all">Skip all</button></div>
    ${suggestForm("ea-ov")}
  </div>`;
  document.body.appendChild(box);
  wireItems(box, "ea-ov");
  wireSuggest(box, "ea-ov");
  box.querySelector("#ea-skip-all")?.addEventListener("click", async () => {
    try { await api("/everyday-news/skip-all", { method: "POST", body: {} }); shownKey = ""; box.remove(); }
    catch (e) { toast(e.message, true); }
  });
}

function blocked() {
  if (document.getElementById("cc-whats-new") || document.getElementById("cc-tour")) return true;
  try { if (window.CC.S?.view === "setup") return true; } catch { /* state not ready */ }
  return false;
}

let fetching = false;
let idle = false;
async function refreshOverlay() {
  if (blocked()) {
    document.getElementById("ea-news-overlay")?.remove();
    shownKey = "";
    return;
  }
  if (fetching) return;
  fetching = true;
  try {
    const data = await api("/everyday-news");
    overlayData = data;
    const key = (data.prompt || []).map((i) => i.id).join(",");
    if (!key) { document.getElementById("ea-news-overlay")?.remove(); shownKey = ""; idle = true; return; }
    idle = false;
    if (document.getElementById("ea-news-overlay") && shownKey === key) return;
    shownKey = key;
    showOverlay(data);
  } catch { /* the next tick tries again */ }
  finally { fetching = false; }
}

setInterval(() => {
  if (idle || document.getElementById("ea-news-overlay") || blocked()) return;
  refreshOverlay();
}, 1500);

window.CC.register({
  id: "everyday-news",
  settings: { order: 5, render(el) {
    el.innerHTML = `<div class="en-wrap" id="ea-news-root"><div class="dim small">Loading What's new...</div></div>`;
    api("/everyday-news").then((data) => paintSettings(el, data)).catch((e) => { el.innerHTML = `<div class="dim small">${esc(e.message)}</div>`; });
  } },
  onState(S) {
    if (S.view === "setup" || document.getElementById("cc-whats-new") || document.getElementById("cc-tour")) {
      document.getElementById("ea-news-overlay")?.remove();
      shownKey = "";
      return;
    }
    if (idle || document.getElementById("ea-news-overlay")) return;
    refreshOverlay();
  },
});
