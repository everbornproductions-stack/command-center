// Side-by-side comparison (Phase 17): the routes for the Compare tab. The work lives in server/compare.js.
//   GET  /api/compare/models?chars=&maxTokens=   models to pick from, with an estimate per column
//   GET  /api/compare                            recent comparisons ;  GET /api/compare/<id>  one comparison
//   POST /api/compare  { prompt, columns: [{provider, model}], maxTokens, projectId }   start (202)
//   POST /api/compare/<id>/winner  { column }    pick the winner (a thumbs-up through the ratings plugin)
//   GET  /api/compare/presets ; POST /api/compare/presets { name, columns } ; DELETE /api/compare/presets/<id>
import { compareModels, startCompare, listRuns, getRun, pickWinner, listPresets, savePreset, deletePreset } from "../compare.js";
import { saveRating } from "./ratings.js";
export const id = "compare";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/compare/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const fail = (e) => h.json(res, e.status || 500, { error: e.message, code: e.code });
  try {
    if (req.method === "GET" && p === "/models") return h.json(res, 200, compareModels({ chars: Number(url.searchParams.get("chars")) || 400, maxTokens: Number(url.searchParams.get("maxTokens")) || 1200 }));
    if (req.method === "GET" && p === "/presets") return h.json(res, 200, { items: listPresets() });
    if (req.method === "POST" && p === "/presets") { const item = savePreset(body || {}); h.emit("log", { text: `Comparison preset saved: ${item.name}.` }); return h.json(res, 200, item); }
    if (req.method === "DELETE" && seg[0] === "presets" && seg[1]) { deletePreset(seg[1]); return h.json(res, 200, { ok: true, items: listPresets() }); }
    if (req.method === "GET" && p === "/") return h.json(res, 200, { items: listRuns() });
    if (req.method === "POST" && p === "/") {
      const { run, done } = startCompare(body || {});
      done.catch((e) => h.emit("log", { text: `Side-by-side failed: ${e.message}`, level: "error", missionId: run.id }));
      return h.json(res, 202, run);
    }
    if (req.method === "GET" && seg.length === 1) { const r = getRun(seg[0]); return r ? h.json(res, 200, r) : h.json(res, 404, { error: "No such comparison." }); }
    if (req.method === "POST" && seg.length === 2 && seg[1] === "winner") return h.json(res, 200, pickWinner(seg[0], body || {}, (item) => saveRating(h, item)));
  } catch (e) { return fail(e); }
  return false;
}
