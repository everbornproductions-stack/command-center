// Slice C6: persona sections and peer review (flag: personasections). Template-only sharing, preview first.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import { scrubText, buildPayload, SECTIONS, hashOf } from "../server/persona-sections.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = /[\u2013\u2014]/;

test("flag is off by default and listed in flagView", () => {
  const was = process.env.CC_FLAG_PERSONASECTIONS;
  try {
    delete process.env.CC_FLAG_PERSONASECTIONS;
    assert.equal(flagOn("personasections"), false);
    assert.equal(flagView().personasections, false);
    assert.equal(flagView().templates, false);
    process.env.CC_FLAG_PERSONASECTIONS = "1";
    assert.equal(flagOn("personasections"), true);
  } finally { if (was === undefined) delete process.env.CC_FLAG_PERSONASECTIONS; else process.env.CC_FLAG_PERSONASECTIONS = was; }
});

test("eleven sections from the guide", () => {
  assert.equal(SECTIONS.length, 11);
  for (const n of ["YouTuber", "Marketer", "Web Designer", "Photographer", "Game Designer", "Automations", "Influencer", "Real Estate", "Business Owner", "AI Expert", "For Fun"]) {
    assert.ok(SECTIONS.some((s) => s.name === n), n);
  }
});

test("scrub removes keys, emails, links, phones, paths and file names", () => {
  const key = "sk-" + "a1b2c3d4e5f6g7h8i9";
  const cases = [
    [`use ${key} here`, "key"],
    ["mail bob@example.com now", "email"],
    ["see https://secret.example.org/x", "web address"],
    ["see mybakery.com/menu", "web address"],
    ["call 916-555-0134 today", "number"],
    ["open C:\\Users\\chris\\Desktop\\plan", "path"],
    ["use client list.xlsx please", "file name"],
    ["ping @bobsbakery", "handle"],
  ];
  for (const [text, label] of cases) {
    const r = scrubText(text, 200);
    assert.ok(r.changed.includes(label), `${text} -> ${JSON.stringify(r)}`);
    assert.ok(r.text.includes("[removed]"), text);
    assert.ok(!/sk-a1b2|bob@|secret\.example|555-0134|chris|list\.xlsx|bobsbakery|mybakery\.com/.test(r.text), r.text);
  }
  assert.equal(scrubText("A plain step title", 80).changed.length, 0);
});

test("payload keeps only the allow-list and drops private fields", () => {
  const tpl = {
    id: "tpl-1", name: "Bakery launch", type: "website", note: "For bob@example.com", idea: "Secret idea about my client Jane Doe",
    answers: { audience: "Jane Doe neighbors" }, folders: ["Photos of Jane"], providers: ["claude"], personas: ["Kai", "dana"],
    steps: [{ title: "Plan the pages", capability: "text", difficulty: "easy", instructions: "Write about Jane Doe", deliverable: "x" }, { title: "Logo from logo.png", capability: "image", difficulty: "weird" }],
  };
  const { payload, changed } = buildPayload(tpl, { id: "web-designer", name: "Web Designer" });
  const blob = JSON.stringify(payload);
  assert.deepEqual(Object.keys(payload).sort(), ["kind", "name", "note", "personas", "section", "sectionName", "steps", "type"]);
  assert.ok(!/Jane|Secret|bob@|Photos|logo\.png|claude|instructions|idea|answers/i.test(blob), blob);
  assert.equal(payload.steps[1].level, "medium");
  assert.deepEqual(payload.personas, ["kai", "dana"]);
  assert.ok(changed.length >= 2);
  assert.equal(hashOf(payload).length, 32);
});

test("a name that is only private data is refused", () => {
  assert.throws(() => buildPayload({ name: "bob@example.com", type: "website" }, { id: "for-fun", name: "For Fun" }), /nothing safe/);
});

test("flag off: routes are closed and state flag is false", async () => {
  const s = await startServer({ env: { CC_FLAG_PERSONASECTIONS: "0" } });
  try {
    assert.equal((await s.api("/persona-sections")).status, 404);
    assert.equal((await s.api("/persona-sections/share", { method: "POST", body: {} })).status, 404);
    assert.equal((await s.api("/state")).json.flags.personasections, false);
  } finally { await s.stop(); }
});

