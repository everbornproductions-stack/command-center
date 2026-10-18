// Memory per project: brand voice, offers, never-say list, past winners. Injected into prompts for
// that project so the first answer already sounds like you. Can import from the Everborn HQ client files.
import fs from "node:fs";
import path from "node:path";
export const id = "memory";
const KIND = "memory.projects"; // { [projectId]: { voice, offers, never, winners, facts, updatedAt } }

const FIELDS = ["voice", "offers", "never", "winners", "facts"];
const LABELS = { voice: "Brand voice", offers: "Offers and calls to action", never: "Never say / never do", winners: "Past winners (what worked)", facts: "Facts to keep straight" };

export function contextFor(h, projectId) {
  if (!projectId) return "";
  const m = h.doc(KIND, () => ({}))[projectId];
  if (!m) return "";
  const parts = FIELDS.filter((f) => m[f]?.trim()).map((f) => `${LABELS[f].toUpperCase()}:\n${m[f].trim()}`);
  if (!parts.length) return "";
  const proj = h.listProjects().find((p) => p.id === projectId);
  return `PROJECT MEMORY for ${proj?.name || projectId} (follow this; it overrides generic defaults):\n${parts.join("\n\n")}`;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/memory/, "");
  if (req.method === "GET" && p === "/context") return h.json(res, 200, { context: contextFor(h, url.searchParams.get("projectId")) });
  if (req.method === "GET" && p.startsWith("/project/")) return h.json(res, 200, h.doc(KIND, () => ({}))[p.slice("/project/".length)] || {});
  if (req.method === "POST" && p.startsWith("/project/")) {
    const pid = p.slice("/project/".length);
    const d = h.doc(KIND, () => ({}));
    const cur = d[pid] || {};
    for (const f of FIELDS) if (typeof body[f] === "string") cur[f] = body[f].slice(0, 4000);
    cur.updatedAt = Date.now();
    d[pid] = cur;
    h.putDoc(KIND, d);
    h.emit("log", { text: `Project memory updated for ${pid}.` });
    return h.json(res, 200, cur);
  }
  if (req.method === "POST" && p === "/import-hq") {
    // read company/clients/<slug>.md and company/everborn.md from the HQ folder into "facts" (local mode only)
    if (h.HOSTED) return h.json(res, 400, { error: "HQ import is available in local mode only" });
    const hq = process.env.CC_HQ_DIR || path.resolve(h.DATA_DIR, "..", "..");
    const pid = body.projectId; const proj = h.listProjects().find((x) => x.id === pid);
    if (!proj) return h.json(res, 404, { error: "project not found" });
    const candidates = [path.join(hq, "company", "clients", `${proj.hqClient || pid}.md`), pid === "everborn" || proj.hqClient === "everborn" ? path.join(hq, "company", "everborn.md") : null].filter(Boolean);
    const found = candidates.filter((f) => fs.existsSync(f));
    if (!found.length) return h.json(res, 404, { error: `No HQ file for this project (looked for ${candidates.map((c) => path.basename(c)).join(", ")})` });
    const text = found.map((f) => fs.readFileSync(f, "utf8")).join("\n\n").slice(0, 4000);
    const d = h.doc(KIND, () => ({}));
    d[pid] = { ...(d[pid] || {}), facts: text, updatedAt: Date.now(), importedFrom: found.map((f) => path.basename(f)) };
    h.putDoc(KIND, d);
    return h.json(res, 200, d[pid]);
  }
  return false;
}
