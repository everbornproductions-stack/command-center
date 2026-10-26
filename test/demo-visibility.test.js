// What counts as a connected AI for hiding Nova, Atlas and Sage.
// No network and no vault: the decision is a pure function of the facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { connectedRealAi, refreshCli, refreshWindowsEnv, cliNames, setCliHits, visibleCustomAgents, cliInstallPaths, visibleRows } from "../server/demo-visibility.js";
import { demoBannerOn, DEMO_BANNER_TEXT, DEMO_BANNER_ACTION, hideDemoBots } from "../web/composer-ais.js";

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
  assert.equal(connectedRealAi({ providers: [], cli: ["claude"] }), true, "the Claude CLI counts");
  assert.equal(connectedRealAi({ providers: [], cli: ["codex"] }), true, "the Codex CLI counts");
  assert.equal(connectedRealAi({ providers: [], cli: ["gemini"] }), true, "the Gemini CLI counts");
  assert.equal(connectedRealAi({ providers: [], cli: ["git", "node"] }), false, "a non-AI tool does not count");
  assert.equal(connectedRealAi({ providers: [demo("demo-nova")], apps: 1 }), false, "an app, HighLevel or MCP connection is a tool, not an AI: the practice AIs stay");
  assert.equal(connectedRealAi({ providers: [demo("demo-nova")], apps: 0 }), false);
  assert.equal(connectedRealAi({ providers: [], handoff: true }), true, "a real handoff counts");
  assert.equal(connectedRealAi({ providers: [demo("demo-nova"), demo("demo-atlas")] }), false);
});

test("only AI CLIs are recorded, and a Windows env scan can be turned off", async () => {
  try {
    const names = await refreshCli({ scan: false, connected: "agy,claude,gemini,git" });
    assert.deepEqual(names, ["agy", "claude", "gemini"]);
    assert.deepEqual(cliNames(), ["agy", "claude", "gemini"]);
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

// Root cause: the scan only asked PATH for agy. The desktop app starts with a
// PATH that lacks %LOCALAPPDATA%\\agy\\bin, so an installed, signed-in agy left Nova up.
test("an AI CLI in its install folder counts even when it is not on PATH", async () => {
  const env = { LOCALAPPDATA: "C:\\Users\\chris\\AppData\\Local", APPDATA: "C:\\Users\\chris\\AppData\\Roaming", USERPROFILE: "C:\\Users\\chris" };
  const win = cliInstallPaths("agy", { env, platform: "win32" });
  assert.ok(win.includes(path.join(env.LOCALAPPDATA, "agy", "bin", "agy.exe")));
  assert.ok(cliInstallPaths("claude", { env, platform: "win32" }).includes(path.join(env.APPDATA, "npm", "claude.cmd")));
  assert.ok(cliInstallPaths("claude", { env: { HOME: "/home/c" }, platform: "linux" }).includes(path.join("/home/c", ".local", "bin", "claude")));
  try {
    const want = new Set(cliInstallPaths("agy"));
    const found = await refreshCli({ scan: true, connected: "", exists: (p) => want.has(p) });
    assert.ok(found.includes("agy"), "agy found in its install folder");
    assert.equal(connectedRealAi({ cli: cliNames() }), true);
  } finally {
    setCliHits([]);
  }
});

test("demo tools, demo catalog rows and demo image models leave lists while demos are hidden", () => {
  const rows = [
    { id: "demo-tools", name: "Demo tools", demo: true },
    { id: "sales", title: "Sales", seller: { name: "Demo catalog", demo: true } },
    { id: "demo-image", name: "Demo images" },
    { id: "zapier", name: "Zapier" },
  ];
  assert.equal(visibleRows(rows, { hidden: false }).length, 4);
  assert.deepEqual(visibleRows(rows, { hidden: true }).map((r) => r.id), ["zapier"]);
  assert.equal(rows.length, 4, "the saved rows stay");
});

test("the demo banner shows whenever demo mode is on and its pretend AIs are in use", () => {
  assert.equal(DEMO_BANNER_TEXT + " " + DEMO_BANNER_ACTION, "You're in demo mode, using pretend AIs. Exit demo mode");
  assert.doesNotMatch(DEMO_BANNER_TEXT + DEMO_BANNER_ACTION, /\u2014/);
  assert.equal(demoBannerOn({ demo: true, demoKeep: true, realAi: true }), true);
  assert.equal(demoBannerOn({ demo: true, realAi: false }), true);
  assert.equal(demoBannerOn({ demo: true, demoKeep: false, realAi: true }), false, "retired demo AIs are not in use");
  assert.equal(demoBannerOn({ demo: false, demoKeep: true, realAi: true }), false, "off means no banner");
  assert.equal(demoBannerOn({ demoBanner: false, demoKeep: true, realAi: true }), false, "the server answer wins");
  const list = [{ id: "demo-nova", kind: "text", demo: true }, { id: "openai", kind: "text", keyed: true }];
  assert.deepEqual(hideDemoBots(list, { realAi: true }).map((p) => p.id), ["openai"]);
  assert.equal(hideDemoBots(list, { realAi: true, demoKeep: true }).length, 2);
});
