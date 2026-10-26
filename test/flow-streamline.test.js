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
  assert.match(APP, /window\.CC = \{ ask: askText, confirm: askConfirm, syncProjects, openProjectById/);
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

test("N12: Simple shows three plain steps and hides the stage editor behind Customize steps", () => {
  assert.match(WALK, /const PLAIN_STEPS = \[\["Idea"/);
  assert.match(WALK, /\["Plan", \["plan", "build"\]\]/);
  assert.match(WALK, /\["Result", \["review", "done"\]\]/);
  assert.match(WALK, /<summary class="small"><b>Customize steps<\/b>/);
  assert.match(WALK, /\$\{stepsHtml\(w, expert\)\}/);
  // Expert keeps the stage editor and the flow controls open.
  assert.match(WALK, /if \(expert\) return `\$\{rail\(w\)\}\$\{flowControlsHtml\(w\)\}`/);
});

test("projects: one status vocabulary, saved by the server, shown as chips", async () => {
  const { startServer } = await import("./helpers.js");
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const made = await s.api("/projects", { method: "POST", body: { name: "Chip test", color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [{ name: "a", url: "https://a.example" }] }] } });
    assert.equal(made.status, 200);
    const set = await s.api("/projects", { method: "POST", body: { id: made.json.id, status: "review" } });
    assert.equal(set.json.status, "Review");
    const bad = await s.api("/projects", { method: "POST", body: { id: made.json.id, status: "Banana" } });
    assert.equal(bad.json.status, "Review", "an unknown word does not replace the status");
    const sum = await s.api("/projects/summary");
    assert.equal(sum.status, 200);
    assert.equal(sum.json.summary[made.json.id].links, 1);
    assert.equal(typeof sum.json.summary[made.json.id].media, "number");
  } finally { await s.stop(); }
  for (const w of ["Draft", "Review", "Approved", "Scheduled", "Published"]) assert.ok(APP.includes(`${w}:`), w);
  assert.match(APP, /id="proj-status"/);
  assert.match(APP, /data-inside=/);
});

test("I13: Chat shows a Continue where I left off card for the last unfinished build", () => {
  assert.match(APP, /Continue where I left off/);
  assert.match(APP, /id="simple-continue"/);
  assert.match(WALK, /openWalk: async \(id\)/);
});

test("project detail opens on Media, with Overview second", () => {
  const pm = read("web/features/projectmedia.js");
  assert.ok(pm.indexOf('data-proj-subtab="media"') < pm.indexOf('data-proj-subtab="overview"'));
  assert.match(pm, /ui\.subTabByProject\[p\.id\] \|\| "media"/);
});

test("0.4.20: the in-app confirm box replaces native confirm in the batch of files this area touched", async () => {
  const dlg = read("web/ask-dialog.js");
  assert.match(dlg, /export function askConfirm\(message, opts = \{\}\)/);
  assert.match(dlg, /btn danger/);
  assert.match(dlg, /Cancel has focus first for a destructive question/);
  for (const f of ["web/features/schedules.js", "web/features/services.js", "web/features/libraries.js", "web/features/agents.js", "web/takeover-panel.js", "web/features/pipelines.js", "web/features/workspaces.js"]) {
    assert.equal(/(?<![\w.])(window\.)?confirm\(/.test(read(f)), false, `${f} still calls native confirm`);
  }
  // Behaviour: the box resolves true on OK, false on Cancel and Escape, with a fake DOM.
  const mk = (tag) => {
    const el = { tag, children: [], style: {}, listeners: {}, attrs: {}, remove() {}, append(...c) { el.children.push(...c); }, setAttribute(k, v) { el.attrs[k] = v; }, addEventListener(t, f) { el.listeners[t] = f; }, focus() { el.focused = true; } };
    return el;
  };
  const made = [];
  globalThis.document = { activeElement: null, createElement: (t) => { const e = mk(t); made.push(e); return e; }, body: mk("body") };
  try {
    const { askConfirm } = await import("../web/ask-dialog.js");
    let p = askConfirm("Delete it?", { danger: true, ok: "Delete" });
    const buttons = made.filter((e) => e.tag === "button");
    assert.equal(buttons[1].textContent, "Delete");
    assert.equal(buttons[1].className, "btn danger");
    assert.equal(buttons[0].focused, true, "Cancel has focus for a danger question");
    made.find((e) => e.tag === "form").listeners.submit({ preventDefault() {} });
    assert.equal(await p, true);
    made.length = 0;
    p = askConfirm("Go?");
    made.filter((e) => e.tag === "button")[0].listeners.click();
    assert.equal(await p, false);
    made.length = 0;
    p = askConfirm("Go?");
    made.find((e) => e.tag === "div" && e.listeners.keydown).listeners.keydown({ key: "Escape", preventDefault() {} });
    assert.equal(await p, false);
  } finally { delete globalThis.document; }
});
