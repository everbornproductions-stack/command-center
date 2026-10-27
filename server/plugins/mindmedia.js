// MindMedia hub routes (0.4.20). One list for everything Meldmind makes, across all projects and Unfiled.
//   GET  /api/mindmedia?project=&type=&status=&source=&tag=&q=&sort=   items + project rail + shelf
//   POST /api/mindmedia/save        { kind, text|files, projectId, source, status, provenance, name, tags }
//   POST /api/mindmedia/meta        { projectId, assetId, name?, tags?, status?, prompt? }
//   POST /api/mindmedia/move        { projectId, assetId, targetProjectId }
//   POST /api/mindmedia/export      { text, title, format: pdf|docx } -> { name, mime, data (base64) }
//   POST /api/mindmedia/ending      { projectId, assetId, action: keep|discard }
//   POST /api/mindmedia/delete      { items: [{ projectId, assetId }] }
//   GET  /api/mindmedia/item?projectId=&assetId=     one item with its text (text items)
//   GET  /api/mindmedia?view=needs-ok|approved-unpublished|published-month|ai-employees|needs-ending|trash   built-in saved views
//   POST /api/mindmedia/restore     { projectId, assetId }  put an item back from the Trash (kept 30 days)
//   GET  /api/mindmedia/pending     running jobs and jobs that just finished (pending tiles, "ready" notice)
//   POST /api/mindmedia/host        { projectId, assetId, link }  remember a public link for a file (Host this file)
//   GET/POST /api/mindmedia/employees   { id, approval: "queue"|"own" }  what happens to an AI employee's finished work
// Files are served by GET /api/projectmedia/file. Nothing here posts anywhere; publishing stays in /api/publish.
import path from "node:path";
import { DATA_DIR } from "../paths.js";
import { exportReport } from "../research.js";
import { isInsideDataDir, safeMediaDir, listMindMedia, saveToMindMedia, updateAssetMeta, moveToProject, endingAction, assetForPublish, bulkAction, restoreFromTrash, pendingJobs, recentlyFinished, setHostedLink, smartName, STATUSES } from "../project-media.js";
import fs from "node:fs";
import { extractCodeFiles } from "../code-files.js";
import { zipStore } from "../remix-output.js";
import { projectMediaDir } from "../media-jobs.js";
import { approvalFor, setApproval, teamList } from "../employees.js";

export const id = "mindmedia";

const cleanTitle = (t) => smartName(String(t || ""), 100) || "Meldmind";

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
      const full = String(a.text || "");
      return h.json(res, 200, { projectId: a.projectId, assetId: a.assetId, name: a.name, kind: a.kind, text: full.slice(0, 20000), truncated: full.length > 20000, length: full.length });
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
    if (m === "GET" && sub === "pending") return h.json(res, 200, { pending: pendingJobs(), finished: recentlyFinished() });
    if (m === "POST" && sub === "restore") {
      const out = restoreFromTrash(body?.projectId, body?.assetId);
      h.emit?.("projectmedia.update", { projectId: out.projectId, action: "restore" });
      return h.json(res, 200, out);
    }
    if (m === "POST" && sub === "host") return h.json(res, 200, setHostedLink(body?.projectId, body?.assetId, body?.link));
    if (m === "GET" && sub === "employees") return h.json(res, 200, { employees: teamList().map((e) => ({ id: e.id, name: e.name, approval: e.approval })) });
    if (m === "POST" && sub === "employees") return h.json(res, 200, setApproval(String(body?.id || ""), String(body?.approval || "")));
    if (m === "POST" && sub === "code-files") {
      // "Save as files": every fenced code block becomes a named file in one folder, kept as items, with a zip
      const found = extractCodeFiles(String(body?.text || "").slice(0, 400000));
      if (!found.length) return h.json(res, 400, { error: "There is no code in this answer to save as files." });
      const pid = String(body?.projectId || "") || "unfiled";
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
      const folderName = `code-${stamp}-${Math.random().toString(36).slice(2, 5)}`;
      let mediaRoot;
      try { mediaRoot = safeMediaDir(pid); } catch (e) { return h.json(res, e.status || 400, { error: e.message }); }
      const dir = path.join(mediaRoot, folderName);
      const written = [];
      for (const f of found) {
        const full = path.join(dir, ...f.name.split("/"));
        if (!path.resolve(full).startsWith(path.resolve(dir) + path.sep)) continue;
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, f.text, "utf8");
        written.push({ ...f, path: full });
      }
      const saved = saveToMindMedia({ files: written.map((f) => ({ name: f.name.split("/").pop(), path: f.path, folder: folderName })), projectId: pid, source: String(body?.source || "Finish").slice(0, 60), status: "Draft", kind: undefined });
      h.emit?.("projectmedia.update", { projectId: saved.projectId, action: "save" });
      const tree = {};
      for (const f of written) tree[`${folderName}/${f.name}`] = Buffer.from(f.text, "utf8");
      return h.json(res, 200, { ok: true, projectId: saved.projectId, folder: folderName, count: written.length, files: written.map((f) => ({ name: f.name, lang: f.lang, bytes: Buffer.byteLength(f.text) })), items: saved.items, savedWhere: `Saved ${written.length} file${written.length === 1 ? "" : "s"} in MindMedia, ${saved.where}.`, zip: { name: `${folderName}.zip`, mime: "application/zip", data: zipStore(tree).toString("base64") } });
    }
    if (m === "POST" && sub === "open-folder") {
      if (h.HOSTED || !h.DATA_DIR) return h.json(res, 400, { error: "Opening a folder works in the desktop app only. Use Download zip instead." });
      const pid = String(body?.projectId || "") || "unfiled";
      const sub2 = String(body?.folder || "").replace(/[^\w.-]/g, "");
      const dir = sub2 ? path.join(projectMediaDir(pid), sub2) : projectMediaDir(pid);
      if (!fs.existsSync(dir)) return h.json(res, 404, { error: "That folder was not found." });
      const { execFile } = await import("node:child_process");
      const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
      if (!body?.dryRun) execFile(cmd, [dir], () => {});
      return h.json(res, 200, { ok: true, dryRun: !!body?.dryRun });
    }
    if (m === "POST" && sub === "move") {
      const out = moveToProject(body?.projectId, body?.assetId, body?.targetProjectId, { link: body?.link === true });
      h.emit?.("projectmedia.update", { projectId: out.projectId, action: "move" });
      return h.json(res, 200, out);
    }
    if (m === "POST" && sub === "export") {
      const text = String(body?.text || "").slice(0, 200000);
      if (!text.trim()) return h.json(res, 400, { error: "There is nothing to save yet." });
      const format = body?.format === "docx" ? "docx" : "pdf";
      const title = cleanTitle(body?.title);
      const file = exportReport({ title, deliverable: text, sources: [] }, format);
      const safe = title.replace(/[^a-z0-9 _-]/gi, "").trim().replace(/\s+/g, "-") || "meldmind";
      const fileBase = safe.length > 60 ? safe.slice(0, Math.max(safe.lastIndexOf("-", 60), 20)) : safe;
      return h.json(res, 200, { name: `${fileBase}.${file.ext}`, mime: file.type, data: Buffer.from(file.bytes).toString("base64") });
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
    return h.json(res, e.status || 500, { error: e.message || "MindMedia request failed.", ...(typeof e.code === "string" && /^[a-z_]+$/.test(e.code) ? { code: e.code } : {}) });
  }
}
