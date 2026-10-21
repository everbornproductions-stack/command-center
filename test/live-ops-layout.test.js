// Expert Command: Marching orders full height on the left, Deliverable over Live ops on the right.
// Live ops shows the 3 newest steps and See all, and is one line when idle.
// Home list rows use theme colours so light text never lands on a white button.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { IDLE_LINE, OPS_SHOWN, newestTasks, opsState, showDeliverable } from "../web/live-ops.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const app = read("web", "app.js");
const css = read("web", "styles.css");
const desk = read("web", "features", "desk.js");

test("Live ops is idle with no run, and with a finished run that left nothing to show", () => {
  assert.equal(IDLE_LINE, "Nothing running");
  assert.equal(opsState({ id: null }), "idle");
  assert.equal(opsState({ id: "r1", kind: "single", status: "done", tasks: {} }), "idle");
  assert.equal(opsState({ id: "r1", kind: "single", status: "running", tasks: {} }), "running");
  assert.equal(opsState({ id: "r1", kind: "mission", status: "done", tasks: { a: { id: "a" } } }), "running");
  assert.equal(opsState({ id: "r1", kind: "council", status: "done", council: {}, tasks: {} }), "running");
});

test("Live ops shows the 3 newest steps and counts the rest for See all", () => {
  const tasks = Object.fromEntries(["a", "b", "c", "d", "e"].map((id) => [id, { id }]));
  assert.equal(OPS_SHOWN, 3);
  const plain = newestTasks(tasks, {});
  assert.deepEqual(plain.shown.map((t) => t.id), ["e", "d", "c"]);
  assert.equal(plain.total, 5);
  const touched = newestTasks(tasks, { a: 9, c: 4, b: 7 });
  assert.deepEqual(touched.shown.map((t) => t.id), ["a", "b", "c"]);
  assert.equal(newestTasks(tasks, {}, 0).shown.length, 5, "See all lists every step");
  assert.match(app, /See all \(\$\{total\}\)/);
});

test("Deliverable stays hidden until there is a result", () => {
  assert.equal(showDeliverable({ id: null }, ""), false);
  assert.equal(showDeliverable({ id: "r1", kind: "mission", status: "running" }, ""), false);
  assert.equal(showDeliverable({ id: "r1", kind: "single", status: "running" }, "Hi"), true);
  assert.equal(showDeliverable({ id: "r1", kind: "research", status: "failed" }, ""), true);
  assert.match(app, /id="deliv-panel" hidden/);
  const side = app.slice(app.indexOf('<div class="cmd-side">'));
  assert.ok(side.indexOf('id="deliv-wait"') < side.indexOf('id="deliv-panel"'), "the short line sits where Deliverable goes");
  assert.match(app, /wait\.hidden = !panel\.hidden/, "the line shows only while Deliverable is hidden");
  assert.match(css, /\.cmd-side \.output \{[^}]*flex:\s*1 0 auto/, "Deliverable is not squeezed by Live ops");
});

test("Live ops has no inner scrollbar, council answers included", () => {
  assert.match(css, /\.cmd \.ops \.task-answer \.md, \.cmd \.ops \.ans \.body \{ max-height: none; overflow: visible; \}/);
  assert.match(css, /\.cmd \.ops \.council-cols \{[^}]*grid-auto-flow:\s*row[^}]*overflow:\s*visible/);
});

test("the right column puts Deliverable above Live ops, and the orders box fills the left", () => {
  const side = app.slice(app.indexOf('<div class="cmd-side">'));
  assert.ok(side.indexOf('id="deliv-panel"') < side.indexOf('id="ops-panel"'), "Deliverable is on top");
  assert.match(css, /\.cmd \.orders-panel #orders \{[^}]*flex:\s*1 1 auto/);
  assert.match(css, /\.cmd \.ops \{[^}]*overflow:\s*visible/);
  assert.match(css, /\.cmd \.ops\.idle \{[^}]*flex-direction:\s*row/);
  const stacked = css.slice(css.indexOf("@media (max-width: 1250px)"), css.indexOf("@media (max-width: 760px)"));
  assert.match(stacked, /\.cmd-side \{ overflow: visible; \}/);
});

test("Home: Welcome back sits under Live ops, and its rows use theme colours", () => {
  assert.match(desk, /querySelector\("#ops-panel"\)[\s\S]{0,80}ops\.after\(el\)/);
  const row = desk.match(/#cc-home \.cc-home-list button\.row \{([^}]+)\}/);
  assert.ok(row, "Home rows have their own style");
  assert.match(row[1], /background:\s*var\(--bg-2\)/);
  assert.match(row[1], /color:\s*var\(--text\)/);
  assert.match(desk, /#cc-home \.cc-home-list \.chip \{[^}]*color:\s*var\(--text\)/);
  assert.match(desk, /#cc-home \.dim \{ color: var\(--muted\); \}/);
});
