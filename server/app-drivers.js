// Real doors for an allowed app: Edge through Playwright, a signed-in profile only
// after an explicit opt-in, Windows UI Automation, and a screenshot computer-use call.
// Tests inject hooks and set CC_APP_DRIVERS=fake so none of this opens a browser,
// reads a real profile, runs PowerShell, or calls a model. No key is written into a log.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import { PROVIDERS } from "./registry.js";
import { hasSecret, getSecret } from "./vault.js";

// Payment pages: Stripe (stripe.com, buy.stripe.com, checkout.stripe.com, billing.stripe.com) and other
// payment services, plus any billing or checkout path or screen title. Refused whatever the task says.
const PAYMENT_HOST = /(^|\.)(stripe\.com|stripe\.network|paypal\.com|paypal\.me|venmo\.com|cash\.app)$/i
const BILLING_PATH = /\/(billing|checkout|payment-methods?|payment_methods?)(\/|$)/i;
export const PAYMENT_SCREEN = /stripe|billing|checkout|payment/i;
export const PAYMENT_REFUSAL = "Stripe, payment and billing screens are refused.";

let hooks = {};

export function setDriverHooks(next) {
  hooks = { ...(next || {}) };
}
export function resetDriverHooks() {
  hooks = {};
}
export function liveBlocked() {
  return process.env.CC_APP_DRIVERS === "fake";
}

function bad(message, status = 400, code = "driver") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function scrub(text) {
  return String(text || "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "")
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "")
    .replace(/xai-[A-Za-z0-9_-]+/g, "")
    .replace(/Bearer\s+\S+/gi, "");
}

export const PRIVATE_REFUSAL = "A website door has to be a public https address. Local, private and file addresses are refused.";

// True for an IPv4 address that is not on the public internet.
function privateV4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0 && Number(m[3]) === 0) || (a === 198 && (b === 18 || b === 19));
}

// A door is public https only: no file:, no http:, no login in the address, no localhost,
// no single-word machine names, no .local/.lan/.internal names, no private or IPv6 literal ranges.
function privateReason(u) {
  if (u.protocol !== "https:") return PRIVATE_REFUSAL;
  if (u.username || u.password) return PRIVATE_REFUSAL;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return PRIVATE_REFUSAL;
  // only a global unicast IPv6 literal (2000::/3) passes
  if (host.startsWith("[")) return /^\[[23][0-9a-f]{0,3}:/.test(host) ? "" : PRIVATE_REFUSAL;
  if (privateV4(host)) return PRIVATE_REFUSAL;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return PRIVATE_REFUSAL;
  if (!host.includes(".")) return PRIVATE_REFUSAL;
  if (/(^|\.)(localhost|local|lan|internal|intranet|home|corp|private|arpa|localdomain)$/.test(host)) return PRIVATE_REFUSAL;
  if (/(^|\.)localhost\./.test(host)) return PRIVATE_REFUSAL;
  // names that turn into any address (a.b.c.d.nip.io is 127.0.0.1 style) are refused by their words
  if (/(^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me|xip\.io|traefik\.me|vcap\.me)$/.test(host)) return PRIVATE_REFUSAL;
  return "";
}

export function blockedUrl(raw) {
  const text = String(raw || "").trim();
  if (!text || /^about:blank$/i.test(text)) return "";
  let u;
  try { u = new URL(text); } catch { return PRIVATE_REFUSAL; }
  if (PAYMENT_HOST.test(u.hostname)) return PAYMENT_REFUSAL;
  if (BILLING_PATH.test(u.pathname)) return PAYMENT_REFUSAL;
  return privateReason(u);
}

export function blockedScreen(title) {
  return PAYMENT_SCREEN.test(String(title || "")) ? PAYMENT_REFUSAL : "";
}

// Owned profile unless the person opted in to their own Edge or Chrome profile.
export function profilePlan(app) {
  const signed = app?.signedIn === true && (app.profile === "edge" || app.profile === "chrome");
  if (!signed) {
    return {
      signedIn: false,
      channel: "msedge",
      browser: "edge",
      dir: path.join(DATA_DIR, "app-profiles", String(app?.id || "app")),
    };
  }
  const base = process.env.LOCALAPPDATA || "";
  if (!base) throw bad("A signed-in profile is only available on Windows.", 400, "profile");
  const chrome = app.profile === "chrome";
  return {
    signedIn: true,
    channel: chrome ? "chrome" : "msedge",
    browser: chrome ? "chrome" : "edge",
    dir: chrome
      ? path.join(base, "Google", "Chrome", "User Data")
      : path.join(base, "Microsoft", "Edge", "User Data"),
  };
}

export async function browserRunning(kind) {
  if (hooks.processes) return !!(await hooks.processes(kind));
  if (liveBlocked()) return false;
  const image = kind === "chrome" ? "chrome" : "msedge";
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("tasklist", ["/FI", `IMAGENAME eq ${image}.exe`, "/NH"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
        resolve(!err && String(stdout).toLowerCase().includes(image));
      });
      return;
    }
    execFile("ps", ["-A", "-o", "comm="], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(String(stdout).toLowerCase().split("\n").some((line) => line.trim() === image));
    });
  });
}

