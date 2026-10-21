// Decision 23. Use your own Supabase. The service key never leaves the server.
import { ownSupabaseView, saveOwnSupabase, checkOwnSupabase } from "../own-supabase.js";

export const id = "ownsupabase";

function safe(view) {
  const text = JSON.stringify(view);
  return text;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/ownsupabase/, "") || "/";
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, ownSupabaseView());
  if (req.method === "POST" && (p === "" || p === "/")) {
    const view = await saveOwnSupabase(body || {});
    if (body?.serviceKey && safe(view).includes(String(body.serviceKey))) {
      return h.json(res, 500, { error: "The service key was about to be sent back. It was not." });
    }
    if (body?.publishable && safe(view).includes(String(body.publishable))) {
      return h.json(res, 500, { error: "The publishable key was about to be sent back in full." });
    }
    return h.json(res, 200, view);
  }
  if (req.method === "POST" && p === "/check") {
    const out = await checkOwnSupabase();
    return h.json(res, 200, { ok: out.ok, status: out.status, using: out.using, serviceKeyUsed: out.serviceKeyUsed });
  }
  return false;
}
