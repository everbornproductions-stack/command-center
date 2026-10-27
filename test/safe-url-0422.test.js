import test from "node:test";
import assert from "node:assert";
import dns from "node:dns";

// Helper isPublicHttpUrl as specified in the brief
export function isPublicHttpUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const hostname = u.hostname.toLowerCase();
    
    // Check localhost, loopback, private IP literals
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

test("isPublicHttpUrl - rejects private IP literals and non-http", () => {
  assert.strictEqual(isPublicHttpUrl("http://127.0.0.1/foo"), false);
  assert.strictEqual(isPublicHttpUrl("http://localhost:8080"), false);
  assert.strictEqual(isPublicHttpUrl("http://10.0.0.1/"), false);
  assert.strictEqual(isPublicHttpUrl("http://192.168.1.1/"), false);
  assert.strictEqual(isPublicHttpUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.strictEqual(isPublicHttpUrl("file:///etc/passwd"), false);
  assert.strictEqual(isPublicHttpUrl("javascript:alert(1)"), false);
});

test("isPublicHttpUrl - allows public https URLs", () => {
  assert.strictEqual(isPublicHttpUrl("https://example.com/path"), true);
  assert.strictEqual(isPublicHttpUrl("http://example.com/"), true);
});
