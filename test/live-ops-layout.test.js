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
  // 0.4.38 (Chris: Expert Command as a chat): the Deliverable box became the answer card under the order bubble. It is
  // drawn hidden and shows once there is a run (the empty page shows the heading instead of a waiting line).
  assert.match(app, /<div class="sc-ai" id="ex-answer" data-steps="none" \$\{S\.live\?\.id \|\| S\.make\?\.active \? "" : "hidden"\}>/);
  assert.match(app, /exAnswer\.hidden = !l\.id && !S\.make\?\.active/);
  assert.doesNotMatch(app, /id="deliv-panel"|id="deliv-wait"/, "no separate Deliverable box on the page");
});

test("Live ops has no inner scrollbar, council answers included", () => {
  assert.match(css, /\.cmd \.ops \.task-answer \.md, \.cmd \.ops \.ans \.body \{ max-height: none; overflow: visible; \}/);
  assert.match(css, /\.cmd \.ops \.council-cols \{[^}]*grid-auto-flow:\s*row[^}]*overflow:\s*visible/);
  // 0.4.38: the same inside the Expert chat's answer card, where the steps now show while a run works
  const chat = read("web", "expert-chat.css");
  assert.match(chat, /\.ex-chat #ops-panel \.task-answer \.md, \.ex-chat #ops-panel \.ans \.body \{ max-height: none; overflow: visible; \}/);
  assert.match(chat, /\.ex-chat #ops-panel \.council-cols \{[^}]*grid-auto-flow:\s*row[^}]*overflow:\s*visible/);
});

// 0.4.38 (Chris: Expert Command as a chat): no more columns. The steps (#ops-panel, Live ops) sit at the top of the
// answer card, above the answer text, and the marching orders box is the chat box pinned under the column.
test("the answer card puts the steps above the answer, and the orders box is pinned under the chat", () => {
  const at = app.indexOf('id="ex-answer"');
  const card = app.slice(at, app.indexOf('id="sc-turns"', at));
  assert.ok(card.indexOf('id="ops-panel"') > 0 && card.indexOf('id="ops-panel"') < card.indexOf('id="out-md"'), "the steps are on top of the answer");
  assert.match(card, /<div class="graph-wrap" id="graph"><\/div>\s*<div id="tasks" class="tasks"><\/div>\s*<div id="council"><\/div>/, "the Live Ops page still adopts the graph, steps and council with the panel");
  const chat = read("web", "expert-chat.css");
  assert.match(chat, /\.ex-chat \.orders \{ flex: none;/);
  assert.match(chat, /\.ex-chat #ex-answer:is\(\[data-steps="none"\], \[data-steps="fold"\]\) #ops-panel \{ display: none !important; \}/);
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
