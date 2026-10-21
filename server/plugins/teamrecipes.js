// Phase 61 add-on. Shared recipes for a workspace (Extreme). Team spaces themselves live in teamspaces.js. Phase 8 invites are not changed here.
import { teamView, saveSharedRecipe, removeSharedRecipe } from "../team-spaces.js";

export const id = "teamrecipes";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/teamrecipes/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  if (req.method === "GET" && !seg.length) return h.json(res, 200, await teamView());
  if (req.method === "POST" && seg.length === 2 && seg[1] === "recipes") {
    const out = saveSharedRecipe(decodeURIComponent(seg[0]), String(body?.pipelineId || ""));
    const blob = JSON.stringify(out);
    if (body?.key && blob.includes(String(body.key))) return h.json(res, 500, { error: "A key was about to be returned. Nothing was saved." });
    return h.json(res, 200, out);
  }
  if (req.method === "DELETE" && seg.length === 3 && seg[1] === "recipes") {
    return h.json(res, 200, removeSharedRecipe(decodeURIComponent(seg[0]), decodeURIComponent(seg[2])));
  }
  return false;
}
