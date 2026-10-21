// Every button that calls the server shows it is working: a spinner, "Working..." (or
// "Searching..." for Find and Search buttons), and it is disabled until the call ends.
// api() in app.js calls trackBusy for any request that starts inside a click, so
// handlers do not need to opt in. withBusy is the explicit form for longer jobs.
export const WORKING = "Working...";
export const SEARCHING = "Searching...";
export const DONE = "Done";

// The label a busy button shows. data-busy-label wins; Find/Search/Scan read as searching.
export function busyLabel(btn) {
  const own = btn?.dataset?.busyLabel;
  if (own) return own;
  const text = String(btn?.textContent || "").trim();
  if (/\b(find|search|look|scan)/i.test(text)) return SEARCHING;
  return WORKING;
}

const state = new WeakMap();

export function setBusy(btn, on, label) {
  if (!btn || !btn.isConnected && on) return;
  const st = state.get(btn) || { count: 0, html: null };
  if (on) {
    if (st.count === 0) {
      st.html = btn.innerHTML;
      st.disabled = btn.disabled;
      btn.disabled = true;
      btn.classList.add("busy");
      btn.setAttribute("aria-busy", "true");
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label || busyLabel(btn)}`;
    }
    st.count += 1;
    state.set(btn, st);
    return;
  }
  if (!st.count) return;
  st.count -= 1;
  if (st.count) return;
  state.delete(btn);
  if (!btn.isConnected) return;
  btn.innerHTML = st.html;
  btn.disabled = !!st.disabled;
  btn.classList.remove("busy");
  btn.removeAttribute("aria-busy");
}

// A short "Done" on the button when the click ended without any other visible answer
// (no toast, and the button was not re-rendered away). No button looks like it did nothing.
export function flashDone(btn, ms = 1200) {
  if (!btn || !btn.isConnected || state.get(btn)) return;
  const html = btn.innerHTML;
  btn.classList.add("done");
  btn.textContent = DONE;
  setTimeout(() => { if (btn.isConnected && btn.textContent === DONE) { btn.innerHTML = html; btn.classList.remove("done"); } }, ms);
}

export async function withBusy(btn, fn, label) {
  if (btn && state.get(btn)) return undefined; // a second click while working does nothing new
  setBusy(btn, true, label);
  try { return await fn(); }
  finally { setBusy(btn, false); }
}

// Click tracking: the button clicked in this task, so api() can mark it busy.
let clicked = null;
let toasts = 0;
export const noteToast = () => { toasts += 1; };
export function installClickTracking(doc = document) {
  doc.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button, .btn, [role=button]");
    if (!btn || btn.disabled) return;
    clicked = { btn, toasts };
    setTimeout(() => { if (clicked?.btn === btn) clicked = null; }, 0);
  }, true);
}
export const clickedButton = () => clicked?.btn || null;

// Wrap one request started by a click: busy while it runs, "Done" if nothing else showed.
export function trackBusy(promise) {
  const c = clicked;
  if (!c) return promise;
  setBusy(c.btn, true);
  return promise.then(
    (v) => { setBusy(c.btn, false); setTimeout(() => { if (toasts === c.toasts) flashDone(c.btn); }, 400); return v; },
    (e) => { setBusy(c.btn, false); throw e; },
  );
}
