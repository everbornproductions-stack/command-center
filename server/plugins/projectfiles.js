// Chat with files (Phase 6): the routes behind the "Files in this project" box in Command. The engine is
// server/project-files.js (one knowledge library per project, images described once by an AI that can see).
//   GET    /api/projectfiles/<project>                  the project's files, its library and who describes images
//   POST   /api/projectfiles/<project>/stage            { files: [{ name, text } | { name, data }] } read + estimate, free
//   POST   /api/projectfiles/<project>/add              { stageId, estimate } describe the images and index: spends
//   DELETE /api/projectfiles/<project>/files/<docId>    remove one file (its passages and, for an image, the file)
//   GET    /api/projectfiles/<project>/files/<docId>/image   the image itself (session token only, sandboxed)
import fs from "node:fs";
import * as PF from "../project-files.js";

export const id = "projectfiles";

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/projectfiles/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method, pid = seg[0];
  if (!pid) return false;
  try {
    if (m === "GET" && seg.length === 1) return h.json(res, 200, PF.overview(pid));
    if (m === "POST" && seg[1] === "stage") return h.json(res, 200, PF.stage(pid, body?.files));
    if (m === "POST" && seg[1] === "add") return h.json(res, 202, await PF.add(pid, { stageId: body?.stageId, estimate: body?.estimate }));
    if (m === "DELETE" && seg[1] === "files" && seg[2] && !seg[3]) return h.json(res, 200, PF.remove(pid, seg[2]));
    if (m === "GET" && seg[1] === "files" && seg[2] && seg[3] === "image") {
      const f = PF.imageFile(pid, seg[2]);
      if (!f) return h.json(res, 404, { error: "No such image." });
      res.writeHead(200, { "content-type": f.mime, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "no-store" });
      fs.createReadStream(f.file).pipe(res);
      return true;
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
