// 0.4.21 (area D): real see-through glass. Rules are tested as pure functions; the page is tested by computed style.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { finalTier, decideLook, scoreFrames, signature } from "../web/look-core.js";
import { bootPage, findBrowser } from "./pw-helpers.js";

const read = (...p) => fs.readFileSync(path.join(import.meta.dirname, "..", ...p), "utf8").replace(/\r\n/g, "\n");

test("the card name alone no longer turns glass off when the window can draw backdrop-filter", () => {
  const slow = scoreFrames(Array.from({ length: 40 }, () => 33)); // about 30 frames a second
  assert.equal(finalTier("weak", null, true).tier, "borderline", "software name, no frame test yet: still glass");
  assert.equal(finalTier("weak", slow, true).tier, "borderline", "30 fps is fine for glass");
  const awful = scoreFrames(Array.from({ length: 30 }, () => 100)); // 10 fps
  assert.equal(finalTier("weak", awful, true).tier, "weak");
  assert.ok(finalTier("weak", awful, true).reason.length > 5, "a reason is given for Settings");
  const nb = finalTier("good", null, false);
  assert.equal(nb.tier, "weak");
  assert.match(nb.reason, /cannot draw see-through glass/);
});

test("Auto goes Classic only when backdrop-filter is missing; Full glass always works", () => {
  assert.equal(decideLook("auto", { tier: "weak", backdrop: false }).look, "classic");
  assert.equal(decideLook("auto", { tier: "weak", backdrop: false }).ask, "");
  assert.equal(decideLook("glass", { tier: "weak", backdrop: false }).look, "glass", "Try glass anyway");
  assert.equal(decideLook("auto", { tier: "good", backdrop: true }).look, "glass");
});

test("old saved graphics checks are retired by the new signature", () => {
  assert.match(signature({ renderer: "x" }), /\|g2$/);
});

test("source: Settings > Look explains a fallback and offers Try glass anyway", () => {
  const js = read("web", "features", "look.js");
  assert.match(js, /Try glass anyway/);
  assert.match(js, /CSS\.supports\("backdrop-filter"/);
  assert.doesNotMatch(read("web", "look.css"), /—|–/);
});

test("glass tokens keep 4.5 to 1 text contrast over the brightest picture (picture is dimmed by brightness())", () => {
  const tokens = read("web", "look-tokens.css");
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const blocks = [...tokens.matchAll(/(:root(?:\[data-theme="light"\])?) \{([^}]*)\}/g)];
  for (const [, name, body] of blocks) {
    const see = body.match(/--mm-glass-see:\s*rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
    const dim = Number(body.match(/--mm-glass-dim:\s*([\d.]+)/)[1]);
    const text = body.match(/--mm-text-on-glass:\s*(#[0-9a-f]{6})/i)[1];
    const [r, g, b, a] = [+see[1], +see[2], +see[3], +see[4]];
    assert.ok(a < 0.9, `${name} glass fill must be see-through (alpha ${a})`);
    // worst case picture: white for dark text (light theme is veiled to ~245), black-to-white for light text
    const worst = name.includes("light") ? [[0, 0, 0]] : [[255, 255, 255]];
    for (const bg of worst) {
      const behind = bg.map((c) => Math.min(255, c * dim));
      const comp = [r, g, b].map((c, i) => Math.round(c * a + behind[i] * (1 - a)));
      assert.ok(ratio(hex(text), comp) >= 4.5, `${name}: ${ratio(hex(text), comp).toFixed(2)}`);
    }
  }
});

test("real page: the glass look gives a computed backdrop-filter and a panel fill below 0.9 alpha", { skip: findBrowser() ? false : "no Chrome installed" }, async () => {
  const t = await bootPage({ width: 1366, height: 768, mode: "simple", hidePopups: true });
  try {
    await t.page.evaluate(() => localStorage.setItem("cc.look", JSON.stringify({ choice: "glass" })));
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => window.CC && window.CC.go && document.documentElement.dataset.look === "glass", null, { timeout: 15000 });
    const r = await t.page.evaluate(() => {
      const el = document.querySelector(".panel, .projbar, .topbar");
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/[\d.]+/g).map(Number);
      return { bf: cs.backdropFilter || cs.webkitBackdropFilter, alpha: m.length > 3 ? m[3] : 1, wallFilter: getComputedStyle(document.getElementById("cc-wall")).filter, blur: document.documentElement.dataset.blur };
    });
    assert.match(r.bf, /blur\(/);
    assert.ok(r.alpha < 0.9, `panel alpha ${r.alpha}`);
    assert.equal(r.blur, "on");
    assert.doesNotMatch(r.wallFilter, /blur/, "the stage picture is sharp under glass");
    // and Classic stays solid
    await t.page.evaluate(() => localStorage.setItem("cc.look", JSON.stringify({ choice: "classic" })));
    await t.page.reload({ waitUntil: "domcontentloaded" });
    await t.page.waitForFunction(() => document.documentElement.dataset.look === "classic", null, { timeout: 15000 });
  } finally { await t.close(); }
});
