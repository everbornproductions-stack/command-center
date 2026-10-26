// Photo editor routes (flag_photoeditor, 0.4.19). Loaded on demand (see SERVER_DEMAND in web/perf/registry.js).
//   GET    /api/photoeditor/config                     sliders, mood presets, enhancement prompts
//   GET    /api/photoeditor/versions?imageId=          saved versions of one photo (newest first)
//   POST   /api/photoeditor/versions  { imageId, index, name, recipe, dataUrl, projectId }
//   DELETE /api/photoeditor/versions/<id>              the version and its edited copy, never the original
// Off, every route says so and nothing else changes.
import { flagOn } from "../flags.js";
import { config, listVersions, saveVersion, deleteVersion } from "../photo-edit.js";

export const id = "photoeditor";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/photoeditor/, "") || "/";
  if (!flagOn("photoeditor")) return h.json(res, 404, { error: "The photo editor is turned off on this install.", code: "flag_off" });
  try {
    if (req.method === "GET" && p === "/config") return h.json(res, 200, config());
    if (req.method === "GET" && p === "/versions") return h.json(res, 200, { items: listVersions({ imageId: url.searchParams.get("imageId") || null }) });
    if (req.method === "POST" && p === "/versions") return h.json(res, 200, saveVersion(body || {}));
    const m = p.match(/^\/versions\/([^/]+)$/);
    if (req.method === "DELETE" && m) return h.json(res, 200, deleteVersion(decodeURIComponent(m[1])));
  } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code || "error" }); }
  return false;
}
