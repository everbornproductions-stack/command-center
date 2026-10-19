// Phase 24: global hotkey quick launcher. Registration runs against a stand-in for Electron's globalShortcut
// (the real desktop window cannot start in a test run): the default Alt+Space, a shortcut someone else holds
// is never taken, OS combinations are refused, a change or turning it off gives the old one back, quit
// unregisters it. Then the main-process wiring, the server route without a desktop and quick.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer, ROOT } from "./helpers.js";

const require = createRequire(import.meta.url);
const { createHotkey, normalize, reservedBy, DEFAULT_ACCELERATOR } = require("../electron/hotkey.cjs");

// stand-in for globalShortcut: "taken" holds combinations another app or the OS already registered
function fakeShortcut(taken = []) {
  const held = new Set(taken), mine = new Map(), calls = [];
  return {
    calls, mine,
    register(a, fn) { calls.push(["register", a]); if (held.has(a) || mine.has(a)) return false; mine.set(a, fn); return true; },
    unregister(a) { calls.push(["unregister", a]); mine.delete(a); },
    unregisterAll() { calls.push(["unregisterAll"]); mine.clear(); },
    isRegistered: (a) => mine.has(a),
    press(a) { mine.get(a)?.(); },
  };
}

test("accelerators: normalized, a modifier required, junk refused, OS combinations known", () => {
  assert.equal(DEFAULT_ACCELERATOR, "Alt+Space");
  assert.equal(normalize("alt + space"), "Alt+Space");
  assert.equal(normalize("shift+ctrl+k"), "Ctrl+Shift+K");
  assert.equal(normalize("CmdOrCtrl+Shift+F12"), "CommandOrControl+Shift+F12");
  assert.equal(normalize("Super+/"), "Super+/");
  for (const bad of ["", "K", "Space", "Alt", "Alt+Ctrl", "Hyper+K", "Alt+Banana", "Ctrl+Alt+Shift+Super+K"]) assert.throws(() => normalize(bad), Error, bad);
  assert.equal(reservedBy("Alt+Tab", "win32"), true);
  assert.equal(reservedBy("ctrl+alt+delete", "win32"), true);
  assert.equal(reservedBy("CommandOrControl+Space", "darwin"), true, "Spotlight on a Mac");
  assert.equal(reservedBy("Alt+Space", "win32"), false);
});

test("registration: default Alt+Space, never steals a taken shortcut, change and off give it back, quit unregisters", () => {
  let fired = 0;
  const gs = fakeShortcut();
  const hk = createHotkey({ globalShortcut: gs, onTrigger: () => fired++, platform: "win32" });
  let st = hk.apply();
  assert.deepEqual(st, { enabled: true, accelerator: "Alt+Space", registered: true, reason: null });
  gs.press("Alt+Space"); assert.equal(fired, 1, "the shortcut opens the launcher");
  assert.equal(hk.apply({ accelerator: "alt+space" }).registered, true);
  assert.equal(gs.calls.filter((c) => c[0] === "register").length, 1, "applying the same shortcut again does not re-register");

  // change: the old one is released first
  st = hk.apply({ accelerator: "Ctrl+Shift+K" });
  assert.equal(st.registered, true); assert.equal(hk.owned, "Ctrl+Shift+K");
  assert.ok(gs.calls.some((c) => c[0] === "unregister" && c[1] === "Alt+Space"));
  assert.equal(gs.mine.has("Alt+Space"), false);

  // off
  st = hk.apply({ enabled: false, accelerator: "Ctrl+Shift+K" });
  assert.equal(st.registered, false); assert.equal(gs.mine.size, 0); assert.match(st.reason, /off/);

  // quit
  hk.apply({ accelerator: "Ctrl+Shift+J" });
  hk.dispose();
  assert.equal(gs.mine.size, 0); assert.equal(hk.owned, null);
  assert.deepEqual(gs.calls.at(-1), ["unregister", "Ctrl+Shift+J"]);
});

