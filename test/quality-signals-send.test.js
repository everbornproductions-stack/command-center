// Anonymous quality signals really leave once a day, only with the track-record switch on, to a mock endpoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, freePort } from "./helpers.js";
import { signalsDestination, sendDueSignals } from "../server/usage.js";
import { validateQualitySignalPayload } from "../server/privacy.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = new Date().toISOString().slice(0, 10);
const brainDoc = (shareOptIn) => ({
  v: 1, since: Date.now(), settings: { on: true, shareOptIn, shareChosen: true }, jobs: 3, runs: {},
  stats: { "gpt-test": { provider: "openai", t: { "code:2": { jobs: 3, ok: 2, fail: 1, rounds: 0, wins: 0, scoreSum: 0, scoreN: 0, qaSum: 0, qaN: 0, up: 1, down: 0, cost: 0.03, costN: 3, ms: 9000, msN: 3, last: Date.now() } } } },
});

test("destination sits next to the ping", () => {
  assert.equal(signalsDestination({ CC_USAGE_URL: "http://127.0.0.1:9/api/metrics/ping" }), "http://127.0.0.1:9/api/metrics/signals");
  assert.equal(signalsDestination({ CC_USAGE_URL: "off" }), "");
});

test("sendDueSignals: off sends nothing, on sends once a day, a bad payload never leaves", async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, text: async () => "" }; };
  const payload = { installId: "a".repeat(32), version: "0.4.19", signals: [{ provider: "openai", taskType: "code", thumbsUp: 1, thumbsDown: 0, accepted: 2, retried: 1, costBucket: "under_1c", latencyBucket: "2s_to_10s", version: "0.4.19" }] };
  let consent = false;
  const args = { consent: () => consent, buildPayload: () => payload, validate: validateQualitySignalPayload, version: "0.4.19", destination: "http://127.0.0.1:9/api/metrics/signals", fetchImpl };
  // loadState needs a store context
  const store = await import("../server/store.js");
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sig-"));
  store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
  assert.equal((await sendDueSignals(args)).reason, "off");
  assert.equal(sent.length, 0);
  consent = true;
  assert.equal((await sendDueSignals(args)).sent, true);
  assert.equal(sent.length, 1);
  assert.equal((await sendDueSignals(args)).reason, "already");
  assert.equal(sent.length, 1);
  const bad = { ...args, buildPayload: () => ({ ...payload, signals: [{ ...payload.signals[0], prompt: "secret" }] }) };
  fs.rmSync(DIR, { recursive: true, force: true });
  store.setDefaultContext(store.newContext("local", new store.FileStore(fs.mkdtempSync(path.join(os.tmpdir(), "cc-sig-")))));
  assert.equal((await sendDueSignals(bad)).reason, "invalid");
  assert.equal(sent.length, 1);
});

async function run(shareOptIn) {
  const hits = [];
  const sink = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => { let json = null; try { json = JSON.parse(b); } catch {} hits.push({ url: req.url, json }); res.writeHead(200, { "content-type": "application/json", connection: "close" }); res.end("{}"); });
  });
  const port = await freePort();
  await new Promise((r) => sink.listen(port, "127.0.0.1", r));
  let s;
  try {
    s = await startServer({
      env: { CC_USAGE_URL: `http://127.0.0.1:${port}/api/metrics/ping`, CC_USAGE_CHECK_MS: "200", CC_FLAG_SIGNALSEND: "1" },
      seed(dir) {
        fs.writeFileSync(path.join(dir, "brain.json"), JSON.stringify(brainDoc(shareOptIn)));
        fs.writeFileSync(path.join(dir, "usage.json"), JSON.stringify({ v: 1, share: false, installId: "c".repeat(32), day: TODAY, counts: {}, seen: [], lastSentDay: null }));
      },
    });
    await sleep(shareOptIn ? 2500 : 1500);
    return hits.filter((h) => h.url.endsWith("/signals"));
  } finally { await s?.stop(); await new Promise((r) => { sink.close(r); setTimeout(r, 500); }); }
}

test("live: switch on posts the signals once, switch off posts nothing", async () => {
  const on = await run(true);
  assert.equal(on.length, 1, "exactly one send " + JSON.stringify(on));
  assert.equal(on[0].json.installId, "c".repeat(32));
  assert.deepEqual(Object.keys(on[0].json).sort(), ["installId", "signals", "version"]);
  assert.equal(on[0].json.signals[0].provider, "openai");
  assert.equal(validateQualitySignalPayload(on[0].json).ok, true);
  assert.equal((await run(false)).length, 0);
});

test("by default the app does not send signals (no receiver in this repo)", async () => {
  const { flagOn } = await import("../server/flags.js");
  delete process.env.CC_FLAG_SIGNALSEND;
  assert.equal(flagOn("signalsend"), false);
  const src = fs.readFileSync(new URL("../server/plugins/usage.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /flagOn\("signalsend"\)/);
});
