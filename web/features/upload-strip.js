// Swipeable strip of the files attached to a chat message (0.4.21, area N).
// stripHtml(files) is a pure function so a test can import it and check the HTML. The viewer below only
// runs in a browser, and it only shows what is already on this computer. Nothing is sent from here.

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nameOf(file) {
  if (typeof file === "string") return file || "file";
  return String(file?.name || file?.title || "file");
}

export function isImageFile(file) {
  if (typeof file === "string") return IMAGE_EXT.test(file);
  const f = file || {};
  const mime = String(f.mime || f.type || "");
  if (f.kind === "image") return true;
  if (mime && mime !== "application/octet-stream") return mime.startsWith("image/");
  return IMAGE_EXT.test(nameOf(f));
}

function srcOf(file) {
  if (!file || typeof file === "string") return "";
  return String(file.src || file.url || "");
}

// One item per file: a picture is a thumbnail that opens full screen, anything else is a small card
// with the name on it. The strip itself snaps, so a phone swipes from one to the next.
export function stripHtml(files) {
  const list = (Array.isArray(files) ? files : []).filter(Boolean);
  if (!list.length) return "";
  const items = list.map((file, i) => {
    const name = nameOf(file);
    const src = srcOf(file);
    if (isImageFile(file)) {
      return `<div class="us-item snap-start" role="listitem" aria-label="Picture ${esc(name)}"><button type="button" class="us-open" data-us-index="${i}" aria-label="Open picture ${esc(name)}"><img class="us-img" alt="${esc(name)}"${src ? ` src="${esc(src)}"` : ""}></button></div>`;
    }
    return `<div class="us-item snap-start" role="listitem" aria-label="File ${esc(name)}"><div class="us-card"><span class="us-kind">File</span><span class="us-name">${esc(name)}</span></div></div>`;
  }).join("");
  return `<div class="us-strip scroll-snap" role="list" aria-label="Attachments">${items}</div>`;
}

const CSS = `
.us-strip { display: flex; align-items: stretch; gap: 8px; margin-top: 6px; padding: 2px; overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
.us-strip.scroll-snap { scroll-snap-type: x mandatory; }
.us-item { flex: 0 0 auto; scroll-snap-align: start; scroll-snap-stop: always; }
.us-open { display: block; padding: 0; border: 1px solid var(--line-2, var(--line)); border-radius: 10px; background: none; color: var(--text); cursor: pointer; line-height: 0; }
.us-open:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
.us-img { display: block; width: 88px; height: 88px; object-fit: cover; border-radius: 9px; background: var(--sunk-bg, var(--bg-2)); }
.us-card { display: flex; flex-direction: column; justify-content: space-between; gap: 4px; box-sizing: border-box; width: 148px; min-height: 88px; padding: 8px; border: 1px solid var(--line-2, var(--line)); border-radius: 10px; background: var(--card-bg, var(--panel-solid)); }
.us-kind { font-size: .6875rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.us-name { font-size: .8125rem; color: var(--text); overflow-wrap: anywhere; }
.us-viewer { position: fixed; inset: 0; z-index: 9000; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; padding: 14px; background: var(--bg); }
.us-close { align-self: flex-end; }
.us-viewer-body { flex: 1; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 0; }
.us-viewer-img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; background: var(--sunk-bg, var(--bg-2)); }
.us-viewer-card { width: min(440px, 100%); padding: 16px; border: 1px solid var(--line-2, var(--line)); border-radius: var(--radius, 14px); background: var(--card-bg, var(--panel-solid)); display: flex; flex-direction: column; gap: 6px; }
`;

function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("us-css")) return;
  const style = document.createElement("style");
  style.id = "us-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

let viewer = null;

export function closeViewer() {
  if (!viewer || typeof document === "undefined") return;
  document.removeEventListener("keydown", viewer.onKey, true);
  viewer.root.remove();
  const back = viewer.returnTo;
  viewer = null;
  if (back && typeof back.focus === "function") back.focus();
}

// Full screen: a Close button, Esc, and a tap outside the file all close it.
export function openViewer(file, opts = {}) {
  if (typeof document === "undefined") return;
  ensureCss();
  closeViewer();
  const name = nameOf(file);
  const image = isImageFile(file);
  let src = opts.src || srcOf(file);
  const root = document.createElement("div");
  root.className = "us-viewer";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", image ? `Picture ${name}` : `File ${name}`);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn sm us-close";
  close.textContent = "Close";
  const body = document.createElement("div");
  body.className = "us-viewer-body";
  if (image) {
    const img = document.createElement("img");
    img.className = "us-viewer-img";
    img.alt = name;
    if (src) img.src = src;
    body.appendChild(img);
    if (!src && typeof opts.srcFor === "function") {
      Promise.resolve().then(() => opts.srcFor(file)).then((u) => { if (u) img.src = u; }).catch(() => {});
    }
  } else {
    const card = document.createElement("div");
    card.className = "us-viewer-card";
    card.innerHTML = `<span class="us-kind">File</span><span class="us-name">${esc(name)}</span>`;
    body.appendChild(card);
  }
  root.append(close, body);
  document.body.appendChild(root);
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); closeViewer(); } };
  root.addEventListener("click", (e) => { if (e.target === root || e.target === body) closeViewer(); });
  close.addEventListener("click", closeViewer);
  document.addEventListener("keydown", onKey, true);
  viewer = { root, onKey, returnTo: document.activeElement };
  close.focus();
}

// Draw the strip inside a host element and wire each picture to the viewer.
export function mountStrip(host, files, opts = {}) {
  if (!host) return;
  ensureCss();
  const list = (Array.isArray(files) ? files : []).filter(Boolean);
  host.innerHTML = stripHtml(list);
  const srcFor = opts.srcFor;
  host.querySelectorAll(".us-item").forEach((item, i) => {
    const file = list[i];
    if (!file) return;
    const img = item.querySelector("img.us-img");
    if (img && !img.getAttribute("src") && typeof srcFor === "function") {
      Promise.resolve().then(() => srcFor(file)).then((u) => { if (u && !img.getAttribute("src")) img.src = u; }).catch(() => {});
    }
    const button = item.querySelector(".us-open");
    if (button) {
      button.addEventListener("click", () => {
        openViewer(file, { src: img?.getAttribute("src") || srcOf(file), srcFor });
      });
    }
  });
}
