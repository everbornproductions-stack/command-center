// Decision 23. Bring your own project URL and publishable key.
// The service key stays on the server. This is not the licence server connection.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "./helpers.js";

const PUB = "sb_publishable_test_abcdWXYZ";
const SECRET = "sb_secret_test_NOTREAL9911";
const CLOUD_KEY = "sb_publishable_cloud_only";

function healthMock() {
  return new Promise((resolve) => {
    const hits = [];
    const server = http.createServer(async (req, res) => {
      hits.push({ path: req.url, authorization: req.headers.authorization || "", apikey: req.headers.apikey || "" });
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ name: "GoTrue" }));
    });
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      hits,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

test("own Supabase is off by default, separate from the licence server, and the service key never returns", async () => {
  const mock = await healthMock();
  const s = await startServer();
  try {
    const first = await s.api("/ownsupabase");
    assert.equal(first.status, 200);
    assert.equal(first.json.on, false);
    assert.equal(first.json.using, "everborn");
    assert.equal(first.json.serviceKeySet, false);

    const cloud = await s.api("/cloud", { method: "POST", body: { url: "http://127.0.0.1:9", anonKey: CLOUD_KEY } });
    assert.equal(cloud.status, 200, cloud.text);
    assert.equal(cloud.json.cloud.url, "http://127.0.0.1:9");

    const bad = await s.api("/ownsupabase", { method: "POST", body: { on: true, url: mock.url, publishable: "service_role_test_key", serviceKey: SECRET } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, "publishable");

    const saved = await s.api("/ownsupabase", { method: "POST", body: { on: true, url: mock.url, publishable: PUB, serviceKey: SECRET } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.on, true);
    assert.equal(saved.json.using, "yours");
    assert.equal(saved.json.serviceKeySet, true);
    assert.equal(saved.json.publishableSet, true);
    assert.notEqual(saved.json.publishableMask, PUB);
    assert.equal(saved.text.includes(PUB), false);
    assert.equal(saved.text.includes(SECRET), false);

    const state = await s.api("/state");
    assert.equal(state.json.settings.cloud.url, "http://127.0.0.1:9");
    assert.equal(JSON.stringify(state.json).includes(SECRET), false);
    assert.equal(JSON.stringify(state.json).includes(PUB), false);

    const check = await s.api("/ownsupabase/check", { method: "POST", body: {} });
    assert.equal(check.status, 200, check.text);
    assert.equal(check.json.ok, true);
    assert.equal(check.json.serviceKeyUsed, true);
    assert.equal(check.json.using, "yours");
    assert.equal(check.text.includes(SECRET), false);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/auth/v1/health");
    assert.equal(mock.hits[0].authorization, `Bearer ${SECRET}`);
    assert.equal(mock.hits[0].apikey, PUB);
    assert.equal(s.log.includes(SECRET), false);
    assert.equal(s.log.includes(PUB), false);

    const again = await s.api("/state");
    assert.equal(again.json.settings.cloud.url, "http://127.0.0.1:9");
    assert.equal(again.json.license.cloudUrl, "http://127.0.0.1:9");
  } finally {
    await s.stop();
    await mock.close();
  }
});

test("own Supabase is an advanced setting, not a setup step", () => {
  const ui = fs.readFileSync(new URL("../web/features/own-supabase.js", import.meta.url), "utf8");
  const plugin = fs.readFileSync(new URL("../server/plugins/ownsupabase.js", import.meta.url), "utf8");
  const core = fs.readFileSync(new URL("../server/own-supabase.js", import.meta.url), "utf8");
  for (const text of [ui, plugin, core]) assert.doesNotMatch(text, /\u2014/);
  assert.match(ui, /settings:/);
  assert.doesNotMatch(ui, /setup:\s*\{/);
  assert.doesNotMatch(plugin + core, /resetVerifiedTier|\/cloud/);
  const index = fs.readFileSync(new URL("../web/perf/registry.js", import.meta.url), "utf8");
  assert.match(index, /own-supabase/);
});
