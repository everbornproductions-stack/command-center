// 0.4.21 item 13: what the welcome screen, Settings and the guide say about anonymous counts matches the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { privacyView, keptNote, SIGNALS_KEPT_NOTE } from "../server/privacy.js";
import { flagOn } from "../server/flags.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = String.fromCharCode(0x2014);

test("while signals are not sent, the view carries the plain note; once sending is live it is gone", () => {
  assert.equal(flagOn("signalsend"), false, "sending quality signals is off in this build");
  assert.equal(privacyView({ signalSending: false }).keptNote, SIGNALS_KEPT_NOTE);
  assert.match(SIGNALS_KEPT_NOTE, /kept on this computer for now/);
  assert.equal(privacyView({ signalSending: true }).keptNote, "");
  assert.equal(keptNote(true), "");
  assert.ok(!SIGNALS_KEPT_NOTE.includes(EM));
});

test("the welcome screen and Settings show that note from the server", () => {
  const app = read("web", "app.js");
  assert.match(app, /st\.keptNote = d\?\.keptNote/);
  assert.match(app, /id="su-kept-note"/);
  assert.match(app, /id="basics-kept-note"/);
  assert.match(app, /kept\.textContent = d\?\.keptNote/);
  assert.match(read("web", "features", "privacy.js"), /view\.keptNote/);
});

test("guide sections 1 and 13 agree: same default, same regional rule, same 'kept on this computer'", () => {
  const g = read("docs", "USER-GUIDE.md");
  const s1 = g.slice(g.indexOf("## 1. "), g.indexOf("## 2. "));
  const s13 = g.slice(g.indexOf("## 13. "), g.indexOf("## 14. "));
  assert.ok(s13.length > 200, "section 13 has its paragraph under its own heading");
  for (const [n, s] of [[1, s1], [13, s13]]) {
    assert.match(s, /usage count/i, `section ${n} covers usage counts`);
    assert.match(s, /kept on this computer/, `section ${n} says the results stay here`);
    assert.doesNotMatch(s, /switch is off until you turn it on|off on new installs/i, `section ${n} does not say off by default`);
  }
  assert.match(s1, /on by default/);
  assert.match(s13, /on by default outside the EU and the UK/);
  assert.ok(!g.includes(EM));
  assert.doesNotMatch(read("docs", "help", "getting-started.md"), /usage counts are off on new installs/i);
});
