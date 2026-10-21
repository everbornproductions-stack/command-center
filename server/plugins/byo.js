// Your apps: HighLevel tools, an MCP server by URL, and custom webhooks.
// Routes: /api/byo. Sending stays in server/byo.js and only runs on a click.
import { publicState, addHook, removeHook, prepareHook, runHook, addByoMcp, removeByoMcp, runHighLevel, prepareHighLevel, confirmPending, registerByoTools, scrub } from "../byo.js";

export const id = "byo";

export function init() {
  registerByoTools();
}

export async function routes(req, res, url, body, h) {
  const seg = url.pathname.replace(/^\/api\/byo\/?/, "").split("/").filter(Boolean);
  const method = req.method;
  try {
    if (method === "GET" && !seg.length) return h.json(res, 200, publicState());
    if (method === "POST" && seg[0] === "hooks" && seg.length === 1) return h.json(res, 200, await addHook(body || {}));
    if (method === "DELETE" && seg[0] === "hooks" && seg[1] && seg.length === 2) return h.json(res, 200, await removeHook(decodeURIComponent(seg[1])));
    if (method === "POST" && seg[0] === "hooks" && seg[1] && seg[2] === "prepare") return h.json(res, 200, prepareHook(decodeURIComponent(seg[1]), body?.args));
    if (method === "POST" && seg[0] === "hooks" && seg[1] && seg[2] === "run") return h.json(res, 200, await runHook(decodeURIComponent(seg[1]), body?.args));
    if (method === "POST" && seg[0] === "mcp" && seg.length === 1) return h.json(res, 200, await addByoMcp(body || {}));
    if (method === "DELETE" && seg[0] === "mcp" && seg[1] && seg.length === 2) return h.json(res, 200, await removeByoMcp(decodeURIComponent(seg[1])));
    if (method === "POST" && seg[0] === "highlevel" && seg[1] === "run") return h.json(res, 200, await runHighLevel(body?.tool));
    if (method === "POST" && seg[0] === "highlevel" && seg[1] === "prepare") return h.json(res, 200, await prepareHighLevel(body?.tool, body?.args));
    if (method === "POST" && seg[0] === "confirm" && seg.length === 1) return h.json(res, 200, await confirmPending(body?.id));
  } catch (e) {
    return h.json(res, e.status || 500, { error: scrub(e.message, []), code: e.code });
  }
  return false;
}
