// Start a project tutorials on the live map. No AI is called. No em-dash.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mapTutorials } from "../server/map-tutorials.js";
import { TYPES } from "../server/walkthroughs.js";
import { ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("every project type has plain steps for the live map", () => {
  const list = mapTutorials();
  assert.deepEqual(list.map((t) => t.id), TYPES.map((t) => t.id));
  assert.equal(list.length, 6);
  for (const t of list) {
    assert.equal(t.steps.length, 4);
    assert.match(t.steps[2], /No AI is called/);
    assert.match(t.steps[3], /needs a click/);
  }
  assert.equal(JSON.stringify(list).includes("\u2014"), false);
  const plugin = read("server", "plugins", "liveview.js");
  const ui = read("web", "features", "liveview.js");
  assert.match(plugin, /tutorials: mapTutorials\(\)/);
  assert.match(ui, /id="lv-tutorials"/);
  assert.match(ui, /Watch on the map/);
  assert.match(ui, /Start this project/);
  assert.match(ui, /startProject\?\.begin/);
  assert.equal(ui.includes("\u2014"), false);
});
