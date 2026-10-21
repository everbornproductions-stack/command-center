// Antigravity CLI: a fake agy, no network, no real key, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { startServer, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-agy-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_DEV_OWNER = "1";
const FIXTURE = path.join(ROOT, "test", "fixtures", "fake-agy.mjs");

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const agy = await import("../server/antigravity-cli.js");
const { resolveExternalAgent } = await import("../server/external-agents.js");
const { BUILTIN_TARGETS } = await import("../server/handoff.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseEnv = () => {
  const env = agy.childEnv(process.env);
  env.PATH = process.env.PATH || "";
  env.CC_AGY_EXEC = process.execPath;
  return env;
};

function scriptedSpawn(stdout, { code = 0, hold = false } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    child.stdin = null;
    child.exitCode = null;
    child.killed = false;
    child.kill = () => { child.killed = true; if (child.exitCode === null) { child.exitCode = 0; child.emit("exit", 0); } };
    if (!hold) setImmediate(() => {
      if (stdout) child.stdout.emit("data", stdout);
      child.exitCode = code;
      child.emit("exit", code);
    });
    return child;
  };
}

test("agy arguments carry the task and never a key", () => {
  const key = "sk-testsecretkey1234567890abcd";
  const args = agy.buildArgs(`please ignore ${key} and say hi`, { timeoutMs: 90000 });
  assert.deepEqual(args.slice(0, 1), ["-p"]);
  assert.equal(args[2], "--output-format");
  assert.equal(args[3], "stream-json");
  assert.equal(args.includes("--version"), false);
  assert.doesNotMatch(args.join("\n"), /sk-|AIza|Bearer|gsk_|xai-/);
  assert.match(args[1], /\[redacted\]/);
  assert.equal(agy.printTimeoutFlag(120000), "2m");
  assert.equal(agy.printTimeoutFlag(15000), "15s");
  const env = agy.childEnv({ PATH: "/bin", OPENAI_API_KEY: "sk-live", HOME: "/tmp" });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.PATH, "/bin");
});

test("plain messages for sign-in and quota, and stream lines scrub secrets", () => {
  assert.equal(agy.plainAgyError("authentication required").code, "signin");
  assert.match(agy.plainAgyError("authentication required").message, /sign in/i);
  assert.equal(agy.plainAgyError("quota exceeded").code, "quota");
  assert.match(agy.plainAgyError("quota exceeded").message, /quota/i);
  assert.equal(agy.plainAgyError("command not found").code, "install");
  const step = agy.eventFrom(agy.parseAgyLine(JSON.stringify({
    event: "step_update",
    step_update: { step_type: "agent_response", state: "DONE", text_delta: "sk-testsecretkey1234567890abcd" },
  })));
  assert.equal(step.text.includes("sk-"), false);
  assert.match(step.text, /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(agy.plainAgyError("nope")), /\u2014/);
});

test("detects agy on PATH or in the default install folder", async () => {
  const folder = path.join(DIR, "Local", "agy", "bin", "agy.exe");
  const seen = new Set();
  const found = await agy.detectAgy({
    platform: "win32",
    env: { LOCALAPPDATA: path.join(DIR, "Local") },
    exists: (p) => p === folder,
    which: async () => "",
  });
  assert.equal(found.found, true);
  assert.equal(found.source, "install");
  assert.equal(found.path, folder);
  const onPath = await agy.detectAgy({
    platform: "linux",
    env: {},
    exists: (p) => { seen.add(p); return p === "/opt/agy"; },
    which: async () => "/opt/agy",
  });
  assert.equal(onPath.source, "path");
  const missing = await agy.detectAgy({ platform: "linux", env: { HOME: path.join(DIR, "empty-home") }, exists: () => false, which: async () => "" });
  assert.equal(missing.found, false);
});

