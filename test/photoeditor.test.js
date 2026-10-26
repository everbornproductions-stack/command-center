// Slice C2: non-destructive photo editor (flag: photoeditor).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import { SLIDERS, PRESETS, blankRecipe, normalizeRecipe, isBlank, applyRecipe } from "../web/photo-adjust.js";
import { PROMPTS } from "../server/photo-edit.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = String.fromCharCode(0x2014), EN = String.fromCharCode(0x2013);
const px = (r, g, b) => [r, g, b, 255];
const flat = (n, rgb) => Uint8ClampedArray.from(Array.from({ length: n }, () => px(...rgb)).flat());

test("flag is off by default, env turns it on, other flags stay", () => {
  const was = process.env.CC_FLAG_PHOTOEDITOR;
  try {
    delete process.env.CC_FLAG_PHOTOEDITOR;
    assert.equal(flagOn("photoeditor"), false);
    assert.equal(flagView().photoeditor, false);
    for (const k of ["projectbar", "promptdrop", "nextactions", "projectmedia", "finishrouter"]) assert.ok(k in flagView(), k);
    process.env.CC_FLAG_PHOTOEDITOR = "1";
    assert.equal(flagOn("photoeditor"), true);
    assert.equal(flagView().photoeditor, true);
  } finally { if (was === undefined) delete process.env.CC_FLAG_PHOTOEDITOR; else process.env.CC_FLAG_PHOTOEDITOR = was; }
});

test("recipes are clamped, unknown keys dropped, and a blank recipe changes nothing", () => {
  assert.equal(SLIDERS.length, 10);
  const r = normalizeRecipe({ light: 500, exposure: -500, junk: 9, contrast: "12.6", clarity: "x" });
  assert.equal(r.light, 100);
  assert.equal(r.exposure, -100);
  assert.equal(r.contrast, 13);
  assert.equal(r.clarity, 0);
  assert.equal("junk" in r, false);
  assert.equal(isBlank(blankRecipe()), true);
  assert.equal(isBlank({ skin: 1 }), false);
  const src = flat(16, [120, 90, 60]);
  assert.deepEqual([...applyRecipe(src, 4, 4, blankRecipe())], [...src]);
  for (const p of PRESETS) for (const k of Object.keys(p.values)) assert.ok(SLIDERS.some((s) => s.id === k), `${p.id} ${k}`);
});

test("adjustments work on a copy, keep the size, and move pixels the right way", () => {
  const w = 8, h = 8;
  const src = flat(w * h, [128, 128, 128]);
  const before = [...src];
  const up = applyRecipe(src, w, h, { exposure: 50 });
  assert.deepEqual([...src], before, "input pixels are not changed");
  assert.equal(up.length, src.length);
  assert.ok(up[0] > 128, "exposure up is brighter");
  assert.ok(applyRecipe(src, w, h, { light: -60 })[0] < 128, "light down is darker");
  assert.ok(applyRecipe(src, w, h, { warmth: 60 })[0] > applyRecipe(src, w, h, { warmth: 60 })[2], "warm: red above blue");
  assert.ok(applyRecipe(src, w, h, { ambient: -60 })[2] > applyRecipe(src, w, h, { ambient: -60 })[0], "cool ambient: blue above red");
  // contrast pushes a bright pixel up and a dark one down
  const two = Uint8ClampedArray.from([...px(200, 200, 200), ...px(60, 60, 60)]);
  const c = applyRecipe(two, 2, 1, { contrast: 50 });
  assert.ok(c[0] > 200 && c[4] < 60);
  // highlights down touches bright pixels, hardly the dark ones; shadows up lifts dark ones
  const hl = applyRecipe(two, 2, 1, { highlights: -80 });
  assert.ok(hl[0] < 200 && Math.abs(hl[4] - 60) <= 2);
  const sh = applyRecipe(two, 2, 1, { shadows: 80 });
  assert.ok(sh[4] > 60 && Math.abs(sh[0] - 200) <= 2);
});

test("skin tone only moves skin colors, and clarity keeps skin soft and flat areas flat", () => {
  const skin = px(224, 172, 140), blue = px(40, 80, 220);
  const two = Uint8ClampedArray.from([...skin, ...blue]);
  const out = applyRecipe(two, 2, 1, { skin: 80 });
  assert.ok(out[0] > 224, "skin gets warmer");
  assert.deepEqual([...out.slice(4, 8)], [...blue], "blue is not changed");
  const flatImg = flat(100, [100, 120, 140]);
  assert.deepEqual([...applyRecipe(flatImg, 10, 10, { clarity: 100 })], [...flatImg], "no detail to sharpen");
  // an edge: clarity adds contrast across a non-skin edge more than across a skin edge
  const edge = (a, b) => { const d = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) d.push(...(x < 8 ? a : b)); return Uint8ClampedArray.from(d); };
  const gain = (a, b) => { const s = edge(a, b), o = applyRecipe(s, 16, 16, { clarity: 100 }); const i = (8 * 16 + 7) * 4; return Math.abs(o[i] - s[i]) + Math.abs(o[i + 4] - s[i + 4]); };
  assert.ok(gain(px(70, 70, 80), px(150, 150, 160)) > gain(px(200, 150, 120), px(224, 172, 140)));
});

test("prompts keep the original, plain words only", () => {
  assert.ok(PROMPTS.length >= 6);
  for (const p of PROMPTS) {
    assert.match(p.prompt, /original photo exactly as it is/);
    assert.match(p.prompt, /faces/);
    assert.equal(p.prompt.includes(EM) || p.title.includes(EM), false);
  }
});

