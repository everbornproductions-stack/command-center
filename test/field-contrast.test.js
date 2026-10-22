// Typing fields are never white on white (Chris, 2026-10-21). Every input, textarea, select and
// editable box uses one field look from web/styles.css: a dark field with light text in the dark
// theme, a white field with dark text in the light theme, a visible border, a visible focus ring,
// and a readable placeholder (WCAG AA). No server, no browser: this reads the stylesheets.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function hex(c) {
  const m = String(c).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
function rgb(c) {
  const v = String(c || "").trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  const h = hex(v);
  if (h) return h;
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function lum([r, g, b]) {
  const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// color-mix(in srgb, A p%, B)
function mix(a, b, p) {
  const [x, y] = [rgb(a), rgb(b)];
  const t = p / 100;
  return "#" + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, "0")).join("");
}

const FIELD = /(^|[\s,(>+~])(input|textarea|select|option|optgroup)\b|contenteditable/;
const SKIP_TYPES = /type=["']?(checkbox|radio|range|color|file|button|submit|reset|image|hidden)/;

// Every CSS rule in the app: styles.css, <style> blocks in the html pages, and the CSS strings
// that feature modules inject.
function sources() {
  const out = [["web/styles.css", read("web", "styles.css")]];
  for (const f of fs.readdirSync(path.join(ROOT, "web"))) if (/\.(js|html)$/.test(f)) out.push([`web/${f}`, read("web", f)]);
  for (const f of fs.readdirSync(path.join(ROOT, "web", "features"))) if (f.endsWith(".js")) out.push([`web/features/${f}`, read("web", "features", f)]);
  return out;
}
function rules(text) {
  const found = [];
  for (const m of text.matchAll(/([^{}`;]+)\{([^{}]*)\}/g)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!sel || /=>|function|\bif\b|\breturn\b/.test(sel)) continue;
    found.push({ sel, body: m[2] });
  }
  return found;
}
const prop = (body, name) => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;!]+)`, "i"));
  return m ? m[1].trim() : null;
};
const bgOf = (body) => {
  const v = prop(body, "background-color") || prop(body, "background");
  if (!v) return null;
  const c = v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/i);
  return c ? c[0] : null;
};

test("no stylesheet or inline style puts light text on a light field, or dark text on a dark field", () => {
  const bad = [];
  for (const [file, text] of sources()) {
    for (const { sel, body } of rules(text)) {
      const parts = sel.split(",").map((s) => s.trim()).filter((s) => FIELD.test(s) && !/::?placeholder|:focus|autofill/.test(s) && !SKIP_TYPES.test(s));
      if (!parts.length) continue;
      const bg = bgOf(body);
      const fg = prop(body, "color");
      if (!bg || !rgb(bg)) continue;
      const light = lum(rgb(bg)) > 0.5;
      const lightTheme = parts.every((s) => /data-theme="light"/.test(s));
      if (fg && rgb(fg)) {
        if (contrast(fg, bg) < 4.5) bad.push(`${file}: ${parts[0]} text ${fg} on ${bg}`);
      } else if (light && !lightTheme) {
        bad.push(`${file}: ${parts[0]} sets a light field (${bg}) without a dark text colour`);
      }
    }
    // Inline style on a field tag.
    for (const m of text.matchAll(/<(input|textarea|select)\b([^>]*)>/g)) {
      if (SKIP_TYPES.test(m[2])) continue;
      const style = (m[2].match(/style="([^"]*)"/) || [])[1] || "";
      const bg = bgOf(style);
      if (!bg || !rgb(bg)) continue;
      const fg = prop(style, "color");
      if (fg && rgb(fg) ? contrast(fg, bg) < 4.5 : lum(rgb(bg)) > 0.5) bad.push(`${file}: inline ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("one shared field rule covers every typing field, with AA text, placeholder, border and focus ring", () => {
  const css = read("web", "styles.css");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const v = (name, src = root) => (src.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
  const dark = { bg: v("field-bg"), text: v("field-text"), border: v("field-border"), placeholder: v("field-placeholder"), ring: v("focus-ring") };
  for (const [k, c] of Object.entries(dark)) assert.ok(rgb(c), `dark --${k} is a colour: ${c}`);
  assert.match(root, /color-scheme: dark;/, "native pickers and dropdowns are dark");
  assert.ok(contrast(dark.text, dark.bg) >= 4.5, "dark field text is AA");
  assert.ok(contrast(dark.placeholder, dark.bg) >= 4.5, "dark placeholder is AA");
  assert.ok(contrast(dark.border, dark.bg) >= 3, "dark field border is visible (3:1)");
  assert.ok(contrast(dark.ring, dark.bg) >= 3, "dark focus ring is visible (3:1)");

  // The shared rule: every input type that takes typing (also no type at all, search, email, url,
  // time), select, textarea and editable boxes. Checkboxes and the rest keep their own look.
  const shared = rules(css).find((r) => r.sel.includes("input:not([type=checkbox])") && r.sel.includes("[contenteditable"));
  assert.ok(shared, "the shared field rule exists");
  assert.match(shared.sel, /^:where\(/, "zero specificity, so a page can still size its own field");
  for (const t of ["checkbox", "radio", "range", "color", "file", "hidden"]) assert.ok(shared.sel.includes(`:not([type=${t}])`), t);
  for (const k of ["background-color: var(--field-bg)", "color: var(--field-text)", "border: 1px solid var(--field-border)"]) assert.ok(shared.body.includes(k), k);
  assert.ok(rules(css).some((r) => /option/.test(r.sel) && r.body.includes("var(--field-bg)")), "select options use the field colours");
  assert.ok(rules(css).some((r) => /input:focus/.test(r.sel) && r.body.includes("var(--focus-ring)")), "focus ring");
  assert.ok(rules(css).some((r) => /::placeholder/.test(r.sel) && r.body.includes("var(--field-placeholder)")), "placeholder colour");
  // color: inherit on inputs would undo the field text colour.
  assert.ok(!rules(css).some((r) => /\binput\b/.test(r.sel) && /color:\s*inherit/.test(r.body)), "inputs do not inherit the page text colour");

  // Light theme: white field, dark text, AA placeholder, a darker ring.
  const themes = read("web", "features", "themes.js");
  const light = themes.slice(themes.indexOf('html[data-theme="light"] {'), themes.indexOf("}", themes.indexOf('html[data-theme="light"] {')));
  const lv = (name) => (light.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
  assert.match(light, /color-scheme: light;/);
  const lbg = lv("field-bg"), ltext = lv("field-text"), lph = lv("field-placeholder"), lborder = lv("field-border");
  assert.ok(contrast(ltext, lbg) >= 4.5, "light field text is AA");
  assert.ok(contrast(lph, lbg) >= 4.5, "light placeholder is AA");
  assert.ok(contrast(lborder, lbg) >= 3, "light field border is visible");
  const ring = lv("focus-ring").match(/color-mix\(in srgb, var\(--accent\) (\d+)%, (#[0-9a-f]{6})\)/i);
  assert.ok(ring, "the light ring is the accent darkened");
  for (const accent of ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"]) {
    assert.ok(contrast(mix(accent, ring[2], Number(ring[1])), lbg) >= 3, `light focus ring is visible with accent ${accent}`);
  }
  assert.match(themes, /input:focus, select:focus, textarea:focus \{ box-shadow: 0 0 0 2px var\(--focus-ring\); \}/);
});
