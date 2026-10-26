import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { bracketFields, fillBracket } from "../web/bracket-fill.js";

test("blanks are found once each, review tags are skipped, filling replaces every copy", () => {
  const t = "Hi [Name], your visit on [day] is set. [Name], see you [day]. [VERIFY] [ASK] [CROA]";
  assert.deepEqual(bracketFields(t), ["Name", "day"]);
  assert.equal(fillBracket(t, "Name", " Sam "), "Hi Sam, your visit on [day] is set. Sam, see you [day]. [VERIFY] [ASK] [CROA]");
  assert.equal(fillBracket(t, "day", ""), t);
  assert.deepEqual(bracketFields("No blanks here"), []);
  assert.equal(fillBracket("Cost [$ amount]", "$ amount", "$5"), "Cost $5");
});
test("source: the strip is a shell module and keeps Send a click", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "bracket-strip.js"), "utf8");
  assert.match(ui, /Fill in the blanks/);
  assert.equal(/\/api\/|api\(/.test(ui), false);
  assert.match(fs.readFileSync(path.join(ROOT, "web", "perf", "registry.js"), "utf8"), /id: "bracket-strip", shell: true/);
});
