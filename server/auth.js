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

// Returns the context for a token (creating and loading it on first sight). Throws 401 on a bad token.
export async function contextForToken(token) {
  const user = await verifyToken(token);
  let c = getContext(user.id);
  if (!c) {
    c = newContext(user.id);
    c.store = new SupabaseStore(c);
    c.email = user.email;
    c.token = token;
    registerContext(c);
    c.loading = (async () => {
      await c.store.loadAll(c);
      await als.run(c, () => initializer(c));
      c.ready = true;
      console.log(`[auth] context ready for ${c.email} (${Object.keys(c.secrets).length} keys, ${c.ledger.length} ledger rows, ${c.missions?.size || 0} missions loaded)`);
    })().catch((e) => { dropContext(user.id); throw e; });
  }
  c.token = token; c.email = user.email; c.lastSeen = Date.now();
  if (!c.ready) await c.loading;
  return c;
}
