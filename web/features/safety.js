// Safety check (0.4.22): a free, local scan that runs BEFORE Publish and BEFORE a download.
//   CC.safety.check({ projectId | files | text, name })   run the scan, returns the result
//   CC.safety.show(host, ctx)                              paint the card (traffic light, grouped issues, Fix it, Rescan)
//   CC.safety.beforeShare({ kind, text, name, action })    the step before download/publish: false = stop, a string = fixed text
// It never blocks, except a LIVE secret: then the person has to press "Publish anyway" (or "Download anyway").
// Settings > "Safety check before publish" turns the step off (on by default).
import { cardHtml, lightHtml } from "/safety-card.js";
const CC = window.CC;
const { api, toast } = CC;

const enabled = () => CC.S?.settings?.safetyCheck !== false;
const bodyOf = (ctx) => (ctx.files ? { files: ctx.files } : ctx.projectId && ctx.text == null ? { projectId: ctx.projectId } : { text: ctx.text, name: ctx.name, projectId: ctx.projectId });

async function check(ctx) {
  return api("/safety/check", { method: "POST", body: bodyOf(ctx) });
}

// Paints the card into host and wires Fix it and Rescan. onChange(result, fixedText) is told after each run.
async function show(host, ctx, opts = {}) {
  const paint = (result, extra = {}) => {
    host.innerHTML = cardHtml(result, { ...extra, extra: opts.extra });
    host.querySelector("[data-sf-rescan]")?.addEventListener("click", rescan);
    host.querySelectorAll("[data-sf-fix]").forEach((b) => b.addEventListener("click", () => fix(b.dataset.sfFix)));
    opts.onChange?.(result, ctx);
    host._result = result;
  };
  const rescan = async () => { host.innerHTML = cardHtml(null); try { paint(await check(ctx)); } catch (e) { host.innerHTML = `<p class="dim">${CC.esc(e.message)}</p>`; } };
  const fix = async (fixId) => {
    try {
      const r = await api("/safety/fix", { method: "POST", body: { ...bodyOf(ctx), fixId } });
      const mine = r.files?.[0];
      if (mine && ctx.text != null && !ctx.files) ctx.text = mine.text; // one pasted result: the patched text replaces it
      if (r.files && ctx.files) for (const f of r.files) { const i = ctx.files.findIndex((x) => x.path === f.path); if (i >= 0) ctx.files[i] = f; else ctx.files.push(f); }
      paint(r.result, { fixMessage: r.message, fixNote: r.note });
    } catch (e) { toast(e.message, true); }
  };
  host.innerHTML = cardHtml(null);
  try { paint(await check(ctx)); } catch (e) { host.innerHTML = `<p class="dim">${CC.esc(e.message)}</p>`; }
  return host;
}

// A small dialog over the page. Resolves false (stop), true (go on), or the fixed text when Fix it changed it.
function dialogFor(ctx, action) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", "Safety check");
    box.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto";
    const inner = document.createElement("div");
    inner.className = "panel"; inner.style.cssText = "max-width:720px;width:100%;padding:18px;margin:auto 0";
    const host = document.createElement("div");
    inner.appendChild(host); box.appendChild(inner); document.body.appendChild(box);
    const done = (v) => { document.removeEventListener("keydown", onKey); box.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    document.addEventListener("keydown", onKey);
    const verb = action === "publish" ? "Publish" : "Download";
    const extra = `<button type="button" class="btn sm" data-sf-go>Continue</button><button type="button" class="btn sm" data-sf-stop>Cancel</button>`;
    const sync = (result) => {
      const red = result?.light === "red";
      const go = host.querySelector("[data-sf-go]");
      if (go) { go.textContent = red ? `${verb} anyway` : "Continue"; go.classList.toggle("danger", red); }
      host.querySelector("[data-sf-go]")?.addEventListener("click", () => done(ctx.text !== ctx.original ? ctx.text : true));
      host.querySelector("[data-sf-stop]")?.addEventListener("click", () => done(false));
    };
    ctx.original = ctx.text;
    show(host, ctx, { extra, onChange: (r) => queueMicrotask(() => sync(r)) });
  });
}

// The step before a download or a publish. Green goes straight on; anything else shows the card first.
async function beforeShare(ctx = {}) {
  if (!enabled()) return true;
  let result;
  try { result = await check(ctx); } catch { return true; } // the check never traps the person
  if (result.light === "green") { toast("Safety check: all clear."); return true; }
  return dialogFor(ctx, ctx.action === "publish" ? "publish" : "download");
}

// 0.4.23 (panel Top 10 #1, audit A1): say what was looked at ("Checked the words to send and 12 project files.").
function previewLineFor(safety) { return safety ? `<div class="sc-prev">Safety check: ${lightHtml(safety.light)}. ${CC.esc(safety.summary)}${safety.checkedLine ? ` <span class="dim">${CC.esc(safety.checkedLine)}</span>` : ""}</div>` : ""; }

// ---- Settings: the toggle ----
function renderSettings(el) {
  const on = enabled();
  el.innerHTML = `<div class="panel" id="safety-panel"><h3>Safety check</h3>
    <label class="row small" style="gap:8px;cursor:pointer;align-items:flex-start"><input type="checkbox" id="sf-on" ${on ? "checked" : ""}><span><b>Safety check before publish</b></span></label>
    <div class="dim small" style="margin-top:4px">Before you publish or download something you built, Meldmind looks for keys, old parts and risky code. It runs on this computer and no code leaves your PC.</div></div>`;
  el.querySelector("#sf-on").addEventListener("change", async (e) => {
    const v = e.target.checked;
    try { const saved = await api("/settings", { method: "POST", body: { safetyCheck: v } }); CC.S.settings = { ...(CC.S.settings || {}), ...(saved || {}), safetyCheck: v }; toast(v ? "Safety check is on." : "Safety check is off."); }
    catch (er) { e.target.checked = !v; toast(er.message, true); }
  });
}

// ---- result card button ----
let added = false;
function addHeroButton() {
  if (added || !CC.resultHero?.addButton) return;
  added = CC.resultHero.addButton({ id: "safety", label: "Safety check", kinds: ["site", "mod"], onClick: (c) => { dialogFor({ text: c.text, name: c.name }, "download").catch(() => {}); } });
}
addHeroButton();

CC.safety = { check, show, beforeShare, previewLine: previewLineFor, enabled };
CC.register({ id: "safety", settings: { order: 40, render: renderSettings }, onState() { addHeroButton(); } });
