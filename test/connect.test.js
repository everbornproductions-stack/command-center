// API key or MCP for services that offer both. Pure checks (who is dual, route order, tool
// matching, file results, no secrets in arguments), then the running server against local mocks
// only: a Kling key and a Streamable HTTP MCP server on 127.0.0.1. The active connection runs
// the job; the other stands in when both are set up and the active one fails. Council models
// stay key-only. Onboarding, once completed, stays closed. No real provider URL or key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-connect-unit-");
const { COUNCIL_IDS, COUNCIL_NOTE, DUAL, isDual, isCouncil, routeOrder, pickTool, filesFromTool, sanitizeArgs } = await import("../server/connect.js");

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AK = "ak-test-kling-aaaa";
const SK = "sk-test-kling-bbbb";
const TOKEN = "test-token-zzzz";
const SECRETS = [AK, SK, TOKEN, `Bearer ${TOKEN}`];

test("dual services, council models, route order, tool pick, file results, argument allowlist", () => {
  for (const id of ["kling", "elevenlabs", "syncso", "fal", "replicate"]) assert.equal(isDual(id), true, id);
  for (const id of COUNCIL_IDS) { assert.equal(isCouncil(id), true); assert.equal(isDual(id), false); }
  assert.equal(isDual("suno"), false);
  assert.equal(isDual("openai"), false);
  assert.deepEqual(Object.keys(DUAL).sort(), ["elevenlabs", "fal", "kling", "replicate", "syncso"]);
  assert.deepEqual(routeOrder({ active: "key", keyOn: true, mcpOn: true }), ["key", "mcp"]);
  assert.deepEqual(routeOrder({ active: "mcp", keyOn: true, mcpOn: true }), ["mcp", "key"]);
  assert.deepEqual(routeOrder({ active: "mcp", keyOn: true, mcpOn: false }), ["key"]);
  assert.deepEqual(routeOrder({ active: "key", keyOn: false, mcpOn: true }), ["mcp"]);
  assert.deepEqual(routeOrder({ active: "key", keyOn: false, mcpOn: false }), []);
  const tools = [{ name: "clock" }, { name: "text_to_video" }, { name: "other" }];
  assert.equal(pickTool(tools, "video", ["text_to_video"]).name, "text_to_video");
  assert.equal(pickTool([{ name: "only_one" }], "video", ["text_to_video"]).name, "only_one");
  assert.equal(pickTool(tools, "nope", ["missing"]), null);
  const linked = filesFromTool({ text: JSON.stringify({ urls: ["https://cdn.example/a.mp4", "http://127.0.0.1:9/b.mp4"] }) });
  assert.deepEqual(linked.urls, ["https://cdn.example/a.mp4", "http://127.0.0.1:9/b.mp4"]);
  const data = filesFromTool({ text: "here data:image/png;base64,aGVsbG8= end" });
  assert.equal(data.mime, "image/png");
  assert.equal(data.bytes.toString(), "hello");
  assert.deepEqual(filesFromTool({ text: "see https://cdn.example/c.mp4." }).urls, ["https://cdn.example/c.mp4"]);
  assert.throws(() => filesFromTool({ text: "nothing useful" }), /did not return a file or a link/);
  assert.deepEqual(sanitizeArgs({ prompt: "a cat", key: AK, authorization: TOKEN, duration: 5, extra: "no" }), { prompt: "a cat", duration: 5 });
  assert.doesNotMatch(COUNCIL_NOTE, /\u2014/);
  assert.match(COUNCIL_NOTE, /An MCP server does not take their place there/);
});

