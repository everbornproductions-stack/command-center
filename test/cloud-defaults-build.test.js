// The release build must inject the Supabase publishable key and refuse to ship without it.
// The value is never committed and never printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ROOT } from "./helpers.js";
import { BAD_KEY, MISSING_KEY, prepareCloudDefaults, publishableFromEnv, publishableShape, unpublishedPack } from "../scripts/inject-cloud-key.mjs";

const script = path.join(ROOT, "scripts", "inject-cloud-key.mjs");
const SAMPLE = "sb_publishable_testkeyvalue";

function tempDefaults(anonKey = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cloud-"));
  const file = path.join(dir, "cloud-defaults.json");
  fs.writeFileSync(file, JSON.stringify({ _comment: "test", url: "https://ezbpstloczzdlcxwliwu.supabase.co", anonKey }, null, 2) + "\n");
  return file;
}

test("committed cloud-defaults.json keeps the project URL and an empty publishable key", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "cloud-defaults.json"), "utf8"));
  assert.equal(doc.anonKey, "");
  assert.match(doc.url, /^https:\/\/ezbpstloczzdlcxwliwu\.supabase\.co\/?$/);
  assert.match(doc._comment, /CC_SUPABASE_ANON_KEY/);
  assert.match(doc._comment, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(JSON.stringify(doc), /sb_publishable_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(JSON.stringify(doc), /sb_secret_|service_role/);
});

test("publishable key comes from CC_SUPABASE_ANON_KEY, then SUPABASE_PUBLISHABLE_KEY", () => {
  assert.equal(publishableFromEnv({}), "");
  assert.equal(publishableFromEnv({ SUPABASE_PUBLISHABLE_KEY: " sb_publishable_fromsecond " }), "sb_publishable_fromsecond");
  assert.equal(publishableFromEnv({ CC_SUPABASE_ANON_KEY: SAMPLE, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_otherkeyval" }), SAMPLE);
  assert.equal(publishableShape(SAMPLE), "ok");
  assert.equal(publishableShape(""), "missing");
  assert.equal(publishableShape("sb_secret_notapublishablekey"), "secret");
  assert.equal(publishableShape("service_role_key_value"), "secret");
  assert.equal(publishableShape("not-a-key"), "shape");
  const jwt = (payload) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
  assert.equal(publishableShape(jwt({ role: "anon" })), "ok");
  assert.equal(publishableShape(jwt({ role: "service_role" })), "secret");
});

test("a release build fails loudly when the publishable key is missing and does not write one", () => {
  const file = tempDefaults("");
  assert.throws(() => prepareCloudDefaults({ file, env: {}, release: true }), (err) => {
    assert.equal(err.code, "missing_publishable_key");
    assert.equal(err.message, MISSING_KEY);
    assert.match(err.message, /CC_SUPABASE_ANON_KEY/);
    assert.match(err.message, /SUPABASE_PUBLISHABLE_KEY/);
    assert.match(err.message, /EVERBORN-OWNER/);
    assert.match(err.message, /Free tier/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).anonKey, "");
});

test("a release build refuses a service key and leaves the file empty", () => {
  const file = tempDefaults("");
  assert.throws(() => prepareCloudDefaults({ file, env: { CC_SUPABASE_ANON_KEY: "sb_secret_notapublishablekey" }, release: true }), (err) => {
    assert.equal(err.code, "bad_publishable_key");
    assert.equal(err.message, BAD_KEY);
    assert.doesNotMatch(err.message, /sb_secret_notapublishablekey/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).anonKey, "");
});

test("a release build writes the publishable key and restore clears it", () => {
  const file = tempDefaults("");
  const before = fs.readFileSync(file, "utf8");
  const result = prepareCloudDefaults({ file, env: { SUPABASE_PUBLISHABLE_KEY: SAMPLE }, release: true });
  assert.equal(result.wrote, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).anonKey, SAMPLE);
  result.restore();
  assert.equal(fs.readFileSync(file, "utf8"), before);
  result.restore();
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("an unpublished package may omit the key and still refuses a service key", () => {
  assert.equal(unpublishedPack({}), false);
  assert.equal(unpublishedPack({ CC_PACK_UNPUBLISHED: "1" }), true);
  const file = tempDefaults("");
  const before = fs.readFileSync(file, "utf8");
  const result = prepareCloudDefaults({ file, env: { CC_PACK_UNPUBLISHED: "1" }, release: true });
  assert.equal(result.wrote, false);
  assert.equal(result.warned, true);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.throws(() => prepareCloudDefaults({ file, env: { CC_PACK_UNPUBLISHED: "1", CC_SUPABASE_ANON_KEY: "sb_secret_notapublishablekey" }, release: true }), (err) => {
    assert.equal(err.code, "bad_publishable_key");
    assert.doesNotMatch(err.message, /sb_secret_notapublishablekey/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).anonKey, "");
});

test("dev and tests do not fail or write when the key is missing", () => {
  const file = tempDefaults("");
  const result = prepareCloudDefaults({ file, env: {}, release: false });
  assert.equal(result.warned, true);
  assert.equal(result.wrote, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).anonKey, "");
});

test("npm run dist checks the key before electron-builder, and --check fails without printing a key", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts.dist, /scripts\/inject-cloud-key\.mjs/);
  assert.match(pkg.scripts.dist, /electron-builder --win --publish never/);
  assert.match(pkg.scripts["dist:mac"], /scripts\/inject-cloud-key\.mjs/);
  assert.match(pkg.scripts["dist:mac"], /electron-builder --mac dmg zip --x64 --arm64 --publish never/);
  const env = { ...process.env };
  delete env.CC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_PUBLISHABLE_KEY;
  const ran = spawnSync(process.execPath, [script, "--check"], { env, encoding: "utf8" });
  assert.notEqual(ran.status, 0);
  const out = `${ran.stdout || ""}\n${ran.stderr || ""}`;
  assert.match(out, /CC_SUPABASE_ANON_KEY/);
  assert.match(out, /SUPABASE_PUBLISHABLE_KEY/);
  assert.match(out, /Release build stopped/);
  assert.doesNotMatch(out, /sb_publishable_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(out, /sb_secret_/);
});
