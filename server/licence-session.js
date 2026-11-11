// Proof of the signed-in email for the licence server (0.4.19).
//
// The licence server used to answer "which plan is on this email?" to anyone who typed an email.
// Now activate_license_by_email only answers a signed Supabase session whose email is confirmed
// (supabase/migrations/20261026_stripe_unlock_proof.sql). This file gets that session:
//   - at one-click sign-in the provider's id_token is exchanged at the licence server's Auth
//     endpoint (grant_type=id_token) for a short-lived access token and a refresh token;
//   - the tokens live in the vault (never in a plain file, never logged, never returned to the page);
//   - sessionToken() hands out a fresh access token, refreshing it when it is about to expire.
// No session, or a refused exchange, means "no proof": the caller does not ask by email at all.
// The id_token is used once and not kept.
import { getOwnSecret, setSecret } from "./vault.js";

export const SESSION_VAULT_ID = "licence-session";
const PROVIDER_NAME = { google: "google", microsoft: "azure" };
const SKEW_MS = 60 * 1000;

const trim = (v) => String(v ?? "").trim();
const base = (cloud) => trim(cloud?.url).replace(/\/$/, "");

async function authPost(cloud, query, body, fetchImpl) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const headers = { apikey: cloud.anonKey, "content-type": "application/json" };
    const r = await fetchImpl(`${base(cloud)}/auth/v1/token?${query}`, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) return null;
    return j;
  } catch { return null; } finally { clearTimeout(t); }
}

const toSession = (j, now) => ({
  key: "session",
  access: j.access_token,
  refresh: j.refresh_token || null,
  expiresAt: Number(j.expires_in) > 0 ? now + Number(j.expires_in) * 1000 : now + 3600 * 1000,
});

// Exchange the provider's id_token for a licence-server session. Returns true when a session was saved.
export async function exchangeIdToken({ cloud, provider, idToken, fetchImpl = fetch, save = setSecret, now = Date.now() } = {}) {
  const name = PROVIDER_NAME[provider];
  if (!name || !trim(idToken) || !base(cloud) || !trim(cloud?.anonKey)) return false;
  const j = await authPost(cloud, "grant_type=id_token", { provider: name, id_token: idToken }, fetchImpl);
  if (!j) return false;
  await save(SESSION_VAULT_ID, toSession(j, now));
  return true;
}

// A usable access token, or null when this copy has no session (the person signs in again).
export async function sessionToken({ cloud, fetchImpl = fetch, read = getOwnSecret, save = setSecret, now = Date.now() } = {}) {
  const s = read(SESSION_VAULT_ID);
  if (!s?.access) return null;
  if (Number(s.expiresAt) - SKEW_MS > now) return s.access;
  if (!s.refresh || !base(cloud) || !trim(cloud?.anonKey)) return null;
  const j = await authPost(cloud, "grant_type=refresh_token", { refresh_token: s.refresh }, fetchImpl);
  if (!j) { await save(SESSION_VAULT_ID, null).catch(() => {}); return null; }
  const next = toSession(j, now);
  await save(SESSION_VAULT_ID, next);
  return next.access;
}

export const clearSession = (save = setSecret) => save(SESSION_VAULT_ID, null).catch(() => {});