const SNAPSHOT_JS = `const text = (el) => ((el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("name") || el.id || "") + "").trim().slice(0, 80);
  const fields = [...document.querySelectorAll("input, textarea, select")].slice(0, 40).map((el, i) => {
    const ref = "f" + i;
    el.setAttribute("data-cc-ref", ref);
    const type = (el.getAttribute("type") || el.tagName || "").toLowerCase();
    const label = text(el);
    return { ref, label, type, password: type === "password" || /password/i.test(el.getAttribute("autocomplete") || "") || /password/i.test(label) };
  });
  const buttons = [...document.querySelectorAll("button, a, [role=button], input[type=submit]")].slice(0, 40).map((el, i) => {
    const ref = "b" + i;
    el.setAttribute("data-cc-ref", ref);
    return { ref, label: text(el) };
  });
return { url: location.href, title: document.title || "", fields, buttons };
`;

function wrapPage(page, context) {
  return {
    async goto(url) { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }); },
    async snapshot() { return page.evaluate(SNAPSHOT_JS); },
    async click(ref) { await page.locator(`[data-cc-ref="${String(ref).replace(/"/g, "")}"]`).click({ timeout: 8000 }); },
    async type(ref, text) { await page.locator(`[data-cc-ref="${String(ref).replace(/"/g, "")}"]`).fill(String(text ?? ""), { timeout: 8000 }); },
    async close() { try { await context.close(); } catch { /* already closed */ } },
  };
}

export async function openBrowser(plan) {
  if (hooks.browser) return hooks.browser(plan);
  if (liveBlocked()) throw bad("The live browser driver is turned off for tests.", 400, "driver_off");
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw bad("Playwright is not installed, so Meldmind cannot open Edge.", 500, "playwright_missing");
  }
  let context;
  try {
    fs.mkdirSync(plan.dir, { recursive: true });
    context = await chromium.launchPersistentContext(plan.dir, {
      channel: plan.channel,
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ["--no-first-run"],
    });
  } catch {
    throw bad(plan.channel === "chrome" ? "Chrome could not be opened on this computer." : "Microsoft Edge could not be opened on this computer.", 500, "edge_unavailable");
  }
  const page = context.pages()[0] || await context.newPage();
  return wrapPage(page, context);
}