test("flag on: preview, confirm needed, hash must match, outbox, withdraw, sections", async () => {
  const s = await startServer({ env: { CC_FLAG_PERSONASECTIONS: "1", CC_FLAG_TEMPLATES: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.personasections, true);
    const v = await s.api("/persona-sections");
    assert.equal(v.status, 200);
    assert.equal(v.json.sections.length, 11);
    assert.deepEqual(v.json.outbox, []);

    const walk = await s.api("/walkthrough", { method: "POST", body: { type: "website" } });
    await s.api(`/walkthrough/${walk.json.id}/idea`, { method: "POST", body: { idea: "A shop for my client Jane Doe at jane@example.com" } });
    const tpl = await s.api("/walkthrough/templates", { method: "POST", body: { walkId: walk.json.id, name: "Shop site" } });
    assert.equal(tpl.status, 200);

    const bad = await s.api("/persona-sections/preview", { method: "POST", body: { templateId: tpl.json.id, section: "nope" } });
    assert.equal(bad.status, 400);
    const pv = await s.api("/persona-sections/preview", { method: "POST", body: { templateId: tpl.json.id, section: "web-designer" } });
    assert.equal(pv.status, 200);
    assert.ok(!/Jane|jane@/.test(JSON.stringify(pv.json)), "preview has no user text");
    assert.equal(pv.json.payload.name, "Shop site");
    assert.equal((await s.api("/persona-sections")).json.outbox.length, 0, "preview saves nothing");

    const noConfirm = await s.api("/persona-sections/share", { method: "POST", body: { templateId: tpl.json.id, section: "web-designer", hash: pv.json.hash } });
    assert.equal(noConfirm.status, 400);
    const wrong = await s.api("/persona-sections/share", { method: "POST", body: { templateId: tpl.json.id, section: "web-designer", hash: "0".repeat(32), confirm: true } });
    assert.equal(wrong.status, 409);
    assert.equal((await s.api("/persona-sections")).json.outbox.length, 0);

    const ok = await s.api("/persona-sections/share", { method: "POST", body: { templateId: tpl.json.id, section: "web-designer", hash: pv.json.hash, confirm: true } });
    assert.equal(ok.status, 200);
    const after = (await s.api("/persona-sections")).json;
    assert.equal(after.outbox.length, 1);
    assert.equal(after.outbox[0].status, "waiting");

    // a project in progress can be previewed without saving a template
    const pw = await s.api("/persona-sections/preview", { method: "POST", body: { walkId: walk.json.id, section: "for-fun" } });
    assert.equal(pw.status, 200);
    assert.ok(!/Jane|jane@/.test(JSON.stringify(pw.json)));

    // review
    const rv = await s.api(`/persona-sections/outbox/${ok.json.id}/review`, { method: "POST", body: { rating: 4, liked: "Clear steps, mail me at x@y.com", fix: "" } });
    assert.equal(rv.status, 200);
    assert.ok(!/x@y/.test(rv.json.liked));
    assert.equal((await s.api(`/persona-sections/outbox/${ok.json.id}/review`, { method: "POST", body: { rating: 9, liked: "x" } })).status, 400);

    // hide, targets, add (waits for approval when not owner), remove
    assert.equal((await s.api("/persona-sections/targets", { method: "POST", body: { targets: ["youtuber", "bogus"] } })).json.targets.length, 1);
    await s.api("/persona-sections/sections/youtuber/hide", { method: "POST", body: { hidden: true } });
    const hid = (await s.api("/persona-sections")).json;
    assert.equal(hid.targets.length, 0);
    assert.equal((await s.api("/persona-sections/preview", { method: "POST", body: { templateId: tpl.json.id, section: "youtuber" } })).status, 400);
    const add = await s.api("/persona-sections/sections", { method: "POST", body: { name: "Podcasters" } });
    assert.equal(add.status, 200);
    assert.equal(add.json.status, "pending");
    assert.equal((await s.api("/persona-sections/preview", { method: "POST", body: { templateId: tpl.json.id, section: add.json.id } })).status, 400);
    assert.equal((await s.api(`/persona-sections/sections/${add.json.id}/approve`, { method: "POST", body: {} })).status, 403);
    assert.equal((await s.api("/persona-sections/sections", { method: "POST", body: { name: "me@x.com" } })).status, 400);
    assert.equal((await s.api(`/persona-sections/sections/${add.json.id}`, { method: "DELETE" })).status, 200);

    assert.equal((await s.api(`/persona-sections/outbox/${ok.json.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await s.api("/persona-sections")).json.outbox.length, 0);
  } finally { await s.stop(); }
});

test("no dashes in the new files and the share step is wired to the flag", () => {
  for (const f of [["server", "persona-sections.js"], ["server", "plugins", "persona-sections.js"], ["web", "features", "persona-sections.js"]]) {
    assert.ok(!DASH.test(read(...f)), f.join("/"));
  }
  const ui = read("web", "features", "persona-sections.js");
  assert.ok(/Share to a persona section\?/.test(ui));
  assert.ok(/I checked this and I want to share it/.test(ui));
  assert.ok(/flags\?\.personasections/.test(read("web", "features", "walkthrough.js")));
});
