// v0.3.1: Google Gemini as a first-class provider, custom providers (OpenAI / Anthropic compatible),
// key-prefix suggestions, demo mode retiring itself once a real key works, clear network vs key
// errors, and the desktop app never attaching to a foreign server on its port. Every provider URL
// points at a local mock; no test talks to a real API and no real key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer, freePort, tmpDir, ROOT } from "./helpers.js";

const require = createRequire(import.meta.url);
const GOOD_GEMINI = "AIzaFAKEfakeFAKEfakeFAKEfake0123456789";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One local mock: Google's native models list, and an OpenAI-compatible API that wants a header.
async function startMock() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/gemini/v1beta/models")) {
      if (req.headers["x-goog-api-key"] !== GOOD_GEMINI) return send(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
      return send(200, { models: [{ name: "models/gemini-4-argon" }, { name: "models/gemini-3.8-flash" }] });
    }
    if (req.url.startsWith("/oai/")) {
      if (req.headers.authorization !== "Bearer fake-custom-key") return send(401, { error: "bad key" });
      if (req.headers["x-org"] !== "42") return send(403, { error: "missing org header" });
      if (req.url === "/oai/models") return send(200, { data: [{ id: "mock-1" }, { id: "mock-2" }] });
      if (req.url === "/oai/chat/completions") {
        let b = ""; for await (const c of req) b += c;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hello from the custom provider" }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
    }
    if (req.url === "/local/models") return send(200, { data: [{ id: "llama3.2" }] }); // Ollama style, no key
    send(404, { error: "not found" });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { url, seen, close: () => new Promise((r) => srv.close(r)) };
}

const closedPort = async () => freePort(); // free = nothing listening = connection refused

test("key prefixes suggest the right provider", async () => {
  process.env.CC_DATA_DIR = tmpDir(); // keep module side effects out of the repo
  const { suggestProvider } = await import("../server/plugins/providers.js");
  assert.equal(suggestProvider(GOOD_GEMINI).provider, "google");
  assert.equal(suggestProvider(GOOD_GEMINI).name, "Google Gemini");
  assert.equal(suggestProvider("sk-ant-api03-abcdefghijklmnop").provider, "anthropic");
  assert.equal(suggestProvider("xai-abcdefghijklmnopqrstuvwxyz").provider, "xai");
  assert.equal(suggestProvider("sk-or-v1-abcdef").provider, "openrouter");
  assert.equal(suggestProvider("gsk_abcdefghijklmnop").provider, "groq");
  assert.equal(suggestProvider("sk-proj-abcdefghijklmnopqrstuv").provider, "openai");
  assert.equal(suggestProvider("tgp_v1_abc").provider, "together");
  assert.equal(suggestProvider("sk-proj-abcdefghijklmnopqrstuv").confidence, "high");
  assert.equal(suggestProvider("sk-abcdefghijklmnopqrstuvwxyz12").confidence, "low", "a bare sk- key is only a guess");
  assert.equal(suggestProvider("hello"), null);
  assert.equal(suggestProvider(""), null);
});

