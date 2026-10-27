// Freebuff as a free coder inside Meldmind (0.4.22). Recorded screens in test/fixtures/freebuff, a fake terminal
// (no tmux, no network, no real Freebuff). Covers the model pick rules, idle, ads, limits, sign-in, masking before
// paste, the plugin routes, the "not available on this computer" message and the hook registration guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-freebuff-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const A = await import("../server/freebuff-agent.js");
const { makeRoutes } = await import("../server/plugins/freebuff.js");

const FIX = path.join(ROOT, "test", "fixtures", "freebuff");
const fx = (n) => fs.readFileSync(path.join(FIX, `${n}.txt`), "utf8").replace(/\r\n/g, "\n");

// ---------- pure functions on recorded screens ----------
test("model pick: accepts MiMo Flash Fast, refuses training, Space Bunny, priced and locked rows", () => {
  assert.equal(A.modelDecision(fx("selected-mimo")).action, "choose");
  const down = A.modelDecision(fx("picker-default"));
  assert.equal(down.action, "down");
  assert.match(down.row, /DeepSeek/);
  for (const [name, want] of [["training", "DeepSeek V4.1 Flash"], ["bunny", "Space Bunny Alpha"], ["priced", "Pro Coder Max"], ["locked", "GPT-6 Luna"]]) {
    const d = A.modelDecision(fx(`selected-${name}`), want);
    assert.equal(d.action, "refuse", name);
    assert.ok(d.reason.length > 10);
  }
  assert.equal(A.isSafeModelText("MiMo v2.6 Flash Fast 2x"), true);
  for (const bad of ["x May use data for AI training", "Space Bunny Alpha", "Pro $20/mo", "Upgrade to use", "Locked"]) assert.equal(A.isSafeModelText(bad), false, bad);
  assert.equal(A.modelDecision("nothing here").action, "wait");
});

test("the status bar must show the chosen model before anything is pasted", () => {
  assert.equal(A.statusShowsModel(fx("idle")), true);
  assert.equal(A.statusShowsModel(fx("idle").replace("MiMo v2.6 Flash Fast", "DeepSeek V4.1 Flash")), false);
  assert.equal(A.statusShowsModel(fx("idle").replace("MiMo v2.6 Flash Fast", "MiMo v2.6 Flash Fast Space Bunny")), false);
  assert.equal(A.statusShowsModel(fx("picker-default")), false);
  assert.equal(A.modelFromStatus(fx("idle")), "MiMo v2.6 Flash Fast");
});

test("idle detection: input box back and no working line", () => {
  assert.equal(A.isIdle(fx("idle")), true);
  assert.equal(A.isIdle(fx("answer-with-ad")), true);
  assert.equal(A.isIdle(fx("working")), false);
  assert.equal(A.isBusy(fx("working")), true);
  assert.equal(A.isIdle(fx("picker-default")), false);
});

test("ad box is stripped from the answer and kept as a sponsored line", () => {
  const screen = fx("answer-with-ad");
  const clean = A.cleanTranscript(screen);
  assert.ok(!/Archil|Not now|ads:|Sponsored|Set it up/.test(clean));
  assert.ok(!/Enter a coding task|to change|hours remaining/.test(clean));
  assert.match(clean, /return a \+ b;/);
  const ad = A.extractAd(screen);
  assert.match(ad.text, /Archil/);
  assert.ok(!/ads:|Not now/.test(ad.text));
  assert.equal(A.extractAd(fx("idle")), null);
  const ans = A.answerFrom(screen, "Write a function add(a, b) that returns the sum");
  assert.match(ans, /^Here is the function:/);
  assert.match(ans, /did not change any other file/);
});

test("limits are found and said in plain words", () => {
  assert.equal(A.detectLimit(fx("limit-concurrent")).kind, "concurrent");
  assert.equal(A.detectLimit(fx("limit-daily")).kind, "daily");
  assert.equal(A.detectLimit(fx("limit-session")).kind, "session");
  assert.equal(A.detectLimit(fx("idle")), null);
  assert.equal(A.detectLimit(fx("answer-with-ad")), null);
  for (const k of ["limit-concurrent", "limit-daily", "limit-session"]) {
    const m = A.detectLimit(fx(k)).message;
    assert.ok(!/[—–]/.test(m));
    assert.ok(!/concurrent-session/i.test(m));
  }
  assert.deepEqual(A.hoursLeft(fx("idle")), { left: 30, total: 30 });
  assert.equal(A.minutesLeft(fx("idle")), 42);
});

