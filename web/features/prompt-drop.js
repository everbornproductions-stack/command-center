// The Prompts dropdown under every creation box, plus the video tips panel (flag_promptdrop, 0.4.19).
// A Prompts button sits under the box. It opens a short list: Recent, Saved, Stage, From sources,
// Video. Picking one keeps the words already typed (the same rule as the typing suggestions), and
// Undo puts the box back. Nothing is sent. If the server says the flag is off, nothing is added.
// Loaded only when a page with a creation box opens (web/perf/registry.js).
import { DROP_BOXES, GROUP_LABEL, mergeGroups, pickInto, pushRecent, readRecent, tipsFor } from "../prompt-drop.js";

const CC = window.CC;
const { api, toast, esc } = CC;

const STYLE = `
.pd-wrap { margin-top: 4px; }
.pd-btn[aria-expanded="true"] { outline: 1px solid var(--accent, #22d3ee); }
.pd-panel { margin-top: 4px; border: 1px solid var(--line-2, #2b3a52); border-radius: 10px; padding: 6px; background: var(--panel-solid, #0d1420); max-height: 320px; overflow: auto; }
.pd-panel h4 { margin: 6px 6px 2px; font-size: 0.8rem; color: var(--muted, #8b95a7); font-weight: 650; }
.pd-panel [data-pd-item] { display: flex; width: 100%; gap: 8px; align-items: center; text-align: left; padding: 6px 8px; border-radius: 8px; border: 0; background: transparent; color: inherit; cursor: pointer; }
.pd-panel [data-pd-item]:hover, .pd-panel [data-pd-item]:focus-visible { background: var(--accent-soft, #22d3ee22); outline: 1px solid var(--accent, #22d3ee); }
.pd-tag { margin-left: auto; font-size: 0.75rem; color: var(--muted, #8b95a7); border: 1px solid var(--line, #1f2937); border-radius: 999px; padding: 0 8px; white-space: nowrap; }
.pd-undo { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
.pd-tips { margin-top: 10px; }
.pd-tips ul { margin: 4px 0 8px 18px; padding: 0; }
`;
if (!document.getElementById("cc-pd-style")) {
  const s = document.createElement("style");
  s.id = "cc-pd-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const store = (() => { try { return window.localStorage; } catch { return null; } })();
const st = { on: null, tips: null, probing: null, cache: new Map(), undo: new Map(), retryAt: 0 };

// One cheap request tells us if the flag is on. Only "flag_off" turns the feature off for good.
function probe() {
  if (st.on !== null) return Promise.resolve(st.on);
  if (st.probing) return st.probing;
  if (Date.now() < st.retryAt) return Promise.resolve(false);
  st.probing = api("/prompts/video-tips").then((d) => { st.tips = d; st.on = true; return true; })
    .catch((e) => { if (e?.code === "flag_off") st.on = false; else st.retryAt = Date.now() + 5000; return false; })
    .finally(() => { st.probing = null; });
  return st.probing;
}

const boxEl = (id) => document.getElementById(id);

async function load(stage) {
  const hit = st.cache.get(stage);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const data = await api(`/prompts/drop?stage=${encodeURIComponent(stage)}`);
  st.cache.set(stage, { at: Date.now(), data });
  return data;
}

function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
}

function close(wrap) {
  wrap.querySelector(".pd-panel").hidden = true;
  wrap.querySelector(".pd-btn").setAttribute("aria-expanded", "false");
}

function choose(wrap, id, item) {
  const el = boxEl(id);
  if (!el || !item) return;
  const { next, undo } = pickInto(el.value, item, "");
  st.undo.set(id, undo);
  setValue(el, next);
  pushRecent(store, item);
  const panel = wrap.querySelector(".pd-panel");
  panel.innerHTML = `<div class="pd-undo small" role="status"><span>Added to your words. Fill any [blanks] you like.</span><button type="button" class="btn sm" data-pd-undo>Undo</button></div>`;
  panel.querySelector("[data-pd-undo]").addEventListener("click", () => {
    const u = st.undo.get(id);
    st.undo.delete(id);
    if (u && boxEl(id)) setValue(boxEl(id), u.before);
    toast("Back to what you typed.");
    close(wrap);
  });
}

function paintList(wrap, id, data) {
  const panel = wrap.querySelector(".pd-panel");
  const groups = mergeGroups(data?.groups, readRecent(store));
  if (!groups.length) { panel.innerHTML = `<div class="dim small" style="padding:6px">No prompts for this box yet.</div>`; return; }
  const flat = [];
  panel.innerHTML = groups.map((g) => `<div role="group" aria-label="${esc(GROUP_LABEL[g.id] || g.label)}"><h4>${esc(GROUP_LABEL[g.id] || g.label)}</h4>${g.items.map((it) => {
    flat.push(it);
    const tip = [it.prompt, it.tips && `Tip: ${it.tips}`, it.realism && `Realism: ${it.realism}`].filter(Boolean).join("\n");
    return `<button type="button" data-pd-item="${flat.length - 1}" title="${esc(tip)}"><span>${esc(it.title)}</span><span class="pd-tag">${esc(it.tag || "")}</span></button>`;
  }).join("")}</div>`).join("");
  panel.querySelectorAll("[data-pd-item]").forEach((b) => b.addEventListener("click", () => choose(wrap, id, flat[Number(b.dataset.pdItem)])));
}

