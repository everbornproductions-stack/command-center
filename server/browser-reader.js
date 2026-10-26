// Built-in browser helper (Phase 27): the text reader. The desktop app drives a real browser window
// (electron/browser-helper.cjs). Without the desktop app (npm start, and the tests) the helper reads pages
// with this small fetch-based reader instead: no JavaScript, no window, a cookie jar per job only. It
// offers the same driver calls as the window: open, snapshot, click, type, submit, back, scroll, close.
// Every page it reads is data, never instructions; the helper's core decides what may be done.
import { localFetch } from "./loopback-fetch.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ELEMENTS = 150;
const MAX_TEXT = 12000;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "...", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
export function decode(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ""; } }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

function attrs(src) {
  const out = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const BLOCK = new Set(["p", "div", "br", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "nav", "form", "label", "dt", "dd", "pre", "blockquote", "main", "aside", "fieldset", "legend", "hr"]);
const CARD = /(cc-|card.?num|cardnumber|cvc|cvv|csc|security.?code|expir|exp.?date|iban|routing|account.?number)/i;

// Parse an HTML page into what the helper needs: title, readable text, the things it can click or type
// into (each with a ref like e3), and the forms (f1) with every field that would be sent.
export function parsePage(html, baseUrl) {
  const src = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, (m, tag) => (tag.toLowerCase() === "head" ? (m.match(/<title\b[^>]*>[\s\S]*?<\/title>/i)?.[0] || "") : " "));
  const title = squash(decode((src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""));
  const body = src.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, " ");
  const abs = (u) => { try { return new URL(u, baseUrl).toString(); } catch { return null; } };

  const elements = [], forms = [], labelsFor = {};
  let text = "";
  const stack = []; // open a / button / label / select / textarea / option
  let form = null, n = 0;
  const open = (tag) => [...stack].reverse().find((x) => x.tag === tag);
  const add = (el) => { if (elements.length < MAX_ELEMENTS) { el.ref = `e${++n}`; elements.push(el); } return el; };

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[4] !== undefined) {
      const t = decode(m[4]);
      text += t;
      // the text of a textarea or a list choice belongs to it alone, never to a label or link around it
      const own = [...stack].reverse().find((x) => x.tag === "textarea" || x.tag === "option");
      if (own) own.collect += t;
      else for (const x of stack) if (x.collect !== undefined) x.collect += t;
      continue;
    }
    const close = m[1] === "/", tag = m[2].toLowerCase(), a = close ? {} : attrs(m[3]);
    if (BLOCK.has(tag)) text += "\n";
    if (close) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        const x = stack.splice(i, 1)[0];
        const label = squash(x.collect);
        if (x.el) {
          if (x.tag === "textarea") x.el.value = x.collect.trim().slice(0, 2000);
          else if (x.tag === "select") { /* value set by options */ }
          else x.el.label ||= label.slice(0, 120);
        }
        if (x.tag === "option" && x.select) { x.select.options.push({ value: x.value ?? label, label }); if (x.selected || x.select.value === undefined) x.select.value = x.value ?? label; }
        if (x.tag === "label") { x.text = label; if (x.for) labelsFor[x.for] = label; for (const el of x.inside || []) el.label ||= label.slice(0, 120); }
        break;
      }
      if (tag === "form") form = null;
      continue;
    }
    if (tag === "form") {
      form = { ref: `f${forms.length + 1}`, method: (a.method || "get").toLowerCase() === "post" ? "POST" : "GET", action: abs(a.action || baseUrl) || baseUrl, label: a["aria-label"] || a.name || a.id || "", fields: [] };
      forms.push(form);
      continue;
    }
    const inForm = form ? form.ref : null;
    const lab = open("label");
    if (tag === "a" && a.href !== undefined) {
      const href = abs(a.href);
      const el = add({ tag: "a", kind: "link", href, label: a["aria-label"] || a.title || "", form: null });
      stack.push({ tag: "a", el, collect: "" });
      continue;
    }
    if (tag === "button") {
      const type = (a.type || "submit").toLowerCase();
      const el = add({ tag: "button", kind: "button", type, name: a.name || "", value: a.value || "", label: a["aria-label"] || a.title || "", form: inForm, submits: !!inForm && type === "submit", disabled: a.disabled !== undefined });
      stack.push({ tag: "button", el, collect: "" });
      continue;
    }
    if (tag === "input") {
      const type = (a.type || "text").toLowerCase();
      if (type === "hidden") { if (form && a.name) form.fields.push({ name: a.name, type, value: a.value || "", hidden: true }); continue; }
      if (["submit", "image", "button", "reset"].includes(type)) {
        add({ tag: "input", kind: "button", type, name: a.name || "", value: a.value || "", label: a.value || a["aria-label"] || a.alt || (type === "submit" ? "Submit" : type), form: inForm, submits: !!inForm && (type === "submit" || type === "image"), disabled: a.disabled !== undefined });
        continue;
      }
      const checkable = type === "checkbox" || type === "radio";
      const el = add({ tag: "input", kind: "field", type, name: a.name || "", id: a.id || "", value: checkable ? (a.value || "on") : (a.value || ""), checked: a.checked !== undefined, label: a["aria-label"] || a.placeholder || a.title || "", form: inForm, password: type === "password", payment: CARD.test(`${a.autocomplete || ""} ${a.name || ""} ${a.id || ""}`), disabled: a.disabled !== undefined });
      if (lab) (lab.inside ||= []).push(el);
      if (form && a.name) form.fields.push({ name: a.name, type, ref: el.ref, el });
      continue;
    }
    if (tag === "textarea") {
      const el = add({ tag: "textarea", kind: "field", type: "textarea", name: a.name || "", id: a.id || "", value: "", label: a["aria-label"] || a.placeholder || "", form: inForm, disabled: a.disabled !== undefined });
      if (lab) (lab.inside ||= []).push(el);
      if (form && a.name) form.fields.push({ name: a.name, type: "textarea", ref: el.ref, el });
      stack.push({ tag: "textarea", el, collect: "" });
      continue;
    }
    if (tag === "select") {
      const el = add({ tag: "select", kind: "field", type: "select", name: a.name || "", id: a.id || "", value: undefined, options: [], label: a["aria-label"] || "", form: inForm, disabled: a.disabled !== undefined });
      if (lab) (lab.inside ||= []).push(el);
      if (form && a.name) form.fields.push({ name: a.name, type: "select", ref: el.ref, el });
      stack.push({ tag: "select", el, collect: undefined });
      continue;
    }
    if (tag === "option") { const sel = open("select"); stack.push({ tag: "option", select: sel?.el, value: a.value, selected: a.selected !== undefined, collect: "" }); continue; }
    if (tag === "label") { stack.push({ tag: "label", for: a.for || "", collect: "", inside: [] }); continue; }
  }
  for (const el of elements) {
    if (el.kind === "field" && !el.label && el.id && labelsFor[el.id]) el.label = labelsFor[el.id];
    if (!el.label) el.label = el.name || el.href || el.type || el.tag;
    el.label = squash(el.label).slice(0, 120);
    if (el.options) el.options = el.options.slice(0, 30);
  }
  for (const f of forms) {
    if (!f.label) { const sub = elements.find((e) => e.form === f.ref && e.submits); f.label = sub?.label || f.ref; }
  }
  text = text.replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
  return { title, text, elements, forms, hasCanvas: /<canvas\b/i.test(body) };
}

