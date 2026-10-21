// Key vault for hosted runs.
// The desktop app (the client of the worker) seals each provider key with a
// fresh AES-256-GCM key, then wraps that key to the worker public key
// (RSA-OAEP, SHA-256). Only the worker private key can open it. The browser
// never receives a raw key, and the queue stores ciphertext only.
import crypto from "node:crypto";

const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };

export function createWorkerKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

export function sealSecret({ publicKey, userId, provider, secret }) {
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`${userId}:${provider}`, "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  const wrapped = crypto.publicEncrypt({ key: publicKey, ...OAEP }, dek);
  return {
    v: 1,
    userId: String(userId),
    provider: String(provider),
    wrappedKey: wrapped.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function sealSecrets({ publicKey, userId, secrets }) {
  const envelopes = [];
  for (const [provider, value] of Object.entries(secrets || {})) {
    const key = value && typeof value === "object" ? value.key : value;
    if (!key || value?.managed) continue;
    envelopes.push(sealSecret({ publicKey, userId, provider, secret: String(key) }));
  }
  return envelopes;
}

// Worker only. A wrong user id or a copied envelope fails the auth tag.
export function openSecret({ privateKey, envelope }) {
  if (!envelope || envelope.v !== 1) throw new Error("The sealed key is not a hosted-run envelope.");
  const dek = crypto.privateDecrypt({ key: privateKey, ...OAEP }, Buffer.from(envelope.wrappedKey, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(Buffer.from(`${envelope.userId}:${envelope.provider}`, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function redactSecrets(text, secrets) {
  let out = String(text || "");
  for (const value of Object.values(secrets || {})) {
    const raw = value && typeof value === "object" ? value.key : value;
    const s = String(raw || "");
    if (s.length >= 4) out = out.split(s).join("[key]");
  }
  return out;
}
