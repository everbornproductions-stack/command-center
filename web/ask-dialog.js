import { closeOnEscape } from "./esc-close.js";
// An in-app text box that replaces window.prompt, which the desktop app does not support.
export function askText(label, value = "", opts = {}) {
  return new Promise((resolve) => {
    const prior = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "cc-ask";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)";
    const box = document.createElement("form");
    box.style.cssText = "background:var(--panel-solid,var(--panel,#111827));color:var(--text,#e5e7eb);border:1px solid var(--line-2,#273449);border-radius:12px;padding:16px;width:min(420px,calc(100vw - 32px));display:flex;flex-direction:column;gap:10px;box-shadow:0 16px 40px rgba(0,0,0,.4)";
    const lab = document.createElement("label");
    lab.textContent = label;
    lab.style.fontWeight = "600";
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.style.cssText = "background:var(--field-bg,var(--sunk-bg,#0b1220));color:var(--field-text,var(--text,#e5e7eb));border:1px solid var(--line-2,#273449);border-radius:8px;padding:8px 10px";
    input.setAttribute("aria-label", label);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "btn primary";
    ok.textContent = opts.ok || "OK";
    row.append(cancel, ok);
    box.append(lab, input, row);
    wrap.append(box);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      stopEsc();
      wrap.remove();
      try { prior?.focus?.(); } catch { /* the old focus target may be gone */ }
      resolve(v);
    };
    let stopEsc = () => {};
    box.addEventListener("submit", (e) => { e.preventDefault(); finish(input.value); });
    cancel.addEventListener("click", () => finish(null));
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) finish(null); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); finish(null); } });
    document.body.append(wrap);
    stopEsc = closeOnEscape(wrap, () => finish(null));
    input.focus();
    input.select();
  });
}

// An in-app yes/no box that replaces window.confirm, which the desktop app does not support (0.4.20).
// Resolves true for the main button and false for Cancel, Escape, or a click outside. opts: { ok, cancel, danger }.
export function askConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const prior = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "cc-ask cc-confirm";
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)";
    const box = document.createElement("form");
    box.style.cssText = "background:var(--panel-solid,var(--panel,#111827));color:var(--text,#e5e7eb);border:1px solid var(--line-2,#273449);border-radius:12px;padding:16px;width:min(440px,calc(100vw - 32px));display:flex;flex-direction:column;gap:12px;box-shadow:0 16px 40px rgba(0,0,0,.4)";
    const text = document.createElement("div");
    text.textContent = String(message || "Are you sure?");
    text.style.cssText = "white-space:pre-wrap;line-height:1.45;max-height:60vh;overflow:auto";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = opts.cancel || "Cancel";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = opts.danger ? "btn danger" : "btn primary";
    ok.textContent = opts.ok || "OK";
    row.append(cancel, ok);
    box.append(text, row);
    wrap.append(box);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      stopEsc();
      wrap.remove();
      try { prior?.focus?.(); } catch { /* the old focus target may be gone */ }
      resolve(v);
    };
    let stopEsc = () => {};
    box.addEventListener("submit", (e) => { e.preventDefault(); finish(true); });
    cancel.addEventListener("click", () => finish(false));
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) finish(false); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } });
    document.body.append(wrap);
    stopEsc = closeOnEscape(wrap, () => finish(false));
    // Cancel has focus first for a destructive question, so Enter never deletes by accident.
    (opts.danger ? cancel : ok).focus();
  });
}
