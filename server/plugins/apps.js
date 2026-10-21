// Desktop control: list programs, allow each one, suggest one while planning.
// The scan runs on this PC. A hosted hub does not see the person's programs.
import { HOSTED } from "../store.js";
import * as Apps from "../apps.js";

export const id = "apps";

export function init() {
  if (!HOSTED) Apps.installAppRoutes();
}

export async function routes(req, res, url, body, h) {
  if (HOSTED) return h.json(res, 400, { error: "App discovery runs on this PC." });
  const p = url.pathname.replace(/^\/api\/apps/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && (p === "/" || p === "")) return h.json(res, 200, Apps.publicState());
    if (m === "GET" && p === "/suggestions") return h.json(res, 200, Apps.suggestFor(url.searchParams.get("prompt") || ""));
    if (m === "POST" && p === "/opt-in") return h.json(res, 200, Apps.publicState(await Apps.optIn(!!body?.on)));
    if (m === "POST" && p === "/allow") return h.json(res, 200, Apps.publicState(Apps.setAllowed(String(body?.id || ""), !!body?.allowed)));
    if (m === "POST" && p === "/dismiss") return h.json(res, 200, { ok: true, dismissed: Apps.dismissSuggestion(String(body?.id || "")).dismissed });
    if (m === "POST" && p === "/settings") {
      if (typeof body?.suggestions !== "boolean") {
        const err = new Error("suggestions must be true or false.");
        err.status = 400;
        throw err;
      }
      return h.json(res, 200, Apps.publicState(Apps.setSuggestions(body.suggestions)));
    }
    if (m === "POST" && p === "/catalog") return h.json(res, 200, Apps.publicState(await Apps.updateCatalog(body?.url)));
    if (m === "POST" && p === "/scan") return h.json(res, 200, Apps.publicState(await Apps.rescan()));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message });
  }
  return false;
}
