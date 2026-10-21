// Files for the marching orders box. The bytes stay on this computer.
// The reply is text the person can edit. Nothing is sent from this route.
// POST /api/orders-box/files
// GET  /api/orders-box/files/:id
import { readOrderFile, saveOrderUpload, writeAttachment } from "../box-files.js";

export const id = "orders-box";

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/orders-box\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (req.method === "POST" && seg[0] === "files" && !seg[1]) return h.json(res, 200, saveOrderUpload(body || {}));
    if (req.method === "GET" && seg[0] === "files" && seg[1]) {
      const file = readOrderFile(seg[1]);
      if (!file) return h.json(res, 404, { error: "That file is not on this computer." });
      writeAttachment(res, file);
      return true;
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