// A snapshot in the shape both drivers return. Field values the helper typed are shown; password and
// card fields never carry a value.
function view(state) {
  const p = state.page;
  const field = (el) => ({ ...el, value: el.password || el.payment ? "" : el.value });
  return {
    url: state.url, title: p.title, text: p.text, driver: "reader", hasCanvas: !!p.hasCanvas,
    elements: p.elements.map(({ options, ...el }) => ({ ...field(el), options: options ? options.map((o) => o.label).slice(0, 12) : undefined })),
    forms: p.forms.map((f) => ({ ref: f.ref, method: f.method, action: f.action, label: f.label, fields: f.fields.map((x) => ({ name: x.name, type: x.type, hidden: !!x.hidden, ref: x.ref || null, value: x.el ? (x.el.password || x.el.payment ? "" : x.type === "checkbox" || x.type === "radio" ? (x.el.checked ? x.el.value : null) : x.el.value ?? "") : x.value })) })),
  };
}

export function createReader({ userAgent = "CommandAI-BrowserHelper/1.0 (text reader)", timeoutMs = 15000 } = {}) {
  const state = { url: "about:blank", page: { title: "", text: "", elements: [], forms: [] }, history: [], cookies: new Map() };

  function cookieHeader(u) {
    const jar = state.cookies.get(u.host);
    return jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : null;
  }
  function keepCookies(u, res) {
    const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const c of list) {
      const [pair] = String(c).split(";");
      const i = pair.indexOf("=");
      if (i <= 0) continue;
      if (!state.cookies.has(u.host)) state.cookies.set(u.host, new Map());
      state.cookies.get(u.host).set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async function load(url, { method = "GET", body = null, push = true } = {}) {
    let u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("only web pages (http or https) can be opened");
    let res, hops = 0;
    while (true) {
      const headers = { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" };
      const ck = cookieHeader(u); if (ck) headers.cookie = ck;
      if (body) headers["content-type"] = "application/x-www-form-urlencoded";
      res = await localFetch(u, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      keepCookies(u, res);
      if (res.status >= 300 && res.status < 400 && res.headers.get("location") && hops++ < 6) {
        u = new URL(res.headers.get("location"), u);
        if (!["http:", "https:"].includes(u.protocol)) throw new Error("the page redirected somewhere that is not a web page");
        if (res.status !== 307 && res.status !== 308) { method = "GET"; body = null; }
        continue;
      }
      break;
    }
    const type = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES).toString("utf8");
    if (push && state.url !== "about:blank") state.history.push(state.url);
    state.url = u.toString();
    state.page = /html|xml/i.test(type) || /^\s*</.test(buf) ? parsePage(buf, state.url) : { title: u.pathname.split("/").pop() || u.host, text: buf.slice(0, MAX_TEXT), elements: [], forms: [] };
    return { status: res.status, url: state.url, title: state.page.title };
  }

  const find = (ref) => { const el = state.page.elements.find((e) => e.ref === ref); if (!el) throw new Error(`there is no element ${ref} on this page`); return el; };

  async function submitForm(formRef, button) {
    const f = state.page.forms.find((x) => x.ref === formRef);
    if (!f) throw new Error(`there is no form ${formRef} on this page`);
    const params = new URLSearchParams();
    for (const x of f.fields) {
      if (x.hidden) { params.append(x.name, x.value); continue; }
      const el = x.el;
      if (el.disabled) continue;
      if (el.type === "checkbox" || el.type === "radio") { if (el.checked) params.append(x.name, el.value); continue; }
      params.append(x.name, el.value ?? "");
    }
    if (button?.name) params.append(button.name, button.value || "");
    if (f.method === "GET") { const u = new URL(f.action); u.search = params.toString(); return load(u.toString()); }
    return load(f.action, { method: "POST", body: params.toString() });
  }

  return {
    kind: "reader",
    describe: "text reader (no window, no JavaScript)",
    async open(url) { return load(url); },
    async snapshot() { return view(state); },
    async click(ref) {
      const el = find(ref);
      if (el.disabled) throw new Error("that control is disabled");
      if (el.kind === "link") { if (!el.href) throw new Error("that link goes nowhere"); return load(el.href); }
      if (el.kind === "field" && (el.type === "checkbox" || el.type === "radio")) {
        if (el.type === "radio") for (const o of state.page.elements) if (o.type === "radio" && o.name === el.name && o.form === el.form) o.checked = false;
        el.checked = el.type === "radio" ? true : !el.checked;
        return { url: state.url, changed: true };
      }
      if (el.submits) return submitForm(el.form, el);
      return { url: state.url, note: "nothing happens: this button needs JavaScript, which the text reader does not run" };
    },
    async type(ref, text) {
      const el = find(ref);
      if (el.kind !== "field") throw new Error("you can only type into a text field");
      if (el.type === "select") {
        const o = el.options.find((x) => x.label === text || x.value === text) || el.options.find((x) => x.label.toLowerCase().includes(String(text).toLowerCase()));
        if (!o) throw new Error(`that list has no choice "${text}"`);
        el.value = o.value; return { url: state.url, changed: true };
      }
      el.value = String(text ?? "").slice(0, 5000);
      return { url: state.url, changed: true };
    },
    async submit(formRef) { return submitForm(formRef, null); },
    async back() { const prev = state.history.pop(); if (!prev) throw new Error("there is no page to go back to"); return load(prev, { push: false }); },
    async scroll() { return { url: state.url, note: "the text reader already sees the whole page" }; },
    async screenshot() { return { kind: "screenshot", driver: "reader", fallback: true, url: state.url, title: state.page.title, width: 0, height: 0, dataUrl: null, note: "text reader: DOM snapshot used (no window screenshot)" }; },
    show() {}, update() {}, close() {},
  };
}
