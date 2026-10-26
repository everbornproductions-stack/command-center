// Makes the stored licence tamper-evident so editing license.json cannot unlock a paid tier.
// Two proofs, either one is enough:
//   1. A server signature (Ed25519, public key in server/license-pubkey.json, nothing secret in git).
//   2. A seal (HMAC) the app writes with a per-install key file, so a hand edit of the record breaks it.
// Only installed builds (CC_PACKAGED=1) and CC_LICENSE_STRICT=1 enforce it. Source runs and the
// plain test suite keep the old behaviour. Hosted mode takes its tier from the hub, not from here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ROOT, readJson } from "./paths.js";
import { HOSTED } from "./store.js";

const SEAL_FILE = () => path.join(process.env.CC_DATA_DIR || DATA_DIR, "license.seal");
const PUBKEY_FILE = path.join(ROOT, "server", "license-pubkey.json");

export const strictMode = () => !HOSTED && (process.env.CC_PACKAGED === "1" || process.env.CC_LICENSE_STRICT === "1");

// The fields a person could gain from changing. Text such as message and lastError is left out.
const FIELDS = ["key", "via", "tier", "status", "email", "periodEnd", "plan", "deviceId", "lastOkAt", "maxDevices"];
export function sealPayload(l) {
  return JSON.stringify(FIELDS.map((f) => (l?.[f] === undefined ? null : l[f])));
}
export function serverPayload(l) {
  return JSON.stringify([l?.key ?? null, l?.deviceId ?? null, l?.tier ?? null, l?.status ?? null, l?.email ?? null, l?.periodEnd ?? null, l?.plan ?? null, l?.issuedAt ?? null]);
}

// { key, created }: the key file is made on first use.
export function sealKey() {
  const file = SEAL_FILE();
  try {
    const k = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(k)) return { key: k, created: false };
  } catch { /* first use */ }
  const key = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key + "\n", { mode: 0o600 });
  return { key, created: true };
}

const mac = (l, key) => crypto.createHmac("sha256", key).update(sealPayload(l)).digest("hex");
export const sealOf = (l) => mac(l, sealKey().key);

function publicKey() {
  const cfg = readJson(PUBKEY_FILE, {}) || {};
  // The env override is for tests and source runs; an installed build ignores it.
  const b64 = String((process.env.CC_PACKAGED === "1" ? "" : process.env.CC_LICENSE_PUBKEY) || cfg.publicKey || "").trim();
  return { b64, required: cfg.requireServerSignature === true };
}

export function verifyServerSig(l) {
  const { b64 } = publicKey();
  if (!b64 || !l?.sig) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(serverPayload(l)), key, Buffer.from(String(l.sig), "base64"));
  } catch { return false; }
}

export function isTrusted(l) {
  if (!strictMode()) return true;
  if (!l || !l.tier) return true; // nothing to unlock
  if (verifyServerSig(l)) return true;
  if (publicKey().required) return false;
  const seal = String(l.seal || "");
  if (!seal) return false;
  const want = Buffer.from(sealOf(l));
  const got = Buffer.from(seal);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// An install from before the seal existed: seal what is there, once, when the key file is new.
export function sealOnce(l) {
  if (!strictMode() || !l?.tier || l.seal) return null;
  const { key, created } = sealKey();
  return created ? mac(l, key) : null;
}
