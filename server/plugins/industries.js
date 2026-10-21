// Phase 62. Industry packs under /api/industries. Filling orders does not run a model.
import { access, gate } from "../feature-gate.js";
import { listPacks, fillPrompt } from "../industry-packs.js";

export const id = "industries";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/industries/, "") || "/";
  if (req.method === "GET" && (p === "" || p === "/")) {
    const row = access("industryPacks");
    return h.json(res, 200, {
      open: row.ok,
      tier: row.tier,
      message: row.ok ? "Picking a prompt fills Marching orders. Nothing runs until you send it." : row.message,
      packs: listPacks({ open: row.ok }),
    });
  }
  if (req.method === "POST" && p === "/fill") {
    gate("industryPacks");
    const filled = fillPrompt(String(body?.id || ""), body?.inputs || {});
    return h.json(res, 200, { ...filled, sent: false });
  }
  return false;
}
