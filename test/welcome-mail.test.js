// Welcome email. The provider is off by default. A test server never sends.
// No real key, no Supabase service key, and the template has no income claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-welcome-");
const W = await import("../server/welcome-mail.js");

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("template: first name, install link, account copy, no service key", () => {
  const html = read("emails/welcome.html");
  const text = read("emails/welcome.txt");
  for (const src of [html, text]) {
    const names = [...src.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(names)].sort(), ["FIRST_NAME", "INSTALL_URL"]);
    assert.match(src, /account is ready/);
    assert.match(src, /back up to the cloud automatically/);
    assert.match(src, /Everborn's Supabase/);
    assert.match(src, /row level security/);
    assert.match(src, /MCP/);
    assert.match(src, /Nothing is sent until you click/);
    assert.match(src, /Windows and Mac/);
    assert.doesNotMatch(src, /—|income|revenue|\$\d|make money/i);
  }
  assert.match(html, /max-width:\s*560px/);
  assert.match(html, /@media/);
  const code = ["server/welcome-mail.js", "server/plugins/welcome.js", "docs/welcome-email.md"].map(read).join("\n");
  assert.doesNotMatch(code, /service_role|sb_secret|CC_SUPABASE_SERVICE_KEY/);
  assert.doesNotMatch(code, /—/);
  const plan = read("docs/BUILD-PLAN.md");
  assert.match(plan, /Do not start them until Chris adds them to the run order/);
  assert.match(plan, /## Planned, not in the run order/);
  assert.match(plan, /2026-10-21/);
});

test("render escapes the name and keeps a safe install link", () => {
  const msg = W.renderWelcome({ firstName: "<Ada>", installUrl: "https://everbornproductions.com/command-center/" });
  assert.match(msg.html, /Hi &lt;Ada&gt;,/);
  assert.doesNotMatch(msg.html, /<Ada>/);
  assert.match(msg.html, /https:\/\/everbornproductions\.com\/command-center\//);
  assert.match(msg.text, /Hi <Ada>,/);
  const dropped = W.renderWelcome({ firstName: "", installUrl: "javascript:alert(1)" });
  assert.match(dropped.html, /Hi there,/);
  assert.doesNotMatch(dropped.html, /javascript:/);
  assert.equal(W.firstNameOf({ email: "ada.lovelace@example.com" }), "ada lovelace");
  assert.equal(W.firstNameOf({ firstName: "Ada", email: "x@example.com" }), "Ada");
  assert.equal(W.firstNameOf({}), "there");
});

test("provider off, test instance, and the resend adapter never use the real network", async () => {
  let calls = 0;
  let last = null;
  const fetchImpl = async (url, init) => {
    calls += 1;
    last = { url, init };
    return { ok: true };
  };
  const message = { to: "ada@example.com", subject: "Welcome to Meldmind", html: "<p>Hi</p>", text: "Hi" };
  const off = await W.deliverWelcome(message, { provider: "none", key: "should-not-send", fetchImpl, instance: "" });
  assert.deepEqual(off, { sent: false, reason: "disabled" });
  assert.equal(calls, 0);
  const blocked = await W.deliverWelcome(message, { provider: "resend", key: "re_fake_not_a_real_key", fetchImpl, instance: "test-parent" });
  assert.equal(blocked.reason, "test");
  assert.equal(blocked.sent, false);
  assert.equal(calls, 0);
  const missing = await W.sendResend(message, { key: "", fetchImpl });
  assert.equal(missing.reason, "no-key");
  assert.equal(calls, 0);
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const sent = await W.sendResend(message, { key: "re_fake_not_a_real_key", fetchImpl, from: "Meldmind <hello@everbornproductions.com>" });
    assert.equal(sent.sent, true);
  } finally { console.log = orig; }
  assert.equal(calls, 1);
  assert.equal(last.url, "https://api.resend.com/emails");
  assert.equal(last.init.headers.authorization, "Bearer re_fake_not_a_real_key");
  assert.equal(logs.length, 0);
  assert.ok(!logs.join("\n").includes("re_fake_not_a_real_key"));
  const recorded = W.nextSent({}, "ada@example.com", "download", { sent: true }, 5);
  assert.equal(recorded.recorded, true);
  assert.equal(recorded.map["ada@example.com"].source, "download");
  const twice = W.nextSent(recorded.map, "ada@example.com", "download", { sent: true }, 6);
  assert.equal(twice.recorded, false);
  assert.equal(twice.reason, "already");
  const skipped = W.nextSent({}, "ada@example.com", "download", { sent: false, reason: "disabled" });
  assert.equal(skipped.recorded, false);
});

test("server: signup and a Pro licence do not send, and config refuses a key", async () => {
  const s = await startServer({
    cloud: { rpc: (fn) => (fn === "verify_license" ? { ok: true, tier: "pro", status: "active", email: "ada@example.com", first_name: "Ada", message: "ok" } : {}) },
  });
  try {
    assert.equal((await s.api("/welcome", { noToken: true })).status, 401);
    const view = await s.api("/welcome");
    assert.equal(view.status, 200);
    assert.equal(view.json.provider, "none");
    assert.equal(view.json.enabled, false);
    assert.equal(view.json.keySaved, false);
    assert.equal(view.json.installUrl, "https://everbornproductions.com/command-center/");
    const badKey = await s.api("/welcome/config", { method: "POST", body: { provider: "resend", key: "re_fake_not_a_real_key" } });
    assert.equal(badKey.status, 400);
    assert.match(badKey.json.error, /vault/);
    const cfg = await s.api("/welcome/config", { method: "POST", body: { provider: "none" } });
    assert.equal(cfg.status, 200);
    assert.equal(cfg.json.provider, "none");
    const signup = await s.api("/welcome/signup", { method: "POST", body: { email: "ada@example.com", firstName: "Ada", source: "download" } });
    assert.equal(signup.status, 200);
    assert.equal(signup.json.sent, false);
    assert.equal(signup.json.reason, "disabled");
    const account = await s.api("/welcome/signup", { method: "POST", body: { email: "sam@example.com", firstName: "Sam", source: "account" } });
    assert.equal(account.json.reason, "disabled");
    assert.equal((await s.api("/welcome/signup", { method: "POST", body: { email: "nope", source: "download" } })).status, 400);
    assert.equal((await s.api("/welcome/signup", { method: "POST", body: { email: "a@b.co", source: "pro-purchase" } })).status, 400);
    const on = await s.api("/welcome/config", { method: "POST", body: { provider: "resend" } });
    assert.equal(on.status, 200);
    assert.equal(on.json.enabled, true);
    assert.equal(on.json.keySaved, false);
    const held = await s.api("/welcome/signup", { method: "POST", body: { email: "bea@example.com", firstName: "Bea", source: "account" } });
    assert.equal(held.json.sent, false);
    assert.equal(held.json.reason, "test");
    const lic = await s.api("/license", { method: "POST", body: { key: "EVB-TEST-WELCOME-0001" } });
    assert.equal(lic.status, 200, lic.text);
    assert.equal(lic.json.tier, "pro");
    assert.ok(!s.log.includes("api.resend.com"));
    assert.ok(!s.log.includes("re_fake"));
    assert.ok(!lic.text.includes("service_role"));
  } finally { await s.stop(); }
});
