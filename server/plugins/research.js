// Deep Research routes: start a background run, export the report, continue it as a mission.
// Continuing as a mission is a click. Nothing is sent or posted from here.
import { abortResearch, beginDeep, loadResearch, exportReport } from "../research.js";
import { safeFileName } from "../research-export.js";
import { researchSnapshot } from "../feature-gate.js";
import { normalizeFilter } from "../search.js";

export const id = "research";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/research/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, { research: researchSnapshot() });

  if (req.method === "POST" && p === "/deep") {
    try {
      const job = beginDeep({ prompt: body.prompt || body.goal, filter: body.filter, projectId: body.projectId });
      return h.json(res, 202, { ok: true, id: job.id, runId: job.id });
    } catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
  }

  const stop = p.match(/^\/(r-[a-z0-9]+)\/abort$/);
  if (req.method === "POST" && stop) {
    const m = await loadResearch(stop[1]);
    if (!m || m.kind !== "research") return h.json(res, 404, { error: "not found" });
    if (!abortResearch(m.id)) return h.json(res, 409, { error: "That research run is not running.", status: m.status });
    return h.json(res, 200, { ok: true, aborted: true, id: m.id });
  }

  const exp = p.match(/^\/(r-[a-z0-9]+)\/export$/);
  if (req.method === "GET" && exp) {
    const m = await loadResearch(exp[1]);
    if (!m) return h.json(res, 404, { error: "not found" });
    if (m.status !== "done") return h.json(res, 409, { error: "The report is not ready yet." });
    try {
      const format = url.searchParams.get("format") === "docx" ? "docx" : "pdf";
      const file = exportReport(m, format);
      const name = safeFileName(m.title, file.ext);
      res.writeHead(200, {
        "content-type": file.type,
        "content-disposition": `attachment; filename="${name}"`,
        "content-length": file.bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(file.bytes);
      return true;
    } catch (e) { return h.json(res, e.status || 500, { error: e.message }); }
  }

  const cont = p.match(/^\/(r-[a-z0-9]+)\/mission$/);
  if (req.method === "POST" && cont) {
    const m = await loadResearch(cont[1]);
    if (!m) return h.json(res, 404, { error: "not found" });
    try { h.requireFeature("missions"); }
    catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
    const sources = (m.sources || []).map((s) => `[${s.n}] ${s.title} ${s.url}`).join("\n");
    const context = `Research report:\n${String(m.deliverable || "").slice(0, 6000)}\n\nSources:\n${sources}`.slice(0, 8000);
    const goal = `Continue this research as a mission: ${m.title}`;
    const promise = h.runMission({ goal, context, projectId: m.projectId || body.projectId || null, qa: body.qa !== false, mode: "balanced", search: true, filter: normalizeFilter(m.filter) });
    promise.catch((e) => h.emit("log", { text: `Mission failed: ${e.message}`, level: "error" }));
    h.emit("log", { text: `Research "${m.title}" continues as a mission. The browser helper and desktop steps can take it from here.` });
    return h.json(res, 202, { ok: true, from: m.id });
  }

  const one = p.match(/^\/(r-[a-z0-9]+)$/);
  if (req.method === "GET" && one) {
    const m = await loadResearch(one[1]);
    if (!m) return h.json(res, 404, { error: "not found" });
    const { reads, ...rest } = m;
    return h.json(res, 200, { ...rest, reads: (reads || []).map(({ text, ...r }) => r) });
  }
  return false;
}
