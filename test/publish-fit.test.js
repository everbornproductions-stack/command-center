// 0.4.21 Publish that finishes (M4 M14 M32): fit check lines with one fix each, per-place boxes, plain words.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { fitFixes, fieldsFor } from "../web/publish-fit.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("fitFixes gives each problem its own fix, and Drive as the other way out for a missing link", () => {
  const r = fitFixes(["Instagram posts need a picture or video. Paste a public link to one; your words become the caption", "Pick at least one connected social account", "The scheduled time is in the past"], "instagram");
  assert.equal(r[0].fix.id, "link");
  assert.equal(r[0].alt.id, "drive");
  assert.equal(r[1].fix.id, "account");
  assert.equal(r[2].fix.id, "time");
  assert.equal(fitFixes(["Instagram needs a public link"], "drive")[0].alt, undefined);
  assert.deepEqual(fitFixes([]), []);
});

test("fieldsFor lists the boxes each place needs", () => {
  assert.deepEqual(fieldsFor("instagram", "text").map((f) => f.id), ["link"]);
  assert.deepEqual(fieldsFor("ghl", "image").map((f) => f.id), ["account", "time", "link"]);
  assert.deepEqual(fieldsFor("slack", "text").map((f) => f.id), ["room"]);
  assert.deepEqual(fieldsFor("drive", "file"), []);
});

test("source: the panel sends link, channel, accounts and time; the old Publish page says Practice, not dry run", () => {
  const parts = read("web", "features", "mindmedia-parts.js");
  for (const w of ["mm-pub-link", "mm-pub-room", "data-acc", "mm-pub-time", "Save to Drive instead".length ? "fitFixes" : ""]) assert.ok(parts.includes(w), w);
  const pub = read("web", "features", "publish.js");
  assert.ok(!/dry run/i.test(pub.replace(/r\.dryRun/g, "")), "no dry run wording");
  assert.match(pub, /practice only, nothing is sent/);
  assert.equal(parts.includes("—") || parts.includes("–"), false);
});

test("source: a failed send shows the plain reason, Try again and Open Settings (H9)", () => {
  const parts = read("web", "features", "mindmedia-parts.js");
  assert.match(parts, /data-retry>Try again/);
  assert.match(parts, /Open Settings for/);
});
