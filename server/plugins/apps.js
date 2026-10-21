// Routes for Zapier, Make, any MCP server by URL, and custom webhook tools.
// The inbound webhook lives in server/inbound.js and does not use the session token.
import { appsView, connectionView, connectZapier, connectMake, connectMcp, addWebhook, removeConnection, refreshConnection, callWebhookNow, readTemplate, createInboundToken, clearInboundToken, GUIDE } from "../apps.js";
import { setStarters } from "../inbound.js";

export const id = "apps";

export function init(h) {
  setStarters({ runChat: h.runChat, runCouncil: h.runCouncil, runMission: h.runMission });
}

const fail = (res, h, e) => h.json(res, e.status || 500, { error: e.message, code: e.code || "apps" });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/apps/, "").replace(/\/$/, "");
  const method = req.method;
  const seg = p.split("/").filter(Boolean);

  if (method === "GET" && !seg.length) return h.json(res, 200, appsView());
  if (method === "GET" && p === "/template") return h.json(res, 200, { template: readTemplate(), guide: GUIDE });

  if (method === "POST" && p === "/zapier") {
    try {
      const r = await connectZapier(body || {});
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: connectionView(r.row), view: appsView() });
    } catch (e) { return fail(res, h, e); }
  }
  if (method === "POST" && p === "/make") {
    try {
      const r = await connectMake(body || {});
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: connectionView(r.row), view: appsView() });
    } catch (e) { return fail(res, h, e); }
  }
  if (method === "POST" && p === "/mcp") {
    try {
      const r = await connectMcp(body || {});
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: connectionView(r.row), view: appsView() });
    } catch (e) { return fail(res, h, e); }
  }
  if (method === "POST" && p === "/webhook") {
    try {
      const r = await addWebhook(body || {});
      return h.json(res, 200, { ok: true, connection: connectionView(r.row), view: appsView() });
    } catch (e) { return fail(res, h, e); }
  }
  if (method === "POST" && p === "/inbound") {
    try { return h.json(res, 200, { ok: true, ...createInboundToken(), view: appsView() }); }
    catch (e) { return fail(res, h, e); }
  }
  if (method === "DELETE" && p === "/inbound") {
    try { return h.json(res, 200, { ok: true, inbound: clearInboundToken(), view: appsView() }); }
    catch (e) { return fail(res, h, e); }
  }

  if (seg.length === 1 && method === "DELETE") {
    try { return h.json(res, 200, await removeConnection(decodeURIComponent(seg[0]))); }
    catch (e) { return fail(res, h, e); }
  }
  if (seg.length === 2 && seg[1] === "refresh" && method === "POST") {
    try {
      const r = await refreshConnection(decodeURIComponent(seg[0]));
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: connectionView(r.row), view: appsView() });
    } catch (e) { return fail(res, h, e); }
  }
  if (seg.length === 2 && seg[1] === "call" && method === "POST") {
    try {
      const r = await callWebhookNow(decodeURIComponent(seg[0]), body?.args || {});
      return h.json(res, 200, { ok: !r.isError, text: String(r.text || "").slice(0, 4000), denied: !!r.denied, ms: r.ms });
    } catch (e) { return fail(res, h, e); }
  }
  return false;
}
