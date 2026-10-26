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
    input.setAttribute("aria-label", label);
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "primary";
    ok.textContent = opts.ok || "OK";
    row.append(cancel, ok);
    box.append(lab, input, row);
    wrap.append(box);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      wrap.remove();
      try { prior?.focus?.(); } catch { /* the old focus target may be gone */ }
      resolve(v);
    };
    box.addEventListener("submit", (e) => { e.preventDefault(); finish(input.value); });
    cancel.addEventListener("click", () => finish(null));
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) finish(null); });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); finish(null); } });
    document.body.append(wrap);
    input.focus();
    input.select();
  });
}
