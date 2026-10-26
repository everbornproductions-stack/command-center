// What's new card and the suggestion box. Send is a separate click. Nothing connects from here.
import { FILE_ACCEPT, fileTooBig, wireUpload, wireVoice } from "./capture-input.js";
import { mediaKind, mountModify } from "./media-modify.js";

const { api, apiBlobUrl, downloadBlob, toast, esc, go } = window.CC;

const css = `
.en-wrap { display: flex; flex-direction: column; gap: 12px; max-width: 920px; }
.en-card { background: var(--card-bg, #0e1726); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.en-card h3, .en-card h4 { margin: 0 0 6px; }
.en-say { font-family: var(--mono); font-size: 13px; margin: 6px 0; }
.en-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.en-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.en-chips .chip { display: inline-flex; gap: 6px; align-items: center; }
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
  { id: "ea-suggest", title: "Suggest a connection or idea", body: "Try saying: I want a connection for my calendar. Upload a file or use Voice, then edit the words. You see the exact note before Send. Nothing is sent until that click. A picture or video can be retouched or described after you see the plan." },
  { id: "ea-ideas", title: "Your ideas", body: "After you send, you can edit, delete, or re-prioritize an idea, add a comment, and set a status: new, planned, building, or shipped. Those changes stay on this computer." },
];
window.CC.everydaySteps = [...(window.CC.everydaySteps || []), ...TOUR.map((s) => ({
  id: s.id, for: "both", view: "settings", target: s.id === "ea-suggest" ? "#ea-suggest-root" : s.id === "ea-ideas" ? "#ea-set-ideas" : "#ea-news-root", title: s.title, body: s.body,
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
      <button type="button" class="btn sm" id="${prefix}-upload">Upload</button>
      <input type="file" id="${prefix}-file" hidden multiple accept="${FILE_ACCEPT}" aria-label="Upload a picture, video, screenshot, or document">
      <button type="button" class="btn sm" id="${prefix}-voice" aria-pressed="false">Voice</button>
      <span class="dim small" id="${prefix}-cap" aria-live="polite"></span>
    </div>
    <div class="en-chips" id="${prefix}-chips"></div>
    <div class="dim small" style="margin-top:4px">A picture or video can be retouched or described after you see the plan. That Run click is separate from Send.</div>
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
    <h4 style="margin-top:14px">Your ideas</h4>
    <div class="dim small">Edit, delete, re-prioritize, comment, or set a status. Those changes stay on this computer and are not sent again.</div>
    <div id="${prefix}-ideas" class="dim small">Loading ideas...</div>
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

const STATUSES = ["new", "planned", "building", "shipped"];

function paintIdeas(root, prefix, ideas) {
  const list = root.querySelector(`#${prefix}-ideas`);
  if (!list) return;
  if (!ideas?.length) {
    list.innerHTML = "No ideas yet. One you send shows up here.";
    return;
  }
  list.innerHTML = ideas.map((idea) => `<div class="en-card" data-idea="${esc(idea.id)}" style="margin-top:8px">
    <div class="en-row">
      <label class="small">Status
        <select data-act="status" aria-label="Status">
          ${STATUSES.map((s) => `<option value="${s}" ${idea.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>
      <span class="dim small">${idea.delivered ? "Sent" : "On this computer"}</span>
      <button type="button" class="btn sm" data-act="up">Higher</button>
      <button type="button" class="btn sm" data-act="down">Lower</button>
      <button type="button" class="btn sm" data-act="upload">Upload</button>
      <button type="button" class="btn sm" data-act="delete">Delete</button>
    </div>
    <textarea data-act="text" rows="2" maxlength="2000" aria-label="Idea text" style="margin-top:8px">${esc(idea.text || "")}</textarea>
    <div class="en-row" style="margin-top:8px">
      <label class="small">Category
        <select data-act="cat" aria-label="Category">
          ${["connection", "action", "bug", "other"].map((c) => `<option value="${c}" ${idea.category === c ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </label>
      <button type="button" class="btn sm primary" data-act="save">Save</button>
    </div>
    <div class="dim small" style="margin-top:6px">Saving stays on this computer. It is not sent again.</div>
    <div class="en-chips">${(idea.files || []).map((f) => `<button type="button" class="btn sm" data-act="download" data-file="${esc(f.id)}" data-name="${esc(f.name)}">${esc(f.name)}</button>`).join("")}</div>
    ${(idea.files || []).filter((f) => mediaKind(f)).map((f) => `<div data-modify data-file="${esc(f.id)}" data-name="${esc(f.name)}" data-mime="${esc(f.mime || "")}" data-kind="${esc(f.kind || "")}"></div>`).join("")}
    ${(idea.comments || []).map((c) => `<div class="small" style="margin-top:6px">${esc(c.text)}</div>`).join("")}
    <div class="en-row" style="margin-top:8px">
      <input type="text" data-act="comment" maxlength="1000" aria-label="Comment" placeholder="Add a comment" style="flex:1;min-width:140px">
      <button type="button" class="btn sm" data-act="comment-add">Add comment</button>
    </div>
  </div>`).join("");
  list.querySelectorAll("[data-modify]").forEach((host) => {
    const card = host.closest("[data-idea]");
    mountModify(host, {
      file: { id: host.dataset.file, name: host.dataset.name, mime: host.dataset.mime, kind: host.dataset.kind },
      where: "idea",
      ideaId: card?.dataset.idea,
      sourceUrl: `/everyday-news/files/${encodeURIComponent(card?.dataset.idea || "")}/${encodeURIComponent(host.dataset.file || "")}`,
    });
  });
}

async function reloadIdeas(root, prefix) {
  try {
    const data = await api("/everyday-news");
    paintIdeas(root, prefix, data.ideas || []);
  } catch (e) {
    const list = root.querySelector(`#${prefix}-ideas`);
    if (list) list.textContent = e.message;
  }
}

function wireIdeas(root, prefix) {
  const list = root.querySelector(`#${prefix}-ideas`);
  if (!list || list.dataset.wired) return;
  list.dataset.wired = "1";
  list.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button || !list.contains(button)) return;
    const card = button.closest("[data-idea]");
    const id = card?.dataset.idea;
    if (!id) return;
    const act = button.dataset.act;
    try {
      if (act === "up" || act === "down") {
        const r = await api(`/everyday-news/suggestions/${encodeURIComponent(id)}/move`, { method: "POST", body: { direction: act } });
        paintIdeas(root, prefix, r.ideas || []);
        return;
      }
      if (act === "delete") {
        if (!(await window.CC.confirm("Delete this idea? This cannot be undone.", { danger: true, ok: "Delete" }))) return;
        const r = await api(`/everyday-news/suggestions/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} });
        paintIdeas(root, prefix, r.ideas || []);
        return;
      }
      if (act === "save") {
        const r = await api(`/everyday-news/suggestions/${encodeURIComponent(id)}`, {
          method: "POST",
          body: {
            text: card.querySelector("[data-act='text']")?.value || "",
            category: card.querySelector("[data-act='cat']")?.value || "other",
            status: card.querySelector("[data-act='status']")?.value || "new",
          },
        });
        toast(r.message || "Saved on this computer.");
        paintIdeas(root, prefix, r.ideas || []);
        return;
      }
      if (act === "comment-add") {
        const r = await api(`/everyday-news/suggestions/${encodeURIComponent(id)}/comments`, {
          method: "POST",
          body: { text: card.querySelector("[data-act='comment']")?.value || "" },
        });
        toast(r.message || "Saved on this computer.");
        reloadIdeas(root, prefix);
        return;
      }
      if (act === "download") {
        const url = await apiBlobUrl(`/everyday-news/files/${encodeURIComponent(id)}/${encodeURIComponent(button.dataset.file)}`);
        downloadBlob(url, button.dataset.name || "file");
        return;
      }
      if (act === "upload") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = FILE_ACCEPT;
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (!file) return;
          const tooBig = fileTooBig(file);
          if (tooBig) return toast(tooBig, true);
          try {
            const data = await fileToB64(file);
            const r = await api(`/everyday-news/suggestions/${encodeURIComponent(id)}/files`, {
              method: "POST",
              body: { name: file.name, mime: file.type || "application/octet-stream", data },
            });
            toast(r.message || "Saved on this computer.");
            reloadIdeas(root, prefix);
          } catch (err) { toast(err.message, true); }
        });
        input.click();
      }
    } catch (err) { toast(err.message, true); }
  });
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const cut = raw.indexOf(",");
      resolve(cut >= 0 ? raw.slice(cut + 1) : raw);
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
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
  const status = root.querySelector(`#${prefix}-cap`);
  const held = [];
  wireVoice(root.querySelector(`#${prefix}-voice`), {
    getBox: () => text,
    status,
  });
  const upload = wireUpload(root.querySelector(`#${prefix}-upload`), root.querySelector(`#${prefix}-file`), {
    url: "/everyday-news/suggestions/files",
    status,
    before: held,
    onSaved(saved) {
      held.push(saved.id);
      const box = root.querySelector(`#${prefix}-chips`);
      const wrap = document.createElement("div");
      wrap.className = "mm-file";
      wrap.dataset.file = saved.id;
      const span = document.createElement("span");
      span.className = "chip";
      span.textContent = saved.name || "file";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ghost small";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        wrap.remove();
        const at = held.indexOf(saved.id);
        if (at >= 0) held.splice(at, 1);
        clear();
        try { await api(`/everyday-news/suggestions/files/${encodeURIComponent(saved.id)}`, { method: "DELETE" }); } catch { /* the chip is already gone */ }
      });
      span.append(" ");
      span.appendChild(remove);
      wrap.appendChild(span);
      if (mediaKind(saved)) {
        const host = document.createElement("div");
        wrap.appendChild(host);
        mountModify(host, { file: saved, where: "idea", sourceUrl: `/everyday-news/suggestions/files/${encodeURIComponent(saved.id)}` });
      }
      box?.appendChild(wrap);
      clear();
    },
  });
  text?.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    upload.take(files);
  });
  root.querySelector(`#${prefix}-preview`)?.addEventListener("click", async () => {
    try {
      const body = fields(root, prefix);
      const r = await api("/everyday-news/suggestions/preview", { method: "POST", body });
      payload = r.payload;
      const pre = root.querySelector(`#${prefix}-exact`);
      pre.style.display = "block";
      pre.textContent = JSON.stringify(payload, null, 2);
      if (payload.files?.length) pre.textContent += "\n\nFile contents stay on this computer. Only the names above are in the note.";
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
      held.splice(0, held.length);
      root.querySelector(`#${prefix}-chips`)?.replaceChildren();
      reloadIdeas(root, prefix);
      if (after) after();
    } catch (e) { toast(e.message, true); }
  });
  wireIdeas(root, prefix);
  reloadIdeas(root, prefix);
}

function fields(root, prefix) {
  return {
    text: root.querySelector(`#${prefix}-text`)?.value || "",
    category: root.querySelector(`#${prefix}-cat`)?.value || "other",
    email: root.querySelector(`#${prefix}-email`)?.value || "",
    includeMeta: !!root.querySelector(`#${prefix}-meta`)?.checked,
    fileIds: [...root.querySelectorAll(`#${prefix}-chips [data-file]`)].map((el) => el.dataset.file),
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
