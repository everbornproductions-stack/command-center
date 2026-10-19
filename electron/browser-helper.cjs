// Built-in browser helper (Phase 27): the desktop window the AI drives. The server's core
// (server/browser.js) runs in this same process and finds this driver on globalThis.__ccBrowserDriver.
// - Its own session (partition persist:cc-browser-helper): never the person's main browser profile. Sign-ins
//   the person makes here stay in this session only. No permissions (camera, mic, location, notifications)
//   and no downloads.
// - A bar on top (electron/browser-bar.html): the task, the visible action log, the OK / No question with
//   exactly what will happen, and Stop. Closing the window stops the job.
// - The page is read and driven from an isolated world, so the website's own scripts cannot see or move
//   the helper's element references. Clicks are real mouse events at the element's position.
const { BaseWindow, WebContentsView, session, ipcMain } = require("electron");
const path = require("node:path");

const WORLD = 1027;
const BAR = 150, BAR_ASK = 340;

// ---- runs inside the page (isolated world); must not use anything from this file ----
function inPage(op, arg, max) {
  const W = window;
  W.__cc ||= { n: 0, byRef: new Map(), refOf: new WeakMap() };
  const S = W.__cc;
  const CARD = /(cc-|card.?num|cardnumber|cvc|cvv|csc|security.?code|expir|exp.?date|iban|routing|account.?number)/i;
  const sq = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const ref = (el, p) => { let r = S.refOf.get(el); if (!r) { r = p + (++S.n); S.refOf.set(el, r); S.byRef.set(r, new WeakRef(el)); } return r; };
  const get = (r) => S.byRef.get(r)?.deref() || null;
  const visible = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const isPay = (el) => CARD.test(`${el.autocomplete || ""} ${el.name || ""} ${el.id || ""}`);
  const labelOf = (el) => sq(el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || (["submit", "button", "reset"].includes(el.type) ? el.value : "") || el.innerText || el.placeholder || el.title || el.alt || el.name || "").slice(0, 120);
  if (op === "snapshot") {
    const out = [];
    const q = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [contenteditable=""], [contenteditable="true"]';
    for (const el of document.querySelectorAll(q)) {
      if (out.length >= max) break;
      if (el.type === "hidden" || !visible(el)) continue;
      const tag = el.tagName.toLowerCase(), type = (el.type || "").toLowerCase();
      const isLink = tag === "a" || el.getAttribute("role") === "link";
      const isField = (tag === "input" && !["submit", "button", "image", "reset"].includes(type)) || tag === "select" || tag === "textarea" || el.isContentEditable || el.getAttribute("role") === "checkbox";
      const form = el.form || null;
      const e = { ref: ref(el, "e"), tag, kind: isLink ? "link" : isField ? "field" : "button", type: tag === "select" ? "select" : tag === "textarea" ? "textarea" : el.isContentEditable ? "textarea" : type || tag, name: el.name || "", label: labelOf(el), form: form ? ref(form, "f") : null, disabled: !!el.disabled };
      if (isLink && el.href) e.href = el.href;
      if (!isLink && !isField) e.submits = !!form && ((tag === "button" && (el.type || "submit") === "submit") || (tag === "input" && ["submit", "image"].includes(type)));
      if (isField) {
        e.password = type === "password"; e.payment = isPay(el);
        if (type === "checkbox" || type === "radio") e.checked = !!el.checked;
        else if (!e.password && !e.payment) e.value = String(el.isContentEditable ? el.innerText : el.value || "").slice(0, 300);
        if (tag === "select") e.options = [...el.options].slice(0, 12).map((o) => sq(o.text).slice(0, 40));
      }
      out.push(e);
    }
    const forms = [...document.forms].filter((f) => S.refOf.has(f)).map((f) => ({
      ref: S.refOf.get(f), method: (f.method || "get").toUpperCase(), action: f.action || location.href,
      label: sq(f.getAttribute("aria-label") || f.name || f.id || "").slice(0, 80) || (out.find((x) => x.form === S.refOf.get(f) && x.submits) || {}).label || S.refOf.get(f),
      fields: [...f.elements].filter((x) => x.name && !["submit", "button", "image", "reset"].includes(x.type)).slice(0, 40).map((x) => ({
        name: x.name, type: x.type, hidden: x.type === "hidden", ref: S.refOf.get(x) || null,
        value: x.type === "password" || isPay(x) ? "" : x.type === "checkbox" || x.type === "radio" ? (x.checked ? x.value : null) : String(x.value || "").slice(0, 300),
      })),
    }));
    return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : "").slice(0, 12000), elements: out, forms };
  }
  if (op === "point") {
    const el = get(arg);
    if (!el) return { error: "that element is gone from the page (it changed): look again" };
    if (el.disabled) return { error: "that control is disabled" };
    el.scrollIntoView({ block: "center", inline: "center" });
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: b.width, h: b.height };
  }
  if (op === "jsclick") { const el = get(arg); if (!el) return { error: "that element is gone" }; el.click(); return { ok: true }; }
  if (op === "focus") {
    const el = get(arg);
    if (!el) return { error: "that element is gone from the page (it changed): look again" };
    if (el.type === "password" || isPay(el)) return { error: "the helper never types passwords or card details" };
    el.scrollIntoView({ block: "center" }); el.focus();
    if (el.tagName === "SELECT") return { select: true };
    if (el.isContentEditable) { document.execCommand("selectAll"); return { ok: true }; }
    if (typeof el.select === "function") el.select();
    return { ok: true };
  }
  if (op === "choose") {
    const el = get(arg.ref);
    if (!el || el.tagName !== "SELECT") return { error: "that is not a list" };
    const want = String(arg.text).toLowerCase();
    const o = [...el.options].find((x) => x.text.trim().toLowerCase() === want || x.value.toLowerCase() === want) || [...el.options].find((x) => x.text.toLowerCase().includes(want));
    if (!o) return { error: `that list has no choice "${arg.text}"` };
    el.value = o.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  if (op === "submit") {
    const f = get(arg);
    if (!f || f.tagName !== "FORM") return { error: `there is no form ${arg} on this page` };
    if (typeof f.requestSubmit === "function") f.requestSubmit(); else f.submit();
    return { ok: true };
  }
  if (op === "scroll") { window.scrollBy(0, (arg === "up" ? -1 : 1) * Math.round(innerHeight * 0.8)); return { ok: true }; }
  return { error: "unknown operation" };
}

