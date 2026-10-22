// Buttons that call the server. api() in app.js calls trackBusy for any request that
// starts inside a click: the button is disabled at once (no double submits) and keeps its
// own label. Only a slow call (over SPINNER_DELAY_MS) adds a small spinner. No "Done" flash.
// Page buttons (top tabs, nav menus, mobile nav) are never marked: switching pages is not
// a job (Chris, 2026-10-21: the Working.../Done swap on the top menu felt clunky).
// withBusy is the explicit form for long jobs: spinner plus "Working..." or "Searching...".
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

// A short "Done" on a button. Not used automatically any more; available for a button
// whose result is otherwise invisible.
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

// Page buttons: anything that only switches the view. Never marked busy.
const NAV_PARENTS = "#tabs, .tabs, .nav-menu, #mobile-nav, #mobile-more, [role=tablist]";
export function isNavButton(btn) {
  if (!btn) return false;
  const d = btn.dataset || {};
  if (d.view !== undefined || d.day !== undefined || d.noBusy !== undefined) return true;
  if (btn.getAttribute?.("role") === "tab") return true;
  return !!btn.parentElement?.closest?.(NAV_PARENTS);
}

export const SPINNER_DELAY_MS = 500;
const held = new WeakMap();

// Disable now, label untouched; a spinner joins the label only if the call is slow.
function hold(btn, on, delay = SPINNER_DELAY_MS) {
  const h = held.get(btn) || { count: 0 };
  if (on) {
    if (h.count === 0) {
      h.disabled = btn.disabled;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      h.timer = setTimeout(() => {
        if (!btn.isConnected || !held.get(btn)) return;
        h.html = btn.innerHTML;
        h.shown = true;
        btn.classList.add("busy");
        btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${h.html}`;
      }, delay);
    }
    h.count += 1;
    held.set(btn, h);
    return;
  }
  if (!h.count) return;
  h.count -= 1;
  if (h.count) return;
  clearTimeout(h.timer);
  held.delete(btn);
  if (!btn.isConnected) return;
  if (h.shown) { btn.innerHTML = h.html; btn.classList.remove("busy"); }
  btn.disabled = !!h.disabled;
  btn.removeAttribute("aria-busy");
}

// Wrap one request started by a click. Page buttons and buttons already in withBusy are left alone.
export function trackBusy(promise, delay = SPINNER_DELAY_MS) {
  const c = clicked;
  if (!c || isNavButton(c.btn) || state.get(c.btn)) return promise;
  hold(c.btn, true, delay);
  return promise.then(
    (v) => { hold(c.btn, false); return v; },
    (e) => { hold(c.btn, false); throw e; },
  );
}
