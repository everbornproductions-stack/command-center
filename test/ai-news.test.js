// Weekly AI News: draft, owner publish, unread badge data, reactions, share, and the email copy.
// The generator writes a draft only. No email is sent. Temp dirs are removed in finally.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { startServer, ROOT } from "./helpers.js";

const KEY = "EVB-TEST-TEST-TEST";

function seedRoom(dir) {
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
    key: KEY,
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
}

test("owner publishes AI News, and the licence key stays out of the log", async () => {
  const s = await startServer({
    env: { CC_DEV_OWNER: "1" },
    seed: seedRoom,
    cloud: {
      rpc(name) {
        if (name === "verify_license") return { ok: true, tier: "pro", status: "active", email: "ada@example.com", message: "ok" };
        if (name === "community_list") {
          return { rows: [{ id: "remote-1", channel: "general", displayName: "Remote", body: "Hello from the weekly feed.", kind: "text", createdAt: new Date().toISOString() }] };
        }
        if (name === "publish_ai_news" || name === "save_ai_news_draft" || name === "ai_news_latest" || name === "community_post" || name === "ai_news_react") {
          return { ok: true };
        }
        return { ok: false, tier: "free", status: "unknown", message: "stub" };
      },
    },
  });
  try {
    const join = await s.api("/community/join", { method: "POST", body: { email: "ada@example.com", displayName: "Ada" } });
    assert.equal(join.status, 200, join.json?.error);
    const home = await s.api("/community?channel=general");
    assert.equal(home.json.owner, true);
    assert.ok(home.json.messages.some((m) => m.id === "remote-1"));
    assert.ok(home.json.messages.some((m) => m.id === "m-other" && m.email === "other@example.com"));
    assert.equal(JSON.stringify(home.json).includes(KEY), false);

    const removed = await s.api("/community/messages/m-other", { method: "DELETE" });
    assert.equal(removed.status, 200);
    const muted = await s.api("/community/mute", { method: "POST", body: { email: "other@example.com", minutes: 10 } });
    assert.equal(muted.status, 200);

    const sources = [{
      provider: "OpenAI",
      url: "https://openai.com/news",
      items: [{ title: "New model release", summary: "A new model is available for writing.", sourceUrl: "https://openai.com/news", kind: "model" }],
    }];
    const draft = await s.api("/community/news/draft", { method: "POST", body: { week: "2026-W43", sources } });
    assert.equal(draft.status, 200, draft.json?.error);
    assert.equal(draft.json.draft.status, "draft");
    assert.equal(draft.json.draft.sections.ai[0].sourceUrl, "https://openai.com/news");
    const hidden = draft.json.draft.id;
    assert.ok(hidden);

    const published = await s.api("/community/news/publish", { method: "POST", body: { id: hidden } });
    assert.equal(published.status, 200, published.json?.error);
    assert.equal(published.json.issue.status, "published");
    assert.equal(published.json.synced, true);
    assert.equal(published.json.unread, true);
    assert.equal(JSON.stringify(published.json).includes(KEY), false);

    const news = await s.api("/community/news");
    assert.equal(news.json.unread, true);
    assert.equal(news.json.draft, null);
    assert.equal(news.json.issue.sections.ai[0].kind, "model");
    const seen = await s.api("/community/news/seen", { method: "POST", body: { id: news.json.issue.id } });
    assert.equal(seen.json.unread, false);
    const reacted = await s.api("/community/news/react", { method: "POST", body: { issueId: news.json.issue.id, itemId: news.json.issue.sections.ai[0].id, reaction: "up" } });
    assert.equal(reacted.status, 200, reacted.json?.error);
    assert.equal(reacted.json.up, 1);
    const shared = await s.api("/community/news/share", { method: "POST", body: { issueId: news.json.issue.id, itemId: news.json.issue.sections.ai[0].id } });
    assert.equal(shared.status, 200, shared.json?.error);
    assert.equal(shared.json.message.channel, "general");
    assert.match(shared.json.message.body, /New model release/);

    const preview = await s.api("/community/newsletter/preview", { method: "POST", body: {} });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.sent, false);
    assert.match(preview.json.text, /This file is a copy\. It was not sent\./);
    assert.match(preview.json.text, /Everborn Productions/);
    assert.match(preview.json.text, /\[postal address placeholder\]/);
    assert.match(preview.json.html, /Unsubscribe/);
    assert.match(preview.json.text, /https:\/\/everbornproductions\.com\/command-center\/unsubscribe\?token=/);

    const hit = s.stub.hits.find((row) => row.path.endsWith("/publish_ai_news"));
    assert.ok(hit, "publish_ai_news was called");
    assert.equal(s.log.includes(KEY), false);
    assert.equal(JSON.stringify(news.json).includes(KEY), false);
  } finally { await s.stop(); }
});

test("the generator writes a draft and an email copy, and does not send", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-news-"));
  try {
    const sources = path.join(dir, "sources.json");
    const whats = path.join(dir, "whats.json");
    const prompts = path.join(dir, "prompts.json");
    const highlights = path.join(dir, "highlights.json");
    const out = path.join(dir, "draft.json");
    const mail = path.join(dir, "mail");
    fs.writeFileSync(sources, JSON.stringify([{
      provider: "Anthropic",
      url: "https://www.anthropic.com/news",
      text: "## Claude price change\nThe token price is cheaper per million for the new model release.\n",
    }]));
    fs.writeFileSync(whats, JSON.stringify({ "0.4.8": { title: "What's new", bullets: ["Community chat has channels for General."] } }));
    fs.writeFileSync(prompts, JSON.stringify([{ id: "weekly-brief", title: "Weekly brief", up: 4, down: 1 }]));
    fs.writeFileSync(highlights, JSON.stringify([{ id: "h1", title: "Show and tell", channel: "show", excerpt: "A short community note." }]));
    const run = spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "ai-news.mjs"),
      "--sources", sources,
      "--whats-new", whats,
      "--prompts", prompts,
      "--highlights", highlights,
      "--out", out,
      "--email-out", mail,
      "--token", "preview-token",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /Draft written\. Not published\. No email sent\./);
    const issue = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(issue.status, "draft");
    assert.equal(issue.sections.ai[0].kind, "price");
    assert.equal(issue.sections.ai[0].sourceUrl, "https://www.anthropic.com/news");
    assert.ok(issue.sections.meldmind.length);
    assert.equal(issue.sections.prompts[0].id, "weekly-brief");
    assert.equal(issue.sections.highlights[0].excerpt, "A short community note.");
    const html = fs.readFileSync(path.join(mail, "issue.html"), "utf8");
    const text = fs.readFileSync(path.join(mail, "issue.txt"), "utf8");
    for (const copy of [html, text]) {
      assert.match(copy, /Unsubscribe/);
      assert.match(copy, /Everborn Productions/);
      assert.match(copy, /\[postal address placeholder\]/);
      assert.match(copy, /was not sent/);
    }
    const refused = spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "ai-news.mjs"),
      "--sources", sources,
      "--out", path.join("data", "nope.json"),
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /data directory/);
    assert.equal(fs.existsSync(path.join(ROOT, "data", "nope.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
