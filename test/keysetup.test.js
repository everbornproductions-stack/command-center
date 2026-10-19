// Phase 1: guided API-key setup. Pure checks on the guides, the order and the verdict, then the
// running server against local mock providers: a rejected key is never kept (the old one is put
// back), a working key is sealed, an out-of-credits key is kept as amber, an unreachable provider
// keeps nothing, and the key value never appears in a response or in the server log.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-keysetup-");
const { GUIDES, setupOrder, verdict, DEFAULTS } = await import("../server/plugins/keysetup.js");
const { PROVIDERS } = await import("../server/registry.js");

test("guides: every built-in provider with an API has steps, a key shape and https links; no em-dashes", () => {
  for (const p of Object.values(PROVIDERS)) {
    if (!p.api || p.demo) continue;
    const g = GUIDES[p.id];
    assert.ok(g, `guide for ${p.id}`);
    assert.ok(g.steps.length >= 3, `${p.id} has at least three steps`);
    assert.ok(g.why && g.looks, `${p.id} has why and looks`);
    assert.ok(/^https:\/\//.test(p.links.keys || p.links.console), `${p.id} key page is https`);
    for (const s of [g.why, g.looks, ...g.steps]) assert.doesNotMatch(s, /—/, "no em-dashes");
  }
  assert.equal(DEFAULTS.completedAt, null);
});

test("setupOrder: text providers first, free tiers before paid, media last, demo and no-key skipped", () => {
  const order = setupOrder({
    ...PROVIDERS,
    "demo-nova": { id: "demo-nova", kind: "text", api: "openai", demo: true },
    ollama: { id: "ollama", kind: "text", api: "openai", custom: true, noKey: true },
    mine: { id: "mine", kind: "text", api: "openai", custom: true },
  });
  assert.ok(!order.includes("demo-nova") && !order.includes("ollama") && !order.includes("suno"), "demo, no-key and API-less providers are not steps");
  assert.ok(order.indexOf("google") < order.indexOf("anthropic"), "free tier first");
  assert.ok(order.indexOf("anthropic") < order.indexOf("mine"), "custom after the built-ins");
  assert.ok(order.indexOf("mine") < order.indexOf("elevenlabs"), "media last");
  assert.equal(order.length, new Set(order).size);
});

test("verdict: green and amber keep the key; rejected, unreachable and unchecked do not", () => {
  assert.deepEqual(verdict({ status: "green" }), { ok: true, keep: true, label: "Key works", tone: "green" });
  assert.equal(verdict({ status: "amber", detail: "low balance" }).keep, true);
  assert.equal(verdict({ status: "red", detail: "Key rejected (401)" }).label, "Key rejected");
  assert.equal(verdict({ status: "red", network: true }).label, "Could not reach the provider");
  assert.equal(verdict({ status: "red", network: true }).keep, false);
  assert.equal(verdict({ status: "grey" }).keep, false);
  assert.equal(verdict(null).keep, false);
});

const GOOD = "sk-ant-api03-goodgoodgoodgood", OLD = "sk-ant-api03-oldoldoldoldold", BAD = "sk-ant-api03-badbadbadbadbad";
async function mock() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    seen.push({ url: req.url, headers: req.headers });
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url.startsWith("/ant/")) {
      if (![GOOD, OLD].includes(req.headers["x-api-key"])) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      return send(200, { data: [{ id: "claude-mock" }] });
    }
    if (req.url.startsWith("/xai/")) return send(403, { code: "forbidden", error: "Your team has either used all available credits or reached its monthly spending limit." });
    send(404, {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}

test("server: list, rejected key not kept (old key restored), working key sealed, credits → amber kept, unreachable → nothing kept, progress persists, key never leaks", async () => {
  const m = await mock();
  // Groq is pointed at a port nothing listens on: "Could not reach"
  const s = await startServer({ env: { CC_BASE_URL_ANTHROPIC: `${m.url}/ant`, CC_BASE_URL_XAI: `${m.url}/xai/v1`, CC_BASE_URL_GROQ: "http://127.0.0.1:9/v1", CC_STATUS_PAGES: "off", ANTHROPIC_API_KEY: "", XAI_API_KEY: "", GROQ_API_KEY: "" } });
  try {
    assert.equal((await s.api("/keysetup", { noToken: true })).status, 401);
    let g = await s.api("/keysetup");
    assert.equal(g.status, 200);
    assert.equal(g.json.startedAt, null); assert.equal(g.json.linkedCount, 0);
    assert.ok(g.json.total >= 9, `walks through the built-in providers (${g.json.total})`);
    const ant = g.json.providers.find((p) => p.id === "anthropic");
    assert.equal(ant.keyed, false); assert.equal(ant.fields.workspaceId, true); assert.ok(ant.steps.length >= 3); assert.match(ant.keysUrl, /^https:\/\//);
    assert.equal(g.json.providers.find((p) => p.id === "kling").fields.secret, true);
    assert.ok(!g.json.providers.some((p) => p.id.startsWith("demo-")), "demo AIs are never a step");
    assert.ok(g.json.vault && typeof g.json.vault.method === "string");

    // validation
    assert.equal((await s.api("/keysetup/save", { method: "POST", body: { provider: "nope", key: "x" } })).status, 400);
    assert.equal((await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: "   " } })).status, 400);
    assert.equal((await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: "has a space" } })).status, 400);
    assert.equal((await s.api("/keysetup/save", { method: "POST", body: { provider: "suno", key: "x" } })).status, 400, "no API, nothing to set up");
    assert.equal((await s.api("/keysetup/save", { method: "POST", body: { provider: "kling", key: "ak" } })).status, 400, "kling needs the secret too");
    assert.equal((await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: GOOD, workspaceId: "bad id!" } })).status, 400);

    // a rejected key with nothing saved before: nothing kept
    let r = await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: BAD } });
    assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.kept, false);
    assert.equal(r.json.verdict.label, "Key rejected"); assert.match(r.json.status.detail, /^Key rejected \(401\)/);
    assert.equal(r.json.masked, null, "nothing in the vault");
    let st = (await s.api("/state")).json;
    assert.equal(st.providers.find((p) => p.id === "anthropic").keyed, false);
    assert.equal(st.providers.find((p) => p.id === "anthropic").status.status, "grey", "status went back to no key");

    // a working key: test call, then the vault (with the workspace ID kept)
    r = await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: OLD, workspaceId: "wrkspc_01" } });
    assert.equal(r.json.ok, true); assert.equal(r.json.kept, true); assert.equal(r.json.verdict.tone, "green");
    assert.equal(r.json.masked, `${OLD.slice(0, 4)}…${OLD.slice(-4)}`);
    assert.equal(m.seen.at(-1).headers["anthropic-workspace-id"], "wrkspc_01");
    st = (await s.api("/state")).json;
    assert.equal(st.providers.find((p) => p.id === "anthropic").keyed, true);
    assert.equal(st.providers.find((p) => p.id === "anthropic").status.status, "green");
    g = (await s.api("/keysetup")).json;
    assert.deepEqual(g.linked, ["anthropic"]); assert.equal(g.linkedCount, 1);
    assert.equal(g.providers.find((p) => p.id === "anthropic").keyed, true);

    // a rejected replacement puts the old key back, untouched
    const before = fs.statSync(path.join(s.dir, "vault.bin")).size;
    r = await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: BAD } });
    assert.equal(r.json.kept, false); assert.equal(r.json.masked, `${OLD.slice(0, 4)}…${OLD.slice(-4)}`, "the old key is still there");
    st = (await s.api("/state")).json;
    assert.equal(st.providers.find((p) => p.id === "anthropic").status.status, "green", "re-checked with the restored key");
    assert.equal(st.providers.find((p) => p.id === "anthropic").workspaceId, "wrkspc_01", "the workspace ID survived");
    assert.equal(fs.statSync(path.join(s.dir, "vault.bin")).size, before);
    // and a good replacement replaces it
    r = await s.api("/keysetup/save", { method: "POST", body: { provider: "anthropic", key: GOOD } });
    assert.equal(r.json.kept, true); assert.equal(r.json.masked, `${GOOD.slice(0, 4)}…${GOOD.slice(-4)}`);
    assert.equal(m.seen.at(-1).headers["x-api-key"], GOOD);
    assert.equal(m.seen.at(-1).headers["anthropic-workspace-id"], "wrkspc_01", "replacing the key keeps the workspace ID");

    // out of credits: the key is real, so it is kept, amber, with the billing link
    r = await s.api("/keysetup/save", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } });
    assert.equal(r.json.ok, true); assert.equal(r.json.kept, true); assert.equal(r.json.verdict.tone, "amber");
    assert.match(r.json.status.detail, /^Out of credits or spending limit reached/);
    assert.match(r.json.billingUrl, /^https:\/\/console\.x\.ai/);
    assert.equal((await s.api("/state")).json.providers.find((p) => p.id === "xai").keyed, true);

    // unreachable: nothing kept, clear words
    r = await s.api("/keysetup/save", { method: "POST", body: { provider: "groq", key: "gsk_fakefakefakefakefake" } });
    assert.equal(r.json.ok, false); assert.equal(r.json.kept, false);
    assert.equal(r.json.verdict.label, "Could not reach the provider"); assert.match(r.json.status.detail, /^Could not reach Groq: /);
    assert.equal((await s.api("/state")).json.providers.find((p) => p.id === "groq").keyed, false);

    // skip, complete, reset persist in the data dir
    r = await s.api("/keysetup/skip", { method: "POST", body: { provider: "mistral" } });
    assert.deepEqual(r.json.skipped, ["mistral"]); assert.equal(r.json.providers.find((p) => p.id === "mistral").skipped, true);
    assert.equal((await s.api("/keysetup/skip", { method: "POST", body: { provider: "nope" } })).status, 400);
    r = await s.api("/keysetup/complete", { method: "POST" });
    assert.ok(r.json.completedAt > 0);
    const file = path.join(s.dir, "keysetup.state.json");
    assert.ok(fs.existsSync(file), "keysetup.state.json written in the temp data dir");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(saved.linked.sort(), ["anthropic", "xai"]); assert.deepEqual(saved.skipped, ["mistral"]);
    r = await s.api("/keysetup/reset", { method: "POST" });
    assert.equal(r.json.completedAt, null); assert.deepEqual(r.json.skipped, []); assert.equal(r.json.linkedCount, 2, "reset forgets progress, not keys");
    assert.equal((await s.api("/keysetup/nothing", { method: "POST" })).status, 404);
    assert.ok((await s.api("/state")).json.plugins.includes("keysetup"));

    // the key values never leave the server except to the provider
    const everything = JSON.stringify(await s.api("/keysetup")) + JSON.stringify(await s.api("/state")) + s.log + fs.readFileSync(file, "utf8");
    for (const k of [GOOD, OLD, BAD, "xai-fakefakefakefakefake", "gsk_fakefakefakefakefake"]) assert.ok(!everything.includes(k), "key never in a response, the log or the progress file");
    assert.ok(!everything.includes("goodgoodgood") && !everything.includes("oldoldold"), "not even a fragment");
  } finally { await s.stop(); await m.close(); }
});
