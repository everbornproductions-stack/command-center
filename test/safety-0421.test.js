// 0.4.21 M-safety: the send check covers every path, private numbers are hidden before any preview,
// a plan that names an AI that cannot run is re-planned, and no raw JavaScript error reaches the person.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { maskPrivate, maskDeep } from "../server/mask-private.js";
import { maskSensitive, checkOutgoing, assertOutgoingOk } from "../server/compliance-guard.js";
import { makeDraft, cleanInput } from "../server/builders/drafts.js";
import { buildPayload } from "../server/plugins/publish.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("one shared mask: SSNs (dashed or labeled), cards and labeled account numbers keep only four digits", () => {
  assert.equal(maskPrivate("SSN 123-45-6789 ok"), "SSN ***-**-6789 ok");
  assert.equal(maskPrivate("my social security number is 123456789."), "my social security number is ***-**-6789.");
  assert.equal(maskPrivate("card 4242 4242 4242 4242"), "card **** **** **** 4242");
  assert.equal(maskPrivate("Account number: 000123456789 please"), "Account number: ****6789 please");
  assert.equal(maskPrivate("routing #021000021"), "routing #****0021");
  assert.equal(maskPrivate("call 916 555 0100, order 12345"), "call 916 555 0100, order 12345");
  assert.equal(maskSensitive, maskPrivate, "the guard and the send log use the same helper");
  assert.deepEqual(maskDeep({ a: ["SSN 123-45-6789"], b: { c: "acct 99887766" }, n: 4 }), { a: ["SSN ***-**-6789"], b: { c: "acct ****7766" }, n: 4 });
});

