// The 0.4.8 desktop card, and the user-facing words for desktop control.
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

test("the desktop card stays hidden until 0.4.8, Not now reminds once, and Never sticks", () => {
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.6", status: "pending", laterCount: 0 }), false);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.7", status: "pending", laterCount: 0 }), false);
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.8", status: "pending", laterCount: 0 }), true);
  const once = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "later");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.8", ...once }), true);
  const twice = applyDesktopPrompt(once, "later");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.8", ...twice }), false);
  const never = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "never");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.8", ...never }), false);
  assert.deepEqual(applyDesktopPrompt(never, "later"), never);
  const done = applyDesktopPrompt({ status: "pending", laterCount: 0 }, "done");
  assert.equal(shouldShowDesktopPrompt({ version: "0.4.8", ...done }), false);
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
  const bullets = news["0.4.8"].bullets.join("\n");
  assert.match(bullets, /desktop/i);
  assert.match(bullets, /Antigravity/);
  assert.match(bullets, /Not now/);
  assert.match(bullets, /Never/);
});
