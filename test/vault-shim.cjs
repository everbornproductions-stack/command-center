// Test-only stand-in for the desktop app's OS keychain (globalThis.__ccSafeStorage).
// The real vault still refuses to save keys in plain Node. This lets the test server
// seal and reopen keys the same way Electron does, with a key that exists only in this process.
const crypto = require("crypto");
const key = crypto.createHash("sha256").update("command-ai-test-vault").digest();

globalThis.__ccSafeStorage = {
  backend: "test",
  available() { return true; },
  encrypt(s) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(String(s), "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
  },
  decrypt(b64) {
    const buf = Buffer.from(String(b64), "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  },
};
