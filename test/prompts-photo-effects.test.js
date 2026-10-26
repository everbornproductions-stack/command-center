// Photo effects pack: ten image-edit prompts (idea via @getintoai). Each needs an image AI and a reference image.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PACK_DIR, readPackDir } from "../server/prompts/packs.js";
import { buildDrop } from "../server/prompts/drop.js";

const FILE = path.join(PACK_DIR, "photo-effects.json");
const RAW = JSON.parse(fs.readFileSync(FILE, "utf8"));
const TITLES = ["4K Effect", "Skin Enhancer", "GTA Effect", "Minecraft Effect", "Professional Portrait", "MS Paint Effect", "LEGO Effect", "Product Ad", "Group Selfie", "Anime Effect"];

test("photo effects: ten rows load as images and design prompts", () => {
  assert.deepEqual(RAW.map((r) => r.title), TITLES);
  const loaded = readPackDir().filter((r) => r.group === "photo effects");
  assert.equal(loaded.length, 10);
  for (const row of RAW) {
    assert.equal(row.category, "images and design");
    assert.equal(row.needs_reference_image, true);
    assert.equal(row.needs, "image AI");
    assert.match(row.tips, /Needs an image AI/);
    assert.match(row.source_note, /idea via @getintoai/);
    assert.ok(row.when.trim() && !row.when.includes("\n"));
    assert.ok(row.prompt.length > 400, row.id);
  }
});

test("photo effects: show in the Images box and have no dashes", () => {
  const drop = buildDrop({ stage: "im-prompt", weekly: readPackDir().filter((r) => r.group === "photo effects") });
  const stage = drop.groups.find((g) => g.id === "stage");
  assert.ok(stage && stage.items.length > 0);
  assert.ok(stage.items.every((i) => i.source_name === "@getintoai"));
  const src = fs.readFileSync(FILE, "utf8");
  assert.doesNotMatch(src, /\u2014|\u2013/);
});
