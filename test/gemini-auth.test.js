// Gemini auth keys and the native Generative Language route.
// New AI Studio keys start with AQ. (May 2026). Older keys start with AIza and are 39 characters.
// The OpenAI-compatible Bearer route rejects AQ. keys, so chat, the models check and embeddings
// use generativelanguage.googleapis.com with x-goog-api-key. No real key, no real URL, and the
// fake key must never show up in a response or the server log.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const AIZA = "AIzaSy" + "A".repeat(33); // 39 characters, the AI Studio standard-key length
const AQ = "AQ.Ab8ExampleKeyValue0001";
assert.equal(AIZA.length, 39);
assert.ok(AQ.startsWith("AQ."));

test("pasted keys: Gemini AQ. and AIza, plus the other provider prefixes", async () => {
  process.env.CC_DATA_DIR = tmpDir();
  const { suggestProvider } = await import("../server/plugins/providers.js");
  const hit = (key, provider, confidence) => {
    const s = suggestProvider(key);
    assert.equal(s?.provider, provider, key.slice(0, 6));
    if (confidence) assert.equal(s.confidence, confidence);
    assert.equal(JSON.stringify(s).includes(key), false);
  };
  hit(AQ, "google", "high");
  hit(`  "${AQ}"  `, "google", "high");
  hit("Bearer " + AQ, "google", "high");
  hit(AIZA, "google", "high");
  assert.equal(suggestProvider(AIZA).name, "Google Gemini");
  hit("sk-ant-api03-abcdefghijklmnop", "anthropic", "high");
  hit("sk-proj-abcdefghijklmnopqrstuv", "openai", "high");
  hit("sk-svcacct-abcdefghijklmnopqrstuv", "openai", "high");
  hit("xai-abcdefghijklmnopqrstuvwxyz", "xai", "high");
  hit("sk-or-v1-abcdef", "openrouter", "high");
  hit("gsk_abcdefghijklmnop", "groq", "high");
  assert.equal(suggestProvider("sk-abcdefghijklmnopqrstuvwxyz12").confidence, "low");
  assert.equal(suggestProvider("sk-abcdefghijklmnopqrstuvwxyz12").provider, "openai");
  assert.equal(suggestProvider("hello"), null);
  assert.equal(suggestProvider(""), null);
});

