// 0.4.17: the stage picture is the default look (dark, cyan accent, pine background colour).
// New installs start on it. Existing installs move to it once, keep what they had as
// "previous", and get one short note with Undo. Pure checks plus a real server.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { DEFAULTS, OLD_DEFAULTS, DEFAULT_VERSION, NEW_BACKGROUND_NOTE, migrate, restorePrevious, freshDoc } from "../server/plugins/themes.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const look = (d) => ({ mode: d.mode, accent: d.accent, background: d.background ?? null, wallpaper: d.wallpaper ?? null, photo: d.photo ?? null });

test("the note text is the one Chris asked for", () => {
  assert.equal(NEW_BACKGROUND_NOTE, "New background. Change it any time in Settings > Appearance.");
});

test("a new install starts on the default with no note", () => {
  const d = freshDoc();
  assert.deepEqual(look(d), { ...DEFAULTS });
  assert.equal(d.notePending, false);
  assert.equal(d.previous, null);
  assert.equal(migrate(d).changed, false, "a fresh doc is already up to date");
  assert.deepEqual(look(migrate(null).doc), { ...DEFAULTS });
});

test("an existing custom look moves to the default once and is kept as previous", () => {
  const mine = { mode: "dark", accent: "#22d3ee", background: "#10241c", wallpaper: "photo", photo: PNG, updatedAt: 1 };
  const first = migrate(mine, 1000);
  assert.equal(first.changed, true);
  assert.deepEqual(look(first.doc), { ...DEFAULTS });
  assert.deepEqual(first.doc.previous, look(mine));
  assert.equal(first.doc.notePending, true);
  assert.equal(first.doc.defaultVersion, DEFAULT_VERSION);
  const second = migrate(first.doc, 2000);
  assert.equal(second.changed, false, "the move runs only once");
  assert.equal(second.doc, first.doc);
  const undo = restorePrevious(first.doc, 3000);
  assert.equal(undo.restored, true);
  assert.deepEqual(look(undo.doc), look(mine), "Undo puts the old look back");
  assert.equal(undo.doc.previous, null);
  assert.equal(undo.doc.notePending, false);
  assert.equal(migrate(undo.doc).changed, false, "an Undo is not undone by the next launch");
  assert.equal(restorePrevious(undo.doc).restored, false, "nothing left to restore");
});

test("an install that never changed its look also moves, and Undo gives the old plain look", () => {
  const plain = { ...OLD_DEFAULTS, updatedAt: 1 };
  const { doc } = migrate(plain);
  assert.deepEqual(look(doc), { ...DEFAULTS });
  assert.deepEqual(doc.previous, { ...OLD_DEFAULTS });
  assert.deepEqual(look(restorePrevious(doc).doc), { ...OLD_DEFAULTS });
  // Someone already on exactly the default has nothing to keep.
  assert.equal(migrate({ ...DEFAULTS }).doc.previous, null);
});

// WCAG check over the brightest spot of the picture. The picture is drawn the way every
// picture wallpaper is drawn today (web/features/themes.js): blur(10px), a rgba(8,12,18,.5)
// veil, and panels at 62% of --panel-solid (#111827). BRIGHTEST is the brightest pixel of
// web/backgrounds/meldmind-default.jpg after that blur at 1920x1080 (measured with Pillow,
// GaussianBlur(10) on the cover-scaled picture; 1366x768 gives (251,229,179)). Measure it
// again if the picture file is replaced.
const BRIGHTEST = [251, 230, 219];
const lum = ([r, g, b]) => {
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a));
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("text over the default picture keeps WCAG AA contrast inside panels", () => {
  const veiled = over([8, 12, 18], 0.5, BRIGHTEST);
  const panel = over(hex("#111827"), 0.62, veiled);
  const text = ratio(hex("#e5e7eb"), panel);
  const accent = ratio(hex("#22d3ee"), panel);
  const muted = ratio(hex("#8b95a7"), panel);
  assert.ok(text >= 4.5, `body text ${text.toFixed(2)}:1`);
  assert.ok(accent >= 4.5, `accent links ${accent.toFixed(2)}:1`);
  // Grey helper text reaches the large-text level (3:1) even on the brightest stage light.
  assert.ok(muted >= 3, `muted text ${muted.toFixed(2)}:1`);
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "themes.js"), "utf8");
  assert.match(ui, /html\[data-wall="image"\] #cc-wall, html\[data-wall="photo"\] #cc-wall \{ inset: -20px; filter: blur\(10px\)/, "same blur as a photo");
  assert.match(ui, /html\[data-wall="image"\] #cc-wall-veil, html\[data-wall="photo"\] #cc-wall-veil \{ background: rgba\(8, 12, 18, \.5\); \}/, "same veil as a photo");
  assert.match(ui, /color-mix\(in srgb, var\(--panel-solid\) 62%, transparent\)/);
});

test("server: an existing look moves once, shows the note once, Undo restores it, and a restart does not move it again", async () => {
  const mine = { mode: "light", accent: "#a78bfa", background: null, wallpaper: "gradient:dusk", photo: null, updatedAt: 1 };
  let saved = null;
  const a = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "themes.prefs.json"), JSON.stringify(mine)) });
  try {
    const g = await a.api("/themes");
    assert.equal(g.status, 200);
    assert.deepEqual(look(g.json), { ...DEFAULTS });
    assert.equal(g.json.note, NEW_BACKGROUND_NOTE);
    assert.equal(g.json.hasPrevious, true);
    assert.equal(JSON.stringify(g.json).includes("gradient:dusk"), false, "the previous look itself is not sent to the browser");
    const ack = await a.api("/themes/note", { method: "POST" });
    assert.equal(ack.status, 200);
    assert.equal(ack.json.note, null);
    assert.equal((await a.api("/themes")).json.note, null, "the note shows once");
    // A normal change keeps the saved previous look.
    const changed = await a.api("/themes", { method: "POST", body: { accent: "gold" } });
    assert.equal(changed.json.hasPrevious, true);
    const undo = await a.api("/themes/previous", { method: "POST" });
    assert.equal(undo.status, 200);
    assert.deepEqual(look(undo.json), look(mine));
    assert.equal(undo.json.hasPrevious, false);
    assert.equal((await a.api("/themes/previous", { method: "POST" })).status, 409);
    const jpg = await a.raw({ path: "/backgrounds/meldmind-default.jpg" });
    assert.equal(jpg.status, 200);
    assert.match(String(jpg.headers["content-type"]), /image\/jpeg/);
    saved = fs.readFileSync(path.join(a.dir, "themes.prefs.json"), "utf8");
  } finally {
    await a.stop();
  }
  const b = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "themes.prefs.json"), saved) });
  try {
    const g = await b.api("/themes");
    assert.deepEqual(look(g.json), look(mine), "the next launch keeps the restored look");
    assert.equal(g.json.note, null);
  } finally {
    await b.stop();
  }
});