export const UIA_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$hwnd = [FgWin]::GetForegroundWindow()
$procId = [uint32]0
[FgWin]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
$proc = $null
try { $proc = Get-Process -Id $procId -ErrorAction Stop } catch {}
$want = [IO.Path]::GetFileNameWithoutExtension($env:CC_UIA_EXE)
$name = if ($proc) { $proc.ProcessName } else { "" }
if (-not $want -or $name -ne $want) {
  @{ focusLost = $true; foreground = $name } | ConvertTo-Json -Compress
  exit 0
}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
function Test-Password($el) {
  $pw = $false
  try { $pw = [bool]$el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty) } catch {}
  if ($pw) { return $true }
  return $el.Current.Name -match "password"
}
if ($env:CC_UIA_OP -eq "invoke") {
  $id = [string]$env:CC_UIA_ID
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)
  $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if (-not $el) { @{ ok = $false; missing = $true } | ConvertTo-Json -Compress; exit 0 }
  if (Test-Password $el) { @{ ok = $false; password = $true } | ConvertTo-Json -Compress; exit 0 }
  $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  @{ ok = $true } | ConvertTo-Json -Compress
  exit 0
}
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$all = New-Object System.Collections.Generic.List[object]
$queue = New-Object System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]
$queue.Enqueue($root)
while ($queue.Count -gt 0 -and $all.Count -lt 40) {
  $cur = $queue.Dequeue()
  $all.Add(@{
    id = [string]$cur.Current.AutomationId
    name = [string]$cur.Current.Name
    type = [string]$cur.Current.ControlType.ProgrammaticName
    password = (Test-Password $cur)
  })
  $child = $walker.GetFirstChild($cur)
  while ($child) { $queue.Enqueue($child); $child = $walker.GetNextSibling($child) }
}
@{ focusLost = $false; foreground = ($name + ".exe"); nodes = $all } | ConvertTo-Json -Compress -Depth 4
`;

function runPowerShell(script, env) {
  const file = path.join(os.tmpdir(), `meldmind-driver-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(file, script, "utf8");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        try { fs.rmSync(file, { force: true }); } catch { /* temp script */ }
        if (err) reject(bad("Windows could not run that step.", 500, "windows"));
        else {
          try { resolve(JSON.parse(String(stdout || "").trim() || "{}")); }
          catch { reject(bad("Windows returned nothing useful.", 500, "windows")); }
        }
      }
    );
  });
}

export async function readWindow(exe) {
  if (hooks.uia) return hooks.uia({ exe, op: "tree" });
  if (liveBlocked()) throw bad("The live browser driver is turned off for tests.", 400, "driver_off");
  if (process.platform !== "win32") throw bad("Windows UI Automation runs on Windows.", 400, "uia_windows");
  const tree = await runPowerShell(UIA_SCRIPT, { CC_UIA_EXE: String(exe || ""), CC_UIA_OP: "tree", CC_UIA_ID: "" });
  if (tree.nodes && !Array.isArray(tree.nodes)) tree.nodes = [tree.nodes];
  return tree;
}

export async function invokeControl(exe, id) {
  if (hooks.uia) return hooks.uia({ exe, op: "invoke", id });
  if (liveBlocked()) throw bad("The live browser driver is turned off for tests.", 400, "driver_off");
  if (process.platform !== "win32") throw bad("Windows UI Automation runs on Windows.", 400, "uia_windows");
  return runPowerShell(UIA_SCRIPT, { CC_UIA_EXE: String(exe || ""), CC_UIA_OP: "invoke", CC_UIA_ID: String(id || "") });
}

export const SHOT_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FgTitle {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$long = [Math]::Max($bmp.Width, $bmp.Height)
if ($long -gt 1280) {
  $scale = 1280.0 / $long
  $nw = [Math]::Max(1, [int]($bmp.Width * $scale))
  $nh = [Math]::Max(1, [int]($bmp.Height * $scale))
  $small = New-Object System.Drawing.Bitmap $nw, $nh
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.DrawImage($bmp, 0, 0, $nw, $nh)
  $bmp.Dispose()
  $bmp = $small
}
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$title = ""
try {
  $h = [FgTitle]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 240
  [FgTitle]::GetWindowText($h, $sb, 240) | Out-Null
  $title = $sb.ToString()
} catch {}
@{ id = "screen"; width = $bmp.Width; height = $bmp.Height; title = $title; data = [Convert]::ToBase64String($ms.ToArray()) } | ConvertTo-Json -Compress
`;

export async function grabScreen() {
  if (hooks.screen) return hooks.screen();
  if (liveBlocked()) throw bad("The live browser driver is turned off for tests.", 400, "driver_off");
  if (process.platform !== "win32") throw bad("Screenshot control runs on Windows.", 400, "shot_windows");
  return runPowerShell(SHOT_SCRIPT, {});
}

export async function clickAt(x, y) {
  if (hooks.click) return hooks.click({ x, y });
  if (liveBlocked()) throw bad("The live browser driver is turned off for tests.", 400, "driver_off");
  if (process.platform !== "win32") throw bad("Screenshot clicks run on Windows.", 400, "shot_windows");
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Clicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
}
"@
[Clicker]::SetCursorPos([int]$env:CC_CLICK_X, [int]$env:CC_CLICK_Y) | Out-Null
[Clicker]::mouse_event(0x0002, 0, 0, 0, 0)
[Clicker]::mouse_event(0x0004, 0, 0, 0, 0)
@{ ok = $true } | ConvertTo-Json -Compress
`;
  return runPowerShell(script, { CC_CLICK_X: String(Math.round(Number(x) || 0)), CC_CLICK_Y: String(Math.round(Number(y) || 0)) });
}

