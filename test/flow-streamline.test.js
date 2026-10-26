// 0.4.20 area F: streamlined menus, Start a project, Projects. Source-text pins for web pieces
// (layout is proved with real browser runs, see notes0420/F.md) and plain checks for the server side.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
const APP = read("web/app.js");
const CSS = read("web/styles.css");
const WALK = read("web/features/walkthrough.js");

test("N3: a Start a project build refreshes the project list and links to the project", () => {
  assert.match(APP, /async function syncProjects\(\)/);
  assert.match(APP, /window\.CC = \{ ask: askText, syncProjects, openProjectById/);
  assert.match(WALK, /function paintWalk\(w\) \{[\s\S]{0,300}noteProject\(w\)/);
  assert.match(WALK, /label: "Open it"/);
});

test("N4: run counts and Recent runs hide internal prompts and group step runs", () => {
  assert.match(APP, /function visibleRuns\(rows\)/);
  assert.match(APP, /const runs = visibleRuns\(S\.missions\.filter\(\(m\) => m\.projectId === p\.id\)\)/);
  assert.match(APP, /function recentRunRows\(rows\) \{\n  return visibleRuns\(rows\)/);
  assert.match(APP, /WALKTHROUGH_\[A-Z_\]\+/);
});

test("N4: raw temp paths in HQ task titles are made plain", () => {
  assert.match(read("server/projects.js"), /title: plainPaths\(t\.title\)/);
});

test("N11: the Projects grid wraps to one column under 1500 px", () => {
  assert.match(APP, /class="grid projects-grid"/);
  assert.doesNotMatch(APP, /grid-template-columns: 1fr 360px/);
  assert.match(CSS, /@media \(min-width: 1500px\) \{ \.projects-grid \{ grid-template-columns: minmax\(0, 1fr\) 360px; \} \}/);
});
