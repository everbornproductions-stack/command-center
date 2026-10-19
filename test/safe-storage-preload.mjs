// Test stand-in for Electron safeStorage. Plain Node on macOS and Linux refuses to seal keys
// (server/vault.js). The test helper loads this before the server so a temp data dir can store
// keys the way the desktop app does. The app itself never loads this file.
globalThis.__ccSafeStorage = {
  backend: "test",
  available() { return true; },
  encrypt(s) { return Buffer.from(String(s), "utf8").toString("base64"); },
  decrypt(b64) { return Buffer.from(String(b64), "base64").toString("utf8"); },
};
