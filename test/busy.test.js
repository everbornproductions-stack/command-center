// Every button that calls the server shows it is working, then a result (web/busy.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { busyLabel, setBusy, withBusy, flashDone, trackBusy, installClickTracking, noteToast, WORKING, SEARCHING, DONE } from "../web/busy.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Windows checkouts use CRLF; the source checks below match "\n".
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

function fakeButton(text, dataset = {}) {
  const classes = new Set();
  const attrs = {};
  return {
    innerHTML: text, get textContent() { return this.innerHTML.replace(/<[^>]+>/g, ""); }, set textContent(v) { this.innerHTML = v; },
    dataset, disabled: false, isConnected: true,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; }, attrs,
    closest() { return this; },
  };
}

test("labels: Find and Search say Searching..., others Working..., data-busy-label wins", () => {
  assert.equal(busyLabel(fakeButton("Find")), SEARCHING);
  assert.equal(busyLabel(fakeButton("Search more places")), SEARCHING);
  assert.equal(busyLabel(fakeButton("Save")), WORKING);
  assert.equal(busyLabel(fakeButton("Activate", { busyLabel: "Checking..." })), "Checking...");
  for (const s of [WORKING, SEARCHING, DONE]) assert.doesNotMatch(s, /\u2014/);
});

test("withBusy: spinner, disabled and aria-busy while it runs, then back as it was", async () => {
  const b = fakeButton("Find");
  let during;
  const out = await withBusy(b, async () => { during = { html: b.innerHTML, disabled: b.disabled, busy: b.classList.contains("busy"), aria: b.attrs["aria-busy"] }; return 12; });
  assert.equal(out, 12);
  assert.match(during.html, /class="spinner"/);
  assert.match(during.html, /Searching\.\.\./);
  assert.equal(during.disabled, true);
  assert.equal(during.busy, true);
  assert.equal(during.aria, "true");
  assert.equal(b.innerHTML, "Find");
  assert.equal(b.disabled, false);
  assert.equal(b.classList.contains("busy"), false);
});

test("withBusy: a second click while working does not start a second job; errors still restore", async () => {
  const b = fakeButton("Save");
  let runs = 0;
  let release;
  const first = withBusy(b, () => new Promise((r) => { runs++; release = r; }));
  await withBusy(b, async () => { runs++; });
  assert.equal(runs, 1);
  release();
  await first;
  await assert.rejects(withBusy(b, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(b.disabled, false);
  assert.equal(b.innerHTML, "Save");
});

test("flashDone: a quiet success shows Done on the button", async () => {
  const b = fakeButton("Apply");
  flashDone(b, 20);
  assert.equal(b.textContent, DONE);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(b.innerHTML, "Apply");
});

test("trackBusy: a request started inside a click marks that button busy", async () => {
  let handler;
  installClickTracking({ addEventListener: (_t, fn) => { handler = fn; } });
  const b = fakeButton("Run");
  let release;
  let seen;
  handler({ target: b });
  const p = trackBusy(new Promise((r) => { release = r; }));
  seen = b.disabled;
  noteToast();
  release("ok");
  assert.equal(await p, "ok");
  assert.equal(seen, true);
  assert.equal(b.disabled, false);
  // outside a click nothing is touched
  await new Promise((r) => setTimeout(r, 5));
  const other = fakeButton("Idle");
  await trackBusy(Promise.resolve(1));
  assert.equal(other.disabled, false);
});

test("app-wide: api() goes through trackBusy, toasts are counted, the click tracker is installed", () => {
  const app = read("web", "app.js");
  assert.match(app, /function api\(path, opts = \{\}\) \{ return trackBusy\(apiCall\(path, opts\)\); \}/);
  assert.match(app, /function toast\(msg, err = false, link = null\) \{\n  noteToast\(\);/);
  assert.match(app, /installClickTracking\(document\);/);
  const css = read("web", "styles.css");
  assert.match(css, /\.spinner \{/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\n  \.spinner/);
});

// Click every button: each id'd button in the web UI has a handler somewhere, and look-only
// sample buttons cannot be clicked.
test("no dead buttons: every <button id> is wired, samples are inert", () => {
  const dirs = [["web"], ["web", "features"]];
  const files = [path.join(ROOT, "web", "index.html")];
  for (const d of dirs) for (const f of fs.readdirSync(path.join(ROOT, ...d))) if (f.endsWith(".js")) files.push(path.join(ROOT, ...d, f));
  const texts = files.map((f) => [f, fs.readFileSync(f, "utf8")]);
  const corpus = texts.map(([, s]) => s).join("\n");
  const dead = [];
  for (const [f, s] of texts) {
    for (const m of s.matchAll(/<button\b[^>]*?\bid="([A-Za-z0-9_-]+)"[^>]*>/g)) {
      const id = m[1];
      const refs = [`#${id}`, `"${id}"`, `'${id}'`, `\`${id}\``].reduce((n, r) => n + corpus.split(r).length - 1, 0);
      // a template id such as cc-desktop-${id} is wired by its prefix
      const prefix = id.replace(/-[a-z]+$/, "-");
      if (refs <= 1 && !corpus.includes(`#${prefix}\${`)) dead.push(`${path.basename(f)}: ${id}`);
    }
    for (const m of s.matchAll(/<button\b[^>]*>/g)) {
      // wired by id, by a data- attribute (delegated handlers), or as a form's submit button
      if (/\b(id=|data-[a-z-]+|type="submit")/.test(m[0]) || /\$\{/.test(m[0])) continue;
      if (m[0] === "<button>") continue; // prose in a comment
      if (!/sample-only/.test(m[0])) dead.push(`${path.basename(f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(dead, []);
  assert.match(read("web", "styles.css"), /\.sample-only \{ pointer-events: none; \}/);
});
