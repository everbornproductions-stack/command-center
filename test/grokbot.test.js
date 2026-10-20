// Phase 12: Grok Bot agent. Pure checks on the router's hint and the settings validation, then the running
// server against one local mock (random port) playing xAI for the text work and Grok Bot's webhook:
// settings in the vault, the hand-off body and header, the callback (per-job token, single use, exempt
// from the session token, everything else refused), council (in time, late, plain text, left out),
// mission (in time, late), paste by hand, cancel, refused / unreachable webhooks, demo mode and the mock,
// hub cards, and no secret anywhere it should not be. No real URL or key is ever used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-grokbot-");
const GB = await import("../server/grokbot.js");

test("agentNeeds: signed-in browsing, Gmail, Drive, Calendar and teammate bots; plain text work never matches", () => {
  assert.deepEqual(GB.agentNeeds("Check my Gmail inbox for the Acme invoice"), ["gmail"]);
  assert.deepEqual(GB.agentNeeds("Send an email to Dana with the contract"), ["gmail"]);
  assert.deepEqual(GB.agentNeeds("Save the report to Google Drive and book a meeting with Sam on my calendar"), ["drive", "calendar"]);
  assert.deepEqual(GB.agentNeeds("Log in to the supplier portal and download my invoices"), ["signed-in-browsing"]);
  assert.deepEqual(GB.agentNeeds("Ask my bots to split the research"), ["teammate-bots"]);
  for (const plain of ["Write a tagline for a bakery.", "Draft an email to a new client about our prices", "Plan the Instagram week with a posting schedule", "Summarize this article", "Write a blog post about the history of calendars"]) {
    assert.deepEqual(GB.agentNeeds(plain), [], plain);
  }
  assert.equal(GB.mentionsGrokBot("ask Grok Bot to do it"), true);
  assert.equal(GB.mentionsGrokBot("ask Grok to do it"), false, "Grok the AI is not Grok Bot");
  assert.deepEqual(GB.TAGS, ["signed-in-browsing", "gmail", "drive", "calendar", "teammate-bots"]);
  assert.deepEqual(GB.STATUSES, ["queued", "working", "needs_approval", "done", "failed"]);
});

