// Smart fallback (Phase 26): the view for Settings and the command strip, the settings, and a manual
// "try again now" that clears a skipped provider. The behaviour itself lives in server/fallback.js and
// runs inside every single / council / mission call.
import { PROVIDERS } from "../registry.js";
import { fallbackView, saveFallbackSettings, clearTrouble, trouble } from "../fallback.js";
export const id = "fallback";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/fallback/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, fallbackView());
  if (req.method === "POST" && p === "/settings") { saveFallbackSettings(body || {}); h.emit("log", { text: "Smart fallback settings saved." }); return h.json(res, 200, fallbackView()); }
  if (req.method === "POST" && p === "/clear") {
    const pid = String(body?.provider || "");
    if (pid && !PROVIDERS[pid]) return h.json(res, 404, { error: "unknown provider" });
    const targets = pid ? [pid] : Object.values(PROVIDERS).filter((x) => x.kind === "text").map((x) => x.id);
    const cleared = [];
    for (const t of targets) { const tr = trouble(t); if (tr?.kind === "cap") continue; if (clearTrouble(t, "cleared by hand")) cleared.push(t); }
    return h.json(res, 200, { cleared, view: fallbackView() });
  }
  return false;
}