async function toggle(wrap, id) {
  const btn = wrap.querySelector(".pd-btn");
  const panel = wrap.querySelector(".pd-panel");
  if (btn.getAttribute("aria-expanded") === "true") { close(wrap); return; }
  btn.setAttribute("aria-expanded", "true");
  panel.hidden = false;
  panel.innerHTML = `<div class="dim small" style="padding:6px">Loading prompts.</div>`;
  let data = null;
  try { data = await load(id); } catch (e) { panel.innerHTML = `<div class="dim small" style="padding:6px">${esc(e.message || "Prompts could not load.")}</div>`; return; }
  if (btn.getAttribute("aria-expanded") === "true") paintList(wrap, id, data);
}

function mountButton(id) {
  const el = boxEl(id);
  if (!el || el.dataset.pd) return;
  el.dataset.pd = "1";
  const wrap = document.createElement("div");
  wrap.className = "pd-wrap";
  wrap.dataset.pdFor = id;
  wrap.innerHTML = `<button type="button" class="btn sm pd-btn" aria-haspopup="true" aria-expanded="false" aria-controls="pd-panel-${esc(id)}" title="Pick a starting prompt. Your words are kept.">Prompts</button><div class="pd-panel" id="pd-panel-${esc(id)}" hidden></div>`;
  wrap.querySelector(".pd-btn").addEventListener("click", () => toggle(wrap, id));
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.querySelector(".pd-btn").getAttribute("aria-expanded") === "true") { e.preventDefault(); close(wrap); wrap.querySelector(".pd-btn").focus(); }
  });
  el.insertAdjacentElement("afterend", wrap);
}

function tipsHtml(label) {
  const first = st.tips?.tools?.[0];
  const options = (st.tips?.tools || []).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  const check = tipsFor(st.tips, first?.id).checklist.map((c) => `<li>${esc(c)}</li>`).join("");
  return `<details class="pd-tips panel" data-pd-tips><summary class="small">${esc(label)}</summary>
    <label class="small" style="display:block;margin-top:6px">Tool <select data-pd-tool style="width:auto">${options}</select></label>
    <ul data-pd-tool-tips class="small"></ul>
    <div class="small"><strong>Realism checklist</strong></div><ul class="small">${check}</ul>
    <div class="dim small">For music video shots, open Prompts and look in the Video group.</div></details>`;
}

function paintToolTips(node) {
  const sel = node.querySelector("[data-pd-tool]");
  const { tool } = tipsFor(st.tips, sel?.value);
  node.querySelector("[data-pd-tool-tips]").innerHTML = (tool?.tips || []).map((t) => `<li>${esc(t)}</li>`).join("");
}

function mountTips(anchor, label) {
  if (!anchor || anchor.parentElement?.querySelector("[data-pd-tips]")) return;
  const holder = document.createElement("div");
  holder.innerHTML = tipsHtml(label);
  const node = holder.firstElementChild;
  anchor.insertAdjacentElement("afterend", node);
  node.querySelector("[data-pd-tool]").addEventListener("change", () => paintToolTips(node));
  paintToolTips(node);
}

function tipsPass() {
  const md = boxEl("md-form");
  if (md) {
    const kind = md.querySelector("#md-kind button.on")?.dataset.k;
    let tips = md.querySelector("[data-pd-tips]");
    if (!tips && kind === "video") {
      const row = boxEl("md-prompt")?.closest("#md-form")?.querySelector(".pd-wrap") || boxEl("md-prompt");
      mountTips(row, "Video tips and realism checklist");
      tips = md.querySelector("[data-pd-tips]");
    }
    if (tips) tips.hidden = kind !== "video";
  }
  const form = boxEl("bd-form");
  if (form && /reel/i.test(form.querySelector("h3")?.textContent || "")) mountTips(form.querySelector("h3"), "Video tips and realism checklist");
}

let queued = false;
function pass() {
  queued = false;
  if (st.on === false) return;
  const need = DROP_BOXES.some((id) => boxEl(id) && !boxEl(id).dataset.pd) || boxEl("md-form") || boxEl("bd-form");
  if (!need) return;
  probe().then((on) => {
    if (!on) return;
    DROP_BOXES.forEach(mountButton);
    tipsPass();
  });
}
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(pass);
}

const root = document.getElementById("view") || document.body;
new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
schedule();

CC.promptDrop = { probe, load };
CC.register({ id: "prompt-drop" });
