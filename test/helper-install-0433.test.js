// 0.4.33 (Chris: "there should be a link on uninstalled services ... like an install button that automatically sets it
// up for you"): Install runs npm with a fixed, checked package name; Sign in opens the helper's own sign-in window;
// Antigravity gets its download page. No real npm, window or network in these tests.
import test from "node:test";
import assert from "node:assert/strict";
import { HELPERS, installArgs, installHelper, signInHelper, canInstall, canSignIn, NODE_PAGE } from "../server/helper-install.js";
import { bootMac } from "./mac-helpers.js";
import { findBrowser } from "./pw-helpers.js";

const skip = findBrowser() ? false : "no Chrome installed";
const EM = String.fromCharCode(0x2014);

test("the package names are fixed and are the real ones", () => {
  assert.deepEqual(installArgs("codex"), ["install", "-g", "@openai/codex"]);
  assert.deepEqual(installArgs("opencode"), ["install", "-g", "--allow-scripts=opencode-ai", "opencode-ai"], "OpenCode's own setup step is allowed for that one package only");
  assert.deepEqual(installArgs("freebuff"), ["install", "-g", "freebuff"]);
  assert.deepEqual(installArgs("gemini-cli"), ["install", "-g", "@google/gemini-cli"]);
  assert.deepEqual(installArgs("claude-code"), ["install", "-g", "@anthropic-ai/claude-code"]);
  assert.equal(installArgs("antigravity"), null, "not on npm: download page");
  assert.equal(installArgs("grokbot"), null);
  assert.equal(canInstall("codex"), true); assert.equal(canSignIn("opencode"), false); assert.equal(canSignIn("codex"), true);
  for (const h of Object.values(HELPERS)) assert.ok(!String(h.words || "").includes(EM));
});

test("install: success, npm failure, no Node, and a download page", async () => {
  const calls = [];
  const run = async (file, args) => { calls.push([file, args]); return { code: 0, out: "added 12 packages" }; };
  let r = await installHelper("codex", { findNpm: async () => "C:/node/npm.cmd", run });
  assert.equal(r.ok, true); assert.match(r.message, /^Installed codex\. Next, press Sign in\.$/);
  assert.deepEqual(calls[0], ["C:/node/npm.cmd", ["install", "-g", "@openai/codex"]]);
  r = await installHelper("opencode", { findNpm: async () => "npm", run });
  assert.equal(r.message, "Installed opencode.", "no sign-in step for OpenCode");
  r = await installHelper("freebuff", { findNpm: async () => "npm", run: async () => ({ code: 1, out: "npm ERR! network request failed" }) });
  assert.equal(r.ok, false); assert.equal(r.code, "failed"); assert.match(r.message, /network request failed/);
  r = await installHelper("codex", { findNpm: async () => "" });
  assert.equal(r.code, "no-node"); assert.equal(r.page, NODE_PAGE); assert.match(r.message, /needs Node\.js/);
  r = await installHelper("antigravity", { findNpm: async () => "npm", run });
  assert.equal(r.code, "page"); assert.match(r.page, /^https:\/\/antigravity\.google\//);
  assert.equal((await installHelper("not-a-helper")).code, "unknown");
});

test("sign in opens the helper's own command; a missing one says install first", async () => {
  const opened = [];
  let r = await signInHelper("codex", { findHelper: async () => "C:/npm/codex.cmd", open: async (bin, args) => opened.push([bin, args]) });
  assert.equal(r.ok, true); assert.deepEqual(opened[0], ["C:/npm/codex.cmd", ["login"]]);
  assert.match(r.message, /sign in with your ChatGPT account/);
  r = await signInHelper("freebuff", { findHelper: async () => "", open: async () => opened.push("x") });
  assert.equal(r.code, "missing"); assert.equal(opened.length, 1);
  assert.equal((await signInHelper("opencode")).code, "none");
});

test("the helpers panel shows Install, Sign in and Get it, and Install posts once", { skip }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "expert" });
  try {
    const row = (id, label, status, extra = {}) => ({ id, label, kind: "cli", free: true, enabled: true, status, statusLabel: status, light: "grey", good: "", needs: "", ...extra });
    const view = { line: "test", workers: [row("codex", "Codex", "missing"), row("freebuff", "Freebuff", "signin"), row("antigravity", "Antigravity", "missing"), row("claude-code", "Claude Code", "ready")] };
    const posts = [];
    await t.page.route("**/api/workers?*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) }));
    await t.page.route("**/api/workers", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(view) }));
    await t.page.route("**/api/workers/*/install", (r) => { posts.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "Installed codex. Next, press Sign in.", view: { ...view, workers: [row("codex", "Codex", "signin"), ...view.workers.slice(1)] } }) }); });
    await t.page.evaluate(async () => {
      const box = document.createElement("div"); box.id = "test-helpers"; document.body.appendChild(box);
      const mod = await import("/features/workers.js"); mod.renderHelpers(box);
    });
    await t.page.waitForSelector('#test-helpers [data-helper-act]', { timeout: 15000 });
    const acts = await t.page.evaluate(() => [...document.querySelectorAll("#test-helpers [data-helper-act]")].map((b) => `${b.dataset.helperId}:${b.textContent}`));
    assert.deepEqual(acts, ["codex:Install", "freebuff:Sign in", "antigravity:Get it"], "a ready helper has no button");
    // the test box is outside the Mac window's visible area; this checks the wiring, so the button is pressed directly
    await t.page.evaluate(() => document.querySelector('#test-helpers [data-helper-id="codex"][data-helper-act="install"]').click());
    await t.page.waitForFunction(() => /Installed codex/.test(document.getElementById("toasts")?.textContent || ""), null, { timeout: 15000 });
    await t.page.waitForFunction(() => document.querySelector('#test-helpers [data-helper-id="codex"]')?.textContent === "Sign in", null, { timeout: 15000 });
    assert.equal(posts.length, 1);
    assert.match(posts[0], /\/api\/workers\/codex\/install$/);
  } finally { await t.close(); }
});
