// 0.4.21: what can work across two computers with no paid hosting. Report-back and Teams go through
// the Supabase project the app already uses (the publishable key, narrow RPC functions, see
// supabase/hub_reportback_teams.sql). The functions only run once Chris runs that SQL; until then
// every call comes back "not set up" and the app says so in plain words and keeps its local path.
// The client is injectable (fetch and config), so tests use a stand-in server or a fake fetch.
// Hosted runs and phone use with the PC off still need a paid server and say so.
import crypto from "node:crypto";
import { cloud } from "./license.js";
import { doc, putDoc } from "./store.js";

export const HUB_SOON = "Needs the Meldmind hub (coming soon)";
export const NOT_SET_UP = "Not switched on yet. Everborn has to run one setup step in its cloud project first.";
const DEVICE_DOC = "hub.device";
const RETRY_MS = 10 * 60 * 1000;

export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// One random secret per install, kept only in this app's data folder. The cloud keeps its hash.
export function deviceSecret() {
  const row = doc(DEVICE_DOC, () => null);
  if (row && typeof row.token === "string" && row.token.length >= 24) return row.token;
  const token = crypto.randomBytes(24).toString("base64url");
  putDoc(DEVICE_DOC, { token, createdAt: Date.now() });
  return token;
}

let override = null;
// Tests give a fake { rpc(name, body) } or { fetchImpl, cfg }. Pass null to go back to the real thing.
export function setHubClient(c) { override = c; missingUntil.clear(); }

const missingUntil = new Map(); // function name -> time to try again (the SQL has not been run)

export function hubConfig() {
  if (override?.cfg) return override.cfg;
  const c = cloud();
  return c?.url && c?.anonKey ? { url: c.url, anonKey: c.anonKey } : null;
}
export const hubReady = () => !!(override?.rpc || hubConfig());

// Returns { ok, body } on success, { offline: true } when unreachable, { missing: true } when the
// SQL function is not there yet, { error } when the function refused (body has a plain message).
export async function rpc(name, args = {}) {
  if (override?.rpc) return override.rpc(name, args);
  const cfg = hubConfig();
  if (!cfg) return { off: true };
  if ((missingUntil.get(name) || 0) > Date.now()) return { missing: true };
  const headers = { apikey: cfg.anonKey, accept: "application/json", "content-type": "application/json" };
  if (String(cfg.anonKey).startsWith("eyJ")) headers.authorization = `Bearer ${cfg.anonKey}`;
  const f = override?.fetchImpl || globalThis.fetch;
  try {
    const r = await f(`${String(cfg.url).replace(/\/$/, "")}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    if (r.status === 404 || j?.code === "PGRST202" || /could not find the function/i.test(String(j?.message || ""))) {
      missingUntil.set(name, Date.now() + RETRY_MS);
      return { missing: true };
    }
    if (!r.ok) return { error: String(j?.message || `HTTP ${r.status}`).slice(0, 200) };
    return { ok: true, body: j };
  } catch { return { offline: true }; }
}

// For the Settings page and the Owner checklist: what works, what needs one setup step, what is coming.
export function hubFeatures({ sqlSeen = {} } = {}) {
  const ready = hubReady();
  const row = (id, name, what) => ({
    id, name,
    state: !ready ? "needs_setup" : sqlSeen[id] === false ? "needs_setup" : "ready",
    message: !ready
      ? "Add the Meldmind cloud address in Settings first."
      : sqlSeen[id] === false ? NOT_SET_UP : what,
  });
  return [
    row("reportback", "Report-back from other AIs", "Another AI can tell this Meldmind when it is done, even on a different computer."),
    row("teams", "Teams across computers", "Invite codes work on a second computer."),
    { id: "hosted-runs", name: "Runs while your PC is off", state: "soon", message: HUB_SOON },
    { id: "phone-off", name: "Phone use when your PC is off", state: "soon", message: HUB_SOON },
  ];
}