test("checkUrl and words: https anywhere, http only for this computer, no credentials; no em-dashes", () => {
  assert.equal(GB.checkUrl("https://bot.example.com/hook"), "https://bot.example.com/hook");
  assert.equal(GB.checkUrl("http://127.0.0.1:9000/hook"), "http://127.0.0.1:9000/hook");
  for (const bad of ["", "ftp://x.example/hook", "http://bot.example.com/hook", "https://user:pw@bot.example.com/hook", "not a url", "https://a b"]) assert.throws(() => GB.checkUrl(bad), /address|web address|key/, bad);
  const words = [...Object.values(GB.TAG_LABEL), ...Object.values(GB.STATUS_LABEL)].join(" ");
  assert.doesNotMatch(words, /—/);
  const src = fs.readFileSync(new URL("../server/grokbot.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../web/features/grokbot.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../server/agents.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /—/, "no em-dashes in user-facing text");
  assert.match(src, /timingSafeEqual/); assert.match(src, /results are async and can take minutes/i);
});

// ---------- one mock: xAI for the text work, plus Grok Bot's webhook ----------
const XAI_KEY = "xai-fakefakefakefakefake";
const SENDER = "gbk_test_sender_key_0123456789";
function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 10 } })}\n\n`);
  res.write("data: [DONE]\n\n"); res.end();
}
function answerFor(j) {
  const sys = j.messages.find((m) => m.role === "system")?.content || "";
  const user = j.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (/Score this answer to the question/.test(sys)) return `{"score":6,"note":"fine"}`;
  if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"research","difficulty":1,"needWeb":false,"summary":"mock"}`;
  if (/Break the goal into/.test(sys)) {
    if (/"agent"/.test(sys)) return JSON.stringify({ title: "Invoice run", tasks: [{ id: "t1", title: "Pull the Acme invoice", capability: "agent", needs: ["gmail"], difficulty: 1, needWeb: false, deps: [], instructions: "Find the Acme invoice in the inbox.", deliverable: "Invoice number and amount" }, { id: "t2", title: "Write the summary", capability: "writing", difficulty: 1, needWeb: false, deps: ["t1"], instructions: "Summarise it.", deliverable: "Summary" }], assembly: "One doc." });
    return JSON.stringify({ title: "Plain plan", tasks: [{ id: "t1", title: "Write it", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write it.", deliverable: "Text" }], assembly: "One doc." });
  }
  if (/strict judge/.test(sys)) { const letters = [...user.matchAll(/### Answer ([A-J])/g)].map((m) => m[1]); return JSON.stringify({ scores: Object.fromEntries(letters.map((l, i) => [l, 7 + i])), best: letters.at(-1), notes: {}, disagreement: "none" }); }
  if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
  return `Answer from ${j.model}.`;
}
async function mocks() {
  const hook = { status: 200, hits: [] };
  const chats = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/hook") {
      hook.hits.push({ method: req.method, headers: req.headers, body: JSON.parse(body || "null") });
      if (hook.status === "drop") return req.socket.destroy();
      if (hook.status !== 200) return send(hook.status, { error: "nope" });
      return send(200, { status: "queued" });
    }
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "grok-4.3" }] });
    if (url.pathname === "/xai/v1/chat/completions") { const j = JSON.parse(body); chats.push(j); return sse(res, answerFor(j)); }
    send(404, { error: `mock: no route ${url.pathname}` });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, hook, chats, close: () => new Promise((r) => srv.close(r)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 30000, s) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(150); }
  throw new Error(`timed out waiting for ${label}${s ? `\n--- server log tail ---\n${s.log.slice(-1500)}` : ""}`);
}
const finished = (kind, after) => (st) => st.missions.find((m) => m.kind === kind && m.startedAt > after && ["done", "done-with-errors", "failed"].includes(m.status));
const tokenOf = (cb) => new URL(cb).searchParams.get("t");
const pathOf = (cb) => { const u = new URL(cb); return u.pathname + u.search; };

