// Suggestions while typing, under the Simple chat box and the Expert Marching orders box (0.4.17).
// Nothing shows until a few letters are typed. The server ranks prompts by the typed words and
// what is being made (server/prompts/suggest.js); unrelated prompts are never shown to fill space.
// A clear intent leads with a direct action ("Make an image: fantasy dragon") that opens the page
// with the words filled in. Nothing runs until the person clicks there. Picking a prompt keeps the
// typed words, and Undo puts back exactly what was typed.
//
// The list sits right under the box. It is a listbox: the box keeps focus and points at the active
// row with aria-activedescendant. Arrow Down from the end of the box enters the list, Up and Down
// move, Enter picks, Escape hides it for this text. Ctrl+Enter still sends. The X turns suggestions
// off (cc.ppSuggestOff), and Settings turns them back on.
import { applySuggestion, makeBetter, rowsFor, setSuggestionsOff, shouldSuggest, suggestionsOff, templateInputs, undoState, undoText } from "../prompt-suggest.js";

const CC = window.CC;
const { api, toast, esc } = CC;
const LIST_ID = "cc-suggest-list";

const STYLE = `
#cc-suggest:empty { display: none; }
#cc-suggest .psg { margin-top: 4px; border: 1px solid var(--line-2, #2b3a52); border-radius: 10px; padding: 4px; background: var(--panel-solid, #0d1420); }
#cc-suggest [role="listbox"] { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
#cc-suggest [role="option"] { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
#cc-suggest [role="option"]:hover, #cc-suggest [role="option"].active { background: var(--accent-soft, #22d3ee22); outline: 1px solid var(--accent, #22d3ee); }
#cc-suggest [role="option"][data-psg-action] { font-weight: 650; }
#cc-suggest .psg-tag { margin-left: auto; font-size: 0.75rem; color: var(--muted, #8b95a7); border: 1px solid var(--line, #1f2937); border-radius: 999px; padding: 0 8px; }
#cc-suggest .psg-new { font-size: 0.75rem; color: var(--muted, #8b95a7); }
#cc-suggest .psg-foot { display: flex; gap: 8px; align-items: center; padding: 4px 8px 2px; }
#cc-suggest .psg-foot [data-psg-off] { margin-left: auto; }
#cc-suggest .psg-undo { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
`;
if (!document.getElementById("cc-suggest-style")) {
  const s = document.createElement("style");
  s.id = "cc-suggest-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

const store = (() => { try { return window.localStorage; } catch { return null; } })();
const st = { timer: 0, seq: 0, data: null, typed: "", hiddenFor: "", undo: null, pack: null, applying: false, active: -1, rows: [] };

const box = () => document.getElementById("orders");
const holder = () => document.getElementById("cc-suggest");

function setExpanded(open) {
  const el = box();
  if (!el) return;
  el.setAttribute("aria-controls", LIST_ID);
  el.setAttribute("aria-expanded", String(!!open));
  if (!open) { el.removeAttribute("aria-activedescendant"); st.active = -1; }
}

function setBox(value) {
  const el = box();
  if (!el) return;
  st.applying = true;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  st.applying = false;
  CC.S.lastOrders = value;
  el.focus();
}

function clear() {
  const h = holder();
  if (h) h.innerHTML = "";
  st.rows = [];
  setExpanded(false);
}

function options() {
  return [...(holder()?.querySelectorAll('[role="option"]') || [])];
}

function setActive(i) {
  const list = options();
  const el = box();
  if (!list.length || !el) return;
  st.active = i;
  list.forEach((o, k) => { o.classList.toggle("active", k === i); o.setAttribute("aria-selected", String(k === i)); });
  if (i >= 0 && list[i]) { el.setAttribute("aria-activedescendant", list[i].id); list[i].scrollIntoView?.({ block: "nearest" }); }
  else el.removeAttribute("aria-activedescendant");
}

function paintUndo(message) {
  const h = holder();
  if (!h) return;
  setExpanded(false);
  st.rows = [];
  h.innerHTML = `<div class="psg-undo small" role="status"><span>${esc(message || "Your words are kept.")}</span><button type="button" class="btn sm" data-psg-undo>Undo</button></div>`;
  h.querySelector("[data-psg-undo]").addEventListener("click", undo);
}

function undo() {
  if (st.pack) { if (CC.promptPack === st.pack) CC.promptPack = null; st.pack = null; }
  if (st.undo) {
    const before = undoText(st.undo);
    st.undo = null;
    setBox(before);
  }
  clear();
  toast("Back to what you typed.");
  look();
}

function paint(data, typed) {
  const h = holder();
  if (!h) return;
  const rows = rowsFor(data);
  if (!rows.length) { clear(); return; }
  rows.push({ type: "better", label: "Make it better", tag: "Rewrite" });
  st.rows = rows;
  st.typed = typed;
  const li = rows.map((r, i) => {
    const attr = r.type === "action" ? "data-psg-action" : r.type === "better" ? "data-psg-better" : `data-psg-item="${i}"`;
    const title = r.type === "item" ? ` title="${esc(r.item.prompt || r.item.title)}"` : r.type === "better" ? ` title="Rewrite your words as a stronger prompt. You can undo it."` : "";
    const fresh = r.type === "item" && r.item.fresh ? ` <span class="psg-new">New</span>` : "";
    const tag = r.tag ? `<span class="psg-tag">${esc(r.tag)}</span>` : "";
    return `<li role="option" id="psg-opt-${i}" aria-selected="false" ${attr}${title}><span>${esc(r.label)}</span>${fresh}${tag}</li>`;
  }).join("");
  h.innerHTML = `<div class="psg"><ul id="${LIST_ID}" role="listbox" aria-label="Suggestions for what you typed">${li}</ul>
    <div class="psg-foot dim small"><span>Picking one keeps your words. Nothing is sent until you click Send.</span><button type="button" class="ghost small" data-psg-off aria-label="Turn off prompt suggestions" title="Turn off prompt suggestions. Turn them back on in Settings.">X</button></div></div>`;
  options().forEach((o, i) => {
    o.addEventListener("mousedown", (e) => e.preventDefault());
    o.addEventListener("click", () => choose(i));
  });
  h.querySelector("[data-psg-off]").addEventListener("click", turnOff);
  setExpanded(true);
  st.active = -1;
}

function choose(i) {
  const row = st.rows[i];
  if (!row) return;
  const typed = st.typed;
  if (row.type === "action") return runAction(st.data?.action);
  if (row.type === "better") return better(typed, st.data);
  return pick(row.item, typed, st.data);
}

function hide() {
  st.hiddenFor = (box()?.value || "").trim();
  clear();
  box()?.focus();
}

function turnOff() {
  setSuggestionsOff(store, true);
  clear();
  box()?.focus();
  toast("Prompt suggestions are off. Turn them back on in Settings.");
}

async function look() {
  const el = box();
  if (!el) return;
  const typed = el.value;
  const mine = ++st.seq;
  if (suggestionsOff(store) || !shouldSuggest(typed) || typed.trim() === st.hiddenFor) { clear(); return; }
  let data = null;
  try { data = await api(`/prompts/suggest?text=${encodeURIComponent(typed.trim().slice(0, 1500))}`); }
  catch { data = null; }
  if (mine !== st.seq || box()?.value !== typed) return;
  st.data = data;
  paint(data, typed);
}

function after(view, test, fill) {
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    const el = test();
    if (el) { fill(el); clearInterval(t); }
    if (tries >= 30) clearInterval(t);
  }, 150);
  CC.go(view);
}

