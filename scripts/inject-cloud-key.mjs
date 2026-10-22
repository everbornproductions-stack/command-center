// Release builds write the Supabase publishable key into server/cloud-defaults.json,
// then put the empty value back so it is never committed. The service key is refused.
// A release build with no key stops, because an empty key leaves every copy on Free
// and EVERBORN-OWNER cannot redeem.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareOAuthSecret } from "./inject-oauth-secret.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULTS_FILE = path.join(ROOT, "server", "cloud-defaults.json");

export const MISSING_KEY = "Release build stopped: the Supabase publishable key is not set. Set CC_SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY to the publishable key (it starts with sb_publishable_) and run the build again. Never use the service key. Without this key every installed copy stays on the Free tier and EVERBORN-OWNER cannot redeem.";
export const BAD_KEY = "Release build stopped: CC_SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY is not a publishable key. Use the publishable key, not the service key.";

export function publishableFromEnv(env = process.env) {
  return String(env.CC_SUPABASE_ANON_KEY || "").trim() || String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
}

// CI packaging only. A missing key does not throw, and nothing is written.
// A service key is still refused. Release builds must not set this.
export function unpublishedPack(env = process.env) {
  return String(env.CC_PACK_UNPUBLISHED || "").trim() === "1";
}

export function publishableShape(key) {
  const k = String(key || "").trim();
  if (!k) return "missing";
  if (/sb_secret_|service_role/i.test(k)) return "secret";
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(k)) return "ok";
  if (k.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") return "secret";
      if (payload.role === "anon") return "ok";
    } catch { /* not a usable anon JWT */ }
  }
  return "shape";
}

// Writes anonKey for a release build. Returns { restore } which puts the file bytes back.
// release false and a missing key does not write and does not throw (dev and tests).
export function prepareCloudDefaults({ file = DEFAULTS_FILE, env = process.env, release = false } = {}) {
  const original = fs.readFileSync(file, "utf8");
  const key = publishableFromEnv(env);
  const shape = publishableShape(key);
  if (shape !== "ok") {
    if (!release || (shape === "missing" && unpublishedPack(env))) {
      return { ok: true, warned: shape === "missing", wrote: false, restore() {} };
    }
    const err = new Error(shape === "missing" ? MISSING_KEY : BAD_KEY);
    err.code = shape === "missing" ? "missing_publishable_key" : "bad_publishable_key";
    throw err;
  }
  const doc = JSON.parse(original);
  doc.anonKey = key;
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  let restored = false;
  return {
    ok: true,
    warned: false,
    wrote: true,
    restore() {
      if (restored) return;
      restored = true;
      fs.writeFileSync(file, original);
    },
  };
}

function runCheck() {
  try {
    const result = prepareCloudDefaults({ release: true });
    result.restore();
    console.log("Publishable key is set. A release build can write it into cloud-defaults.json.");
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

function runBuild(builderArgs) {
  let prepared;
  try { prepared = prepareCloudDefaults({ release: true }); }
  catch (e) { console.error(e.message); return 1; }
  if (prepared.wrote) {
    console.log("Licence server publishable key written for this build. It is cleared again when the build finishes, so it is not committed.");
  } else if (unpublishedPack()) {
    console.log("Unpublished package: no publishable key was written. Do not publish this installer.");
  }
  // One-click Sign in with Google: the desktop client secret, same pattern, never printed.
  let oauth;
  try { oauth = prepareOAuthSecret(); }
  catch (e) { prepared.restore(); console.error("The Google sign-in secret could not be prepared."); return 1; }
  console.log(oauth.message);
  let status = 1;
  try {
    const require = createRequire(import.meta.url);
    const bin = require.resolve("electron-builder/cli.js");
    const child = spawnSync(process.execPath, [bin, ...builderArgs], { stdio: "inherit", env: process.env });
    status = child.status ?? 1;
  } finally {
    try { oauth.restore(); }
    catch (e) {
      console.error("The Google sign-in secret could not be cleared from server/oauth-clients.json. Do not commit that file.");
      status = 1;
    }
    try { prepared.restore(); }
    catch (e) {
      console.error("The publishable key could not be cleared from server/cloud-defaults.json. Do not commit that file.");
      console.error(e.message);
      status = 1;
    }
  }
  return status;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = process.argv.slice(2);
  let code = 0;
  if (args[0] === "--check") code = runCheck();
  else {
    const rest = args[0] === "--" ? args.slice(1) : args;
    if (rest[0] === "electron-builder") rest.shift();
    code = runBuild(rest);
  }
  process.exit(code);
}