test("sign-in link is found; an idle (signed in) screen has none; http links are ignored", () => {
  const s = A.detectSignIn(fx("signin"));
  assert.equal(s.needed, true);
  assert.equal(s.url, "https://www.codebuff.com/login?auth_code=abc123.def456&next=cli");
  assert.equal(A.detectSignIn(fx("idle")).needed, false);
  assert.equal(A.detectSignIn("Please sign in at http://evil.example/x").url, null);
});

test("the request is masked before paste, and anything still like a key is refused", () => {
  assert.match(A.prepareTask("my SSN is 123-45-6789, fix the form"), /\*\*\*-\*\*-6789/);
  assert.ok(!A.prepareTask("my SSN is 123-45-6789").includes("123-45"));
  for (const bad of ["use sk-ant-api03-abcdefghijklmnopqrstuvwx", "token ghp_abcdefghijklmnopqrstuvwxyz0123", "-----BEGIN RSA PRIVATE KEY-----", "api_key = abcd1234abcd1234abcd", "AKIAABCDEFGHIJKLMNOP"]) {
    assert.throws(() => A.prepareTask(bad), (e) => e.code === "secret" && e.status === 400, bad);
  }
  assert.throws(() => A.prepareTask("   "), /Type what you want/);
  assert.equal(A.prepareTask("add a function that adds two numbers"), "add a function that adds two numbers");
  assert.ok(A.secretEnvNames({ OPENAI_API_KEY: "x", PATH: "y", GH_TOKEN: "z" }).includes("OPENAI_API_KEY"));
  assert.equal(A.cleanEnv({ OPENAI_API_KEY: "x", PATH: "y" }).OPENAI_API_KEY, undefined);
});

// ---------- a fake Freebuff in a fake terminal ----------
const ROWS = ["DeepSeek V4.1 Flash        1x   May use data for AI training", "Muse Spark 1.3             1x   May use data for AI training", "MiMo v2.6 Flash Fast       2x", "Space Bunny Alpha          1x   Free, prompts are kept", "GPT-6 Luna                 4x"];
function fakeFreebuff(opts = {}) {
  const f = { mode: opts.start || "idle", sel: 0, model: "DeepSeek V4.1 Flash", pasted: [], downs: 0, keys: [], closed: false, reads: 0, workFor: opts.workFor ?? 3, rows: opts.rows || ROWS, typed: "", limitAfter: opts.limitAfter || null };
  const box = (t) => `╭────────────╮\n│ ${t} │\n╰────────────╯`;
  const bar = () => ` /model to change  ${f.model}   40m left`;
  f.screen = async () => {
    f.reads++;
    if (f.mode === "signin") return fx("signin");
    if (f.mode === "limit") return fx("limit-concurrent");
    if (f.mode === "picker") return ` Choose a model\n╭────╮\n${f.rows.map((r, i) => `│ ${i === f.sel ? "›" : " "} ${r} │`).join("\n")}\n╰────╯`;
    if (f.mode === "working") {
      if (--f.workFor < 0) {
        if (f.limitAfter) { f.mode = "limit"; return f.screen(); }
        f.mode = "idle"; f.answered = true;
      } else return ` You: ${f.pasted.at(-1)}\n Thinking... working...\n${box("Add to the current task")}\n${bar()}`;
    }
    const ans = f.answered ? ` You: ${f.pasted.at(-1)}\n\n Here is the answer: done.\n\n╭─ Sponsored ─╮\n│ Archil: shared disks │\n│ [ Set it up ]   Not now │\n│ /ads:accept-proposal │\n╰─────╯\n` : "";
    return ` Freebuff  30/30 hours remaining\n${ans}${box("Enter a coding task")}\n${bar()}`;
  };
  f.visible = f.screen;
  f.type = async (t) => { f.typed += t; };
  f.paste = async (t) => { f.pasted.push(t); };
  f.key = async (k) => {
    f.keys.push(k);
    if (k === "Enter") {
      if (f.mode === "picker") { f.model = f.rows[f.sel].split(/\s{2,}/)[0].trim(); f.mode = "idle"; }
      else if (/^\/model/.test(f.typed)) { f.typed = ""; f.mode = "picker"; f.sel = 0; }
      else if (f.mode === "idle" && f.pasted.length) f.mode = "working";
    } else if (k === "Down") { f.downs++; f.sel = Math.min(f.sel + 1, f.rows.length - 1); }
    else if (k === "Escape" && f.mode === "picker") f.mode = "idle";
  };
  f.close = async () => { f.closed = true; };
  return f;
}
const fakeDriver = (f, id = "fake") => ({ id, available: async () => true, start: async ({ cwd }) => { f.cwd = cwd; return f; } });
const FAST = { startMs: 2000, pollMs: 3, pickWaitMs: 1, idleMs: 20, maxMs: 3000, pickSteps: 12 };
function manager(f, extra = {}) {
  const mem = {}; const calls = { mark: [], clear: 0 };
  const m = A.createFreebuff({
    driver: fakeDriver(f), installed: () => true, timing: FAST, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), workRoot: path.join(DIR, "work"),
    saved: { get: () => mem, set: (v) => Object.assign(mem, v) },
    trouble: { mark: (k, d) => calls.mark.push([k, d]), clear: () => { calls.clear++; }, active: async () => false }, ...extra,
  });
  return { m, calls, mem };
}