function runAction(action) {
  if (!action) return;
  const text = action.text || box()?.value || "";
  if (action.view === "images") {
    CC._imagePrefill = { op: "generate", prompt: text };
    CC.go("images");
    toast("Images is open with your words. The price shows first. Nothing runs until you click Generate.");
    return;
  }
  if (action.view === "media") {
    CC._mediaPrefill = { kind: action.kind || "video", prompt: text };
    CC.go("media");
    setTimeout(() => { CC._mediaPrefill = null; }, 1500);
    toast("Media is open with your words. The estimate shows first. Nothing runs until you click Generate.");
    return;
  }
  if (action.view === "webbuilders") {
    after("webbuilders", () => document.getElementById("bd-notice"), (input) => {
      input.value = text;
      document.getElementById("bd-suggest-go")?.click();
    });
    toast("Builders is open with your words. Nothing is sent until you click Publish.");
  }
}

function openPlan(plan, typed) {
  try {
    if (plan.storageKey) sessionStorage.setItem(plan.storageKey, typed);
    if (plan.openKey && plan.id) sessionStorage.setItem(plan.openKey, plan.id);
  } catch { /* the page can still open */ }
  if (plan.kind === "builder") {
    after("builders", () => document.querySelector(`[data-open="${CSS.escape(plan.id || "")}"]`), (btn) => {
      const need = document.getElementById("builders-need");
      if (need) need.value = typed;
      btn.click();
      const field = document.querySelector('#builders-form [data-field="text"]');
      if (field) field.value = typed;
    });
    toast("Opening the builder with your words. Nothing is sent.");
    return;
  }
  after("remix", () => document.getElementById("remix-idea"), (idea) => {
    idea.value = typed;
    idea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  toast("Opening Remix with your words. Nothing is sent.");
}

async function pick(item, typed, data) {
  if (!item) return;
  if (item.kind === "builder" || item.builder || item.feature === "remix") {
    try {
      const r = await api("/prompts/open", { method: "POST", body: { id: item.id, features: (CC.features || []).map((f) => f.id) } });
      if (r.plan && r.plan.kind !== "chat") { openPlan(r.plan, typed.trim()); return; }
    } catch (e) { toast(e.message, true); return; }
  }
  if (item.kind === "template") {
    // A Pro prompt shapes the answer. The box keeps the typed words exactly, and one of the
    // prompt's own fields is filled from them.
    const { inputs, field } = templateInputs(item, typed, data?.subject || "");
    st.pack = { templateId: item.id, inputs, applied: true, removed: false, fromSuggest: true };
    CC.promptPack = st.pack;
    st.undo = null;
    paintUndo(`Using the Pro prompt ${item.title}${field ? `, with your words as ${field.label}` : ""}. Your words are kept.`);
    return;
  }
  const next = applySuggestion(typed, item, data?.subject || "");
  st.undo = undoState(typed, next);
  setBox(next);
  paintUndo("Added to your words. Fill any [blanks] you like.");
}

function better(typed, data) {
  const next = makeBetter(typed, data?.intent || null, data?.subject || "");
  if (!next) return;
  st.undo = undoState(typed, next);
  setBox(next);
  paintUndo("Rewritten as a stronger prompt. Your words are at the end.");
}

// Keys on the box. Ctrl or Cmd with Enter is never taken here, so it still sends.
function onKey(e) {
  const el = e.currentTarget;
  if (!st.rows.length || e.isComposing) return;
  const count = options().length;
  if (e.key === "Escape") { e.preventDefault(); hide(); return; }
  if (e.key === "ArrowDown") {
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (st.active < 0 && !atEnd) return;
    e.preventDefault();
    setActive(Math.min(count - 1, st.active + 1));
    return;
  }
  if (e.key === "ArrowUp" && st.active >= 0) {
    e.preventDefault();
    setActive(st.active - 1);
    return;
  }
  if (e.key === "Enter" && st.active >= 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    choose(st.active);
  }
}

function attach() {
  const el = box();
  if (!el || el.dataset.psg) return;
  el.dataset.psg = "1";
  holder()?.remove();
  const h = document.createElement("div");
  h.id = "cc-suggest";
  h.setAttribute("aria-live", "polite");
  // Right under the box, above the hint, the starters and the Upload and Voice row.
  el.insertAdjacentElement("afterend", h);
  el.setAttribute("aria-controls", LIST_ID);
  el.setAttribute("aria-expanded", "false");
  el.addEventListener("input", () => {
    if (st.applying) return;
    if (st.undo && el.value !== st.undo.after) st.undo = null;
    if (st.hiddenFor && el.value.trim() !== st.hiddenFor) st.hiddenFor = "";
    st.active = -1;
    clearTimeout(st.timer);
    if (!shouldSuggest(el.value) || suggestionsOff(store)) { st.seq += 1; clear(); return; }
    st.timer = setTimeout(look, 300);
  });
  el.addEventListener("keydown", onKey);
  if (st.undo && el.value === st.undo.after) paintUndo("Your words are kept.");
  else if (shouldSuggest(el.value)) look();
}

const root = document.getElementById("view") || document.body;
new MutationObserver(attach).observe(root, { childList: true, subtree: true });
attach();

function renderSettings(el) {
  const on = !suggestionsOff(store);
  el.innerHTML = `<div class="panel" id="cc-suggest-settings"><h3>Prompt suggestions while typing</h3>
    <label class="row small" style="gap:8px"><input type="checkbox" id="cc-suggest-on" ${on ? "checked" : ""}> Show prompt suggestions under the chat box once I type a few letters</label>
    <div class="dim small" style="margin-top:6px">Saved on this computer. Picking a suggestion keeps your words, and Undo puts them back.</div></div>`;
  el.querySelector("#cc-suggest-on").addEventListener("change", (e) => {
    setSuggestionsOff(store, !e.target.checked);
    toast(e.target.checked ? "Prompt suggestions are on." : "Prompt suggestions are off.");
  });
}

CC.promptSuggest = { look, undo, hide, turnOff };
CC.register({ id: "prompt-suggest", settings: { order: 15, render: renderSettings } });
