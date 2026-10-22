#!/usr/bin/env node
// A stand-in for an official AI command-line app (Claude Code, Codex, Gemini CLI). Tests set FAKE_SUBCLI_MODE.
// No network. It reads the question from stdin, as the real apps do in print / exec mode.
import fs from "node:fs";
import { spawn } from "node:child_process";

const mode = process.env.FAKE_SUBCLI_MODE || "ok";
const log = process.env.FAKE_SUBCLI_LOG || "";
const args = process.argv.slice(2);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => {
  if (log) fs.writeFileSync(log, JSON.stringify({ args, input, cwd: process.cwd(), keys: Object.keys(process.env).filter((k) => /KEY|TOKEN|SECRET/i.test(k)) }));
  if (mode === "signin") { process.stderr.write("Not logged in. Please run /login\n"); process.exit(1); }
  if (mode === "quota") { process.stderr.write("Usage limit reached for your plan. Try again later.\n"); process.exit(1); }
  if (mode === "hang") {
    // a grandchild too, so the test can check the whole tree is stopped
    const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    if (process.env.FAKE_SUBCLI_PIDFILE) fs.writeFileSync(process.env.FAKE_SUBCLI_PIDFILE, JSON.stringify({ pid: process.pid, kid: kid.pid }));
    setInterval(() => {}, 1000);
    return;
  }
  const q = input.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";
  process.stdout.write(`Answer from the fake app: ${q}\n`);
  process.exit(0);
});
