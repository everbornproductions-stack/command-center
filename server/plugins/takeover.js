// Multi-AI takeover and Owner tools (/api/takeover/*). Gated behind flag_takeover (default OFF).
// Looking is read-only. Every change needs { confirm: true } from a click. Owner routes need the owner tier.
import { takeoverOn } from "../flags.js";
import * as T from "../takeover.js";
import * as MCP from "../mcp.js";
import * as SCH from "../schedules.js";
import { submitBridgeJob } from "../meldmind-bridge.js";
import { cardView } from "../antigravity-cli.js";
import { publicState as routerState } from "../learn-tune.js";
import { readState as modelState } from "../model-watch.js";

export const id = "takeover";

function wire(h) {
  T.configure({
    listServers: () => MCP.listServers().filter((s) => s.id !== MCP.DEMO_SERVER_ID).map((s) => ({ id: s.id, name: s.name, enabled: s.enabled !== false })),
    connect: (sid) => MCP.connectServer(sid),
    tier: () => { try { return h.licenseState().tier; } catch { return "free"; } },
    listProjects: () => h.listProjects(),
    createSchedule: (input) => SCH.createSchedule(input),
    bridgeReady: () => { try { return !!cardView().ready; } catch { return false; } },
    bridgeSend: (job) => submitBridgeJob(job),
  });
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/takeover/, "") || "/";
  const on = takeoverOn(h.settings ? h.settings() : {});
  if (!on) return h.json(res, 403, { error: "Review and take over is turned off.", code: "flag_off", flag: T.FLAG_NAME });
  wire(h);
  const seg = p.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && (p === "/" || p === "/state")) {
      return h.json(res, 200, { enabled: true, owner: T.isOwner(), review: T.reviewView() });
    }
    if (req.method === "POST" && p === "/look") return h.json(res, 200, await T.lookForTasks({ serverIds: Array.isArray(body?.serverIds) ? body.serverIds : undefined }));
    if (req.method === "POST" && p === "/import") return h.json(res, 200, T.importExport({ text: body?.text, label: body?.label }));
    if (req.method === "POST" && seg[0] === "task" && seg[2] === "dismiss") return h.json(res, 200, T.dismissTask(seg[1]));
    if (req.method === "POST" && seg[0] === "task" && seg[2] === "take") return h.json(res, 200, T.takeOver(seg[1], { confirm: body?.confirm, cron: body?.cron }));
    if (req.method === "POST" && seg[0] === "task" && seg[2] === "pause-original") return h.json(res, 200, await T.pauseOriginal(seg[1], { confirm: body?.confirm }));
    if (req.method === "GET" && seg[0] === "mirror" && seg[1]) return h.json(res, 200, await T.mirrorPreview(decodeURIComponent(seg[1])));
    if (req.method === "POST" && seg[0] === "mirror" && seg[1]) return h.json(res, 200, await T.mirrorPush(decodeURIComponent(seg[1]), { kind: body?.kind, id: body?.id, confirm: body?.confirm }));
    if (seg[0] === "owner") {
      if (!T.isOwner()) return h.json(res, 403, { error: "Owner tools are for the owner account.", code: "owner_only" });
      if (req.method === "GET" && seg.length === 1) {
        return h.json(res, 200, T.ownerView({
          routing: () => routerState(),
          models: () => modelState(h),
          toolLog: () => MCP.recentCalls(20),
        }));
      }
      if (req.method === "POST" && seg[1] === "change") return h.json(res, 200, T.ownerChange(body?.patch, { confirm: body?.confirm }));
      if (req.method === "POST" && seg[1] === "undo") return h.json(res, 200, T.ownerUndo({ confirm: body?.confirm }));
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code || "error" });
  }
  return false;
}
