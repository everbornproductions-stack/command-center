// Phase 1: colour themes. Pure validation plus the running server (temp data dir, demo mode only).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { normalize, DEFAULTS, ACCENTS, BACKGROUNDS, MODES } from "../server/plugins/themes.js";

test("normalize: defaults, presets, short hex, rejects junk", () => {
  const d = normalize({}, DEFAULTS);
  assert.equal(d.mode, "dark"); assert.equal(d.accent, "#22d3ee"); assert.ok(d.updatedAt > 0);
  assert.equal(normalize({ mode: "light" }, DEFAULTS).mode, "light");
  assert.equal(normalize({ mode: "system" }, DEFAULTS).mode, "system");
  assert.equal(normalize({ accent: "violet" }, DEFAULTS).accent, ACCENTS.violet);
  assert.equal(normalize({ accent: "#ABC" }, DEFAULTS).accent, "#aabbcc");
  assert.equal(normalize({ accent: " #FF7000 " }, DEFAULTS).accent, "#ff7000");
  assert.equal(normalize({}, DEFAULTS).background, null);
  assert.equal(normalize({ background: "paper" }, DEFAULTS).background, BACKGROUNDS.paper);
  assert.equal(normalize({ background: "#345" }, DEFAULTS).background, "#334455");
  assert.equal(normalize({ background: "" }, { ...DEFAULTS, background: "#112233" }).background, null);
  assert.equal(normalize({ accent: "#ff7000" }, { ...DEFAULTS, background: "#112233" }).background, "#112233");
  for (const badBg of ["red", "url(http://x)", "javascript:alert(1)", "#22d3ee;background:url(x)"]) assert.throws(() => normalize({ background: badBg }, DEFAULTS), /background must be/);
  // a partial update keeps the other field
  assert.equal(normalize({ accent: "#ff7000" }, { mode: "light", accent: "#000000" }).mode, "light");
  for (const badMode of ["blue", "", null, 1, "DARK"]) assert.throws(() => normalize({ mode: badMode }, DEFAULTS), /mode must be/);
  for (const badAccent of ["red", "22d3ee", "#22d3eeff", "#ggg", "", "url(x)", "#22d3ee; background:red"]) assert.throws(() => normalize({ accent: badAccent }, DEFAULTS), /accent must be/);
  assert.throws(() => normalize([], DEFAULTS), /object/);
  assert.throws(() => normalize(null, DEFAULTS), /object/);
  assert.deepEqual(MODES, ["dark", "light", "system"]);
});

let s;
before(async () => { s = await startServer(); });
after(async () => { await s?.stop(); });

test("server: GET returns defaults with presets; POST saves; invalid → 400 and unchanged; DELETE resets", async () => {
  assert.equal((await s.api("/themes", { noToken: true })).status, 401, "needs the session token");
  const g = await s.api("/themes");
  assert.equal(g.status, 200);
  assert.equal(g.json.mode, "dark"); assert.equal(g.json.accent, "#22d3ee");
  assert.equal(g.json.background, null);
  assert.equal(g.json.backgrounds.paper, BACKGROUNDS.paper);
  assert.equal(g.json.presets.violet, ACCENTS.violet);
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

  const reset = await s.api("/themes", { method: "DELETE" });
  assert.equal(reset.status, 200); assert.equal(reset.json.mode, "dark"); assert.equal(reset.json.accent, "#22d3ee");
  assert.equal(reset.json.background, null);
  assert.equal((await s.api("/themes/other")).status, 404, "unknown sub-path falls through to 404");
  const st = await s.api("/state");
  assert.ok(st.json.plugins.includes("themes"), "plugin is listed in state");
});

test("appearance panel offers a custom background and has no em-dash", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "themes.js"), "utf8");
  assert.match(ui, /Background/);
  assert.match(ui, /id="cc-bg-custom"/);
  assert.match(ui, /Built-in/);
  assert.equal(ui.includes("\u2014"), false);
  assert.equal(fs.readFileSync(path.join(ROOT, "server", "plugins", "themes.js"), "utf8").includes("\u2014"), false);
});
