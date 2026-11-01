// 0.4.25 helper: contrast measured against the painted pixels, and hit tests. Pure helper (not a test file).
// On glass the CSS colour alone says nothing (LESSONS 2026-10-28), so the text is hidden, its box is
// screenshotted, and the text colour is compared with the median colour actually painted behind it.

export function lum([r, g, b]) {
  const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const HIDE_CSS = ".cc-paint-hide, .cc-paint-hide * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }";

// Measure every visible element matching `selector` (first `max`). Returns [{text, fg, bg, ratio}].
// The element's own text is hidden while its box is captured; children with their own text are hidden too.
export async function paintedContrast(page, selector, { max = 12 } = {}) {
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
  const boxes = await page.evaluate(({ selector, max }) => {
    const out = [];
    const els = [...document.querySelectorAll(selector)];
    for (const el of els) {
      if (out.length >= max) break;
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // The tight box of the text itself, not the padding around it.
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      // Is this element really on top where its text is? Skip it when something else covers it.
      const px = Math.min(innerWidth - 1, r.left + Math.min(r.width / 2, 20)), py = r.top + r.height / 2;
      const top = document.elementFromPoint(px, py);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) continue;
      // Text scrolled out of its own scroll box (or cut off by the window) is not painted where it seems: skip it.
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const c = a.getBoundingClientRect();
        if (px < c.left || px > c.right || r.top < c.top || r.bottom > c.bottom) { clipped = true; break; }
      }
      if (clipped) continue;
      let alpha = 1;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity || 1);
      const m = cs.color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/);
      const fg = m ? [Number(m[1]), Number(m[2]), Number(m[3]), (m[4] === undefined ? 1 : Number(m[4])) * alpha] : [0, 0, 0, alpha];
      const id = "p" + out.length;
      el.dataset.ccPaint = id;
      out.push({ id, text: text.slice(0, 40), fg, x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), w: Math.ceil(Math.min(r.width, innerWidth - r.left)), h: Math.ceil(Math.min(r.height, innerHeight - r.top)) });
    }
    return out;
  }, { selector, max });
  const res = [];
  for (const b of boxes) {
    // 0.4.36: a page that redraws between the measure and the picture moves the text (Command draws #go once higher up
    // for a moment, which the taller Fill the window layout no longer clips); a box that moved is not measured.
    const still = await page.evaluate((b) => {
      const el = document.querySelector(`[data-cc-paint="${b.id}"]`);
      if (!el) return false;
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      el.classList.add("cc-paint-hide");
      return Math.abs(Math.max(0, Math.floor(r.left)) - b.x) <= 1 && Math.abs(Math.max(0, Math.floor(r.top)) - b.y) <= 1;
    }, b);
    if (!still) { await page.evaluate((id) => { const e = document.querySelector(`[data-cc-paint="${id}"]`); if (e) { e.classList.remove("cc-paint-hide"); delete e.dataset.ccPaint; } }, b.id); continue; }
    const png = await page.screenshot({ clip: { x: b.x, y: b.y, width: Math.max(1, b.w), height: Math.max(1, b.h) }, animations: "disabled" });
    await page.evaluate((id) => { const e = document.querySelector(`[data-cc-paint="${id}"]`); if (e) { e.classList.remove("cc-paint-hide"); delete e.dataset.ccPaint; } }, b.id);
    const bg = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const px = [];
      for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
      const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      px.sort((p, q) => L(p) - L(q));
      return px[Math.floor(px.length / 2)];
    }, png.toString("base64"));
    const a = b.fg[3];
    const fg = [0, 1, 2].map((i) => Math.round(b.fg[i] * a + bg[i] * (1 - a)));
    res.push({ text: b.text, fg, bg, ratio: Math.round(ratio(fg, bg) * 100) / 100 });
  }
  return res;
}

// Is the centre of each matching visible element the top element there (or inside it)? Returns [{sel, text, top}].
export async function hitTest(page, selectors) {
  return page.evaluate((selectors) => {
    const out = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        // A link that wraps onto two lines has its middle between the two pieces: test the first piece.
        const rects = el.getClientRects();
        const r = rects.length > 1 ? rects[0] : el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || el.closest("[hidden]")) continue;
        // 0.4.36: a control inside a closed <details> keeps a box but is not drawn (the taller Fill the window layout
        // brought one into view on Video and media): it is reached by opening the details, not covered.
        const det = el.closest("details");
        if (det && !det.open && !el.closest("summary")) continue;
        if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
        const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        // A control scrolled out of its own scroll box is reached by scrolling, not covered: skip it.
        // 0.4.36: judged by its real middle, not the one pulled back onto the screen: a sideways row that runs to the
        // window edge (Fill the window has no side margin) has its last button half off screen, inside the row's box.
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX === "visible" && s.overflowY === "visible") continue;
          const c = a.getBoundingClientRect();
          if (cx < c.left || cx > c.right || cy < c.top || cy > c.bottom) { clipped = true; break; }
        }
        if (clipped) continue;
        const hit = document.elementFromPoint(x, y);
        // The classic page under the Simple 3 step flow is meant to be hidden by it (the flow is opaque).
        if (hit && document.body.dataset.macFlow === "on" && el.closest("#app") && hit.closest("#mac-flow")) continue;
        const ok = !!hit && (hit === el || el.contains(hit));
        out.push({ sel, text: (el.textContent || "").trim().slice(0, 30), ok, top: ok ? "" : (hit ? (hit.id ? "#" + hit.id : hit.tagName.toLowerCase() + "." + String(hit.className).split(" ")[0]) : "none") });
      }
    }
    return out;
  }, selectors);
}
