// Test-only stand-in for Electron safeStorage. startServer loads this with node --import.
// The desktop app never loads it. Keys are sealed with AES-256-GCM; the key is derived from
// this test's data folder so a restarted server in the same folder can open the vault, and
// another test cannot. Nothing here is a fallback the real app can turn on.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

if (process.env.CC_TEST_VAULT === "1") {
  const key = createHash("sha256").update(`cc-test-vault:${process.env.CC_DATA_DIR || ""}`).digest();
  globalThis.__ccSafeStorage = {
    backend: "test",
    available: () => true,
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
    },
    decrypt(b64) {
      const buf = Buffer.from(b64, "base64");
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    },
  };
}