test("a missing permission is warned on the draft and on the Gmail check, not forced to yes", () => {
  const sms = (extra) => makeDraft("hl-campaign", cleanInput({ text: "Spring sale. Reply STOP to opt out.", channel: "sms", recipients: "c-1", sendTime: "10:00", ...extra }).input);
  assert.ok(sms().compliance.warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(!makeDraft("hl-campaign", { text: "Spring sale. Reply STOP to opt out.", channel: "sms", recipients: "c-1", consent: true }).compliance.warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(assertOutgoingOk({ text: "Hello there", channel: "email" }).warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(!assertOutgoingOk({ text: "Hello there", channel: "email", consent: true }).warnings.some((w) => w.rule === "missing_consent"));
  assert.ok(checkOutgoing({ text: "Hi", channel: "email" }).needsAck);
  for (const f of ["server/compliance-guard.js", "server/builders/drafts.js", "server/plugins/publish.js"]) assert.doesNotMatch(read(f), /consent: true,? ?(?:sendTime|creditRepair|\})/, `${f} no longer forces consent`);
});

test("Slack, Instagram and HighLevel posts: private numbers are hidden in the payload, preview and history", async () => {
  for (const channel of ["slack", "instagram", "ghl"]) {
    const pl = buildPayload({ channel, title: "Client SSN 123-45-6789", text: "Card 4242 4242 4242 4242, account number 555566667777" });
    assert.doesNotMatch(`${pl.title} ${pl.text}`, /123-45-6789|4242 4242 4242 4242|555566667777/, channel);
    assert.equal(pl.masked, true);
  }
  const s = await startServer({});
  try {
    const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", channelId: "C0123456789", title: "SSN 123-45-6789", text: "hello" } });
    assert.equal(pv.status, 200);
    assert.doesNotMatch(JSON.stringify(pv.json), /123-45-6789/);
    assert.ok(pv.json.warnings.some((w) => w.rule === "private_numbers_hidden"));
    const post = await s.api("/publish/post", { method: "POST", body: { channel: "slack", previewId: pv.json.previewId, confirmed: true } });
    assert.ok([200, 502].includes(post.status));
    assert.doesNotMatch(JSON.stringify(post.json), /123-45-6789/);
    const hist = await s.api("/publish/history");
    assert.doesNotMatch(JSON.stringify(hist.json), /123-45-6789/);
    assert.match(JSON.stringify(hist.json), /\*\*\*-\*\*-6789/);
  } finally { await s.stop(); }
});

test("HighLevel plans and Gmail drafts hide private numbers in the preview", async () => {
  const hl = read("server/highlevel-tools.js"), inbox = read("server/everyday-inbox.js"), plan = read("server/everyday-plan.js");
  assert.match(hl, /args\.text = maskPrivate\(args\.text\)/);
  assert.match(hl, /summary: maskPrivate\(spec\.summary\(args\)\)/);
  for (const t of [inbox, plan]) assert.match(t, /body: maskPrivate\(draft\.body\)/);
  const d = makeDraft("hl-campaign", { text: "Hi SSN 123-45-6789", channel: "email", recipients: "c-1" });
  assert.match(maskDeep(d).message, /\*\*\*-\*\*-6789/);
});

// ---------- never just stops ----------
import http from "node:http";
import { plainMessage, looksRaw, PLAIN_FALLBACK } from "../server/plain-error.js";
import { unavailableNamed, scrubUnavailable, replanLine, cleanCapability } from "../server/plan-safe.js";

test("plain-error: program errors are replaced with plain words, ordinary messages pass through", () => {
  for (const raw of ["Cannot read properties of undefined (reading 'score')", "x is not a function", "Unexpected token < in JSON at position 0", "at run (file:///app/server/mission.js:10:5)", "ENOENT: no such file", "[object Object]"]) {
    assert.equal(looksRaw(raw), true, raw);
    assert.equal(plainMessage(new TypeError(raw)), PLAIN_FALLBACK);
    assert.equal(plainMessage(raw), PLAIN_FALLBACK);
  }
  assert.equal(plainMessage(new Error("No AI is available to plan. Add an API key in Settings.")), "No AI is available to plan. Add an API key in Settings.");
  assert.equal(plainMessage(new TypeError("anything")), PLAIN_FALLBACK, "a TypeError is hidden even when its words look fine");
  assert.equal(plainMessage(""), PLAIN_FALLBACK);
  assert.doesNotMatch(PLAIN_FALLBACK, /—|stack|undefined/);
});

test("plan-safe: only a hand-off to an AI that cannot run counts, and never when the goal named it", () => {
  const plan = { tasks: [{ id: "t1", title: "Research rivals", instructions: "Ask Antigravity to browse the sites", capability: "research" }, { id: "t2", title: "Write", agent: "Grok Bot" }, { id: "t3", title: "Compare ChatGPT and Claude pricing", instructions: "Summarize both price pages" }] };
  const ready = new Set(["anthropic"]);
  assert.deepEqual(unavailableNamed(plan, { goal: "plan a launch", readyIds: ready }).map((h) => h.id).sort(), ["antigravity", "grokbot"], "a subject like 'compare ChatGPT' is not a hand-off");
  assert.deepEqual(unavailableNamed(plan, { goal: "plan a launch", readyIds: new Set(["anthropic", "antigravity", "grokbot"]) }), []);
  assert.deepEqual(unavailableNamed(plan, { goal: "use Antigravity for research", readyIds: ready }).map((h) => h.id), ["grokbot"]);
  assert.deepEqual(unavailableNamed({ tasks: [{ id: "t1", title: "Draft", provider: "ChatGPT" }] }, { goal: "x", readyIds: ready }).map((h) => h.id), ["openai"], "an AI with no key is unavailable too");
  const clean = scrubUnavailable(plan, [{ id: "antigravity" }, { id: "grokbot" }]);
  assert.match(clean.tasks[0].instructions, /Ask an available AI/); assert.equal(clean.tasks[1].agent, undefined);
  assert.match(replanLine(["Antigravity"], ["Claude"]), /cannot run right now: Antigravity/);
  assert.equal(cleanCapability("antigravity"), "reasoning"); assert.equal(cleanCapability("Code"), "code");
});

test("a Mission whose plan names Antigravity and Grok Bot is planned again on the connected AI and finishes", async () => {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
      if (/\/models$/.test(req.url)) return send(200, { data: [{ id: "openai/gpt-oss-120b" }] });
      const j = JSON.parse(body || "{}");
      const sys = j.messages?.find((m) => m.role === "system")?.content || "";
      let text = "Done: a short, useful answer.";
      if (/Break the goal into/.test(sys)) {
        calls.push(/cannot run right now/.test(sys) ? "replan" : "plan");
        text = /cannot run right now/.test(sys)
          ? JSON.stringify({ title: "Clean plan", tasks: [{ id: "t1", title: "Draft the tagline", capability: "writing", difficulty: 1, deps: [], instructions: "Write one tagline.", deliverable: "A tagline" }], assembly: "Use t1." })
          : JSON.stringify({ title: "Plan", tasks: [{ id: "t1", title: "Research", capability: "antigravity", difficulty: 1, deps: [], instructions: "Ask Antigravity to look this up", agent: "Grok Bot", deliverable: "Notes" }], assembly: "Join." });
      } else if (/capability/.test(sys) && /Reply with JSON only/.test(sys)) text = `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
      else if (/You QA another AI/.test(sys)) text = `{"pass":true,"score":8,"issues":[]}`;
      res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
      res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off", CC_BASE_URL_GROQ: `http://127.0.0.1:${srv.address().port}/v1`, GROQ_API_KEY: "", XAI_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  try {
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "groq", key: "gsk_fakefakefakefakefake" } })).json.status.status, "green");
    const before = new Set(((await s.api("/state")).json.missions || []).map((m) => m.id));
    const posted = await s.api("/mission", { method: "POST", body: { goal: "Write one bakery tagline.", mode: "economy", qa: false, budgetUsd: 1 } });
    assert.equal(posted.status, 202, JSON.stringify(posted.json));
    let m = null;
    for (let i = 0; i < 240 && !m; i++) { await new Promise((r) => setTimeout(r, 250)); m = (await s.api("/state")).json.missions.find((x) => !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status)); }
    assert.ok(m, "the mission settled");
    const full = (await s.api(`/missions/${m.id}`)).json;
    assert.deepEqual(calls, ["plan", "replan"], `planned again once: ${full.status} ${full.error} ${JSON.stringify((full.log || []).map((l) => l.text))} ${JSON.stringify(full).slice(0, 700)} ${s.log.split("\n").filter((l) => !/NETTRACE|plugins/.test(l)).join(" ").slice(-800)}`);
    assert.equal(full.status, "done", full.error);
    assert.equal(full.tasks.length, 1); assert.equal(full.tasks[0].agent, false);
    assert.deepEqual(full.replanned?.named?.sort(), ["Antigravity", "Grok Bot"].sort());
    assert.ok(full.log.some((l) => /Antigravity and Grok Bot, which cannot run right now/.test(l.text)));
    assert.doesNotMatch(JSON.stringify(full.log), /TypeError|Cannot read/);
  } finally { await s.stop(); await new Promise((r) => srv.close(r)); }
});

test("source: errors that reach the person go through plainMessage", () => {
  const idx = read("server/index.js"), mis = read("server/mission.js");
  assert.match(idx, /looksRaw\(body\.error\)/);
  assert.match(idx, /plainMessage\(\(err\.plain/);
  assert.match(idx, /Chat failed: \$\{plainMessage\(e\)\}/);
  assert.match(mis, /mission\.error = plainMessage\(err\)/);
});