test("start picks the safe model (moving Down past the training rows) and is ready", async () => {
  const f = fakeFreebuff(); const { m, mem } = manager(f);
  const v = await m.start({ folder: path.join(DIR, "proj") });
  assert.equal(v.phase, "ready");
  assert.equal(v.model, "MiMo v2.6 Flash Fast");
  assert.equal(f.model, "MiMo v2.6 Flash Fast");
  assert.equal(f.downs, 2);
  assert.equal(f.cwd, path.join(DIR, "proj"));
  assert.equal(mem.enabled, true);
  assert.equal(v.free, true);
  assert.equal(m.isReady(), true);
  await m.stop();
  assert.equal(f.closed, true);
});

test("ask pastes the masked text only after the model is verified and returns the cleaned answer with the ad apart", async () => {
  const f = fakeFreebuff(); const { m } = manager(f);
  await m.start({ folder: path.join(DIR, "p2") });
  const r = await m.ask("fix the form, my SSN is 123-45-6789", { folder: path.join(DIR, "p2") });
  assert.equal(f.pasted.length, 1);
  assert.ok(!f.pasted[0].includes("123-45"), "SSN never reaches the terminal");
  assert.match(f.pasted[0], /\*\*\*-\*\*-6789/);
  assert.equal(r.free, true);
  assert.equal(r.provider, "freebuff");
  assert.match(r.text, /Here is the answer: done\./);
  assert.ok(!/Archil|ads:|Not now/.test(r.text));
  assert.equal(r.ad.label, "Sponsored (Freebuff)");
  assert.match(r.ad.text, /Archil/);
  assert.equal(f.keys.at(-1), "Enter");
  await m.stop();
});

test("a key in the request is refused and nothing is pasted", async () => {
  const f = fakeFreebuff(); const { m } = manager(f);
  await m.start({ folder: path.join(DIR, "p3") });
  await assert.rejects(m.ask("use sk-ant-api03-abcdefghijklmnopqrstuvwx to call it"), (e) => e.code === "secret");
  assert.equal(f.pasted.length, 0);
  await m.stop();
});

test("when the safe model is not offered nothing is pasted and the window is closed", async () => {
  const f = fakeFreebuff({ rows: [ROWS[0], ROWS[1], ROWS[3]] }); const { m } = manager(f);
  await assert.rejects(m.start({ folder: path.join(DIR, "p4") }), (e) => e.code === "model");
  assert.equal(f.pasted.length, 0);
  assert.equal(f.closed, true);
  const d = fakeFreebuff({ rows: ["MiMo v2.6 Flash Fast       2x   May use data for AI training"] }); const m2 = manager(d).m;
  await assert.rejects(m2.start({ folder: path.join(DIR, "p4") }), (e) => e.code === "model" && /not safe/.test(e.message));
  assert.equal(d.pasted.length, 0);
});

test("sign-in: the link is shown once as a button label, never typed into, and the session goes on after sign-in", async () => {
  const f = fakeFreebuff({ start: "signin" }); const { m } = manager(f);
  const v = await m.start({ folder: path.join(DIR, "p5") });
  assert.equal(v.phase, "signin");
  assert.equal(v.signin.label, "Open this link to sign in to Freebuff (free)");
  assert.match(v.signin.url, /^https:\/\/www\.codebuff\.com\/login/);
  assert.equal(f.typed, "");
  await assert.rejects(m.ask("hello there"), (e) => e.code === "signin");
  assert.equal(f.pasted.length, 0);
  f.mode = "idle"; // the person signed in
  const s = await m.status();
  assert.equal(s.phase, "ready");
  assert.equal(s.signin, null);
  await m.stop();
});

