// 0.4.21 Community: report on a local (unshared) message, honest sync chip, unread poll at load, kept report text.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const src = fs.readFileSync(path.join(ROOT, "web", "features", "community.js"), "utf8").replace(/\r\n/g, "\n");

function seedSignedIn(dir) {
  fs.writeFileSync(path.join(dir, "signin-identity.json"), JSON.stringify({ email: "free.user@example.com", provider: "google", at: Date.now() }));
}

test("Report works on a message that is only saved on this computer", async () => {
  const s = await startServer({ seed: seedSignedIn });
  try {
    assert.equal((await s.api("/community/join", { method: "POST", body: { username: "ReportMe1" } })).status, 200);
    const sent = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "A local only note" } });
    assert.equal(sent.json.delivered, false);
    const id = sent.json.message.id;
    const rep = await s.api(`/community/messages/${encodeURIComponent(id)}/report`, { method: "POST", body: { reason: "Testing a local report" } });
    assert.equal(rep.status, 200, JSON.stringify(rep.json));
    const again = await s.api(`/community/messages/${encodeURIComponent(id)}/report`, { method: "POST", body: { reason: "Testing a local report" } });
    assert.equal(again.status, 409);
  } finally { await s.stop(); }
});

test("page source: unread poll starts at load, chip tells the truth, report text survives a refresh, Sign in button", () => {
  assert.match(src, /setTimeout\(\(\) => \{ try \{ startUnread\(\)/);
  assert.match(src, /data-state="unsent"/);
  assert.match(src, /syncChip\(room\.sync, room\.messages\)/);
  assert.match(src, /input\.value = open\.get\(el\.dataset\.mid\)/);
  assert.match(src, /id="cc-signin"/);
  assert.match(src, /id="cc-online-note"/);
  assert.equal(/[–—]/.test(src), false, "no dashes in user-facing text");
});
