// 0.4.17: council wording, and a council from one OpenRouter key.
// Pure checks on the offer and the Simple answer line, then the running server with only an
// OpenRouter key pointed at a local mock: the council seats Claude, ChatGPT, Gemini and Grok
// through OpenRouter, each labeled by family, and every call is in the ledger at a real price.
// No real URL or key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { councilOffer, openRouterFamilySeats, seatLabel, OPENROUTER_FAMILIES } from "../server/council-offer.js";
import { simpleAnswerLine, councilRequest, ASK_COUNCIL } from "../web/council-offer.js";
import { startServer, waitBudget } from "./helpers.js";

const REG = {
  anthropic: { id: "anthropic", name: "Anthropic", kind: "text", models: [{ id: "claude-opus-5-5", tier: "flagship", default: true }, { id: "claude-sonnet-5-5", tier: "balanced" }] },
  openai: { id: "openai", name: "OpenAI", kind: "text", models: [{ id: "gpt-6-astra", tier: "flagship" }, { id: "gpt-6.1-sol", tier: "balanced", default: true }] },
  google: { id: "google", name: "Google Gemini", kind: "text", models: [{ id: "gemini-4-argon", tier: "flagship", default: true }, { id: "gemini-3.8-flash", tier: "balanced" }] },
  xai: { id: "xai", name: "xAI", kind: "text", models: [{ id: "grok-4.7", tier: "flagship", default: true }, { id: "grok-4.3", tier: "balanced" }] },
  openrouter: { id: "openrouter", name: "OpenRouter", kind: "text", models: [{ id: "openrouter/auto", default: true }] },
  "demo-nova": { id: "demo-nova", name: "Nova (demo)", kind: "text", demo: true, models: [] },
  "demo-atlas": { id: "demo-atlas", name: "Atlas (demo)", kind: "text", demo: true, models: [] },
  kling: { id: "kling", name: "Kling", kind: "video", models: [] },
};
const keyedOnly = (...ids) => (id) => ids.includes(id);

