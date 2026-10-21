// Image generation in chat (Phase 21): the routes. The work lives in server/images.js.
//   GET    /api/images/providers                     image providers, models, which have a key, which are capped
//   POST   /api/images/estimate  { provider, model, op, n, size, quality }      the price before anything runs
//   POST   /api/images  { provider, model, op, prompt, n, size, quality, source, projectId, runId, estimate }
//          op = generate | edit | variation; source = { imageId, index } or { dataUrl, name } for edit and variation;
//          estimate = the figure the person saw (a missing or lower one is refused with 409 and the current price)
//   GET    /api/images?projectId=                     the gallery (newest first)
//   GET    /api/images/<id>                           one gallery row
//   GET    /api/images/<id>/file?i=                   the picture itself
//   DELETE /api/images/<id>                           the row and its files
import { providerList, estimate, makeImages, listImages, getImage, imageFile, deleteImage } from "../images.js";
import { holdOutbound, phoneReady } from "../phone-approvals.js";
export const id = "images";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/images/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && p === "/providers") return h.json(res, 200, { items: providerList() });
    if (req.method === "POST" && p === "/estimate") return h.json(res, 200, estimate(body || {}));
    if (req.method === "GET" && p === "/") return h.json(res, 200, { items: listImages({ projectId: url.searchParams.get("projectId") || null }) });
    if (req.method === "POST" && p === "/") {
      if (phoneReady() && body?.provider && !String(body.provider).includes("demo")) {
        const est = estimate(body || {});
        if (Number(est?.usd) > 0) {
          holdOutbound({ kind: "buy", action: "Buy an image", amount: est.usd, approvalId: body.approvalId, confirmed: body.estimate != null });
        }
      }
      return h.json(res, 200, await makeImages(body || {}));
    }
    if (!seg[0]) return false;
    if (req.method === "GET" && seg.length === 1) return h.json(res, 200, getImage(seg[0]));
    if (req.method === "DELETE" && seg.length === 1) { const r = deleteImage(seg[0]); h.emit("log", { text: "Image deleted from the gallery." }); return h.json(res, 200, r); }
    if (req.method === "GET" && seg[1] === "file") {
      const f = imageFile(seg[0], url.searchParams.get("i"));
      // shown through a blob: URL in an <img>; never run as a page in the app's origin
      res.writeHead(200, { "content-type": f.mime, "content-length": f.bytes.length, "content-disposition": `inline; filename="${f.name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" });
      return res.end(f.bytes);
    }
  } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code, estimate: e.estimate, approvalId: e.approvalId }); }
  return false;
}
