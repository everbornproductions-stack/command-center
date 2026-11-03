// 0.4.39 (Chris: readable everywhere): measure every bit of text on the screen against what is painted behind it.
// Pure helper (not a test file), used by test/readability-0439.test.js.
//
// How: one pass in the page lists every visible text node (and every typing field's value or placeholder) with its
// colour, size, weight and the tight boxes of its lines. Then all text on the page is made transparent for one
// screenshot, so the picture holds only what is behind the text. Each text box is read from that picture:
//   - a flat background (the darkest and lightest tenths of the pixels are within 1.25 : 1 of each other) uses the
//     median pixel, which is the first solid background behind the text;
//   - a picture, a gradient or glass over a picture uses the worse of the darkest and the lightest tenth, so the text
//     has to read on both ends of what is behind it.
// Semi-transparent text (colour alpha and every opacity up the tree) is blended over that background first, and a CSS
// filter on the text or a parent (brightness, saturate, ...) is applied to its colour.
// Not measured: text covered by something else (a dialog backdrop, a drawer), scrolled or cut out of its own box, off
// screen, or under a layer that does not take the pointer (seen as text that leaves no mark on a normal picture).
// An item that moved while the pictures were taken is dropped, and a screen that started animating is read again.
// Thresholds follow WCAG 2.x: 4.5 : 1, and 3 : 1 for large text (24 px, or 18.66 px and bold). A control marked
// disabled (the disabled attribute or aria-disabled="true") is exempt; one that only looks disabled is not.
import { ratio } from "./paint-helpers.js";

export { ratio };

const HIDE_ID = "cc-read-hide";
// JPEG at high quality: the text is hidden, so the picture is mostly flat colour, which JPEG keeps within a step or two,
// and it is smaller to hand from the browser to the page and back than PNG at 1366 x 800.
const SHOT = { animations: "disabled", caret: "hide", type: "jpeg", quality: 95 };
const HIDE_CSS = `*, *::before, *::after, ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; transition: none !important; }
::selection { background: transparent !important; }`;

