// Per-workspace API keys (Phase 24). An owner or admin saves a provider key for one workspace; it is used
// only for calls made while that workspace is the active one (the header switcher), and never for
// "Personal" or any other workspace. Without a workspace key for a provider, your own key is used as before.
//
// Local mode (desktop): kept in this PC's vault (Windows DPAPI / OS keychain) next to your own keys, under
// "ws:<workspace id>:<provider>", and dropped with the workspace.
// Hosted hub: one row per workspace and provider in workspace_secrets (supabase/workspace-keys.sql), sealed
// with AES-256-GCM under the hub's master key, bound to "ws:<workspace id>:<provider>" so a row moved to
// another workspace does not open. Owners and admins write; owners, admins and members can use (RLS); viewers
// cannot. A workspace that asks for Google or Microsoft sign-in (server/sso.js) only hands its keys to a
// session that meets that rule. Keys are decrypted inside the hub only and never sent to a browser.
import { HOSTED, ctx, doc, runAs } from "./store.js";
import { rest, encrypt, decrypt } from "./hosted.js";
import { setSecret, setScopedResolver } from "./vault.js";
import { PROVIDERS } from "./registry.js";
import { roleIn } from "./custom-agents.js";
import { policyFor, meets } from "./sso.js";

const PREFIX = "ws:";
export const USERS = ["owner", "admin", "member"]; // who may use a workspace's keys
export const MANAGERS = ["owner", "admin"];       // who may add or remove them
const slot = (wsId, provider) => `${PREFIX}${wsId}:${provider}`;
const mask = (k) => (String(k).length <= 8 ? "••••" : `${String(k).slice(0, 4)}…${String(k).slice(-4)}`);
const q = (pathq, opts = {}) => rest(pathq, { ...opts, token: ctx().token });
export const activeWorkspace = (c = ctx()) => c.docs?.["workspaces.active"]?.id || null;
const localWorkspaceIds = () => (doc("workspaces", () => ({ list: [] })).list || []).map((w) => w.id);

// which providers can take a workspace key: the ones that use a key at all
export const keyable = (provider) => { const p = PROVIDERS[provider]; return !!p && !p.demo && !p.noKey && (p.kind === "text" || !!p.keyEnv); };

// ---------- the resolver vault.getSecret() asks first ----------
// Synchronous: local reads the vault; hosted reads what loadForActive() put in the context.
function resolve(c, provider) {
  const wsId = activeWorkspace(c);
  if (!wsId) return null;
  if (!HOSTED) {
    const s = c.secrets?.[slot(wsId, provider)];
    if (!s?.key) return null;
    const exists = (c.docs?.workspaces?.list || []).some((w) => w.id === wsId);
    return exists ? { ...s, scope: "workspace", workspaceId: wsId } : null;
  }
  const k = c.wsKeys;
  // refreshed in the background once a minute, so a removed member, a new rule or a changed key catches up
  if (k && Date.now() - k.at > 60000 && !k.reloading) { k.reloading = true; runAs(c, () => loadForActive(c)).catch(() => { k.reloading = false; }); }
  if (!k || k.wsId !== wsId || !k.usable) return null;
  // the same person may have a second session that did not use Google / Microsoft: check the rule per call
  if (!meets(k.policy, k.role, c).ok) return null;
  const s = k.secrets[provider];
  return s?.key ? { ...s, scope: "workspace", workspaceId: wsId } : null;
}
setScopedResolver(resolve);

