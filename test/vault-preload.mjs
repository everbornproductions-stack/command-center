// Test-only stand-in for the desktop app's OS keychain. Plain Node on Linux has no
// DPAPI and no Electron safeStorage, so the server refuses to seal keys. This module
// is loaded with `node --import` by test/helpers.js and never by the app. It seals
// the vault with AES-256-GCM under a fixed test key. It is not a plaintext fallback.
import crypto from "node:crypto";

const KEY = crypto.createHash("sha256").update("command-ai-test-vault").digest();

function encrypt(str) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(str), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}
function decrypt(b64) {
  const buf = Buffer.from(String(b64), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

globalThis.__ccSafeStorage = {
  backend: "test",
  available: () => true,
  encrypt,
  decrypt,
};
