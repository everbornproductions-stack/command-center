// A hand-edited license.json must not unlock a paid tier. No real key, no data/ folder.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./helpers.js";

const DIR = tmpDir("cc-seal-");
process.env.CC_DATA_DIR = DIR;
delete process.env.CC_DEV_OWNER;
process.env.CC_LICENSE_STRICT = "1";
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const Lic = await import("../server/license.js");
const Gate = await import("../server/feature-gate.js");
const Seal = await import("../server/license-seal.js");
after(() => { delete process.env.CC_LICENSE_STRICT; delete process.env.CC_LICENSE_PUBKEY; });

const forged = () => ({ key: "FAKE-KEY", tier: "extreme", status: "active", email: "x@example.com", lastOkAt: Date.now(), checkedAt: Date.now(), deviceId: "d1", periodEnd: null });

test("the hole: a hand-written license doc is Free once it is not sealed", () => {
  store.putDoc("license", forged());
  assert.equal(Lic.licenseState().tier, "free");
  assert.equal(Lic.licenseState().reason, "licence_unverified");
  assert.equal(Gate.currentTier(), "free");
});

test("a record saved by the app is sealed and keeps its tier", () => {
  Lic.__saveForTest({ ...forged(), tier: "pro" });
  assert.equal(Lic.licenseState().tier, "pro");
  assert.equal(Gate.currentTier(), "pro");
});

test("editing the tier or the dates of a sealed record breaks the seal", () => {
  Lic.__saveForTest({ ...forged(), tier: "pro" });
  const doc = store.doc("license");
  store.putDoc("license", { ...doc, tier: "extreme" });
  assert.equal(Lic.licenseState().tier, "free");
  store.putDoc("license", { ...doc, lastOkAt: doc.lastOkAt + 1e9 });
  assert.equal(Lic.licenseState().tier, "free");
  store.putDoc("license", { ...doc, plan: "lifetime-founder" });
  assert.equal(Lic.licenseState().tier, "free");
  store.putDoc("license", { ...doc, message: "hello" });
  assert.equal(Lic.licenseState().tier, "pro", "text fields are not part of the seal");
});

test("a failed recheck cannot launder a tampered record into a sealed one", () => {
  store.putDoc("license", forged());
  Lic.__saveForTest({ lastError: "offline" });
  assert.equal(Lic.licenseState().tier, "free");
});

test("an install from before the seal existed keeps its tier once", async () => {
  fs.rmSync(path.join(DIR, "license.seal"), { force: true });
  fs.rmSync(path.join(DIR, "license.sealed"), { force: true }); // an old install has neither file
  store.putDoc("license", { ...forged(), tier: "pro" });
  Lic.sealExistingInstall();
  assert.equal(Lic.licenseState().tier, "pro");
  const doc = store.doc("license");
  store.putDoc("license", { ...doc, tier: "extreme" });
  Lic.sealExistingInstall();
  assert.equal(Lic.licenseState().tier, "free", "the grandfather step runs only when the seal key is new");
});

test("a server signature (public key) is accepted and a bad one is not", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CC_LICENSE_PUBKEY = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const rec = { ...forged(), tier: "extreme", issuedAt: 1760000000000 };
  const sig = crypto.sign(null, Buffer.from(Seal.serverPayload(rec)), privateKey).toString("base64");
  assert.equal(Seal.verifyServerSig({ ...rec, sig }), true);
  assert.equal(Seal.verifyServerSig({ ...rec, tier: "pro", sig }), false);
  assert.equal(Seal.verifyServerSig({ ...rec, sig: "AAAA" }), false);
  store.putDoc("license", { ...rec, sig });
  assert.equal(Lic.licenseState().tier, "extreme");
  store.putDoc("license", { ...rec, sig, email: "other@example.com" });
  assert.equal(Lic.licenseState().tier, "free");
  delete process.env.CC_LICENSE_PUBKEY;
});

test("outside strict mode (source runs, tests) an unsealed record still works", () => {
  delete process.env.CC_LICENSE_STRICT;
  store.putDoc("license", forged());
  assert.equal(Lic.licenseState().tier, "extreme");
  process.env.CC_LICENSE_STRICT = "1";
});

test("deleting license.seal and the marker cannot re-seal an edited record after the grandfather date", async () => {
  process.env.CC_LICENSE_GRANDFATHER_UNTIL = "2020-01-01";
  try {
    fs.rmSync(path.join(DIR, "license.seal"), { force: true });
    fs.rmSync(path.join(DIR, "license.sealed"), { force: true });
    store.putDoc("license", { ...forged(), tier: "extreme" });
    Lic.sealExistingInstall();
    assert.equal(Lic.licenseState().tier, "free");
  } finally { delete process.env.CC_LICENSE_GRANDFATHER_UNTIL; }
});

test("deleting only the seal key file does not re-seal when the marker exists", async () => {
  Lic.__saveForTest({ ...forged(), tier: "pro" }); // makes key + marker
  assert.ok(fs.existsSync(path.join(DIR, "license.sealed")));
  fs.rmSync(path.join(DIR, "license.seal"), { force: true });
  store.putDoc("license", { ...forged(), tier: "extreme" }); // edited, no seal
  Lic.sealExistingInstall();
  assert.equal(Lic.licenseState().tier, "free");
});

test("a server-signed record with a test keypair stays trusted with no seal and no grandfather", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CC_LICENSE_PUBKEY = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  try {
    const rec = { ...forged(), tier: "pro", issuedAt: 1 };
    rec.sig = crypto.sign(null, Buffer.from(Seal.serverPayload(rec)), privateKey).toString("base64");
    store.putDoc("license", rec);
    assert.equal(Lic.licenseState().tier, "pro");
    store.putDoc("license", { ...rec, tier: "extreme" });
    assert.equal(Lic.licenseState().tier, "free");
  } finally { delete process.env.CC_LICENSE_PUBKEY; }
});
