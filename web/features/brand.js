// Brand kit: logo, name, tagline and two brand colours. Saved per user on the server (/api/brand),
// mirrored in localStorage so the header is branded before the first state arrives, and applied to
// the app header (logo + name + title). Share pages pick the same kit up server-side.
const { S, api, toast, esc } = window.CC;

const LS = "cc.brand";
const DEFAULTS = { name: "", tagline: "", primary: null, secondary: null, logo: null };
let kit = read();
let synced = false;
let original = null; // header markup to restore when the kit is cleared
let pendingLogo = undefined; // a freshly chosen logo waiting for Save (undefined = unchanged)

function read() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return { ...DEFAULTS }; } }
function remember(k) { try { localStorage.setItem(LS, JSON.stringify({ name: k.name, tagline: k.tagline, primary: k.primary, secondary: k.secondary, logo: k.logo })); } catch {} }

const css = `
.cc-brand-logo { height: 26px; max-width: 120px; object-fit: contain; border-radius: 6px; display: none; }
html[data-brand-logo="1"] .cc-brand-logo { display: inline-block; }
html[data-brand-logo="1"] .brand-mark { display: none; }
html[data-brand-primary="1"] .brand-mark { background: var(--brand-primary); }
html[data-brand-primary="1"] .brand-name b { color: var(--brand-primary); }
.cc-brand-preview { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg-2); margin-top: 10px; }
.cc-brand-preview .mark { width: 14px; height: 14px; border-radius: 50%; background: var(--brand-primary, var(--accent)); }
.cc-brand-preview img { height: 26px; max-width: 120px; object-fit: contain; }
.cc-brand-preview .nm { letter-spacing: .18em; font-size: 12px; font-weight: 600; }
.cc-brand-drop { border: 1px dashed var(--line-2); border-radius: 10px; padding: 12px; text-align: center; cursor: pointer; }
.cc-brand-drop:hover { border-color: var(--accent); }
`;
const style = document.createElement("style"); style.id = "cc-brand"; style.textContent = css; document.head.appendChild(style);

function brandName(name) {
  const words = esc(name).split(" ");
  return words.length > 1 ? `${words.slice(0, -1).join(" ")} <b>${words.at(-1)}</b>` : `<b>${words[0]}</b>`;
}

export function apply(k = kit) {
  kit = { ...DEFAULTS, ...k };
  remember(kit);
  const root = document.documentElement;
  const brand = document.querySelector(".topbar .brand");
  if (brand && original === null) original = { html: brand.innerHTML, title: document.title };
  root.dataset.brandLogo = kit.logo ? "1" : "0";
  root.dataset.brandPrimary = kit.primary ? "1" : "0";
  if (kit.primary) root.style.setProperty("--brand-primary", kit.primary); else root.style.removeProperty("--brand-primary");
  if (kit.secondary) root.style.setProperty("--brand-secondary", kit.secondary); else root.style.removeProperty("--brand-secondary");
  if (!brand) return;
  let img = brand.querySelector(".cc-brand-logo");
  if (!img) { img = document.createElement("img"); img.className = "cc-brand-logo"; img.alt = ""; brand.prepend(img); }
  if (kit.logo) img.src = kit.logo; else img.removeAttribute("src");
  const nm = brand.querySelector(".brand-name");
  if (nm) nm.innerHTML = kit.name ? brandName(kit.name) : original.html.match(/<span class="brand-name"[^>]*>([\s\S]*?)<\/span>/)?.[1] || nm.innerHTML;
  document.title = kit.name ? `${kit.name} · Meldmind` : original.title;
}

async function sync() { try { const r = await api("/brand"); apply(r); synced = true; } catch {} }

// Shrink a raster logo to 256 px (longest side) as PNG; keep SVG as text. Resolves to a data: URL.
function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) return reject(new Error("Pick an image under 4 MB"));
    if (file.type === "image/svg+xml") {
      const fr = new FileReader();
      fr.onload = () => { const t = String(fr.result); if (t.length > 300 * 1024) return reject(new Error("SVG is too large (300 KB max)")); resolve("data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(t)))); };
      fr.onerror = () => reject(new Error("Could not read the file")); fr.readAsText(file); return;
    }
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) return reject(new Error("Use a PNG, JPEG, WebP or SVG image"));
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const max = 256, s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(im.width * s)); c.height = Math.max(1, Math.round(im.height * s));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL("image/png"));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file is not an image the browser can open")); };
    im.src = url;
  });
}