test("family seats: one model per company through OpenRouter, priced as that model", () => {
  const seats = openRouterFamilySeats(REG);
  assert.equal(seats.length, 4);
  assert.deepEqual(seats.map((s) => s.family), OPENROUTER_FAMILIES.map((f) => f.family));
  assert.deepEqual(seats.map((s) => s.model), ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash", "x-ai/grok-4.3"]);
  assert.ok(seats.every((s) => s.provider === "openrouter" && s.priceModel && s.label.endsWith("via OpenRouter")));
  assert.equal(openRouterFamilySeats(REG, { limit: 3 }).length, 3);
  assert.equal(openRouterFamilySeats(REG, { limit: 1 }).length, 2, "a council always has at least two seats");
  assert.equal(openRouterFamilySeats(REG, { mode: "max" })[0].model, "anthropic/claude-opus-5-5", "Max quality seats each family's best model");
  assert.deepEqual(openRouterFamilySeats({ anthropic: REG.anthropic }), [], "one family is not a council");
  assert.equal(seatLabel(seats[1], REG), "ChatGPT via OpenRouter");
  assert.equal(seatLabel({ provider: "google" }, REG), "Google Gemini");
});

test("council offer: one company is one AI, two companies or one OpenRouter key is a council", () => {
  let o = councilOffer({ providers: REG, keyed: keyedOnly() });
  assert.equal(o.canCouncil, false); assert.match(o.line, /No AI connected yet/);
  o = councilOffer({ providers: REG, keyed: keyedOnly("anthropic") });
  assert.equal(o.canCouncil, false); assert.equal(o.count, 1);
  assert.match(o.line, /One AI is connected \(Claude\)\. Add a second AI company, or an OpenRouter key/);
  o = councilOffer({ providers: REG, keyed: keyedOnly("anthropic", "openai") });
  assert.equal(o.canCouncil, true); assert.equal(o.viaOpenRouter, false); assert.match(o.line, /Claude and ChatGPT are connected, so you can ask a council/);
  o = councilOffer({ providers: REG, keyed: keyedOnly("openrouter") });
  assert.equal(o.canCouncil, true); assert.equal(o.viaOpenRouter, true);
  assert.deepEqual(o.families, ["Claude", "ChatGPT", "Gemini", "Grok"]);
  assert.match(o.line, /Your OpenRouter key can seat Claude, ChatGPT, Gemini and Grok in a council/);
  o = councilOffer({ providers: REG, keyed: keyedOnly("anthropic", "openrouter") });
  assert.equal(o.canCouncil, true); assert.equal(o.viaOpenRouter, false);
  o = councilOffer({ providers: REG, keyed: keyedOnly("demo-nova", "demo-atlas") });
  assert.equal(o.practice, true); assert.equal(o.canCouncil, true); assert.match(o.line, /pretend AIs/);
  o = councilOffer({ providers: REG, keyed: keyedOnly("kling") });
  assert.equal(o.canCouncil, false, "a video tool is not an AI that answers");
  for (const k of [[], ["anthropic"], ["openrouter"], ["anthropic", "openai"]]) assert.doesNotMatch(councilOffer({ providers: REG, keyed: keyedOnly(...k) }).line, /[\u2013\u2014]/);
});

test("Simple answer line says one AI answered and offers a council only when one can run", () => {
  const one = councilOffer({ providers: REG, keyed: keyedOnly("anthropic") });
  let l = simpleAnswerLine(one, "Claude Sonnet 5.5");
  assert.equal(l.text, "Answered by one AI (Claude Sonnet 5.5). Add a second AI company, or an OpenRouter key, to ask a council.");
  assert.equal(l.offer, null);
  const two = councilOffer({ providers: REG, keyed: keyedOnly("openrouter") });
  l = simpleAnswerLine(two, "Claude via OpenRouter");
  assert.equal(l.text, "Answered by one AI (Claude via OpenRouter).");
  assert.equal(l.offer, ASK_COUNCIL);
  assert.equal(ASK_COUNCIL, "Ask a council");
  assert.equal(simpleAnswerLine(two, { kind: "council", names: ["Claude", "Gemini"] }).text, "A council answered: Claude, Gemini.");
  assert.equal(simpleAnswerLine(null, "").text, "Answered by one AI.");
  assert.deepEqual(councilRequest("Plan my week", { projectId: "p1" }), { path: "/council", body: { prompt: "Plan my week", projectId: "p1" } });
  const src = fs.readFileSync(new URL("../web/council-offer.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../server/council-offer.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /[\u2013\u2014]/);
});

function sse(res, chunks) { res.writeHead(200, { "content-type": "text/event-stream", connection: "close" }); for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`); res.write("data: [DONE]\n\n"); res.end(); }
async function orMock() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    const url = new URL(req.url, "http://127.0.0.1");
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "openrouter/auto" }] });
    if (url.pathname.endsWith("/key")) return send(200, { data: { limit_remaining: 10, usage: 1, limit: 11 } });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body || "{}");
    const sys = j.messages?.find((m) => m.role === "system")?.content || "";
    const user = (j.messages || []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
    seen.push({ model: j.model, sys });
    let text = `Answer from ${j.model}.`;
    if (/Reply with JSON only: \{"capability"/.test(sys)) text = `{"capability":"writing","difficulty":2,"needWeb":false,"summary":"mock"}`;
    else if (/strict judge/.test(sys)) { const letters = [...user.matchAll(/### Answer ([A-J])/g)].map((m) => m[1]); text = JSON.stringify({ scores: Object.fromEntries(letters.map((l, i) => [l, 6 + i])), best: letters[letters.length - 1], notes: {}, disagreement: "none" }); }
    else if (/You chair a council/.test(sys)) text = `Verdict from ${j.model}.`;
    return sse(res, [{ model: j.model, choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50 } }]);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

test("server: one OpenRouter key seats four AI families in a council, labeled and priced", async () => {
  const m = await orMock();
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_OPENROUTER: `${m.base}/or/v1`, OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", XAI_API_KEY: "" } });
  try {
    let st = (await s.api("/state")).json;
    assert.equal(typeof st.councilOffer?.line, "string", "the state carries the council offer");
    const saved = await s.api("/keys", { method: "POST", body: { provider: "openrouter", key: "sk-or-v1-fakefakefakefakefake" } });
    assert.equal(saved.status, 200, saved.text);
    st = (await s.api("/state")).json;
    assert.equal(st.councilOffer.viaOpenRouter, true);
    assert.equal(st.councilOffer.canCouncil, true);
    const before = new Set((st.missions || []).map((x) => x.id));
    const posted = await s.api("/council", { method: "POST", body: { prompt: "Write a short welcome note for new gym members.", qa: true } });
    assert.equal(posted.status, 202, posted.text);
    const budget = waitBudget(60000);
    const t0 = Date.now();
    let row = null;
    while (Date.now() - t0 < budget) {
      // a poll that hits a reset socket (seen on busy Windows PCs) tries again on the next round
      try { st = (await s.api("/state")).json; } catch { await new Promise((r) => setTimeout(r, 500)); continue; }
      row =(st.missions || []).find((x) => x.kind === "council" && !before.has(x.id) && ["done", "failed"].includes(x.status));
      if (row) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(row, "the council finished");
    const full = (await s.api(`/missions/${row.id}`)).json;
    assert.equal(full.status, "done", full.error);
    assert.deepEqual(full.members.map((x) => x.model), ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash", "x-ai/grok-4.3"]);
    assert.ok(full.members.every((x) => x.provider === "openrouter" && /via OpenRouter$/.test(x.label)));
    const answers = Object.values(full.answers);
    assert.equal(answers.filter((a) => a.text).length, 4, "four families answered");
    assert.deepEqual(answers.map((a) => a.family).sort(), ["ChatGPT", "Claude", "Gemini", "Grok"]);
    assert.ok(full.scoreboard && Object.keys(full.scoreboard).length === 4, "the families reviewed each other");
    assert.match(full.verdict.text, /^Verdict from /);
    const asked = new Set(m.seen.filter((x) => !/JSON only|strict judge|chair a council/.test(x.sys)).map((x) => x.model));
    for (const id of ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol", "google/gemini-3.8-flash", "x-ai/grok-4.3"]) assert.ok(asked.has(id), `${id} was asked through OpenRouter`);
    const calls = st.ledger.recent.filter((e) => e.kind === "call" && e.missionId === row.id && e.role === "answer");
    assert.equal(calls.length, 4, "every seat is in the ledger");
    assert.ok(calls.every((e) => e.provider === "openrouter" && e.cost > 0), "each seat is priced as the model it seats");
    assert.ok(st.recent.some((e) => e.type === "log" && /Council convened: Claude via OpenRouter, ChatGPT via OpenRouter, Gemini via OpenRouter, Grok via OpenRouter/.test(e.text)));
  } finally {
    await s.stop();
    await m.close();
  }
});