test("server: settings in the vault, hand-off, callback rules, council, mission, paste, cancel, refusals, demo and the mock, hub cards, no secrets leaked", async () => {
  const m = await mocks();
  const s = await startServer({ env: {
    CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_GROKBOT_MOCK_MS: "150",
    CC_BASE_URL_XAI: `${m.base}/xai/v1`,
    XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
  } });
  const callback = (cb, body, headers = {}) => s.raw({ method: "POST", path: pathOf(cb), headers: { "content-type": "application/json", ...headers }, body });
  const job = async (id) => (await s.api("/grokbot/jobs")).json.find((j) => j.id === id);
  try {
    // ---- hub cards and a fresh, not-set-up agent ----
    assert.equal((await s.api("/grokbot", { noToken: true })).status, 401, "the routes need the session token");
    let g = (await s.api("/grokbot")).json;
    assert.equal(g.config.ready, false); assert.equal(g.config.urlSaved, false); assert.equal(g.config.header, "Authorization"); assert.match(g.config.detail, /not set up/);
    let st = (await s.api("/state")).json;
    assert.ok(st.plugins.includes("grokbot"));
    const cards = st.providers.filter((p) => p.kind === "agent").map((p) => p.id);
    assert.deepEqual(cards, ["grokbot", "browser-helper"], "both agents have their own hub cards");
    assert.equal(st.providers.find((p) => p.id === "grokbot").status.status, "grey");
    assert.equal((await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox" } })).status, 409, "no hand-off before it is set up");

    // ---- settings: validation, then the vault; the URL and key never come back ----
    assert.equal((await s.api("/grokbot/config", { method: "POST", body: { url: "http://bot.example.com/hook" } })).status, 400, "http only for this computer");
    assert.equal((await s.api("/grokbot/config", { method: "POST", body: { url: "https://u:p@bot.example.com/hook" } })).status, 400);
    assert.equal((await s.api("/grokbot/config", { method: "POST", body: { header: "Host" } })).status, 400);
    assert.equal((await s.api("/grokbot/config", { method: "POST", body: { key: "short" } })).status, 400);
    assert.equal((await s.api("/grokbot/config", { method: "POST", body: { councilWaitSec: 5000 } })).status, 400);
    let r = await s.api("/grokbot/config", { method: "POST", body: { url: `${m.base}/hook`, key: SENDER } });
    assert.equal(r.status, 200); assert.equal(r.json.urlSaved, true); assert.equal(r.json.keySaved, true); assert.equal(r.json.ready, true);
    assert.ok(!r.text.includes(SENDER) && !r.text.includes("/hook"), "neither the key nor the URL is sent back");
    assert.equal(r.json.reachable, false, "the callback address is this computer until a hub or tunnel exists");
    assert.match(r.json.callbackExample, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/api/grokbot/callback/<job_id>\\?t=<token>$`));
    st = (await s.api("/state")).json;
    assert.ok(!JSON.stringify(st).includes(SENDER) && !JSON.stringify(st).includes(`${m.base}/hook`));
    assert.equal(st.providers.find((p) => p.id === "grokbot").status.status, "green");

    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: XAI_KEY } })).json.status.status, "green");

    // ---- a click: the hand-off body and header ----
    r = await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox for the Acme invoice", context: "Acme is a supplier." } });
    assert.equal(r.status, 202); const j1 = r.json.job;
    assert.equal(j1.status, "queued"); assert.deepEqual(j1.needs, ["gmail"]); assert.equal(j1.source.kind, "click");
    let hit = m.hook.hits.at(-1);
    assert.equal(hit.method, "POST"); assert.equal(hit.headers.authorization, `Bearer ${SENDER}`); assert.match(hit.headers["content-type"], /application\/json/);
    assert.deepEqual(Object.keys(hit.body).sort(), ["callback_url", "context", "job_id", "task", "workspace"]);
    assert.equal(hit.body.job_id, j1.id); assert.equal(hit.body.task, "Check my Gmail inbox for the Acme invoice"); assert.equal(hit.body.context, "Acme is a supplier."); assert.equal(hit.body.workspace, "personal");
    const cb1 = hit.body.callback_url;
    assert.match(cb1, new RegExp(`^http://127\\.0\\.0\\.1:${s.port}/api/grokbot/callback/${j1.id}\\?t=[A-Za-z0-9_-]{30,}$`));

    // ---- the callback: per-job token, exempt from the session token and the Host pin, everything else refused ----
    const good = pathOf(cb1);
    assert.equal((await s.raw({ method: "GET", path: good })).status, 405);
    assert.equal((await s.raw({ method: "POST", path: `/api/grokbot/callback/${j1.id}`, headers: { "content-type": "application/json" }, body: { status: "working" } })).status, 401, "no token");
    assert.equal((await s.raw({ method: "POST", path: `/api/grokbot/callback/${j1.id}?t=wrong-token-wrong-token-wrong-token`, headers: { "content-type": "application/json" }, body: { status: "working" } })).status, 401, "wrong token");
    assert.equal((await s.raw({ method: "POST", path: `/api/grokbot/callback/gb-unknownjob1?t=${tokenOf(cb1)}`, headers: { "content-type": "application/json" }, body: { status: "working" } })).status, 401, "a token only fits its own job");
    assert.equal((await s.raw({ method: "POST", path: "/api/grokbot/callback/../state", headers: { "content-type": "application/json" }, body: {} })).status, 401, "a path that leaves the callback is not exempt");
    assert.equal((await s.raw({ method: "POST", path: `/api/grokbot/callback/${j1.id}/x?t=${tokenOf(cb1)}`, headers: { "content-type": "application/json" }, body: { status: "working" } })).status, 404);
    assert.equal((await s.raw({ method: "POST", path: good, headers: { "content-type": "text/plain" }, body: "status=done" })).status, 415);
    assert.equal((await callback(cb1, { status: "finished" })).status, 400, "only the known statuses");
    assert.equal((await callback(cb1, { status: "done", text: 5 })).status, 400);
    assert.equal((await s.raw({ method: "POST", path: good, headers: { "content-type": "application/json" }, body: "{not json" })).status, 400);
    assert.equal((await s.raw({ method: "POST", path: "/api/grokbot/callback", headers: { "content-type": "application/json" }, body: {} })).status, 401, "only the exact callback path is exempt");
    assert.equal((await s.raw({ method: "GET", path: "/api/grokbot/jobs", headers: { host: "tunnel.example.com" } })).status, 421, "other routes keep the Host pin");
    r = await callback(cb1, { status: "working" }, { host: "tunnel.example.com", origin: "https://tunnel.example.com" });
    assert.equal(r.status, 200, "a tunnel's Host is fine on the callback"); assert.deepEqual(r.json, { ok: true, job_id: j1.id, status: "working" });
    assert.equal((await callback(cb1, { status: "needs_approval", text: "OK to open the invoice?" })).status, 200);
    assert.equal((await job(j1.id)).status, "needs_approval");
    assert.equal((await s.api("/state")).json.providers.find((p) => p.id === "grokbot").status.status, "amber", "the light asks for approval");
    r = await callback(cb1, { status: "done", text: "Invoice #42 from Acme, $1,200, due Nov 1.", artifacts: [{ name: "invoice.pdf", url: "https://drive.example.com/f/42" }, { name: "bad", url: "javascript:alert(1)" }] });
    assert.equal(r.status, 200);
    let jd = await job(j1.id);
    assert.equal(jd.status, "done"); assert.match(jd.text, /Invoice #42/); assert.equal(jd.by, "grokbot");
    const clickBrain = JSON.parse(fs.readFileSync(path.join(s.dir, "brain.json"), "utf8"));
    assert.ok(clickBrain.stats.grokbot.t["reasoning:1"].jobs >= 1, "a finished click hand-off is in the track record");
    assert.doesNotMatch(JSON.stringify(clickBrain), /Invoice #42/);
    assert.deepEqual(jd.artifacts, [{ name: "invoice.pdf", url: "https://drive.example.com/f/42", type: null }, { name: "bad", url: null, type: null }], "only http(s) links are kept");
    assert.deepEqual(jd.history.map((h) => h.status), ["queued", "working", "needs_approval", "done"]);
    assert.equal((await callback(cb1, { status: "done", text: "again" })).status, 401, "single use: done burns the token");
    st = (await s.api("/state")).json;
    assert.ok(st.recent.some((e) => e.type === "external.handoff" && e.agent === "grokbot" && e.jobId === j1.id && e.status === "done"), "the live view's hand-off event");
    assert.ok(st.recent.some((e) => e.type === "log" && /Grok Bot: result back/.test(e.text)));
    const card = st.providers.find((p) => p.id === "grokbot");
    assert.equal(card.status.status, "green"); assert.ok(card.agent.activity.some((a) => a.jobId === j1.id && a.status === "done"), "the card's activity feed");

    // a custom header carries the key as is
    await s.api("/grokbot/config", { method: "POST", body: { header: "X-Api-Key" } });
    await s.api("/grokbot/jobs", { method: "POST", body: { task: "Look in my Gmail for the receipt" } });
    hit = m.hook.hits.at(-1);
    assert.equal(hit.headers["x-api-key"], SENDER); assert.equal(hit.headers.authorization, undefined);
    await s.api("/grokbot/config", { method: "POST", body: { header: "" } });
    assert.equal((await s.api("/grokbot")).json.config.header, "Authorization", "blank goes back to the default");

    // ---- router: preferred for what it can do, never for plain text ----
    let route = (await s.api(`/route?prompt=${encodeURIComponent("Write a tagline for a bakery.")}`)).json;
    assert.equal(route.agent.fits, false);
    route = (await s.api(`/route?prompt=${encodeURIComponent("Check my Gmail inbox for the Acme invoice")}`)).json;
    assert.equal(route.agent.fits, true); assert.deepEqual(route.agent.needs.map((n) => n.id), ["gmail"]); assert.equal(route.agent.ready, true);
    assert.ok(!route.ranked.some((x) => x.provider === "grokbot"), "never in the text ranking");

    // ---- council, in time: its answer is reviewed and scored like the others ----
    let hits0 = m.hook.hits.length, t0 = Date.now();
    assert.equal((await s.api("/council", { method: "POST", body: { prompt: "Look in my Gmail inbox for the Acme invoice and tell me the amount" } })).status, 202);
    hit = await waitFor(() => m.hook.hits.length > hits0 && m.hook.hits.at(-1), "council hand-off", 30000, s);
    assert.equal(hit.body.task, "Look in my Gmail inbox for the Acme invoice and tell me the amount");
    assert.equal((await callback(hit.body.callback_url, { status: "working" })).status, 200);
    assert.equal((await callback(hit.body.callback_url, { status: "done", text: "The Acme invoice is $1,200." })).status, 200);
    let run = await waitFor(async () => finished("council", t0 - 1)((await s.api("/state")).json), "council in time", 60000, s);
    let full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.agents.length, 1); assert.equal(full.agents[0].id, "grokbot"); assert.equal(full.agents[0].status, "done"); assert.deepEqual(full.agents[0].needs, ["gmail"]);
    assert.equal(full.answers.grokbot.text, "The Acme invoice is $1,200."); assert.equal(full.answers.grokbot.letter, "B");
    assert.ok(full.scoreboard.grokbot.avg > 0, "peer score"); assert.equal(full.winner, "grokbot", "it can win the round");
    assert.ok(full.reviews && !full.reviews.grokbot, "Grok Bot does not review");
    assert.ok(run.members.includes("grokbot"), "the run list names it");
    const said = (c) => c.messages.map((x) => (typeof x.content === "string" ? x.content : JSON.stringify(x.content))).join("\n");
    const chairCall = m.chats.findLast((c) => /chair a council/.test(said(c)));
    assert.match(said(chairCall), /Answer B \(Grok Bot, peer score/, "the chair sees it next to the others");
    assert.ok(fs.readFileSync(path.join(s.dir, "brain.json"), "utf8").includes("grokbot"), "credited in the track record");

    // ---- council, plain text: never handed over; and left out by the person ----
    hits0 = m.hook.hits.length; t0 = Date.now();
    await s.api("/council", { method: "POST", body: { prompt: "Write a tagline for a bakery." } });
    run = await waitFor(async () => finished("council", t0 - 1)((await s.api("/state")).json), "plain council", 60000, s);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.deepEqual(full.agents, []); assert.equal(m.hook.hits.length, hits0, "no hand-off for plain text work");
    t0 = Date.now();
    await s.api("/council", { method: "POST", body: { prompt: "Check my Gmail inbox for the Acme invoice", grokbot: false } });
    run = await waitFor(async () => finished("council", t0 - 1)((await s.api("/state")).json), "council without", 60000, s);
    assert.deepEqual((await s.api(`/missions/${run.id}`)).json.agents, []); assert.equal(m.hook.hits.length, hits0, "left out by the person");

    // ---- council, late: the council goes on; the answer joins it afterwards with a judge score ----
    await s.api("/grokbot/config", { method: "POST", body: { councilWaitSec: 1 } });
    hits0 = m.hook.hits.length; t0 = Date.now();
    await s.api("/council", { method: "POST", body: { prompt: "Check my Gmail inbox for the Zeta invoice" } });
    run = await waitFor(async () => finished("council", t0 - 1)((await s.api("/state")).json), "late council", 60000, s);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.answers.grokbot.pending, true); assert.ok(!full.scoreboard?.grokbot);
    hit = m.hook.hits[hits0];
    assert.equal((await callback(hit.body.callback_url, { status: "done", text: "Zeta invoice: $300." })).status, 200);
    full = await waitFor(async () => { const x = (await s.api(`/missions/${run.id}`)).json; return x.answers.grokbot.text && x.scoreboard?.grokbot ? x : null; }, "late answer", 20000, s);
    assert.equal(full.answers.grokbot.late, true); assert.equal(full.scoreboard.grokbot.avg, 6); assert.equal(full.scoreboard.grokbot.late, true);
    st = (await s.api("/state")).json;
    assert.ok(st.recent.some((e) => e.type === "grokbot.late" && e.runId === run.id));
    assert.ok(st.ledger.recent.some((e) => e.kind === "call" && e.missionId === run.id && e.role === "review" && e.provider === "xai"), "the judge call is in the ledger");
    await s.api("/grokbot/config", { method: "POST", body: { councilWaitSec: 90 } });

    // ---- mission, in time: the planner hands the Gmail step to Grok Bot; the next step uses its result ----
    hits0 = m.hook.hits.length; t0 = Date.now();
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "Find the Acme invoice and write me a summary", qa: false } })).status, 202);
    hit = await waitFor(() => m.hook.hits.length > hits0 && m.hook.hits.at(-1), "mission hand-off", 30000, s);
    assert.match(hit.body.task, /^Pull the Acme invoice\nFind the Acme invoice in the inbox\./); assert.match(hit.body.context, /Mission goal: Find the Acme invoice/);
    assert.equal((await callback(hit.body.callback_url, { status: "done", text: "Acme invoice #42, $1,200." })).status, 200);
    run = await waitFor(async () => finished("mission", t0 - 1)((await s.api("/state")).json), "mission", 60000, s);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error);
    const t1 = full.tasks.find((t) => t.id === "t1");
    assert.equal(t1.provider, "grokbot"); assert.equal(t1.agent, true); assert.deepEqual(t1.needs, ["gmail"]); assert.equal(t1.status, "done"); assert.equal(t1.agentJob.status, "done");
    assert.equal(full.tasks.find((t) => t.id === "t2").provider, "xai");
    assert.ok(m.chats.some((c) => /TASK: Write the summary/.test(said(c)) && /Acme invoice #42, \$1,200\./.test(said(c))), "the next step got Grok Bot's result");
    assert.ok(run.providers.includes("grokbot"));

    // ---- mission, late: the mission finishes without it; the result is added when it comes back ----
    await s.api("/grokbot/config", { method: "POST", body: { missionWaitMin: 0 } });
    hits0 = m.hook.hits.length; t0 = Date.now();
    await s.api("/mission", { method: "POST", body: { goal: "Find the Zeta invoice and write me a summary", qa: false } });
    run = await waitFor(async () => finished("mission", t0 - 1)((await s.api("/state")).json), "late mission", 60000, s);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.tasks.find((t) => t.id === "t1").status, "waiting"); assert.match(full.deliverable, /Still waiting on Grok Bot:\*\* "Pull the Acme invoice"/);
    hit = m.hook.hits[hits0];
    assert.equal((await callback(hit.body.callback_url, { status: "done", text: "Zeta invoice #7, $300." })).status, 200);
    full = await waitFor(async () => { const x = (await s.api(`/missions/${run.id}`)).json; return x.tasks.find((t) => t.id === "t1").status === "done" ? x : null; }, "late mission result", 20000, s);
    assert.equal(full.tasks.find((t) => t.id === "t1").late, true); assert.match(full.deliverable, /## Pull the Acme invoice \(from Grok Bot, after the rest of the mission\)\n\nZeta invoice #7, \$300\./);
    await s.api("/grokbot/config", { method: "POST", body: { missionWaitMin: 15 } });

    // ---- paste by hand and cancel; both burn the token ----
    let jp = (await s.api("/grokbot/jobs", { method: "POST", body: { task: "Download my invoice from the supplier portal" } })).json.job;
    const cbp = m.hook.hits.at(-1).body.callback_url;
    assert.equal((await s.api(`/grokbot/jobs/${jp.id}/result`, { method: "POST", body: { text: "" } })).status, 400);
    r = await s.api(`/grokbot/jobs/${jp.id}/result`, { method: "POST", body: { text: "Pasted: invoice saved." } });
    assert.equal(r.status, 200); assert.equal(r.json.job.status, "done"); assert.equal(r.json.job.by, "you");
    assert.equal((await callback(cbp, { status: "done", text: "late" })).status, 401);
    const jc = (await s.api("/grokbot/jobs", { method: "POST", body: { task: "Book a meeting with Sam on my calendar" } })).json.job;
    const cbc = m.hook.hits.at(-1).body.callback_url;
    r = await s.api(`/grokbot/jobs/${jc.id}/cancel`, { method: "POST" });
    assert.equal(r.json.job.status, "failed"); assert.match(r.json.job.error, /cancelled by you/);
    assert.equal((await callback(cbc, { status: "working" })).status, 401);
    assert.equal((await s.api("/grokbot/jobs/gb-nosuchjob00/result", { method: "POST", body: { text: "x" } })).status, 404);

    // ---- refused and unreachable webhooks: a plain reason, no URL, a red light ----
    m.hook.status = 401;
    r = await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox" } });
    assert.equal(r.status, 502); assert.equal(r.json.job.error, "Grok Bot refused the sender key (401).");
    assert.equal((await s.api("/state")).json.providers.find((p) => p.id === "grokbot").status.status, "red");
    m.hook.status = 500;
    assert.equal((await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox" } })).json.job.error, "Grok Bot refused the job (500).");
    m.hook.status = "drop";
    r = await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox" } });
    assert.match(r.json.job.error, /^Could not reach Grok Bot: /); assert.ok(!r.json.job.error.includes("127.0.0.1"), "no address in the reason");
    m.hook.status = 200;

    // ---- demo mode: only the built-in mock ----
    await s.api("/demo", { method: "POST", body: { on: true } });
    g = (await s.api("/grokbot")).json;
    assert.equal(g.config.ready, false); assert.match(g.config.detail, /demo mode/);
    hits0 = m.hook.hits.length;
    assert.equal((await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox" } })).status, 409);
    assert.equal(m.hook.hits.length, hits0, "nothing sent in demo mode");
    await s.api("/grokbot/config", { method: "POST", body: { mock: true } });
    const jm = (await s.api("/grokbot/jobs", { method: "POST", body: { task: "Check my Gmail inbox" } })).json.job;
    assert.equal(jm.via, "mock");
    const jmd = await waitFor(async () => { const x = await job(jm.id); return x.status === "done" ? x : null; }, "mock job", 10000, s);
    assert.equal(jmd.by, "mock"); assert.match(jmd.text, /pretend result from the built-in mock/); assert.deepEqual(jmd.history.map((h) => h.status), ["queued", "working", "done"]);
    t0 = Date.now();
    await s.api("/council", { method: "POST", body: { prompt: "Check my Gmail inbox for the Acme invoice" } });
    run = await waitFor(async () => finished("council", t0 - 1)((await s.api("/state")).json), "demo council", 60000, s);
    full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.answers.grokbot.by, "mock"); assert.equal(m.hook.hits.length, hits0, "the mock never leaves the process");
    await s.api("/grokbot/config", { method: "POST", body: { mock: false } });
    await s.api("/demo", { method: "POST", body: { on: false } });

    // ---- remove, and no secret anywhere it should not be ----
    r = await s.api("/grokbot/config", { method: "POST", body: { remove: true } });
    assert.equal(r.json.urlSaved, false); assert.equal(r.json.keySaved, false); assert.equal(r.json.ready, false);
    assert.ok(!s.log.includes(SENDER) && !s.log.includes("/hook"), "never in the log");
    const tokens = m.hook.hits.map((h) => tokenOf(h.body.callback_url));
    for (const f of fs.readdirSync(s.dir)) {
      if (f === "vault.bin" || !f.endsWith(".json")) continue;
      const txt = fs.readFileSync(path.join(s.dir, f), "utf8");
      assert.ok(!txt.includes(SENDER) && !txt.includes(`${m.base}/hook`), `${f}: no key or URL`);
      for (const t of tokens) assert.ok(!txt.includes(t), `${f}: no raw callback token`);
    }
    assert.ok(!fs.readFileSync(path.join(s.dir, "vault.bin"), "utf8").includes(SENDER), "the vault is sealed");
    const stored = JSON.parse(fs.readFileSync(path.join(s.dir, "grokbot.jobs.json"), "utf8"));
    assert.ok(stored.every((x) => x.tokenHash === null || /^[0-9a-f]{64}$/.test(x.tokenHash)), "only hashes are stored");
  } finally {
    await s.stop(); await m.close();
  }
});