// In the page: every text item on screen. Returns [{text, fg:[r,g,b,a], large, disabled, kind, sel, rects:[[x,y,w,h]...]}]
function collectInPage() {
  const W = innerWidth, H = innerHeight;
  const parse = (s) => { const m = String(s).match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/); if (!m) return null; let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]); return [Number(m[1]), Number(m[2]), Number(m[3]), a]; };
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.id) return `${s}#${el.id}`; const c = [...el.classList].slice(0, 2).join("."); return c ? `${s}.${c}` : s; };
  const path = (el) => { const out = []; for (let e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) { out.unshift(name(e)); if (e.id) break; } return out.join(" > "); };
  const opacityOf = (el) => { let a = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) a *= Number(getComputedStyle(n).opacity || 1); return a; };
  const clipped = (el, x, y) => {
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible" && s.clipPath === "none") continue;
      const c = a.getBoundingClientRect();
      if (x < c.left || x > c.right || y < c.top || y > c.bottom) return true;
    }
    return false;
  };
  const onTop = (el, x, y) => {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    return hit === el || el.contains(hit) || hit.contains(el);
  };
  // Whole and on top: the middle, the top and bottom edges and both ends of the line are inside every clipping box and
  // not under something else (a line half scrolled under a bar, or half under a drawer, is not read as text on it).
  const shown = (el, r) => {
    const x = Math.min(W - 1, r.left + Math.min(r.width / 2, 24)), my = r.top + r.height / 2;
    const right = Math.min(W - 1, r.right - 2, el.getBoundingClientRect().right - 2); // a line cut with "..." ends at its box
    const pts = [[x, my], [x, r.top + 2], [x, r.bottom - 2], [r.left + 2, my], [Math.max(r.left + 2, right), my]];
    return pts.every(([px, py]) => !clipped(el, px, py) && onTop(el, px, py));
  };
  // A CSS filter on the text or a parent changes the colour that is painted (the Expert feed darkens the AI names with
  // brightness(.5)). brightness, contrast, saturate, grayscale, invert and opacity are applied to the text colour.
  const filtered = (el, c) => {
    let [r, g, b, a] = c;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const f = getComputedStyle(n).filter;
      if (!f || f === "none") continue;
      for (const [, fn, raw] of f.matchAll(/([a-z-]+)\(([^)]*)\)/g)) {
        const v = raw.trim().endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
        if (fn === "brightness") { r *= v; g *= v; b *= v; }
        else if (fn === "contrast") { [r, g, b] = [r, g, b].map((x) => (x - 127.5) * v + 127.5); }
        else if (fn === "saturate" || fn === "grayscale") {
          const s = fn === "saturate" ? v : 1 - v;
          [r, g, b] = [
            (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
            (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
            (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
          ];
        } else if (fn === "invert") { [r, g, b] = [r, g, b].map((x) => x * (1 - v) + (255 - x) * v); }
        else if (fn === "opacity") a *= v;
      }
      [r, g, b] = [r, g, b].map((x) => Math.max(0, Math.min(255, x)));
    }
    return [r, g, b, a];
  };
  // Finite animations (a page fade, a new feed line sliding in) are run to their end first: that is what stays on screen.
  for (const a of document.getAnimations()) { try { if (a.effect?.getComputedTiming?.().endTime !== Infinity) a.finish(); } catch { /* not finishable */ } }
  const cut = (el, r) => {
    // sideways only: a line cut off at the top or bottom is half hidden, and shown() leaves it out
    let { left, top, right, bottom } = r;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const c = a.getBoundingClientRect();
      left = Math.max(left, c.left); right = Math.min(right, c.right);
    }
    return right - left >= 2 && bottom - top >= 4 ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
  };
  // The first solid background colour behind the element in the page's own styles (null at a picture or gradient).
  const solidBehind = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = parse(s.backgroundColor);
      if (c && c[3] >= 0.9) return c.slice(0, 3);
    }
    return null;
  };
  const inView = (r) => r.width >= 2 && r.height >= 4 && r.top >= 0 && r.left >= 0 && r.bottom <= H && r.right <= W;
  const large = (cs) => { const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700; return px >= 24 || (bold && px >= 18.66); };
  const isDisabled = (el) => !!el.closest(":disabled, [aria-disabled='true']");
  const out = [];
  const keep = window.__readKeep = []; // the nodes, to check after the pictures that nothing moved
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "OPTGROUP", "TEXTAREA", "SELECT", "TITLE"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const el = n.parentElement;
    if (!el || skipTags.has(el.tagName) || el.closest("select, textarea, [data-read-skip]")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    // each line's box, cut to what its clipping boxes show (a line ended with "..." runs on, unseen, past its box)
    // and only the lines that are whole and on top (a wrapped label can end below the bottom of its scrolling box)
    const rects = [...range.getClientRects()].map((r) => cut(el, r)).filter((r) => r && inView(r)).slice(0, 4).filter((r) => shown(el, r)).slice(0, 3);
    if (!rects.length) continue;
    const inSvg = el instanceof SVGElement;
    let fg = parse(inSvg ? cs.fill : cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
    if (!fg) continue;
    fg = filtered(el, fg);
    fg[3] *= opacityOf(el);
    if (fg[3] < 0.05) continue;
    keep.push([n, rects[0].left, rects[0].top]);
    out.push({ text: text.slice(0, 60), fg, large: large(cs), disabled: isDisabled(el), kind: "text", sel: path(el), solid: solidBehind(el), rects: rects.map((r) => [r.left, r.top, r.width, r.height]) });
  }
  // typing fields: the typed value, or the placeholder when empty
  for (const el of document.querySelectorAll("input, textarea, select")) {
    const type = (el.type || "").toLowerCase();
    if (el.tagName === "INPUT" && !["", "text", "search", "email", "url", "tel", "number", "password", "date", "time"].includes(type)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || el.closest("[data-read-skip]")) continue;
    const b = el.getBoundingClientRect();
    if (!inView(b)) continue;
    const val = el.tagName === "SELECT" ? (el.selectedOptions?.[0]?.textContent || "") : el.value;
    const ph = el.getAttribute("placeholder") || "";
    const kind = val.trim() ? "value" : ph.trim() ? "placeholder" : "";
    if (!kind || !/[\p{L}\p{N}]/u.test(kind === "value" ? val : ph)) continue;
    const pcs = kind === "placeholder" ? getComputedStyle(el, "::placeholder") : cs;
    const fg = parse(pcs.color);
    if (!fg) continue;
    fg[3] *= opacityOf(el) * (kind === "placeholder" ? Number(pcs.opacity || 1) : 1);
    if (fg[3] < 0.05) continue;
    const pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const pb = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
    const lh = Math.min(parseFloat(cs.fontSize) * 1.25, b.height - pt - pb);
    const y = el.tagName === "TEXTAREA" ? b.top + pt : b.top + (b.height - lh) / 2;
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tw = Math.min(ctx.measureText(kind === "value" ? val : ph).width, b.width - pl * 2 - 4);
    const rect = [b.left + pl, y, Math.max(8, tw), Math.max(6, lh)];
    if (!shown(el, { left: rect[0], top: rect[1], width: rect[2], height: rect[3], bottom: rect[1] + rect[3], right: rect[0] + rect[2] })) continue;
    keep.push([el, b.left, b.top]);
    out.push({ text: `[${kind}] ${(kind === "value" ? val : ph).slice(0, 50)}`, fg: filtered(el, fg), large: large(cs), disabled: el.disabled || el.getAttribute("aria-disabled") === "true", kind, sel: path(el), solid: solidBehind(el), rects: [rect] });
  }
  return out;
}

