// Dogfood fixes (0.4.21): the routes behind the new result card.
//   GET  /api/dogfood/preflight?goal=...        which image / video / voice AI a job needs and whether it can be made now
//   GET  /api/dogfood/file?mission=<id>         the file a mission saved (text for the preview pane) or why it was not saved
//   POST /api/dogfood/file/open { mission, dryRun }   show the saved file in the system's own program
//   POST /api/dogfood/overlay { jobId|imageId, i, text, position, projectId }   a headline on a picture, a real PNG in MindMedia
//   POST /api/dogfood/overlay/save { dataUrl, name, projectId, text }          a PNG the page drew with its canvas, saved
//   POST /api/dogfood/retry { id }             run a finished or incomplete mission again, skipping the AIs that failed it
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { preflight, neededMedia } from "../media-preflight.js";
import { readSavedFile } from "../named-file.js";
import { overlayPng, dataUrlToPng, isPng, decodePng } from "../overlay.js";
import { projectMediaDir, outputFile, getJob, addOutput } from "../media-jobs.js";
import { imageFile } from "../images.js";
import { saveToMindMedia } from "../project-media.js";
import { cleanSkip } from "../desk.js";
import { ctx } from "../store.js";

export const id = "dogfood";

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const safeName = (n, d = "picture") => String(n || d).replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "").slice(0, 60) || d;

// where a headline picture comes from: a media job's file, a gallery image, or a PNG the page sent
export function sourceBytes(b) {
  if (b.jobId) {
    const f = outputFile(String(b.jobId), b.i);
    if (!f) throw fail(404, "That picture is not saved on this PC.", "no_file");
    return { bytes: fs.readFileSync(f), projectId: getJob(String(b.jobId))?.projectId || null, jobId: String(b.jobId), dir: path.dirname(f) };
  }
  if (b.imageId) {
    const f = imageFile(String(b.imageId), b.index ?? b.i);
    return { bytes: f.bytes, projectId: b.projectId || null, mime: f.mime };
  }
  if (b.dataUrl) return { bytes: dataUrlToPng(b.dataUrl), projectId: b.projectId || null };
  throw fail(400, "Pick the picture to put the headline on.", "no_source");
}

export function saveOverlay({ png, projectId, name, text, source = "Headline" }) {
  const pid = String(projectId || "") || "unfiled";
  const dir = projectMediaDir(pid);
  let file = path.join(dir, `${safeName(name, "headline")}.png`);
  for (let n = 2; fs.existsSync(file) && n < 200; n++) file = path.join(dir, `${safeName(name, "headline")}-${n}.png`);
  fs.writeFileSync(file, png);
  let saved = null;
  try { saved = saveToMindMedia({ files: [{ name: path.basename(file), path: file, mime: "image/png" }], projectId: pid, source, status: "Draft", kind: "image", prompt: text }); } catch { /* the PNG is saved; the MindMedia item is a bonus */ }
  const dim = decodePngSize(png);
  return { ok: true, name: path.basename(file), path: file, bytes: png.length, w: dim.w, h: dim.h, projectId: pid, assetId: saved?.items?.[0]?.id || null, where: saved?.where || null };
}
function decodePngSize(png) { return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) }; }

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/dogfood/, "") || "/";
  try {
    if (req.method === "GET" && p === "/preflight") {
      const goal = url.searchParams.get("goal") || "";
      const kinds = (url.searchParams.get("kinds") || "").split(",").filter(Boolean);
      return h.json(res, 200, preflight(goal, { kinds }));
    }
    if (req.method === "POST" && p === "/preflight") return h.json(res, 200, preflight(String(body?.goal || ""), { kinds: Array.isArray(body?.kinds) ? body.kinds : [] }));
    if (req.method === "GET" && p === "/file") {
      const m = await ctx().store.getMission(String(url.searchParams.get("mission") || "").replace(/[^a-z0-9-]/gi, ""));
      if (!m) throw fail(404, "That run was not found.");
      const f = m.savedFile;
      if (!f) return h.json(res, 200, { ok: false, saved: false, error: "This run did not name a file." });
      if (!f.ok) return h.json(res, 200, { ok: false, saved: false, name: f.name, error: f.error });
      const text = readSavedFile(f);
      if (text == null) return h.json(res, 200, { ok: false, saved: false, name: f.name, error: `Not saved: ${f.name} is no longer in the project folder.` });
      return h.json(res, 200, { ok: true, saved: true, name: f.name, path: f.path, bytes: f.bytes, ext: f.ext, previewable: !!f.previewable, text });
    }
    if (req.method === "POST" && p === "/file/open") {
      const m = await ctx().store.getMission(String(body?.mission || "").replace(/[^a-z0-9-]/gi, ""));
      const f = m?.savedFile;
      if (!f?.ok || readSavedFile(f) == null) throw fail(404, "There is no saved file to open.");
      if (h.HOSTED) throw fail(400, "Opening a file works in the desktop app only.");
      const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
      if (!body?.dryRun) execFile(cmd, [f.path], () => {});
      return h.json(res, 200, { ok: true, dryRun: !!body?.dryRun, path: f.path });
    }
    if (req.method === "POST" && p === "/overlay") {
      const text = String(body?.text || "").trim();
      if (!text) throw fail(400, "Write the headline to put on the picture.", "no_text");
      const src = sourceBytes(body || {});
      if (!isPng(src.bytes)) throw fail(422, "This picture is not a PNG. Use the picture editor to add the headline.", "not_png");
      const r = overlayPng(src.bytes, text, { position: body.position, color: body.color });
      const out = saveOverlay({ png: r.png, projectId: body.projectId || src.projectId, name: body.name || "headline", text });
      if (src.jobId) { try { addOutput(src.jobId, out.path); } catch { /* the file is saved either way */ } }
      h.emit("log", { text: `Headline added to a picture: ${out.name}.` });
      return h.json(res, 200, { ...out, lines: r.lines });
    }
    if (req.method === "POST" && p === "/overlay/save") {
      const png = dataUrlToPng(body?.dataUrl);
      decodePngSize(png);
      const out = saveOverlay({ png, projectId: body?.projectId, name: body?.name || "headline", text: body?.text });
      return h.json(res, 200, out);
    }
    if (req.method === "POST" && p === "/retry") {
      const m = await ctx().store.getMission(String(body?.id || "").replace(/[^a-z0-9-]/gi, ""));
      if (!m || m.kind !== "mission") throw fail(404, "That run was not found.");
      const avoid = cleanSkip([...(m.incomplete?.retryAvoid || []), ...(Array.isArray(body?.skip) ? body.skip : [])]);
      const opts = { goal: m.prompt, mode: m.mode || "balanced", projectId: m.projectId || undefined, qa: m.qa !== false, budgetUsd: m.budgetUsd ?? 2, skip: avoid, private: !!m.private };
      const run = h.runMission(opts);
      run.catch((e) => h.emit("log", { text: `Mission failed: ${e.message}`, level: "error" }));
      return h.json(res, 202, { ok: true, skipped: avoid });
    }
  } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code }); }
  return false;
}
export { neededMedia };
