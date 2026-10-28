// 0.4.24 engine stability. The engine shares Electron's main process, so any long synchronous job there is an
// "engine stuck" for the whole app. These tests cover: mission history no longer re-read on every call, the ledger
// summary reuse, the single-instance takeover, orphan picking, the window waiting for the engine, the reload
// counter ignoring tab changes, and the dark-theme sidebar colours. No Electron and no servers are started.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./helpers.js";

const require = createRequire(import.meta.url);
const inst = require("../electron/instance.cjs");

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "cc-stab-")); }

test("mission history is read once, not on every call", async () => {
  const { FileStore } = await import("../server/store.js");
  const dir = tmpDir();
  try {
    const store = new FileStore(dir);
    for (let i = 0; i < 40; i++) store.saveMission({ id: `m${i}`, title: `t${i}`, startedAt: i, big: "x".repeat(2000) });
    let summarized = 0;
    const summarize = (m) => { summarized++; return { id: m.id, startedAt: m.startedAt }; };
    const realRead = fs.readFileSync; let reads = 0;
    fs.readFileSync = (...a) => { reads++; return realRead(...a); };
    try {
      assert.equal(store.listMissions(summarize).length, 40);
      assert.equal(summarized, 40);
      const afterFirst = reads;
      for (let i = 0; i < 25; i++) assert.equal(store.listMissions(summarize).length, 40);
      assert.equal(summarized, 40, "later calls reuse the first answer");
      assert.equal(reads, afterFirst, "later calls read no files");
      // a saved mission is picked up at once; only that one is read again
      store.saveMission({ id: "m3", title: "changed", startedAt: 99 });
      const out = store.listMissions(summarize);
      assert.equal(summarized, 41);
      assert.equal(out.find((x) => x.id === "m3").startedAt, 99);
      // a new mission shows up too
      store.saveMission({ id: "fresh", startedAt: 5 });
      assert.equal(store.listMissions(summarize).length, 41);
    } finally { fs.readFileSync = realRead; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("warming mission history yields to the event loop", async () => {
  const { FileStore } = await import("../server/store.js");
  const dir = tmpDir();
  try {
    const store = new FileStore(dir);
    for (let i = 0; i < 60; i++) store.saveMission({ id: `w${i}`, startedAt: i });
    let calls = 0;
    const summarize = (m) => { calls++; return { id: m.id }; };
    let ticks = 0; const timer = setInterval(() => { ticks++; }, 1); // a real timer: it only fires if the loop gets a turn
    const warm = store.warmMissions(summarize, { chunk: 4 });
    await new Promise((r) => setTimeout(r, 30)); // a real wait so other work can run between slices
    await warm; clearInterval(timer);
    assert.ok(ticks > 0, "other work ran while the history was being read");
    assert.equal(calls, 60);
    assert.equal(store.listMissions(summarize).length, 60);
    assert.equal(calls, 60, "listing after the warm-up reads nothing more");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the ledger summary is reused until the ledger changes", async () => {
  const { newContext, setDefaultContext, FileStore } = await import("../server/store.js");
  const { summary } = await import("../server/ledger.js");
  const dir = tmpDir();
  try {
    const c = newContext("stab-test", new FileStore(dir)); c.ready = true; setDefaultContext(c);
    c.ledger.push({ ts: Date.now(), kind: "call", provider: "x-test", cost: 1 });
    const a = summary();
    assert.equal(summary(), a, "same ledger, same answer object");
    c.ledger.push({ ts: Date.now(), kind: "call", provider: "x-test", cost: 2 });
    const b = summary();
    assert.notEqual(b, a); assert.equal(b.month, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a lock holder that answers is left alone; a dead or hung one is replaced", async () => {
  const sleep = async () => {};
  const base = { sleep, log: () => {}, selfPid: 10 };
  // got the lock straight away
  assert.equal(await inst.resolveLock({ ...base, requestLock: () => true, readRec: () => null, probe: async () => false, kill: async () => {} }), true);
  // healthy holder: quit quietly, kill nothing
  let killed = [];
  assert.equal(await inst.resolveLock({ ...base, requestLock: () => false, readRec: () => ({ pid: 77, port: 4747 }), alive: () => true, probe: async () => true, kill: async (p) => { killed = p; } }), false);
  assert.deepEqual(killed, []);
  // older build, no record: treated as healthy
  assert.equal(await inst.resolveLock({ ...base, requestLock: () => false, readRec: () => null, probe: async () => false, kill: async () => { throw new Error("must not kill"); } }), false);
  // hung holder: three failed probes, then it is ended and the lock is taken
  let probes = 0, free = false; killed = [];
  const got = await inst.resolveLock({ ...base, requestLock: () => free, readRec: () => ({ pid: 77, port: 4747 }), alive: () => true, probe: async () => { probes++; return false; }, kill: async (p) => { killed = p; free = true; } });
  assert.equal(got, true); assert.equal(probes, 3); assert.deepEqual(killed, [77]);
  // dead holder: no probing, no kill, just retry the lock
  let n = 0;
  assert.equal(await inst.resolveLock({ ...base, requestLock: () => ++n > 2, readRec: () => ({ pid: 77, port: 1 }), alive: () => false, probe: async () => { throw new Error("no probe"); }, kill: async () => { throw new Error("no kill"); } }), true);
});

test("only leftover Meldmind processes of this install are picked", () => {
  const exe = "C:\\Users\\x\\AppData\\Local\\Programs\\Meldmind\\Meldmind.exe";
  const procs = [
    { pid: 10, ppid: 1, exe, cmd: `"${exe}"` },                      // us
    { pid: 11, ppid: 10, exe, cmd: `"${exe}" --type=gpu-process` },    // our helper
    { pid: 12, ppid: 11, exe, cmd: `"${exe}" --type=renderer` },       // our helper's child
    { pid: 25472, ppid: 999, exe, cmd: `"${exe}"` },                   // ghost main
    { pid: 25473, ppid: 25472, exe, cmd: `"${exe}" --type=renderer` }, // ghost helper (its main is listed, and ended with /T)
    { pid: 30, ppid: 4040, exe, cmd: `"${exe}" --type=utility` },      // helper whose parent is gone
    { pid: 40, ppid: 1, exe: "C:\\Other\\Meldmind.exe", cmd: "C:\\Other\\Meldmind.exe" }, // a different copy
  ];
  const pids = inst.pickOrphans({ procs, selfPid: 10, execPath: exe.toUpperCase() });
  assert.deepEqual(pids.sort((a, b) => a - b), [30, 25472]);
});

test("reapOrphans ends only what pickOrphans names", async () => {
  const exe = "C:\\M\\Meldmind.exe"; let ended = []; const lines = [];
  const out = await inst.reapOrphans({ selfPid: 1, execPath: exe, log: (m) => lines.push(m), list: async () => [{ pid: 1, ppid: 0, exe, cmd: exe }, { pid: 2, ppid: 0, exe, cmd: exe }], kill: async (p) => { ended = p; } });
  assert.deepEqual(out, [2]); assert.deepEqual(ended, [2]); assert.equal(lines.length, 1);
});

test("the window waits for the engine with growing pauses, then loads once", async () => {
  const waits = []; let up = false, calls = 0;
  const ok = await inst.waitForEngine({ probe: async () => { calls++; return up; }, sleep: async (ms) => { waits.push(ms); if (waits.length === 3) up = true; }, onWait: () => {} });
  assert.equal(ok, true); assert.deepEqual(waits, [1000, 2000, 4000]); assert.equal(calls, 4);
  // never comes back: gives up after the whole schedule instead of looping
  const w2 = []; const never = await inst.waitForEngine({ probe: async () => false, sleep: async (ms) => { w2.push(ms); } });
  assert.equal(never, false); assert.deepEqual(w2, inst.BACKOFF_MS);
  // a closed window stops the wait
  assert.equal(await inst.waitForEngine({ probe: async () => false, sleep: async () => {}, cancelled: () => true }), false);
});

test("tab changes are not reloads; seven real loads in a minute are", () => {
  let t = 1000; const c = inst.createLoadCounter({ now: () => t });
  for (let i = 0; i < 30; i++) { t += 100; assert.equal(c.note({ isSameDocument: true }).loop, false); } // clicking tabs: #projects, #liveview ...
  for (let i = 0; i < 6; i++) { t += 100; assert.equal(c.note({}).loop, false); }
  t += 100; assert.equal(c.note({}).loop, true);
  t += 100; assert.equal(c.note({}).count, 1, "the count starts over after the loop is handled");
  assert.equal(c.note({ isMainFrame: false }).loop, false);
});

test("the instance record belongs to its writer", () => {
  const dir = tmpDir();
  try {
    inst.writeRecord(dir, { pid: process.pid, port: 4748, instance: "abc" });
    assert.equal(inst.readRecord(dir).port, 4748);
    inst.clearRecord(dir, process.pid + 1); assert.ok(inst.readRecord(dir), "another process's exit does not clear it");
    inst.clearRecord(dir, process.pid); assert.equal(inst.readRecord(dir), null);
    assert.equal(inst.isAlive(process.pid), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("main.cjs uses the lock, orphan and wait helpers, and the loop breaker ignores tab changes", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  assert.match(main, /inst\.resolveLock\(/);
  assert.match(main, /await lockReady/);
  assert.match(main, /inst\.reapOrphans\(/);
  assert.match(main, /isSameDocument/);
  assert.match(main, /inst\.waitForEngine\(/);
  assert.doesNotMatch(main, /showing the engine page instead/);
});

test("dark theme sidebar text is white with a shadow on the translucent panel", () => {
  const css = fs.readFileSync(path.join(ROOT, "web", "mac", "css", "expert.css"), "utf8");
  const block = css.slice(css.indexOf("*/", css.indexOf("0.4.24: dark theme sidebar")));
  assert.match(block, /\[data-theme="dark"\] #mac-side \{[^}]*color: #fff;[^}]*text-shadow:/);
  assert.match(block, /--dim: rgba\(255, 255, 255, \.78\)/);
  assert.doesNotMatch(block, /29, ?29, ?31|91, ?102, ?122|#1d1d1f|#5b667a/i);
  const shell = fs.readFileSync(path.join(ROOT, "web", "mac", "css", "shell.css"), "utf8");
  assert.match(shell, /\[data-theme="dark"\] \{[^}]*--mac-glass2: rgba\(44, 44, 52, \.8\)/);
});
