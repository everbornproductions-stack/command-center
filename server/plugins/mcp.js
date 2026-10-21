// MCP tool support (Phase 16): the routes behind Settings > Tools and the approval prompts.
// Servers, per-workspace enablement, the approval gate, OAuth and the chat loop live in server/mcp.js;
// the protocol client in server/mcp-client.js. Secrets (headers, env, tokens) go to the vault and never
// come back to the browser: views carry names and flags only. Routes: /api/mcp/...
import { HOSTED, doc } from "../store.js";
import { demoActive } from "../mock.js";
import { demosHidden } from "../demo-visibility.js";
import { PROVIDERS } from "../registry.js";
import { mcpSettings, saveMcpSettings, listServers, findServer, serverView, addServer, removeServer, addDemoServer, setToolPrefs, setServerOptions, connectServer, pendingList, resolveApproval, recentCalls, executeTool, enabledTools, workspaceKey, oauthStart, oauthFinish, oauthSignOut, supportsTools, toolReadOnly, needsApproval, sessionOf, TRANSPORTS, RESULT_MAX_CHARS } from "../mcp.js";

// Routes are served under /api/tools (the user-facing "Tools" feature). The id here is the mount point;
// "tools" also sidesteps a sandbox HTTP proxy that re-frames any loopback path ending in /mcp or /sse.
export const id = "tools";
const BASE = /^\/api\/tools/;

