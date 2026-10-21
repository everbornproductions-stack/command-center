// Community chat: sign-in, channels, filters, votes, moderation, and a real rate-limit wait.
// Temp data dirs are removed in finally. No real key and no real Supabase call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { findProfanity, findSecret, postMessage, BURST_MS } from "../server/community-chat.js";
import { rankPromptRows } from "../server/community-votes.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EM = "\u2014";

function seedRoom(dir) {
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
    key: "EVB-TEST-TEST-TEST",
    email: "ada@example.com",
    tier: "pro",
    status: "active",
    checkedAt: now,
    lastOkAt: now,
  }));
  fs.writeFileSync(path.join(dir, "community.room.json"), JSON.stringify({
    messages: [{
      id: "m-other",
      channel: "general",
      email: "other@example.com",
      displayName: "Other",
      body: "A note from someone else.",
      kind: "text",
      share: null,
      createdAt: now - 60000,
      deleted: false,
    }],
    reports: [],
    mutes: [],
    votes: [],
    recent: {},
  }));
  fs.writeFileSync(path.join(dir, "community.news.json"), JSON.stringify({
    draft: {
      id: "2026-W43",
      week: "2026-W43",
      title: "AI News 2026-W43",
      status: "draft",
      createdAt: new Date(now).toISOString(),
      publishedAt: null,
      sections: { ai: [], meldmind: [], prompts: [], highlights: [] },
    },
    published: null,
    seen: null,
    reactions: [],
  }));
}

test("filters refuse keys, profanity, and private share fields, and votes change rank", async () => {
  assert.equal(findSecret("my key is sk-abcdefghij"), true);
  assert.equal(findSecret("hello there"), false);
  assert.equal(findSecret("See https://openai.com/news"), false);
  assert.equal(findSecret("C:\\Users\\ada\\notes.txt"), true);
  assert.equal(findProfanity("this is shit"), true);
  assert.equal(findProfanity("class assignment"), false);
  assert.equal(findProfanity("dick"), false);
  assert.equal(findProfanity("ass"), false);
  const actor = { email: "ada@example.com", displayName: "Ada" };
  const secret = postMessage({ messages: [], reports: [], mutes: [], votes: [], recent: {} }, actor, { body: "sk-abcdefghij" });
  assert.equal(secret.ok, false);
  const dirty = postMessage({ messages: [], reports: [], mutes: [], votes: [], recent: {} }, actor, {
    share: { kind: "prompt", id: "p", title: "T", text: "ok", file: "C:\\secret\\notes.txt" },
  });
  assert.equal(dirty.ok, false);
  const ranked = await rankPromptRows([
    { id: "low", title: "Low", up: 1, down: 0 },
    { id: "high", title: "High", up: 12, down: 0 },
  ]);
  assert.equal(ranked[0].id, "high");
  assert.ok(ranked[0].popularity > ranked[1].popularity);
});

test("the migration enables row level security and is not executed by the app", () => {
  const sql = read("supabase", "community.sql");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public.community_messages from anon, authenticated/);
  assert.doesNotMatch(read("server", "plugins", "community.js"), /community\.sql/);
  assert.doesNotMatch(read("package.json"), /community\.sql/);
  for (const file of [
    "server/community-chat.js", "server/ai-news.js", "server/community-cloud.js", "server/community-votes.js",
    "server/plugins/community.js", "scripts/ai-news.mjs", "web/features/community.js", "supabase/community.sql",
    "docs/help/community.md", "web/features/tour.js", "web/app.js", "web/nav.js",
  ]) assert.equal(read(...file.split("/")).includes(EM), false, file);
});

test("tour, setup, and the Community screen mention AI News in plain words", () => {
  const tour = read("web", "features", "tour.js");
  const steps = tour.slice(tour.indexOf("const APP_STEPS"), tour.indexOf("function extraSteps"));
  assert.match(steps, /Community and AI News/);
  assert.match(steps, /Click Send to post/);
  const app = read("web", "app.js");
  assert.match(app, /id="su-news"/);
  assert.match(app, /newsOptIn: false/);
  assert.match(app, /if \(S\.setup\?\.newsOptIn !== true\) return/);
  const ui = read("web", "features", "community.js");
  assert.match(ui, /More options/);
  assert.match(ui, /Email me the weekly AI News note/);
  assert.match(ui, /id="cc-community"/);
  assert.match(read("web", "nav.js"), /Community/);
  assert.match(read("web", "perf", "registry.js"), /"community"/);
});