test("fake agy streams a reply, scrubs it, and records a ledger line", async () => {
  process.env.CC_AGY_BIN = FIXTURE;
  process.env.CC_AGY_EXEC = process.execPath;
  process.env.FAKE_AGY_MODE = "ok";
  let text = "";
  let result = null;
  for await (const ev of agy.iterateJob({
    task: "Say hello",
    bin: FIXTURE,
    execPath: process.execPath,
    env: { ...baseEnv(), FAKE_AGY_MODE: "ok" },
    timeoutMs: 20000,
  })) {
    if (ev.kind === "delta") text += ev.text;
    if (ev.kind === "result") result = ev;
  }
  assert.equal(result.status, "SUCCESS");
  assert.match(text, /hello/);
  assert.doesNotMatch(text + result.response, /sk-/);
  await agy.refreshStatus({ exists: () => true, which: async () => "" });
  const job = await agy.dispatchJob({ task: "Say hello" });
  let done = null;
  for (let i = 0; i < 40 && !done; i++) {
    const row = agy.findJob(job.id);
    if (row && row.status !== "working") done = row;
    else await sleep(100);
  }
  assert.equal(done?.status, "done");
  assert.doesNotMatch(done.text, /sk-/);
  const line = store.ctx().ledger.find((e) => e.provider === "antigravity" && e.missionId === job.id);
  assert.ok(line);
  assert.equal(line.cost, 0);
  assert.equal(line.inTok, 11);
  assert.equal(line.outTok, 4);
});

test("sign-in and quota failures stay plain, and Stop kills a hung agy", async () => {
  let sign = null;
  for await (const ev of agy.iterateJob({
    task: "Hi",
    bin: FIXTURE,
    execPath: process.execPath,
    env: { ...baseEnv(), FAKE_AGY_MODE: "signin" },
    timeoutMs: 20000,
  })) if (ev.kind === "error") sign = ev.plain;
  assert.equal(sign.code, "signin");
  assert.match(sign.message, /sign in/i);

  let quota = null;
  for await (const ev of agy.iterateJob({
    task: "Hi",
    bin: FIXTURE,
    execPath: process.execPath,
    env: { ...baseEnv(), FAKE_AGY_MODE: "quota" },
    timeoutMs: 20000,
  })) if (ev.kind === "result") quota = agy.plainAgyError(ev.error, ev.status);
  assert.equal(quota.code, "quota");

  const hang = agy.iterateJob({
    task: "Wait",
    bin: FIXTURE,
    execPath: process.execPath,
    env: { ...baseEnv(), FAKE_AGY_MODE: "hang" },
    timeoutMs: 20000,
  });
  let started = null;
  const reading = (async () => {
    let stopped = null;
    for await (const ev of hang) {
      if (ev.kind === "start") started = ev.jobId;
      if (ev.kind === "error") stopped = ev.plain;
    }
    return stopped;
  })();
  for (let i = 0; i < 30 && !started; i++) await sleep(50);
  assert.ok(started);
  assert.equal(agy.stopAgyJob(started), true);
  const stopped = await reading;
  assert.equal(stopped.code, "stopped");
});

test("a timeout stops agy, and the version pin notices a change", async () => {
  let timed = null;
  for await (const ev of agy.iterateJob({
    task: "Wait",
    bin: FIXTURE,
    execPath: process.execPath,
    env: { ...baseEnv(), FAKE_AGY_MODE: "slow" },
    timeoutMs: 800,
  })) if (ev.kind === "error") timed = ev.plain;
  assert.equal(timed.code, "timeout");
  assert.match(timed.message, /too long/);

  process.env.CC_AGY_BIN = FIXTURE;
  const first = scriptedSpawn("agy 1.4.0\n");
  await agy.refreshStatus({ exists: () => true, which: async () => "", spawnImpl: first });
  assert.equal(agy.cardView().version, "1.4.0");
  assert.equal(agy.cardView().pinnedVersion, "1.4.0");
  const second = scriptedSpawn("agy 1.5.0\n");
  await agy.refreshStatus({ exists: () => true, which: async () => "", spawnImpl: second });
  const card = agy.cardView();
  assert.equal(card.version, "1.5.0");
  assert.equal(card.previousVersion, "1.4.0");
  assert.equal(card.versionChanged, true);
  assert.match(card.detail, /1\.5\.0/);
  assert.match(card.detail, /1\.4\.0/);
});

