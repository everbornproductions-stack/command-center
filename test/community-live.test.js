// Community chat: any signed-in person can post, a failed send is never called "Posted.", and the page refreshes itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// A free install that signed in with Google: no licence at all.
function seedSignedIn(dir) {
  fs.writeFileSync(path.join(dir, "signin-identity.json"), JSON.stringify({ email: "free.user@example.com", provider: "google", at: Date.now() }));
}

test("a free, signed-in person can pick a name and post; nothing is claimed as shared when it was not", async () => {
  const bare = await startServer();
  try {
    const denied = await bare.api("/community/join", { method: "POST", body: { username: "Nobody1" } });
    assert.equal(denied.status, 400);
    assert.match(denied.json.error, /Sign in first/);
    assert.equal((await bare.api("/community?channel=general")).json.needsSignIn, true);
  } finally { await bare.stop(); }

  const s = await startServer({ seed: seedSignedIn });
  try {
    const before = await s.api("/community?channel=general");
    assert.equal(before.json.needsSignIn, false);
    assert.equal(before.json.joined, false, "needs a username first");
    const join = await s.api("/community/join", { method: "POST", body: { username: "FreeUser" } });
    assert.equal(join.status, 200, join.json?.error);
    const sent = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Hello from a free account" } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.delivered, false, "no licence key and no hub: not shared with anyone");
    assert.match(sent.json.note, /stays on this computer/);
    assert.ok(sent.json.message.unsent);
    const list = await s.api("/community?channel=general");
    const mine = list.json.messages.find((m) => m.body === "Hello from a free account");
    assert.ok(mine && mine.unsent, "the message is listed as not shared yet");
    assert.equal(JSON.stringify(list.json).includes("free.user@example.com"), false);
  } finally { await s.stop(); }
});

test("a licensed person with the hub unreachable gets a retry note, not a success", async () => {
  const s = await startServer({
    seed(dir) {
      const now = Date.now();
      fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-TEST-TEST-TEST", email: "ada@example.com", tier: "pro", status: "active", checkedAt: now, lastOkAt: now }));
    },
  });
  try {
    await s.api("/community/join", { method: "POST", body: { username: "AdaTest" } });
    const sent = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Is anyone there" } });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.delivered, false);
    assert.match(sent.json.note, /Could not reach the community|saved here/i);
  } finally { await s.stop(); }
});

test("the page toasts Posted only when delivered, and refreshes by itself", () => {
  const ui = read("web", "features", "community.js");
  assert.match(ui, /sent\.delivered === true\) toast\("Posted\."\)/);
  assert.doesNotMatch(ui, /await api\("\/community\/messages", \{ method: "POST", body: \{ channel, body \} \}\);\s*toast\("Posted\."\)/);
  assert.match(ui, /setInterval\(/);
  assert.match(ui, /document\.hidden/);
  assert.match(ui, /stopLive\(\)/);
  assert.equal(/[–—]/.test(ui), false);
});
