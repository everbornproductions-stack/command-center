// Phase 58. POST /api/opinion starts two answers. Nothing is sent anywhere.
import { assertOpinionReady, runSecondOpinion } from "../second-opinion.js";
import { access } from "../feature-gate.js";

export const id = "opinion";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/opinion/, "") || "/";
  if (req.method === "GET" && (p === "" || p === "/")) {
    const row = access("secondOpinion");
    return h.json(res, 200, { id: "opinion", label: "Second opinion", open: row.ok, tier: row.tier });
  }
  if (req.method !== "POST" || (p !== "" && p !== "/")) return false;
  const prompt = String(body?.prompt || "").trim();
  if (!prompt) return h.json(res, 400, { error: "prompt required" });
  assertOpinionReady(prompt);
  const runId = body.runId || ("op-" + Date.now().toString(36));
  runSecondOpinion({ id: runId, prompt, projectId: body.projectId || null }).catch((e) => {
    h.emit("log", { text: `Second opinion failed: ${e.message}`, level: "error" });
  });
  return h.json(res, 202, { ok: true, runId });
}
