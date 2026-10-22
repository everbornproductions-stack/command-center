// Phase 1: colour themes. Pure validation plus the running server (temp data dir, demo mode only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { normalize, validatePhoto, DEFAULTS, OLD_DEFAULTS, ACCENTS, BACKGROUNDS, GRADIENTS, IMAGES, LOOKS, MODES, PHOTO_LIMIT } from "../server/plugins/themes.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("normalize: defaults, presets, short hex, rejects junk", () => {
  // The rules below start from the plain look (no picture). The shipped default is checked after.
  const BASE = OLD_DEFAULTS;
  const d = normalize({}, BASE);
  assert.equal(d.mode, "dark"); assert.equal(d.accent, "#22d3ee"); assert.ok(d.updatedAt > 0);
  assert.equal(normalize({ mode: "light" }, BASE).mode, "light");
  assert.equal(normalize({ mode: "system" }, BASE).mode, "system");
  assert.equal(normalize({ accent: "violet" }, BASE).accent, ACCENTS.violet);
  assert.equal(normalize({ accent: "#ABC" }, BASE).accent, "#aabbcc");
  assert.equal(normalize({ accent: " #FF7000 " }, BASE).accent, "#ff7000");
  assert.equal(normalize({}, BASE).background, null);
  assert.equal(normalize({ background: "paper" }, BASE).background, BACKGROUNDS.paper);
  assert.equal(normalize({ background: "#345" }, BASE).background, "#334455");
  assert.equal(normalize({ background: "" }, { ...BASE, background: "#112233" }).background, null);
  assert.equal(normalize({ accent: "#ff7000" }, { ...BASE, background: "#112233" }).background, "#112233");
  assert.equal(normalize({ accent: "teal" }, BASE).accent, ACCENTS.teal);
  assert.equal(normalize({ accent: "magenta" }, BASE).accent, ACCENTS.magenta);
  assert.equal(normalize({ background: "charcoal" }, BASE).background, BACKGROUNDS.charcoal);
  assert.equal(normalize({ background: "fog" }, BASE).background, BACKGROUNDS.fog);
  assert.equal(normalize({}, BASE).wallpaper, null);
  assert.equal(normalize({ wallpaper: "gradient:aurora" }, BASE).wallpaper, "gradient:aurora");
  assert.equal(normalize({ wallpaper: "gradient:aurora" }, BASE).photo, null);
  assert.equal(normalize({ wallpaper: "image:horizon" }, { ...BASE, background: "#112233" }).background, "#112233");
  assert.equal(normalize({ wallpaper: "IMAGE:Bloom" }, BASE).wallpaper, "image:bloom");
  const withPhoto = normalize({ wallpaper: "photo", photo: PNG }, BASE);
  assert.equal(withPhoto.wallpaper, "photo");
  assert.equal(withPhoto.photo, PNG);
  assert.equal(normalize({ photo: PNG }, BASE).wallpaper, "photo");
  assert.equal(normalize({ wallpaper: "" }, { ...BASE, wallpaper: "gradient:dusk", photo: PNG }).wallpaper, null);
  assert.equal(normalize({ wallpaper: "" }, { ...BASE, wallpaper: "photo", photo: PNG }).photo, null);
  assert.equal(normalize({ accent: "gold" }, { ...BASE, wallpaper: "image:orbit" }).wallpaper, "image:orbit");
  assert.equal(LOOKS.harbor.background, "navy");
  assert.equal(LOOKS.aurora.wallpaper, "gradient:aurora");
  for (const badBg of ["red", "url(http://x)", "javascript:alert(1)", "#22d3ee;background:url(x)"]) assert.throws(() => normalize({ background: badBg }, BASE), /background must be/);
  for (const badWall of ["https://example.com/a.png", "url(https://example.com/a.png)", "javascript:alert(1)", "//cdn.example/a.png", "gradient:nope", "image:nope", "photo"]) {
    assert.throws(() => normalize({ wallpaper: badWall }, BASE), /wallpaper|photo|gradient|image|choose a photo/);
  }
  assert.throws(() => normalize({ photo: "https://example.com/a.jpg" }, BASE), /web address/);
  assert.throws(() => normalize({ photo: "data:image/svg+xml;base64,PHN2Zy8+" }, BASE), /PNG, JPEG, or WebP/);
  // a partial update keeps the other field
  assert.equal(normalize({ accent: "#ff7000" }, { mode: "light", accent: "#000000" }).mode, "light");
  for (const badMode of ["blue", "", null, 1, "DARK"]) assert.throws(() => normalize({ mode: badMode }, BASE), /mode must be/);
  for (const badAccent of ["red", "22d3ee", "#22d3eeff", "#ggg", "", "url(x)", "#22d3ee; background:red"]) assert.throws(() => normalize({ accent: badAccent }, BASE), /accent must be/);
  assert.throws(() => normalize([], BASE), /object/);
  assert.throws(() => normalize(null, BASE), /object/);
  assert.deepEqual(MODES, ["dark", "light", "system"]);
  assert.deepEqual(GRADIENTS, ["aurora", "dusk", "tide", "ember", "frost"]);
  assert.deepEqual(IMAGES, ["stage", "horizon", "orbit", "lattice", "bloom"]);
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(PHOTO_LIMIT)]);
  assert.throws(() => validatePhoto(`data:image/png;base64,${big.toString("base64")}`), /too large/);
  assert.throws(() => validatePhoto("data:image/jpeg;base64," + Buffer.from("not-a-jpeg").toString("base64")), /do not match/);
  assert.equal(validatePhoto(PNG), PNG);
  // The default since 0.4.17: dark, cyan accent, pine background, the built-in stage picture.
  assert.deepEqual({ ...DEFAULTS }, { mode: "dark", accent: "#22d3ee", background: "#10241c", wallpaper: "image:stage", photo: null });
  const fresh = normalize({}, DEFAULTS);
  assert.equal(fresh.wallpaper, "image:stage"); assert.equal(fresh.background, "#10241c"); assert.equal(fresh.photo, null);
});