export function computerTarget() {
  if (hooks.target) return hooks.target();
  if (hasSecret("anthropic", PROVIDERS.anthropic.keyEnv)) return { vendor: "anthropic", model: "claude-haiku-5-5" };
  if (hasSecret("openai", PROVIDERS.openai.keyEnv)) return { vendor: "openai", model: "gpt-6-luna" };
  return null;
}

export function computerRequest({ vendor, model, image, task, width, height }) {
  const picture = String(image?.data || "");
  const words = scrub(task).slice(0, 500);
  if (vendor === "anthropic") {
    return {
      vendor: "anthropic",
      url: "https://api.anthropic.com/v1/messages",
      body: {
        model,
        max_tokens: 400,
        tools: [{ type: "computer_toolset_20260801", name: "computer", display_width_px: width, display_height_px: height }],
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: picture } },
            { type: "text", text: words },
          ],
        }],
      },
    };
  }
  return {
    vendor: "openai",
    url: "https://api.openai.com/v1/responses",
    body: {
      model,
      tools: [{ type: "computer" }],
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: `data:image/png;base64,${picture}` },
          { type: "input_text", text: words },
        ],
      }],
    },
  };
}

export function parseComputerReply(vendor, json) {
  if (vendor === "anthropic") {
    const block = (json?.content || []).find((item) => item?.type === "tool_use" && item.name === "computer");
    const input = block?.input || {};
    const point = Array.isArray(input.coordinate) ? input.coordinate : [input.x, input.y];
    if (input.action === "left_click" || input.action === "click") {
      return { action: "click", x: Number(point[0]), y: Number(point[1]), why: scrub(input.text || input.why || "").slice(0, 80) };
    }
    return { action: "done", why: scrub(json?.content?.find((item) => item?.type === "text")?.text || "").slice(0, 160) };
  }
  const items = json?.output || [];
  for (const item of items) {
    const action = item?.action || item?.computer_call?.action || null;
    if (!action) continue;
    const point = Array.isArray(action.coordinate) ? action.coordinate : [action.x, action.y];
    if (action.type === "click" || action.type === "left_click") {
      return { action: "click", x: Number(point[0]), y: Number(point[1]), why: scrub(action.text || "").slice(0, 80) };
    }
  }
  return { action: "done", why: "" };
}

export async function askComputer(req) {
  if (hooks.computer) return hooks.computer(req);
  if (liveBlocked()) throw bad("The live browser driver is turned off for tests.", 400, "driver_off");
  const provider = PROVIDERS[req.vendor];
  const secret = getSecret(provider.id, provider.keyEnv);
  const key = secret?.key || "";
  if (!key) throw bad("Add an Anthropic or OpenAI key before screenshot control can run.", 400, "needs_key");
  const headers = req.vendor === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }
    : { authorization: `Bearer ${key}`, "content-type": "application/json" };
  let res;
  try {
    res = await fetch(req.url, { method: "POST", headers, body: JSON.stringify(req.body) });
  } catch {
    throw bad("Could not reach the screenshot model.", 502, "computer");
  }
  const text = await res.text();
  if (!res.ok) throw bad("The screenshot model refused the job.", res.status || 502, "computer");
  let json;
  try { json = JSON.parse(text); } catch { throw bad("The screenshot model returned nothing useful.", 502, "computer"); }
  return parseComputerReply(req.vendor, json);
}
