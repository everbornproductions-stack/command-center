// Team SSO on the hosted hub (Phase 24); the flow and the rule are in server/sso.js.
//   GET    /api/sso                     the sign-in options this hub offers and how this session signed in
//   GET    /api/sso/policy/<workspace>  the workspace's rule (anyone in it)
//   POST   /api/sso/policy/<workspace>  { required, providers: ["google","azure"], domains: ["example.com"] }  owner or admin, Studio
// GET /api/sso/start is public and handled in server/index.js (it runs before sign-in).
import { HOSTED } from "../store.js";
import { licenseState } from "../license.js";
import { roleIn } from "../custom-agents.js";
import * as SSO from "../sso.js";

export const id = "sso";
const STUDIO = new Set(["studio", "owner"]);
const err = (status, message, code) => Object.assign(new Error(message), { status, code });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/sso/, "").replace(/\/$/, "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent), m = req.method;
  if (m === "GET" && !seg.length) return h.json(res, 200, { hosted: HOSTED, providers: SSO.enabledProviders(), session: HOSTED ? SSO.sessionInfo() : null, note: HOSTED ? null : "Google and Microsoft sign-in is for the hosted hub. The desktop app needs no sign-in." });
  if (seg[0] !== "policy" || !seg[1]) return false;
  if (!HOSTED) return h.json(res, 400, { error: "Workspace sign-in rules apply on the hosted hub, where teammates sign in." });
  const wsId = seg[1].slice(0, 80);
  const role = await roleIn(wsId);
  if (!role) throw err(404, "You are not in this workspace.", "role");
  if (m === "GET") {
    const policy = await SSO.policyFor(wsId);
    return h.json(res, 200, { workspace: wsId, role, canManage: ["owner", "admin"].includes(role), policy: policy || { required: false, providers: [], domains: [] }, meets: SSO.meets(policy, role).ok, providers: SSO.enabledProviders() });
  }
  if (m === "POST") {
    if (!STUDIO.has(licenseState().tier)) throw err(402, "Workspace sign-in rules are part of Studio, with teams and shared workspaces.", "studio");
    if (!["owner", "admin"].includes(role)) throw err(403, `Your role (${role}) cannot change the sign-in rule: owners and admins can.`, "role");
    const policy = SSO.cleanPolicy(body);
    const off = policy.providers.filter((x) => !SSO.enabledProviders().some((e) => e.id === x));
    if (policy.required && off.length) return h.json(res, 400, { error: `${off.map((x) => SSO.SSO_PROVIDERS[x]).join(" and ")} sign-in is not turned on for this hub yet (CC_SSO_PROVIDERS).` });
    await SSO.savePolicy(wsId, policy);
    h.emit("log", { text: policy.required ? `Workspace sign-in rule on: ${policy.providers.map((x) => SSO.SSO_PROVIDERS[x]).join(" or ")}${policy.domains.length ? `, ${policy.domains.map((d) => "@" + d).join(", ")}` : ""}.` : "Workspace sign-in rule off." });
    return h.json(res, 200, { ok: true, workspace: wsId, policy });
  }
  return false;
}
