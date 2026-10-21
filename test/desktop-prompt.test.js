// The 0.4.9 desktop card, and the user-facing words for desktop control.
// No server, no keys, and no em dash in the guides.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDesktopPrompt, desktopPromptCopy, shouldShowDesktopPrompt } from "../server/desktop-prompt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EM = "\u2014";
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("the desktop card stays hidden until 0.4.9, Not now reminds once, and Never sticks", () => {
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.6", status: "pending", laterCount: 0 }), false);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.7", status: "pending", laterCount: 0 }), false);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.8", status: "pending", laterCount: 0 }), false);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.9", status: "pending", laterCount: 0 }), true);
  const once = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "later");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.9", ...once }), true);
  const twice = applyDesktopPrompt(once, "later");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.9", ...twice }), false);
  const never = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "never");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.9", ...never }), false);
  assert.deepEqual(applyDesktopPrompt(never, "later"), never);
  const done = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "done");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.9", ...done }), false);
  const copy = desktopPromptCopy();
  assert.match(copy.title, /let Meldmind use your desktop/);
  assert.match(copy.body, /Passwords are not stored/);
  assert.equal(JSON.stringify(copy).includes(EM), false);
});

test("the setup wizard, tour, help, and marketing pages describe desktop control without an em dash", () => {
  const files = [
    "web/app.js",
    "web/features/tour.js",
    "web/features/antigravity.js",
    "docs/USER-GUIDE.md",
    "docs/product-brief.md",
    "docs/marketing.md",
    "docs/help/desktop-apps.md",
    "docs/help/getting-started.md",
    "docs/help/handoff.md",
    "docs/help/replay-the-tour.md",
    "docs/help/updates.md",
    "docs/WHATS-NEW.json",
  ];
  for (const file of files) assert.equal(read(file).includes(EM), false, file);
  assert.match(read("web/app.js"), /Let Meldmind use your desktop/);
  assert.match(read("web/app.js"), /Install and connect/);
  assert.match(read("server/desktop-prompt.js"), /New: let Meldmind use your desktop/);
  assert.match(read("web/features/tour.js"), /id="cc-desktop-later">Not now/);
  assert.match(read("web/features/tour.js"), /id="cc-desktop-never">Never/);
  assert.match(read("web/features/antigravity.js"), /Add to Antigravity/);
  assert.match(read("docs/marketing.md"), /Meldmind can use the apps on your desktop, safely/);
  assert.match(read("docs/help/desktop-apps.md"), /self-healing|finds the control again|manual handoff/);
  const news = JSON.parse(read("docs/WHATS-NEW.json"));
  const bullets = news["0.4.9"].bullets.join("\n");
  assert.match(bullets, /desktop/i);
  assert.match(bullets, /Antigravity/);
  assert.match(bullets, /Not now/);
  assert.match(bullets, /Never/);
});

test("every desktop card button closes the card, and Open settings goes to Settings without bringing it back", async () => {
  const { desktopClick, desktopPromptBlocked, markSessionClosed, sessionClosed, DESKTOP_SETTINGS_FOCUS } = await import("../web/desktop-prompt-flow.js");
  for (const button of ["allow", "install", "settings", "later", "close", "never"]) {
    const step = desktopClick(button);
    assert.equal(step.close, true, button);
    assert.equal(step.dismiss, true, button);
  }
  assert.equal(desktopClick("allow").server, "done");
  assert.equal(desktopClick("install").server, "done");
  assert.equal(desktopClick("install").run, "install");
  assert.equal(desktopClick("never").server, "never");
  assert.equal(desktopClick("close").server, "later");
  const open = desktopClick("settings");
  assert.equal(open.view, "settings");
  assert.equal(open.focus, DESKTOP_SETTINGS_FOCUS);
  assert.equal(open.run, null);

  // Regression for the loop: Install and connect, then Open settings, must not reopen the card.
  assert.equal(desktopPromptBlocked({ view: "command" }), false);
  assert.equal(desktopPromptBlocked({ busy: true, view: "command" }), true, "never while an install runs");
  assert.equal(desktopPromptBlocked({ view: "settings" }), true, "never on Settings");
  assert.equal(desktopPromptBlocked({ view: "setup" }), true);
  assert.equal(desktopPromptBlocked({ dismissed: true, view: "command" }), true, "never again this session");
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(sessionClosed(store), false);
  markSessionClosed(store);
  assert.equal(sessionClosed(store), true, "a reload in the same session keeps it closed");
  assert.equal(sessionClosed(null), false);

  const ui = read("web/features/tour.js");
  for (const id of ["x", "allow", "install", "settings", "later", "never"]) assert.match(ui, new RegExp(`cc-desktop-\\$\\{id\\}|id="cc-desktop-${id}"`), id);
  assert.match(ui, /id="cc-desktop-x" aria-label="Close"/);
  assert.match(ui, /id="cc-desktop-settings">Open settings/);
  assert.match(ui, /e\.key === "Escape"\) desktopChoice\("close"\)/);
  assert.match(ui, /e\.target === box\) desktopChoice\("close"\)/);
  // The card is closed before the install or the confirm runs, and progress shows as a toast.
  const choice = ui.slice(ui.indexOf("async function desktopChoice"));
  assert.ok(choice.indexOf("hideDesktop()") < choice.indexOf("runDesktop("), "close first");
  assert.match(ui, /Installing Antigravity/);
  assert.equal(/alwaysOnTop|setAlwaysOnTop/.test(ui), false, "never always on top");
  assert.match(read("web/app.js"), /openSettings: \(focus\) =>/);
});
