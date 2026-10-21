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
  assert.match(help, /public username the first time you open it/);
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
