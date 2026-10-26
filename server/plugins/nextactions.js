// Next actions after a result (flag_nextactions, 0.4.19): three prompt variations and filing a
// result under a project. Nothing here calls an AI or spends money. Off, every route says so.
import { flagOn } from "../flags.js";
import { listProjects, addLink } from "../projects.js";
import { variationPrompts, resultLink, KINDS } from "../../web/next-actions.js";

export const id = "nextactions";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/nextactions/, "") || "/";
  if (!flagOn("nextactions")) return h.json(res, 404, { error: "Next actions are turned off on this install.", code: "flag_off" });

  if (req.method === "POST" && p === "/variations") {
    const prompts = variationPrompts(body?.text, 3);
    if (!prompts.length) return h.json(res, 400, { error: "There is nothing to vary yet.", code: "empty" });
    return h.json(res, 200, { prompts });
  }

  if (req.method === "POST" && p === "/add") {
    const projectId = String(body?.projectId || "");
    if (!listProjects().some((x) => x.id === projectId)) return h.json(res, 404, { error: "Pick a project first.", code: "project" });
    const kind = String(body?.kind || "");
    if (!KINDS.includes(kind)) return h.json(res, 400, { error: "That kind of result is not known.", code: "kind" });
    const link = resultLink({ kind, ref: body?.ref, name: body?.name });
    const project = addLink(projectId, "results", link);
    return h.json(res, 200, { ok: true, projectId, link, projectName: project?.name || "" });
  }
  return false;
}
