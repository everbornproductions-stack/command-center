// v0.3.2: pasted keys are trimmed, provider refusals keep the provider's own words (credits vs bad
// key vs workspace), and the optional Anthropic workspace ID goes out as anthropic-workspace-id on
// every Claude request. All providers are local mocks; keys are fake and never printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-keys-");
const { explainProviderError, providerMessage, noteCall, getStatus } = await import("../server/health.js");
const { newContext, setDefaultContext } = await import("../server/store.js");
const { PROVIDERS } = await import("../server/registry.js");
setDefaultContext(newContext("key-map", { putDoc() {} }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("provider refusals are explained in plain words, with the provider's message", () => {
  const xai = { id: "xai", name: "Grok", api: "openai" }, ant = { id: "anthropic", name: "Claude", api: "anthropic" };
  let e = explainProviderError(xai, 403, { code: "forbidden", error: "Your team has either used all available credits or reached its monthly spending limit." });
  assert.equal(e.status, "amber");
  assert.match(e.detail, /^Out of credits or spending limit reached: Your team has either used all available credits/);
  e = explainProviderError(ant, 400, { type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace. Pass anthropic-workspace-id." } });
  assert.equal(e.status, "red");
  assert.match(e.detail, /^This key needs a workspace: pick or paste your Anthropic workspace ID/);
  e = explainProviderError(ant, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  assert.equal(e.detail, "Key rejected (401): invalid x-api-key");
  e = explainProviderError(ant, 400, { error: { message: "Your credit balance is too low to access the Anthropic API." } });
  assert.equal(e.status, "amber", "low balance is not a bad key");
  assert.equal(explainProviderError(xai, 429, {}).detail, "Rate or quota limit, try again in a minute");
  assert.match(explainProviderError(xai, 503, null, "<html>oops</html>").detail, /server error \(503\)$/, "HTML bodies are not shown");
  const masked = providerMessage({ error: { message: "Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ" } });
  assert.ok(!masked.includes("GHIJKLMNOP"), "key values are masked in messages");

  const xaiLive = PROVIDERS.xai;
  assert.equal(xaiLive.baseUrl, "https://api.x.ai/v1");
  assert.equal(xaiLive.links.billing, "https://console.x.ai");
  for (const word of ["credits", "spending limit", "billing", "quota", "balance"]) {
    const hit = explainProviderError(xaiLive, word === "quota" ? 402 : 403, { error: `account ${word} problem` });
    assert.equal(hit.status, "amber", word);
    assert.match(hit.detail, /^Out of credits or spending limit reached\. Top up at https:\/\/console\.x\.ai/, word);
  }
  assert.match(explainProviderError(xaiLive, 401, { error: "balance too low" }).detail, /^Key rejected \(401\)/);
  assert.match(explainProviderError(xaiLive, 400, { error: { message: "Incorrect API key provided" } }).detail, /^Key rejected \(400\)/);
  assert.equal(explainProviderError(xaiLive, 403, null, "").detail, "Key rejected (403)");
  const denied = explainProviderError(xaiLive, 403, { error: { message: "This model is not enabled for the team" } });
  assert.equal(denied.status, "red");
  assert.match(denied.detail, /^Access denied \(403\): This model is not enabled/);
  assert.equal(explainProviderError(xaiLive, 402, {}).detail, "Payment required: no credits");
  assert.equal(explainProviderError(xaiLive, 429, {}).detail, "Rate or quota limit, try again in a minute");
});

test("noteCall uses the error body, and a later success clears a stale network flag", () => {
  noteCall("xai", false, 12, { status: 403, body: { error: "Your team has either used all available credits or reached its monthly spending limit." }, message: "ignored" });
  const credits = getStatus("xai");
  assert.equal(credits.status, "amber");
  assert.match(credits.detail, /Out of credits or spending limit reached\. Top up at https:\/\/console\.x\.ai/);
  assert.match(credits.detail, /used all available credits/);
  assert.equal(credits.network, false);
  assert.doesNotMatch(credits.detail, /Key rejected/);

  noteCall("openai", false, 4, 401);
  assert.match(getStatus("openai").detail, /^Key rejected \(401\)$/);
  noteCall("openai", false, 4, { status: 400, body: { error: { message: "Incorrect API key provided" } } });
  assert.match(getStatus("openai").detail, /^Key rejected \(400\)/);
  noteCall("groq", false, 4, 403);
  assert.equal(getStatus("groq").detail, "Key rejected (403)");
  noteCall("openai", false, 4, { status: 403, text: "project is not allowed to use this model" });
  assert.match(getStatus("openai").detail, /^Access denied \(403\): project is not allowed/);
  noteCall("openai", false, 4, { status: 402, body: { error: "billing hard limit reached" } });
  assert.equal(getStatus("openai").status, "amber");
  assert.match(getStatus("openai").detail, /Top up at https:\/\/platform\.openai\.com/);

  noteCall("mistral", false, 5, 0);
  assert.equal(getStatus("mistral").network, true);
  assert.equal(getStatus("mistral").detail, "network error");
  noteCall("mistral", true, 40);
  assert.equal(getStatus("mistral").network, false);
  assert.equal(getStatus("mistral").status, "green");
  const src = fs.readFileSync(new URL("../server/health.js", import.meta.url), "utf8");
  const branch = src.slice(src.indexOf("if (!r.ok)"), src.indexOf("balanceApi"));
  assert.doesNotMatch(branch, /noteCall\(/, "a key check must not report Key rejected before the body is read");
});

async function mock() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push({ url: req.url, headers: req.headers });
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/ant/")) {
      if (req.headers["x-api-key"] !== "sk-ant-api03-fakefakefakefake") return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      if (req.headers["anthropic-workspace-id"] !== "wrkspc_test01") return send(400, { type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace. Pass anthropic-workspace-id." } });
      if (req.url.startsWith("/ant/v1/models")) return send(200, { data: [{ id: "claude-mock" }] });
      if (req.url.startsWith("/ant/v1/messages")) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
        ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "hello from mock claude" } });
        ev("content_block_stop", { index: 0 });
        ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } });
        ev("message_stop", {});
        return res.end();
      }
    }
    if (req.url.startsWith("/xai/")) return send(403, { code: "forbidden", error: "Your team has either used all available credits or reached its monthly spending limit." });
    send(404, {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

test("keys are trimmed, the Claude workspace ID is sent on checks and chats, xAI credits show as credits", async () => {
  const m = await mock();
  const s = await startServer({ env: { CC_BASE_URL_ANTHROPIC: `${m.url}/ant`, CC_BASE_URL_XAI: `${m.url}/xai/v1`, CC_STATUS_PAGES: "off", ANTHROPIC_API_KEY: "", XAI_API_KEY: "" } });
  try {
    // a key pasted with spaces and a line break still works (trimmed), and needs a workspace
    let r = await s.api("/keys", { method: "POST", body: { provider: "anthropic", key: "  sk-ant-api03-fakefakefakefake \r\n" } });
    assert.equal(r.status, 200);
    assert.match(r.json.status.detail, /^This key needs a workspace: pick or paste your Anthropic workspace ID/);
    assert.equal(m.seen.at(-1).headers["x-api-key"], "sk-ant-api03-fakefakefakefake", "trimmed before use");
    assert.ok(!JSON.stringify(r.json).includes("fakefakefake"), "the key is never sent back");

    // add the workspace ID on its own (key kept)
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "anthropic", key: "", workspaceId: "bad id!" } })).status, 400);
    r = await s.api("/keys", { method: "POST", body: { provider: "anthropic", key: "", workspaceId: " wrkspc_test01 " } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status.status, "green", JSON.stringify(r.json.status));
    assert.equal(m.seen.at(-1).headers["anthropic-workspace-id"], "wrkspc_test01");
    let st = (await s.api("/state")).json;
    assert.equal(st.providers.find((p) => p.id === "anthropic").workspaceId, "wrkspc_test01");

    // a chat with Claude carries the header too
    const model = st.providers.find((p) => p.id === "anthropic").models[0].id;
    await s.api("/chat", { method: "POST", body: { prompt: "hi", provider: "anthropic", model } });
    let msg = null;
    for (let i = 0; i < 40 && !msg; i++) { await sleep(150); msg = m.seen.find((x) => x.url.startsWith("/ant/v1/messages")); }
    assert.ok(msg, "the chat reached the mock");
    assert.equal(msg.headers["anthropic-workspace-id"], "wrkspc_test01");
    assert.equal(msg.headers["x-api-key"], "sk-ant-api03-fakefakefakefake");

    // re-saving the key keeps the workspace ID
    await s.api("/keys", { method: "POST", body: { provider: "anthropic", key: "sk-ant-api03-fakefakefakefake" } });
    assert.equal((await s.api("/state")).json.providers.find((p) => p.id === "anthropic").workspaceId, "wrkspc_test01");

    // xAI out of credits: amber with the provider's words, not "key rejected"
    r = await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } });
    assert.equal(r.json.status.status, "amber");
    assert.match(r.json.status.detail, /^Out of credits or spending limit reached\. Top up at https:\/\/console\.x\.ai/);
    assert.match(r.json.status.detail, /used all available credits/);
    assert.doesNotMatch(r.json.status.detail, /Key rejected/);
  } finally { await s.stop(); await m.close(); }
});

