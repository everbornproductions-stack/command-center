// The finished result card on the page (0.4.21, L-easy). Pure rules live in /result-hero.js.
//   CC.resultHero.actionsHtml(t)       -> main button, quick options and "More" for a made picture, video or voice
//   CC.resultHero.mount(host, opts)    -> a big result card for text results: { kind: site|campaign|document, text, name, title }
//   CC.resultHero.addButton({ id, label, kinds?, onClick(ctx) })  -> other modules add a button under "More"
//   CC.resultHero.refresh()            -> look again at what is connected
import { heroPlan, addButton, hookButtons, normalKind, mainAction, usableRoutes, guessKind } from "/result-hero.js";
const CC = window.CC;
const { api, esc, toast } = CC;

const CSS = `
.rh-main-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rh-quick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rh-quick-h { font-size: .8rem; color: var(--muted); }
.rh-more summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
.rh-more .rh-more-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.rh-note { color: var(--muted); font-size: .8rem; }
.rh-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--line-2, var(--line)); border-radius: var(--radius, 10px); background: var(--panel-solid, transparent); color: var(--text); }
.rh-card .rh-body { max-height: 60vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .95rem; }
.rh-card iframe.rh-site { width: 100%; height: 60vh; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.rh-card h4 { margin: 0; }
`;
if (!document.getElementById("rh-css")) { const s = document.createElement("style"); s.id = "rh-css"; s.textContent = CSS; document.head.appendChild(s); }

let channels = [];
let loaded = null;
async function refresh() {
  try { const r = await api("/publish/channels"); channels = Array.isArray(r) ? r : []; } catch { channels = []; }
  return channels;
}
const ready = () => (loaded ||= refresh());

// ---- buttons for a made picture, video or voice (used by make-chat tiles) ----
function actionsHtml(t) {
  ready();
  const plan = heroPlan({ kind: t.kind, prompt: t.root || t.request, channels, saved: true });
  const mainCls = plan.main.id === "download" ? "mk-dl" : plan.main.id === "publish" ? "mk-publish" : "mk-post";
  const quick = plan.quick.length ? `<div class="rh-quick" role="group" aria-label="Quick changes"><span class="rh-quick-h">Quick changes:</span>${plan.quick.map((o) => `<button type="button" class="btn sm rh-q" data-rh-change="${esc(o.change)}" data-rh-id="${esc(o.id)}">${esc(o.label)}</button>`).join("")}</div>` : "";
  const moreBtn = (m) => m.id === "download" ? `<button type="button" data-mk="dl" class="btn sm mk-dl">${esc(m.label)}</button>`
    : m.id === "open" ? `<button type="button" data-mk="open" class="btn sm mk-open">${esc(m.label)}</button>`
    : m.id === "again" ? `<button type="button" data-mk="again" class="btn sm mk-again">${esc(m.label)}</button>`
    : m.id === "post" ? `<button type="button" class="btn sm rh-route" data-rh-route>${esc(m.label)}</button>`
    : `<button type="button" class="btn sm rh-hook" data-rh-hook="${esc(m.id)}">${esc(m.label)}</button>`;
  return `<div class="rh-main-row"><button type="button" data-mk="${plan.main.id === "download" ? "dl" : "route"}" class="btn sm primary rh-main ${mainCls}">${esc(plan.main.label)}</button><span class="rh-note">Saved in MindMedia.</span></div>
    ${quick}
    <details class="rh-more"><summary>More</summary><div class="rh-more-row">${plan.more.map(moreBtn).join("")}</div></details>`;
}

// Handles clicks on the quick options, routes and hook buttons. ctx: { tile, change(text), openRoute() }
function handleClick(e, ctx) {
  const q = e.target.closest("[data-rh-change]");
  if (q) { ctx.change(q.dataset.rhChange); return true; }
  const hook = e.target.closest("[data-rh-hook]");
  if (hook) { hookButtons(ctx.tile.kind).find((h) => h.id === hook.dataset.rhHook)?.onClick(ctx.tile); return true; }
  if (e.target.closest("[data-rh-route], .mk-publish, .mk-post, [data-mk=route]")) { ctx.openRoute(); return true; }
  return false;
}

// Save, then open the normal Publish preview. Nothing is sent from here.
async function openRoute(opts) {
  const k = normalKind(opts.kind);
  const routes = usableRoutes(await ready().then(() => channels), k);
  if (!routes.length) { toast("Nothing is connected to send this to yet. Connect a place in Settings, then try again.", true); return; }
  if (opts.projectId && opts.assetId && CC.publishPanel) {
    const box = opts.box || document.body.appendChild(Object.assign(document.createElement("div"), { className: "rh-pubbox" }));
    CC.publishPanel(box, { projectId: opts.projectId, assetId: opts.assetId, kind: opts.mmKind || undefined, title: opts.name });
    return;
  }
  CC.openFinishDrawer?.({ kind: k === "site" ? "site" : "command", text: opts.text || "", name: opts.name, source: "Finish" });
}

