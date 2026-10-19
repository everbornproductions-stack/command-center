// Test stand-in for Electron safeStorage. Plain Node on macOS and Linux cannot
// seal the vault, so key-saving tests would refuse every key. This pretends to
// be the desktop app's keychain for the test process only. It is not used by
// the app. The key is a fixed test value, never a real secret.
const crypto = require("node:crypto");
const key = crypto.createHash("sha256").update("command-ai-test-vault").digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decrypt(b64) {
  const buf = Buffer.from(String(b64), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

globalThis.__ccSafeStorage = {
  backend: "test",
  available() { return true; },
  encrypt,
  decrypt,
};