let s;
before(async () => { s = await startServer(); });
after(async () => { await s?.stop(); });

test("server: GET returns defaults with presets; POST saves; invalid → 400 and unchanged; DELETE resets", async () => {
  assert.equal((await s.api("/themes", { noToken: true })).status, 401, "needs the session token");
  const g = await s.api("/themes");
  assert.equal(g.status, 200);
  assert.equal(g.json.mode, "dark"); assert.equal(g.json.accent, "#22d3ee");
  assert.equal(g.json.background, BACKGROUNDS.pine, "a new install starts on the default look");
  assert.equal(g.json.wallpaper, "image:stage");
  assert.equal(g.json.photo, null);
  assert.equal(g.json.note, null, "a new install gets no new-background note");
  assert.equal(g.json.hasPrevious, false);
  assert.deepEqual(g.json.defaults, { ...DEFAULTS });
  assert.equal(g.json.backgrounds.paper, BACKGROUNDS.paper);
  assert.equal(g.json.backgrounds.navy, BACKGROUNDS.navy);
  assert.equal(g.json.presets.violet, ACCENTS.violet);
  assert.equal(g.json.presets.gold, ACCENTS.gold);
  assert.deepEqual(g.json.gradients, GRADIENTS);
  assert.deepEqual(g.json.images, IMAGES);
  assert.equal(g.json.looks.paper.mode, "light");
  assert.deepEqual(g.json.modes, MODES);

  const p = await s.api("/themes", { method: "POST", body: { mode: "light", accent: "rose" } });
  assert.equal(p.status, 200); assert.equal(p.json.mode, "light"); assert.equal(p.json.accent, ACCENTS.rose);
  const again = await s.api("/themes");
  assert.equal(again.json.mode, "light"); assert.equal(again.json.accent, ACCENTS.rose);
  // persisted through the store as its own document (never settings.json, never data/)
  const file = path.join(s.dir, "themes.prefs.json");
  assert.ok(fs.existsSync(file), "themes.prefs.json written in the temp data dir");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).mode, "light");
  const settings = path.join(s.dir, "settings.json");
  if (fs.existsSync(settings)) assert.equal(JSON.parse(fs.readFileSync(settings, "utf8")).theme, undefined);

  const badMode = await s.api("/themes", { method: "POST", body: { mode: "neon" } });
  assert.equal(badMode.status, 400); assert.equal(badMode.json.code, "theme_invalid");
  const badAccent = await s.api("/themes", { method: "POST", body: { accent: "javascript:alert(1)" } });
  assert.equal(badAccent.status, 400);
  const unchanged = await s.api("/themes");
  assert.equal(unchanged.json.mode, "light"); assert.equal(unchanged.json.accent, ACCENTS.rose);

  const partial = await s.api("/themes", { method: "POST", body: { accent: "#ff7000" } });
  assert.equal(partial.json.mode, "light", "partial update keeps the mode"); assert.equal(partial.json.accent, "#ff7000");

  const bg = await s.api("/themes", { method: "POST", body: { background: "sand" } });
  assert.equal(bg.json.background, BACKGROUNDS.sand);
  assert.equal(bg.json.accent, "#ff7000", "a background change keeps the accent");
  const cleared = await s.api("/themes", { method: "POST", body: { background: "" } });
  assert.equal(cleared.json.background, null);
  const badBg = await s.api("/themes", { method: "POST", body: { background: "url(https://example.com/a.png)" } });
  assert.equal(badBg.status, 400);
  assert.equal((await s.api("/themes")).json.background, null);

  const grad = await s.api("/themes", { method: "POST", body: { wallpaper: "gradient:tide" } });
  assert.equal(grad.status, 200);
  assert.equal(grad.json.wallpaper, "gradient:tide");
  assert.equal(grad.json.photo, null);
  assert.equal(grad.json.accent, "#ff7000", "a gradient keeps the accent");
  const picture = await s.api("/themes", { method: "POST", body: { wallpaper: "image:lattice" } });
  assert.equal(picture.json.wallpaper, "image:lattice");
  const kept = await s.api("/themes", { method: "POST", body: { accent: "indigo" } });
  assert.equal(kept.json.wallpaper, "image:lattice", "an accent change keeps the picture");
  assert.equal(kept.json.accent, ACCENTS.indigo);
  const photo = await s.api("/themes", { method: "POST", body: { wallpaper: "photo", photo: PNG } });
  assert.equal(photo.status, 200);
  assert.equal(photo.json.wallpaper, "photo");
  assert.equal(photo.json.photo, PNG);
  const stored = JSON.parse(fs.readFileSync(path.join(s.dir, "themes.prefs.json"), "utf8"));
  assert.equal(stored.photo, PNG);
  assert.equal(stored.photo.includes("http"), false);
  for (const wallpaper of ["https://example.com/a.png", "url(https://example.com/a.png)", "image:remote", "javascript:alert(1)"]) {
    const refused = await s.api("/themes", { method: "POST", body: { wallpaper } });
    assert.equal(refused.status, 400, wallpaper);
  }
  const refusedPhoto = await s.api("/themes", { method: "POST", body: { photo: "https://example.com/me.jpg" } });
  assert.equal(refusedPhoto.status, 400);
  const still = await s.api("/themes");
  assert.equal(still.json.wallpaper, "photo");
  assert.equal(still.json.photo, PNG);
  const noPicture = await s.api("/themes", { method: "POST", body: { wallpaper: "" } });
  assert.equal(noPicture.json.wallpaper, null);
  assert.equal(noPicture.json.photo, null);

  const reset = await s.api("/themes", { method: "DELETE" });
  assert.equal(reset.status, 200); assert.equal(reset.json.mode, "dark"); assert.equal(reset.json.accent, "#22d3ee");
  assert.equal(reset.json.background, BACKGROUNDS.pine, "reset puts the default look back");
  assert.equal(reset.json.wallpaper, "image:stage");
  assert.equal(reset.json.photo, null);
  assert.equal((await s.api("/themes/other")).status, 404, "unknown sub-path falls through to 404");
  const st = await s.api("/state");
  assert.ok(st.json.plugins.includes("themes"), "plugin is listed in state");
});

