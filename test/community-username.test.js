// Public usernames: format, blocks, uniqueness, cooldown, and no email in the API.
// Cooldown uses a clock passed into the function. Temp dirs are removed in finally.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import {
  checkUsername, claimUsername, suggestUsername, publicMessage, USERNAME_COOLDOWN_MS, USERNAME_RE,
} from "../server/community-chat.js";
import { addComment, reactionCounts, publicComments } from "../server/ai-news.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
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
      username: "Other",
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

test("usernames are short, unique, and blocked when they impersonate or swear", () => {
  for (const bad of ["Ab", "A", "Ada Lovelace", "Ada-Lovelace", "ada@box", "x".repeat(21), "MeldMind", "ADMIN", "everborn_help", "administrator", "shit", "Bright_shit"]) {
    assert.equal(checkUsername(bad).ok, false, bad);
  }
  for (const good of ["Ada", "Bright_Otter", "class", "ass", "x".repeat(20)]) {
    const checked = checkUsername(good);
    assert.equal(checked.ok, true, good);
    assert.equal(checked.username, good);
  }
  const taken = { ada: "other@example.com" };
  const clash = claimUsername({ username: "ADA", email: "ada@example.com", names: taken });
  assert.equal(clash.status, 409);
  const mine = claimUsername({ username: "Ada", email: "ada@example.com", names: { ada: "ada@example.com" }, current: "Ada", changedAt: 5_000, now: 9_000 });
  assert.equal(mine.ok, true);
  assert.equal(mine.same, true);
  const now = 1_000_000;
  const quick = claimUsername({
    username: "Calm_Maple",
    email: "ada@example.com",
    names: { ada: "ada@example.com" },
    current: "Ada",
    changedAt: now - 1000,
    now,
  });
  assert.equal(quick.status, 429);
  assert.match(quick.error, /1 hour/);
  const later = claimUsername({
    username: "Calm_Maple",
    email: "ada@example.com",
    names: { ada: "ada@example.com" },
    current: "Ada",
    changedAt: now - USERNAME_COOLDOWN_MS - 1,
    now,
  });
  assert.equal(later.ok, true);
  assert.equal(later.same, false);
  const first = claimUsername({ username: "Kind_Robin", email: "ada@example.com", names: {}, current: "", changedAt: 0, now });
  assert.equal(first.ok, true);
  const suggested = suggestUsername({ other: "other@example.com", bright_otter: "a@b.c" }, 10);
  assert.match(suggested, USERNAME_RE);
  assert.equal(suggested.includes("@"), false);
  assert.equal(suggested.toLowerCase() === "other" || suggested.toLowerCase() === "bright_otter", false);
  const row = publicMessage(
    { id: "1", channel: "general", email: "ada@example.com", displayName: "Ada", body: "Hi", kind: "text", createdAt: 1 },
    { messages: [], votes: [] },
    { email: "ada@example.com", owner: true },
  );
  assert.equal(row.email, undefined);
  assert.equal(row.displayName, "Ada");
  assert.equal(JSON.stringify(row).includes("@"), false);
});

test("the chat screen asks for a username and does not show an email field", () => {
  const ui = read("web", "features", "community.js");
  const help = read("docs", "help", "community.md");
  assert.match(ui, /Save username/);
  assert.match(ui, /wait 1 hour/);
  assert.match(ui, /id="cc-settings-username"/);
  assert.match(ui, /A friendly one is suggested/);
  assert.doesNotMatch(ui, /cc-email/);
  assert.doesNotMatch(ui, /licenceEmail/);
  assert.equal(ui.includes(EM), false);
  assert.match(help, /First-run setup asks for it/);
  assert.match(read("web", "app.js"), /id="su-username"/);
  assert.match(read("web", "app.js"), /Skip keeps that name/);
  assert.match(read("web", "features", "agents.js"), /Builders gallery/);
  assert.match(ui, /data-comment/);
  assert.match(ui, /Add a comment/);
  assert.match(read("supabase", "community.sql"), /community_set_username/);
  assert.match(read("supabase", "community.sql"), /community_profiles_username_lower_idx/);
  assert.doesNotMatch(read("supabase", "community.sql"), /'email', m\.email/);
});

