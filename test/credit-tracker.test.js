// Tracked credits for AI providers with no balance API. The person types the credits they have now,
// with the date. Meldmind subtracts each ledger call after that, plus what agents report from outside
// Meldmind (the report_usage MCP tool, the bridge route, or usage in a report back). Balance, top-up
// and usage emails update it on their own with an "updated from email" note, history and Undo.
// "Possibly off" shows only on a mismatch. There is no "balance is old" nudge.
// Mail is a local Gmail mock with fake messages; no real inbox, key or URL is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer, tmpDir, ROOT } from "./helpers.js";

createRequire(import.meta.url)("./vault-shim.cjs");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-credit-track-");
const T = await import("../server/credit-tracker.js");
const SV = await import("../server/services.js");
const RB = await import("../server/reportback.js");
const { setSecret } = await import("../server/vault.js");
const { putDoc, newContext, FileStore, setDefaultContext } = await import("../server/store.js");
const { McpClient } = await import("../server/mcp-client.js");
const local = newContext("local", new FileStore(process.env.CC_DATA_DIR));
await local.store.loadAll(local);
setDefaultContext(local);

const DAY = 86400000;
const EM = "—";
const reset = () => putDoc("services.tracked", {});
const call = (provider, ts, cost) => ({ ts, kind: "call", provider, cost });

test("emails: the sender's own domain picks the provider; balance, top-up and usage-only are told apart", () => {
  const d = new Date(Date.now() - DAY).toUTCString();
  assert.deepEqual(T.parseBalanceEmail({ from: "OpenAI <noreply@tm.openai.com>", subject: "Your API credit balance", date: d, text: "Your remaining balance is $14.20." }), { provider: "openai", balance: 14.2, date: Date.parse(d) });
  assert.equal(T.parseBalanceEmail({ from: "billing@mail.anthropic.com", subject: "Credits low", text: "You have $3.50 in credits remaining." }).balance, 3.5);
  assert.equal(T.parseBalanceEmail({ from: "OpenRouter <receipts@openrouter.ai>", subject: "Receipt", text: "You purchased $25.00 of credits." }).topUp, 25);
  assert.equal(T.parseBalanceEmail({ from: "xAI <billing@x.ai>", subject: "Invoice", text: "$1,200.00 in credits were added to your team." }).topUp, 1200);
  assert.equal(T.parseBalanceEmail({ from: "noreply@groq.com", subject: "Your monthly usage", text: "Here is your usage summary." }).usageOnly, true);
  assert.equal(T.parseBalanceEmail({ from: "Sam <sam@friends.example>", subject: "Fwd: OpenAI balance", text: "Your remaining balance is $14.20." }), null, "a forward from another domain does nothing");
  assert.equal(T.parseBalanceEmail({ from: "billing@openai.com.evil.example", text: "Your remaining balance is $1." }), null, "a look-alike domain does nothing");
  assert.equal(T.parseBalanceEmail({ from: "noreply@openai.com", subject: "Welcome", text: "Thanks for joining." }), null);
  assert.equal(T.providerOfSender("Anthropic <invoice@mail.anthropic.com>"), "anthropic");
});

