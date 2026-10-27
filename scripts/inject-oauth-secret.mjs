// Release builds write the Google desktop client secret into server/oauth-clients.json for
// one-click Sign in with Google, then put the file bytes back so it is never committed.
// The value comes from the GOOGLE_OAUTH_CLIENT_SECRET build secret (CC_GOOGLE_CLIENT_SECRET
// also works). It is never printed. A build with no secret still builds: Sign in with Google
// then offers the Advanced own-client path, and Sign in with Microsoft (no secret) still works.
// scripts/inject-cloud-key.mjs calls this around electron-builder, the same way it writes the
// Supabase publishable key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLIENTS_FILE = path.join(ROOT, "server", "oauth-clients.json");

export const MISSING_SECRET = "Google sign-in secret: not set (GOOGLE_OAUTH_CLIENT_SECRET). This build offers the Advanced own-client path for Google. Microsoft sign-in still works.";
export const BAD_SECRET = "Google sign-in secret: not set, because GOOGLE_OAUTH_CLIENT_SECRET does not look like a client secret, so it was not written. This build offers the Advanced own-client path for Google.";

export function googleSecretFromEnv(env = process.env) {
  return String(env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim() || String(env.CC_GOOGLE_CLIENT_SECRET || "").trim();
}

export function secretShape(value) {
  const v = String(value || "").trim();
  if (!v) return "missing";
  if (v.length < 8 || v.length > 400 || /\s/.test(v)) return "shape";
  return "ok";
}

// Writes google.clientSecret for a build. Returns { restore } which puts the file bytes back.
// A missing or odd secret writes nothing and does not throw.
export function prepareOAuthSecret({ file = CLIENTS_FILE, env = process.env } = {}) {
  const original = fs.readFileSync(file, "utf8");
  const value = googleSecretFromEnv(env);
  const shape = secretShape(value);
  if (shape !== "ok") return { ok: true, wrote: false, warned: true, message: shape === "missing" ? MISSING_SECRET : BAD_SECRET, restore() {} };
  const doc = JSON.parse(original);
  doc.google = { ...(doc.google || {}), clientSecret: value };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  let restored = false;
  return {
    ok: true,
    wrote: true,
    warned: false,
    message: "Google sign-in secret: set (written for this build, cleared again when the build finishes, never committed).",
    restore() {
      if (restored) return;
      restored = true;
      fs.writeFileSync(file, original);
    },
  };
}

// `node scripts/inject-oauth-secret.mjs --check` prints "Google sign-in secret: set" or "not set".
// The value is never printed. Always exits 0 so a build without the secret still builds.
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked && process.argv.includes("--check")) {
  console.log(secretShape(googleSecretFromEnv()) === "ok" ? "Google sign-in secret: set" : "Google sign-in secret: not set");
}
