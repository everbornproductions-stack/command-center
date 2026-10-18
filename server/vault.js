// Key vault.
// Local mode: the whole secrets blob is sealed with Windows DPAPI (CurrentUser scope) through
// PowerShell's System.Security.Cryptography.ProtectedData, so the file on disk is unreadable from
// any other Windows account or machine. Nothing is ever passed on a command line; the plaintext
// travels through an environment variable into PowerShell.
// Hosted mode: each user's keys are AES-256-GCM encrypted with the server's master key and stored
// per user in Supabase (user_secrets); see hosted.js. Either way the decrypted keys live only in
// the user's in-memory context and are never returned to the browser (masked only).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import { HOSTED, ctx } from "./store.js";

const VAULT_FILE = path.join(DATA_DIR, "vault.bin");
const IS_WIN = process.platform === "win32";

function ps(script, env) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, ...env }, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()))
    );
  });
}

async function protect(plain) {
  if (!IS_WIN) return Buffer.from(plain, "utf8").toString("base64");
  return ps(
    "Add-Type -AssemblyName System.Security; " +
      "$b=[Text.Encoding]::UTF8.GetBytes($env:CC_VAULT_IN); " +
      "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))",
    { CC_VAULT_IN: plain }
  );
}

async function unprotect(b64) {
  if (!IS_WIN) return Buffer.from(b64, "base64").toString("utf8");
  return ps(
    "Add-Type -AssemblyName System.Security; " +
      "$b=[Convert]::FromBase64String($env:CC_VAULT_IN); " +
      "[Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))",
    { CC_VAULT_IN: b64 }
  );
}

// Local mode only: open vault.bin into the local context. Hosted contexts are filled by the store.
export async function loadVault() {
  const c = ctx();
  if (HOSTED || c.vaultLoaded) return c.secrets;
  c.vaultLoaded = true;
  if (fs.existsSync(VAULT_FILE)) {
    try {
      const b64 = fs.readFileSync(VAULT_FILE, "utf8").trim();
      if (b64) c.secrets = JSON.parse(await unprotect(b64));
    } catch (e) {
      console.error("[vault] could not open vault:", e.message);
    }
  }
  // Environment variables are honoured as a convenience (local mode) and never written back.
  return c.secrets;
}

async function saveLocal(secrets) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sealed = await protect(JSON.stringify(secrets));
  fs.writeFileSync(VAULT_FILE, sealed, { mode: 0o600 });
}

export async function setSecret(providerId, value) {
  const c = ctx();
  await loadVault();
  const v = value && typeof value === "object" ? value : value ? { key: String(value).trim() } : null;
  if (v) c.secrets[providerId] = v; else delete c.secrets[providerId];
  if (HOSTED) await c.store.putSecret(providerId, v);
  else await saveLocal(c.secrets);
}

export function getSecret(providerId, envName) {
  const s = ctx().secrets?.[providerId];
  if (s?.key) return s;
  // env fallback is a single-user convenience; in a hosted hub it would leak one key to every user
  if (!HOSTED && envName && process.env[envName]) return { key: process.env[envName], fromEnv: true };
  return null;
}

export function hasSecret(providerId, envName) {
  return !!getSecret(providerId, envName);
}

export function maskedKey(providerId, envName) {
  const s = getSecret(providerId, envName);
  if (!s) return null;
  const k = s.key;
  return k.length <= 8 ? "••••" : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export const vaultInfo = () => HOSTED
  ? { file: null, method: "AES-256-GCM, encrypted at rest in Supabase (user_secrets), decrypted only inside the hub" }
  : { file: VAULT_FILE, method: IS_WIN ? "Windows DPAPI (CurrentUser)" : "base64 file (no OS keychain on this platform)" };