test("appearance panel offers a custom background and has no em-dash", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "themes.js"), "utf8");
  assert.match(ui, /Background/);
  assert.match(ui, /id="cc-bg-custom"/);
  assert.match(ui, /Built-in/);
  assert.match(ui, /Theme presets/);
  assert.match(ui, /Your photo/);
  assert.match(ui, /No picture/);
  assert.match(ui, /type="file"/);
  assert.match(ui, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(ui, /Choose a photo from this computer/);
  assert.match(ui, /blur\(10px\)/);
  assert.match(ui, /dim, blurred layer/);
  assert.equal(/type="url"/.test(ui), false);
  assert.equal(ui.includes("<script"), false);
  for (const id of ["teal", "indigo", "gold", "magenta", "charcoal", "navy", "wine", "fog"]) assert.match(ui, new RegExp(id));
  for (const id of GRADIENTS) assert.match(ui, new RegExp(`${id}:\\s*"`));
  for (const id of IMAGES.filter((x) => x !== "stage")) assert.match(ui, new RegExp(`${id}:\\s*svgUri`));
  // The stage picture is a file shipped with the app, named in one constant.
  const m = ui.match(/DEFAULT_PICTURE_URL = "([^"]+)"/);
  assert.ok(m, "one path constant names the default picture");
  assert.match(ui, /stage: `url\('\$\{DEFAULT_PICTURE_URL\}'\)`/);
  assert.ok(fs.existsSync(path.join(ROOT, "web", m[1])), "the default picture ships in web/");
  assert.equal(ui.includes("\u2014"), false);
  assert.equal(fs.readFileSync(path.join(ROOT, "server", "plugins", "themes.js"), "utf8").includes("\u2014"), false);
});
