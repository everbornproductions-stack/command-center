// Phase 11: accessibility, error states and empty states in the page shell (web/index.html, web/app.js,
// web/styles.css). Static checks only: the real-browser run is not possible in agent runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM_DASH = String.fromCharCode(0x2014);

test("page shell: accessibility, error states and empty states", () => {
  const html = read("web", "index.html"), app = read("web", "app.js"), css = read("web", "styles.css");
  // skip link, labelled landmarks, live regions
  assert.match(html, /<a class="skip-link" href="#view">Skip to content<\/a>/);
  assert.match(html, /<main class="view" id="view" tabindex="-1">/);
  assert.match(html, /<nav class="tabs" id="tabs" aria-label="Main">/);
  assert.match(html, /<nav class="mobile-nav" id="mobile-nav" aria-label="Main">/);
  assert.match(html, /id="toasts" class="toasts" role="status" aria-live="polite"/);
  assert.match(html, /id="conn-pill" role="status"/);
  for (const m of html.matchAll(/<i>[^<]*<\/i>/g)) assert.fail(`decorative icon without aria-hidden: ${m[0]}`);
  // the active tab is announced; error toasts are alerts; segmented choices say which is on
  assert.match(app, /setAttribute\("aria-current", "page"\)/);
  assert.match(app, /t\.setAttribute\("role", "alert"\)/);
  assert.match(app, /aria-pressed/);
  for (const id of ["run-mode", "cost-mode", "when-mode"]) assert.match(app, new RegExp(`id="${id}" role="group" aria-label="`));
  assert.match(app, /<textarea id="orders" aria-label="Marching orders"/);
  // clickable cards and rows work from the keyboard
  assert.match(app, /class="tile [^`]*role="button" tabindex="0" aria-label=/);
  assert.match(app, /class="pcard"[^`]*role="button" tabindex="0"/);
  assert.match(app, /getAttribute\("role"\) !== "button"/);
  // error states: no bare "Failed to fetch", no empty message, no silent failure, a broken tab can retry
  assert.match(app, /Could not reach Meldmind's engine/);
  assert.match(app, /Request failed \(HTTP \$\{r\.status\}/);
  assert.match(app, /addEventListener\("unhandledrejection"/);
  assert.match(app, /could not open: \$\{esc\(e\.message\)\}<br><button class="btn sm" id="tab-retry"/);
  assert.doesNotMatch(app, /await fetch\(HUB \+ "\/api" \+ path/, "API calls go through apiFetch");
  // empty states
  assert.match(app, /No projects yet\./);
  assert.match(app, /Nothing tracked yet\./);
  assert.match(app, /class="empty feed-empty"/);
  // keyboard focus ring and reduced motion, without overriding the live flow map's own fallback (decision 19)
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--accent\)/);
  const reduce = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(reduce, "reduced-motion block");
  assert.doesNotMatch(reduce[1], /liveview|flow|\*\s*\{/, "only the shell's own animations");
  for (const t of [html, app, css]) assert.ok(!t.includes(EM_DASH), "no em-dash");
});