// In the page: read the background behind each item from the text-hidden screenshot, and compare it with the normal
// screenshot to see whether the text is painted there at all (base64 PNGs).
async function backgroundsInPage({ bare, shot, items }) {
  const load = async (b64) => {
    const img = new Image();
    img.src = "data:image/jpeg;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return { g, w: c.width, h: c.height, sx: img.naturalWidth / innerWidth };
  };
  const A = await load(bare), B = shot ? await load(shot) : null;
  const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  return items.map((it) => {
    const px = [];
    let inked = 0;
    for (const [x, y, w, h] of it.rects) {
      const X = Math.max(0, Math.floor(x * A.sx)), Y = Math.max(0, Math.floor(y * A.sx));
      const Wd = Math.max(1, Math.min(A.w - X, Math.ceil(w * A.sx))), Hd = Math.max(1, Math.min(A.h - Y, Math.ceil(h * A.sx)));
      const d = A.g.getImageData(X, Y, Wd, Hd).data, e = B ? B.g.getImageData(X, Y, Wd, Hd).data : null;
      if (e) for (let i = 0; i < d.length; i += 4) if (Math.max(Math.abs(d[i] - e[i]), Math.abs(d[i + 1] - e[i + 1]), Math.abs(d[i + 2] - e[i + 2])) > 24) inked++;
      const step = Math.max(1, Math.floor((Wd * Hd) / 4000));
      for (let i = 0; i < d.length; i += 4 * step) px.push([d[i], d[i + 1], d[i + 2]]);
    }
    px.sort((p, q) => L(p) - L(q));
    const at = (f) => px[Math.min(px.length - 1, Math.floor(px.length * f))];
    return { dark: at(0.1), mid: at(0.5), light: at(0.9), inked: B ? inked : undefined };
  });
}

