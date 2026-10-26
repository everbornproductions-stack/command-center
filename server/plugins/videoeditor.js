// Video sound and subtitle editor routes (flag_videoeditor, 0.4.19). Slice C3.
// The original video is only read. Preview and Export always write new files. Nothing is posted or sent.
import { flagOn } from "../flags.js";
import { resolveFfmpeg } from "../media-modify.js";
import {
  TRANSITIONS, LIMITS, listProjects, getProject, createProject, updateProject, removeProject, listSources, saveUpload,
  toSrt, importSrt, startRender, cancelRender, getRunJob, jobView, previewFile, resolveSrc, streamFile, totalLength,
} from "../video-editor.js";

export const id = "videoeditor";

const view = (p) => p && ({ ...p, length: totalLength(p) });

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/videoeditor\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (!flagOn("videoeditor")) return h.json(res, 404, { error: "The video editor is turned off on this install.", code: "flag_off" });
  const m = req.method;
  try {
    if (m === "GET" && seg[0] === "status" && !seg[1]) return h.json(res, 200, { ffmpeg: !!resolveFfmpeg(), transitions: TRANSITIONS, limits: LIMITS });
    if (m === "GET" && seg[0] === "sources" && !seg[1]) return h.json(res, 200, { items: listSources() });
    if (m === "POST" && seg[0] === "upload" && !seg[1]) return h.json(res, 200, saveUpload(body || {}));

    if (seg[0] === "projects") {
      if (!seg[1]) {
        if (m === "GET") return h.json(res, 200, { items: listProjects() });
        if (m === "POST") return h.json(res, 200, view(await createProject(body || {})));
      } else {
        const pid = seg[1];
        const sub = seg[2];
        if (!sub) {
          if (m === "GET") { const p = getProject(pid); return p ? h.json(res, 200, view(p)) : h.json(res, 404, { error: "That video project was not found.", code: "not_found" }); }
          if (m === "PUT") return h.json(res, 200, view(updateProject(pid, body || {})));
          if (m === "DELETE") return h.json(res, 200, removeProject(pid));
        }
        if (m === "GET" && (sub === "source" || sub === "preview.mp4")) {
          const p = getProject(pid);
          const file = !p ? null : sub === "source" ? resolveSrc(p.source) : previewFile(pid);
          if (!file) return h.json(res, 404, { error: "That video is not on this computer.", code: "missing" });
          streamFile(req, res, file);
          return true;
        }
        if (m === "GET" && sub === "srt") {
          const p = getProject(pid);
          if (!p) return h.json(res, 404, { error: "That video project was not found.", code: "not_found" });
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="subtitles.srt"', "x-content-type-options": "nosniff", "cache-control": "no-store" });
          res.end(toSrt(p.subtitles));
          return true;
        }
        if (m === "POST" && sub === "srt") return h.json(res, 200, view(importSrt(pid, body?.text, body?.mode === "append" ? "append" : "replace")));
        if (m === "POST" && (sub === "preview" || sub === "export")) {
          const job = startRender(pid, { preview: sub === "preview", from: Number(body?.from) || 0, length: Number(body?.length) || 0 });
          return h.json(res, 200, jobView(job));
        }
      }
    }
    if (seg[0] === "jobs" && seg[1]) {
      if (m === "GET" && !seg[2]) { const j = getRunJob(seg[1]); return j ? h.json(res, 200, jobView(j)) : h.json(res, 404, { error: "That render was not found.", code: "not_found" }); }
      if (m === "POST" && seg[2] === "cancel") return h.json(res, 200, jobView(cancelRender(seg[1])));
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code || "error", job: e.job });
  }
  return false;
}
