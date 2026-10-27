// Make, find and open the PDF of a finished run (0.4.21, dogfood 07).
//   POST /api/docpdf/make  { missionId, name? }      render the requested document, save .pdf and .md in the project folder
//   GET  /api/docpdf/file?mission=<id>               the PDF's bytes (base64) from the project folder, for a browser download
//   POST /api/docpdf/open  { missionId, dryRun? }    show the saved PDF in the computer's own viewer
// Nothing is sent anywhere. The same engine and file names are used by the card's Download PDF button.
import fs from "node:fs";
import path from "node:path";
import { ctx } from "../store.js";
import { makeAndSavePdf, savedLine } from "../doc-pdf.js";
import { projectMediaDir } from "../media-jobs.js";

export const id = "docpdf";

const KEYISH = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{12,}|gsk_[A-Za-z0-9]{12,})\b/g;
const fail = (status, message) => Object.assign(new Error(message), { status });
const cleanId = (s) => String(s || "").replace(/[^a-z0-9-]/gi, "");

async function missionOf(mid) {
  const m = await ctx().store.getMission(cleanId(mid));
  if (!m) throw fail(404, "That run was not found.");
  return m;
}
// the saved PDF, only from inside the project media folder
export function savedPdfPath(m) {
  const f = m?.savedPdf;
  if (!f?.ok || !f.pdf?.path) return null;
  const root = path.resolve(projectMediaDir(f.projectId || "unfiled")) + path.sep;
  const full = path.resolve(f.pdf.path);
  return full.startsWith(root) && fs.existsSync(full) ? full : null;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/docpdf/, "") || "/";
  try {
    if (req.method === "POST" && p === "/make") {
      const m = await missionOf(body?.missionId);
      const r = await makeAndSavePdf({ goal: m.prompt || "", title: m.title || "", deliverable: String(m.deliverable || m.verdict?.text || "").replace(KEYISH, "[hidden]"), tasks: m.tasks || [], projectId: m.projectId || "", missionId: m.id, name: body?.name ? String(body.name) : "", source: "Answer" });
      if (r.ok) { m.savedPdf = r; try { ctx().store.saveMission(m); } catch { /* the file is saved either way */ } }
      return h.json(res, r.ok ? 200 : 400, { ...r, line: savedLine(r) });
    }
    if (req.method === "GET" && p === "/file") {
      const m = await missionOf(url.searchParams.get("mission"));
      const f = savedPdfPath(m);
      if (!f) throw fail(404, "There is no saved PDF for this run yet.");
      return h.json(res, 200, { filename: path.basename(f), mime: "application/pdf", base64: fs.readFileSync(f).toString("base64"), path: f });
    }
    if (req.method === "POST" && p === "/open") {
      if (h.HOSTED) throw fail(400, "Opening a file is only for the app on your computer.");
      const m = await missionOf(body?.missionId);
      const f = savedPdfPath(m);
      if (!f) throw fail(404, "There is no saved PDF to open.");
      if (body?.dryRun === true) return h.json(res, 200, { ok: true, dryRun: true, path: f });
      const { execFile } = await import("node:child_process");
      const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
      execFile(cmd, [f], () => {}).unref?.();
      return h.json(res, 200, { ok: true, path: f });
    }
  } catch (e) { return h.json(res, e.status || 500, { error: e.message }); }
  return false;
}
