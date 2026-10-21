// Local bridge for the Meldmind MCP server, and the confirm step that
// writes ~/.gemini/config/mcp_config.json. Job routes require the bridge
// token. The config routes stay on the normal session token.
import { bridgeAuthorized, listBridgeAgents, submitBridgeJob, getBridgeJob, previewMcpAdd, writeMcpConfig, scriptPath } from "../meldmind-bridge.js";
import { acceptUsageReport } from "../credit-tracker.js";

export const id = "bridge";

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/bridge\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  const opts = {
    home: process.env.CC_MCP_HOME || undefined,
    script: scriptPath(),
    port: Number(process.env.PORT || process.env.CC_PORT || 4747),
  };
  if ((seg[0] === "agents" || seg[0] === "jobs" || seg[0] === "usage") && !bridgeAuthorized(req.headers["x-meldmind-bridge"])) {
    return h.json(res, 401, { error: "This bridge only answers the Meldmind app on this computer." });
  }
  if (m === "GET" && seg[0] === "agents" && !seg[1]) return h.json(res, 200, { agents: listBridgeAgents() });
  if (m === "GET" && seg[0] === "jobs" && seg[1] && !seg[2]) {
    const job = getBridgeJob(decodeURIComponent(seg[1]));
    if (!job) return h.json(res, 404, { error: "No such job." });
    return h.json(res, 200, { job });
  }
  if (m === "POST" && seg[0] === "jobs" && !seg[1]) {
    try {
      const job = await submitBridgeJob(body || {});
      return h.json(res, 200, { job });
    } catch (e) {
      return h.json(res, e.status || 500, { error: e.message || "Could not queue that." });
    }
  }
  // report_usage from the Meldmind MCP tool: credits an agent spent outside Meldmind
  if (m === "POST" && seg[0] === "usage" && !seg[1]) {
    try {
      const b = body || {};
      return h.json(res, 200, acceptUsageReport({ provider: b.provider, credits_spent: b.credits_spent, note: b.note, report_id: b.report_id, by: String(b.by || "An agent via MCP").slice(0, 60) }));
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message });
    }
  }
  if (m === "GET" && seg[0] === "mcp" && !seg[1]) return h.json(res, 200, previewMcpAdd(opts));
  if (m === "POST" && seg[0] === "mcp" && !seg[1]) {
    const out = writeMcpConfig({ ...opts, confirm: body?.confirm === true });
    return h.json(res, out.ok ? 200 : 400, out);
  }
  return false;
}
