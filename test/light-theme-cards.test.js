import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "web");
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === "vendor" || f.name === "node_modules") continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else if (/\.(js|css|html)$/.test(f.name)) out.push(p);
  }
  return out;
}

test("no card or panel paints a hard-coded very dark background", () => {
  const bad = [];
  for (const f of walk(root)) {
    const src = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    src.split("\n").forEach((line, i) => {
      // background: #0xxxxx with no var() in front of it (dark values start with #0 or #1 and are 6 digits)
      if (/background:\s*#0[0-9a-f]{5}\b/i.test(line) && !/var\(--card/.test(line)) {
        if (/\.(sig\.ok|dragover)|tr:hover/.test(line) || /dragover/.test(line)) return;
        bad.push(`${path.relative(root, f)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test("light theme defines the card colours the pages use", () => {
  const src = fs.readFileSync(path.join(root, "features", "themes.js"), "utf8");
  assert.match(src, /html\[data-theme="light"\][^}]*--card-bg:\s*#ffffff/);
  assert.match(src, /--sunk-bg/);
  assert.match(src, /--card-hover/);
});

test("toasts sit above every dialog", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const m = css.match(/\.toasts\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(m && Number(m[1]) >= 9500);
});