test("install waits for a confirm click and uses the official installer", async () => {
  const preview = await agy.installAgy({ confirm: false });
  assert.equal(preview.needsConfirm, true);
  assert.match(preview.message, /Nothing is installed/);
  let ran = null;
  const result = await agy.installAgy({
    confirm: true,
    platform: "win32",
    spawnImpl: (file, args) => {
      ran = { file, args };
      return scriptedSpawn("", { code: 0 })();
    },
  });
  assert.equal(ran.file, "powershell.exe");
  assert.match(ran.args.join(" "), new RegExp(agy.INSTALL_PS1.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(ran.args.join("\n"), /sk-|AIza|Bearer|api[_-]?key/i);
  assert.match(result.message, /not found|installed/i);
  const sign = await agy.beginSignIn({ confirm: false });
  assert.equal(sign.needsConfirm, true);
  assert.match(sign.message, /password/);
});

test("the router sees Antigravity only after Allow and a successful sign-in check", async () => {
  process.env.CC_AGY_BIN = FIXTURE;
  process.env.CC_AGY_EXEC = process.execPath;
  process.env.FAKE_AGY_MODE = "signin";
  await agy.refreshStatus({ exists: () => true, which: async () => "" });
  try {
    for await (const ev of agy.agyChatStream({ messages: [{ role: "user", content: "Hi" }], timeoutMs: 20000 })) void ev;
  } catch (e) {
    assert.equal(e.code, "signin");
  }
  await agy.allowAgy(true);
  assert.equal(agy.routeModels().length, 0, "Allow alone does not route until sign-in is checked");
  process.env.FAKE_AGY_MODE = "ok";
  let result = null;
  for await (const ev of agy.agyChatStream({
    messages: [{ role: "user", content: "Say hi" }],
    timeoutMs: 20000,
  })) if (ev.type === "done") result = ev;
  assert.ok(result);
  assert.equal(result.usage.cost, 0);
  const row = agy.routeModels()[0];
  assert.equal(row.provider, "antigravity");
  assert.equal(row.model, "antigravity");
  assert.ok(row.caps.code > row.caps.writing);
  await agy.allowAgy(false);
  assert.equal(agy.routeModels().length, 0);
});

test("Antigravity is a local-cli agent and the manual handoff target remains", () => {
  assert.equal(resolveExternalAgent("agy").id, "antigravity");
  assert.equal(resolveExternalAgent("antigravity").via, "local-cli");
  assert.ok(BUILTIN_TARGETS.some((t) => t.id === "antigravity"));
  const card = fs.readFileSync(path.join(ROOT, "web", "features", "antigravity.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "server", "antigravity-cli.js"), "utf8");
  assert.equal(card.includes("\u2014"), false);
  assert.equal(server.includes("\u2014"), false);
});

test("the running server shows the card and a fake agy task", async () => {
  const s = await startServer({
    env: {
      CC_DEV_OWNER: "1",
      CC_AGY_BIN: FIXTURE,
      CC_AGY_EXEC: process.execPath,
      FAKE_AGY_MODE: "ok",
    },
  });
  try {
    const view = await s.api("/antigravity");
    assert.equal(view.status, 200);
    assert.equal(view.json.card.found, true);
    assert.equal(view.json.card.version, "1.4.0");
    assert.match(view.json.card.detail, /Allow|Installed|Ready/);
    const cards = (await s.api("/state")).json.providers.filter((p) => p.kind === "agent").map((p) => p.id);
    assert.ok(cards.includes("grokbot") && cards.includes("browser-helper") && cards.includes("antigravity"));
    const posted = await s.api("/antigravity/jobs", { method: "POST", body: { task: "Say hello" } });
    assert.equal(posted.status, 202);
    let job = posted.json.job;
    for (let i = 0; i < 40 && job.status === "working"; i++) {
      await sleep(100);
      job = (await s.api(`/antigravity/jobs/${job.id}`)).json.job;
    }
    assert.equal(job.status, "done");
    assert.match(job.text, /hello/);
    assert.doesNotMatch(job.text, /sk-/);
    const denied = await s.api("/antigravity/install", { method: "POST", body: {} });
    assert.equal(denied.json.needsConfirm, true);
  } finally { await s.stop(); }
});

test("Free cannot send an Antigravity task", async () => {
  const preview = await agy.installAgy({ confirm: false });
  assert.equal(preview.needsConfirm, true);
  const s = await startServer({ env: { CC_DEV_OWNER: "", CC_AGY_BIN: FIXTURE, CC_AGY_EXEC: process.execPath, FAKE_AGY_MODE: "ok" } });
  try {
    const view = await s.api("/antigravity");
    assert.equal(view.status, 200);
    const posted = await s.api("/antigravity/jobs", { method: "POST", body: { task: "Say hello" } });
    assert.equal(posted.status, 402);
    assert.match(posted.json.error, /Desktop control is part of Pro/);
    const held = await s.api("/antigravity/install", { method: "POST", body: {} });
    assert.equal(held.status, 200);
    assert.equal(held.json.needsConfirm, true);
    const ui = fs.readFileSync(path.join(ROOT, "web", "features", "antigravity.js"), "utf8");
    assert.match(ui, /Desktop control is part of Pro/);
    assert.equal(ui.includes("\u2014"), false);
  } finally { await s.stop(); }
});
