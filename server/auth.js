// Hosted-mode request authentication: Bearer token -> Supabase user -> per-user context.
import { als, getContext, newContext, registerContext, dropContext } from "./store.js";
import { SupabaseStore, verifyToken } from "./hosted.js";

let initializer = async () => {};
// index.js registers the function that loads a context's modules (ledger, projects, licence...)
export const setContextInitializer = (fn) => { initializer = fn; };

export function bearer(req) {
  const h = req.headers.authorization || "";
  return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, "").trim() : null;
}

function beginContext(userId, { email = null, token = null, auth = null } = {}) {
  let c = getContext(userId);
  if (!c) {
    c = newContext(userId);
    c.store = new SupabaseStore(c);
    c.email = email;
    c.token = token;
    c.auth = auth;
    registerContext(c);
    c.loading = (async () => {
      await c.store.loadAll(c);
      await als.run(c, () => initializer(c));
      c.ready = true;
      console.log(`[auth] context ready for ${c.email || c.userId} (${Object.keys(c.secrets).length} keys, ${c.ledger.length} ledger rows, ${c.missions?.size || 0} missions loaded)`);
    })().catch((e) => { dropContext(userId); throw e; });
  }
  return c;
}

// Returns the context for a token (creating and loading it on first sight). Throws 401 on a bad token.
export async function contextForToken(token) {
  const user = await verifyToken(token);
  const c = beginContext(user.id, { email: user.email, token, auth: user.auth });
  c.token = token; c.email = user.email; c.auth = user.auth || null; c.lastSeen = Date.now(); // auth: how this session signed in (Team SSO, Phase 24)
  if (!c.ready) await c.loading;
  return c;
}

// Load a user without their browser token. The store uses CC_SUPABASE_SERVICE_KEY when it is set.
// The schedule tick uses this for people who are not already in memory.
export async function contextForUser(userId) {
  if (!userId) throw Object.assign(new Error("user id required"), { status: 400 });
  const c = beginContext(userId);
  if (!c.ready) await c.loading;
  return c;
}