test("a chat 403 about credits is stored as out of credits, not Key rejected", async () => {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    seen.push(req.url);
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (String(req.url).includes("/models")) return send(200, { data: [{ id: "grok-mock" }] });
    return send(403, { code: "forbidden", error: "Your team has either used all available credits or reached its monthly spending limit." });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const KEY = "xai-chatcreditsfake0001";
  let s;
  try {
    s = await startServer({ env: { CC_BASE_URL_XAI: base, CC_STATUS_PAGES: "off", CC_HEALTH_PROBE: "off", XAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" } });
    const saved = await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } });
    assert.equal(saved.json.status.status, "green", JSON.stringify(saved.json.status));
    const model = (await s.api("/state")).json.providers.find((p) => p.id === "xai").models[0].id;
    await s.api("/chat", { method: "POST", body: { prompt: "hi", provider: "xai", model } });
    let detail = "";
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      detail = (await s.api("/state")).json.providers.find((p) => p.id === "xai").status.detail || "";
      if (/Out of credits/.test(detail)) break;
    }
    assert.match(detail, /Out of credits or spending limit reached/);
    assert.match(detail, /Top up at https:\/\/console\.x\.ai/);
    assert.doesNotMatch(detail, /Key rejected/);
    assert.equal(s.log.includes(KEY), false);
    assert.ok(seen.some((u) => String(u).includes("chat/completions")), "the chat reached the mock");
  } finally { if (s) await s.stop(); await new Promise((r) => srv.close(r)); }
});
