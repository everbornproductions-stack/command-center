// Phase 9: growth, feature-flagged with placeholder amounts. The running server in a temp data dir; one local
// mock plays an OpenAI-compatible API for the managed key pool (a made-up key, never a real one) and the
// helpers' stub plays the licence server. Nothing is charged and no payment service exists here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { startServer, ROOT } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
const POOL_KEY = "pool-test-key-NOT-REAL-7f3a9c";
const OWN_KEY = "sk-own-test-key-NOT-REAL-0001";
const NO_KEYS = { OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", PERPLEXITY_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "" };

async function mockOpenAI() {
  const seen = [];
  const usage = { prompt_tokens: 3000, completion_tokens: 1000 };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    seen.push({ path: url.pathname, auth: req.headers.authorization || null });
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "gpt-6-luna" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "mock: no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const text = /Reply with JSON only: \{"capability"/.test(sys) ? `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}` : `Answer from ${j.model}.`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, usage, chats: (from = 0) => seen.slice(from).filter((x) => /chat\/completions$/.test(x.path)), close: () => new Promise((r) => srv.close(r)) };
}

async function chat(s, prompt) {
  const t0 = Date.now();
  assert.equal((await s.api("/chat", { method: "POST", body: { prompt, provider: "openai", model: "gpt-6-luna" } })).status, 202);
  for (let i = 0; i < 240; i++) {
    const m = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.startedAt >= t0 - 1 && ["done", "done-with-errors", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${m.id}`)).json;
    await sleep(250);
  }
  throw new Error("chat never finished\n" + s.log.slice(-1500));
}
const openai = async (s) => (await s.api("/state")).json.providers.find((p) => p.id === "openai");
const grow = async (s) => (await s.api("/growth")).json;

test("growth flags off (default): nothing changes, routes refuse, a configured pool is not used", async () => {
  const s = await startServer({ env: { ...NO_KEYS, CC_MANAGED_POOL: JSON.stringify([{ provider: "openai", keyEnv: "CC_POOL_OPENAI" }]), CC_POOL_OPENAI: POOL_KEY } });
  try {
    assert.equal((await s.api("/growth", { noToken: true })).status, 401, "session token required");
    const g = await grow(s);
    assert.deepEqual(g.flags, { trial: false, managed: false, referrals: false });
    assert.equal(g.trial, null); assert.equal(g.managed, null); assert.equal(g.referrals, null);
    assert.equal(g.upgrade.show, false);
    assert.equal(g.placeholder.placeholder, true, "amounts are marked placeholders");
    for (const [p, b] of [["/growth/trial/start", {}], ["/growth/managed", { on: true }], ["/growth/referrals/redeem", { code: "REF-FRENDS23" }], ["/growth/referrals/refresh", {}]]) {
      const r = await s.api(p, { method: "POST", body: b });
      assert.equal(r.status, 404, p); assert.equal(r.json.code, "flag_off");
    }
    const st = (await s.api("/state")).json;
    assert.equal(st.license.tier, "free");
    assert.equal(st.providers.find((p) => p.id === "openai").keyed, false, "the pool is never used with the flag off");
    assert.ok(st.plugins.includes("growth"));
    assert.ok(!JSON.stringify(st).includes(POOL_KEY));
  } finally { await s.stop(); }
});

test("free trial: start once, Pro limits with a counter, ends back on Free with the upgrade prompt", async () => {
  const s = await startServer({ env: { CC_TRIAL: "1" } });
  try {
    let g = await grow(s);
    assert.equal(g.flags.trial, true);
    assert.equal(g.trial.canStart, true); assert.equal(g.trial.started, false);
    assert.equal(g.trial.days, 14); assert.equal(g.trial.credits, 5);
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "plan a launch" } })).status, 402, "Free before the trial");
    g = (await s.api("/growth/trial/start", { method: "POST" })).json;
    assert.equal(g.trial.active, true); assert.equal(g.trial.daysLeft, 14); assert.equal(g.tier, "pro");
    assert.equal(g.credits.balance, 5); assert.equal(g.credits.lines[0].kind, "trial");
    const st = (await s.api("/state")).json;
    assert.equal(st.license.tier, "pro"); assert.equal(st.license.reason, "trial");
    assert.match(st.license.message, /Free trial: Pro for 14 more days\. Nothing is charged\./);
    assert.ok(st.license.trialEndsAt > Date.now() + 13 * DAY);
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "plan a launch" } })).status, 202, "missions open during the trial");
    const again = await s.api("/growth/trial/start", { method: "POST" });
    assert.equal(again.status, 409); assert.equal(again.json.code, "trial_used");
    assert.equal((await grow(s)).upgrade.show, false, "no prompt early in the trial");
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "growth.trial.json"), "utf8"));
    assert.ok(saved.deviceId, "tied to this install");
  } finally { await s.stop(); }

  const now = Date.now();
  const ended = await startServer({ env: { CC_TRIAL: "1" }, seed: (dir) => fs.writeFileSync(path.join(dir, "growth.trial.json"), JSON.stringify({ startedAt: now - 20 * DAY, endsAt: now - 6 * DAY })) });
  try {
    const g = await grow(ended);
    assert.equal(g.trial.active, false); assert.equal(g.trial.started, true); assert.equal(g.trial.canStart, false);
    assert.equal(g.tier, "free");
    assert.equal(g.upgrade.show, true); assert.equal(g.upgrade.reason, "trial_ended"); assert.match(g.upgrade.text, /Upgrade to Pro/);
    assert.equal((await ended.api("/mission", { method: "POST", body: { goal: "plan a launch" } })).status, 402, "gated again after the trial");
    assert.equal((await ended.api("/growth/trial/start", { method: "POST" })).status, 409, "no second trial");
  } finally { await ended.stop(); }

  const ending = await startServer({ env: { CC_TRIAL: "1" }, seed: (dir) => fs.writeFileSync(path.join(dir, "growth.trial.json"), JSON.stringify({ startedAt: now - 12 * DAY, endsAt: now + 2 * DAY - 60000 })) });
  try {
    const g = await grow(ending);
    assert.equal(g.trial.daysLeft, 2); assert.equal(g.upgrade.reason, "trial_ending"); assert.match(g.upgrade.text, /ends in 2 days/);
  } finally { await ending.stop(); }
});

test("free trial: not offered over a paid licence", async () => {
  const s = await startServer({ env: { CC_TRIAL: "1" }, cloud: { rpc: () => ({ ok: true, tier: "pro", status: "active", email: "t@example.com", message: "ok" }) }, seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null })) });
  try {
    let lic;
    for (let i = 0; i < 50; i++) { lic = (await s.api("/state")).json.license; if (lic.tier === "pro") break; await sleep(100); }
    assert.equal(lic.tier, "pro"); assert.equal(lic.reason, "active");
    const g = await grow(s);
    assert.equal(g.trial.canStart, false); assert.equal(g.upgrade.show, false);
    const r = await s.api("/growth/trial/start", { method: "POST" });
    assert.equal(r.status, 409); assert.equal(r.json.code, "has_plan");
  } finally { await s.stop(); }
});

test("managed plan: pool key only for an opted-in person with an allowance, never shown, metered, credits drawn, own key first", { timeout: 180000 }, async () => {
  const m = await mockOpenAI();
  const s = await startServer({ env: { ...NO_KEYS, CC_STATUS_PAGES: "off", CC_BASE_URL_OPENAI: `${m.base}/v1`, CC_TRIAL: "1", CC_MANAGED: "1", CC_MANAGED_POOL: JSON.stringify([{ provider: "openai", keyEnv: "CC_POOL_OPENAI" }, { provider: "nope", keyEnv: "CC_POOL_NOPE" }, { provider: "anthropic", keyEnv: "lower_case_bad" }]), CC_POOL_OPENAI: POOL_KEY } });
  try {
    let g = await grow(s);
    assert.equal(g.managed.on, false); assert.equal(g.managed.block, "not_on");
    assert.deepEqual(g.managed.providers.map((p) => p.id), ["openai"], "only valid pool entries count");
    assert.equal((await openai(s)).keyed, false);

    // on, but Free with no credits: still no pool key, and the prompt says why
    g = (await s.api("/growth/managed", { method: "POST", body: { on: true } })).json;
    assert.equal(g.managed.on, true); assert.equal(g.managed.block, "no_credits");
    assert.equal(g.upgrade.reason, "credits_used");
    assert.equal((await openai(s)).keyed, false);

    // the trial brings credits: the pool is used, shown as managed, the key itself never leaves the server
    await s.api("/growth/trial/start", { method: "POST" });
    g = await grow(s);
    assert.equal(g.managed.available, true); assert.equal(g.credits.balance, 5);
    const p = await openai(s);
    assert.equal(p.keyed, true); assert.equal(p.keyScope, "managed"); assert.equal(p.masked, "managed by Everborn");
    const chk = (await s.api("/check/openai", { method: "POST" })).json;
    assert.equal(chk.status, "green"); assert.match(chk.detail, /managed by Everborn/);
    assert.equal(m.seen.filter((x) => /models$/.test(x.path)).length, 0, "the pool key is not used for health checks");

    let from = m.seen.length;
    let run = await chat(s, "Write a tagline for a bakery.");
    assert.equal(run.status, "done", run.error);
    assert.ok(m.chats(from).length >= 1);
    assert.ok(m.chats(from).every((x) => x.auth === `Bearer ${POOL_KEY}`), "calls carry the pool key");
    let st = (await s.api("/state")).json;
    const lines = st.ledger.recent.filter((e) => e.kind === "call" && e.provider === "openai");
    assert.ok(lines.length >= 1 && lines.every((e) => e.managed === true), "ledger lines are tagged managed");
    g = await grow(s);
    assert.equal(g.managed.usage.calls, lines.length);
    assert.ok(g.managed.usage.cost > 0);
    assert.ok(Math.abs(g.managed.usage.fromCredits - g.managed.usage.cost) < 1e-6, "paid from credits first");
    assert.equal(g.managed.usage.billable, 0);
    assert.ok(Math.abs(g.credits.balance - (5 - g.managed.usage.cost)) < 1e-5);
    assert.equal(g.credits.lines.filter((l) => l.kind === "managed-usage").length, 1, "one usage line per day");

    // a big job uses the rest: credits stop at 0, the overflow is metered (not charged), the pool stops
    m.usage.prompt_tokens = 60_000_000;
    run = await chat(s, "Write a long report.");
    assert.equal(run.status, "done", run.error);
    g = await grow(s);
    assert.equal(g.credits.balance, 0);
    assert.ok(g.managed.usage.billable > 0);
    assert.ok(g.managed.wouldBill > g.managed.usage.billable, "would-bill shows the placeholder markup");
    assert.equal(g.managed.block, "no_credits"); assert.equal(g.upgrade.reason, "credits_used");
    assert.equal((await openai(s)).keyed, false);
    from = m.seen.length;
    run = await chat(s, "One more.");
    assert.notEqual(run.status, "done", "no key left for openai");
    assert.equal(m.chats(from).length, 0, "the pool is not called once the allowance is gone");

    // your own key always comes first, and is not metered as managed
    m.usage.prompt_tokens = 3000;
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: OWN_KEY } })).json.status.status, "green");
    assert.equal((await openai(s)).keyScope, null);
    const before = (await grow(s)).managed.usage.calls;
    from = m.seen.length;
    run = await chat(s, "Tagline again.");
    assert.equal(run.status, "done", run.error);
    assert.ok(m.chats(from).length >= 1 && m.chats(from).every((x) => x.auth === `Bearer ${OWN_KEY}`));
    assert.equal((await grow(s)).managed.usage.calls, before);
    st = (await s.api("/state")).json;
    assert.ok(st.ledger.recent.filter((e) => e.kind === "call" && e.ts > Date.now() - 30000 && e.provider === "openai").some((e) => !e.managed));

    // off again
    g = (await s.api("/growth/managed", { method: "POST", body: { on: false } })).json;
    assert.equal(g.managed.on, false);

    // the pool key is in no reply, no data file and no log line
    assert.ok(!JSON.stringify(st).includes(POOL_KEY) && !JSON.stringify(g).includes(POOL_KEY));
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(s.dir)) assert.ok(!fs.readFileSync(f, "utf8").includes(POOL_KEY), `pool key in ${f}`);
    assert.ok(!s.log.includes(POOL_KEY), "pool key in the server log");
  } finally { await s.stop(); await m.close(); }
});

test("managed plan: cannot be turned on without a pool", async () => {
  const s = await startServer({ env: { ...NO_KEYS, CC_MANAGED: "1" } });
  try {
    const g = await grow(s);
    assert.equal(g.managed.block, "no_pool");
    const r = await s.api("/growth/managed", { method: "POST", body: { on: true } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "no_pool");
  } finally { await s.stop(); }
});

test("referrals: code and link, the licence server confirms before any credit, rewards added once", async () => {
  const rpc = (fn, body) => {
    if (fn === "redeem_referral") return body.p_code === "REF-BADBADBA" ? { ok: false, status: "rejected", message: "Unknown code" } : { ok: true };
    if (fn === "referral_stats") return { confirmed: 2, pending: 1 };
    return { ok: false, tier: "free", status: "unknown", message: "stub" };
  };
  const s = await startServer({ env: { CC_REFERRALS: "1" }, cloud: { rpc } });
  try {
    let g = await grow(s);
    const code = g.referrals.code;
    assert.match(code, /^REF-[A-Z2-9]{8}$/);
    assert.equal(g.referrals.link, `https://everbornproductions.com/command-center/?ref=${code}`);
    assert.equal(g.referrals.server, true);
    assert.equal((await grow(s)).referrals.code, code, "the code is kept");

    let r = await s.api("/growth/referrals/redeem", { method: "POST", body: { code } });
    assert.equal(r.status, 400); assert.equal(r.json.code, "own_code");
    r = await s.api("/growth/referrals/redeem", { method: "POST", body: { code: "hello" } });
    assert.equal(r.status, 400); assert.equal(r.json.code, "bad_code");
    r = await s.api("/growth/referrals/redeem", { method: "POST", body: { code: "REF-BADBADBA" } });
    assert.equal(r.status, 400); assert.equal(r.json.code, "rejected");
    g = await grow(s);
    assert.equal(g.referrals.redeemed, null); assert.equal(g.credits.balance, 0, "a rejected code adds nothing");

    g = (await s.api("/growth/referrals/redeem", { method: "POST", body: { code: "ref-frends23" } })).json;
    assert.equal(g.referrals.redeemed.status, "confirmed"); assert.equal(g.referrals.redeemed.code, "REF-FRENDS23");
    assert.equal(g.credits.balance, 5); assert.equal(g.credits.lines[0].kind, "referral-welcome");
    const hit = s.stub.hits.filter((h) => h.path === "/rest/v1/rpc/redeem_referral").pop();
    assert.equal(hit.body.p_code, "REF-FRENDS23"); assert.equal(hit.body.p_referrer_code, code); assert.ok(hit.body.p_device_id); assert.equal(hit.body.p_email, null);
    r = await s.api("/growth/referrals/redeem", { method: "POST", body: { code: "REF-ANTHER22" } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "already_redeemed");

    g = (await s.api("/growth/referrals/refresh", { method: "POST" })).json;
    assert.deepEqual(g.referrals.stats, { confirmed: 2, pending: 1 });
    assert.equal(g.credits.lines.filter((l) => l.kind === "referral-reward").length, 2);
    g = (await s.api("/growth/referrals/refresh", { method: "POST" })).json;
    assert.equal(g.credits.lines.filter((l) => l.kind === "referral-reward").length, 2, "not added twice");
    assert.equal(g.credits.balance, 15);
  } finally { await s.stop(); }

  const local = await startServer({ env: { CC_REFERRALS: "1" } });
  try {
    const g = (await local.api("/growth/referrals/redeem", { method: "POST", body: { code: "REF-FRENDS23" } })).json;
    assert.equal(g.referrals.server, false);
    assert.equal(g.referrals.redeemed.status, "pending"); assert.match(g.referrals.redeemed.message, /No credit is added/);
    assert.equal(g.credits.balance, 0, "nothing added without confirmation");
  } finally { await local.stop(); }
});

test("growth page code: registered, behind the flags, no checkout or payment link, no em-dashes", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "features", "growth.js"), "utf8");
  const idx = fs.readFileSync(path.join(ROOT, "web", "features", "index.js"), "utf8");
  assert.match(idx, /"growth"/);
  assert.match(src, /id: "growth"/);
  assert.match(src, /if \(!anyOn\(g\)\) \{ el\.innerHTML = ""; return; \}/, "shows nothing with every flag off");
  assert.ok(!/square|checkout|stripe/i.test(src), "no payment link");
  for (const f of ["web/features/growth.js", "server/growth.js", "server/plugins/growth.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `em-dash in ${f}`);
});