const blend = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// Measure the screen as it is now. Returns every measured item with {ratio, need, bg, flat}.
export async function measureScreen(page, tries = 2) {
  const items = await page.evaluate(collectInPage);
  if (!items.length) return [];
  await page.evaluate(({ id, css }) => {
    let s = document.getElementById(id);
    if (!s) { s = document.createElement("style"); s.id = id; document.head.appendChild(s); }
    s.textContent = css;
    for (const a of document.getAnimations()) { try { if (a.effect?.getComputedTiming?.().endTime !== Infinity) a.finish(); } catch { /* not finishable */ } }
  }, { id: HIDE_ID, css: HIDE_CSS });
  let png;
  try {
    png = await page.screenshot(SHOT);
  } finally {
    // Colours come back with transitions still off, so nothing fades back in (a fade would be read mid-way next time).
    await page.evaluate((id) => {
      const s = document.getElementById(id);
      if (!s) return;
      s.textContent = "*, *::before, *::after { transition: none !important; }";
      void document.body.offsetHeight; // a layout read brings the whole page's style up to date
      s.remove();
    }, HIDE_ID);
  }
  // Something that moved or was redrawn while the pictures were taken (a list that redraws, a late scroll) is not read
  // from the wrong place: only items still where they were are kept.
  // A page that started an animation while the pictures were taken (it drew itself again and fades in) is read again.
  const { still, busy } = await page.evaluate(() => ({
    still: (window.__readKeep || []).map(([node, x, y]) => {
      if (!node.isConnected) return false;
      let r;
      if (node.nodeType === 3) { const range = document.createRange(); range.selectNodeContents(node); r = range.getClientRects()[0]; } else r = node.getBoundingClientRect();
      return !!r && Math.abs(r.left - x) <= 1 && Math.abs(r.top - y) <= 1;
    }),
    busy: document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming?.().endTime !== Infinity),
  }));
  const moved = still.filter((s) => !s).length;
  if ((busy || moved > Math.max(5, items.length * 0.2)) && tries > 0) { await page.waitForTimeout(400); return measureScreen(page, tries - 1); }
  const bare = png.toString("base64");
  const bgs = await page.evaluate(backgroundsInPage, { bare, shot: null, items });
  const res = items.map((it, i) => {
    const b = bgs[i];
    const flat = ratio(b.dark, b.light) <= 1.25;
    let r, bg;
    if (flat) { bg = b.mid; r = ratio(blend(it.fg, bg), bg); } else {
      const rd = ratio(blend(it.fg, b.dark), b.dark), rl = ratio(blend(it.fg, b.light), b.light);
      [r, bg] = rd <= rl ? [rd, b.dark] : [rl, b.light];
    }
    return { b, flat, r, bg };
  });
  // Only when something is under the line: a normal picture, to see whether that text is painted on the screen at all.
  const low = items.map((it, i) => still[i] && !it.disabled && res[i].r < (it.large ? 3 : 4.5) ? i : -1).filter((i) => i >= 0);
  if (low.length) {
    const shot = (await page.screenshot(SHOT)).toString("base64");
    const inks = await page.evaluate(backgroundsInPage, { bare, shot, items: low.map((i) => items[i]) });
    low.forEach((i, k) => { res[i].b.inked = inks[k].inked; });
  }
  const out = [];
  items.forEach((it, i) => {
    if (!still[i]) return;
    const b = res[i].b;
    const { flat, r, bg } = res[i];
    const need = it.large ? 3 : 4.5;
    // Text whose colour would clearly show but leaves no mark on the screen is under something drawn on top of it that
    // does not take the pointer (the Simple 3 step flow over the chat box): it is not on screen, so it is not measured.
    // Text that leaves no mark because it is the colour of what is behind it stays in, as the failure it is.
    // The same goes when the page's own solid background behind the text is not what is painted there (a teal Send
    // button under the flow's light page).
    const away = it.solid && Math.max(...[0, 1, 2].map((k) => Math.abs(it.solid[k] - b.mid[k]))) > 48;
    if (b.inked !== undefined && b.inked < 3 && (r >= 1.6 || away)) return;
    out.push({ text: it.text, sel: it.sel, kind: it.kind, large: it.large, disabled: it.disabled, fg: hex(blend(it.fg, bg)), bg: hex(bg), flat, need, ratio: Math.round(r * 100) / 100 });
  });
  return out;
}

