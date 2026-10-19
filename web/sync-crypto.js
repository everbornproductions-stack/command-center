// Encrypted chat sync (Phase 23): the end-to-end encryption shared by the desktop server (Node) and the
// browser on a phone (hosted hub). Plain WebCrypto only, so both sides produce and read the same bytes.
//   key:     PBKDF2-SHA256 over the person's passphrase and a random per-space salt -> 64 bytes:
//            the first 32 are the AES-256-GCM key, the last 32 an HMAC key
//   token:   HMAC(macKey, "cc-sync-auth-v1"), sent to the sync functions, which keep only its SHA-256
//   item id: HMAC(macKey, "item:" + chat id), so the server never sees chat ids
//   blob:    base64( "v1" | iv[12] | AES-GCM ciphertext+tag ), AAD = the item id (a blob moved to another row fails)
// The passphrase and the keys never leave the device. The server stores ciphertext only.
const subtle = () => globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_DEFAULT = { name: "PBKDF2", hash: "SHA-256", iterations: 600000 };
export const MIN_PASSPHRASE = 10;
const MAGIC = [0x76, 0x31]; // "v1"
const CHECK_TEXT = "command-ai-sync-check-v1";

export const b64 = (bytes) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(u).toString("base64");
  let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(String(s), "base64"));
  const bin = atob(String(s)); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const randomB64 = (n = 16) => b64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
// A sync code: 20 random bytes as base32-ish groups, typed on the second device (it names the space, it is not the key)
export function newSyncCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = globalThis.crypto.getRandomValues(new Uint8Array(20));
  const s = [...r].map((x) => A[x & 31]).join("");
  return s.match(/.{5}/g).join("-");
}
export const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{5})(?=.)/g, "$1-");
export const validCode = (c) => /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(normCode(c));

export function checkPassphrase(p) {
  const s = String(p || "");
  if (s.length < MIN_PASSPHRASE) throw Object.assign(new Error(`The passphrase needs at least ${MIN_PASSPHRASE} characters. A few unrelated words work well.`), { status: 400 });
  return s;
}

// passphrase + salt -> raw 64 bytes (the only slow step; done once per device, the result is kept in the vault)
export async function deriveRaw(passphrase, saltB64, kdf = KDF_DEFAULT) {
  const base = await subtle().importKey("raw", te.encode(String(passphrase).normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: kdf.hash || "SHA-256", salt: unb64(saltB64), iterations: Number(kdf.iterations) || KDF_DEFAULT.iterations }, base, 512);
  return b64(bits);
}

// raw 64 bytes (base64) -> { aes, mac, token }
export async function keysFromRaw(rawB64) {
  const raw = unb64(rawB64);
  if (raw.length !== 64) throw new Error("Sync key has the wrong length.");
  const aes = await subtle().importKey("raw", raw.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  const mac = await subtle().importKey("raw", raw.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const token = b64(await subtle().sign("HMAC", mac, te.encode("cc-sync-auth-v1")));
  return { aes, mac, token };
}

export async function itemId(keys, chatId) {
  return hex(await subtle().sign("HMAC", keys.mac, te.encode(`item:${chatId}`))).slice(0, 40);
}

export async function seal(keys, obj, aad) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: te.encode(String(aad)) }, keys.aes, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(2 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(iv, 2); out.set(ct, 14);
  return b64(out);
}

export async function open(keys, blob, aad) {
  const u = unb64(blob);
  if (u.length < 30 || u[0] !== MAGIC[0] || u[1] !== MAGIC[1]) throw new Error("Not a Meldmind sync blob.");
  let plain;
  try { plain = await subtle().decrypt({ name: "AES-GCM", iv: u.slice(2, 14), additionalData: te.encode(String(aad)) }, keys.aes, u.slice(14)); }
  catch { throw Object.assign(new Error("Could not decrypt: wrong passphrase, or the data was changed."), { code: "decrypt_failed" }); }
  return JSON.parse(td.decode(plain));
}

// The space keeps one sealed check value, so a second device can tell a wrong passphrase apart from no data.
export const makeCheck = (keys) => seal(keys, { check: CHECK_TEXT }, "check");
export async function verifyCheck(keys, blob) {
  try { return (await open(keys, blob, "check"))?.check === CHECK_TEXT; } catch { return false; }
}
