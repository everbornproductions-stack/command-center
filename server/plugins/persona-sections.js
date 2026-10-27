// Persona sections routes (flag personasections, 0.4.19 slice C6). Nothing is sent anywhere from here.
// Off, every route says so.
import { flagOn } from "../flags.js";
import { findTemplate, templateFromWalk } from "../project-templates.js";
import * as P from "../persona-sections.js";

export const id = "persona-sections";

async function isOwner() {
  try { return !!(await import("../takeover.js")).isOwner(); } catch { return false; }
}

// A template to share: a saved one, or a project in progress (nothing is saved for it).
function source(h, body) {
  if (body?.templateId) return findTemplate(h, String(body.templateId));
  if (body?.walkId) {
    const w = (h.doc("walkthrough.items", () => ({ items: [] }))?.items || []).find((x) => x.id === String(body.walkId) && !x.example);
    return w ? { ...templateFromWalk(w), note: "" } : null;
  }
  return null;
}

export async function routes(req, res, url, body, h) {
  if (!flagOn("personasections")) return h.json(res, 404, { error: "Persona sections are turned off on this install.", code: "flag_off" });
  const p = url.pathname.replace(/^\/api\/persona-sections\/?/, "");
  const parts = p.split("/").filter(Boolean);
  const fail = (e) => h.json(res, e.status || 400, { error: e.message || "Something went wrong.", code: e.code || "error" });
  try {
    const m = req.method;
    if (m === "GET" && !parts.length) return h.json(res, 200, P.view(h, await isOwner()));
    if (m === "POST" && parts[0] === "preview") return h.json(res, 200, P.preview(h, source(h, body), String(body?.section || "")));
    if (m === "POST" && parts[0] === "share") return h.json(res, 200, P.share(h, source(h, body), String(body?.section || ""), String(body?.hash || ""), body?.confirm));
    if (m === "POST" && parts[0] === "sections" && !parts[1]) return h.json(res, 200, P.addSection(h, body?.name, await isOwner()));
    if (m === "POST" && parts[0] === "sections" && parts[2] === "approve") return h.json(res, 200, P.approveSection(h, parts[1], await isOwner()));
    if (m === "POST" && parts[0] === "sections" && parts[2] === "hide") return h.json(res, 200, P.setHidden(h, parts[1], body?.hidden !== false));
    if (m === "DELETE" && parts[0] === "sections" && parts[1]) return h.json(res, 200, P.removeSection(h, parts[1]));
    if (m === "POST" && parts[0] === "targets") return h.json(res, 200, P.setTargets(h, body?.targets));
    if (m === "DELETE" && parts[0] === "outbox" && parts[1]) return h.json(res, 200, P.withdraw(h, parts[1]));
    if (m === "POST" && parts[0] === "outbox" && parts[2] === "review") return h.json(res, 200, P.addReview(h, parts[1], body || {}));
    return false;
  } catch (e) { return fail(e); }
}
