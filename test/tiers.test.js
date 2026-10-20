// (b) Every Free-tier limit is enforced on the server; Pro and owner are allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";

const council = (id, startedAt) => ({ id, kind: "council", prompt: "seeded council " + id, projectId: null, members: [], startedAt, finishedAt: startedAt + 1000, cost: 0, status: "done", answers: {}, reviews: {} });
function seedCouncils(dir, list) {
  fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
  for (const c of list) fs.writeFileSync(path.join(dir, "missions", c.id + ".json"), JSON.stringify(c));
}
const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const proStub = { rpc: () => ({ ok: true, tier: "pro", status: "active", email: "t@example.com", message: "ok" }) };
const seedKey = (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null }));
async function waitForTier(s, tier) {
  let st;
  for (let i = 0; i < 50; i++) { st = await s.api("/state"); if (st.json.license.tier === tier) return st; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`tier never became ${tier}: ${JSON.stringify(st.json.license)}`);
}

test("free: the 6th council in a UTC month → 402 with the Pro message", async () => {
  const now = Date.now();
  const s = await startServer({ seed: (dir) => seedCouncils(dir, [council("c-1", now - 5000), council("c-2", now - 4000), council("c-3", now - 3000), council("c-4", now - 2000), council("c-5", now - 1000)]) });
  try {
    const r = await s.api("/council", { method: "POST", body: { prompt: "sixth council" } });
    assert.equal(r.status, 402);
    assert.match(r.json.error, /Pro/);
    assert.match(r.json.error, /5 of 5 councils/);
  } finally { await s.stop(); }
});

test("free: councils from last month do not count", async () => {
  const now = Date.now(), lastMonth = monthStart() - 86400000;
  const s = await startServer({ seed: (dir) => seedCouncils(dir, [council("c-1", now - 4000), council("c-2", now - 3000), council("c-3", now - 2000), council("c-4", now - 1000), council("o-1", lastMonth), council("o-2", lastMonth - 1000), council("o-3", lastMonth - 2000)]) });
  try {
    const r = await s.api("/council", { method: "POST", body: { prompt: "fifth council this month" } });
    assert.equal(r.status, 202); // accepted; it will fail asynchronously (no AI keyed), which does not count
  } finally { await s.stop(); }
});

test("free: 4th new project → 402, the 2nd and 3rd are allowed, editing still works", async () => {
  const s = await startServer();
  try {
    const st = await s.api("/state");
    assert.equal(st.json.projects.length, 1);
    const second = await s.api("/projects", { method: "POST", body: { name: "Second project", color: "#fff", categories: [] } });
    assert.equal(second.status, 200);
    const third = await s.api("/projects", { method: "POST", body: { name: "Third project", color: "#fff", categories: [] } });
    assert.equal(third.status, 200);
    const fourth = await s.api("/projects", { method: "POST", body: { name: "Fourth project", color: "#fff", categories: [] } });
    assert.equal(fourth.status, 402);
    assert.match(fourth.json.error, /Pro/);
    assert.match(fourth.json.error, /3 projects/);
    const edit = await s.api("/projects", { method: "POST", body: { id: st.json.projects[0].id, name: "Renamed" } });
    assert.equal(edit.status, 200);
    assert.equal(edit.json.name, "Renamed");
    assert.equal((await s.api("/state")).json.projects.length, 3);
  } finally { await s.stop(); }
});

test("free: subscriptions are locked (writes → 402, state shows locked + empty)", async () => {
  const s = await startServer();
  try {
    const st = await s.api("/state");
    assert.equal(st.json.subscriptionsLocked, true);
    assert.deepEqual(st.json.subscriptions, []);
    assert.equal(st.json.subscriptionTotals.locked, true);
    const w = await s.api("/subscriptions", { method: "POST", body: { name: "Thing", monthly: 5 } });
    assert.equal(w.status, 402);
    assert.equal(w.json.locked, true);
    const d = await s.api("/subscriptions/claude", { method: "DELETE" });
    assert.equal(d.status, 402);
    const t = await s.api("/setup/track", { method: "POST", body: { tools: [{ name: "Kling", visits: 3 }] } });
    assert.equal(t.status, 402);
    // the file on disk was not touched by the refused writes
    const subs = JSON.parse(fs.readFileSync(path.join(s.dir, "subscriptions.json"), "utf8"));
    assert.equal(subs.length, 3);
  } finally { await s.stop(); }
});

test("free: mission → 402, also through the pipelines plugin", async () => {
  const s = await startServer();
  try {
    const m = await s.api("/mission", { method: "POST", body: { goal: "do a thing" } });
    assert.equal(m.status, 402);
    assert.match(m.json.error, /Mission mode is part of Pro/);
    const p = await s.api("/pipelines/run", { method: "POST", body: { id: "instagram-week", values: {} } });
    assert.equal(p.status, 402);
  } finally { await s.stop(); }
});