test("the concurrent-session limit marks Freebuff out with a plain reason and the next AI takes over", async () => {
  const f = fakeFreebuff({ limitAfter: true }); const { m, calls } = manager(f);
  await m.start({ folder: path.join(DIR, "p6") });
  await assert.rejects(m.ask("write a loop"), (e) => e.code === "limit" && e.status === 429);
  assert.equal(calls.mark.length >= 1, true);
  assert.equal(calls.mark[0][0], "rate");
  assert.match(calls.mark[0][1], /another window/);
  assert.equal(m.isReady(), false);
  const step = await A.freebuffStep({ title: "Write a loop", instructions: "" }, { ask: async () => { throw Object.assign(new Error("Freebuff is already running in another window"), { code: "limit" }); } });
  assert.equal(step.ok, false);
  assert.match(step.reason, /another window/);
  await m.stop();
});

test("the daily limit at start is reported and marked out", async () => {
  const f = fakeFreebuff({ start: "limit" }); f.screen = async () => fx("limit-daily");
  const { m, calls } = manager(f);
  const v = await m.start({ folder: path.join(DIR, "p7") });
  assert.equal(v.phase, "limit");
  assert.equal(v.limit, "daily");
  assert.equal(calls.mark[0][0], "credits");
  assert.match(v.message, /tomorrow/);
});

test("no terminal: the plain message is shown, and no driver is invented", async () => {
  const { m } = manager(fakeFreebuff(), { driver: null });
  await assert.rejects(m.start({}), (e) => e.status === 501 && e.message === A.NO_TERMINAL);
  assert.equal(A.NO_TERMINAL, "Freebuff needs the built-in terminal, which is not available on this computer yet.");
  const s = await m.status();
  assert.equal(s.message, A.NO_TERMINAL);
  assert.equal(s.terminalAvailable, false);
  assert.equal(m.isReady(), false);
  const pty = A.ptyDriver({ load: async () => { throw new Error("Cannot find package node-pty"); } });
  assert.equal(await pty.available(), false);
  await assert.rejects(pty.start({ cwd: DIR }), /built-in terminal/);
  assert.equal(await A.detectDriver([{ id: "a", available: async () => false }, pty]), null);
  assert.equal((await A.detectDriver([{ id: "a", available: async () => false }, { id: "b", available: async () => true }])).id, "b");
});

test("freebuff not installed gives a plain install line", async () => {
  const { m } = manager(fakeFreebuff(), { installed: () => false });
  await assert.rejects(m.start({}), (e) => e.code === "not-installed" && /npm install -g freebuff/.test(e.message));
});

test("tmux driver uses argument arrays (no shell string) and keeps secrets out of the Freebuff process", async () => {
  const calls = [];
  const d = A.tmuxDriver({ run: async (cmd, args, o) => { calls.push({ cmd, args, o }); return "ok"; }, exe: "tmux", freebuff: () => "/bin/freebuff", env: { OPENAI_API_KEY: "x", PATH: "/bin" } });
  const term = await d.start({ cwd: DIR });
  const first = calls[0];
  assert.equal(first.cmd, "tmux");
  assert.ok(Array.isArray(first.args));
  assert.deepEqual(first.args.slice(-6), ["env", "-u", "OPENAI_API_KEY", "/bin/freebuff", "--cwd", DIR].slice(-6));
  assert.ok(first.args.includes("new-session") && first.args.includes("-d"));
  await term.paste("hello");
  const load = calls.find((c) => c.args[0] === "load-buffer");
  assert.equal(load.o.input, "hello");
  assert.ok(calls.some((c) => c.args[0] === "paste-buffer" && c.args.includes("-p")));
  await term.key("Down");
  assert.deepEqual(calls.at(-1).args.slice(0, 1), ["send-keys"]);
  assert.ok(calls.every((c) => c.args.every((a) => typeof a === "string")));
});

