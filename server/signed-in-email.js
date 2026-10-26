// The verified email from the one-click Google or Microsoft sign-in (server/oauth-signin.js).
//
// The sign-in token reply comes straight from the provider over TLS, so its id_token is read
// without a second signature check, as OpenID Connect allows for a direct reply. Google must say
// email_verified. Microsoft has no such flag on every account, so its email counts only for a
// personal Microsoft account or when the work tenant says it owns the domain (xms_edov).
// Only the address is kept (never the token), and it is never logged. It is used for two things:
// to unlock a paid licence by email (server/license.js), and to prefill the Stripe pay link.
import { HOSTED, ctx, doc, putDoc } from "./store.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Tenant id Microsoft uses for every personal (consumer) account.
const MS_PERSONAL_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const DOC = "signin-identity";

function claimsOf(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
}
const isTrue = (v) => v === true || v === "true";

// Pure. Returns the lower-case verified email or null.
export function emailFromIdToken(idToken, provider) {
  const c = claimsOf(idToken);
  if (!c || typeof c !== "object") return null;
  let email = "";
  if (provider === "google") {
    if (!isTrue(c.email_verified)) return null;
    email = String(c.email || "");
  } else if (provider === "microsoft") {
    email = String(c.email || c.preferred_username || "");
    const verified = isTrue(c.email_verified) || isTrue(c.xms_edov) || c.tid === MS_PERSONAL_TENANT;
    if (!verified) return null;
  } else return null;
  email = email.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function rememberIdentity(provider, idToken) {
  const email = emailFromIdToken(idToken, provider);
  if (!email) return null;
  const d = doc(DOC, () => ({ email: null, provider: null, at: 0 }));
  putDoc(DOC, { ...d, email, provider, at: Date.now() });
  return email;
}

export function forgetIdentity(provider) {
  const d = doc(DOC, () => ({ email: null, provider: null, at: 0 }));
  if (provider && d.provider && d.provider !== provider) return;
  putDoc(DOC, { email: null, provider: null, at: 0 });
}

// Hosted: the hub account email. Desktop: the last verified one-click sign-in.
export function signedInEmail() {
  try {
    if (HOSTED) return ctx().email || null;
    const e = doc(DOC, () => ({ email: null }))?.email;
    return e && EMAIL_RE.test(e) ? e : null;
  } catch { return null; }
}
