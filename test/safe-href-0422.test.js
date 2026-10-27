import test from "node:test";
import assert from "node:assert";

// Helper safeHref as specified in the brief
export function safeHref(url) {
  const s = String(url || "").trim();
  if (s.startsWith("#")) return s; // same-page hash
  try {
    const u = new URL(s);
    if (["http:", "https:", "mailto:"].includes(u.protocol)) {
      return u.href;
    }
    return "#";
  } catch {
    // If not a full URL and not hash, check if relative or reject
    if (s.startsWith("/")) return s;
    return "#";
  }
}

test("safeHref - allows http, https, mailto and hash", () => {
  assert.strictEqual(safeHref("https://example.com"), "https://example.com/");
  assert.strictEqual(safeHref("http://example.com/foo"), "http://example.com/foo");
  assert.strictEqual(safeHref("mailto:test@example.com"), "mailto:test@example.com");
  assert.strictEqual(safeHref("#section"), "#section");
  assert.strictEqual(safeHref("/local/path"), "/local/path");
});

test("safeHref - rejects javascript: and dangerous schemes", () => {
  assert.strictEqual(safeHref("javascript:alert(1)"), "#");
  assert.strictEqual(safeHref("data:text/html,<script>alert(1)</script>"), "#");
});
