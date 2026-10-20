// Routes for the Get everything connected checklist. This plugin does not read or
// store keys. A key in the body is ignored. Connect happens on the existing routes.
import { connectSetupPublic, beginSetup, dismissSetup, completeSetup, resetSetup, skipSetup } from "../connect-setup.js";

export const id = "connectsetup";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/connectsetup\/?/, "");
  try {
    if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, connectSetupPublic());
    if (req.method !== "POST") return false;
    if (p === "begin") return h.json(res, 200, beginSetup());
    if (p === "later") return h.json(res, 200, dismissSetup());
    if (p === "complete") return h.json(res, 200, completeSetup());
    if (p === "reset") return h.json(res, 200, resetSetup());
    if (p === "skip") return h.json(res, 200, skipSetup(body?.id || body?.provider));
  } catch (e) {
    return h.json(res, e.status || 400, { error: e.message, code: e.code || "connectsetup" });
  }
  return false;
}
