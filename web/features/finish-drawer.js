// Finish drawer (0.4.20): "Done? Choose where this goes." One place that really finishes a result:
// Copy, Print, Save as PDF, Save as Word, Save to MindMedia, Publish. Opened by Finish everywhere
// (CC.openFinishDrawer). Nothing is sent: Publish shows a preview first, and unconnected places are practice only.
import "/features/mindmedia-parts.js";
import { plainMarkdown, titleFrom, hasCode } from "/finish-text.js";
const CC = window.CC;
const { api, esc, toast } = CC;

const CSS = `
.fd-back { position: fixed; inset: 0; background: color-mix(in srgb, var(--bg) 60%, transparent); z-index: 9000; display: flex; justify-content: flex-end; }
.fd { width: min(440px, 100%); height: 100%; overflow: auto; box-sizing: border-box; padding: 16px; background: var(--panel-solid, var(--panel)); color: var(--text); border-left: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
.fd h3 { margin: 0; }
.fd .fd-prev { max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: 8px; padding: 8px; font-size: .875rem; color: var(--muted); }
.fd .fd-prev img { max-width: 100%; border-radius: 6px; }
.fd .fd-row { display: flex; flex-wrap: wrap; gap: 8px; }
.fd .fd-h { font-size: .8rem; color: var(--muted); margin: 4px 0 0; }
.fd .fd-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
`;
function style() {
  if (document.getElementById("fd-style")) return;
  const s = document.createElement("style");
  s.id = "fd-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Some webviews do not focus a button when it is clicked, so remember the last clicked control as the place to return to.
let lastClicked = null;
document.addEventListener("click", (e) => { lastClicked = e.target instanceof Element ? e.target.closest("button, a[href], [tabindex]") : null; }, true);
const opener = () => {
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return a;
  return lastClicked && lastClicked.isConnected ? lastClicked : a;
};

const KIND_FOR = { command: "text", text: "text", image: "image", media: "video", remix: "video", site: "site" };

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); return ok;
  }
}

