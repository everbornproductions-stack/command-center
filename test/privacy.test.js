// Sharing is off on a new install, an existing install keeps its choice, and Settings > Privacy
// lists what leaves this computer. Server tests use a temp data dir, demo only, no real key.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { decideShare, applyShareDefaults, SENDERS, privacyView } from "../server/privacy.js";

const DASHES = /[–—]/;

test("decideShare: a saved choice wins, history keeps the old default, a new install is off", () => {
  assert.equal(decideShare({ stored: true }), true);
  assert.equal(decideShare({ stored: false, hasHistory: true, docExists: true }), false);
  assert.equal(decideShare({ stored: true, hasHistory: false, docExists: false }), true);
  assert.equal(decideShare({}), false, "brand-new install");
  assert.equal(decideShare({ stored: undefined, docExists: true }), true, "a document from an earlier launch with no value");
  assert.equal(decideShare({ stored: undefined, hasHistory: true }), true, "an install with history and no document");
  assert.equal(decideShare({ stored: "yes" }), false, "only a real true or false counts as saved");
});

test("applyShareDefaults writes only the documents that lack a value", () => {
  const writes = {};
  const putDoc = (k, v) => { writes[k] = v; };
  const fresh = applyShareDefaults({ docs: {}, hasHistory: false, putDoc, freshBrain: (on) => ({ settings: { on: true, shareOptIn: on } }), freshUsage: (on) => ({ share: on }) });
  assert.equal(fresh.brain, false);
  assert.equal(fresh.usage, false);
  assert.equal(writes.brain.settings.shareOptIn, false);
  assert.equal(writes.usage.share, false);

  const kept = {};
  const r = applyShareDefaults({ docs: { brain: { settings: { on: true, shareOptIn: true } }, usage: { share: false } }, hasHistory: false, putDoc: (k, v) => { kept[k] = v; } });
  assert.equal(r.brain, true);
  assert.equal(r.usage, false);
  assert.deepEqual(kept, {}, "saved choices are not rewritten");

  const old = {};
  const r2 = applyShareDefaults({ docs: { brain: { jobs: 4, settings: { on: true } }, usage: { installId: "x" } }, hasHistory: false, putDoc: (k, v) => { old[k] = v; } });
  assert.equal(r2.brain, true, "an older brain document keeps the old default");
  assert.equal(r2.usage, true, "an older usage document keeps the old default");
  assert.equal(old.brain.settings.shareOptIn, true);
  assert.equal(old.brain.jobs, 4);
  assert.equal(old.usage.installId, "x");
});

test("the privacy list names every sender in plain words", () => {
  const ids = SENDERS.map((s) => s.id);
  for (const want of ["ai-providers", "licence", "updates", "usage-counts", "track-records", "live-prices", "status-pages", "apps", "community", "chat-sync", "handoff", "alerts", "share-links", "phone"]) {
    assert.ok(ids.includes(want), `missing ${want}`);
  }
  for (const s of SENDERS) {
    for (const k of ["name", "what", "to", "when", "off"]) {
      assert.ok(String(s[k] || "").length > 3, `${s.id} ${k}`);
      assert.equal(DASHES.test(s[k]), false, `${s.id} ${k} has a dash`);
    }
  }
  const v = privacyView({ usage: false, trackRecords: true });
  assert.equal(v.title, "Privacy: what leaves this computer");
  assert.equal(v.items.find((i) => i.id === "usage-counts").on, false);
  assert.equal(v.items.find((i) => i.id === "track-records").on, true);
  assert.equal(v.items.find((i) => i.id === "chat-sync").on, null, "unknown stays unknown");
  for (const rel of ["server/privacy.js", "web/features/privacy.js", "docs/help/privacy.md"]) {
    assert.equal(DASHES.test(fs.readFileSync(path.join(ROOT, rel), "utf8")), false, rel);
  }
  const help = fs.readFileSync(path.join(ROOT, "docs/help/privacy.md"), "utf8");
  assert.match(help, /Privacy: what leaves this computer/);
  assert.match(help, /On a new install, both sharing switches start off/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/DECISIONS.md"), "utf8"), /off on new installs until the person opts in; existing installs keep their choice/);
});

test("a new install starts with both sharing switches off, and /api/privacy shows it", async () => {
  const s = await startServer();
  try {
    const usage = (await s.api("/usage")).json;
    assert.equal(usage.share, false, "usage counts off on a new install");
    const brain = (await s.api("/brain/settings")).json;
    assert.equal(brain.settings.shareOptIn, false, "track records off on a new install");
    const p = await s.api("/privacy");
    assert.equal(p.status, 200);
    assert.equal(p.json.title, "Privacy: what leaves this computer");
    assert.equal(p.json.items.find((i) => i.id === "usage-counts").on, false);
    assert.equal(p.json.items.find((i) => i.id === "track-records").on, false);
    assert.ok(Array.isArray(p.json.connected));
    assert.equal((await s.api("/privacy", { noToken: true })).status, 401, "session token required");
    const on = await s.api("/usage", { method: "POST", body: { share: true } });
    assert.equal(on.json.share, true);
    assert.equal((await s.api("/privacy")).json.items.find((i) => i.id === "usage-counts").on, true);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "usage.json"), "utf8"));
    assert.equal(saved.share, true, "the person's choice is saved");
  } finally {
    await s.stop();
  }
});

test("an existing install keeps its choice: history with no saved value stays on", async () => {
  const s = await startServer({
    seed(dir) {
      // An install from before this change: a usage document with no switch value and a finished setup.
      fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ v: 1, installId: "c".repeat(32), day: "2026-10-20", counts: {}, seen: [], lastSentDay: null }));
      fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({ version: 1, completed: true, completedAt: Date.now() - 86400000, reason: "user" }));
    },
  });
  try {
    assert.equal((await s.api("/usage")).json.share, true, "older usage document keeps the old default");
    assert.equal((await s.api("/brain/settings")).json.settings.shareOptIn, true, "an install with history keeps the old default");
  } finally {
    await s.stop();
  }
});

test("an existing install that turned sharing off stays off", async () => {
  const s = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ v: 1, share: false, installId: "d".repeat(32), day: "2026-10-20", counts: {}, seen: [], lastSentDay: null }));
      fs.writeFileSync(path.join(dir, "brain.json"), JSON.stringify({ v: 1, since: Date.now(), settings: { on: true, shareOptIn: false }, jobs: 3, stats: {}, runs: {} }));
      fs.writeFileSync(path.join(dir, "onboarding.json"), JSON.stringify({ version: 1, completed: true, completedAt: Date.now() - 86400000, reason: "user" }));
    },
  });
  try {
    assert.equal((await s.api("/usage")).json.share, false);
    assert.equal((await s.api("/brain/settings")).json.settings.shareOptIn, false);
  } finally {
    await s.stop();
  }
});
