// 0.4.34 (Chris: "we need to make sure that every set up opens the appropriate window for them to do so and get them up
// and going"): "Save money with free AIs" on the welcome screen and in the Get free AIs card. Each helper gets the right
// button; Gemini CLI is no longer offered (Google retired it for individuals on 2026-11-01); its rejection reads plainly.
import test from "node:test";
import assert from "node:assert/strict";
import { plainCliError } from "../server/sub-routes.js";
import { installArgs, HELPERS } from "../server/helper-install.js";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { findFreebuff } from "../server/freebuff-agent.js";

const skip = findBrowser() ? false : "no Chrome installed";

test("Google's Gemini CLI rejection sits the app out with a plain reason", () => {
  const raw = "IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google";
  const r = plainCliError(raw, "Gemini CLI");
  assert.equal(r.code, "signin"); assert.equal(r.retired, true);
  assert.equal(r.message, "Gemini CLI was retired by Google for personal accounts. Meldmind uses Antigravity and your Gemini key instead.");
  assert.equal(installArgs("gemini-cli"), null, "Gemini CLI is not installed from Meldmind any more");
  assert.match(HELPERS["gemini-cli"].page, /antigravity\.google/);
});

test("bulk setup stops on missing Node.js, opens one page, and keeps its status after repaint", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
  try {
    const workers = { workers: ["codex", "opencode"].map((id) => ({ id, label: id, kind: "cli", status: "missing", light: "grey", good: "" })) };
    await t.page.route(/\/api\/workers(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workers) }));
    await t.page.route(/\/api\/free-ais(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pages: [] }) }));
    // no catalog lists: the block falls back to its own app list, so Codex and OpenCode show with Install
    await t.page.route(/\/api\/free-catalog$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await t.page.route(/\/api\/workers\/codex\/install$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, code: "no-node", page: "https://nodejs.org/en/download", message: "Node needed" }) }));
    await t.page.evaluate(async () => {
      window.openedPages = [];
      window.open = (url) => { window.openedPages.push(url); return null; };
      const box = document.createElement("div"); box.id = "test-fs-no-node"; document.body.appendChild(box);
      await import("/features/free-setup.js"); window.CC.freeSetup.mount(box);
    });
    // the test box sits under the Mac window, so it is pressed from the page, as layout2-0428 presses Help
    await t.page.waitForFunction(() => { const b = document.querySelector("#test-fs-no-node #cc-fs-all"); return b && !b.disabled; });
    await t.page.evaluate(() => document.querySelector("#test-fs-no-node #cc-fs-all").click());
    await t.page.waitForFunction(() => document.querySelector("#cc-fs-line")?.textContent.includes("Install Node.js first"));
    const result = await t.page.evaluate(() => ({ line: document.querySelector("#cc-fs-line")?.textContent, opened: window.openedPages }));
    assert.equal(result.opened.length, 1);
    assert.match(result.line, /page just opened.*press Set up all again/);
  } finally { await t.close(); }
});

// 0.4.36 (panel 0434 item 18a): the test-only PATH guard and explicit binary both control Freebuff detection.
test("Freebuff detection honors test isolation and an explicit binary", () => {
  const exists = (p) => p === "C:/fake/freebuff";
  assert.equal(findFreebuff({ env: { PATH: "C:/elsewhere", CC_SUBCLI_NO_PATH: "1" }, exists }), null);
  assert.equal(findFreebuff({ env: { PATH: "C:/elsewhere", CC_FREEBUFF_BIN: "C:/missing" }, exists }), null);
  assert.equal(findFreebuff({ env: { PATH: "C:/elsewhere", CC_FREEBUFF_BIN: "C:/fake/freebuff" }, exists }), "C:/fake/freebuff");
});

