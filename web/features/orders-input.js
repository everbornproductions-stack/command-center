// Upload and voice on the marching orders box. Words land in the box. Send is still a click.
import { FILE_ACCEPT, appendText, wireUpload, wireVoice } from "./capture-input.js";
import { mediaKind, mountModify } from "./media-modify.js";
import { mountStrip } from "./upload-strip.js";

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
  <div id="ob-chips"></div>
  <div id="ob-modify"></div>`;
  const orders = document.querySelector("#orders");
  // 0.4.38 (Chris: Expert Command as a chat): in the Expert chat box, Upload (and its status) sits in the box's bottom
  // row next to Mic and the attached files show under the text; Voice and the help words stay under More options.
  // 0.5.0 (Chris: chat like the Claude app): both chat pages share one box; its round + clicks Upload (kept out of sight in
  // the bottom row with its status) and the attached files show above the text
  const exRow = orders?.closest(".cb-box") ? document.getElementById("cb-upload-slot") : null;
  const exChips = exRow ? document.getElementById("cb-files") : null;
  if (exRow && exChips) {
    exRow.replaceChildren(el.querySelector("#ob-upload"), el.querySelector("#ob-file"), el.querySelector("#ob-status"));
    exChips.replaceChildren(el.querySelector("#ob-chips"), el.querySelector("#ob-modify"));
  } else if (orders) orders.insertAdjacentElement("afterend", el);
  const find = (id) => el.querySelector(`#${id}`) || document.getElementById(id);
  const status = find("ob-status");
  const getBox = () => document.querySelector("#orders");
  wireVoice(el.querySelector("#ob-voice"), { getBox, status });
  const held = [];
  // The files on the message sit in one strip: swipe on a phone, drag on a desk, tap a picture to open it.
  const paintStrip = () => {
    const box = find("ob-chips");
    if (!box) return;
    const { apiBlobUrl } = window.CC;
    mountStrip(box, held, { srcFor: (f) => (f?.id && apiBlobUrl ? apiBlobUrl(`/orders-box/files/${encodeURIComponent(f.id)}`) : "") });
  };
  const upload = wireUpload(find("ob-upload"), find("ob-file"), {
    url: "/orders-box/files",
    status,
    before: held,
    onSaved(saved) {
      held.push(saved);
      if (saved.note) appendText(getBox(), saved.note);
      paintStrip();
      if (mediaKind(saved)) {
        const host = document.createElement("div");
        find("ob-modify")?.appendChild(host);
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
