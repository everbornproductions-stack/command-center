// (c) A fresh data dir seeds only neutral projects and subscriptions.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const FORBIDDEN = /everborn|\bscf\b|snap credit|jake|kling premier|capital city|stien|magee/i;

test("fresh data dir: one empty project, three generic subscriptions, no owner-specific strings", async () => {
  const s = await startServer();
  try {
    const projects = fs.readFileSync(path.join(s.dir, "projects.json"), "utf8");
    const subs = fs.readFileSync(path.join(s.dir, "subscriptions.json"), "utf8");
    assert.doesNotMatch(projects, FORBIDDEN);
    assert.doesNotMatch(subs, FORBIDDEN);
    const p = JSON.parse(projects), sub = JSON.parse(subs);
    assert.equal(p.projects.length, 1);
    assert.equal(p.projects[0].name, "My project");
    assert.deepEqual(sub.map((x) => x.id), ["claude", "chatgpt", "grok"]);
    for (const x of sub) { assert.equal(x.notes, ""); assert.equal(x.monthly, null); assert.equal(x.renews, null); }
    const st = await s.api("/state");
    assert.equal(st.json.projects.length, 1);
    assert.equal(st.json.hq.available, false); // HQ adapter only with an explicit CC_HQ_DIR that exists
  } finally { await s.stop(); }
});

test("shipped code carries no owner seed", () => {
  const src = fs.readFileSync(path.join(ROOT, "server", "projects.js"), "utf8") + fs.readFileSync(path.join(ROOT, "server", "subscriptions.js"), "utf8");
  assert.doesNotMatch(src, /jake|snap credit|kling premier|capital city|2026-11-13/i);
});
