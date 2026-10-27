// Safety check routes: the local scan that runs before Publish and before a download (server/safety-check.js).
// Free, built in, and nothing leaves the PC.
//   POST /api/safety/check  { projectId | files: [{path,text}] | text + name }  -> the result (light, groups, ignored, summary)
//   POST /api/safety/fix    { projectId | files, fixId: secrets|csp|https|all }
//                            projectId: patched files are written into the project folder, then rescanned
//                            files:     patched texts come back, nothing is written
//   GET  /api/safety/last?projectId=  the last result for a project, so Publish can read it
//   GET  /api/safety/status           { enabled }  (Settings > "Safety check before publish", on by default)
// The last result per project is kept in the "safety.last" doc (light, plain summary, grouped issues; secret
// values are never in it, only first 3 characters + ****).
import fs from "node:fs";
import path from "node:path";
import { runSafetyCheck, applySafetyFix, loadFiles, lightOf } from "../safety-check.js";

export const id = "safety";
const LAST = "safety.last", KEEP = 200;
const RANK = { green: 0, amber: 1, red: 2 };

const safeId = (p) => String(p || "").replace(/[^a-z0-9-_]/gi, "_");
const projectDir = (h, projectId) => (h.DATA_DIR && projectId ? path.join(h.DATA_DIR, "projects", safeId(projectId)) : null);
export const enabled = (h) => h.settings?.().safetyCheck !== false;

export function lastFor(h, projectId) {
  if (!projectId) return null;
  return h.doc(LAST, () => ({}))[String(projectId)] || null;
}
function remember(h, projectId, result) {
  if (!projectId) return;
  const d = h.doc(LAST, () => ({}));
  d[String(projectId)] = { ...lightOf(result), result };
  const keys = Object.keys(d);
  if (keys.length > KEEP) for (const k of keys.sort((a, b) => String(d[a].checkedAt).localeCompare(String(d[b].checkedAt))).slice(0, keys.length - KEEP)) delete d[k];
  h.putDoc(LAST, d);
}

// For the Publish preview: the words about to be posted are scanned too, and the project's last check is read.
// Returns null when the person turned the check off.
export function gateForPost(h, { title, text, projectId } = {}) {
  if (!enabled(h)) return null;
  const now = runSafetyCheck({ files: [{ path: "post.txt", text: `${title || ""}\n${text || ""}` }] });
  const last = lastFor(h, projectId);
  const worst = last && RANK[last.light] > RANK[now.light] ? last : lightOf(now);
  return { light: worst.light, summary: worst.summary, hasLive: !!(now.hasLive || last?.hasLive), checkedAt: worst.checkedAt };
}

function inputFiles(h, body) {
  if (Array.isArray(body?.files)) return { files: body.files.slice(0, 600).map((f) => ({ path: String(f?.path || ""), text: String(f?.text ?? "") })) };
  if (typeof body?.text === "string") return { files: [{ path: String(body.name || "result.html").replace(/[^\w.\-/]+/g, "_").slice(0, 80), text: body.text }] };
  if (body?.projectId) {
    if (h.HOSTED) return { error: "Project folders are not available here." };
    const dir = projectDir(h, body.projectId);
    return { dir, files: dir && fs.existsSync(dir) ? loadFiles(dir) : [] };
  }
  return { error: "Send a projectId, files, or text to check." };
}

function writeBack(dir, changed) {
  const root = path.resolve(dir);
  for (const f of changed) {
    const target = path.resolve(root, f.path);
    if (target !== root && !target.startsWith(root + path.sep)) throw Object.assign(new Error("That file is outside the project."), { status: 400 });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.safety-tmp`;
    fs.writeFileSync(tmp, f.text, "utf8");
    fs.renameSync(tmp, target);
  }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/safety/, "");
  if (req.method === "GET" && p === "/status") return h.json(res, 200, { enabled: enabled(h) });
  if (req.method === "GET" && p === "/last") return h.json(res, 200, lastFor(h, url.searchParams.get("projectId")) || { light: null });
  if (req.method === "POST" && p === "/check") {
    const src = inputFiles(h, body);
    if (src.error) return h.json(res, 400, { error: src.error });
    const result = runSafetyCheck({ files: src.files });
    remember(h, body.projectId, result);
    return h.json(res, 200, result);
  }
  if (req.method === "POST" && p === "/fix") {
    const src = inputFiles(h, body);
    if (src.error) return h.json(res, 400, { error: src.error });
    const fixId = ["secrets", "csp", "https", "all"].includes(body.fixId) ? body.fixId : "all";
    const out = applySafetyFix({ files: src.files, fixId });
    let written = false;
    if (src.dir && out.changed.length) { writeBack(src.dir, out.changed); written = true; }
    remember(h, body.projectId, out.result);
    return h.json(res, 200, {
      message: out.message, left: out.left, fixed: out.fixed, note: out.note || "", result: out.result, written,
      changed: out.changed.map((c) => c.path),
      // only files sent by the page come back as text; a project folder was already written
      ...(src.dir ? {} : { files: out.changed }),
    });
  }
  return false;
}