function renderPanel(el) {
  const logo = pendingLogo !== undefined ? pendingLogo : kit.logo;
  el.innerHTML = `<div class="panel"><h3>Brand kit <span class="right">${kit.updatedAt ? "saved" : "not set"}</span></h3>
    <div class="grid cols-2" style="gap:10px">
      <div><label class="lbl">Company or client name</label><input type="text" id="cc-br-name" maxlength="60" value="${esc(kit.name)}" placeholder="Meldmind"></div>
      <div><label class="lbl">Tagline (share pages)</label><input type="text" id="cc-br-tag" maxlength="120" value="${esc(kit.tagline)}" placeholder="One console for every AI you pay for"></div>
      <div><label class="lbl">Primary colour</label><div class="row"><input type="color" id="cc-br-p" value="${esc(kit.primary || "#22d3ee")}" style="width:44px;height:32px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"><label class="row small" style="gap:6px"><input type="checkbox" id="cc-br-p-on" ${kit.primary ? "checked" : ""}> use</label></div></div>
      <div><label class="lbl">Secondary colour</label><div class="row"><input type="color" id="cc-br-s" value="${esc(kit.secondary || "#a78bfa")}" style="width:44px;height:32px;padding:0;border:1px solid var(--line-2);border-radius:8px;background:transparent"><label class="row small" style="gap:6px"><input type="checkbox" id="cc-br-s-on" ${kit.secondary ? "checked" : ""}> use</label></div></div>
    </div>
    <label class="lbl">Logo</label>
    <div class="cc-brand-drop" id="cc-br-drop">${logo ? `<img src="${logo}" alt="" style="height:40px;max-width:200px;object-fit:contain">` : `<span class="dim small">Drop a PNG, JPEG, WebP or SVG here, or click to choose. Shrunk to 256 px and kept on your account only.</span>`}</div>
    <input type="file" id="cc-br-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none">
    <div class="cc-brand-preview"><span class="mark" id="cc-br-pv-mark"></span><img id="cc-br-pv-img" alt="" style="${logo ? "" : "display:none"}" src="${logo || ""}"><span class="nm" id="cc-br-pv-name"></span><span class="dim small" id="cc-br-pv-tag" style="margin-left:auto"></span></div>
    <div class="row" style="margin-top:12px"><button class="btn sm primary" id="cc-br-save">Save brand kit</button>${logo ? `<button class="btn sm" id="cc-br-rmlogo">Remove logo</button>` : ""}<button class="btn sm" id="cc-br-accent" ${kit.primary ? "" : "disabled"} title="Make the app accent follow the primary colour">Use primary as app accent</button><button class="ghost small" id="cc-br-reset" style="margin-left:auto">reset</button></div>
    <div class="dim small" style="margin-top:8px">Applied to the header here and to client share pages. Logo limit 400 KB; nothing is uploaded anywhere but your own ${S.mode === "hosted" ? "hub account" : "PC"}.</div>
  </div>`;
  const q = (s) => el.querySelector(s);
  const preview = () => {
    const name = q("#cc-br-name").value.trim() || "EVERBORN COMMAND";
    const p = q("#cc-br-p-on").checked ? q("#cc-br-p").value : null;
    q("#cc-br-pv-name").innerHTML = brandName(name.toUpperCase());
    q("#cc-br-pv-mark").style.background = p || "var(--accent)";
    q("#cc-br-pv-mark").style.display = (pendingLogo !== undefined ? pendingLogo : kit.logo) ? "none" : "";
    q("#cc-br-pv-tag").textContent = q("#cc-br-tag").value.trim();
  };
  ["#cc-br-name", "#cc-br-tag", "#cc-br-p", "#cc-br-p-on", "#cc-br-s", "#cc-br-s-on"].forEach((s) => q(s).addEventListener("input", preview));
  preview();
  const pick = async (file) => { if (!file) return; try { pendingLogo = await fileToLogo(file); renderPanel(el); } catch (e) { toast(e.message, true); } };
  q("#cc-br-drop").addEventListener("click", () => q("#cc-br-file").click());
  q("#cc-br-drop").addEventListener("dragover", (e) => { e.preventDefault(); });
  q("#cc-br-drop").addEventListener("drop", (e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); });
  q("#cc-br-file").addEventListener("change", (e) => pick(e.target.files?.[0]));
  q("#cc-br-save").addEventListener("click", async () => {
    const body = { name: q("#cc-br-name").value, tagline: q("#cc-br-tag").value, primary: q("#cc-br-p-on").checked ? q("#cc-br-p").value : null, secondary: q("#cc-br-s-on").checked ? q("#cc-br-s").value : null };
    if (pendingLogo !== undefined) body.logo = pendingLogo;
    try { const r = await api("/brand", { method: "POST", body }); pendingLogo = undefined; apply(r); renderPanel(el); toast("Brand kit saved"); } catch (e) { toast(e.message, true); }
  });
  q("#cc-br-rmlogo")?.addEventListener("click", async () => { try { pendingLogo = undefined; const r = await api("/brand/logo", { method: "DELETE" }); apply(r); renderPanel(el); toast("Logo removed"); } catch (e) { toast(e.message, true); } });
  q("#cc-br-accent").addEventListener("click", async () => { if (!kit.primary) return; try { if (window.CC.themes?.set) await window.CC.themes.set({ accent: kit.primary }); else await api("/themes", { method: "POST", body: { accent: kit.primary } }); toast("Accent set to the brand colour"); } catch (e) { toast(e.message, true); } });
  q("#cc-br-reset").addEventListener("click", async () => { if (!(await window.CC.confirm("Clear the brand kit (logo, name, colours)?", { danger: true, ok: "Clear" }))) return; try { pendingLogo = undefined; const r = await api("/brand", { method: "DELETE" }); apply(r); renderPanel(el); toast("Brand kit cleared"); } catch (e) { toast(e.message, true); } });
}

apply(kit);
window.CC.brand = { apply, kit: () => ({ ...kit }) };

CC.register({
  id: "brand",
  settings: { order: 6, render: renderPanel },
  onState() { if (!synced) sync(); },
});
if (S.providers.length && !synced) sync();
