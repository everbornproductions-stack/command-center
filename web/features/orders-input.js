// Upload and voice on the marching orders box. Words land in the box. Send is still a click.
import { FILE_ACCEPT, appendText, wireUpload, wireVoice } from "./capture-input.js";
import { mediaKind, mountModify } from "./media-modify.js";

function renderCommand(el) {
  document.getElementById("ob-row")?.remove();
  el.id = "ob-row";
  el.innerHTML = `<div class="row small" style="margin-top:8px;gap:8px;flex-wrap:wrap;align-items:center">
    <button type="button" class="btn sm" id="ob-upload">Upload</button>
    <input type="file" id="ob-file" hidden multiple accept="${FILE_ACCEPT}" aria-label="Upload a picture, video, screenshot, or document">
    <button type="button" class="btn sm" id="ob-voice" aria-pressed="false">Voice</button>
    <span class="dim" id="ob-status" aria-live="polite"></span>
  </div>
  <div class="dim small" style="margin-top:4px">Upload a file, a screenshot, or a document. Voice writes what you say into the box. Edit the words, then send. Nothing is sent until that click. A picture or video can be retouched or described after you see the plan.</div>
  <div id="ob-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"></div>
  <div id="ob-modify"></div>`;
  const orders = document.querySelector("#orders");
  if (orders) orders.insertAdjacentElement("afterend", el);
  const status = el.querySelector("#ob-status");
  const getBox = () => document.querySelector("#orders");
  wireVoice(el.querySelector("#ob-voice"), { getBox, status });
  const held = [];
  const upload = wireUpload(el.querySelector("#ob-upload"), el.querySelector("#ob-file"), {
    url: "/orders-box/files",
    status,
    before: held,
    onSaved(saved) {
      held.push(saved.id);
      if (saved.note) appendText(getBox(), saved.note);
      const span = document.createElement("span");
      span.className = "chip";
      span.textContent = saved.name || "file";
      el.querySelector("#ob-chips")?.appendChild(span);
      if (mediaKind(saved)) {
        const host = document.createElement("div");
        el.querySelector("#ob-modify")?.appendChild(host);
        mountModify(host, { file: saved, where: "orders", sourceUrl: `/orders-box/files/${encodeURIComponent(saved.id)}` });
      }
    },
  });
  getBox()?.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    upload.take(files);
  });
}

window.CC.register({
  id: "orders-input",
  command: { order: 2, render: renderCommand },
});
