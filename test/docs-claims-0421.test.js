// 0.4.21 item 18: README trial wording matches the code, and Notion library setup shows its own plain steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-notionsteps-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const LS = await import("../server/library-sources.js");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = String.fromCharCode(0x2014);

test("README: the trial is on unless CC_TRIAL=0, and the code agrees", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /CC_TRIAL=1/);
  assert.match(readme, /on unless the host sets CC_TRIAL=0/);
  assert.match(read("server", "growth.js"), /trial: process\.env\.CC_TRIAL !== "0"/);
});

test("Notion: six plain steps, create an integration, read only, paste the id and secret", () => {
  const steps = LS.NOTION_STEPS;
  assert.equal(steps.length, 6);
  const all = steps.join("\n");
  assert.match(steps[0], /notion\.so\/profile\/integrations/);
  assert.match(all, /Read content only/);
  assert.match(all, /OAuth client ID and the OAuth client secret/);
  assert.match(all, /\{address\}/);
  assert.ok(!all.includes(EM) && !LS.NOTION_SETUP.includes(EM));
  assert.doesNotMatch(LS.NOTION_SETUP, /redirect URI|public integration/i, "the error line has no jargon");
});

test("the Notion source view carries the steps (Google does not), and the page lists them", () => {
  const n = LS.sourceView("notion");
  assert.deepEqual(n.steps, LS.NOTION_STEPS);
  assert.deepEqual(LS.sourceView("google").steps, []);
  const ui = read("web", "features", "libraries.js");
  assert.match(ui, /data-setup-steps/);
  assert.match(ui, /t\.replace\("\{address\}"/);
});

test("starting Notion with no client ID says what to do first in plain words", () => {
  assert.throws(() => LS.start("notion", { redirectUri: "http://127.0.0.1:4747/" }), (e) => e.code === "client_id" && /Create a Notion integration first/.test(e.message));
});