test("a shortcut held by Windows or another app is left alone, with a clear note", () => {
  const gs = fakeShortcut(["Alt+Space"]);
  const hk = createHotkey({ globalShortcut: gs, onTrigger: () => {}, platform: "win32" });
  const st = hk.apply();
  assert.equal(st.registered, false); assert.equal(st.enabled, true);
  assert.match(st.reason, /Alt\+Space is already used by Windows or another app, so it was left alone/);
  assert.ok(!gs.calls.some((c) => c[0] === "unregister" && c[1] === "Alt+Space"), "never unregisters someone else's shortcut");
  hk.dispose();
  assert.ok(!gs.calls.some((c) => c[0] === "unregister"), "quit gives back only what this app took");
  // OS combinations are not even tried
  const gs2 = fakeShortcut();
  const st2 = createHotkey({ globalShortcut: gs2, onTrigger: () => {}, platform: "win32" }).apply({ accelerator: "Alt+Tab" });
  assert.equal(st2.registered, false); assert.match(st2.reason, /belongs to the operating system/);
  assert.equal(gs2.calls.length, 0);
  // a register() that throws is reported, not fatal
  const st3 = createHotkey({ globalShortcut: { register() { throw new Error("bad accelerator"); }, unregister() {} }, onTrigger: () => {} }).apply({ accelerator: "Ctrl+Shift+K" });
  assert.equal(st3.registered, false); assert.match(st3.reason, /could not be used: bad accelerator/);
  // an invalid shortcut keeps the previous state
  const st4 = createHotkey({ globalShortcut: fakeShortcut(), onTrigger: () => {} }).apply({ accelerator: "K" });
  assert.match(st4.error, /modifier/);
});

test("main process: the hotkey is wired to the quick launcher and released on quit", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
  assert.match(main, /createHotkey\(\{ globalShortcut, onTrigger: \(\) => toggleQuick\(\)/);
  assert.match(main, /app\.on\("will-quit", \(\) => \{ try \{ hotkey\.dispose\(\); globalShortcut\.unregisterAll\(\); \} catch \{\} \}\)/);
  assert.match(main, /globalThis\.__ccHotkey = /);
  assert.match(main, /loadURL\(`http:\/\/127\.0\.0\.1:\$\{PORT\}\/quick\.html`\)/);
  const pre = fs.readFileSync(path.join(ROOT, "electron", "desk-preload.cjs"), "utf8");
  assert.match(pre, /quickDone: /); assert.match(pre, /quickHide: /);
  // the locked items stay as they were
  assert.match(main, /app\.setName\("Everborn Command"\)/); assert.match(main, /requestSingleInstanceLock\(\)/);
});

test("server: the route works without a desktop (saved, validated), quick.html gets the session token", { timeout: 60000 }, async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off" } });
  try {
    assert.equal((await s.api("/hotkey", { noToken: true })).status, 401);
    let r = (await s.api("/hotkey")).json;
    assert.equal(r.desktop, false); assert.equal(r.enabled, true); assert.equal(r.accelerator, "Alt+Space"); assert.equal(r.registered, false);
    assert.match(r.reason, /desktop app/);
    assert.equal((await s.api("/hotkey", { method: "POST", body: { accelerator: "K" } })).status, 400);
    assert.equal((await s.api("/hotkey", { method: "POST", body: { accelerator: "Ctrl+Alt+Delete" } })).status, 400);
    r = await s.api("/hotkey", { method: "POST", body: { accelerator: "ctrl+shift+k", enabled: false } });
    assert.equal(r.status, 200); assert.equal(r.json.accelerator, "Ctrl+Shift+K"); assert.equal(r.json.enabled, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, "hotkey.json"), "utf8")), { enabled: false, accelerator: "Ctrl+Shift+K" });
    const q = await s.raw({ path: "/quick.html" });
    assert.equal(q.status, 200);
    assert.ok(q.text.includes(`<meta name="cc-token" content="${s.token}" />`), "the launcher page carries this launch's token");
    assert.equal(q.headers["cache-control"], "no-store");
    assert.doesNotMatch(q.text.replace(/<!--[\s\S]*?-->/g, ""), /https?:\/\//, "the launcher talks to nothing but this app");
  } finally { await s.stop(); }
});

test("Phase 24 hotkey files: no em-dashes in user-facing text", () => {
  for (const f of ["electron/hotkey.cjs", "server/plugins/hotkey.js", "web/features/hotkey.js", "web/quick.html"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
