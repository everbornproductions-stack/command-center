// Marketplace routes (Phase 10). The work lives in server/marketplace.js.
//   GET  /api/marketplace
//   POST /api/marketplace/listings
//   POST /api/marketplace/listings/:id
//   POST /api/marketplace/listings/:id/submit|moderate|report
//   DELETE /api/marketplace/listings/:id
//   POST /api/marketplace/install|update|rate|export|import
//   GET  /api/marketplace/share/:id?t=...
import * as M from "../marketplace.js";
import { findPipeline } from "./pipelines.js";

export const id = "marketplace";

function pipelineFrom(h, id) {
  if (!id) return null;
  const found = findPipeline(h, id);
  if (!found) { const e = new Error("No such pipeline."); e.status = 404; throw e; }
  return found;
}

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/marketplace\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (m === "GET" && seg.length === 0) return h.json(res, 200, M.overview());
    if (m === "POST" && seg[0] === "listings" && seg.length === 1) {
      const pipeline = body?.pipelineId ? pipelineFrom(h, body.pipelineId) : null;
      return h.json(res, 200, M.createListing({ ...body, pipeline }));
    }
    if (m === "POST" && seg[0] === "listings" && seg[1] && seg.length === 2) {
      const pipeline = body?.pipelineId ? pipelineFrom(h, body.pipelineId) : null;
      return h.json(res, 200, M.updateListing(seg[1], { ...body, pipeline }));
    }
    if (m === "POST" && seg[0] === "listings" && seg[2] === "submit") return h.json(res, 200, M.submitListing(seg[1]));
    if (m === "POST" && seg[0] === "listings" && seg[2] === "moderate") return h.json(res, 200, M.moderateListing(seg[1], body?.action, body?.reason));
    if (m === "POST" && seg[0] === "listings" && seg[2] === "report") return h.json(res, 200, M.reportListing(seg[1], body?.reason));
    if (m === "DELETE" && seg[0] === "listings" && seg[1]) return h.json(res, 200, M.deleteListing(seg[1]));
    if (m === "POST" && seg[0] === "install") return h.json(res, 200, M.installListing(body?.listingId));
    if (m === "POST" && seg[0] === "update") return h.json(res, 200, M.applyUpdate(body?.listingId));
    if (m === "POST" && seg[0] === "rate") return h.json(res, 200, M.rateListing(body?.listingId, body?.stars, body?.note));
    if (m === "POST" && seg[0] === "export") {
      if (body?.listingId) return h.json(res, 200, M.exportTemplate({ listingId: body.listingId }));
      const pipeline = pipelineFrom(h, body?.pipelineId);
      return h.json(res, 200, M.exportTemplate({ pipeline }));
    }
    if (m === "POST" && seg[0] === "import") return h.json(res, 200, M.importTemplate({ file: body?.file, shareId: body?.shareId, token: body?.token }));
    if (m === "GET" && seg[0] === "share" && seg[1]) return h.json(res, 200, M.readShare(seg[1], url.searchParams.get("t")));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, flagged: e.flagged, charged: e.charged, placeholder: e.placeholder });
  }
  return false;
}
