// Per-workspace API keys (Phase 24); the rules are in server/workspace-keys.js.
//   GET    /api/wskeys?workspace=<id>        the keys of a workspace (masked), whether you may change them, and
//                                            which providers its keys serve right now (default: the active workspace)
//   POST   /api/wskeys/<workspace>           { provider, key }  owner or admin, Studio
//   DELETE /api/wskeys/<workspace>/<provider>                   owner or admin, Studio
// A key is never sent back: only its first and last four characters.
import { HOSTED, ctx } from "../store.js";
import { licenseState } from "../license.js";
import { PROVIDERS } from "../registry.js";
import { checkProvider } from "../health.js";
import { roleIn } from "../custom-agents.js";
import { check as ssoCheck } from "../sso.js";
import * as WK from "../workspace-keys.js";

export const id = "wskeys";
const STUDIO = new Set(["studio", "owner"]);
const err = (status, message, code) => Object.assign(new Error(message), { status, code });
function gate() { if (!STUDIO.has(licenseState().tier)) throw err(402, "Workspace API keys are part of Studio, with teams and shared workspaces.", "studio"); }
const cleanId = (s) => String(s || "").trim().slice(0, 80);

async function recheck(providers) {
  for (const p of new Set(providers)) { if (PROVIDERS[p]?.kind === "text") await checkProvider(p).catch(() => {}); }
}

export async function init() { if (!HOSTED) await WK.pruneLocal().catch(() => {}); }

// switching workspaces changes which keys apply: load the new ones (hub) and re-test those providers
export function onEvent(ev) {
  if (ev.type !== "workspace.active") return;
  let c; try { c = ctx(); } catch { return; }
  if (ev.user && c.userId !== ev.user && HOSTED) return;
  const before = c.wsKeys ? Object.keys(c.wsKeys.secrets || {}) : Object.keys(c.secrets || {}).filter(WK.isWorkspaceSlot).map((k) => k.split(":").pop());
  (async () => { await WK.loadForActive(c); await recheck([...before, ...WK.using(c)]); })().catch((e) => console.error("[wskeys]", e.message));
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/wskeys/, "").replace(/\/$/, "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent), m = req.method;

  if (m === "GET" && !seg.length) {
    const wsId = cleanId(url.searchParams.get("workspace")) || WK.activeWorkspace();
    const base = { studio: STUDIO.has(licenseState().tier), active: WK.activeWorkspace(), using: WK.using(), providers: Object.values(PROVIDERS).filter((x) => WK.keyable(x.id)).map((x) => ({ id: x.id, name: x.name })) };
    if (!wsId) return h.json(res, 200, { ...base, workspace: null, keys: [] });
    const role = await roleIn(wsId);
    if (!role) return h.json(res, 404, { error: "You are not in this workspace." });
    if (HOSTED && WK.activeWorkspace() === wsId && !ctx().wsKeys) await WK.loadForActive();
    const sso = await ssoCheck(wsId, role);
    return h.json(res, 200, { ...base, using: WK.using(), workspace: wsId, role, canManage: WK.MANAGERS.includes(role), canUse: WK.USERS.includes(role) && sso.ok, note: !WK.USERS.includes(role) ? "A viewer uses their own keys." : sso.ok ? null : sso.reason, keys: WK.USERS.includes(role) ? (await WK.list(wsId)).map((k) => ({ ...k, providerName: PROVIDERS[k.provider]?.name || k.provider })) : [] });
  }

  const wsId = cleanId(seg[0]);
  if (!wsId) return false;
  if ((m === "POST" && seg.length === 1) || (m === "DELETE" && seg.length === 2)) {
    gate();
    const role = await roleIn(wsId);
    if (!role) throw err(404, "You are not in this workspace.", "role");
    if (!WK.MANAGERS.includes(role)) throw err(403, `Your role (${role}) cannot change this workspace's keys: owners and admins can.`, "role");
    if (m === "DELETE") {
      const provider = seg[1];
      const had = await WK.remove(wsId, provider);
      if (!had) return h.json(res, 404, { error: "no key for that provider here" });
      if (WK.activeWorkspace() === wsId) await recheck([provider]);
      h.emit("log", { text: `${PROVIDERS[provider]?.name || provider} key removed from the workspace. Your own key is used there again.` });
      return h.json(res, 200, { ok: true, keys: await WK.list(wsId) });
    }
    const provider = String(body.provider || "");
    if (!WK.keyable(provider)) return h.json(res, 400, { error: "pick a provider that uses an API key" });
    const key = String(body.key || "").trim();
    if (key.length < 8 || key.length > 4000 || /\s/.test(key)) return h.json(res, 400, { error: "That does not look like an API key." });
    const saved = await WK.save(wsId, provider, key);
    if (WK.activeWorkspace() === wsId) await recheck([provider]);
    h.emit("log", { text: `${PROVIDERS[provider].name} key saved for the workspace. It is used only while that workspace is active.` });
    return h.json(res, 200, { ok: true, ...saved, keys: await WK.list(wsId) });
  }
  return false;
}
