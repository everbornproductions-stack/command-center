// Slice A1: Working-in project bar, Continue this project, Recently Deleted (flag: projectbar).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { barShows, barHtml, lastRunFor, BAR_VIEWS } from "../web/projectbar.js";
import { flagOn } from "../server/flags.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const body = (name) => ({ name, color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] });
const DASH = String.fromCharCode(0x2014);

test("flag is on by default and env turns it off or on", () => {
  const was = process.env.CC_FLAG_PROJECTBAR;
  try {
    delete process.env.CC_FLAG_PROJECTBAR;
    assert.equal(flagOn("projectbar"), true);
    process.env.CC_FLAG_PROJECTBAR = "1";
    assert.equal(flagOn("projectbar"), true);
    process.env.CC_FLAG_PROJECTBAR = "0";
    assert.equal(flagOn("projectbar"), false);
  } finally { if (was === undefined) delete process.env.CC_FLAG_PROJECTBAR; else process.env.CC_FLAG_PROJECTBAR = was; }
});

test("bar helpers: shows only on the tool pages and only when the flag is on", () => {
  for (const v of ["command", "images", "media", "remix", "builders", "webbuilders", "publish"]) assert.equal(barShows(v, true), true);
  assert.equal(barShows("images", false), false);
  assert.equal(barShows("settings", true), false);
  assert.equal(BAR_VIEWS.includes("projects"), false);
  const html = barHtml({ projects: [{ id: "a", name: "A <b>" }], selected: "a", view: "images" });
  assert.match(html, /Working in:/);
  assert.match(html, /value="a" selected>A &lt;b&gt;/);
  assert.match(html, /Continue this project/);
  assert.match(html, /data-pb-go="images" aria-current="page"/);
  const none = barHtml({ projects: [{ id: "a", name: "A" }], selected: "", view: "media" });
  assert.doesNotMatch(none, /Continue this project/);
  assert.doesNotMatch(none, /data-pb-go/);
  const rows = [{ id: "m1", projectId: "a", startedAt: 1 }, { id: "m2", projectId: "a", startedAt: 5 }, { id: "m3", projectId: "b", startedAt: 9 }];
  assert.equal(lastRunFor(rows, "a").id, "m2");
  assert.equal(lastRunFor(rows, "zzz"), null);
});

test("flag off: delete is still a hard delete and Recently Deleted is closed", async () => {
  const s = await startServer({ env: { CC_FLAG_PROJECTBAR: "0" } });
  try {
    const made = await s.api("/projects", { method: "POST", body: body("Hard one") });
    const del = await s.api(`/projects/${made.json.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(del.json.receipt.removed, true);
    assert.equal((await s.api("/projects-deleted")).status, 404);
    const st = await s.api("/state");
    assert.deepEqual(st.json.deletedProjects, []);
    assert.equal(st.json.flags.projectbar, false);
  } finally { await s.stop(); }
});

test("flag on: delete moves to Recently Deleted, leaves state and pickers, and can be undone", async () => {
  const s = await startServer({ env: { CC_FLAG_PROJECTBAR: "1" } });
  try {
    const made = await s.api("/projects", { method: "POST", body: body("Soft one") });
    assert.equal(made.status, 200);
    const id = made.json.id;
    let st = await s.api("/state");
    assert.equal(st.json.flags.projectbar, true);
    assert.ok(st.json.projects.some((p) => p.id === id));

    const del = await s.api(`/projects/${id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(del.json.soft, true);
    st = await s.api("/state");
    assert.equal(st.json.projects.some((p) => p.id === id), false);
    assert.ok(st.json.deletedProjects.some((d) => d.id === id && d.name === "Soft one"));
    assert.equal((await s.api(`/projects/${id}`, { method: "DELETE" })).status, 404);

    const list = await s.api("/projects-deleted");
    assert.equal(list.status, 200);
    assert.equal(list.json.projects.length, 1);

    // a new project that took the same id blocks the restore with a plain message
    const clash = await s.api("/projects", { method: "POST", body: body("Soft one") });
    assert.equal(clash.status, 200);
    assert.equal((await s.api(`/projects-deleted/${id}/restore`, { method: "POST", body: {} })).status, 409);
    await s.api(`/projects/${id}`, { method: "DELETE" });
    assert.equal((await s.api("/projects-deleted")).json.projects.length, 1);
    await s.api(`/projects-deleted/${id}?confirm=yes`, { method: "DELETE" });

    // an ordinary undo, and a name that is taken meanwhile gets (restored)
    await s.api("/projects", { method: "POST", body: { ...body("Second"), id: "second" } });
    await s.api("/projects/second", { method: "DELETE" });
    await s.api("/projects", { method: "POST", body: { ...body("Second"), id: "second-new" } });
    const back = await s.api("/projects-deleted/second/restore", { method: "POST", body: {} });
    assert.equal(back.status, 200);
    assert.equal(back.json.project.name, "Second (restored)");
    st = await s.api("/state");
    assert.ok(st.json.projects.some((p) => p.id === "second"));
    assert.equal(st.json.deletedProjects.length, 0);
  } finally { await s.stop(); }
});

test("flag on: deleting for good needs the confirm word and removes it", async () => {
  const s = await startServer({ env: { CC_FLAG_PROJECTBAR: "1" } });
  try {
    const made = await s.api("/projects", { method: "POST", body: body("Gone for good") });
    const id = made.json.id;
    await s.api(`/projects/${id}`, { method: "DELETE" });
    const noConfirm = await s.api(`/projects-deleted/${id}`, { method: "DELETE" });
    assert.equal(noConfirm.status, 400);
    assert.equal((await s.api("/projects-deleted")).json.projects.length, 1);
    const real = await s.api(`/projects-deleted/${id}?confirm=yes`, { method: "DELETE" });
    assert.equal(real.status, 200);
    assert.equal(real.json.receipt.removed, true);
    assert.equal((await s.api("/projects-deleted")).json.projects.length, 0);
    assert.equal((await s.api(`/projects-deleted/${id}/restore`, { method: "POST", body: {} })).status, 404);
  } finally { await s.stop(); }
});

test("web and server wiring is in place and has no em dashes", () => {
  const app = read("web", "app.js");
  assert.match(app, /import \{ barShows, barHtml, lastRunFor \} from "\.\/projectbar\.js"/);
  const render = app.slice(app.indexOf("function render()"), app.indexOf("// Feature tabs register themselves"));
  assert.match(render, /syncProjectBar\(\)/);
  assert.match(app, /function continueProject/);
  assert.match(app, /S\.lastOrders = String\(words\)/);
  assert.match(app, /data-continue=/);
  assert.match(app, /data-del=/);
  assert.match(app, /label: "Undo"/);
  assert.match(app, /clearActiveProject\(p\.id\)/);
  assert.match(app, /confirm=yes/);
  assert.match(read("web", "features", "images.js"), /setWorkingProject/);
  assert.match(read("web", "features", "media.js"), /setWorkingProject/);
  assert.match(read("web", "features", "liveview.js"), /data-continue/);
  assert.match(read("web", "features", "remix.js"), /workingProjectId/);
  assert.match(read("server", "plugins", "remix.js"), /flagOn\("projectbar"\)/);
  for (const f of [["web", "projectbar.js"], ["server", "flags.js"], ["test", "projectbar.test.js"]]) assert.equal(read(...f).includes(DASH), false, f.join("/"));
  const added = read("web", "app.js").split("\n").filter((l) => /projectbar|Recently Deleted|continueProject|deleteProjectSoft/.test(l)).join("\n");
  assert.equal(added.includes(DASH), false);
});