test("UI and plan: the choice is on the cards and in guided setup; welcome email and own Supabase are planned, not in the run order", () => {
  const app = read("web", "app.js");
  const wiz = read("web", "features", "keysetup.js");
  for (const src of [app, wiz]) {
    assert.match(src, /Connect with API key/);
    assert.match(src, /Connect with MCP/);
    assert.match(src, /Test connection/);
    assert.doesNotMatch(src, /\u2014/);
  }
  assert.match(app, /An MCP server does not take their place there/);
  assert.match(wiz, /conn\?\.council/, "guided setup shows the council note from the server");
  const plan = read("docs", "BUILD-PLAN.md");
  const order = plan.split("\n").find((l) => l.startsWith("Each phase"));
  assert.match(order, /Run order: 1, 15, 16, 26, 28, 29, 25, 12, 27, 13, 17, 18, 19, 20, 21, 22, 23, 24, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 30, 31, 32, 33, 34, 35, 55, 53, 54, 56, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, then Do last: 14\b/);
  assert.doesNotMatch(order, /Welcome email|Use your own Supabase/);
  assert.match(plan, /## Planned, not in the run order/);
  assert.match(plan, /Do not start them until Chris adds them to the run order/);
  const decisions = read("docs", "DECISIONS.md");
  assert.match(decisions, /Not built yet/);
  assert.match(decisions, /Customers never need to create a Supabase account by default/);
  assert.doesNotMatch(decisions, /\u2014/);
});

// One local process: Kling's API and a Streamable HTTP MCP server. Flags flip mid-test.
async function mockBoth() {
  const state = { klingFail: true, mcpFail: false, kling: [], mcpCalls: [] };
  const sessions = new Set();
  let base = "";
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let body = ""; for await (const c of req) body += c;
    const send = (code, j, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(j)); };
    if (url.pathname === "/clip.mp4") {
      res.writeHead(200, { "content-type": "video/mp4" }); res.end(Buffer.from("fake-mp4")); return;
    }
    if (url.pathname.startsWith("/v1/videos/")) {
      state.kling.push({ method: req.method, path: url.pathname });
      if (req.method === "POST") {
        if (state.klingFail) return send(500, { code: 1, message: "nope" });
        return send(200, { code: 0, data: { task_id: "t1" } });
      }
      return send(200, { code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: `${base}/clip.mp4` }] } } });
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      const msg = JSON.parse(body || "{}");
      state.mcpCalls.push(msg.method);
      if (msg.method === "initialize") {
        const sid = "sess-" + crypto.randomBytes(3).toString("hex");
        sessions.add(sid);
        return send(200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "mock-kling-mcp", version: "0" } } }, { "mcp-session-id": sid });
      }
      if (!sessions.has(req.headers["mcp-session-id"])) return send(404, { error: "no session" });
      if (msg.id === undefined) { res.writeHead(202); return res.end(); }
      if (msg.method === "tools/list") {
        return send(200, { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "text_to_video", description: "Make a clip", inputSchema: { type: "object", properties: { prompt: { type: "string" } } } }] } });
      }
      if (msg.method === "tools/call") {
        const text = state.mcpFail ? "tool broke" : JSON.stringify({ urls: [`${base}/clip.mp4`] });
        return send(200, { jsonrpc: "2.0", id: msg.id, result: { isError: state.mcpFail, content: [{ type: "text", text }] } });
      }
      return send(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    }
    send(404, { error: "no route" });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
  return { base, state, close: () => new Promise((r) => srv.close(r)) };
}

async function waitJob(s, id, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const jobs = (await s.api("/media/jobs")).json;
    const j = jobs.find((x) => x.id === id);
    if (j && j.status !== "queued" && j.status !== "processing") return j;
    await sleep(200);
  }
  throw new Error("media job did not finish");
}

