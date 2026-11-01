// 0.4.28: after "Update and restart" the new version must start even when the installer's own restart does not.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { relaunchScript, startRelaunchHelper } = require("../electron/relaunch.cjs");
const ROOT = path.resolve(import.meta.dirname, "..");

test("the helper waits for this copy and the installer, then starts Meldmind only if none is running", () => {
  const s = relaunchScript("C:\\Users\\o'neil\\AppData\\Local\\Programs\\Meldmind\\Meldmind.exe", 4242);
  assert.match(s, /\$old=4242/);
  assert.match(s, /Get-Process -Id \$old/);
  assert.match(s, /Meldmind-Setup\*/);
  assert.match(s, /if\(-not \(Get-Process -Name 'Meldmind'\)\)\{Start-Process -FilePath 'C:\\Users\\o''neil\\/);
});

test("the helper script parses as PowerShell", { skip: process.platform !== "win32" }, () => {
  const s = relaunchScript("C:\\Program Files\\Meldmind\\Meldmind.exe", 1);
  const check = `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseInput(@'\n${s}\n'@,[ref]$null,[ref]$e);if($e){$e|%{$_.Message};exit 1}else{'ok'}`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", check], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("it starts hidden and detached on Windows packaged builds only", () => {
  const calls = [];
  const fake = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  assert.equal(startRelaunchHelper({ platform: "darwin", spawnFn: fake }), false);
  assert.equal(startRelaunchHelper({ platform: "win32", packaged: false, spawnFn: fake }), false);
  assert.equal(calls.length, 0);
  assert.equal(startRelaunchHelper({ platform: "win32", packaged: true, exePath: "C:\\M\\Meldmind.exe", pid: 7, spawnFn: fake }), true);
  assert.equal(calls[0].cmd, "powershell.exe");
  assert.ok(calls[0].args.includes("Hidden"));
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.windowsHide, true);
});

test("quitting for an update frees the one-copy lock and starts the helper", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  const hook = main.slice(main.indexOf("beforeQuit: () => {"), main.indexOf("beforeQuit: () => {") + 400);
  assert.match(hook, /app\.releaseSingleInstanceLock\(\)/);
  assert.match(hook, /inst\.clearRecord\(userData, process\.pid\)/);
  assert.match(hook, /relaunch\.startRelaunchHelper\(/);
});
