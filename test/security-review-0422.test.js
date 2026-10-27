import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("SECURITY-REVIEW-0422.md exists and has rows for all groups", () => {
  const filePath = path.join(process.cwd(), "docs", "SECURITY-REVIEW-0422.md");
  assert.strictEqual(fs.existsSync(filePath), true, "SECURITY-REVIEW-0422.md must exist");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("1. File inclusion"), "Must mention File inclusion");
  assert.ok(content.includes("2. SSRF"), "Must mention SSRF");
  assert.ok(content.includes("3. location.href XSS"), "Must mention location.href XSS");
});
