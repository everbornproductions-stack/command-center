// Chat project picker: "+ New project…" and rename, with empty and duplicate names refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { projectNameError, projectOptionsHtml, projectSlug } from "../web/project-picker.js";

const projects = [{ id: "my-project", name: "My project" }];

test("names: blank and duplicates are refused, a new name and a same-name rename are kept", () => {
  assert.equal(projectNameError("  ", projects), "Type a project name.");
  assert.equal(projectNameError("", projects), "Type a project name.");
  assert.equal(projectNameError("My project", projects), "A project with that name already exists.");
  assert.equal(projectNameError("my PROJECT", projects), "A project with that name already exists.");
  assert.equal(projectNameError("My-project", projects), "A project with that name already exists.");
  assert.equal(projectSlug("  Spring Sale  "), "spring-sale");
  assert.equal(projectNameError("Spring Sale", projects), "");
  assert.equal(projectNameError("My project", projects, "my-project"), "");
  assert.equal(projectNameError("Other", [...projects, { id: "other", name: "Other" }], "my-project"), "A project with that name already exists.");
  const html = projectOptionsHtml([{ id: "my-project", name: "My <project>" }], "my-project");
  assert.match(html, /<option value="">No project<\/option>/);
  assert.match(html, /value="my-project" selected>My &lt;project&gt;/);
  assert.match(html, /value="__new__">\+ New project…<\/option>/);
  assert.equal(html.includes("\u2014"), false);
  assert.equal(fs.readFileSync(path.join(ROOT, "web", "project-picker.js"), "utf8").includes("\u2014"), false);
});

test("Simple and Expert chat both offer new and rename on the project picker", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const simple = app.slice(app.indexOf("function renderSimpleChat"), app.indexOf("function renderCommand"));
  const expert = app.slice(app.indexOf("function renderCommand"), app.indexOf("function renderComposerAis"));
  for (const src of [simple, expert]) {
    assert.match(src, /projectField\(\)/);
    assert.match(src, /wireProjectPicker\(\)/);
  }
  assert.match(app, /id="proj-rename"/);
  assert.match(app, /id="proj-name"/);
  assert.match(app, /projectNameError\(/);
  assert.match(app, /\+ New project/);
  assert.equal(app.includes("\u2014"), false);
});

test("API creates a trimmed project, refuses a blank or duplicate, and renames in place", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/projects", { method: "POST", body: { name: "   " } })).status, 400);
    const dup = await s.api("/projects", { method: "POST", body: { name: "my project" } });
    assert.equal(dup.status, 400);
    assert.match(dup.json.error, /already exists/);
    const created = await s.api("/projects", { method: "POST", body: { name: "  Spring Sale  ", color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
    assert.equal(created.status, 200);
    assert.equal(created.json.name, "Spring Sale");
    assert.equal(created.json.id, "spring-sale");
    assert.equal(created.json.categories[0].id, "links");
    assert.equal((await s.api("/projects", { method: "POST", body: { name: "Spring-Sale" } })).status, 400);
    const renamed = await s.api("/projects", { method: "POST", body: { id: created.json.id, name: "Spring" } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.name, "Spring");
    assert.equal(renamed.json.id, "spring-sale");
    assert.equal(renamed.json.categories[0].id, "links");
    assert.equal((await s.api("/projects", { method: "POST", body: { id: created.json.id, name: "My project" } })).status, 400);
    assert.equal((await s.api("/projects", { method: "POST", body: { id: created.json.id, name: "  " } })).status, 400);
    const same = await s.api("/projects", { method: "POST", body: { id: "my-project", name: "My project" } });
    assert.equal(same.status, 200);
    assert.equal(same.json.name, "My project");
    const names = (await s.api("/state")).json.projects.map((p) => p.name).sort();
    assert.deepEqual(names, ["My project", "Spring"]);
  } finally { await s.stop(); }
});

test("free: a duplicate of the seeded project is refused, and a fourth new name is capped", async () => {
  const s = await startServer();
  try {
    const dup = await s.api("/projects", { method: "POST", body: { name: "My project" } });
    assert.equal(dup.status, 400);
    assert.match(dup.json.error, /already exists/);
    assert.equal((await s.api("/projects", { method: "POST", body: { name: "Second" } })).status, 200);
    assert.equal((await s.api("/projects", { method: "POST", body: { name: "Third" } })).status, 200);
    const fourth = await s.api("/projects", { method: "POST", body: { name: "Fourth" } });
    assert.equal(fourth.status, 402);
    assert.equal((await s.api("/state")).json.projects.length, 3);
  } finally { await s.stop(); }
});
