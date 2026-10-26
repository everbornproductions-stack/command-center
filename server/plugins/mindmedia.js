// MindMedia hub routes (0.4.20). One list for everything Meldmind makes, across all projects and Unfiled.
//   GET  /api/mindmedia?project=&type=&status=&source=&tag=&q=&sort=   items + project rail + shelf
//   POST /api/mindmedia/save        { kind, text|files, projectId, source, status, provenance, name, tags }
//   POST /api/mindmedia/meta        { projectId, assetId, name?, tags?, status?, prompt? }
//   POST /api/mindmedia/move        { projectId, assetId, targetProjectId }
//   POST /api/mindmedia/export      { text, title, format: pdf|docx } -> { name, mime, data (base64) }
//   POST /api/mindmedia/ending      { projectId, assetId, action: keep|discard }
//   POST /api/mindmedia/delete      { items: [{ projectId, assetId }] }
//   GET  /api/mindmedia/item?projectId=&assetId=     one item with its text (text items)
// Files are served by GET /api/projectmedia/file. Nothing here posts anywhere; publishing stays in /api/publish.
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import { exportReport } from "../research.js";
import { isInsideDataDir, listMindMedia, saveToMindMedia, updateAssetMeta, moveToProject, endingAction, assetForPublish, bulkAction, STATUSES } from "../project-media.js";

export const id = "mindmedia";

// A request may point at a file that already lives in a project folder (a builder's site). Nothing else in the
// data folder (keys, settings, other people's files) can be filed this way.
function pathAllowed(p) {
  if (!p || typeof p !== "string") return false;
  const full = path.resolve(DATA_DIR, p);
  const root = path.resolve(DATA_DIR, "projects") + path.sep;
  if (!full.startsWith(root)) return false;
  return isInsideDataDir(p);
}

export async function routes(req, res, url, body, h) {
  if (!url.pathname.startsWith("/api/mindmedia")) return false;
  const sub = url.pathname.replace(/^\/api\/mindmedia\/?/, "");
  const m = req.method;
  try {
    if (m === "GET" && !sub) {
      const q = Object.fromEntries(url.searchParams.entries());
      return h.json(res, 200, listMindMedia(q));
    }
    if (m === "GET" && sub === "item") {
      const a = assetForPublish(url.searchParams.get("projectId"), url.searchParams.get("assetId"));
      if (!a) return h.json(res, 404, { error: "That item was not found." });
      return h.json(res, 200, { projectId: a.projectId, assetId: a.assetId, name: a.name, kind: a.kind, text: a.text.slice(0, 20000) });
    }
    if (m === "POST" && sub === "save") {
      const b = body || {};
      for (const f of Array.isArray(b.files) ? b.files : []) {
        if (f && typeof f.path === "string" && f.path && !pathAllowed(f.path)) return h.json(res, 400, { error: "That file is not inside a Meldmind project folder, so it cannot be kept." });
      }
      const out = saveToMindMedia(b);
      h.emit?.("projectmedia.update", { projectId: out.projectId, action: "save" });
      return h.json(res, 200, out);
    }
    if (m === "POST" && sub === "meta") {
      const patch = { ...(body || {}) };
      delete patch.projectId; delete patch.assetId;
      const out = updateAssetMeta(body?.projectId || "unfiled", body?.assetId, patch);
      return h.json(res, 200, { ...out, statuses: STATUSES });
    }
    if (m === "POST" && sub === "move") {
      const out = moveToProject(body?.projectId, body?.assetId, body?.targetProjectId);
      h.emit?.("projectmedia.update", { projectId: out.projectId, action: "move" });
      return h.json(res, 200, out);
    }
    if (m === "POST" && sub === "export") {
      const text = String(body?.text || "").slice(0, 200000);
      if (!text.trim()) return h.json(res, 400, { error: "There is nothing to save yet." });
      const format = body?.format === "docx" ? "docx" : "pdf";
      const title = String(body?.title || "Meldmind").slice(0, 120);
      const file = exportReport({ title, deliverable: text, sources: [] }, format);
      const safe = title.replace(/[^a-z0-9 _-]/gi, "").trim().replace(/\s+/g, "-").slice(0, 60) || "meldmind";
      return h.json(res, 200, { name: `${safe}.${file.ext}`, mime: file.type, data: Buffer.from(file.bytes).toString("base64") });
    }
    if (m === "POST" && sub === "ending") {
      return h.json(res, 200, endingAction(body?.projectId, body?.assetId, String(body?.action || "")));
    }
    if (m === "POST" && sub === "delete") {
      const list = Array.isArray(body?.items) ? body.items : [];
      const byProject = new Map();
      for (const it of list) { const k = String(it.projectId || "unfiled"); byProject.set(k, [...(byProject.get(k) || []), String(it.assetId)]); }
      let count = 0;
      for (const [pid, ids] of byProject) count += bulkAction(pid, { action: "delete", assetIds: ids }).count;
      return h.json(res, 200, { ok: true, count });
    }
    return false;
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message || "MindMedia request failed." });
  }
}
