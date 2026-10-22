// Windows code signing with Microsoft Azure Artifact Signing (formerly Trusted Signing).
// The release job signs only when every value below is set. Until then it builds unsigned,
// exactly as before, and says so in one plain line. Values are never printed to the log.
//
//   node scripts/azure-sign-config.mjs --check   prints one line, writes signing=on|off to GITHUB_OUTPUT
//   node scripts/azure-sign-config.mjs --args    prints the electron-builder flags, one per line (for a bash array)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Repository variables (not secret): where and with what profile to sign.
export const SIGNING_VARS = {
  AZURE_SIGNING_ENDPOINT: "endpoint",
  AZURE_SIGNING_ACCOUNT: "codeSigningAccountName",
  AZURE_SIGNING_PROFILE: "certificateProfileName",
  AZURE_SIGNING_PUBLISHER: "publisherName",
};
// Repository secrets: the app registration that may sign. electron-builder reads these
// from the environment (Azure EnvironmentCredential). They are never passed as flags.
export const SIGNING_SECRETS = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"];

export const NOT_SET_UP = "Code signing is not set up yet, building unsigned.";
export const SET_UP = "Code signing is set up. The installer will be signed with Azure Artifact Signing.";

export function signingFromEnv(env = process.env) {
  const value = (name) => String(env[name] || "").trim();
  const names = [...Object.keys(SIGNING_VARS), ...SIGNING_SECRETS];
  const missing = names.filter((n) => !value(n));
  const options = {};
  for (const [name, key] of Object.entries(SIGNING_VARS)) options[key] = value(name);
  return { on: missing.length === 0, missing, options: missing.length ? null : options };
}

// Flags for electron-builder. Empty when signing is off, so the build is the same as today.
export function builderArgs(env = process.env) {
  const s = signingFromEnv(env);
  if (!s.on) return [];
  return Object.entries(s.options).map(([key, v]) => `-c.win.azureSignOptions.${key}=${v}`);
}

function writeOutput(env, on) {
  const file = env.GITHUB_OUTPUT;
  if (file) fs.appendFileSync(file, `signing=${on ? "on" : "off"}\n`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const mode = process.argv[2] || "--check";
  const s = signingFromEnv();
  if (mode === "--args") {
    for (const a of builderArgs()) process.stdout.write(`${a}\n`);
  } else {
    console.log(s.on ? SET_UP : NOT_SET_UP);
    writeOutput(process.env, s.on);
  }
}
