// Slice B4: custom project templates (flag: templates).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { templatesOn, flagOn } from "../server/flags.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);

test("flag is off by default; env and saved setting turn it on", () => {
  const was = process.env.CC_FLAG_TEMPLATES;
  try {
    delete process.env.CC_FLAG_TEMPLATES;
    assert.equal(flagOn("templates"), false);
    assert.equal(templatesOn({}), false);
    assert.equal(templatesOn({ flag_templates: true }), true);
    process.env.CC_FLAG_TEMPLATES = "0";
    assert.equal(templatesOn({ flag_templates: true }), false);
    process.env.CC_FLAG_TEMPLATES = "1";
    assert.equal(templatesOn({}), true);
  } finally { if (was === undefined) delete process.env.CC_FLAG_TEMPLATES; else process.env.CC_FLAG_TEMPLATES = was; }
});

test("flag off: routes are closed and the picker has no templates", async () => {
  const s = await startServer({ env: { CC_FLAG_TEMPLATES: "0" } });
  try {
    assert.equal((await s.api("/walkthrough/templates")).status, 404);
    const r = await s.api("/walkthrough");
    assert.equal(r.status, 200);
    assert.equal(r.json.templates, undefined);
    assert.equal((await s.api("/state")).json.flags.templates, false);
  } finally { await s.stop(); }
});

test("flag on: save from a project, list, start from it, edit, delete", async () => {
  const s = await startServer({ env: { CC_FLAG_TEMPLATES: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.templates, true);
    const walk = await s.api("/walkthrough", { method: "POST", body: { type: "website" } });
    assert.equal(walk.status, 200);
    const idea = await s.api(`/walkthrough/${walk.json.id}/idea`, { method: "POST", body: { idea: "A weekend bread shop site for neighbors" } });
    assert.equal(idea.status, 200);
    await s.api(`/walkthrough/${walk.json.id}/answers`, { method: "POST", body: { answers: { audience: "Neighbors", action: "Order ahead" } } });

    const made = await s.api("/walkthrough/templates", { method: "POST", body: { walkId: walk.json.id, name: "Bakery site", folders: "Photos, Logos" } });
    assert.equal(made.status, 200);
    assert.equal(made.json.type, "website");
    assert.deepEqual(made.json.folders, ["Photos", "Logos"]);
    assert.equal(made.json.answers.audience, "Neighbors");

    const list = await s.api("/walkthrough/templates");
    assert.equal(list.json.templates.length, 1);
    const picker = await s.api("/walkthrough");
    assert.equal(picker.json.templatesEnabled, true);
    assert.equal(picker.json.templates[0].name, "Bakery site");
    assert.equal(picker.json.types.length, 6);

    const from = await s.api("/walkthrough", { method: "POST", body: { templateId: made.json.id } });
    assert.equal(from.status, 200);
    assert.equal(from.json.type, "website");
    assert.equal(from.json.idea, "A weekend bread shop site for neighbors");
    assert.equal(from.json.answers.action, "Order ahead");
    assert.equal(from.json.templateName, "Bakery site");
    assert.equal((await s.api("/walkthrough", { method: "POST", body: { templateId: "nope" } })).status, 404);

    const put = await s.api(`/walkthrough/templates/${made.json.id}`, { method: "PUT", body: { name: "Bakery v2", note: "Short note" } });
    assert.equal(put.json.name, "Bakery v2");
    assert.equal(put.json.idea, "A weekend bread shop site for neighbors");
    assert.equal((await s.api("/walkthrough/templates/zzz", { method: "PUT", body: { name: "xx" } })).status, 404);

    const del = await s.api(`/walkthrough/templates/${made.json.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal((await s.api("/walkthrough/templates")).json.templates.length, 0);
    assert.equal((await s.api(`/walkthrough/templates/${made.json.id}`, { method: "DELETE" })).status, 404);
  } finally { await s.stop(); }
});

test("flag on: bad input is refused and a key-like text is not saved", async () => {
  const s = await startServer({ env: { CC_FLAG_TEMPLATES: "1" } });
  try {
    assert.equal((await s.api("/walkthrough/templates", { method: "POST", body: { name: "x", type: "website" } })).status, 400);
    assert.equal((await s.api("/walkthrough/templates", { method: "POST", body: { name: "Fine name", type: "nope" } })).status, 400);
    const key = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
    const bad = await s.api("/walkthrough/templates", { method: "POST", body: { name: "Leaky", type: "app", idea: `use ${key} here` } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "secret");
    assert.equal((await s.api("/walkthrough/templates")).json.templates.length, 0);
  } finally { await s.stop(); }
});

test("UI wiring: no em dashes, text wraps, buttons present", () => {
  const files = ["server/project-templates.js", "web/features/walkthrough.js", "test/templates.test.js"];
  for (const f of files) {
    const src = read(f);
    assert.ok(!src.includes(DASH), `${f} has an em dash`);
  }
  const ui = read("web/features/walkthrough.js");
  for (const need of ["Save as template", "data-tpl-start", "data-tpl-edit", "data-tpl-del", "overflow-wrap: anywhere", "min-width: 0"]) assert.ok(ui.includes(need), need);
});