// ---------- plugin routes ----------
function call(routes, method, url, body) {
  return new Promise(async (resolve) => {
    const h = { DATA_DIR: DIR, json: (_res, status, payload) => resolve({ status, json: payload }) };
    const u = new URL(url, "http://x");
    const r = await routes({ method }, {}, u, body, h);
    if (r === false) resolve({ status: 404, json: null });
  });
}
test("plugin routes: status, start, ask, stop and errors", async () => {
  const f = fakeFreebuff(); const { m } = manager(f);
  const routes = makeRoutes(m);
  let r = await call(routes, "GET", "/api/freebuff/status");
  assert.equal(r.status, 200);
  assert.equal(r.json.installed, true);
  assert.equal(r.json.running, false);
  r = await call(routes, "POST", "/api/freebuff/ask", { text: "" });
  assert.equal(r.status, 400);
  // 0.4.23 (audit X5): the page may only name a folder inside Meldmind's projects folder
  r = await call(routes, "POST", "/api/freebuff/start", { folder: path.join(DIR, "r1") });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "folder");
  fs.mkdirSync(path.join(DIR, "projects", "r1"), { recursive: true });
  r = await call(routes, "POST", "/api/freebuff/start", { folder: path.join(DIR, "projects", "r1") });
  assert.equal(r.status, 200);
  assert.equal(r.json.phase, "ready");
  r = await call(routes, "POST", "/api/freebuff/ask", { text: "add two numbers" });
  assert.equal(r.status, 200);
  assert.match(r.json.text, /Here is the answer/);
  assert.equal(r.json.label, "Free");
  r = await call(routes, "POST", "/api/freebuff/ask", { text: "key sk-ant-api03-abcdefghijklmnopqrstuvwx" });
  assert.equal(r.status, 400);
  r = await call(routes, "POST", "/api/freebuff/stop");
  assert.equal(r.json.phase, "stopped");
  assert.equal((await call(routes, "GET", "/api/freebuff/nope")).status, 404);
});

test("plugin without a driver says so plainly", async () => {
  const { m } = manager(fakeFreebuff(), { driver: null });
  const r = await call(makeRoutes(m), "POST", "/api/freebuff/start", {});
  assert.equal(r.status, 501);
  assert.equal(r.json.error, A.NO_TERMINAL);
});

// ---------- hooks ----------
test("hook registration is guarded when the setter or module is missing", () => {
  assert.equal(A.registerFreeBuffHooks(null), false);
  assert.equal(A.registerFreeBuffHooks({}), false);
  let got = null;
  assert.equal(A.registerFreeBuffHooks({ setFreeBuffHooks: (h) => { got = h; } }), true);
  assert.equal(typeof got.freebuffReady, "function");
  assert.equal(typeof got.freebuffRun, "function");
  assert.equal(typeof A.freebuffReady(), "boolean");
  const wire = fs.readFileSync(path.join(ROOT, "server", "free-first-wire.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(wire, /registerFreeBuffHooks\(m\)/);
  assert.match(wire, /import\("\.\/free-bids\.js"\)/);
});

test("a mission code step uses Freebuff first and hands on when it cannot", () => {
  const mission = fs.readFileSync(path.join(ROOT, "server", "mission.js"), "utf8").replace(/\r\n/g, "\n");
  assert.match(mission, /t\.capability === "code" && !isPrivate && freebuffReady\(\)/);
  assert.match(mission, /freebuffStep\(t/);
});

// ---------- the page ----------
test("the Free coder card: labels, registry row, no dashes", () => {
  const page = fs.readFileSync(path.join(ROOT, "web", "features", "freebuff.js"), "utf8").replace(/\r\n/g, "\n");
  for (const s of ["Free coder (Freebuff)", "Set up (one-time sign in)", "Ask the free coder", "Sponsored (Freebuff)", "/freebuff/ask", "/freebuff/status"]) assert.ok(page.includes(s), s);
  assert.equal(/[—–]/.test(page), false);
  assert.match(fs.readFileSync(path.join(ROOT, "web", "perf", "registry.js"), "utf8"), /id: "freebuff", settings: true/);
  for (const f of ["server/freebuff-agent.js", "server/plugins/freebuff.js"]) assert.equal(/[—–]/.test(fs.readFileSync(path.join(ROOT, f), "utf8")), false, f);
});

test("the blocked pins were flipped on purpose: Freebuff is allowed, Space Bunny is not", async () => {
  const { isBlockedFree } = await import("../server/savings.js");
  assert.equal(isBlockedFree({ name: "Freebuff" }), false);
  assert.equal(isBlockedFree({ name: "Freebuff Space Bunny Alpha" }), true);
  assert.equal(A.WANT_MODEL, "MiMo v2.6 Flash Fast");
});