test("claiming a username hides the email, blocks a quick rename, and a taken cloud name", async () => {
  const s = await startServer({
    env: { CC_DEV_OWNER: "1" },
    seed: seedRoom,
    cloud: {
      rpc(name, body) {
        if (name === "verify_license") return { ok: true, tier: "pro", status: "active", email: "ada@example.com", message: "ok" };
        if (name === "community_set_username") {
          if (String(body?.p_username || "").toLowerCase() === "taken_name") {
            return { ok: false, taken: true, message: "That username is taken. Pick another." };
          }
          return { ok: true, username: body?.p_username };
        }
        return { ok: true };
      },
    },
  });
  try {
    const open = await s.api("/community");
    assert.equal(open.json.joined, false);
    assert.match(open.json.suggestion, USERNAME_RE);
    assert.equal(JSON.stringify(open.json).includes("ada@example.com"), false);
    assert.equal(JSON.stringify(open.json).includes("other@example.com"), false);

    const taken = await s.api("/community/username", { method: "POST", body: { username: "Taken_Name" } });
    assert.equal(taken.status, 409);
    assert.match(taken.json.error, /taken/i);
    const still = await s.api("/community");
    assert.equal(still.json.joined, false);

    const saved = await s.api("/community/username", { method: "POST", body: { username: "Bright_Otter" } });
    assert.equal(saved.status, 200, saved.json?.error);
    assert.equal(saved.json.username, "Bright_Otter");
    assert.equal(saved.json.email, undefined);
    assert.equal(JSON.stringify(saved.json).includes("ada@example.com"), false);
    assert.ok(saved.json.cooldownUntil > Date.now());

    const renamed = await s.api("/community/username", { method: "POST", body: { username: "Calm_Maple" } });
    assert.equal(renamed.status, 429);
    assert.match(renamed.json.error, /1 hour/);
    const again = await s.api("/community/username", { method: "POST", body: { username: "Bright_Otter" } });
    assert.equal(again.status, 200, again.json?.error);

    const posted = await s.api("/community/messages", { method: "POST", body: { channel: "general", body: "Hello from Bright_Otter" } });
    assert.equal(posted.status, 200, posted.json?.error);
    assert.equal(posted.json.message.username, "Bright_Otter");
    assert.equal(posted.json.message.email, undefined);

    const home = await s.api("/community?channel=general");
    assert.equal(home.json.owner, true);
    assert.equal(home.json.profile.email, undefined);
    assert.equal(home.json.licenceEmail, undefined);
    const other = home.json.messages.find((m) => m.id === "m-other");
    assert.equal(other.username, "Other");
    assert.equal(other.email, undefined);
    assert.equal(JSON.stringify(home.json).includes("ada@example.com"), false);
    assert.equal(JSON.stringify(home.json).includes("other@example.com"), false);
    assert.equal(JSON.stringify(home.json).includes("EVB-TEST-TEST-TEST"), false);

    const muted = await s.api("/community/mute", { method: "POST", body: { username: "Other", minutes: 10 } });
    assert.equal(muted.status, 200, muted.json?.error);
    assert.equal(JSON.stringify(muted.json).includes("@"), false);
    const byEmail = await s.api("/community/mute", { method: "POST", body: { email: "other@example.com", minutes: 10 } });
    assert.equal(byEmail.status, 400);

    const hit = s.stub.hits.find((row) => row.path.endsWith("/community_set_username") && row.body?.p_username === "Bright_Otter");
    assert.ok(hit);
    assert.equal(hit.body.p_key, "EVB-TEST-TEST-TEST");
    assert.equal(s.log.includes("EVB-TEST-TEST-TEST"), false);
    assert.equal(s.log.includes("ada@example.com"), false);
  } finally { await s.stop(); }
});

test("reactions and comments show the username and keep the email on the server", () => {
  const issue = {
    id: "2026-W43",
    status: "published",
    sections: { ai: [{ id: "item-1", title: "New model", summary: "A note." }], meldmind: [], prompts: [], highlights: [] },
  };
  const news = { published: issue, reactions: [], comments: [] };
  const actor = { email: "ada@example.com", username: "Bright_Otter" };
  const commented = addComment(news, actor, { issueId: "2026-W43", itemId: "item-1", body: "Looks useful." }, 1000);
  assert.equal(commented.ok, true);
  assert.equal(commented.comment.username, "Bright_Otter");
  assert.equal(commented.comment.email, undefined);
  assert.equal(commented.news.comments[0].email, "ada@example.com");
  const shown = publicComments(commented.news, "2026-W43", "item-1", actor);
  assert.equal(shown[0].username, "Bright_Otter");
  assert.equal(JSON.stringify(shown).includes("@"), false);
  const counts = reactionCounts({
    reactions: [{ email: "ada@example.com", username: "Bright_Otter", issueId: "2026-W43", itemId: "item-1", reaction: "up", at: 1 }],
  }, "2026-W43", "item-1", actor.email);
  assert.deepEqual(counts.upNames, ["Bright_Otter"]);
  assert.equal(JSON.stringify(counts).includes("@"), false);
  const refused = addComment(news, { email: "ada@example.com" }, { issueId: "2026-W43", itemId: "item-1", body: "Hi there" });
  assert.equal(refused.status, 401);
});

