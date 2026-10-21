// What counts as a connected AI for hiding Nova, Atlas and Sage.
// No network and no vault: the decision is a pure function of the facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectedRealAi, refreshCli, refreshWindowsEnv, cliNames, setCliHits, visibleCustomAgents } from "../server/demo-visibility.js";

const text = (id, extra = {}) => ({ id, kind: "text", keyed: false, rejected: false, lastOk: 0, ...extra });
const demo = (id) => text(id, { demo: true, keyed: true });

test("a saved key hides demos even when the probe cannot reach the host", () => {
  const providers = [
    demo("demo-nova"),
    text("google", { keyed: true, rejected: false }),
    text("kling", { kind: "video", keyed: true }),
  ];
  assert.equal(connectedRealAi({ providers }), true);
  assert.equal(connectedRealAi({ providers: [text("google", { keyed: true, rejected: true, lastOk: 0 })] }), false, "a rejected key is not connected");
  assert.equal(connectedRealAi({ providers: [text("google", { keyed: true, rejected: true, lastOk: 10 })] }), true, "a key that has worked still counts");
  assert.equal(connectedRealAi({ providers: [text("openrouter", { keyed: true })] }), true, "an OpenRouter key counts");
  assert.equal(connectedRealAi({ providers: [text("ollama", { custom: true, noKey: true, auth: "local" })] }), true, "a local model counts");
  assert.equal(connectedRealAi({ providers: [text("anthropic", { mcp: true })] }), true);
  assert.equal(connectedRealAi({ providers: [text("kling", { kind: "video", keyed: true }), demo("demo-nova")] }), false, "a media key does not replace the text demos");
  assert.equal(connectedRealAi({ providers: [], cli: ["agy"] }), true, "agy on the path counts");
  assert.equal(connectedRealAi({ providers: [], cli: ["claude", "gemini"] }), false, "other CLIs do not count");
  assert.equal(connectedRealAi({ providers: [], handoff: true }), true, "a real handoff counts");
  assert.equal(connectedRealAi({ providers: [demo("demo-nova"), demo("demo-atlas")] }), false);
});

test("agy is the only CLI that is recorded, and a Windows env scan can be turned off", async () => {
  try {
    const names = await refreshCli({ scan: false, connected: "agy,claude,gemini" });
    assert.deepEqual(names, ["agy"]);
    assert.deepEqual(cliNames(), ["agy"]);
    assert.deepEqual(await refreshCli({ scan: false, connected: "" }), []);
    assert.deepEqual(await refreshWindowsEnv({ scan: false }), []);
  } finally {
    setCliHits([]);
  }
});

test("custom agents pinned to a demo model are flagged and filtered, not deleted", () => {
  const list = [
    { id: "a1", name: "Caption", provider: "demo-nova", model: "nova-lite" },
    { id: "a2", name: "Clerk", provider: "anthropic", model: "claude" },
  ];
  const shown = visibleCustomAgents(list, { hidden: false });
  assert.equal(shown.length, 2);
  assert.equal(shown[0].demo, true);
  assert.equal(shown[1].demo, undefined);
  const hidden = visibleCustomAgents(list, { hidden: true });
  assert.deepEqual(hidden.map((a) => a.id), ["a2"]);
  assert.equal(list.length, 2, "the saved records stay");
});