test("pro (stubbed licence): councils, projects, subscriptions and missions are allowed", async () => {
  const now = Date.now();
  const s = await startServer({ cloud: proStub, seed: (dir) => { seedKey(dir); seedCouncils(dir, [council("c-1", now - 3000), council("c-2", now - 2000), council("c-3", now - 1000)]); } });
  try {
    const st = await waitForTier(s, "pro");
    assert.equal(st.json.subscriptionsLocked, false);
    assert.equal(st.json.subscriptions.length, 3);
    assert.equal((await s.api("/council", { method: "POST", body: { prompt: "fourth council" } })).status, 202);
    const proj = await s.api("/projects", { method: "POST", body: { name: "Second project", categories: [] } });
    assert.equal(proj.status, 200);
    assert.equal((await s.api("/subscriptions", { method: "POST", body: { name: "Thing", monthly: 5 } })).status, 200);
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "do a thing" } })).status, 202);
  } finally { await s.stop(); }
});

test("owner (dev override, unpackaged): everything allowed", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.license.tier, "owner");
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "do a thing" } })).status, 202);
    assert.equal((await s.api("/projects", { method: "POST", body: { name: "Another", categories: [] } })).status, 200);
    assert.equal((await s.api("/state")).json.subscriptionsLocked, false);
    assert.equal((await s.api("/pairing", { method: "POST", body: { on: true } })).status, 200);
    assert.equal((await s.api("/brain")).status, 200);
    assert.equal((await s.api("/missions?q=thing")).status, 200);
  } finally { await s.stop(); }
});

test("free: phone pairing, history search, scores and shared learning are Pro; the router pick stays free", async () => {
  const s = await startServer();
  try {
    const off = await s.api("/pairing", { method: "POST", body: { on: false } });
    assert.equal(off.status, 200);
    assert.equal(off.json.on, false);
    const on = await s.api("/pairing", { method: "POST", body: { on: true } });
    assert.equal(on.status, 402);
    assert.equal(on.json.code, "pro_required");
    assert.match(on.json.error, /Phone pairing/);
    assert.equal((await s.api("/missions")).status, 200);
    const q = await s.api("/missions?q=bakery");
    assert.equal(q.status, 402);
    assert.match(q.json.error, /Full history search/);
    assert.equal((await s.api("/brain")).status, 402);
    assert.equal((await s.api("/brain/export")).status, 402);
    assert.equal((await s.api("/brain/share-preview")).status, 402);
    assert.equal((await s.api("/brain/settings", { method: "POST", body: { shareOptIn: true } })).status, 402);
    const learn = await s.api("/brain/settings", { method: "POST", body: { on: false } });
    assert.equal(learn.status, 200);
    assert.equal(learn.json.settings.on, false);
    assert.equal(learn.json.capabilities, undefined, "the scores table stays on Pro");
    assert.equal((await s.api("/brain/pick?capability=writing")).status, 200);
    const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
    assert.match(app, /id="run-search"/);
    assert.match(app, /\/missions\?q=/);
  } finally { await s.stop(); }
});

test("free: 1 email account per provider, and 1 connected service", async () => {
  const s = await startServer();
  try {
    const home = await s.api("/mail-accounts", { method: "POST", body: { provider: "gmail", label: "Home" } });
    assert.equal(home.status, 200, home.text);
    const work = await s.api("/mail-accounts", { method: "POST", body: { provider: "gmail", label: "Work" } });
    assert.equal(work.status, 402);
    assert.match(work.json.error, /1 email account/);
    const outlook = await s.api("/mail-accounts", { method: "POST", body: { provider: "outlook", label: "Desk" } });
    assert.equal(outlook.status, 200, outlook.text);
    const first = await s.api("/extension/pairings", { method: "POST", body: { name: "Chrome" } });
    assert.equal(first.status, 200, first.text);
    const second = await s.api("/publish/keys", { method: "POST", body: { channel: "slack", token: "xoxb-test-not-a-real-token" } });
    assert.equal(second.status, 402);
    assert.match(second.json.error, /1 connected service/);
    const again = await s.api("/extension/pairings", { method: "POST", body: { name: "Edge" } });
    assert.equal(again.status, 200, again.text);
  } finally { await s.stop(); }
});

test("pro: eight email accounts, the ninth is the cap", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    for (let i = 1; i <= 8; i++) {
      const r = await s.api("/mail-accounts", { method: "POST", body: { provider: "gmail", label: "Box " + i } });
      assert.equal(r.status, 200, r.text);
    }
    const ninth = await s.api("/mail-accounts", { method: "POST", body: { provider: "gmail", label: "Box 9" } });
    assert.equal(ninth.status, 400);
    assert.match(ninth.json.error, /Eight/);
  } finally { await s.stop(); }
});
