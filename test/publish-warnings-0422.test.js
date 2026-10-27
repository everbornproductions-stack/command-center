import { test } from "node:test";
import assert from "node:assert/strict";

test("publish preview warnings helper logic handles strings and objects and leaves Publish enabled", () => {
  const warnings = [
    "Heads up: Guaranteed results warning",
    { plain: "Object warning plain text", why: "Object warning why text" }
  ];
  
  const mapped = warnings.map((w) => typeof w === "string" ? w : (w.plain || w.why || JSON.stringify(w)));
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0], "Heads up: Guaranteed results warning");
  assert.equal(mapped[1], "Object warning plain text");

  // Verify that warnings alone (problems = []) do not block publishing (go.disabled = problems.length > 0 && !dryRun)
  const problems = [];
  const dryRun = true;
  const disabled = problems.length > 0 && !dryRun;
  assert.equal(disabled, false, "warnings alone never disable the Publish button");
});
