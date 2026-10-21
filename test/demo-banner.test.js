// Demo mode: a banner on every screen while it is on, one click out, and Help > Try demo mode to come back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { helpItems, MENU_ACTIONS } from "../web/nav.js";
import { DEMO_BANNER_TEXT, DEMO_BANNER_ACTION } from "../web/composer-ais.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");

test("banner words are plain and the exit is one button", () => {
  assert.equal(DEMO_BANNER_TEXT, "You're in demo mode, using pretend AIs.");
  assert.equal(DEMO_BANNER_ACTION, "Exit demo mode");
  const banner = app.slice(app.indexOf("function renderDemoBanner"), app.indexOf("async function setDemo"));
  assert.match(banner, /id="demo-bar-off"/);
  assert.match(banner, /addEventListener\("click", \(\) => setDemo\(false\)\)/);
  assert.match(banner, /if \(!S\.demoBanner\) \{ d\?\.remove\(\); return; \}/, "off means the banner is removed");
  // drawn from every state update and attached to the page body, so it sits above every screen
  assert.match(app.slice(app.indexOf("function applyState("), app.indexOf("function handle(ev)")), /renderDemoBanner\(\)/);
  assert.match(banner, /document\.body\.prepend\(d\)/);
});

test("Help has Try demo mode, wired to turn demo on", () => {
  for (const surface of ["", "web"]) assert.ok(helpItems(surface).some((i) => i.label === "Try demo mode" && i.action === "demo-on"));
  assert.ok(MENU_ACTIONS["demo-on"]);
  assert.match(app, /b\.dataset\.action === "demo-on"\) \{ closeNav\(root\);[^\n]*setDemo\(true\)/);
});

test("server: demoBanner is true while demo is on and false once it is off", async () => {
  const s = await startServer();
  try {
    const on = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(on.status, 200);
    assert.equal((await s.api("/state")).json.demoBanner, true);
    const off = await s.api("/demo", { method: "POST", body: { on: false } });
    assert.equal(off.json.demo, false);
    assert.equal((await s.api("/state")).json.demoBanner, false);
  } finally { await s.stop(); }
});
