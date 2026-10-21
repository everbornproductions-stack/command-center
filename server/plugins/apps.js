// Desktop programs on this PC, plus Zapier, Make, MCP by URL, and webhook tools.
// A hosted hub does not scan programs. Connections still answer.
import { HOSTED } from "../store.js";
import * as Apps from "../apps.js";
import { setStarters } from "../inbound.js";

export const id = "apps";

export function init(h) {
  if (!HOSTED) Apps.installAppRoutes();
  setStarters({ runChat: h.runChat, runCouncil: h.runCouncil, runMission: h.runMission });
}

const fail = (res, h, e) => h.json(res, e.status || 500, { error: e.message, code: e.code || "apps" });

function both() {
  return { ...Apps.publicState(), ...Apps.appsView() };
}

export async function routes(req, res, url, body, h) {
  const raw = url.pathname.replace(/^\/api\/apps/, "");
  const p = raw.replace(/\/$/, "") || "/";
  const m = req.method;
  const seg = p === "/" ? [] : p.split("/").filter(Boolean);

  if (m === "GET" && (p === "/" || p === "")) return h.json(res, 200, both());
  if (m === "GET" && p === "/template") return h.json(res, 200, { template: Apps.readTemplate(), guide: Apps.GUIDE });

  if (m === "POST" && p === "/zapier") {
    try {
      const r = await Apps.connectZapier(body || {});
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: Apps.connectionView(r.row), view: both() });
    } catch (e) { return fail(res, h, e); }
  }
  if (m === "POST" && p === "/make") {
    try {
      const r = await Apps.connectMake(body || {});
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: Apps.connectionView(r.row), view: both() });
    } catch (e) { return fail(res, h, e); }
  }
  if (m === "POST" && p === "/mcp") {
    try {
      const r = await Apps.connectMcp(body || {});
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: Apps.connectionView(r.row), view: both() });
    } catch (e) { return fail(res, h, e); }
  }
  if (m === "POST" && p === "/webhook") {
    try {
      const r = await Apps.addWebhook(body || {});
      return h.json(res, 200, { ok: true, connection: Apps.connectionView(r.row), view: both() });
    } catch (e) { return fail(res, h, e); }
  }
  if (m === "POST" && p === "/inbound") {
    try { return h.json(res, 200, { ok: true, ...Apps.createInboundToken(), view: both() }); }
    catch (e) { return fail(res, h, e); }
  }
  if (m === "DELETE" && p === "/inbound") {
    try { return h.json(res, 200, { ok: true, inbound: Apps.clearInboundToken(), view: both() }); }
    catch (e) { return fail(res, h, e); }
  }
  if (seg.length === 1 && m === "DELETE") {
    try { return h.json(res, 200, await Apps.removeConnection(decodeURIComponent(seg[0]))); }
    catch (e) { return fail(res, h, e); }
  }
  if (seg.length === 2 && seg[1] === "refresh" && m === "POST") {
    try {
      const r = await Apps.refreshConnection(decodeURIComponent(seg[0]));
      return h.json(res, 200, { ok: !r.error, error: r.error, connection: Apps.connectionView(r.row), view: both() });
    } catch (e) { return fail(res, h, e); }
  }
  if (seg.length === 2 && seg[1] === "call" && m === "POST") {
    try {
      const r = await Apps.callWebhookNow(decodeURIComponent(seg[0]), body?.args || {});
      return h.json(res, 200, { ok: !r.isError, text: String(r.text || "").slice(0, 4000), denied: !!r.denied, ms: r.ms });
    } catch (e) { return fail(res, h, e); }
  }

  if (HOSTED) return h.json(res, 400, { error: "App discovery runs on this PC." });
  try {
    if (m === "GET" && p === "/suggestions") return h.json(res, 200, Apps.suggestFor(url.searchParams.get("prompt") || ""));
    if (m === "POST" && p === "/opt-in") return h.json(res, 200, { ...Apps.publicState(await Apps.optIn(!!body?.on)), ...Apps.appsView() });
    if (m === "POST" && p === "/allow") return h.json(res, 200, { ...Apps.publicState(Apps.setAllowed(String(body?.id || ""), !!body?.allowed)), ...Apps.appsView() });
    if (m === "POST" && p === "/dismiss") return h.json(res, 200, { ok: true, dismissed: Apps.dismissSuggestion(String(body?.id || "")).dismissed });
    if (m === "POST" && p === "/settings") {
      if (typeof body?.suggestions !== "boolean") {
        const err = new Error("suggestions must be true or false.");
        err.status = 400;
        throw err;
      }
      return h.json(res, 200, { ...Apps.publicState(Apps.setSuggestions(body.suggestions)), ...Apps.appsView() });
    }
    if (m === "POST" && p === "/catalog") return h.json(res, 200, { ...Apps.publicState(await Apps.updateCatalog(body?.url)), ...Apps.appsView() });
    if (m === "POST" && p === "/scan") return h.json(res, 200, { ...Apps.publicState(await Apps.rescan()), ...Apps.appsView() });
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message });
  }
  return false;
}
