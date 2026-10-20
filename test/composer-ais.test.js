// The chat composer lists only connected AIs. Demo shows only when nothing real is connected.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { composerAis, isConnectedAi } from "../web/composer-ais.js";

const demo = (id, name) => ({ id, name, demo: true, kind: "text", keyed: true, models: [{ id: "m", name: "Demo model", default: true }] });
const real = (id, extra = {}) => ({ id, name: id, kind: "text", keyed: false, models: [{ id: "m", name: id + " model", default: true }], ...extra });

test("unconnected providers stay hidden, and Demo shows only until a real AI is connected", () => {
  const nova = demo("demo-nova", "Nova (demo)");
  const atlas = demo("demo-atlas", "Atlas (demo)");
  const claude = real("anthropic", { name: "Claude", keyed: false });
  const grok = real("xai", { name: "Grok", keyed: false });
  const kling = real("kling", { name: "Kling", kind: "video", connect: { mcp: { configured: true }, key: { configured: false } } });

  const onlyDemo = composerAis([nova, atlas, claude, grok]);
  assert.deepEqual(onlyDemo.map((c) => c.id), ["demo-nova", "demo-atlas"]);
  assert.ok(onlyDemo.every((c) => c.demo));

  const keyed = composerAis([nova, atlas, real("anthropic", { name: "Claude", keyed: true }), grok]);
  assert.deepEqual(keyed.map((c) => c.id), ["anthropic"]);
  assert.equal(keyed[0].demo, false);
  assert.equal(keyed[0].model, "anthropic model");
  assert.ok(!keyed.some((c) => c.demo), "Demo leaves once any real AI is connected");

  const mcp = composerAis([nova, kling, grok]);
  assert.deepEqual(mcp.map((c) => c.id), ["kling"]);
  assert.equal(mcp[0].via, "mcp");

  const rejected = real("openai", { name: "ChatGPT", keyed: true, status: { status: "red", detail: "Key rejected (401)" } });
  assert.equal(isConnectedAi(rejected), false);
  assert.deepEqual(composerAis([nova, rejected, grok]).map((c) => c.id), ["demo-nova"]);

  const rejectedButMcp = real("kling", {
    name: "Kling", keyed: true,
    status: { status: "red", detail: "Key rejected (401)" },
    connect: { mcp: { configured: true }, key: { configured: true } },
  });
  assert.deepEqual(composerAis([rejectedButMcp]).map((c) => c.id), ["kling"]);

  const offline = real("google", { name: "Google Gemini", keyed: true, status: { status: "red", detail: "Could not reach Google Gemini: connection refused", network: true } });
  assert.equal(isConnectedAi(offline), false, "a provider that could not be reached is not a connected AI");
  assert.deepEqual(composerAis([nova, offline]).map((c) => c.id), ["demo-nova"]);

  const broke = real("anthropic", { name: "Claude", keyed: true, status: { status: "red", detail: "out of credits" } });
  assert.equal(isConnectedAi(broke), true, "a key that ran out of credits is still connected");
  assert.deepEqual(composerAis([nova, broke]).map((c) => c.id), ["anthropic"]);

  assert.deepEqual(composerAis([]), []);
  assert.deepEqual(composerAis(null), []);
});

test("Simple and Expert both render that connected list under the chat box", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const simple = app.slice(app.indexOf("function renderSimpleChat"), app.indexOf("function renderCommand"));
  const expert = app.slice(app.indexOf("function renderCommand"), app.indexOf("function renderOps"));
  for (const src of [simple, expert]) {
    assert.match(src, /id="cc-composer-ais"/);
    assert.match(src, /renderComposerAis\(\)/);
  }
  assert.match(app, /composerAis\(S\.providers\)/);
  assert.equal(app.includes("\u2014"), false);
});
