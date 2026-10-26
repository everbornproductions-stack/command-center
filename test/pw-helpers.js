// Real-browser helper for layout tests. Finds a Chrome or Chromium binary and skips the test when none exists.
// Pure helper (not a test file). Windows rules: real waits, always close browser and server.
import fs from "node:fs";
import { createRequire } from "node:module";
import { startServer } from "./helpers.js";

const require = createRequire(import.meta.url);

export function findBrowser() {
  const cands = [
    process.env.CC_TEST_CHROME,
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/ungoogled-chromium/chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

const HIDE = "#demo-bar,#cc-desktop-prompt,#ea-news-overlay,.cc-tour-invite,#cc-look-offer{display:none!important}";

// Starts the real server and a headless browser. opts: {width,height,mode,theme,env,seed,hidePopups}
export async function bootPage(opts = {}) {
  const exe = findBrowser();
  if (!exe) return null;
  const { chromium } = require("playwright-core");
  const s = await startServer({ env: opts.env || {}, seed: opts.seed });
  const base = `http://127.0.0.1:${s.port}`;
  const api = async (p, o = {}) => {
    const r = await fetch(base + "/api" + p, { method: o.method || (o.body ? "POST" : "GET"), headers: { "content-type": "application/json", "x-cc-token": s.token }, body: o.body ? JSON.stringify(o.body) : undefined });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j, text: t };
  };
  let browser;
  try {
    await api("/setup/done", { body: {} });
    if (opts.mode) await api("/settings", { body: { uiMode: opts.mode, uiModeChosen: true } });
    if (opts.theme) await api("/themes", { body: { mode: opts.theme, background: opts.theme === "light" ? "paper" : undefined } });
    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1366, height: opts.height || 768 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("dialog", (d) => d.accept(d.defaultValue() || "Test").catch(() => {}));
    await page.goto(base + "/?nosplash");
    if (opts.hidePopups !== false) await page.addStyleTag({ content: HIDE });
    await page.waitForFunction(() => window.CC && window.CC.S && window.CC.go, null, { timeout: 15000 });
    // Shell modules and the first state load arrive after first paint, and a slow Windows runner shows it: wait for them (best effort).
    await page.waitForFunction(() => window.CC.S.settingsLoaded && typeof window.CC.saveToMindMedia === "function" && !!window.CC.makeChat, null, { timeout: 30000 }).catch(() => {});
    const close = async () => { try { await browser.close(); } catch {} try { await s.stop(); } catch {} };
    return { s, base, api, page, browser, errors, close };
  } catch (e) {
    try { await browser?.close(); } catch {}
    try { await s.stop(); } catch {}
    throw e;
  }
}

export async function goChat(page) {
  await page.evaluate(() => window.CC.go("command"));
  await page.waitForSelector("#go", { timeout: 10000 });
}
