// Memory per project: brand voice, offers, never-say list, past winners. The server injects it into every
// prompt for that project (server/project-memory.js) so the first answer already sounds like you.
// Can import from the Everborn HQ client files (local mode only).
import { HQ_DIR } from "../paths.js";
import { contextFor, memoryOf, saveMemory, importHq, addWinner, FIELDS } from "../project-memory.js";
export const id = "memory";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/memory/, "");
  const known = (pid) => h.listProjects().some((x) => x.id === pid);
  if (req.method === "GET" && p === "/context") return h.json(res, 200, { context: contextFor(url.searchParams.get("projectId")) });
  if (req.method === "GET" && p === "/summary") {
    // which projects carry memory and how many sections each, for the project pages and the Command badge
    const out = {};
    for (const pr of h.listProjects()) { const m = memoryOf(pr.id); const n = FIELDS.filter((f) => typeof m[f] === "string" && m[f].trim()).length; if (n) out[pr.id] = { sections: n, updatedAt: m.updatedAt || null }; }
    return h.json(res, 200, out);
  }
  if (req.method === "GET" && p.startsWith("/project/")) { const { importedText, ...m } = memoryOf(decodeURIComponent(p.slice("/project/".length))); return h.json(res, 200, m); }
  if (req.method === "POST" && p.startsWith("/project/")) {
    const pid = decodeURIComponent(p.slice("/project/".length));
    if (!known(pid)) return h.json(res, 404, { error: "project not found" });
    const { importedText, ...cur } = saveMemory(pid, body);
    h.emit("log", { text: `Project memory updated for ${pid}.` });
    return h.json(res, 200, cur);
  }
  if (req.method === "POST" && p === "/winner") {
    // "Keep as a past winner" under a rated result: one short line into the project's winners
    if (!known(body.projectId)) return h.json(res, 404, { error: "project not found" });
    const line = String(body.text || "").trim();
    if (!line) return h.json(res, 400, { error: "text required" });
    const { importedText, ...cur } = addWinner(body.projectId, line);
    h.emit("log", { text: `Past winner saved to project memory for ${body.projectId}.` });
    return h.json(res, 200, cur);
  }
  if (req.method === "POST" && p === "/import-hq") {
    if (h.HOSTED) return h.json(res, 400, { error: "HQ import is available in local mode only" });
    if (!HQ_DIR) return h.json(res, 404, { error: "No HQ folder is connected (set CC_HQ_DIR)." });
    try {
      const { importedText, ...out } = importHq(HQ_DIR, body.projectId);
      h.emit("log", { text: `Project memory imported from ${out.importedFrom.join(", ")} for ${body.projectId}.` });
      return h.json(res, 200, out);
    } catch (e) { return h.json(res, e.status || 500, { error: e.message }); }
  }
  return false;
}