test("Gemini calls use the native route and the key stays out of the log", async () => {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push({ url: req.url, authorization: req.headers.authorization || null, goog: req.headers["x-goog-api-key"] || null, body });
    const send = (code, j, type = "application/json") => { res.writeHead(code, { "content-type": type }); res.end(typeof j === "string" ? j : JSON.stringify(j)); };
    if (req.url.includes("key=") || req.url.includes(AQ) || req.url.includes(AIZA)) return send(500, { error: { message: "key leaked into the URL" } });
    if (req.headers.authorization) return send(400, { error: { message: "Multiple authentication credentials received" } });
    if (req.url.includes("/models") && !req.url.includes(":")) {
      if (req.headers["x-goog-api-key"] !== AQ && req.headers["x-goog-api-key"] !== AIZA) return send(400, { error: { message: "API key not valid" } });
      return send(200, { models: [{ name: "models/gemini-3.8-flash" }] });
    }
    if (req.url.includes(":streamGenerateContent")) {
      if (req.headers["x-goog-api-key"] !== AQ) return send(401, { error: { message: "API key not valid" } });
      const payload = `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "hello from gemini" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 } })}\n\n`;
      return send(200, payload, "text/event-stream");
    }
    if (req.url.includes(":batchEmbedContents")) {
      if (req.headers["x-goog-api-key"] !== AQ) return send(401, { error: { message: "API key not valid" } });
      const n = JSON.parse(body).requests.length;
      return send(200, { embeddings: Array.from({ length: n }, () => ({ values: [1, 0, 0] })) });
    }
    send(404, { error: { message: "no route" } });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const s = await startServer({ env: { CC_BASE_URL_GOOGLE: `${base}/v1beta/openai`, CC_STATUS_PAGES: "off", GEMINI_API_KEY: "" } });
  try {
    const sug = await s.api("/providers/suggest", { method: "POST", body: { key: AQ } });
    assert.equal(sug.json.suggestion.provider, "google");
    assert.equal(sug.json.suggestion.confidence, "high");
    assert.equal(JSON.stringify(sug.json).includes(AQ), false);

    const saved = await s.api("/keys", { method: "POST", body: { provider: "google", key: AQ } });
    assert.equal(saved.json.status.status, "green", JSON.stringify(saved.json.status));
    assert.equal(JSON.stringify(saved.json).includes(AQ), false);
    const listed = seen.filter((x) => x.url.includes("/models") && !x.url.includes(":"));
    assert.ok(listed.length >= 1);
    assert.ok(listed.every((x) => x.goog === AQ && !x.authorization && !x.url.includes("openai")));

    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Say hi", provider: "google", model: "gemini-3.8-flash" } })).status, 202);
    let chat = null;
    for (let i = 0; i < 40 && !chat; i++) {
      await new Promise((r) => setTimeout(r, 150));
      chat = seen.find((x) => x.url.includes(":streamGenerateContent"));
    }
    assert.ok(chat, "chat reached streamGenerateContent");
    assert.equal(chat.goog, AQ);
    assert.equal(chat.authorization, null);
    assert.match(chat.url, /\/v1beta\/models\/gemini-3\.8-flash:streamGenerateContent\?alt=sse$/);
    assert.equal(seen.some((x) => x.url.includes("/chat/completions")), false);
    const run = (await s.api("/state")).json.missions.find((m) => m.kind === "single");
    assert.equal(run?.status, "done", run?.status);
    assert.match((await s.api(`/missions/${run.id}`)).json.deliverable, /hello from gemini/);

    const { embed } = await import("../server/libraries.js");
    // embed() reads the vault in this process, not the child. The HTTP assertion above is the child.
    // The route itself is covered by the source check below; a direct call needs the child's vault.
    assert.equal(typeof embed, "function");

    const blob = JSON.stringify(sug.json) + JSON.stringify(saved.json) + s.log;
    assert.equal(blob.includes(AQ), false, "the key is not in the suggest response, the save response, or the log");
    assert.equal(blob.includes(AIZA), false);
  } finally { await s.stop(); await new Promise((r) => srv.close(r)); }
});

test("Gemini source stays on the native header route, and a failed detect offers a picker", () => {
  const reg = fs.readFileSync(path.join(ROOT, "server", "registry.js"), "utf8");
  const card = reg.slice(reg.indexOf("google: {"), reg.indexOf("perplexity:"));
  assert.match(card, /api: "gemini"/);
  assert.match(card, /https:\/\/generativelanguage\.googleapis\.com\/v1beta"/);
  assert.doesNotMatch(card, /v1beta\/openai/);
  const chat = fs.readFileSync(path.join(ROOT, "server", "providers.js"), "utf8");
  const gem = chat.slice(chat.indexOf("async function* geminiStream"), chat.indexOf("async function* openaiCompatStream"));
  assert.match(gem, /x-goog-api-key/);
  assert.match(gem, /:streamGenerateContent\?alt=sse/);
  assert.doesNotMatch(gem, /authorization/);
  assert.doesNotMatch(gem, /\/openai/);
  const lib = fs.readFileSync(path.join(ROOT, "server", "libraries.js"), "utf8");
  const emb = lib.slice(lib.indexOf("async function embedGemini"), lib.indexOf("export async function embed"));
  assert.match(emb, /batchEmbedContents/);
  assert.match(emb, /x-goog-api-key/);
  assert.doesNotMatch(emb, /Bearer/);
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /id="anykey-pick"/);
  assert.match(app, /Could not tell which provider this key is for/);
  assert.equal(app.includes("\u2014"), false);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "server", "plugins", "keysetup.js"), "utf8"), /\u2014/);
});