test("server: active connection, fallback, council stays on a key, onboarding stays closed, secrets stay in the vault", async () => {
  const m = await mockBoth();
  const s = await startServer({ env: { KLING_API_BASE: m.base, CC_STATUS_PAGES: "off", CC_MEDIA_POLL_MS: "80", KLING_ACCESS_KEY: "", KLING_SECRET_KEY: "" } });
  try {
    assert.equal((await s.api("/onboarding")).json.show, true, "a fresh install still offers setup once");
    assert.equal((await s.api("/setup/done", { method: "POST" })).status, 200);
    assert.equal((await s.api("/onboarding")).json.show, false);

    const view0 = await s.api("/connect");
    assert.equal(view0.status, 200);
    assert.equal(view0.json.providers.kling.both, true);
    assert.equal(view0.json.providers.kling.active, "key");
    assert.equal(view0.json.providers.anthropic.council, true);
    assert.equal(view0.json.providers.anthropic.both, false);
    assert.equal(view0.json.providers.openai.council, true);
    assert.equal(view0.json.providers.xai.council, true);
    assert.equal(view0.json.providers.google.council, true);
    assert.ok(!view0.json.providers.suno, "an API-less service is not offered as either");
    assert.match(view0.json.note, /does not take their place/);

    const st0 = (await s.api("/state")).json;
    assert.ok(st0.plugins.includes("connect"));
    assert.equal(st0.providers.find((p) => p.id === "suno").connect.both, false);
    assert.equal(st0.providers.find((p) => p.id === "kling").connect.both, true);
    const ks = (await s.api("/keysetup")).json;
    const klingStep = ks.providers.find((p) => p.id === "kling");
    assert.equal(klingStep.fields.secret, true);
    assert.equal(klingStep.connection.both, true);

    const denied = await s.api("/connect/active", { method: "POST", body: { provider: "anthropic", mode: "mcp" } });
    assert.equal(denied.status, 400);
    assert.match(denied.json.error, /does not take their place/);
    const deniedMcp = await s.api("/connect/mcp", { method: "POST", body: { provider: "openai", transport: "http", url: `${m.base}/mcp` } });
    assert.equal(deniedMcp.status, 400);
    assert.match(deniedMcp.json.error, /does not take their place/);

    const saved = await s.api("/keys", { method: "POST", body: { provider: "kling", key: AK, secret: SK } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.status.status, "green");
    const linked = await s.api("/connect/mcp", { method: "POST", body: { provider: "kling", transport: "http", url: `${m.base}/mcp`, name: "Kling MCP", headers: `Authorization: Bearer ${TOKEN}` } });
    assert.equal(linked.status, 200, JSON.stringify(linked.json));
    assert.equal(linked.json.ok, true);
    assert.ok(linked.json.tools.includes("text_to_video"));
    assert.equal(linked.json.connection.active, "mcp");
    assert.equal(linked.json.connection.mcp.configured, true);
    assert.equal(linked.json.connection.key.configured, true);

    // Back to the key. The key mock refuses, so MCP stands in. No 5s poll, because start fails at once.
    assert.equal((await s.api("/connect/active", { method: "POST", body: { provider: "kling", mode: "key" } })).json.connection.active, "key");
    const keyTest = await s.api("/connect/test", { method: "POST", body: { provider: "kling", mode: "key" } });
    assert.equal(keyTest.json.ok, true);
    assert.equal(keyTest.json.mode, "key");
    const mcpTest = await s.api("/connect/test", { method: "POST", body: { provider: "kling", mode: "mcp" } });
    assert.equal(mcpTest.json.ok, true);
    assert.match(mcpTest.json.detail, /1 tool/);

    m.state.klingFail = true; m.state.mcpFail = false;
    const est = (await s.api("/media/estimate", { method: "POST", body: { provider: "kling", kind: "video", params: { prompt: "a quiet dock at dusk", duration: 5 } } })).json;
    assert.equal(est.keyed, true); assert.equal(est.connected, true); assert.equal(est.dryRun, false);
    const refused = await s.api("/media/generate", { method: "POST", body: { provider: "kling", kind: "video", params: { prompt: "a quiet dock at dusk", duration: 5 } } });
    assert.equal(refused.status, 409); assert.equal(refused.json.code, "estimate_first");
    let gen = await s.api("/media/generate", { method: "POST", body: { provider: "kling", kind: "video", params: { prompt: "a quiet dock at dusk", duration: 5 }, estimate: est.usd } });
    assert.equal(gen.status, 202);
    let job = await waitJob(s, gen.json.id);
    assert.equal(job.status, "done", job.error || job.note);
    assert.equal(job.via, "mcp");
    assert.equal(job.fallback, true);
    assert.ok(job.outputs.length >= 1);
    assert.ok(m.state.kling.length >= 1, "the API key was tried first");
    assert.ok(m.state.mcpCalls.includes("tools/call"));

    // Active is MCP. The tool errors, so the key stands in (one poll, about 5s).
    m.state.klingFail = false; m.state.mcpFail = true;
    const klingBefore = m.state.kling.length;
    assert.equal((await s.api("/connect/active", { method: "POST", body: { provider: "kling", mode: "mcp" } })).json.connection.active, "mcp");
    assert.equal((await s.api("/connect/active", { method: "POST", body: { provider: "kling", mode: "key" } })).json.connection.active, "key");
    assert.equal((await s.api("/connect/active", { method: "POST", body: { provider: "kling", mode: "mcp" } })).json.connection.active, "mcp");
    const est2 = (await s.api("/media/estimate", { method: "POST", body: { provider: "kling", kind: "video", params: { prompt: "a second clip", duration: 5 } } })).json;
    gen = await s.api("/media/generate", { method: "POST", body: { provider: "kling", kind: "video", params: { prompt: "a second clip", duration: 5 }, estimate: est2.usd } });
    job = await waitJob(s, gen.json.id);
    assert.equal(job.status, "done", job.error || job.note);
    assert.equal(job.via, "key");
    assert.equal(job.fallback, true);
    assert.ok(m.state.kling.length > klingBefore);

    assert.equal((await s.api("/onboarding")).json.show, false, "connecting a key or an MCP server does not open setup again");
    const progress = JSON.parse(fs.readFileSync(path.join(s.dir, "keysetup.state.json"), "utf8"));
    assert.ok(progress.linked.includes("kling"));

    const dumped = [
      JSON.stringify(await s.api("/connect")),
      JSON.stringify(await s.api("/state")),
      JSON.stringify(await s.api("/keysetup")),
      JSON.stringify(await s.api("/tools")),
      JSON.stringify(await s.api("/media/jobs")),
      s.log,
      fs.readFileSync(path.join(s.dir, "connect.choice.json"), "utf8"),
      fs.existsSync(path.join(s.dir, "keysetup.state.json")) ? fs.readFileSync(path.join(s.dir, "keysetup.state.json"), "utf8") : "",
    ].join("\n");
    for (const secret of SECRETS) assert.ok(!dumped.includes(secret), "secret never leaves the vault");
  } finally { await s.stop(); await m.close(); }
});