// ---- a big result card for text results: a site, a campaign, a document ----
function mount(host, opts = {}) {
  if (!host) return null;
  const kind = normalKind(opts.kind);
  let text = String(opts.text || "");
  if (!text.trim()) return null;
  ready().then(() => {
    host.querySelector(":scope > .rh-card")?.remove();
    const main = mainAction(kind, channels);
    const plan = heroPlan({ kind, prompt: text, channels, saved: false });
    const isHtml = kind === "site" && /<html|<!doctype/i.test(text);
    const el = document.createElement("section");
    el.className = "rh-card";
    el.dataset.kind = kind;
    el.setAttribute("aria-label", "Finished result");
    el.innerHTML = `<h4>${esc(opts.title || opts.name || "Your finished result")}</h4>
      ${isHtml ? `<iframe class="rh-site" sandbox title="Preview of your site"></iframe>` : `<div class="rh-body">${esc(text.slice(0, 20000))}</div>`}
      <div class="rh-main-row"><button type="button" class="btn sm primary rh-main" data-rh-main="${main.id}">${esc(main.label)}</button><span class="rh-note">${esc(main.note || "Saved to MindMedia when you press a button.")}</span></div>
      <details class="rh-more"><summary>More</summary><div class="rh-more-row">${plan.more.filter((m) => m.id !== "open" && m.id !== "again").map((m) => `<button type="button" class="btn sm" data-rh-more="${esc(m.id)}">${esc(m.label)}</button>`).join("")}<button type="button" class="btn sm" data-rh-more="finish">All finish choices</button></div></details>`;
    if (isHtml) el.querySelector("iframe").srcdoc = text;
    host.appendChild(el);
    const save = async () => {
      if (opts.item) return opts.item;
      const r = await CC.saveToMindMedia({ kind: kind === "site" ? "site" : "text", text, projectId: opts.projectId, source: opts.source || "Result", name: opts.name || opts.title || undefined, quiet: true });
      const it = r?.items?.[0] || {};
      opts.item = { projectId: r?.projectId, assetId: it.id || it.assetId };
      return opts.item;
    };
    const download = async () => {
      const nm = String(opts.name || opts.title || "Meldmind result").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Meldmind result";
      if (kind === "site") { CC.downloadBlob(URL.createObjectURL(new Blob([text], { type: "text/html" })), `${nm}.html`); return; }
      const r = await api("/mindmedia/export", { method: "POST", body: { text, title: nm, format: "docx" } }).catch(() => null);
      if (!r?.data) { CC.openFinishDrawer?.({ kind: "command", text, name: opts.name, source: "Finish" }); return; }
      const bin = atob(r.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      CC.downloadBlob(URL.createObjectURL(new Blob([u8], { type: r.mime })), r.name);
    };
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-rh-main],[data-rh-more]"); if (!b) return;
      const id = b.dataset.rhMain || b.dataset.rhMore;
      try {
        if ((kind === "site" || kind === "mod") && ["download", "publish", "post"].includes(id)) { const sg = await CC.safety?.beforeShare?.({ kind, text, name: opts.name, projectId: opts.projectId, action: id === "download" ? "download" : "publish" }); if (sg === false) return; if (typeof sg === "string") text = sg; } // Safety check step
        if (id === "download") { await save().catch(() => {}); await download(); }
        else if (id === "publish" || id === "post") { const it = await save(); await openRoute({ kind, text, name: opts.name, box: el.querySelector(".rh-pubbox") || el.appendChild(Object.assign(document.createElement("div"), { className: "rh-pubbox" })), ...it }); }
        else if (id === "finish") CC.openFinishDrawer?.({ kind: kind === "site" ? "site" : "command", text, name: opts.name, source: "Finish" });
        else { const h = hookButtons(kind).find((x) => x.id === id); h?.onClick({ kind, text, name: opts.name, item: opts.item }); }
      } catch (er) { toast(er.message || "That did not work.", true); }
    });
  });
  return host;
}

CC.resultHero = { actionsHtml, handleClick, openRoute, mount, addButton, refresh: async () => { loaded = null; return ready(); }, routes: (kind) => usableRoutes(channels, kind) };
// Under a chat answer: a website or a campaign gets the big card with ONE main button (Publish or Post).
// A plain answer keeps the Looks good / Edit further pair from the finish path.
CC.register?.({
  id: "result-hero",
  deliverable: { order: 11.6, render(el, run) {
    el.querySelector(":scope > .rh-card")?.remove();
    if (!run?.id || !run.deliverable) return;
    const kind = guessKind(run.deliverable);
    if (kind === "document") return;
    mount(el, { kind, text: run.deliverable, title: String(run.title || run.prompt || "").slice(0, 60), name: String(run.title || run.prompt || "").slice(0, 60), source: "Answer" });
  } },
});