// 0.5.0 (0.4.39 panel, FIXES-0441 item 10): one named control measured the way the release review measures it
// (meldmind-panel-0439 harness, plib.mjs measure()): its text is hidden, its whole box (at most 400 x 60) is
// pictured, every pixel of that picture is averaged, and the text colour is blended over that average. On a small
// pill the rounded corners show the lighter surface around it, and glass lightens a fill, so a fill that passes as a
// CSS value can still read under 4.5 : 1 here. The sweep above reads the median behind the tight text box and passes
// those. An icon-only control (no text, an svg) is held to 3 : 1 with its icon colour (WCAG 1.4.11).
// Returns null when no visible element matches, else {text, sel, fg, bg, ratio, need, icon, box}.
// opts.match: only an element whose text matches this regexp source (case-insensitive, whole text).
export async function boxContrast(page, selector, { match = "" } = {}) {
  const it = await page.evaluate(({ selector, match }) => {
    const parse = (s) => { const m = String(s).match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?/); if (!m) return null; const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]); return [Number(m[1]), Number(m[2]), Number(m[3]), a]; };
    const want = match ? new RegExp(`^(?:${match})$`, "i") : null;
    const el = [...document.querySelectorAll(selector)].find((e) => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      if (want && !want.test((e.textContent || "").trim().replace(/\s+/g, " "))) return false;
      return r.width > 6 && r.height > 6 && cs.visibility !== "hidden" && cs.display !== "none" && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const text = (el.textContent || "").trim().replace(/\s+/g, " ");
    const svg = el.querySelector("svg");
    const icon = !text && !!svg;
    let fg = parse(cs.color);
    if (icon) { const s = getComputedStyle(svg.querySelector("path, line, polyline, circle, rect") || svg); const st = parse(s.stroke), fi = parse(s.fill); fg = st && st[3] > 0 ? st : fi && fi[3] > 0 ? fi : fg; }
    let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity || 1);
    fg[3] *= op;
    const cx = Math.min(innerWidth - 1, r.left + r.width / 2), cy = Math.min(innerHeight - 1, r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    const onTop = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    const px = parseFloat(cs.fontSize), large = px >= 24 || (Number(cs.fontWeight) >= 700 && px >= 18.66);
    el.dataset.ccBox = "1";
    return { text: text.slice(0, 40) || el.getAttribute("aria-label") || "", sel: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].slice(0, 2).map((c) => "." + c).join(""), fg, icon, large, onTop, box: [r.x, r.y, Math.min(r.width, 400), Math.min(r.height, 60)] };
  }, { selector, match });
  if (!it) return null;
  const hide = "[data-cc-box], [data-cc-box] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; stroke: transparent !important; fill: transparent !important; transition: none !important; }";
  await page.evaluate(({ id, css }) => { const s = document.createElement("style"); s.id = id; s.textContent = css; document.head.appendChild(s); }, { id: HIDE_ID + "-box", css: hide });
  let png;
  try {
    const [x, y, w, h] = it.box;
    png = await page.screenshot({ clip: { x, y, width: w, height: h }, animations: "disabled", caret: "hide" });
  } finally {
    await page.evaluate((id) => { document.getElementById(id)?.remove(); document.querySelectorAll("[data-cc-box]").forEach((e) => delete e.dataset.ccBox); }, HIDE_ID + "-box");
  }
  const bg = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gg = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [r / n, gg / n, b / n];
  }, png.toString("base64"));
  const fg = blend(it.fg, bg);
  const need = it.icon || it.large ? 3 : 4.5;
  return { text: it.text, sel: it.sel, onTop: it.onTop, icon: it.icon, fg: hex(fg), bg: hex(bg), need, ratio: Math.round(ratio(fg, bg) * 100) / 100, box: it.box.map(Math.round) };
}

// The failures among measured items (disabled controls exempt).
export const failing = (list) => list.filter((x) => !x.disabled && x.ratio < x.need);

// The main scroll box of the page (the tallest visible element that scrolls), to see the rest of a long page.
export function scrollMain(page, step) {
  return page.evaluate((step) => {
    const boxes = [...document.querySelectorAll("#view, #view *, .view-col, #app *, [role='dialog'], [role='dialog'] *")].filter((e) => {
      if (e.scrollHeight <= e.clientHeight + 40) return false;
      const s = getComputedStyle(e);
      if (!/(auto|scroll)/.test(s.overflowY)) return false;
      const r = e.getBoundingClientRect();
      return r.height > 200 && r.width > 200 && r.bottom > 0 && r.top < innerHeight;
    });
    boxes.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const box = boxes[0];
    if (!box) return false;
    box.style.scrollBehavior = "auto"; // jump, so nothing is still moving when the screen is read
    if (step === 0) { box.scrollTop = 0; return true; }
    const before = box.scrollTop;
    box.scrollTop = before + box.clientHeight * 0.85;
    return box.scrollTop > before + 20;
  }, step);
}
