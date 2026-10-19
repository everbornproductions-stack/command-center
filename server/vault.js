// Key vault.
// Local mode, Windows: the whole secrets blob is sealed with Windows DPAPI (CurrentUser scope) through
// PowerShell's System.Security.Cryptography.ProtectedData, so the file on disk is unreadable from
// any other Windows account or machine. Nothing is ever passed on a command line; the plaintext
// travels through an environment variable into PowerShell.
// Local mode, macOS / Linux: encryption comes from Electron's safeStorage (Keychain on macOS,
// libsecret / kwallet on Linux). The Electron main process exposes it to this server (which runs in
// the same process) as globalThis.__ccSafeStorage; see electron/main.cjs. Plain Node on those
// platforms has no OS-backed encryption, so saving keys is refused with a clear error. There is no
// base64 fallback, ever.
// Hosted mode: each user's keys are AES-256-GCM encrypted with the server's master key and stored
// per user in Supabase (user_secrets); see hosted.js. Either way the decrypted keys live only in
// the user's in-memory context and are never returned to the browser (masked only).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";
import { HOSTED, ctx } from "./store.js";
import { PROVIDERS } from "./registry.js";

const VAULT_FILE = path.join(DATA_DIR, "vault.bin");
const IS_WIN = process.platform === "win32";
const SS_PREFIX = "ss1:"; // marks a blob sealed by Electron safeStorage (base64 after the prefix)
export const NEEDS_APP = "Saving keys needs the desktop app on this platform (plain Node has no OS-backed encryption on macOS/Linux).";

// { available(): boolean, backend: string, encrypt(str) -> base64, decrypt(base64) -> str }, set by Electron.
const safeStorage = () => globalThis.__ccSafeStorage || null;

// Which sealing method this process can use right now.
export function vaultMethod() {
  if (HOSTED) return { method: "aes-gcm", label: "AES-256-GCM, encrypted at rest in Supabase (user_secrets), decrypted only inside the hub", canSave: true };
  if (IS_WIN) return { method: "dpapi", label: "Windows DPAPI (CurrentUser)", canSave: true };
  const ss = safeStorage();
  let ok = false; try { ok = !!ss?.available(); } catch {}
  if (ok) return { method: "safeStorage", label: `OS keychain via the desktop app (${ss.backend || "Electron safeStorage"})`, canSave: true };
  return { method: "none", label: `unavailable: ${NEEDS_APP}`, canSave: false };
}

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
  const m = vaultMethod();
  if (m.method === "dpapi") {
    return ps(
      "Add-Type -AssemblyName System.Security; " +
        "$b=[Text.Encoding]::UTF8.GetBytes($env:CC_VAULT_IN); " +
        "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))",
      { CC_VAULT_IN: plain }
    );
  }
  if (m.method === "safeStorage") return SS_PREFIX + safeStorage().encrypt(plain);
  throw Object.assign(new Error(NEEDS_APP), { status: 400, code: "vault_unavailable" });
}

async function unprotect(sealed) {
  if (sealed.startsWith(SS_PREFIX)) {
    const ss = safeStorage();
    if (!ss?.available()) throw new Error(`The vault was sealed by the desktop app's OS keychain. ${NEEDS_APP}`);
    return ss.decrypt(sealed.slice(SS_PREFIX.length));
  }
  if (IS_WIN) {
    return ps(
      "Add-Type -AssemblyName System.Security; " +
        "$b=[Convert]::FromBase64String($env:CC_VAULT_IN); " +
        "[Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))",
      { CC_VAULT_IN: sealed }
    );
  }
  // An old vault written without OS encryption (pre-2026-10-18 base64) is not read back: never trust or keep plain keys.
  throw new Error(`vault.bin was written by an older version without OS encryption and is ignored. Delete ${VAULT_FILE} and add the keys again in the desktop app.`);
}

// Local mode only: open vault.bin into the local context. Hosted contexts are filled by the store.
export async function loadVault() {
  const c = ctx();
  if (HOSTED || c.vaultLoaded) return c.secrets;
  c.vaultLoaded = true;
  if (fs.existsSync(VAULT_FILE)) {
    try {
      const sealed = fs.readFileSync(VAULT_FILE, "utf8").trim();
      if (sealed) c.secrets = JSON.parse(await unprotect(sealed));
    } catch (e) {
      console.error("[vault] could not open vault:", e.message);
    }
  }
  // Environment variables are honoured as a convenience (local mode) and never written back.
  return c.secrets;
}

async function saveLocal(secrets) {
  const sealed = await protect(JSON.stringify(secrets)); // throws before anything is written when no OS encryption is available
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(VAULT_FILE, sealed, { mode: 0o600 });
}

export async function setSecret(providerId, value) {
  const c = ctx();
  await loadVault();
  // pasted keys often carry a stray space or line break: trim every key-like field on save
  const v = value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, x]) => [k, typeof x === "string" && /^(key|secret|workspaceId)$/.test(k) ? x.trim() : x])) : value ? { key: String(value).trim() } : null;
  // Demo-mode pretend keys never need to persist; everything else must be sealed or refused.
  const memoryOnly = !HOSTED && !!PROVIDERS[providerId]?.demo && !vaultMethod().canSave;
  if (!HOSTED && v && !memoryOnly && !vaultMethod().canSave) throw Object.assign(new Error(NEEDS_APP), { status: 400, code: "vault_unavailable" });
  if (v) c.secrets[providerId] = v; else delete c.secrets[providerId];
  if (HOSTED) await c.store.putSecret(providerId, v);
  else if (!memoryOnly) await saveLocal(c.secrets);
}

// Per-workspace keys (Phase 24, server/workspace-keys.js): while a workspace is active, its key for a
// provider is used first, and only then. Set once at startup.
let scoped = null;
export const setScopedResolver = (fn) => { scoped = typeof fn === "function" ? fn : null; };

export function getSecret(providerId, envName) {
  if (scoped) { const w = scoped(ctx(), providerId); if (w?.key) return w; }
  return getOwnSecret(providerId, envName);
}
// your own key only (Settings > keys edits this one, never a workspace's)
export function getOwnSecret(providerId, envName) {
  const s = ctx().secrets?.[providerId];
  if (s?.key) return typeof s.key === "string" && s.key !== s.key.trim() ? { ...s, key: s.key.trim() } : s; // trim on read too (keys saved before v0.3.2)
  // env fallback is a single-user convenience; in a hosted hub it would leak one key to every user
  if (!HOSTED && envName && process.env[envName]?.trim()) return { key: process.env[envName].trim(), fromEnv: true };
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

export const vaultInfo = () => {
  const m = vaultMethod();
  return { file: HOSTED ? null : VAULT_FILE, method: m.label, kind: m.method, canSave: m.canSave };
};
