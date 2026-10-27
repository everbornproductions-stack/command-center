// Ending guard (idea 1): walk real flows to their last step and fail when there is no finished, named item in
// MindMedia that can be shown. Practice AIs only, no key, nothing posted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

test("typing 'a woman on a beach' in Images ends with a named picture in MindMedia that the page can show", async () => {
  const s = await startServer({});
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const body = { provider: "demo-image", prompt: "A woman on a beach", n: 2 };
    const est = await s.api("/images/estimate", { method: "POST", body });
    const r = await s.api("/images", { method: "POST", body: { ...body, estimate: est.json.usd } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const hub = (await s.api("/mindmedia")).json;
    const pics = hub.items.filter((i) => i.kind === "image");
    assert.equal(pics.length, 2, JSON.stringify(hub.items.map((i) => i.name)));
    for (const p of pics) {
      assert.match(p.name, /^A woman on a beach( [12])?\.svg$/);
      assert.equal(p.hasFile, true);
      const f = await s.api(`/projectmedia/file?projectId=${encodeURIComponent(p.projectId)}&assetId=${encodeURIComponent(p.id)}`);
      assert.equal(f.status, 200);
      assert.match(String(f.headers?.["content-type"] || ""), /image\/svg\+xml/);
    }
  } finally { await s.stop(); }
});

test("a Finish save ends with one named hub item, and saving the same result twice does not duplicate it", async () => {
  const s = await startServer({});
  try {
    const one = { kind: "text", text: "## Spring sale\nTen percent off all week.", source: "Finish", dedupeKey: "compare:run-1" };
    const a = await s.api("/mindmedia/save", { method: "POST", body: one });
    const b = await s.api("/mindmedia/save", { method: "POST", body: one });
    assert.equal(a.status, 200);
    assert.equal(b.json.reused, true);
    const items = (await s.api("/mindmedia")).json.items;
    assert.equal(items.length, 1);
    assert.match(items[0].name, /^Spring sale/);
    assert.ok(!/^##|\*\*/.test(items[0].name));
  } finally { await s.stop(); }
});
