// 0.4.21: Teams across two computers, through the Supabase project the app already uses
// (supabase/hub_reportback_teams.sql). The owner's computer makes an invite code, the other
// computer enters it, and both then see the same member list and shared recipes.
// Only the code's hash is stored in the cloud. Keys and projects never go there; a shared recipe
// is its steps only (team-spaces.js already scrubs it). With no cloud setup, or before the SQL
// has been run, every call returns { ok: false, reason } and the local path stays.
import { doc, putDoc } from "./store.js";
import { rpc, hubReady, deviceSecret, sha256, NOT_SET_UP } from "./hub-supabase.js";

const DOC = "teams.across";
const state = () => { const d = doc(DOC, () => ({ owned: {}, joined: [] })); d.owned ||= {}; d.joined ||= []; return d; };

function why(out) {
  if (out.missing) return NOT_SET_UP;
  if (out.offline) return "Could not reach Meldmind's cloud. Check your internet and try again.";
  if (out.off) return "Add the Meldmind cloud address in Settings first.";
  return out.error || out.body?.message || "The cloud said no.";
}

export const acrossReady = () => hubReady();

// Owner side: make the invite visible on other computers. `code` is the same code the owner shares.
export async function createAcrossInvite({ wsId, name, role, code, seatCap = 5 }) {
  if (!hubReady()) return { ok: false, reason: "Add the Meldmind cloud address in Settings first." };
  const out = await rpc("team_invite_create", { p_owner: deviceSecret(), p_ws: wsId, p_name: name, p_role: role, p_code_hash: sha256(code), p_seat_cap: seatCap });
  if (!out.ok || !out.body?.ok) return { ok: false, reason: why(out) };
  const d = state(); d.owned[wsId] = { at: Date.now() }; putDoc(DOC, d);
  return { ok: true };
}

// Member side: enter the code on the second computer.
export async function joinWithCode(code, label) {
  if (!hubReady()) return { ok: false, reason: "Add the Meldmind cloud address in Settings first." };
  const out = await rpc("team_invite_accept", { p_code: String(code), p_device: deviceSecret(), p_label: String(label || "Teammate").slice(0, 60) });
  if (!out.ok || !out.body?.ok) return { ok: false, reason: why(out) };
  const b = out.body;
  const d = state();
  d.joined = [{ id: String(b.wsId), name: String(b.name), role: String(b.role), joinedAt: Date.now() }, ...d.joined.filter((j) => j.id !== b.wsId)].slice(0, 20);
  putDoc(DOC, d);
  return { ok: true, workspaceId: b.wsId, name: b.name, role: b.role };
}

export async function acrossState(wsId) {
  const out = await rpc("team_state", { p_device: deviceSecret(), p_ws: wsId });
  if (!out.ok || !out.body?.ok) return { ok: false, reason: why(out) };
  const b = out.body;
  return { ok: true, role: b.role, name: b.name, seatCap: b.seatCap, members: b.members || [], recipes: b.recipes || [] };
}

export async function pushRecipe(wsId, recipe) {
  if (!state().owned[wsId] && !state().joined.some((j) => j.id === wsId)) return { ok: false, reason: "not-across" };
  const out = await rpc("team_recipe_put", { p_device: deviceSecret(), p_ws: wsId, p_recipe_id: String(recipe.id || recipe.pipelineId || ""), p_data: recipe });
  return out.ok && out.body?.ok ? { ok: true } : { ok: false, reason: why(out) };
}

export const isAcross = (wsId) => !!state().owned[wsId];
export const joinedList = () => state().joined;

// Added to GET /api/workspaces in local mode.
export async function acrossView(owned) {
  const ready = hubReady();
  const out = { ready, memberOf: [], note: ready ? "" : "Add the Meldmind cloud address in Settings to use teams across computers." };
  if (!ready) return out;
  for (const w of owned) {
    if (!isAcross(w.id)) continue;
    const st = await acrossState(w.id);
    w.across = st.ok ? { members: st.members, recipes: st.recipes } : { error: st.reason };
  }
  for (const j of joinedList()) {
    const st = await acrossState(j.id);
    out.memberOf.push({ id: j.id, name: st.ok ? st.name : j.name, role: st.ok ? st.role : j.role, across: true, members: st.ok ? st.members : [], recipes: st.ok ? st.recipes : [], projects: [], usage: [], error: st.ok ? "" : st.reason });
  }
  return out;
}