test("tracked balance: set with a date, subtract each call after it and outside use, history, Undo, no old-balance nudge", () => {
  reset();
  const now = Date.now();
  const yesterday = new Date(now - DAY); const ymd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  assert.throws(() => T.setBalance("groq", { amount: "" }), /Type the balance in dollars/);
  assert.throws(() => T.setBalance("groq", { amount: -4 }), /Type the balance/);
  assert.throws(() => T.setBalance("demo-nova", { amount: 4 }), /Pick an AI provider/);
  assert.throws(() => T.setBalance("groq", { amount: 4, date: "2999-01-01" }), /in the future/);
  assert.equal(T.trackedView("groq", { entries: [] }), null, "nothing until the person gives a balance");

  T.setBalance("groq", { amount: "$20", date: ymd, now });
  const before = call("groq", now - 2 * DAY, 5), after = call("groq", now - 1000, 1.25), other = call("mistral", now - 1000, 9);
  let v = T.trackedView("groq", { entries: [before, after, other], now });
  assert.equal(v.value, 18.75, "only calls after the day it was entered, only this provider");
  assert.equal(v.source, "tracked"); assert.equal(v.estimated, true);
  assert.match(v.label, /^tracked since [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  assert.match(v.sourceNote, /^you entered \$20\.00 on /);
  assert.equal(v.possiblyOff, null);

  T.reportOutside("groq", { cost: 2, by: "Claude Code", note: "refactor", ref: "agent:r1", now });
  assert.equal(T.reportOutside("groq", { cost: 2, by: "Claude Code", ref: "agent:r1", now }).duplicate, true, "a retried report is counted once");
  v = T.trackedView("groq", { entries: [before, after], now });
  assert.equal(v.value, 16.75); assert.equal(v.spentOutside, 2);
  assert.match(v.history[0].text, /Claude Code reported \$2\.00 spent outside Meldmind \(refactor\)\./);

  // Undo the outside report, then the balance itself
  assert.match(T.undoLast("groq").undone, /Claude Code reported/);
  assert.equal(T.trackedView("groq", { entries: [after], now }).value, 18.75);
  T.undoLast("groq");
  assert.equal(T.trackedView("groq", { entries: [after], now }), null);
  assert.throws(() => T.undoLast("groq"), /Nothing to undo/);

  // a later typed balance replaces the earlier one; Undo puts the earlier one back
  T.setBalance("groq", { amount: 20, date: ymd, now });
  T.setBalance("groq", { amount: 11, now });
  assert.equal(T.trackedView("groq", { entries: [after], now }).value, 11);
  T.undoLast("groq");
  assert.equal(T.trackedView("groq", { entries: [after], now }).value, 18.75);

  // a year later with no new number: still no "old" nudge
  v = T.trackedView("groq", { entries: [], now: now + 365 * DAY });
  assert.equal(v.possiblyOff, null);
  assert.doesNotMatch(JSON.stringify(v), /\bold\b|stale|re-enter|out of date/i);
});

test("possibly off: only on a mismatch (live spend higher than tracked, or a usage email with no amount)", () => {
  reset();
  const now = Date.now();
  T.setBalance("openai", { amount: 50, now: now - 5000 });
  const inApp = [call("openai", now - 1000, 4)];
  assert.equal(T.trackedView("openai", { entries: inApp, liveMtd: 4.3, now }).possiblyOff, null, "a small gap is not a mismatch");
  const off = T.trackedView("openai", { entries: inApp, liveMtd: 15, now }).possiblyOff;
  assert.match(off, /^Possibly off: the OpenAI usage report shows \$11\.00 more spent this month than Meldmind tracked\./);
  T.flagUsageEmail("openai", { date: now, ref: "gmail:u1", now: now + 1 });
  assert.match(T.trackedView("openai", { entries: inApp, now }).possiblyOff, /a usage email from .* did not say how much is left/);
  T.setBalance("openai", { amount: 30, now: now + 2 });
  assert.equal(T.trackedView("openai", { entries: [], now: now + 3 }).possiblyOff, null, "a new balance clears it");
});

test("email updates: a balance email sets it with an 'updated from email' note, a top-up adds, older or repeated emails do nothing", () => {
  reset();
  const now = Date.now();
  T.setBalance("anthropic", { amount: 10, now: now - 3 * DAY });
  const r = T.applyBalanceEmail({ provider: "anthropic", balance: 7.4, date: now - DAY }, { ref: "gmail:b1", now });
  assert.deepEqual(r, { provider: "anthropic", kind: "balance" });
  let v = T.trackedView("anthropic", { entries: [], now });
  assert.equal(v.value, 7.4); assert.match(v.sourceNote, /^updated from email /); assert.match(v.history[0].text, /^Updated from email .*: \$7\.40 left\.$/);
  assert.equal(T.applyBalanceEmail({ provider: "anthropic", balance: 7.4, date: now - DAY }, { ref: "gmail:b1", now }), null, "the same email twice");
  assert.equal(T.applyBalanceEmail({ provider: "anthropic", balance: 99, date: now - 2 * DAY }, { ref: "gmail:b0", now }), null, "an older email never replaces a newer balance");
  T.applyBalanceEmail({ provider: "anthropic", topUp: 20, date: now - 1000 }, { ref: "gmail:t1", now });
  assert.equal(T.trackedView("anthropic", { entries: [], now }).value, 27.4);
  T.undoLast("anthropic");
  assert.equal(T.trackedView("anthropic", { entries: [], now }).value, 7.4, "Undo takes the top-up back off");
  assert.equal(T.applyBalanceEmail({ provider: "groq", topUp: 5, date: now }, { ref: "gmail:t2", now }), null, "a top-up with no tracked balance does nothing");
});

test("guides: every built-in AI has plain where-to-look words; emails and agents are explained; no em-dash", () => {
  for (const pid of ["openai", "anthropic", "google", "xai", "openrouter", "deepseek", "groq", "together", "fireworks", "mistral", "perplexity"]) {
    const g = T.guideFor(pid);
    assert.ok(g.where.length > 20, pid); assert.match(g.url, /^https:\/\//, pid);
    assert.match(g.report, /Claude Code, Antigravity, Grok Bot/);
    if (g.emails) assert.match(g.email, /updates the balance from them on its own/);
  }
  assert.match(T.guideFor("some-custom").where, /Billing or Usage/);
  const text = fs.readFileSync(path.join(ROOT, "server/credit-tracker.js"), "utf8") + fs.readFileSync(path.join(ROOT, "web/features/services.js"), "utf8");
  assert.equal(text.includes(EM), false);
  assert.doesNotMatch(T.standingInstruction(), /sk-|Bearer|password:/);
  assert.match(T.standingInstruction(), /report_usage/);
});

test("agents: aliases resolve, unknown providers are refused, a report back can carry usage", async () => {
  reset();
  assert.equal(T.resolveProvider("Claude"), "anthropic"); assert.equal(T.resolveProvider("grok"), "xai"); assert.equal(T.resolveProvider("nope"), null);
  assert.throws(() => T.acceptUsageReport({ provider: "nope", credits_spent: 1 }), /provider must be/);
  assert.throws(() => T.acceptUsageReport({ provider: "openai", credits_spent: "lots" }), /amount spent/);
  const clean = RB.cleanReport({ status: "done", summary: "ok", usage: [{ provider: "anthropic", cost: 0.42, note: "draft" }, { provider: "x", cost: -1 }, "junk"] });
  assert.deepEqual(clean.usage, [{ provider: "anthropic", cost: 0.42, note: "draft" }]);
  assert.equal(RB.cleanReport({ status: "done", summary: "ok" }).usage, undefined);
  assert.match(RB.reportBlockText({ url: "https://hub.example/api/handoff/rb-x1234567/done", token: "job-token-example-0123456789" }), /add usage: \[\{"provider": "anthropic", "cost": 0\.42\}\]/);
  T.setBalance("anthropic", { amount: 10, now: Date.now() - 5000 });
  await RB.applyLocal({ jobId: "gb-usage12345", status: "done", summary: "done", usage: clean.usage });
  await RB.applyLocal({ jobId: "gb-usage12345", status: "done", summary: "again", usage: clean.usage }, { pasted: true });
  const v = T.trackedView("anthropic", { entries: [] });
  assert.equal(v.value, 9.58, "counted once per job"); assert.match(v.history[0].text, /^Grok Bot reported \$0\.42 spent outside Meldmind/);
});

test("scan: a balance email from a connected mailbox updates the tracked balance on its own and is not a failed receipt", { timeout: 60000 }, async () => {
  reset();
  const now = Date.now();
  T.setBalance("openai", { amount: 40, now: now - 4 * DAY });
  const BAL = { id: "m-bal", from: "OpenAI <noreply@tm.openai.com>", subject: "Your API credit balance", date: new Date(now - DAY).toUTCString(), text: "Your remaining balance is $31.75. Add credits any time." };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== "Bearer ya29.FAKE-TRACK-TOKEN") return send(401, { error: { message: "Invalid Credentials" } });
    if (u.pathname.endsWith("/messages")) return send(200, { messages: [{ id: BAL.id }] });
    return send(200, { id: BAL.id, payload: { mimeType: "text/plain", headers: [{ name: "From", value: BAL.from }, { name: "Subject", value: BAL.subject }, { name: "Date", value: BAL.date }], body: { data: Buffer.from(BAL.text).toString("base64url") } } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.CC_GMAIL_API_URL = `http://127.0.0.1:${server.address().port}/gmail`;
  try {
    await setSecret("mail-gmail", { key: "oauth", access: "ya29.FAKE-TRACK-TOKEN", expiresAt: now + 3600 * 1000 });
    putDoc("subscriptions", []);
    const r = await SV.scanMail("gmail", { subs: [], save: (row) => row });
    assert.deepEqual(r.balanceUpdates.map((b) => [b.provider, b.kind]), [["openai", "balance"]]);
    assert.equal(r.failed.length, 0, "a balance email is understood, not a failed receipt");
    const v = T.trackedView("openai", { entries: [] });
    assert.equal(v.value, 31.75); assert.match(v.sourceNote, /^updated from email /);
    const again = await SV.scanMail("gmail", { subs: [], save: (row) => row });
    assert.equal(again.balanceUpdates.length, 0, "a rescan does not apply it twice");
  } finally { delete process.env.CC_GMAIL_API_URL; await new Promise((r) => server.close(r)); }
});

test("running server: Update balance, tracked since, bridge usage report, the report_usage MCP tool, and Undo", { timeout: 120000 }, async () => {
  const now = Date.now();
  const s = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "ledger.jsonl"), [
      { ts: now - 3 * DAY, kind: "call", provider: "groq", model: "llama", inTok: 10, outTok: 10, cost: 4, exact: true },
      { ts: now - 60000, kind: "call", provider: "groq", model: "llama", inTok: 10, outTok: 10, cost: 3, exact: true },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n"),
    env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" },
  });
  const client = McpClient.for(
    { transport: "stdio", command: process.execPath, args: [path.join(ROOT, "server", "mcp-demo-server.js")] },
    { env: { MELDMIND_PORT: String(s.port), MELDMIND_TOKEN_FILE: path.join(s.dir, "bridge.token") } },
  );
  try {
    const y = new Date(now - DAY); const ymd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    assert.equal((await s.api("/services/balance", { method: "POST", body: { provider: "groq", amount: "" } })).status, 400);
    const set = await s.api("/services/balance", { method: "POST", body: { provider: "groq", amount: 20, date: ymd } });
    assert.equal(set.status, 200, set.text);
    let b = (await s.api("/providers/balances")).json.balances.find((x) => x.provider === "groq");
    assert.equal(b.credits.source, "tracked"); assert.equal(b.credits.value, 17, "the call 3 days ago is before the balance; the one today is after");
    assert.match(b.credits.label, /^tracked since /); assert.match(b.guide.where, /console\.groq\.com/);

    // the agent setup: the standing instruction and the Claude Code command, never the token itself
    const setup = await s.api("/services/agent-setup", { method: "POST", body: {} });
    assert.equal(setup.status, 200, setup.text);
    const token = fs.readFileSync(path.join(s.dir, "bridge.token"), "utf8").trim();
    assert.equal(setup.text.includes(token), false);
    assert.match(setup.json.instruction, /report_usage/); assert.match(setup.json.claudeCode, /^claude mcp add meldmind /);

    // the bridge route needs the bridge token
    assert.equal((await s.api("/bridge/usage", { method: "POST", noToken: true, body: { provider: "groq", credits_spent: 1 } })).status, 401);
    const rep = await s.api("/bridge/usage", { method: "POST", noToken: true, headers: { "x-meldmind-bridge": token }, body: { provider: "groq", credits_spent: 1.5, report_id: "cc-1", by: "Claude Code" } });
    assert.equal(rep.status, 200, rep.text);
    assert.equal((await s.api("/bridge/usage", { method: "POST", noToken: true, headers: { "x-meldmind-bridge": token }, body: { provider: "nope", credits_spent: 1 } })).status, 400);

    // the real MCP tool, the way Claude Code or Antigravity calls it
    await client.connect();
    assert.ok((await client.listTools()).some((t) => t.name === "report_usage"));
    const tool = await client.callTool("report_usage", { provider: "groq", credits_spent: 0.5, note: "test run", report_id: "mcp-1" });
    assert.equal(tool.isError, false, tool.text); assert.match(tool.text, /Recorded in Meldmind: \$0\.50 on groq\./);
    assert.match((await client.callTool("report_usage", { provider: "groq", credits_spent: 0.5, report_id: "mcp-1" })).text, /Already recorded/);
    assert.equal((await client.callTool("report_usage", { provider: "groq", credits_spent: "x" })).isError, true);

    const view = (await s.api("/services")).json;
    const row = view.apis.find((x) => x.provider === "groq");
    assert.equal(row.credits.value, 15); assert.equal(row.possiblyOff, null);
    assert.match(row.credits.history[0].text, /reported \$0\.50 spent outside Meldmind \(test run\)/);
    const undo = await s.api("/services/balance/undo", { method: "POST", body: { provider: "groq" } });
    assert.equal(undo.status, 200); assert.equal(undo.json.view.apis.find((x) => x.provider === "groq").credits.value, 15.5);
    assert.doesNotMatch(JSON.stringify(view), /not available/i);
    assert.equal(JSON.stringify(view).includes(EM), false);
  } finally {
    try { await client.close(); } catch {}
    await s.stop();
  }
});