let ipcReady = false;

function createBrowserHelper({ log = () => {}, icon } = {}) {
  let win = null, bar = null, page = null, control = null, lastState = null, barReady = false;
  const ses = session.fromPartition("persist:cc-browser-helper");
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (e) => { e.preventDefault(); log("browser helper: a download was blocked"); });

  function layout() {
    if (!win || win.isDestroyed()) return;
    const b = win.getContentBounds();
    const h = Math.min(b.height - 120, lastState && lastState.approval ? BAR_ASK : BAR);
    bar.setBounds({ x: 0, y: 0, width: b.width, height: h });
    page.setBounds({ x: 0, y: h, width: b.width, height: Math.max(0, b.height - h) });
  }
  function ensure() {
    if (win && !win.isDestroyed()) return;
    win = new BaseWindow({ width: 1180, height: 880, minWidth: 700, minHeight: 500, title: "Command AI browser helper", icon, autoHideMenuBar: true, backgroundColor: "#090d14" });
    bar = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "browser-bar-preload.cjs") } });
    page = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    win.contentView.addChildView(page);
    win.contentView.addChildView(bar);
    layout();
    win.on("resize", layout);
    barReady = false;
    bar.webContents.on("did-finish-load", () => { barReady = true; if (lastState) bar.webContents.send("bar:state", lastState); });
    bar.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    bar.webContents.on("will-navigate", (e) => e.preventDefault());
    bar.webContents.loadFile(path.join(__dirname, "browser-bar.html"));
    // pop-ups open in the same view, so the person always sees where the helper is
    page.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) page.webContents.loadURL(url).catch(() => {}); return { action: "deny" }; });
    page.webContents.loadURL("about:blank").catch(() => {});
    win.on("closed", () => {
      const st = lastState;
      win = bar = page = null; barReady = false;
      if (st && st.job && !["done", "failed"].includes(st.job.status) && control) { try { control.stop(st.job.id); } catch {} }
    });
  }
  const wc = () => { ensure(); return page.webContents; };
  const run = (op, arg) => wc().executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${inPage.toString()})(${JSON.stringify(op)}, ${JSON.stringify(arg ?? null)}, 150)` }], true);
  async function settle(ms = 8000) {
    const w = wc(), t0 = Date.now();
    await new Promise((r) => setTimeout(r, 250));
    while (w.isLoading() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 300));
    return { url: w.getURL(), title: w.getTitle() };
  }
  const check = (r) => { if (r && r.error) throw new Error(r.error); return r; };

  if (!ipcReady) {
    ipcReady = true;
    // only the bar of the helper window may answer: never the website, never another window
    const fromBar = (e) => bar && !bar.webContents.isDestroyed() && e.sender === bar.webContents;
    ipcMain.handle("bar:stop", (e, id) => { if (fromBar(e) && control) control.stop(String(id)); return true; });
    ipcMain.handle("bar:ok", (e, id, aid) => { if (fromBar(e) && control) control.approve(String(id), String(aid)); return true; });
    ipcMain.handle("bar:no", (e, id, aid) => { if (fromBar(e) && control) control.deny(String(id), String(aid)); return true; });
  }

  return {
    kind: "window",
    describe: "its own browser window",
    setControl(c) { control = c; },
    show(state) { ensure(); if (state) this.update(state); win.show(); win.focus(); },
    update(state) {
      lastState = state;
      if (!win || win.isDestroyed()) return;
      layout();
      try { win.setTitle(`Command AI browser helper: ${state.job ? state.job.statusLabel : ""}`); } catch {}
      if (barReady) bar.webContents.send("bar:state", state);
      if (state.approval) { try { win.show(); win.focus(); } catch {} }
    },
    async open(url) {
      try { await wc().loadURL(url); } catch (e) { if (!/ERR_ABORTED/.test(String(e && e.message))) throw new Error(`could not open the page (${String(e && e.message || e).split("\n")[0].slice(0, 120)})`); }
      return settle();
    },
    async snapshot() {
      const w = wc();
      if (w.getURL() === "about:blank" || !w.getURL()) return { url: "about:blank", title: "", text: "", elements: [], forms: [], driver: "window" };
      const s = await run("snapshot");
      return { ...s, driver: "window" };
    },
    async click(ref) {
      const p = check(await run("point", ref));
      const w = wc();
      if (p.w > 0 && p.h > 0) {
        w.sendInputEvent({ type: "mouseMove", x: p.x, y: p.y });
        w.sendInputEvent({ type: "mouseDown", x: p.x, y: p.y, button: "left", clickCount: 1 });
        w.sendInputEvent({ type: "mouseUp", x: p.x, y: p.y, button: "left", clickCount: 1 });
      } else check(await run("jsclick", ref));
      return settle();
    },
    async type(ref, text) {
      const f = check(await run("focus", ref));
      if (f.select) { check(await run("choose", { ref, text })); return { changed: true }; }
      await wc().insertText(String(text));
      return { changed: true };
    },
    async submit(formRef) { check(await run("submit", formRef)); return settle(); },
    async back() {
      const w = wc();
      if (!w.navigationHistory.canGoBack()) throw new Error("there is no page to go back to");
      w.navigationHistory.goBack();
      return settle();
    },
    async scroll(dir) { check(await run("scroll", dir)); return { note: `scrolled ${dir === "up" ? "up" : "down"}` }; },
    close() {},
  };
}

module.exports = { createBrowserHelper };
