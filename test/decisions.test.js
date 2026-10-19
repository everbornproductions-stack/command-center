// Locked decisions (docs/DECISIONS.md) and the v0.3.2 reload-loop guard. These checks keep later
// build phases from quietly undoing what Chris approved; behaviour is covered by the other tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("DECISIONS.md exists, is referenced first in CLAUDE.md, and lists every locked item", () => {
  const d = read("docs", "DECISIONS.md");
  for (const s of ["Command AI", "an Everborn product", "com.everborn.command", "Everborn Command", "command-center-releases", "Command-AI-Setup-${version}.${ext}", "Install now", "requestSingleInstanceLock", "instance id", "4747", "Phase 8", "Google Gemini", "Add custom provider", "Ollama", "AIza", "Demo", "Key rejected (401)", "Could not reach", "safeReload", "1, 15, 16, 26, 28, 25, 12, 27, 13, 17 to 24, 14, then 2 to 11", "Learning router (Phase 28)", "Smart fallback (Phase 26)", "Built-in browser helper (Phase 27)", "agent cards on the hub", "Grok Bot agent", "Square", "real API keys", "click"]) assert.ok(d.includes(s), `DECISIONS.md mentions ${s}`);
  assert.doesNotMatch(d, /\u2014/, "no em-dashes");
  const c = read("CLAUDE.md");
  assert.match(c.split("\n").slice(0, 4).join("\n"), /Read docs\/DECISIONS\.md first/);
  assert.match(c, /PHASE N BLOCKED/);
});

test("locked: branding, appId, data folder, releases feed, dash file names", () => {
  const yml = read("electron-builder.yml"), main = read("electron", "main.cjs");
  assert.match(yml, /^appId: com\.everborn\.command\b/m);
  assert.match(yml, /^productName: Command AI$/m);
  assert.match(yml, /repo:\s*command-center-releases/);
  assert.match(yml, /artifactName: "Command-AI-Setup-\$\{version\}\.\$\{ext\}"/);
  assert.match(yml, /perMachine: false/);
  assert.match(main, /app\.setName\("Everborn Command"\)/);
});

test("locked: own server with launch-ID handshake, single instance, main-process updater", () => {
  const main = read("electron", "main.cjs");
  assert.match(main, /pickFreePort\(PREFERRED_PORT\)/);
  assert.match(main, /isOurServer\(await r\.json\(\), INSTANCE\)/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /setupUpdater\(\)/);
  assert.match(read("server", "index.js"), /instance: process\.env\.CC_INSTANCE/);
});

test("locked: run order is the same in DECISIONS.md and BUILD-PLAN.md; Phase 8 is DONE", () => {
  const plan = read("docs", "BUILD-PLAN.md");
  assert.match(plan, /Run order: 1, 15, 16, 26, 28, 25, 12, 27, 13, 17, 18, 19, 20, 21, 22, 23, 24, 14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11\b/);
  assert.match(read("docs", "BUILD-LOG.md"), /^\s*PHASE 8 DONE/m);
});

test("locked: Gemini card, custom providers, key detect, demo retire, error wording exist", () => {
  const reg = read("server", "registry.js"), plug = read("server", "plugins", "providers.js"), idx = read("server", "index.js"), health = read("server", "health.js");
  assert.match(reg, /name: "Google Gemini"/);
  assert.match(reg, /aistudio\.google\.com\/apikey/);
  assert.match(plug, /http:\/\/localhost:11434\/v1/);
  assert.match(plug, /export function suggestProvider/);
  assert.match(idx, /async function retireDemoIfReal/);
  assert.match(health, /Could not reach \$\{p\.name\}/);
  assert.match(health, /Key rejected \(\$\{status\}\)/);
});

test("reload-loop guard: no auto skipWaiting, HTML never cached, reloads only through safeReload", () => {
  const sw = read("web", "sw.js");
  const install = sw.slice(sw.indexOf('addEventListener("install"'), sw.indexOf('addEventListener("message"'));
  assert.doesNotMatch(install, /skipWaiting/, "a new worker never takes over on its own");
  assert.match(sw, /SKIP_WAITING"\) self\.skipWaiting\(\)/);
  assert.doesNotMatch(sw.match(/const SHELL = \[[^\]]*\]/)[0], /"\/"|index\.html/, "the HTML (with its session token) is never precached");
  assert.match(sw, /cc-shell-__CC_VERSION__/, "cache is versioned by app version");
  const app = read("web", "app.js");
  // every reload that is not a direct click handler goes through safeReload
  const bare = app.split("\n").filter((l) => l.includes("location.reload()") && !/addEventListener\("click"/.test(l) && !/function safeReload/.test(l));
  assert.equal(bare.length, 1, `only safeReload itself calls location.reload(): ${bare.join(" | ")}`);
  assert.match(app, /if \(window\.ccDesktop\?\.desktop\) \{\s*navigator\.serviceWorker\.getRegistrations\(\)/, "the desktop app removes service workers");
  assert.match(app, /controllerchange", \(\) => \{ if \(swRefreshing\)/, "controllerchange reloads only after a Refresh click");
  const main = read("electron", "main.cjs");
  assert.match(main, /loads\.length > 6/);
  assert.match(main, /storages: \["serviceworkers", "cachestorage"\]/);
  assert.match(main, /handle\("app:log-reload"/);
});

test("safeReload reloads once per reason per session, then refuses and logs", () => {
  const app = read("web", "app.js");
  const src = app.slice(app.indexOf("function safeReload"), app.indexOf("// ---------------- engine down panel"));
  const store = new Map(), logs = []; let reloads = 0;
  const sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const window = { ccDesktop: { logReload: (r) => logs.push(r) } };
  const location = { reload: () => reloads++ };
  const safeReload = new Function("sessionStorage", "window", "location", `${src}; return safeReload;`)(sessionStorage, window, location);
  assert.equal(safeReload("session token changed (engine restarted)"), true);
  assert.equal(safeReload("session token changed (engine restarted)"), false, "second automatic reload is blocked");
  assert.equal(safeReload("session token changed (engine restarted)"), false);
  assert.equal(reloads, 1, "no loop");
  assert.equal(safeReload("refresh clicked", { manual: true }), true, "a click always works");
  assert.equal(reloads, 2);
  assert.ok(logs.some((l) => /blocked repeat reload/.test(l)), "blocked reloads are logged to the main log");
});