test("chat needs the licence email, hides drafts, and enforces conduct", async () => {
  const bare = await startServer();
  try {
    const denied = await bare.api("/community/join", { method: "POST", body: { email: "ada@example.com", displayName: "Ada" } });
    assert.equal(denied.status, 400);
    assert.match(denied.json.error, /Add a licence first/);
    const state = await bare.api("/state");
    assert.ok(state.json.plugins.includes("community"));
  } finally { await bare.stop(); }

  const s = await startServer({ seed: seedRoom });
  try {
    const mismatch = await s.api("/community/join", { method: "POST", body: { email: "other@example.com", displayName: "Ada" } });
    assert.equal(mismatch.status, 403);
    const join = await s.api("/community/join", { method: "POST", body: { email: "Ada@example.com", displayName: "Ada" } });
    assert.equal(join.status, 200);
    const home = await s.api("/community?channel=general");
    assert.equal(home.json.joined, true);
    assert.equal(home.json.owner, false);
    assert.equal(home.json.news.draft, null);
    assert.equal(home.json.newsletter.optedIn, false);
    const other = home.json.messages.find((m) => m.id === "m-other");
    assert.ok(other);
    assert.equal(other.email, undefined);
    assert.ok(home.json.channels.some((c) => c.id === "news" && c.label === "AI News"));

    const draft = await s.api("/community/news/draft", { method: "POST", body: { sources: [] } });
    assert.equal(draft.status, 403);

    const rude = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "this is shit" } });
    assert.equal(rude.status, 400);
    const key = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "sk-abcdefghij" } });
    assert.equal(key.status, 400);
    const fileShare = await s.api("/community/share", { method: "POST", body: { kind: "prompt", id: "p", title: "T", text: "ok", file: "/home/ada/secret.txt" } });
    assert.equal(fileShare.status, 400);

    const shared = await s.api("/community/share", { method: "POST", body: { kind: "prompt", id: "weekly-brief", title: "Weekly brief", text: "A short prompt." } });
    assert.equal(shared.status, 200);
    assert.equal(shared.json.message.channel, "prompts");
    const voted = await s.api(`/community/messages/${shared.json.message.id}/vote`, { method: "POST", body: { vote: "up" } });
    assert.equal(voted.status, 200);
    assert.equal(voted.json.up, 1);
    assert.equal(voted.json.mine, "up");
    const votes = JSON.parse(fs.readFileSync(path.join(s.dir, "prompts.votes.json"), "utf8"));
    assert.equal(votes.mine["weekly-brief"], "up");

    const removed = await s.api("/community/messages/m-other", { method: "DELETE" });
    assert.equal(removed.status, 403);
    const report = await s.api("/community/messages/m-other/report", { method: "POST", body: { reason: "Off topic note" } });
    assert.equal(report.status, 200);
    const after = await s.api("/community?channel=general");
    assert.deepEqual(after.json.reports, []);

    const list = await s.api("/community/newsletter");
    assert.equal(list.json.optedIn, false);
    const on = await s.api("/community/newsletter", { method: "POST", body: { optedIn: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.optedIn, true);
    assert.match(on.json.note, /Nothing is sent/);
    const preview = await s.api("/community/newsletter/preview", { method: "POST", body: {} });
    assert.equal(preview.status, 404);
    const token = (await s.api("/community/newsletter")).json.token;
    const off = await s.api("/community/newsletter/unsubscribe", { method: "POST", body: { token } });
    assert.equal(off.json.optedIn, false);

    for (let i = 1; i <= 4; i++) {
      const posted = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: `Hello from Ada ${i}` } });
      assert.equal(posted.status, 200, posted.json?.error || posted.status);
    }
    const burst = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Hello from Ada 5" } });
    assert.equal(burst.status, 429);
    assert.match(burst.json.error, /Slow down/);
    await sleep(BURST_MS + 400);
    const later = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Hello from Ada 6" } });
    assert.equal(later.status, 200, later.json?.error || later.status);
    const link = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "See https://openai.com/news for the note." } });
    assert.equal(link.status, 200, link.json?.error || link.status);
  } finally { await s.stop(); }
});
