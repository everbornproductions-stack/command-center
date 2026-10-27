// 0.4.22 (Aikido): every checkout step drops its git credentials, or says why a later step needs them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const FILES = ["windows-ci.yml", "mac-ci.yml", "release-windows.yml"];

test("each actions/checkout step has persist-credentials: false or a 'needs git credentials' note", () => {
  let seen = 0;
  for (const f of FILES) {
    const lines = fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8").replace(/\r\n/g, "\n").split("\n");
    lines.forEach((l, i) => {
      if (!/uses:\s*actions\/checkout@/.test(l)) return;
      seen++;
      const after = lines.slice(i + 1, i + 4).join("\n");
      const before = lines.slice(Math.max(0, i - 2), i).join("\n");
      const ok = /persist-credentials:\s*false/.test(after) || /needs git credentials/.test(before + after);
      assert.ok(ok, `${f}:${i + 1}`);
    });
  }
  assert.equal(seen, 4, "four checkout steps (windows-ci, mac-ci, release x2)");
});

test("the PR workflows drop the credentials outright", () => {
  for (const f of ["windows-ci.yml", "mac-ci.yml"]) {
    const s = fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8");
    assert.match(s, /persist-credentials:\s*false/, f);
  }
});

test("the release workflow still has its release checks and the Mac job", () => {
  const s = fs.readFileSync(path.join(ROOT, ".github", "workflows", "release-windows.yml"), "utf8");
  assert.match(s, /does not match package\.json version/);
  assert.match(s, /mac-release:/);
});
