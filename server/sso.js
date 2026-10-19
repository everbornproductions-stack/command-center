// Team SSO for the hosted hub (Phase 24): "Continue with Google" and "Continue with Microsoft" on the sign-in
// page, plus a per-workspace rule "members sign in with Google or Microsoft, with an address on these domains".
//
// Sign-in: the OpenID Connect flow runs through Supabase Auth (its Google and Azure providers), the same Auth
// that already sends the magic links, so the hub keeps one kind of session and one way to check it
// (hosted.verifyToken). The hub owner turns the buttons on with CC_SSO_PROVIDERS=google,azure after enabling
// those providers in the Supabase dashboard (client id and secret live there, never in this app).
// GET /api/sso/start?provider=google&redirect=<hub address> sends the browser to Supabase's authorize step; the
// redirect may only be this hub (no open redirect). Supabase sends the browser back with the session in the
// URL hash, which the page already reads.
//
// Workspace rule (table workspace_sso, supabase/team-sso.sql): owners and admins set it; while it is on, a
// member or viewer whose current session did not come from an allowed provider with an allowed address
// cannot switch to the workspace, sees it locked (no shared projects or members) and does not get its API
// keys. The owner is never locked out of their own workspace.
import { HOSTED, ctx } from "./store.js";
import { CFG, rest } from "./hosted.js";

export const SSO_PROVIDERS = { google: "Google", azure: "Microsoft" };
const SCOPES = { google: "openid email profile", azure: "openid email profile" };

// providers the hub owner turned on (hosted only)
export function enabledProviders() {
  if (!HOSTED) return [];
  return String(process.env.CC_SSO_PROVIDERS || "").toLowerCase().split(/[,\s]+/).filter((p) => SSO_PROVIDERS[p]).filter((p, i, a) => a.indexOf(p) === i).map((id) => ({ id, name: SSO_PROVIDERS[id] }));
}

// Only this hub may be the place Supabase sends the browser back to.
function allowedOrigins(req) {
  const out = new Set();
  if (CFG.hubUrl) { try { out.add(new URL(CFG.hubUrl).origin); } catch {} }
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  if (/^[a-z0-9.-]+(:\d+)?$/.test(host)) {
    out.add(`https://${host}`);
    if (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) out.add(`http://${host}`);
  }
  return out;
}

export function startUrl(req, url) {
  const provider = String(url.searchParams.get("provider") || "").toLowerCase();
  if (!enabledProviders().some((p) => p.id === provider)) throw Object.assign(new Error("That sign-in option is not turned on for this hub."), { status: 400 });
  let back;
  try { back = new URL(String(url.searchParams.get("redirect") || "")); } catch { throw Object.assign(new Error("redirect must be this hub's address"), { status: 400 }); }
  if (!allowedOrigins(req).has(back.origin) || back.username || back.password) throw Object.assign(new Error("redirect must be this hub's address"), { status: 400 });
  back.hash = "";
  const q = new URLSearchParams({ provider, redirect_to: back.toString(), scopes: SCOPES[provider] });
  return `${CFG.url}/auth/v1/authorize?${q}`;
}

export function handleStart(req, res, url, send) {
  if (!HOSTED) return send(res, 400, { error: "Google and Microsoft sign-in is for the hosted hub. The desktop app needs no sign-in." });
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  try {
    const to = startUrl(req, url);
    res.writeHead(302, { location: to, "cache-control": "no-store" });
    return res.end();
  } catch (e) { return send(res, e.status || 400, { error: e.message }); }
}

// ---------- the current session (set per request by auth.js from hosted.verifyToken) ----------
const domainOf = (email) => String(email || "").toLowerCase().split("@")[1] || "";
export function sessionInfo(c = ctx()) {
  const a = c.auth || {};
  return { email: c.email || null, method: a.method || null, providers: a.identities || [], sso: a.method === "oauth" };
}

// ---------- workspace rule ----------
export function cleanPolicy(body) {
  const required = !!body.required;
  const providers = [...new Set((Array.isArray(body.providers) ? body.providers : []).map((p) => String(p).toLowerCase()).filter((p) => SSO_PROVIDERS[p]))];
  const domains = [...new Set((Array.isArray(body.domains) ? body.domains : String(body.domains || "").split(/[,\s]+/)).map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  for (const d of domains) if (!/^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(d)) throw Object.assign(new Error(`"${d}" is not a domain such as example.com`), { status: 400 });
  if (required && !providers.length) throw Object.assign(new Error("Pick Google, Microsoft or both."), { status: 400 });
  if (domains.length > 20) throw Object.assign(new Error("At most 20 domains."), { status: 400 });
  return { required, providers, domains };
}

const q = (pathq, opts = {}) => rest(pathq, { ...opts, token: ctx().token });
// read with the person's own token (RLS: members only), cached 30 s per person and workspace
const cache = new Map(); // `${userId}:${wsId}` -> { at, policy }
export async function policyFor(wsId) {
  if (!HOSTED || !wsId) return null;
  const key = `${ctx().userId}:${wsId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30000) return hit.policy;
  let rows;
  // a failed read is not cached, and a rule that cannot be read counts as on for safety (see meets)
  // (404: supabase/team-sso.sql has not been run on this hub yet, so there are no rules)
  try { rows = await q(`workspace_sso?select=workspace_id,required,providers,domains,updated_at&workspace_id=eq.${encodeURIComponent(wsId)}`); }
  catch (e) { if (e.status === 404) rows = []; else return { unknown: true, required: true, providers: [], domains: [] }; }
  const r = rows?.[0];
  const policy = r ? { required: !!r.required, providers: r.providers || [], domains: r.domains || [], updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null } : null;
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), policy });
  return policy;
}
export const forgetPolicy = (wsId) => { for (const k of [...cache.keys()]) if (k.endsWith(`:${wsId}`)) cache.delete(k); };
export async function savePolicy(wsId, policy) {
  await q("workspace_sso", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { workspace_id: wsId, required: policy.required, providers: policy.providers, domains: policy.domains, updated_by: ctx().userId, updated_at: new Date().toISOString() } });
  forgetPolicy(wsId);
}

// Does this session meet the workspace's rule? role is the person's role there ("owner" is never locked out).
export function meets(policy, role, c = ctx()) {
  if (!policy?.required || role === "owner") return { ok: true };
  if (policy.unknown) return { ok: false, code: "sso", reason: "This workspace's sign-in rule could not be read right now. Try again in a moment.", policy: null };
  const s = sessionInfo(c);
  const names = policy.providers.map((p) => SSO_PROVIDERS[p]).join(" or ");
  const where = policy.domains.length ? ` with an address at ${policy.domains.map((d) => "@" + d).join(", ")}` : "";
  const fail = { ok: false, code: "sso", reason: `This workspace asks members to sign in with ${names}${where}. Sign out and use "Continue with ${SSO_PROVIDERS[policy.providers[0]]}".`, policy };
  if (!s.sso) return fail;
  const good = s.providers.some((i) => policy.providers.includes(i.provider) && (!policy.domains.length || policy.domains.includes(domainOf(i.email))));
  return good ? { ok: true } : fail;
}
export async function check(wsId, role) { return meets(await policyFor(wsId), role); }
