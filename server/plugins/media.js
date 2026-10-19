// Media actions (R2): the routes behind the Media tab. The job engine is server/media-jobs.js (also used by
// the media steps of a mission). Estimate first; a job that spends needs a click that repeats the estimate
// (Generate here, or Approve on a waiting mission step). Without a key a job is a dry run with a placeholder.
import fs from "node:fs";
import path from "node:path";
import * as M from "../media-jobs.js";
import * as elevenlabs from "../media/elevenlabs.js";

export const id = "media";
let H = null;
export async function init(h) { H = h; }

const TYPES = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav" };

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/media/, "");
  const seg = p.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && p === "/providers") return h.json(res, 200, Object.values(M.ADAPTERS).map((a) => ({ id: a.id, name: a.name, kinds: a.kinds, defaults: a.defaults, price: a.price, keyed: M.keyed(a.id), connected: M.ready(a.id), both: M.both(a.id) })));
    if (req.method === "POST" && p === "/estimate") return h.json(res, 200, M.estimate({ provider: body.provider, kind: body.kind, params: body.params }));
    // the Media tab's Generate: the click that spends, carrying the estimate it showed
    if (req.method === "POST" && p === "/generate") {
      const job = M.createJob({ provider: body.provider, kind: body.kind, params: body.params, projectId: body.projectId, missionId: body.missionId, approve: true, estimate: body.estimate, origin: "media" });
      return h.json(res, 202, M.publicJob(job));
    }
    if (req.method === "GET" && p === "/jobs") return h.json(res, 200, M.listJobs({ projectId: url.searchParams.get("projectId") || undefined, missionId: url.searchParams.get("missionId") || undefined }).map(M.publicJob));
    if (req.method === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "approve") return h.json(res, 202, M.publicJob(M.approveJob(seg[1], body.estimate)));
    if (req.method === "POST" && seg[0] === "jobs" && seg[1] && seg[2] === "decline") return h.json(res, 200, M.publicJob(M.declineJob(seg[1])));
    // a saved output, served with the session token only; never run as a page
    if (req.method === "GET" && p === "/file") {
      const f = M.outputFile(url.searchParams.get("id"), url.searchParams.get("i"));
      if (!f) return h.json(res, 404, { error: "No such file." });
      res.writeHead(200, { "content-type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
      return true;
    }
    if (req.method === "POST" && p === "/keys") {
      const pid = body.provider; if (!M.ADAPTERS[pid]) return h.json(res, 400, { error: "unknown media provider" });
      await h.setSecret(pid, pid === "kling" ? { key: body.key, secret: body.secret } : body.key);
      let bal = null; try { bal = await M.ADAPTERS[pid].balance?.(M.secretOf(pid)); } catch {}
      return h.json(res, 200, { ok: true, balance: bal });
    }
    if (req.method === "GET" && p === "/voices") { const s = M.secretOf("elevenlabs"); if (!s?.key) return h.json(res, 200, []); return h.json(res, 200, await elevenlabs.voices(s)); }
    if (req.method === "POST" && p === "/open") {
      if (h.HOSTED) return h.json(res, 400, { error: "local only" });
      const f = M.outputFile(body.id, body.i);
      if (!f) return h.json(res, 400, { error: "No such file in the data folder." });
      const { execFile } = await import("node:child_process");
      if (process.platform === "win32") execFile("explorer", [`/select,${f}`]); else execFile("open", ["-R", f]);
      return h.json(res, 200, { ok: true });
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, estimate: e.estimate });
  }
  return false;
}
