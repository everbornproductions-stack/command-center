import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { TYPES } from "../server/walkthroughs.js";
import { normalizeTemplate } from "../server/project-templates.js";

test("new project types have valid questions", () => {
  const ids = ["spreadsheet", "document", "slides", "online-store", "event", "channel", "course", "game-mod"];
  for (const id of ids) {
    const type = TYPES.find((t) => t.id === id);
    assert.ok(type, id); assert.ok(type.questions.length >= 3 && type.questions.length <= 4);
    for (const q of type.questions) assert.ok(q.key && q.label && q.placeholder);
  }
});

test("ready templates normalize and load as ten starter items", () => {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, "server/template-library.json"), "utf8"));
  assert.equal(list.length, 10);
  for (const t of list) assert.equal(normalizeTemplate(t).type, t.type);
});

test("template import validates size, shape, and secrets and round trips an export", async () => {
  const s = await startServer({ env: { CC_FLAG_TEMPLATES: "1" } });
  try {
    const made = await s.api("/walkthrough/templates", { method: "POST", body: { name: "Importable", type: "website", idea: "A small bakery site" } });
    const exported = JSON.stringify(made.json);
    const imported = await s.api("/walkthrough/templates/import", { method: "POST", body: { template: exported } });
    assert.equal(imported.status, 200); assert.equal(imported.json.name, "Importable (imported)");
    assert.equal(imported.json.idea, made.json.idea); assert.equal(imported.json.type, made.json.type);
    for (const secret of ["sk-ant-abcdefghijk0123456789", "AIzaSyAbcdefghijklmnopqrstuvwxyz123456"]) {
      assert.equal((await s.api("/walkthrough/templates/import", { method: "POST", body: { template: JSON.stringify({ name: "Secret", type: "website", idea: secret }) } })).status, 400);
    }
    assert.equal((await s.api("/walkthrough/templates/import", { method: "POST", body: { template: JSON.stringify({ name: "Bad" }) } })).status, 400);
    assert.equal((await s.api("/walkthrough/templates/import", { method: "POST", body: { template: "x".repeat(65537) } })).status, 400);
    const picker = await s.api("/walkthrough"); assert.equal(picker.json.readyTemplates.length, 10);
    const ready = await s.api("/walkthrough", { method: "POST", body: { templateId: picker.json.readyTemplates[0].id } });
    assert.equal(ready.status, 200); assert.equal(ready.json.templateName, "Bakery website");
  } finally { await s.stop(); }
});
