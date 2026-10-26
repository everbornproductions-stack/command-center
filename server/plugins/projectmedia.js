// Project Media library plugin (Slice B3, gated by flag_projectmedia).
import {
  FLAG_NAME,
  isProjectMediaEnabled,
  listProjectMedia,
  uploadMedia,
  addFromLastGeneration,
  updateAssetMeta,
  linkAssetToProject,
  manageCollection,
  sendAssetTo,
  bulkAction,
  resolveAssetFile,
} from "../project-media.js";

export const id = "projectmedia";

export async function routes(req, res, url, body, h) {
  const p = url.pathname;
  if (!p.startsWith("/api/projectmedia")) return false;
  const parts = p.replace(/^\/api\/projectmedia\/?/, "").split("/").filter(Boolean);
  const m = req.method;

  try {
    // Flag inspection & toggle endpoints
    if (parts.length === 1 && parts[0] === "flag") {
      if (m === "GET") {
        return h.json(res, 200, {
          flag: FLAG_NAME,
          enabled: isProjectMediaEnabled(h.settings()),
        });
      }
      if (m === "POST") {
        const on = Boolean(body?.on ?? body?.enabled ?? body?.[FLAG_NAME]);
        const next = { ...h.settings(), [FLAG_NAME]: on };
        h.putDoc("settings", next);
        return h.json(res, 200, {
          flag: FLAG_NAME,
          enabled: isProjectMediaEnabled(next),
        });
      }
    }

    // All other routes require flag_projectmedia to be enabled
    if (!isProjectMediaEnabled(h.settings())) {
      return h.json(res, 404, {
        error: "Project media is turned off (flag_projectmedia).",
        code: "flag_off",
      });
    }

    // File streaming endpoint: GET /api/projectmedia/file?projectId=...&assetId=...
    if (m === "GET" && parts.length === 1 && parts[0] === "file") {
      const projectId = url.searchParams.get("projectId") || "";
      const assetId = url.searchParams.get("assetId") || "";
      const found = resolveAssetFile(projectId, assetId);
      if (!found) return h.json(res, 404, { error: "Asset file not found." });
      const safeTypes = new Set([
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/svg+xml", // safe inline: the response is sandboxed with no scripts, and it shows in an <img>
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/mp4",
        "text/plain",
        "text/markdown",
        "application/json",
      ]);
      const type = safeTypes.has(found.mime) ? found.mime : "application/octet-stream";
      const safeName = String(found.name || "asset").replace(/[^a-zA-Z0-9._-]+/g, "_");
      res.writeHead(200, {
        "content-type": type,
        "content-length": found.bytes.length,
        "content-disposition": `${type === "application/octet-stream" ? "attachment" : "inline"}; filename="${safeName}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      });
      res.end(found.bytes);
      return true;
    }

    if (parts.length >= 1) {
      const projectId = decodeURIComponent(parts[0]);

      if (m === "GET" && parts.length === 1) {
        const query = {
          type: url.searchParams.get("type") || "all",
          q: url.searchParams.get("q") || "",
          tag: url.searchParams.get("tag") || "",
          collection: url.searchParams.get("collection") || "",
          smart: url.searchParams.get("smart") || "",
          sort: url.searchParams.get("sort") || "date-desc",
          flat: url.searchParams.get("flat") || "",
        };
        return h.json(res, 200, listProjectMedia(projectId, query));
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "upload") {
        const out = uploadMedia(projectId, body || {});
        h.emit?.("projectmedia.update", { projectId, action: "upload" });
        return h.json(res, 200, out);
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "from-last") {
        const out = addFromLastGeneration(projectId, body || {});
        h.emit?.("projectmedia.update", { projectId, action: "from-last" });
        return h.json(res, 200, out);
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "meta") {
        const out = updateAssetMeta(projectId, body?.assetId, body || {});
        h.emit?.("projectmedia.update", { projectId, action: "meta", assetId: body?.assetId });
        return h.json(res, 200, out);
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "link") {
        const out = linkAssetToProject({
          sourceProjectId: body?.sourceProjectId || projectId,
          assetId: body?.assetId,
          targetProjectId: body?.targetProjectId,
        });
        h.emit?.("projectmedia.update", { projectId: body?.targetProjectId, action: "link" });
        return h.json(res, 200, out);
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "collections") {
        const out = manageCollection(projectId, body || {});
        h.emit?.("projectmedia.update", { projectId, action: "collections" });
        return h.json(res, 200, out);
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "send") {
        const out = sendAssetTo(projectId, body || {});
        h.emit?.("projectmedia.update", { projectId, action: "send", target: body?.target });
        return h.json(res, 200, out);
      }

      if (m === "POST" && parts.length === 2 && parts[1] === "bulk") {
        const out = bulkAction(projectId, body || {});
        h.emit?.("projectmedia.update", { projectId, action: "bulk", bulkAction: body?.action });
        return h.json(res, 200, out);
      }
    }

    return false;
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message || "Project media request failed." });
  }
}
