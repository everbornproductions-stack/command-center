// 0.4.22 panel row 17: warnings (not blocks) are drawn on every Publish preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { warningLines } from "../web/publish-fit.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("warningLines turns strings and { plain, why } rows into plain lines, once each", () => {
  assert.deepEqual(warningLines(["Heads up: guaranteed results", { plain: "Say what you can prove.", why: "x" }, { why: "Only why" }, "", null, "Heads up: guaranteed results"]),
    ["Heads up: guaranteed results", "Say what you can prove.", "Only why"]);
  assert.deepEqual(warningLines(undefined), []);
  assert.deepEqual(warningLines("not a list"), []);
});

test("both preview handlers draw the warning lines and warnings never disable Publish", () => {
  const a = read("web", "features", "publish.js");
  const b = read("web", "features", "mindmedia-parts.js");
  for (const src of [a, b]) {
    assert.match(src, /warningLines\(r\.warnings\)/);
    assert.match(src, /import \{[^}]*warningLines[^}]*\} from "\/publish-fit\.js"/);
  }
  // the old rule stays: only problems disable the button
  assert.match(a, /go\.disabled = r\.problems\.length > 0 && !r\.dryRun/);
});
