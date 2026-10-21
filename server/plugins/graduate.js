// Graduate notice routes. GET recomputes. POST /route records a direct api or mcp
// path for a handoff actor only. POST /approve and POST /dismiss are the one click
// and Not now. No key is accepted in the body.
import { recompute, setRoute, approve, dismiss } from "../graduate.js";

export const id = "graduate";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/graduate/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && (p === "/" || p === "")) return h.json(res, 200, recompute());
    if (m === "POST" && p === "/route") return h.json(res, 200, setRoute(String(body?.id || ""), String(body?.via || "")));
    if (m === "POST" && p === "/approve") return h.json(res, 200, await approve(String(body?.id || "")));
    if (m === "POST" && p === "/dismiss") return h.json(res, 200, dismiss(String(body?.id || "")));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
