// API key or MCP, per service that offers both. The vault and the MCP client stay where Phase 1
// and Phase 16 put them. This plugin only stores the choice and links a server to a provider.
import { PROVIDERS } from "../registry.js";
import { COUNCIL_IDS, COUNCIL_NOTE, DUAL, connectionOf, setActive, linkMcp, testConnection, isDual } from "../connect.js";
import { markLinked } from "./keysetup.js";

export const id = "connect";

function view() {
  const providers = {};
  for (const p of Object.values(PROVIDERS)) {
    if (p.demo) continue;
    if (!isDual(p.id) && !COUNCIL_IDS.includes(p.id)) continue;
    providers[p.id] = connectionOf(p.id);
  }
  return { note: COUNCIL_NOTE, council: COUNCIL_IDS, services: Object.keys(DUAL), providers };
}

const fail = (res, h, e) => h.json(res, e.status || 500, { error: e.message, code: e.code || "connect_failed" });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/connect/, "").replace(/\/$/, "");
  if (req.method === "GET" && (p === "" || p === "/")) return h.json(res, 200, view());
  if (req.method !== "POST") return false;
  try {
    if (p === "/active") {
      const conn = setActive(String(body.provider || ""), body.mode);
      return h.json(res, 200, { ok: true, connection: conn, view: view() });
    }
    if (p === "/test") {
      const r = await testConnection(String(body.provider || ""), body.mode);
      return h.json(res, 200, r);
    }
    if (p === "/mcp") {
      const pid = String(body.provider || "");
      const origin = req.headers.origin || "http://127.0.0.1";
      const r = await linkMcp(pid, { ...(body || {}), redirectUri: body?.redirectUri || `${String(origin).replace(/\/$/, "")}/` });
      if (r.ok) markLinked(h, pid);
      const name = h.PROVIDERS[pid]?.name || pid;
      const line = r.ok
        ? (r.oauthUrl ? `${name} sign-in started.` : `${name} MCP server connected (${r.tools.length} tool${r.tools.length === 1 ? "" : "s"}).`)
        : (r.quiet ? `${name}: ${r.error}` : `${name} MCP server saved, but it could not be reached.`);
      h.emit("log", { text: line });
      return h.json(res, 200, { ...r, view: view() });
    }
  } catch (e) { return fail(res, h, e); }
  return false;
}
