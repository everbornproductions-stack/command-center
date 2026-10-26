// 0.4.21 (Chris note 8): pictures and video in chat use any connected maker, switch to another when the first fails,
// and with none connected say BEFORE sending which key to add. Never a placeholder as the result.
// Mock servers and fake keys only. No real network, no real account.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, tmpDir, freePort } from "./helpers.js";

const DIR = tmpDir("cc-mswitch-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "REPLICATE_API_TOKEN", "FAL_KEY", "KLING_ACCESS_KEY", "RUNWAY_API_KEY", "ELEVENLABS_API_KEY"];
for (const k of KEYS) delete process.env[k];
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const MS = await import("../server/media-switch.js");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("setupMessage: one plain step with the key name and where it goes, no em-dashes", () => {
  assert.match(MS.setupMessage("image"), /^Add your fal\.ai key in Settings > Media to make pictures\./);
  assert.match(MS.setupMessage("image"), /OpenAI, Google Gemini or xAI in Settings > AI keys/);
  assert.match(MS.setupMessage("video"), /^Add your Kling key in Settings > Media to make video\./);
  assert.match(MS.setupMessage("audio"), /ElevenLabs key in Settings > Media to make a voice-over/);
  for (const k of ["image", "video", "voice"]) assert.doesNotMatch(MS.setupMessage(k), /—|–/);
});

test("status with nothing connected: not ok, names the key, lists nobody", () => {
  for (const k of ["image", "video", "voice"]) {
    const st = MS.status(k);
    assert.equal(st.ok, false, k);
    assert.equal(st.message, MS.setupMessage(k));
    assert.deepEqual(st.ready, []);
  }
  assert.deepEqual(MS.candidates("image"), []);
});

test("status and candidates: xAI, Gemini and OpenAI keys count as picture AIs, cheapest first; fal and Kling for video", () => {
  process.env.XAI_API_KEY = "xai-test-000"; process.env.OPENAI_API_KEY = "sk-test-000"; process.env.GEMINI_API_KEY = "AIza-test-000";
  try {
    const c = MS.candidates("image");
    assert.deepEqual(c.map((x) => x.id).sort(), ["google", "openai", "xai"]);
    assert.ok(c.every((x) => x.via === "images" && !x.capped));
    assert.ok(c[0].usd <= c[1].usd && c[1].usd <= c[2].usd, "cheapest first");
    const st = MS.status("image");
    assert.equal(st.ok, true);
    assert.equal(st.alternatives.length, 2);
    assert.match(st.message, /will make it\. If it fails, .* steps in/);
  } finally { for (const k of ["XAI_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) delete process.env[k]; }
  process.env.FAL_KEY = "fal-test:000"; process.env.KLING_ACCESS_KEY = "kling-test";
  try {
    assert.deepEqual(MS.candidates("video").map((x) => x.id), ["kling", "fal"]);
    assert.ok(MS.candidates("image").some((x) => x.id === "fal"), "fal makes pictures too");
    assert.equal(MS.candidates("voice").length, 0);
  } finally { delete process.env.FAL_KEY; delete process.env.KLING_ACCESS_KEY; }
});

test("makeImageSwitch: the first AI fails, the next connected one makes the picture; every try is recorded", async () => {
  process.env.XAI_API_KEY = "xai-test-000"; process.env.OPENAI_API_KEY = "sk-test-000";
  try {
    const calls = [];
    const make = async (b) => { calls.push(b.provider); if (b.provider === "xai") throw new Error("xAI: out of credits (402)"); return { id: "img-1", files: [{ i: 0 }], provider: b.provider }; };
    const r = await MS.makeImageSwitch({ prompt: "a woman on a beach", first: "xai", make });
    assert.deepEqual(calls, ["xai", "openai"], "the chosen one first, then the other");
    assert.equal(r.maker.id, "openai");
    assert.deepEqual(r.tried.map((t) => [t.id, t.ok]), [["xai", false], ["openai", true]]);
    assert.match(r.tried[0].reason, /out of credits/);
  } finally { delete process.env.XAI_API_KEY; delete process.env.OPENAI_API_KEY; }
});

test("makeImageSwitch: all fail gives a plain message with each reason and the key to add; none connected says so without trying", async () => {
  process.env.XAI_API_KEY = "xai-test-000";
  try {
    await assert.rejects(MS.makeImageSwitch({ prompt: "x", make: async () => { throw new Error("key rejected (401)"); } }), (e) => e.code === "all_failed" && /xAI Grok: key rejected \(401\)/.test(e.message) && /Add your fal\.ai key/.test(e.message));
  } finally { delete process.env.XAI_API_KEY; }
  let called = false;
  await assert.rejects(MS.makeImageSwitch({ prompt: "x", make: async () => { called = true; } }), (e) => e.code === "no_provider" && e.message === MS.setupMessage("image"));
  assert.equal(called, false, "nothing is called without a key");
});

test("makeImageSwitch: a pricier AI than the person allowed is skipped, not used", async () => {
  process.env.OPENAI_API_KEY = "sk-test-000";
  try {
    await assert.rejects(MS.makeImageSwitch({ prompt: "x", maxUsd: 0.001, make: async () => { throw new Error("must not be called"); } }), (e) => e.code === "all_failed" && /over the \$0\.001 you allowed/.test(e.message));
  } finally { delete process.env.OPENAI_API_KEY; }
});

test("video failover: a failed Kling job starts the same video on fal.ai and the old job points at the new one", () => {
  process.env.FAL_KEY = "fal-test:000"; process.env.KLING_ACCESS_KEY = "kling-test";
  try {
    const made = [];
    const create = (o) => { const job = { id: `mj-${made.length + 1}`, ...o, status: "queued" }; made.push(job); return job; };
    const { job, maker, alternatives } = MS.startMediaSwitch({ kind: "video", params: { prompt: "waves", duration: 5 }, create });
    assert.equal(maker.id, "kling");
    assert.deepEqual(alternatives.map((a) => a.id), ["fal"]);
    assert.equal(made.length, 1);
    const nj = MS.failover({ ...job, status: "failed", error: "Kling: out of credits" }, create);
    assert.equal(nj.provider, "fal");
    assert.equal(nj.params.prompt, "waves");
    assert.equal(MS.followJob(job.id), nj.id);
    assert.equal(MS.failover({ ...job, status: "failed", error: "again" }, create), null, "one switch per job");
    assert.equal(MS.failover({ ...nj, status: "failed", error: "fal down" }, create), null, "nobody left to try");
    assert.equal(MS.followJob(nj.id), nj.id);
    assert.equal(MS.failover({ ...job, status: "done" }, create), null, "a finished job is left alone");
  } finally { delete process.env.FAL_KEY; delete process.env.KLING_ACCESS_KEY; }
});

test("startMediaSwitch with no video AI: refuses with the setup line instead of making a placeholder", () => {
  assert.throws(() => MS.startMediaSwitch({ kind: "video", params: { prompt: "x" }, create: () => { throw new Error("must not create"); } }), (e) => e.code === "no_provider" && /^Add your Kling key in Settings > Media/.test(e.message));
});

test("missionMediaStep: picture is made now by a working AI; with no key the step fails with the setup line and saves no placeholder", async () => {
  process.env.XAI_API_KEY = "xai-test-000"; process.env.OPENAI_API_KEY = "sk-test-000";
  try {
    const make = async (b) => { if (b.provider === "openai") throw new Error("out of credits"); return { id: "img-9", provider: b.provider }; };
    const r = await MS.missionMediaStep({ kind: "image", prompt: "a lighthouse", guardUsd: 0.5, make });
    assert.equal(r.image.maker.id, "xai");
    assert.equal(r.image.tried[0].ok, false);
    // a price above the auto-OK amount is never spent without a click
    await assert.rejects(MS.missionMediaStep({ kind: "image", prompt: "a lighthouse", guardUsd: 0.001, make: async () => { throw new Error("no"); } }), (e) => e.code === "needs_ok");
  } finally { delete process.env.XAI_API_KEY; delete process.env.OPENAI_API_KEY; }
  await assert.rejects(MS.missionMediaStep({ kind: "image", prompt: "x", make: async () => { throw new Error("must not run"); } }), (e) => e.code === "no_provider" && /Add your fal\.ai key in Settings > Media to make pictures/.test(e.message));
});

async function imageMock() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const hits = [];
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    hits.push(req.url);
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith("/openai/")) return send(402, { error: { message: "no credits left" } });
    if (req.url.startsWith("/xai/")) return send(200, { data: [{ b64_json: PNG.toString("base64") }] });
    send(404, {});
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { base, hits, close: () => new Promise((r) => server.close(r)) };
}

test("chat: with no image key the plan says which key to add before anything is sent; with a dead first AI the next one makes a real picture", async () => {
  const none = await startServer({ env: Object.fromEntries(KEYS.map((k) => [k, ""])) });
  try {
    const setup = await none.api("/make/setup?kind=image");
    assert.equal(setup.status, 200, setup.text);
    assert.equal(setup.json.ok, false);
    assert.match(setup.json.message, /Add your fal\.ai key in Settings > Media to make pictures/);
    const pl = await none.api("/make/plan", { method: "POST", body: { kind: "image", request: "a woman on a beach" } });
    assert.equal(pl.status, 409);
    assert.equal(pl.json.code, "no_provider");
    assert.match(pl.json.error, /Add your fal\.ai key in Settings > Media to make pictures/);
    assert.equal((await none.api("/images")).json.items.length, 0, "nothing was made, no placeholder saved");
  } finally { await none.stop?.(); }
  const m = await imageMock();
  const two = await startServer({ env: { ...Object.fromEntries(KEYS.map((k) => [k, ""])), XAI_API_KEY: "xai-test-000", OPENAI_API_KEY: "sk-test-000", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_OPENAI: `${m.base}/openai/v1` } });
  try {
    const pl = await two.api("/make/plan", { method: "POST", body: { kind: "image", request: "a woman on a beach" } });
    assert.equal(pl.status, 200, pl.text);
    assert.equal(pl.json.provider, "openai", "plan picks the cheapest connected maker");
    // OpenAI is the cheapest but its mock answers 402, so xAI has to step in
    const r = await two.api("/make/run", { method: "POST", body: { kind: "image", request: "a woman on a beach", generatorPrompt: pl.json.generatorPrompt } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.state, "done");
    assert.equal(r.json.provider, "xai");
    assert.match(r.json.switchedFrom, /OpenAI/);
    assert.ok(m.hits.some((u) => u.startsWith("/openai/")) && m.hits.some((u) => u.startsWith("/xai/")), "both were tried, in order");
    assert.notEqual(r.json.mime, "image/svg+xml", "a real picture, never a placeholder");
    const file = await two.api(r.json.fileUrl);
    assert.equal(file.status, 200);
  } finally { await two.stop?.(); await m.close(); }
});
