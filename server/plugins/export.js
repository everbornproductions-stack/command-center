// PDF and Word download for a finished answer. Pro. The file stays on this computer
// until the person saves it. Nothing is posted or sent.
import { requirePro } from "../feature-gate.js";
import { toPdf, toDocx, fileSlug } from "../doc-export.js";

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
    return { title: m.title || String(m.prompt || "Meldmind").slice(0, 80), markdown: m.deliverable || m.verdict?.text || "" };
  }
  return { title: String(body?.title || "Meldmind").slice(0, 80), markdown: body?.markdown || "" };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/export/, "") || "/";
  if (req.method !== "POST" || (p !== "/pdf" && p !== "/docx")) return false;
  try { requirePro("documentExport"); }
  catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
  let src;
  try { src = await sourceOf(body, h); }
  catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
  const markdown = clean(src.markdown);
  if (!markdown.trim()) return h.json(res, 400, { error: "There is no text to export yet." });
  const title = clean(src.title).slice(0, 80) || "Meldmind";
  const docx = p === "/docx";
  const bytes = docx ? toDocx({ title, markdown }) : toPdf({ title, markdown });
  const ext = docx ? "docx" : "pdf";
  const mime = docx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
  return h.json(res, 200, { filename: `${fileSlug(title)}.${ext}`, mime, base64: bytes.toString("base64") });
}