test("network errors name the cause instead of 'fetch failed'", async () => {
  const { networkCause } = await import("../server/health.js");
  assert.equal(networkCause(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), "connection refused");
  assert.match(networkCause(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND", hostname: "api.x.ai" } })), /DNS.*api\.x\.ai/);
  assert.match(networkCause(Object.assign(new TypeError("fetch failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } })), /proxy or antivirus/);
  assert.equal(networkCause(Object.assign(new Error("x"), { name: "AbortError" })), "timed out");
});

test("desktop app: never attaches to a foreign server on its port (v0.3.0 bug)", async () => {
  const { pickFreePort, isFree, isOurServer } = require("../electron/ports.cjs");
  // something else (a dev copy of the server) holds the preferred port
  const busy = http.createServer((q, r) => r.end(JSON.stringify({ ok: true, mode: "local", version: "0.1.0" })));
  await new Promise((r) => busy.listen(0, "127.0.0.1", r));
  const taken = busy.address().port;
  try {
    assert.equal(await isFree(taken), false);
    const p = await pickFreePort(taken);
    assert.notEqual(p, taken, "a busy port is skipped");
    assert.equal(await isFree(p), true);
    assert.equal(isOurServer({ ok: true, mode: "local", version: "0.1.0" }, "abc"), false, "an old server without our instance id is not ours");
    assert.equal(isOurServer({ ok: true, app: "command-ai", instance: "other" }, "abc"), false);
    assert.equal(isOurServer({ ok: true, app: "command-ai", instance: "abc" }, "abc"), true);
  } finally { busy.close(); }
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  assert.doesNotMatch(main, /Just use it/, "the old attach-to-anything shortcut is gone");
  assert.match(main, /pickFreePort\(PREFERRED_PORT\)/);
});

test("Google Gemini card, bad key vs good key vs unreachable, demo retires, demo runs tagged", async () => {
  const mock = await startMock();
  const dead = await closedPort();
  const s = await startServer({
    env: { CC_BASE_URL_GOOGLE: `${mock.url}/gemini/v1beta/openai`, CC_BASE_URL_XAI: `http://127.0.0.1:${dead}/v1`, CC_STATUS_PAGES: "off", GEMINI_API_KEY: "", XAI_API_KEY: "" },
    seed: (dir) => {
      fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
      fs.writeFileSync(path.join(dir, "missions", "s-old.json"), JSON.stringify({ id: "s-old", kind: "single", prompt: "an old demo chat", status: "done", startedAt: Date.now() - 60000, finishedAt: Date.now() - 59000, provider: "demo-nova", model: "nova-ultra", cost: 0.01, deliverable: "demo text" }));
      fs.writeFileSync(path.join(dir, "ledger.jsonl"), JSON.stringify({ ts: Date.now() - 60000, kind: "call", provider: "demo-nova", model: "nova-ultra", inTok: 10, outTok: 10, cost: 0.5, exact: false }) + "\n");
    },
  });
  try {
    let st = (await s.api("/state")).json;
    const g = st.providers.find((p) => p.id === "google");
    assert.equal(g.name, "Google Gemini");
    assert.equal(g.links.keys, "https://aistudio.google.com/apikey");
    assert.ok(g.models.some((m) => /pro|argon/i.test(m.id) && m.default), "a Pro-class default");
    assert.ok(g.models.some((m) => /flash/.test(m.id)), "a Flash model");
    assert.ok(g.models.every((m) => m.in > 0 && m.out > 0), "ledger pricing for every Gemini model");

    // demo on: the three pretend AIs appear
    await s.api("/demo", { method: "POST", body: { on: true } });
    st = (await s.api("/state")).json;
    assert.equal(st.demo, true);
    assert.ok(st.providers.some((p) => p.id === "demo-nova"));

    // a rejected key is reported as a key problem and does not retire demo
    let r = await s.api("/keys", { method: "POST", body: { provider: "google", key: "AIzaWRONGwrongWRONGwrongWRONG0000" } });
    assert.equal(r.json.status.status, "red");
    assert.match(r.json.status.detail, /Key rejected \(40[01]\): API key not valid/);
    assert.equal(r.json.demoRetired, false);

    // a saved key the probe could not reach still counts, so demo retires
    r = await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } });
    assert.match(r.json.status.detail, /^Could not reach .+: connection refused/);
    assert.doesNotMatch(r.json.status.detail, /fetch failed/);
    assert.equal(r.json.demoRetired, true, "a saved key hides demo AIs even when the probe cannot connect");
    await s.api("/keys/xai", { method: "DELETE" });
    st = (await s.api("/state")).json;
    assert.equal(st.demo, true, "removing that key brings the demo AIs back");

    // the key goes in the header, not the URL
    r = await s.api("/keys", { method: "POST", body: { provider: "google", key: GOOD_GEMINI } });
    assert.notEqual(r.json.status.status, "red", JSON.stringify(r.json.status));
    assert.ok(mock.seen.some((x) => x.url.startsWith("/gemini/v1beta/models") && !x.url.includes("key=")));
    assert.equal(r.json.demoRetired, true, "first real validated key switches demo off");

    st = (await s.api("/state")).json;
    assert.equal(st.demo, false);
    assert.equal(st.settings.demo, false);
    assert.equal(st.settings.demoNotice, true, "the UI shows the one-time toast");
    assert.ok(!st.providers.some((p) => p.demo || p.id.startsWith("demo-")), "demo AIs gone from every provider list");
    assert.ok(!Object.keys(st.ledger.byProvider).some((k) => k.startsWith("demo-")), "and from ledger filters");
    assert.equal(st.ledger.month, 0, "pretend demo spend leaves the totals");
    assert.ok(st.ledger.recent.some((e) => e.provider === "demo-nova" && e.demo === true), "past demo calls stay, tagged demo");
    const old = st.missions.find((m) => m.id === "s-old");
    assert.ok(old, "past demo chats are kept");
    assert.equal(old.demo, true, "and tagged demo");
    const live = st.providers.find((p) => p.id === "google").liveModels;
    assert.ok(live.includes("gemini-4-argon"), "model discovery from the Gemini models list");

    await s.api("/demo/ack", { method: "POST" });
    assert.equal((await s.api("/state")).json.settings.demoNotice, false, "toast shows once");

    // the user can turn demo back on, and it stays on even though a real key exists
    await s.api("/demo", { method: "POST", body: { on: true } });
    r = await s.api("/keys", { method: "POST", body: { provider: "google", key: GOOD_GEMINI } });
    assert.equal(r.json.demoRetired, false);
    st = (await s.api("/state")).json;
    assert.equal(st.demo, true);
    assert.ok(st.providers.some((p) => p.id === "demo-nova"));
    await s.api("/demo", { method: "POST", body: { on: false } });
  } finally { await s.stop(); await mock.close(); }
});

test("custom provider: presets, discovery with extra headers, chat, edit, delete; custom key retires demo", async () => {
  const mock = await startMock();
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    const pre = (await s.api("/providers/presets")).json.presets;
    for (const n of ["openrouter", "groq", "together", "fireworks", "deepseek", "mistral", "perplexity", "ollama", "lmstudio"]) assert.ok(pre.some((p) => p.id === n), n);
    const ol = pre.find((p) => p.id === "ollama");
    assert.equal(ol.baseUrl, "http://localhost:11434/v1"); assert.equal(ol.noKey, true);
    assert.equal(pre.find((p) => p.id === "openrouter").builtin, "openrouter", "built-in providers point at their card");

    assert.equal((await s.api("/providers/suggest", { method: "POST", body: { key: GOOD_GEMINI } })).json.suggestion.provider, "google");

    await s.api("/demo", { method: "POST", body: { on: true } });

    // validation
    assert.equal((await s.api("/providers/custom", { method: "POST", body: { name: "", baseUrl: "x" } })).status, 400);
    assert.equal((await s.api("/providers/custom", { method: "POST", body: { name: "X", baseUrl: "http://example.com/v1", key: "k", models: "a" } })).status, 400, "plain http only for this PC");
    const noHdr = await s.api("/providers/custom", { method: "POST", body: { name: "Mock", baseUrl: `${mock.url}/oai`, key: "fake-custom-key" } });
    assert.equal(noHdr.status, 400, "discovery fails without the required header");
    assert.match(noHdr.json.error, /Type the model names/);

    // discovery then save, with an extra header kept as a secret
    const d = await s.api("/providers/discover", { method: "POST", body: { baseUrl: `${mock.url}/oai`, key: "fake-custom-key", headers: { "X-Org": "42" } } });
    assert.deepEqual(d.json.models, ["mock-1", "mock-2"]);
    const c = await s.api("/providers/custom", { method: "POST", body: { name: "Mock Gateway", baseUrl: `${mock.url}/oai/`, api: "openai", key: "fake-custom-key", headers: [{ name: "X-Org", value: "42" }] } });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const id = c.json.provider.id;
    assert.match(id, /^c-mock-gateway-/);
    assert.deepEqual(c.json.provider.models, ["mock-1", "mock-2"]);
    assert.deepEqual(c.json.provider.headerNames, ["X-Org"]);
    assert.equal(c.json.provider.baseUrl, `${mock.url}/oai`);
    assert.notEqual(c.json.status.status, "red", JSON.stringify(c.json.status));
    assert.equal(c.json.demoRetired, true, "a working custom provider also retires demo");
    assert.ok(!JSON.stringify(c.json).includes("fake-custom-key"), "the key never comes back");
    const docText = fs.readFileSync(path.join(s.dir, "providers.custom.json"), "utf8");
    assert.ok(!docText.includes("fake-custom-key") && !docText.includes('"42"'), "key and header values live in the vault, not the document");

    let st = (await s.api("/state")).json;
    const cp = st.providers.find((p) => p.id === id);
    assert.ok(cp && cp.custom && cp.kind === "text");
    assert.equal(cp.keyed, true);
    assert.ok(!st.providers.some((p) => p.id.startsWith("demo-")));

    // it is usable like any other AI: a direct chat goes through the mock with the header
    await s.api("/chat", { method: "POST", body: { prompt: "say hi", provider: id, model: "mock-1" } });
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) { await sleep(150); hit = (await s.api("/state")).json.ledger.recent.find((e) => e.provider === id); }
    assert.ok(hit, "the call reached the ledger");
    assert.ok(mock.seen.some((x) => x.url === "/oai/chat/completions" && x.headers["x-org"] === "42" && x.headers.authorization === "Bearer fake-custom-key"));
    await s.api("/pricing", { method: "POST", body: { model: "mock-1", in: 1, out: 2 } });
    assert.equal((await s.api("/state")).json.providers.find((p) => p.id === id).models.find((m) => m.id === "mock-1").in, 1, "prices are editable");

    // edit: rename and trim the models; key and headers are kept when left empty
    const e = await s.api("/providers/custom", { method: "POST", body: { id, name: "Mock Gateway 2", baseUrl: `${mock.url}/oai`, models: "mock-2" } });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    assert.deepEqual(e.json.provider.models, ["mock-2"]);
    assert.deepEqual(e.json.provider.headerNames, ["X-Org"]);
    assert.notEqual(e.json.status.status, "red");

    // survives a restart (registered at boot)
    // no-key local provider (Ollama / LM Studio style)
    const l = await s.api("/providers/custom", { method: "POST", body: { name: "Local", baseUrl: `${mock.url}/local`, noKey: true } });
    assert.equal(l.status, 200, JSON.stringify(l.json));
    assert.deepEqual(l.json.provider.models, ["llama3.2"]);
    assert.ok(!mock.seen.filter((x) => x.url === "/local/models").some((x) => x.headers.authorization), "no Authorization header without a key");

    // delete
    assert.equal((await s.api(`/providers/custom/${id}`, { method: "DELETE" })).status, 200);
    st = (await s.api("/state")).json;
    assert.ok(!st.providers.some((p) => p.id === id));
    assert.ok(!(await s.api("/providers/custom")).json.custom.some((x) => x.id === id));
    assert.equal((await s.api(`/providers/custom/${id}`, { method: "DELETE" })).status, 404);
  } finally { await s.stop(); await mock.close(); }
});

test("custom providers load again after a restart", async () => {
  const mock = await startMock();
  const dir = tmpDir();
  let s = await startServer({ dataDir: dir, env: { CC_STATUS_PAGES: "off" } });
  let id;
  try {
    const c = await s.api("/providers/custom", { method: "POST", body: { name: "Keeper", baseUrl: `${mock.url}/local`, noKey: true } });
    id = c.json.provider.id;
  } finally { s.child.kill(); await new Promise((r) => { s.child.once("exit", r); setTimeout(r, 2000); }); await s.stub.close(); }
  s = await startServer({ dataDir: dir, env: { CC_STATUS_PAGES: "off" } });
  try {
    const st = (await s.api("/state")).json;
    assert.ok(st.providers.some((p) => p.id === id && p.custom && p.models.some((m) => m.id === "llama3.2")));
  } finally { await s.stop(); await mock.close(); }
});
