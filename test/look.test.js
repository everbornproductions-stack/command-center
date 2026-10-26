// Slice A0 (0.4.19, flag_look): scoring rules, the choice, CSS scoping, startup markup, and the real route.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  normalizeChoice, scoreGraphics, scoreFrames, combineTier, decideLook, stutterVerdict, signature, OFFERS,
} from "../web/look-core.js";
import { lookFlag, normalize, normalizeCheck } from "../server/plugins/look.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM_DASH = String.fromCharCode(0x2014);

test("graphics reports score good, integrated, software and missing", () => {
  assert.equal(scoreGraphics({ renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)", width: 1920, height: 1080, cores: 8, memoryGb: 16 }).tier, "good");
  assert.equal(scoreGraphics({ renderer: "ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11)", width: 1920, height: 1080, cores: 8 }).tier, "borderline");
  assert.equal(scoreGraphics({ renderer: "Google SwiftShader" }).tier, "weak");
  assert.equal(scoreGraphics({ renderer: "ANGLE (Microsoft, Microsoft Basic Render Driver)" }).tier, "weak");
  assert.equal(scoreGraphics({ accelerated: false }).tier, "weak");
  assert.equal(scoreGraphics({}).tier, "borderline");
  assert.equal(scoreGraphics(null).tier, "borderline");
});

test("the frame test decides over the card name", () => {
  const smooth = Array.from({ length: 60 }, () => 16.7);
  const slow = Array.from({ length: 30 }, () => 40);
  const stutter = [16, 16, 16, 16, 16, 300, 16, 16, 16, 16, 16];
  assert.equal(scoreFrames(smooth).ok, true);
  assert.ok(scoreFrames(smooth).fps >= 55);
  assert.equal(scoreFrames(slow).ok, false);
  assert.equal(scoreFrames(stutter).stutter, true);
  assert.equal(scoreFrames([16, 16]).measured, false, "too few frames means no verdict");
  assert.equal(combineTier("good", scoreFrames(slow)), "borderline");
  assert.equal(combineTier("borderline", scoreFrames(slow)), "weak");
  assert.equal(combineTier("weak", scoreFrames(smooth)), "weak");
  assert.equal(combineTier("good", scoreFrames(smooth)), "good");
});

test("Auto asks, never forces; Classic and Full glass are honored", () => {
  assert.deepEqual(decideLook("auto", { tier: "good" }), { look: "glass", ask: "", warn: "", still: false, blur: true });
  assert.equal(decideLook("auto", { tier: "borderline" }).ask, "offer-classic");
  assert.equal(decideLook("auto", { tier: "borderline" }).look, "glass");
  const weak = decideLook("auto", { tier: "weak" });
  assert.equal(weak.look, "classic");
  assert.equal(weak.ask, "offer-glass");
  const forced = decideLook("glass", { tier: "weak" });
  assert.equal(forced.look, "glass", "turning it on works on any machine");
  assert.ok(forced.warn, "with a one-line speed warning");
  assert.equal(decideLook("classic", { tier: "good" }).look, "classic");
  assert.equal(decideLook("nonsense", { tier: "good" }).look, "glass");
  assert.equal(normalizeChoice(undefined), "auto");
  assert.equal(OFFERS["offer-classic"], "Your graphics look a little slow for the new look. Use the classic look?");
});

test("reduce motion and Low Power keep the glass still; Low Power drops blur", () => {
  const rm = decideLook("auto", { tier: "good", reducedMotion: true });
  assert.equal(rm.still, true); assert.equal(rm.blur, true);
  const lp = decideLook("auto", { tier: "good", lowPower: true });
  assert.equal(lp.still, true); assert.equal(lp.blur, false);
});

test("the running safety net needs sustained stutter, not one hitch", () => {
  const now = 20000;
  assert.equal(stutterVerdict([{ start: 15000, duration: 120 }], now), false);
  const many = Array.from({ length: 10 }, (_, i) => ({ start: 11000 + i * 800, duration: 500 }));
  assert.equal(stutterVerdict(many, now), true);
  assert.equal(stutterVerdict([{ start: 1000, duration: 9000 }], now), false, "old entries are ignored");
});

test("a saved check is tied to the computer and screen", () => {
  const a = { renderer: "X", width: 1920, height: 1080, dpr: 1, cores: 8 };
  assert.equal(signature(a), signature({ ...a }));
  assert.notEqual(signature(a), signature({ ...a, width: 3440 }));
});

test("flag_look is on by default and set by CC_FLAG_LOOK", () => {
  assert.equal(lookFlag({}), true);
  assert.equal(lookFlag({ CC_FLAG_LOOK: "1" }), true);
  assert.equal(lookFlag({ CC_FLAG_LOOK: "0" }), false);
  assert.equal(normalize({ choice: "Classic" }).choice, "classic");
  assert.throws(() => normalize({ choice: "neon" }), /choice must be/);
  assert.throws(() => normalizeCheck({ tier: "great" }), /tier must be/);
  assert.equal(normalizeCheck(null), null);
});

test("look.css: every rule is scoped so Classic and flag-off are unchanged", () => {
  const css = read("web", "look.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = read("web", "look-tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // tokens file holds variables only
  assert.doesNotMatch(tokens.replace(/:root(\[data-theme="light"\])? \{[^}]*\}/g, ""), /\S/, "tokens file is only :root blocks");
  // collect selectors of top-level rules (skip @keyframes bodies and @media wrappers)
  const flat = css.replace(/@keyframes [\w-]+ \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").replace(/@property[^{]*\{[^}]*\}/g, "")
    .replace(/@media[^{]*\{/g, "").replace(/\}\s*\}/g, "}");
  const selectors = [...flat.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
  assert.ok(selectors.length > 10);
  for (const group of selectors) {
    for (const sel of group.split(",").map((s) => s.trim()).filter(Boolean)) {
      assert.match(sel, /^(html\[data-look="(glass|classic)"\]|#cc-startup|#cc-look-|\.mm-sr)/, `unscoped selector: ${sel}`);
    }
  }
  // Classic: no blur and no animation on the rolling light
  const classic = css.match(/html\[data-look="classic"\][^{]*\{[^}]*\}/g).join("\n");
  assert.doesNotMatch(classic, /backdrop-filter\s*:\s*blur/);
  assert.match(classic, /display: none/);
  // rolling light is CSS only, honors reduce motion, hidden window and Low Power
  assert.match(css, /@property --mm-angle/);
  assert.match(css, /conic-gradient\(from var\(--mm-angle\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-hidden="1"\] \.rolling-light::before \{ animation-play-state: paused/);
  assert.match(css, /body\.light-mode \.rolling-light::before \{ animation: none/);
  assert.match(css, /data-blur="off"\]/);
  // frosted surfaces named in the audit
  for (const s of ["#cc-mode-ask .card", ".gate-card", "#cc-tour .card", "#cc-keysetup .box", ".nav-panel", "#cc-suggest .psg"]) assert.ok(css.includes(s), s);
});

test("glass text contrast holds over the busiest backdrop (4.5 to 1)", () => {
  const tokens = read("web", "look-tokens.css");
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const blocks = [...tokens.matchAll(/(:root(?:\[data-theme="light"\])?) \{([^}]*)\}/g)];
  assert.equal(blocks.length, 2);
  for (const [, name, body] of blocks) {
    const fill = body.match(/--mm-glass-fill:\s*rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/);
    const text = body.match(/--mm-text-on-glass:\s*(#[0-9a-f]{6})/i)[1];
    const [r, g, b, a] = [+fill[1], +fill[2], +fill[3], +fill[4]];
    for (const bg of [[0, 0, 0], [255, 255, 255]]) {
      const comp = [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
      assert.ok(ratio(hex(text), comp) >= 4.5, `${name} text on glass over ${bg}: ${ratio(hex(text), comp).toFixed(2)}`);
    }
  }
});

test("startup screen markup: tagline, gold A and I, screen reader label, skip, once per launch", () => {
  const js = read("web", "features", "look.js"), css = read("web", "look.css");
  assert.match(js, /Are you g<span class="mm-gold">A<\/span>m<span class="mm-gold">I<\/span>e\?/);
  assert.match(js, /aria-label", "Meldmind\.ai\. Are you game\?"/);
  assert.match(js, /<span class="mm-sr">Are you game\?<\/span>/);
  assert.match(js, /Meldmind\.ai<\/div>/);
  assert.match(js, /sessionStorage/);
  assert.match(js, /keydown/);
  assert.match(js, /touchstart/);
  assert.match(css, /#cc-startup\[data-still="1"\]/);
  assert.match(css, /#cc-startup \.mm-gold::before/);
  assert.doesNotMatch(js, /setInterval/, "no always-on loop");
});

test("wiring: stylesheet links, shell feature row, and no em dashes in new files", () => {
  assert.match(read("web", "index.html"), /href="\/look-tokens\.css"[\s\S]*href="\/look\.css"/);
  assert.match(read("web", "perf", "registry.js"), /\{ id: "look", shell: true \}/);
  for (const f of ["web/look-core.js", "web/look.css", "web/look-tokens.css", "web/features/look.js", "server/plugins/look.js", "test/look.test.js"]) {
    assert.ok(!read(...f.split("/")).includes(EM_DASH), `${f} has an em dash`);
  }
});

const api = (srv, p, opts = {}) => srv.api(p, opts);

test("route: flag off blocks changes; flag on saves choice and check", async () => {
  const off = await startServer({ env: { CC_FLAG_LOOK: "0" } });
  try {
    const g = await api(off, "/look");
    assert.equal(g.status, 200);
    assert.equal(g.json.flag, false);
    assert.equal(g.json.choice, "auto");
    const p = await api(off, "/look", { method: "POST", body: { choice: "glass" } });
    assert.equal(p.status, 404);
    assert.equal(p.json.code, "flag_off");
  } finally { await off.stop(); }
  const on = await startServer({ env: { CC_FLAG_LOOK: "1" } });
  try {
    assert.equal((await api(on, "/look")).json.flag, true);
    const bad = await api(on, "/look", { method: "POST", body: { choice: "neon" } });
    assert.equal(bad.status, 400);
    const ok = await api(on, "/look", { method: "POST", body: { choice: "classic", check: { tier: "weak", fps: 22, sig: "a|1|1|1|2" } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.choice, "classic");
    assert.equal(ok.json.check.tier, "weak");
    const again = await api(on, "/look");
    assert.equal(again.json.choice, "classic", "the choice persists");
    assert.equal(again.json.check.fps, 22);
  } finally { await on.stop(); }
});

test("startup screen: stays at least twice as long as before and twice the load time, fades out slowly (0.4.20)", () => {
  const js = read("web", "features", "look.js"), css = read("web", "look.css");
  const consts = js.match(/const SPLASH_BASE_MS[^\n]*\n/)[0];
  const fn = js.match(/function splashHold[\s\S]*?\n}\n/)[0];
  const splashHold = new Function(`${consts}\n${fn}\nreturn splashHold;`)();
  assert.equal(splashHold(0, false), 5200, "normal look: twice the old 2.6 s");
  assert.equal(splashHold(0, true), 3600, "quiet look: twice the old 1.8 s");
  assert.equal(splashHold(NaN, false), 5200);
  assert.equal(splashHold(4000, false), 8000, "twice a slow load");
  assert.equal(splashHold(60000, false), 12000, "never longer than 12 s");
  assert.match(js, /performance\.now\(\)/, "load time is measured");
  assert.match(css, /#cc-startup \{[^}]*transition: opacity \.9s/, "smooth fade");
  assert.match(css, /#cc-startup \.mm-name \{[^}]*clamp\(3\.2rem, 13vw, 7\.5rem\)/, "title text twice the old size");
  assert.match(css, /#cc-startup \.mm-tag \{[^}]*clamp\(2\.5rem, 8vw, 4rem\)/);
  assert.match(css, /#cc-startup \.mm-sub \{[^}]*clamp\(1\.25rem, 4\.4vw, 1\.875rem\)/);
  assert.match(css, /#cc-startup \{[^}]*text-align: center/, "centered on small windows");
});
