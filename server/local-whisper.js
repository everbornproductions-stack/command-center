// Local Whisper, when a whisper program is installed or CC_WHISPER_BIN points at one.
// No API key is placed on the command line. A miss falls through to a connected AI.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function findOnPath() {
  const names = process.platform === "win32" ? ["whisper.exe", "whisper.cmd", "whisper"] : ["whisper"];
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch { /* next */ }
    }
  }
  return null;
}

export function resolveWhisper() {
  const set = process.env.CC_WHISPER_BIN;
  if (set === "off" || set === "0" || set === "false") return null;
  if (set) {
    if (/\.(mjs|cjs|js)$/i.test(set)) return { cmd: process.execPath, prefix: [path.resolve(set)] };
    return { cmd: set, prefix: [] };
  }
  const found = findOnPath();
  if (!found) return null;
  return { cmd: found, prefix: [] };
}

function run(cmd, args, ms) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const take = (prev, chunk) => (prev + chunk.toString("utf8")).slice(-20000);
    child.stdout.on("data", (c) => { stdout = take(stdout, c); });
    child.stderr.on("data", (c) => { stderr = take(stderr, c); });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      reject(new Error("timeout"));
    }, ms);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error("whisper failed"));
    });
  });
}

function readTranscript(dir, stdout) {
  const named = path.join(dir, "in.txt");
  if (fs.existsSync(named)) return fs.readFileSync(named, "utf8").trim();
  const other = fs.readdirSync(dir).find((f) => f.endsWith(".txt") && f !== "in.webm");
  if (other) return fs.readFileSync(path.join(dir, other), "utf8").trim();
  return String(stdout || "").trim();
}

export async function transcribeWhisper(audio) {
  const spec = resolveWhisper();
  if (!spec || !audio?.buf?.length) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-whisper-"));
  try {
    const file = path.join(dir, "in.webm");
    fs.writeFileSync(file, audio.buf);
    const { stdout } = await run(spec.cmd, [...spec.prefix, "--output_format", "txt", "--output_dir", dir, "--model", "tiny", file], 20000);
    const text = readTranscript(dir, stdout);
    if (!text) return null;
    return { text, provider: "whisper", model: "local" };
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