function workspaceName(key) {
  if (key === "personal") return "Personal";
  try { const w = (doc("workspaces", () => ({ list: [] })).list || []).find((x) => x.id === key); if (w) return w.name; } catch {}
  return key;
}
function view(h) {
  const ws = workspaceKey();
  const servers = listServers().map(serverView);
  return {
    settings: mcpSettings(), transports: TRANSPORTS, hosted: HOSTED, demo: demoActive(), demoAvailable: !HOSTED,
    workspace: { key: ws, name: workspaceName(ws) },
    servers, enabledCount: servers.reduce((a, s) => a + s.enabledCount, 0),
    pending: pendingList(), recent: recentCalls(30),
    providers: Object.values(h.PROVIDERS).filter((p) => p.kind === "text" && (!p.demo || (h.hasSecret(p.id) && !demosHidden()))).map((p) => ({ id: p.id, name: p.name, tools: supportsTools(p.id) })),
  };
}
const bad = (res, h, msg, code = "mcp_invalid") => h.json(res, 400, { error: msg, code });
const fail = (res, h, e) => h.json(res, e.status || 500, { error: e.message, code: e.code });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(BASE, "").replace(/\/$/, "");
  const seg = p.split("/").filter(Boolean);
  const method = req.method;

  if (method === "GET" && !seg.length) return h.json(res, 200, view(h));

  if (method === "POST" && p === "/settings") {
    try { saveMcpSettings(body || {}); } catch (e) { return fail(res, h, e); }
    return h.json(res, 200, view(h));
  }

  // add or edit a server, then connect and list its tools (a connection error is reported, the server is kept)
  if (method === "POST" && p === "/servers") {
    let row;
    try { row = await addServer(body || {}); } catch (e) { return fail(res, h, e); }
    let error = null;
    try { await connectServer(row.id, { refresh: true }); } catch (e) { error = e.message; }
    const sv = serverView(findServer(row.id));
    h.emit("log", { text: error ? `Tool server "${row.name}" saved, but it could not be reached: ${error}` : `Tool server "${row.name}" connected: ${sv.tools.length} tool${sv.tools.length === 1 ? "" : "s"}. Enable the ones you want in Settings > Tools.` });
    return h.json(res, 200, { ok: !error, error, server: sv, view: view(h) });
  }
  if (method === "POST" && p === "/demo") {
    try {
      const row = await addDemoServer();
      await connectServer(row.id, { refresh: true });
      setToolPrefs(row.id, { all: true });
      h.emit("log", { text: `Demo tools added and enabled for ${workspaceName(workspaceKey())}: clock and word count run without asking; saving a note asks first.` });
      return h.json(res, 200, { ok: true, server: serverView(findServer(row.id)), view: view(h) });
    } catch (e) { return fail(res, h, e); }
  }

  if (seg[0] === "servers" && seg[1]) {
    const sid = decodeURIComponent(seg[1]);
    const s = findServer(sid);
    if (!s) return h.json(res, 404, { error: "server not found" });
    if (method === "DELETE" && seg.length === 2) {
      await removeServer(sid);
      h.emit("log", { text: `Tool server "${s.name}" removed; its headers, environment values and tokens were deleted from the vault.` });
      return h.json(res, 200, view(h));
    }
    if (method === "DELETE" && seg[2] === "oauth") { await oauthSignOut(sid); return h.json(res, 200, view(h)); }
    if (method !== "POST") return false;
    if (seg[2] === "refresh") {
      let error = null;
      try { await connectServer(sid, { refresh: true }); } catch (e) { error = e.message; }
      return h.json(res, 200, { ok: !error, error, server: serverView(findServer(sid)), view: view(h) });
    }
    if (seg[2] === "tools") {
      try { setToolPrefs(sid, { tool: body.tool ? String(body.tool) : undefined, enabled: typeof body.enabled === "boolean" ? body.enabled : undefined, readOnly: body.readOnly === null ? null : typeof body.readOnly === "boolean" ? body.readOnly : undefined, all: typeof body.all === "boolean" ? body.all : undefined }); }
      catch (e) { return fail(res, h, e); }
      return h.json(res, 200, { server: serverView(findServer(sid)), view: view(h) });
    }
    if (seg[2] === "options") {
      try { setServerOptions(sid, { autoReadOnly: typeof body.autoReadOnly === "boolean" ? body.autoReadOnly : undefined }); } catch (e) { return fail(res, h, e); }
      return h.json(res, 200, { server: serverView(findServer(sid)), view: view(h) });
    }
    // a tool run by hand from Settings: the click is the approval
    if (seg[2] === "call") {
      const name = String(body.tool || "");
      const tools = sessionOf(sid)?.tools || s.lastTools || [];
      const t = tools.find((x) => x.name === name);
      if (!t) return bad(res, h, `no tool named ${name} on ${s.name}`);
      const args = body.args && typeof body.args === "object" ? body.args : {};
      const r = await executeTool({ server: s, tool: t, readOnly: toolReadOnly(s, t), needsApproval: needsApproval(s, t) }, args, { manual: true });
      return h.json(res, 200, { ok: !r.isError, text: String(r.text || "").slice(0, Math.min(RESULT_MAX_CHARS, 6000)), isError: r.isError, ms: r.ms, structured: r.structured ?? null });
    }
    return false;
  }

  // the approval prompt's answer (Allow once / Deny)
  if (method === "POST" && seg[0] === "approvals" && seg[1]) {
    const ok = resolveApproval(seg[1], !!body.allow);
    if (!ok) return h.json(res, 404, { error: "That request is no longer waiting (it was answered or timed out)." });
    return h.json(res, 200, { ok: true, allowed: !!body.allow, pending: pendingList() });
  }

  // OAuth for remote servers: start returns the page to open; finish takes the code the browser came back with
  if (method === "POST" && p === "/oauth/start") {
    const s = findServer(String(body.id || "")); if (!s) return h.json(res, 404, { error: "server not found" });
    const origin = /^https?:\/\/[^\s/]+$/.test(String(body.origin || "")) ? body.origin : (HOSTED ? (h.hubUrl || process.env.CC_HUB_URL || "") : `http://${req.headers.host}`);
    if (!origin) return bad(res, h, "origin required");
    try { const r = await oauthStart(s.id, { redirectUri: `${origin.replace(/\/$/, "")}/` }); return h.json(res, 200, { ok: true, url: r.url, issuer: r.issuer, state: r.state, server: serverView(findServer(s.id)) }); }
    catch (e) { return fail(res, h, e); }
  }
  if (method === "POST" && p === "/oauth/finish") {
    try { const r = await oauthFinish({ code: body.code, state: body.state }); return h.json(res, 200, { ...r, server: serverView(findServer(r.serverId)), view: view(h) }); }
    catch (e) { return fail(res, h, e); }
  }

  // what a run would get right now (debugging aid for the UI; no secrets)
  if (method === "GET" && p === "/enabled") return h.json(res, 200, { workspace: workspaceKey(), tools: enabledTools().map((t) => ({ name: t.name, tool: t.tool.name, server: t.server.name, readOnly: t.readOnly, needsApproval: t.needsApproval })) });
  return false;
}
