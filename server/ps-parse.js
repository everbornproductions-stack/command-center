// 0.4.38 (dogfood 0436 batch-rename): an AI's rename-photos.ps1 did not even parse ("Missing argument in parameter list")
// and was saved as done; ps-lint.js only reads known traps. The script is now handed to PowerShell's own parser, which
// reads it and never runs it: a separate powershell.exe, the text on stdin, no profile, stopped after 5 seconds. A parse
// error fails the step's check with the line and the message, so the AI fixes it. Off Windows, or when PowerShell cannot
// start, nothing is checked.
import { spawn } from "node:child_process";

export const PS_PARSE_MS = 5000;

// Parser::ParseInput only builds the syntax tree; nothing in the script is run. Up to 3 errors, one JSON line out.
const PARSE = [
  "[Console]::InputEncoding = [System.Text.Encoding]::UTF8",
  "$t = [Console]::In.ReadToEnd()",
  "$e = $null",
  "[void][System.Management.Automation.Language.Parser]::ParseInput($t, [ref]$null, [ref]$e)",
  "$out = @($e | Select-Object -First 3 | ForEach-Object { @{ line = $_.Extent.StartLineNumber; message = $_.Message } })",
  "[Console]::Out.Write((ConvertTo-Json -InputObject @{ errors = $out } -Compress -Depth 3))",
].join("; ");

/** Parse a PowerShell script without running it. Resolves { ok, errors?, skipped? }; never throws. */
export function psParse(text, { ms = PS_PARSE_MS, exe = "powershell.exe", platform = process.platform } = {}) {
  if (platform !== "win32") return Promise.resolve({ ok: true, skipped: true });
  return new Promise((resolve) => {
    let done = false, out = "", child = null;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { child?.kill(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: true, skipped: true, timedOut: true }), ms);
    try {
      const encoded = Buffer.from(PARSE, "utf16le").toString("base64");
      child = spawn(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => { out += c; });
      child.on("error", () => finish({ ok: true, skipped: true }));
      child.on("close", () => {
        try {
          const j = JSON.parse(out.trim());
          const errors = (Array.isArray(j.errors) ? j.errors : j.errors ? [j.errors] : []).map((e) => ({ line: Number(e.line) || 0, message: String(e.message || "").trim().slice(0, 200) }));
          finish(errors.length ? { ok: false, errors } : { ok: true });
        } catch { finish({ ok: true, skipped: true }); }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(String(text || ""));
    } catch { finish({ ok: true, skipped: true }); }
  });
}

/** The words a failed parse puts on the step. */
export const psParseLine = (name, errors) => {
  const e = errors[0] || {};
  return `${name} has a PowerShell syntax error${e.line ? ` on line ${e.line}` : ""}: ${String(e.message || "it does not parse").replace(/\s+/g, " ").replace(/\.$/, "")}. Fix it so the whole script parses.`;
};