test("files have no em or en dashes, no dead buttons, and the browser module parses", () => {
  for (const rel of ["server/photo-edit.js", "server/plugins/photoeditor.js", "web/photo-adjust.js", "web/features/photo-editor.js", "web/features/images.js", "test/photoeditor.test.js"]) {
    const t = read(rel);
    assert.equal(t.includes(EM), false, rel);
    assert.equal(t.includes(EN), false, rel);
  }
  const web = read("web/features/photo-editor.js");
  for (const m of web.matchAll(/<button\b([^>]*)>/g)) assert.ok(/\bid=["'][^"']+["']|\bdata-[a-z-]+/.test(m[1]), `unwired button <button${m[1]}>`);
  const dir = fs.mkdtempSync(path.join(ROOT, "test", ".pe-syntax-"));
  try {
    for (const f of ["web/features/photo-editor.js", "web/photo-adjust.js"]) {
      const tmp = path.join(dir, path.basename(f).replace(/\.js$/, ".mjs"));
      fs.copyFileSync(path.join(ROOT, f), tmp);
      const chk = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      assert.equal(chk.status, 0, chk.stderr);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(read("web/perf/registry.js"), /id: "photo-editor", views: \["images"\]/);
  assert.match(read("web/perf/registry.js"), /id: "photoeditor", file: "photoeditor\.js"/);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("edited-copy")]);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("routes: off by default, then versions are saved as new files and the original never changes", async () => {
  const srv = await startServer();
  const on = await startServer({
    env: { CC_FLAG_PHOTOEDITOR: "1" },
    seed(dir) {
      const media = path.join(dir, "projects", "alpha-proj", "media");
      fs.mkdirSync(media, { recursive: true });
      const f = path.join(media, "img-orig.png");
      fs.writeFileSync(f, PNG);
      fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: [{ id: "img-orig", source: "images", kind: "image", provider: "openai", op: "generate", status: "done", projectId: "alpha-proj", params: { prompt: "A real photo" }, createdAt: Date.now(), outputs: [f], mimes: ["image/png"] }] }));
      fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects: [{ id: "alpha-proj", name: "Alpha", color: "#22d3ee", categories: [] }] }));
    },
  });
  try {
    assert.equal((await srv.api("/state")).json.flags.photoeditor, false);
    const off = await srv.api("/photoeditor/config");
    assert.equal(off.status, 404);
    assert.equal(off.json.code, "flag_off");

    assert.equal((await on.api("/state")).json.flags.photoeditor, true);
    assert.equal((await on.api("/state")).json.flags.finishrouter, false, "other flags stay");
    const cfg = await on.api("/photoeditor/config");
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.sliders.length, 10);
    assert.ok(cfg.json.prompts.length >= 6);

    const origPath = path.join(on.dir, "projects", "alpha-proj", "media", "img-orig.png");
    const before = sha(origPath);

    const none = await on.api("/photoeditor/versions", { method: "POST", body: { imageId: "img-orig", recipe: { light: 0 } } });
    assert.equal(none.status, 400);
    assert.equal(none.json.code, "blank");
    const missing = await on.api("/photoeditor/versions", { method: "POST", body: { imageId: "img-nope", recipe: { light: 10 } } });
    assert.equal(missing.status, 404);
    const badImg = await on.api("/photoeditor/versions", { method: "POST", body: { imageId: "img-orig", recipe: { light: 10 }, dataUrl: "data:text/html;base64,AAAA" } });
    assert.equal(badImg.status, 400);
    assert.equal(badImg.json.code, "bad_render");

    const dataUrl = "data:image/jpeg;base64," + JPG.toString("base64");
    const saved = await on.api("/photoeditor/versions", { method: "POST", body: { imageId: "img-orig", index: 0, name: "Warm test", recipe: { warmth: 40, junk: 3, exposure: 999 }, dataUrl } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.name, "Warm test");
    assert.equal(saved.json.recipe.exposure, 100);
    assert.equal("junk" in saved.json.recipe, false);
    assert.ok(saved.json.renderId && saved.json.renderId !== "img-orig");

    // the edited copy is a new gallery picture in the same project, bytes as sent; the original is untouched
    const gal = await on.api("/images?projectId=alpha-proj");
    const copy = gal.json.items.find((r) => r.id === saved.json.renderId);
    assert.ok(copy, "edited copy is in the gallery");
    assert.equal(copy.provider, "photo-editor");
    assert.equal(copy.params.from.imageId, "img-orig");
    assert.ok(gal.json.items.some((r) => r.id === "img-orig"), "original row is still there");
    const copyFile = path.join(on.dir, "projects", "alpha-proj", "media", saved.json.renderId + ".jpg");
    assert.deepEqual(fs.readFileSync(copyFile), JPG);
    assert.equal(sha(origPath), before, "original bytes unchanged");

    const list = await on.api("/photoeditor/versions?imageId=img-orig");
    assert.equal(list.json.items.length, 1);
    assert.equal((await on.api("/photoeditor/versions?imageId=other")).json.items.length, 0);

    // deleting a version removes its edited copy only
    const del = await on.api(`/photoeditor/versions/${saved.json.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    const gal2 = await on.api("/images?projectId=alpha-proj");
    assert.equal(gal2.json.items.some((r) => r.id === saved.json.renderId), false);
    assert.ok(gal2.json.items.some((r) => r.id === "img-orig"), "original row survives");
    assert.equal(sha(origPath), before, "original bytes unchanged after delete");
    assert.equal(fs.existsSync(copyFile), false, "edited copy file removed");
    assert.equal((await on.api(`/photoeditor/versions/${saved.json.id}`, { method: "DELETE" })).status, 404);
  } finally { await srv.stop(); await on.stop(); }
});
