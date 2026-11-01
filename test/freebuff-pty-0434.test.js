// 0.4.34: Freebuff on Windows. The app ships node-pty, so the built-in terminal driver is picked on Windows and a
// .cmd shim (what npm installs) starts through cmd.exe. The last test runs a tiny fake text screen through the real
// pseudo-terminal on this computer, reads its output, then checks that nothing is left running.
// @helper-process: npm test runs this file on its own on Windows (it starts a child process).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-freebuff-pty-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const A = await import("../server/freebuff-agent.js");

const fakePty = () => ({ spawn: () => { throw new Error("not used"); } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, step = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(step);
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

test("Windows picks the built-in terminal first when node-pty loads", async () => {
  const drivers = A.defaultDrivers("win32", { pty: { load: async () => ({ name: "node-pty", mod: { default: fakePty() } }) } });
  assert.deepEqual(drivers.map((d) => d.id), ["pty", "tmux"]);
  const d = await A.detectDriver(drivers);
  assert.equal(d?.id, "pty");
  // Linux and Mac keep tmux first
  assert.deepEqual(A.defaultDrivers("darwin").map((x) => x.id), ["tmux", "pty"]);
  // the app's own package list starts with Microsoft's node-pty
  assert.equal(A.PTY_PACKAGES[0], "node-pty");
});

test("the terminal is not offered when the package or its binary does not load", async () => {
  const none = A.ptyDriver({ platform: "win32", load: async () => { throw new Error("Cannot find package node-pty"); } });
  assert.equal(await none.available(), false);
  const noBinary = A.ptyDriver({ platform: "win32", load: async () => ({ name: "node-pty", mod: fakePty() }), probe: () => false });
  assert.equal(await noBinary.available(), false);
  assert.equal(await A.detectDriver([noBinary]), null);
});

test("a .cmd shim starts through cmd.exe by its full path and keeps folders with spaces whole", () => {
  const env = { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
  const c = A.ptyCommand("C:\\Users\\Jo Ann\\AppData\\Roaming\\npm\\freebuff.cmd", "C:\\Temp\\my work", { platform: "win32", env });
  assert.equal(c.file, "C:\\Windows\\system32\\cmd.exe");
  assert.equal(c.args, '/d /s /c ""C:\\Users\\Jo Ann\\AppData\\Roaming\\npm\\freebuff.cmd" --cwd "C:\\Temp\\my work""');
  const noComspec = A.ptyCommand("freebuff", "C:\\w", { platform: "win32", env: { SystemRoot: "D:\\Win" } });
  assert.equal(noComspec.file, "D:\\Win\\System32\\cmd.exe");
  assert.equal(A.ptyCommand("freebuff", "C:\\w", { platform: "win32", env: {} }).file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(A.ptyCommand("C:\\bin\\freebuff.exe", "C:\\w", { platform: "win32", env }), { file: "C:\\bin\\freebuff.exe", args: ["--cwd", "C:\\w"] });
  assert.deepEqual(A.ptyCommand("/usr/local/bin/freebuff", "/tmp/w", { platform: "darwin", env }), { file: "/usr/local/bin/freebuff", args: ["--cwd", "/tmp/w"] });
});

test("closing a terminal that already ended does not type into it or kill it again", async () => {
  const writes = []; let killed = 0; let treeKills = 0; let onExit = null;
  const proc = { pid: 4242, write: (d) => writes.push(d), kill: () => { killed++; }, onData: () => {}, onExit: (f) => { onExit = f; } };
  const d = A.ptyDriver({ platform: "win32", load: async () => ({ name: "node-pty", mod: { spawn: () => proc } }), loadXterm: async () => { throw new Error("none"); }, freebuff: () => "C:\\fb.cmd", killTree: async () => { treeKills++; } });
  const term = await d.start({ cwd: DIR });
  onExit({ exitCode: 0 });
  await term.close();
  assert.deepEqual(writes, []);
  assert.equal(killed, 0);
  assert.equal(treeKills, 0);
});

// The real pseudo-terminal: only where node-pty and its binary load (Windows and Mac builds ship it).
const realPty = A.ptyDriver();
const hasPty = await realPty.available();

test("a fake text screen runs through the real pseudo-terminal and is stopped afterwards", { skip: hasPty ? false : "node-pty is not available here", timeout: 120000 }, async () => {
  const work = path.join(DIR, "work folder");
  fs.mkdirSync(work, { recursive: true });
  const pidFile = path.join(DIR, "fake.pid");
  const script = path.join(DIR, "fake-tui.cjs");
  fs.writeFileSync(script, [
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    "const at = process.argv.indexOf('--cwd');",
    "process.stdout.write('FAKE TUI cwd=' + (at > 0 ? process.argv[at + 1] : '?') + '\\r\\nEnter a coding task\\r\\n> ');",
    "const rl = require('readline').createInterface({ input: process.stdin });",
    "rl.on('line', (l) => process.stdout.write('\\r\\necho: ' + l.trim() + '\\r\\n> '));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  let bin;
  if (process.platform === "win32") {
    // a .cmd shim in a folder with a space, like the one npm writes for freebuff
    const shimDir = path.join(DIR, "npm bin");
    fs.mkdirSync(shimDir, { recursive: true });
    bin = path.join(shimDir, "fake-freebuff.cmd");
    fs.writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    bin = path.join(DIR, "fake-freebuff");
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(bin, 0o755);
  }
  const d = A.ptyDriver({ freebuff: () => bin });
  const term = await d.start({ cwd: work, cols: 120, rows: 30 });
  let fakePid = 0;
  try {
    const first = await waitFor(async () => (/Enter a coding task/.test(await term.screen()) ? await term.screen() : ""), 30000);
    assert.match(first, /Enter a coding task/, "the fake screen showed its prompt");
    assert.ok(first.replace(/\s+/g, " ").includes(`cwd=${work}`), "the folder reached the program in one piece");
    fakePid = Number(fs.readFileSync(pidFile, "utf8"));
    assert.ok(fakePid > 0);
    await term.type("hello from meldmind");
    await sleep(300);
    await term.key("Enter");
    const after = await waitFor(async () => (/echo: hello from meldmind/.test(await term.screen()) ? await term.screen() : ""), 30000);
    assert.match(after, /echo: hello from meldmind/, "typed text came back through the terminal");
  } finally {
    await term.close();
  }
  if (fakePid) {
    const gone = await waitFor(() => !alive(fakePid), 20000, 500);
    assert.ok(gone, "the fake program is not left running");
  }
  if (term.pid) {
    const shellGone = await waitFor(() => !alive(term.pid), 20000, 500);
    assert.ok(shellGone, "the terminal's own process is not left running");
  }
  await sleep(1500); // node-pty lets go of its pipes a moment after close
});
