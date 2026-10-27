// PDF and Word download for a finished answer. Pro. The file stays on this computer
// until the person saves it. Nothing is posted or sent.
import fs from "node:fs";
import { requirePro } from "../feature-gate.js";
import { toDocx, fileSlug } from "../doc-export.js";
import { extractDocument, makeAndSavePdf, pdfFileName, savedLine } from "../doc-pdf.js";

export const id = "export";

const KEYISH = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{12,}|gsk_[A-Za-z0-9]{12,})\b/g;

function clean(text) {
  return String(text || "").replace(KEYISH, "[hidden]");
}

async function sourceOf(body, h) {
  const id = String(body?.missionId || "").replace(/[^a-z0-9-]/gi, "");
  if (id) {
    const m = await h.ctx().store.getMission(id);
    if (!m) {
      const err = new Error("That run was not found.");
      err.status = 404;
      throw err;
    }
    return { title: m.title || String(m.prompt || "Meldmind").slice(0, 80), markdown: m.deliverable || m.verdict?.text || "", goal: m.prompt || "", tasks: m.tasks || [], projectId: m.projectId || "", id: m.id };
  }
  return { title: String(body?.title || "Meldmind").slice(0, 80), markdown: body?.markdown || "", goal: String(body?.goal || ""), tasks: [], projectId: String(body?.projectId || ""), id: "" };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/export/, "") || "/";
  if (req.method !== "POST" || (p !== "/pdf" && p !== "/docx")) return false;
  try { requirePro("documentExport"); }
  catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
  let src;
  try { src = await sourceOf(body, h); }
  catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
  const raw = clean(src.markdown);
  if (!raw.trim()) return h.json(res, 400, { error: "There is no text to export yet." });
  const title = clean(src.title).slice(0, 80) || "Meldmind";
  const docx = p === "/docx";
  if (!docx) {
    // only the requested document, rendered properly, named from the task, saved in the project folder
    const r = await makeAndSavePdf({ goal: src.goal || title, title, deliverable: raw, tasks: src.tasks, projectId: src.projectId, missionId: src.id, name: pdfFileName(src.goal, title), source: "Answer" });
    if (!r.ok) return h.json(res, 400, { error: r.error });
    const bytes = fs.readFileSync(r.pdf.path);
    return h.json(res, 200, { filename: r.pdf.name, mime: "application/pdf", base64: bytes.toString("base64"), savedAs: r.pdf.path, mdPath: r.md.path, pages: r.pdf.pages, engine: r.engine, warning: r.warning || "", line: savedLine(r) });
  }
  const doc = extractDocument({ deliverable: raw, tasks: src.tasks, goal: src.goal });
  const markdown = doc.markdown || raw;
  const bytes = toDocx({ title, markdown });
  return h.json(res, 200, { filename: `${fileSlug(title)}.docx`, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: bytes.toString("base64") });
}
