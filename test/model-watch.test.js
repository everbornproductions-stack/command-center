// Phase 32: model watch. Public model lists only, the user's own key, read only, at most once a day.
// A local mock stands in for the provider. No real key and no real URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer, freePort, ROOT } from "./helpers.js";
import { parseModelList, priceOf, familyKey, isNewer, suggestionsFor, diffSnapshot, due, DAY, safeError, newsTarget, buildChanges } from "../server/model-watch.js";

const KEY = "xai-watch-test-key-42";

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}
function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("parsing, versions, the daily gate, and plain notes", () => {
  const openai = parseModelList({ data: [{ id: "grok-4.8", pricing: { prompt: "0.0000015", completion: "0.000004" } }] });
  assert.equal(openai[0].id, "grok-4.8");
  assert.deepEqual(openai[0].price, { in: 1.5, out: 4 });
  const gemini = parseModelList({ models: [{ name: "models/gemini-4-argon", displayName: "Gemini 4 Argon" }] });
  assert.equal(gemini[0].id, "gemini-4-argon");
  assert.equal(gemini[0].name, "Gemini 4 Argon");
  assert.equal(parseModelList({ nope: true }), null);
  assert.deepEqual(priceOf({ pricing: { input: 1.25, output: 2.5 } }), { in: 1.25, out: 2.5 });
  assert.equal(priceOf({ pricing: { input: -1, output: 1 } }), null);

  assert.equal(familyKey("grok-4.7"), "grok");
  assert.equal(familyKey("grok-4.8"), familyKey("grok-4.7"));
  assert.equal(familyKey("claude-opus-5-5"), "claude-opus");
  assert.notEqual(familyKey("claude-haiku-5-5"), familyKey("claude-opus-5-5"));
  assert.equal(isNewer("grok-4.8", "grok-4.7"), true);
  assert.equal(isNewer("grok-4.7", "grok-4.8"), false);
  assert.equal(isNewer("mistral-large-4", "mistral-large-latest"), true);

  const known = [
    { id: "grok-4.7", name: "Grok 4.7", default: true },
    { id: "grok-4.3", name: "Grok 4.3", default: false },
  ];
  const added = [{ id: "grok-4.8", name: "Grok 4.8", price: { in: 1.5, out: 4 } }];
  const hit = suggestionsFor(known, added);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].from.id, "grok-4.7");
  assert.equal(hit[0].to.id, "grok-4.8");
  assert.equal(suggestionsFor(known, [{ id: "other-model-9", name: "Other" }]).length, 0);

  const first = diffSnapshot(null, added);
  assert.equal(first.first, true);
  assert.equal(first.added.length, 1);
  const next = diffSnapshot({ models: [{ id: "grok-4.3", name: "Grok 4.3", price: { in: 1.25, out: 2.5 } }] }, [{ id: "grok-4.3", name: "Grok 4.3", price: { in: 0.9, out: 1.8 } }]);
  assert.equal(next.first, false);
  assert.equal(next.priceChanges.length, 1);
  assert.equal(due(null, 100), true);
  assert.equal(due(1_000, 1_000 + DAY - 1), false);
  assert.equal(due(1_000, 1_000 + DAY), true);

  const built = buildChanges({ provider: { id: "xai", name: "Grok" }, known, diff: next, now: 5, count: 1 });
  assert.match(built.notes[0].body, /\$1\.25 in and \$2\.50 out/);
  assert.match(built.notes[0].body, /\$0\.90 in and \$1\.80 out/);
  assert.equal(built.notes[0].body.includes("\u2014"), false);
  const look = buildChanges({ provider: { id: "xai", name: "Grok" }, known, diff: first, now: 5, count: 3 });
  assert.match(look.notes[0].body, /first look saved 3 models/);
  assert.equal(look.suggestions.length, 0);
  assert.equal(safeError("Grok", 401).includes(KEY), false);
  assert.match(safeError("Grok", 401), /refused the key/);
  assert.equal(safeError("Grok", 0, "https://example.com/secret").includes("http"), false);
  assert.equal(newsTarget(), "shared");
  for (const file of ["server/model-watch.js", "server/plugins/modelwatch.js", "web/features/modelwatch.js", "server/redact-text.js"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("\u2014"), false, file);
  }
  const plugin = fs.readFileSync(path.join(ROOT, "server/plugins/modelwatch.js"), "utf8");
  assert.match(plugin, /model\.version/);
});