function seedNews(dir) {
  seedRoom(dir);
  fs.writeFileSync(path.join(dir, "community.news.json"), JSON.stringify({
    draft: null,
    published: {
      id: "2026-W43",
      week: "2026-W43",
      title: "AI News",
      status: "published",
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      sections: {
        ai: [{ id: "openai-model", kind: "model", title: "New model", summary: "A new model is out.", provider: "OpenAI", sourceName: "OpenAI", sourceUrl: "https://openai.com/news" }],
        meldmind: [],
        prompts: [],
        highlights: [],
      },
    },
    seen: "2026-W43",
    reactions: [],
    comments: [],
  }));
}

test("one account username is used in chat, votes, and AI News, and email stays off those responses", async () => {
  const bare = await startServer();
  try {
    const open = await bare.api("/account");
    assert.equal(open.status, 200);
    assert.equal(open.json.username, "");
    assert.match(open.json.suggestion, USERNAME_RE);
    assert.equal(open.json.needsLicence, true);
    assert.equal(JSON.stringify(open.json).includes("@"), false);
    const saved = await bare.api("/account/username", { method: "POST", body: { username: "Kind_Robin" } });
    assert.equal(saved.status, 200, saved.json?.error);
    assert.equal(saved.json.username, "Kind_Robin");
    assert.equal(saved.json.email, undefined);
    const again = await bare.api("/account");
    assert.equal(again.json.username, "Kind_Robin");
    assert.equal(JSON.stringify(again.json).includes("@"), false);
    const chat = await bare.api("/community/join", { method: "POST", body: { username: "Kind_Robin" } });
    assert.equal(chat.status, 400);
    assert.match(chat.json.error, /Sign in first/);
    const state = await bare.api("/state");
    assert.ok(state.json.plugins.includes("account"));
  } finally { await bare.stop(); }

  const s = await startServer({ seed: seedNews });
  try {
    const named = await s.api("/account/username", { method: "POST", body: { username: "Bright_Otter" } });
    assert.equal(named.status, 200, named.json?.error);
    const home = await s.api("/community?channel=prompts");
    assert.equal(home.json.joined, true);
    assert.equal(home.json.username, "Bright_Otter");
    assert.equal(home.json.profile.email, undefined);
    assert.equal(JSON.stringify(home.json).includes("ada@example.com"), false);

    const shared = await s.api("/community/share", { method: "POST", body: { kind: "prompt", id: "weekly-brief", title: "Weekly brief", text: "A short prompt." } });
    assert.equal(shared.status, 200, shared.json?.error);
    const voted = await s.api(`/community/messages/${shared.json.message.id}/vote`, { method: "POST", body: { vote: "up" } });
    assert.equal(voted.status, 200, voted.json?.error);
    assert.equal(JSON.stringify(voted.json).includes("@"), false);
    const prompts = await s.api("/community?channel=prompts");
    const row = prompts.json.messages.find((m) => m.id === shared.json.message.id);
    assert.ok(row);
    assert.equal(row.username, "Bright_Otter");
    assert.deepEqual(row.voters, ["Bright_Otter"]);
    assert.equal(JSON.stringify(prompts.json).includes("@"), false);

    const news = await s.api("/community/news");
    const itemId = news.json.issue.sections.ai[0].id;
    const reacted = await s.api("/community/news/react", { method: "POST", body: { issueId: news.json.issue.id, itemId, reaction: "up" } });
    assert.equal(reacted.status, 200, reacted.json?.error);
    assert.deepEqual(reacted.json.upNames, ["Bright_Otter"]);
    assert.equal(JSON.stringify(reacted.json).includes("@"), false);
    const commented = await s.api("/community/news/comment", { method: "POST", body: { issueId: news.json.issue.id, itemId, body: "Looks useful." } });
    assert.equal(commented.status, 200, commented.json?.error);
    assert.equal(commented.json.comment.username, "Bright_Otter");
    assert.equal(commented.json.comment.email, undefined);
    const shown = await s.api("/community/news");
    const item = shown.json.issue.sections.ai[0];
    assert.equal(item.comments[0].username, "Bright_Otter");
    assert.equal(item.comments[0].body, "Looks useful.");
    assert.deepEqual(item.upNames, ["Bright_Otter"]);
    assert.equal(JSON.stringify(shown.json).includes("ada@example.com"), false);
    const stored = JSON.parse(fs.readFileSync(path.join(s.dir, "community.news.json"), "utf8"));
    assert.equal(stored.comments[0].email, "ada@example.com");
    assert.equal(stored.reactions[0].username, "Bright_Otter");

    const renamed = await s.api("/account/username", { method: "POST", body: { username: "Calm_Maple" } });
    assert.equal(renamed.status, 429);
    const same = await s.api("/account/username", { method: "POST", body: { username: "Bright_Otter" } });
    assert.equal(same.status, 200, same.json?.error);
  } finally { await s.stop(); }
});