// ---------- hosted: load the active workspace's keys into the context ----------
export async function loadForActive(c = ctx()) {
  if (!HOSTED) return null;
  const wsId = activeWorkspace(c);
  if (!wsId) { c.wsKeys = null; return null; }
  const out = { wsId, usable: false, role: null, policy: null, secrets: {}, masked: {}, reason: null, at: Date.now() };
  out.role = await roleIn(wsId);
  if (!USERS.includes(out.role)) { out.reason = out.role ? "A viewer uses their own keys." : "You are not in this workspace."; c.wsKeys = out; return out; }
  out.policy = await policyFor(wsId);
  const sso = meets(out.policy, out.role, c);
  if (!sso.ok) { out.reason = sso.reason; c.wsKeys = out; return out; }
  let rows = [];
  try { rows = await q(`workspace_secrets?select=provider,ciphertext,masked,added_by_email,updated_at&workspace_id=eq.${encodeURIComponent(wsId)}`) || []; }
  catch (e) { out.reason = e.status === 404 ? null : `Could not read the workspace keys: ${e.message}`; }
  for (const r of rows) {
    try { out.secrets[r.provider] = JSON.parse(decrypt(r.ciphertext, slot(wsId, r.provider))); out.masked[r.provider] = { masked: r.masked || null, addedBy: r.added_by_email || null, updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null }; }
    catch { console.error(`[workspace-keys] could not open the ${r.provider} key of ${wsId} (moved row or master key changed?)`); }
  }
  out.usable = true;
  c.wsKeys = out;
  return out;
}

// ---------- list / save / remove (the routes check the role and the tier first) ----------
export async function list(wsId) {
  if (!HOSTED) {
    const c = ctx();
    return Object.entries(c.secrets || {}).filter(([k]) => k.startsWith(slot(wsId, ""))).map(([k, v]) => ({ provider: k.slice(slot(wsId, "").length), masked: mask(v.key), addedBy: v.addedBy || null, updatedAt: v.updatedAt || null }));
  }
  const rows = await q(`workspace_secrets?select=provider,masked,added_by_email,updated_at&workspace_id=eq.${encodeURIComponent(wsId)}&order=provider.asc`).catch((e) => { if (e.status === 404) return []; throw e; });
  return (rows || []).map((r) => ({ provider: r.provider, masked: r.masked || "••••", addedBy: r.added_by_email || null, updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null }));
}

export async function save(wsId, provider, key) {
  const c = ctx();
  const value = { key: String(key).trim(), addedBy: c.email || null, updatedAt: Date.now() };
  if (!HOSTED) { await setSecret(slot(wsId, provider), value); return { provider, masked: mask(value.key) }; }
  await q("workspace_secrets", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { workspace_id: wsId, provider, ciphertext: encrypt(JSON.stringify({ key: value.key }), slot(wsId, provider)), masked: mask(value.key), added_by: c.userId, added_by_email: c.email || null, updated_at: new Date().toISOString() } });
  if (activeWorkspace(c) === wsId) await loadForActive(c);
  return { provider, masked: mask(value.key) };
}

export async function remove(wsId, provider) {
  const c = ctx();
  if (!HOSTED) { const had = !!c.secrets?.[slot(wsId, provider)]; if (had) await setSecret(slot(wsId, provider), null); return had; }
  await q(`workspace_secrets?workspace_id=eq.${encodeURIComponent(wsId)}&provider=eq.${encodeURIComponent(provider)}`, { method: "DELETE", prefer: "return=minimal" });
  if (activeWorkspace(c) === wsId) await loadForActive(c);
  return true;
}

// local: keys of workspaces that no longer exist are dropped from the vault
export async function pruneLocal() {
  if (HOSTED) return 0;
  const c = ctx(), alive = new Set(localWorkspaceIds());
  let n = 0;
  for (const k of Object.keys(c.secrets || {})) {
    if (!k.startsWith(PREFIX)) continue;
    const wsId = k.slice(PREFIX.length).split(":")[0];
    if (!alive.has(wsId)) { await setSecret(k, null); n++; }
  }
  return n;
}

// which providers the active workspace's keys serve right now
export function using(c = ctx()) {
  const wsId = activeWorkspace(c);
  if (!wsId) return [];
  return Object.keys(PROVIDERS).filter((p) => !!resolve(c, p));
}
export const isWorkspaceSlot = (id) => String(id).startsWith(PREFIX);