test("a connected provider is checked once a day, notes a new model and a price, and a switch can be undone", async () => {
  const port = await freePort();
  let redirect = false;
  const hits = [];
  const catalog = [
    { id: "grok-4.7", pricing: { input: 2, output: 6 } },
    { id: "grok-4.3", pricing: { input: 0.9, output: 1.8 } },
    { id: "grok-4.8", pricing: { input: 1.5, output: 4 } },
  ];
  const mock = http.createServer((req, res) => {
    hits.push({ method: req.method, path: req.url, watch: req.headers["x-meldmind-watch"] || "" });
    if (redirect && req.headers["x-meldmind-watch"]) {
      res.writeHead(302, { location: "https://example.com/models" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: catalog }));
  });
  await listen(mock, port);
  const base = `http://127.0.0.1:${port}`;
  const s = await startServer({
    env: { CC_BASE_URL_XAI: `${base}/v1`, CC_STATUS_PAGES: "off" },
    seed(dir) {
      fs.writeFileSync(path.join(dir, "modelwatch.state.json"), JSON.stringify({
        checkedAt: Date.now() - DAY - 5000,
        providers: {
          xai: {
            at: 1,
            models: [
              { id: "grok-4.7", name: "Grok 4.7", price: { in: 2, out: 6 } },
              { id: "grok-4.3", name: "Grok 4.3", price: { in: 1.25, out: 2.5 } },
            ],
            error: null,
          },
        },
        notes: [],
        suggestions: [],
        accepted: [],
      }));
    },
  });
  try {
    const saved = await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } });
    assert.equal(saved.status, 200);
    const watched = hits.filter((h) => h.watch === "read");
    const before = watched.length;
    const check = await s.api("/modelwatch/check", { method: "POST", body: {} });
    assert.equal(check.status, 200, check.text);
    assert.equal(check.json.skipped, false);
    assert.equal(check.json.news, "shared");
    assert.equal(check.json.watched, 1);
    assert.ok(check.json.notes.some((n) => /grok-4\.8/.test(n.title)));
    assert.ok(check.json.notes.some((n) => /grok-4\.3/.test(n.title) && /\$1\.25/.test(n.body)));
    const suggestion = check.json.suggestions.find((x) => x.toId === "grok-4.8");
    assert.ok(suggestion, "a switch to the newer model is suggested");
    assert.equal(suggestion.fromId, "grok-4.7");
    assert.equal(suggestion.status, "open");
    const watchHits = hits.filter((h) => h.watch === "read");
    assert.equal(watchHits.length, before + 1);
    assert.ok(watchHits.every((h) => h.method === "GET"));
    assert.equal(JSON.stringify(check.json).includes(KEY), false);
    assert.equal(s.log.includes(KEY), false);

    const again = await s.api("/modelwatch/check", { method: "POST", body: {} });
    assert.equal(again.json.skipped, true);
    assert.match(again.json.reason, /Already checked today/);
    assert.equal(hits.filter((h) => h.watch === "read").length, watchHits.length);

    const accepted = await s.api("/modelwatch/accept", { method: "POST", body: { id: suggestion.id } });
    assert.equal(accepted.json.suggestions.find((x) => x.id === suggestion.id).status, "accepted");
    const models = (await s.api("/models")).json;
    assert.ok(models.some((m) => m.model === "grok-4.8" && m.provider === "xai"));
    assert.equal(models.some((m) => m.model === "grok-4.7"), false);
    const undone = await s.api("/modelwatch/undo", { method: "POST", body: { id: suggestion.id } });
    assert.equal(undone.json.suggestions.find((x) => x.id === suggestion.id).status, "open");
    const restored = (await s.api("/models")).json;
    assert.ok(restored.some((m) => m.model === "grok-4.7"));
    assert.equal(restored.some((m) => m.model === "grok-4.8"), false);
    assert.equal((await s.api("/modelwatch/undo", { method: "POST", body: { id: suggestion.id } })).status, 400);

    redirect = true;
    const fresh = await startServer({ env: { CC_BASE_URL_XAI: `${base}/v1`, CC_STATUS_PAGES: "off" } });
    try {
      assert.equal((await fresh.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } })).status, 200);
      const refused = await fresh.api("/modelwatch/check", { method: "POST", body: {} });
      assert.equal(refused.status, 200);
      assert.match(JSON.stringify(refused.json.notes), /redirected/);
      assert.equal(JSON.stringify(refused.json).includes("example.com"), false);
      assert.equal(JSON.stringify(refused.json).includes(KEY), false);
    } finally { await fresh.stop(); }
  } finally {
    await s.stop();
    await close(mock);
  }
});

test("an env key is not used, and the first look does not invent a switch", async () => {
  const port = await freePort();
  const hits = [];
  const mock = http.createServer((req, res) => {
    hits.push(req.headers["x-meldmind-watch"] || "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "grok-4.7" }, { id: "grok-4.8" }] }));
  });
  await listen(mock, port);
  const s = await startServer({ env: { CC_BASE_URL_XAI: `http://127.0.0.1:${port}/v1`, XAI_API_KEY: KEY, CC_STATUS_PAGES: "off" } });
  try {
    const check = await s.api("/modelwatch/check", { method: "POST", body: {} });
    assert.equal(check.json.watched, 0);
    assert.match(check.json.reason, /No connected AI/);
    assert.equal(hits.filter((h) => h === "read").length, 0);
    assert.equal(s.log.includes(KEY), false);
  } finally {
    await s.stop();
    await close(mock);
  }

  const port2 = await freePort();
  const mock2 = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "grok-4.7" }, { id: "grok-4.8" }] }));
  });
  await listen(mock2, port2);
  const s2 = await startServer({ env: { CC_BASE_URL_XAI: `http://127.0.0.1:${port2}/v1`, CC_STATUS_PAGES: "off" } });
  try {
    assert.equal((await s2.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } })).status, 200);
    const check = await s2.api("/modelwatch/check", { method: "POST", body: {} });
    assert.equal(check.json.suggestions.length, 0);
    assert.match(check.json.notes.map((n) => n.body).join(" "), /first look/);
    assert.equal(JSON.stringify(check.json).includes(KEY), false);
  } finally {
    await s2.stop();
    await close(mock2);
  }
});