test("the setup step: Install, Sign in, Get it and Get key, in the right places, with no Gemini CLI", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple" });
  try {
    const row = (id, label, status) => ({ id, label, kind: "cli", free: true, enabled: true, status, statusLabel: status, light: "grey", good: "" });
    const workers = { workers: [row("gemini-cli", "Gemini CLI", "missing"), row("antigravity", "Antigravity", "missing"), row("codex", "Codex", "signin"), row("claude-code", "Claude Code", "ready"), row("opencode", "OpenCode", "missing"), row("freebuff", "Freebuff", "signin")] };
    const pages = { pages: [{ id: "google", provider: "google", name: "Google AI Studio (Gemini)", url: "https://aistudio.google.com/apikey", what: "Free Gemini Flash models.", needs: "key", connected: false }, { id: "groq", provider: "groq", name: "Groq", url: "https://console.groq.com/keys", what: "Fast, free tier.", needs: "key", connected: true }, { id: "openrouter", provider: "openrouter", name: "OpenRouter", url: "https://openrouter.ai/keys", what: "Free route.", needs: "key", connected: false }] };
    await t.page.route(/\/api\/workers(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(workers) }));
    await t.page.route(/\/api\/free-ais(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pages) }));
    await t.page.evaluate(async () => {
      const box = document.createElement("div"); box.id = "test-fs"; document.body.appendChild(box);
      await import("/features/free-setup.js");
      window.CC.freeSetup.mount(box);
    });
    await t.page.waitForSelector("#test-fs [data-fs-app]", { timeout: 15000 });
    const info = await t.page.evaluate(() => ({
      apps: [...document.querySelectorAll("#test-fs [data-fs-app]")].map((r) => `${r.dataset.fsApp}:${r.querySelector("[data-fs-act]")?.textContent || "-"}`),
      keys: [...document.querySelectorAll("#test-fs [data-fs-key]")].map((r) => `${r.dataset.fsKey}:${r.querySelector("[data-fs-page]") ? "Get key" : "connected"}`),
      all: document.querySelector("#cc-fs-all")?.textContent,
      text: document.getElementById("test-fs").textContent,
    }));
    assert.deepEqual(info.apps, ["antigravity:Get it", "codex:Sign in", "claude-code:-", "opencode:Install", "freebuff:Sign in"]);
    assert.ok(!/Gemini CLI/.test(info.text), "Gemini CLI is not offered");
    // 0.4.35: the free-AI catalog decides which free keys are listed (and in what order); these three are always among them
    for (const k of ["google:Get key", "groq:connected", "openrouter:Get key"]) assert.ok(info.keys.includes(k), `${k} in ${info.keys}`);
    assert.equal(info.all, "Set up all free AIs (3)", "Install OpenCode, sign in Codex and Freebuff; a download page is not counted");
  } finally { await t.close(); }
});

test("the step is registered for the welcome screen and loads with the shell", async () => {
  const fs = await import("node:fs");
  const reg = fs.readFileSync(new URL("../web/perf/registry.js", import.meta.url), "utf8");
  assert.match(reg, /\{ id: "free-setup", shell: true \}/);
  const src = fs.readFileSync(new URL("../web/features/free-setup.js", import.meta.url), "utf8");
  assert.match(src, /welcome: \{ order: 5, render:/);
  assert.match(src, /Free sign-up \(Gemini, Groq, OpenRouter\)/);
  assert.match(src, /title="Installs \$\{esc\(w\.label\)\} with npm\. Needs Node\.js\. About a minute\./);
  // 0.4.36 (panel 0434 item 7d): Simple Settings mounts it; Expert keeps Your AI helpers only (no second copy)
  assert.doesNotMatch(src, /settings: \{/);
  const ui = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(ui, /freeSetup\?\.mount\?\.\(fs, \{ title: "Free AIs on this PC" \}\)/);
  assert.doesNotMatch(ui, /settings-free-setup/);
  const workers = fs.readFileSync(new URL("../web/features/workers.js", import.meta.url), "utf8");
  assert.match(workers, /Open Antigravity/);
  const card = fs.readFileSync(new URL("../web/features/free-ais.js", import.meta.url), "utf8");
  assert.match(card, /freeSetup\?\.mount\?\.\(wrap\.querySelector\("#cc-fa-apps"\), \{ title: "Free AI apps on this PC", keys: false \}\)/);
});