// opts: { kind, text, name, files:[{name,data,mime}], projectId, source, item:{projectId,assetId} }
export function openFinishDrawer(opts = {}) {
  style();
  document.querySelector(".fd-back")?.remove();
  const text = String(opts.text || "");
  const name = String(opts.name || titleFrom(text));
  const shown = plainMarkdown(text);
  const asFiles = hasCode(text);
  const returnTo = opener();
  const back = document.createElement("div");
  back.className = "fd-back";
  const first = (opts.files || [])[0];
  const isImg = first && /^image\//.test(first.mime || "") && first.data;
  const prevHtml = isImg ? `<img alt="" src="${/^data:/.test(first.data) ? esc(first.data) : `data:${esc(first.mime)};base64,${esc(first.data)}`}">` : esc(shown.slice(0, 1500) || (first ? first.name : "Nothing to show yet."));
  back.innerHTML = `<aside class="fd" role="dialog" aria-modal="true" aria-label="Finish"><div class="fd-top"><h3>Done? Choose where this goes.</h3><button type="button" class="btn sm" data-x aria-label="Close">Close</button></div>
    <div class="fd-prev">${prevHtml}</div>
    <div class="fd-h">Keep a copy</div>
    <div class="fd-row"><button type="button" class="btn sm" data-a="copy" ${text ? "" : "disabled"}>Copy</button><button type="button" class="btn sm" data-a="print" ${text ? "" : "disabled"}>Print</button><button type="button" class="btn sm" data-a="pdf" ${text ? "" : "disabled"}>Save as PDF</button><button type="button" class="btn sm" data-a="docx" ${text ? "" : "disabled"}>Save as Word</button>${text && "speechSynthesis" in window ? `<button type="button" class="btn sm" data-a="read">Read aloud</button>` : ""}${asFiles ? `<button type="button" class="btn sm" data-a="files" title="Each code block becomes its own file, kept in MindMedia with a zip.">Save code as files</button>` : ""}</div>
    <div class="fd-h">Keep it in Meldmind</div>
    <div class="fd-row"><button type="button" class="btn sm primary" data-a="save">Save to MindMedia</button></div>
    <div data-saved></div>
    <div class="fd-h">Send it somewhere (you see a preview first)</div>
    <div class="fd-row"><button type="button" class="btn sm primary" data-a="publish">Publish</button><button type="button" class="btn sm" data-a="share" title="Posts a card in Community. Nothing else is sent.">Share to Community</button></div>
    <div data-pub></div></aside>`;
  document.body.appendChild(back);
  const box = back.querySelector(".fd");
  const close = () => { back.remove(); try { window.speechSynthesis?.cancel(); } catch {} if (returnTo && returnTo.isConnected) returnTo.focus?.(); };
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  box.querySelector("[data-x]").addEventListener("click", close);
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    if (e.key !== "Tab") return;
    const els = [...box.querySelectorAll("button:not([disabled]), a[href], input, textarea, select")].filter((x) => x.offsetParent !== null);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); els[els.length - 1].focus(); } else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
  });
  box.querySelector("[data-x]").focus();

  let saved = opts.item || null;
  const keep = async () => {
    if (saved) return saved;
    const kind = opts.kind && KIND_FOR[opts.kind] || (first ? undefined : "text");
    const r = await CC.saveToMindMedia({ kind, text: first ? undefined : text, files: first ? opts.files : undefined, projectId: opts.projectId, source: opts.source || "Finish", name, quiet: true });
    const it = r.items?.[0] || {};
    saved = { projectId: r.projectId, assetId: it.id || it.assetId, kind: it.kind || kind };
    box.querySelector("[data-saved]").replaceChildren(CC.resultCard({ what: "Saved", savedWhere: `Saved in MindMedia, ${r.where || "Unfiled"}.`, item: saved }));
    return saved;
  };
  const download = (r) => { const bin = atob(r.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); CC.downloadBlob(URL.createObjectURL(new Blob([u8], { type: r.mime })), r.name); };
  const act = {
    copy: async () => toast(await copy(text) ? "Copied." : "Copy did not work here.", false),
    print: () => {
      const w = window.open("", "_blank");
      if (!w) return toast("Your browser blocked the print window. Use Save as PDF instead.", true);
      const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      w.document.write(`<title>${esc(name)}</title><h1 style="font:600 ${Math.round(px * 1.5)}px system-ui">${esc(name)}</h1><div style="font:${Math.round(px)}px/1.5 system-ui;white-space:pre-wrap">${esc(shown)}</div>`); w.document.close(); w.focus(); w.print();
    },
    pdf: async () => download(await api("/mindmedia/export", { method: "POST", body: { text, title: name, format: "pdf" } })),
    docx: async () => download(await api("/mindmedia/export", { method: "POST", body: { text, title: name, format: "docx" } })),
    read: () => {
      const ss = window.speechSynthesis;
      if (!ss) return toast("Reading aloud is not available here.", true);
      if (ss.speaking) { ss.cancel(); return; }
      ss.speak(new SpeechSynthesisUtterance(shown.slice(0, 4000)));
    },
    files: async () => {
      const r = await api("/mindmedia/code-files", { method: "POST", body: { text, projectId: opts.projectId, source: opts.source || "Finish" } });
      box.querySelector("[data-saved]").replaceChildren(CC.resultCard({ what: "Saved", savedWhere: r.savedWhere, item: { projectId: r.projectId, assetId: r.items?.[0]?.id } }));
      toast(r.savedWhere);
    },
    save: async () => { await keep(); toast("Saved in MindMedia."); },
    share: async () => {
      const it = await keep();
      await CC.shareMindMediaItem?.({ projectId: it.projectId, assetId: it.assetId, name, text });
    },
    publish: async () => {
      const it = await keep();
      CC.publishPanel(box.querySelector("[data-pub]"), { projectId: it.projectId, assetId: it.assetId, kind: it.kind, title: name });
    },
  };
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || b.closest("[data-pub]") || !Object.prototype.hasOwnProperty.call(act, b.dataset.a)) return; // the Publish panel owns its own buttons
    try { await act[b.dataset.a](); } catch (er) { toast(er.message || "That did not work.", true); }
  });
  return { close, el: box };
}

CC.openFinishDrawer = openFinishDrawer;
CC.register({ id: "finish-drawer" });
