// Custom agents and the prompt library (Phase 19): the routes behind the Agents tab and the Command view's
// prompt chips. The work lives in server/custom-agents.js; a run is a single chat through h.runChat (ledger,
// spend caps, smart fallback, tool approvals and library citations as for any chat).
//   GET  /api/agents                                     agents, prompts, shared items, listing drafts, tool list
//   POST /api/agents ; POST|DELETE /api/agents/<id>      create, edit, delete an agent
//   POST /api/agents/<id>/run { prompt, projectId }      run it (202, { runId })
//   POST /api/agents/prompts ; POST|DELETE /api/agents/prompts/<id>
//   POST /api/agents/prompts/<id>/fill { values }        the filled text (every {{variable}} required)
//   POST /api/agents/prompts/<id>/run { values, agentId, projectId }
//   GET  /api/agents/export?agents=a,b&prompts=c ; POST /api/agents/import { data }
//   POST /api/agents/<id>/share | /api/agents/prompts/<id>/share { workspaceId }
//   GET  /api/agents/shared ; POST /api/agents/shared/<ws>/<kind>/<itemId>/run|copy ; DELETE /api/agents/shared/<ws>/<kind>/<itemId>
//   POST /api/agents/<id>/listing | /api/agents/prompts/<id>/listing { category, promise } ; DELETE /api/agents/listings/<id>
import crypto from "node:crypto";
import * as A from "../custom-agents.js";
import { listServers } from "../mcp.js";
import * as L from "../libraries.js";
import { demosHidden, visibleCustomAgents } from "../demo-visibility.js";

export const id = "agents";

function toolChoices() {
  return listServers().map((s) => {
    const on = Object.values(s.enabled || {}).reduce((acc, m) => Object.assign(acc, m || {}), {});
    return { serverId: s.id, serverName: s.name, tools: (s.lastTools || []).map((t) => ({ key: `${s.id}/${t.name}`, name: t.name, description: String(t.description || "").slice(0, 160), switchedOn: !!on[t.name] })) };
  });
}
async function overview(h) {
  let shared = [], sharedError = null;
  try { shared = await A.listShared(); } catch (e) { sharedError = e.message; }
  return {
    agents: visibleCustomAgents(A.listAgents(), { hidden: demosHidden() }), prompts: A.listPrompts(), shared, sharedError, listings: A.listListings(),
    tools: toolChoices(), libraries: L.available() ? L.listLibraries().map((l) => ({ id: l.id, name: l.name, chunks: l.chunks })) : [],
    limits: A.LIMITS, toolModes: A.TOOL_MODES, categories: A.LISTING_CATEGORIES, sharePermissions: A.SHARE_PERMISSIONS, hosted: !!h.HOSTED,
  };
}
const runId = () => `s-${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
function start(h, opts) {
  const id = runId();
  h.runChat({ ...opts, runId: id }).catch((e) => h.emit("log", { text: `${opts.agent ? `Agent "${opts.agent.name}"` : "Prompt"} failed: ${e.message}`, level: "error", missionId: id }));
  return { ok: true, runId: id };
}
const projectOf = (body) => (typeof body?.projectId === "string" && body.projectId ? body.projectId : null);

// a saved prompt, filled, with its agent (or the one picked for this run; "" means none)
function promptRun(p, body, agentFor) {
  const text = A.fillPrompt(p.text, body?.values);
  const pick = typeof body?.agentId === "string" ? body.agentId : p.agentId;
  const agent = pick ? agentFor(pick) : null;
  if (pick && !agent) throw Object.assign(new Error("That agent does not exist any more."), { status: 404 });
  return agent ? A.runOptions(agent, { prompt: text, projectId: projectOf(body) }) : { prompt: text, projectId: projectOf(body) };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/agents/, "").replace(/\/$/, "") || "/";
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, await overview(h));
    if (m === "POST" && p === "/") return h.json(res, 200, A.createAgent(body || {}));

    // ---- export / import ----
    if (m === "GET" && p === "/export") {
      const list = (k) => { const v = url.searchParams.get(k); return v === null ? undefined : v.split(",").filter(Boolean); };
      return h.json(res, 200, A.exportBundle({ agents: list("agents"), prompts: list("prompts") }));
    }
    if (m === "POST" && p === "/import") return h.json(res, 200, A.importBundle(body?.data));

    // ---- Marketplace listing drafts ----
    if (m === "GET" && p === "/listings") return h.json(res, 200, { items: A.listListings() });
    if (m === "DELETE" && seg[0] === "listings" && seg[1]) return h.json(res, 200, A.removeListing(seg[1]));

    // ---- shared with a workspace ----
    if (seg[0] === "shared") {
      if (m === "GET" && seg.length === 1) return h.json(res, 200, { items: await A.listShared() });
      const [, ws, kind, itemId, action] = seg;
      if (!ws || !kind || !itemId) return false;
      if (m === "DELETE" && !action) return h.json(res, 200, await A.unshare(ws, kind, itemId));
      if (m === "POST" && action === "copy") return h.json(res, 200, await A.copyShared(ws, kind, itemId));
      if (m === "POST" && action === "run") {
        const { row } = await A.sharedForUse(ws, kind, itemId);
        if (kind === "agent") { const { agent, notes } = A.agentFromSnapshot(row.data); for (const n of notes) h.emit("log", { text: `Shared agent "${agent.name}": ${n}` }); return h.json(res, 202, start(h, A.runOptions(agent, { prompt: body?.prompt, projectId: projectOf(body) }))); }
        const text = A.fillPrompt(row.data?.text, body?.values);
        let opts = { prompt: text, projectId: projectOf(body) };
        if (row.data?.agentRef) { const a = (await A.listShared()).find((x) => x.workspaceId === ws && x.kind === "agent" && x.itemId === row.data.agentRef); if (a) opts = A.runOptions(A.agentFromSnapshot(a.data).agent, opts); }
        return h.json(res, 202, start(h, opts));
      }
      return false;
    }

    // ---- prompts ----
    if (seg[0] === "prompts") {
      if (m === "GET" && seg.length === 1) return h.json(res, 200, { items: A.listPrompts() });
      if (m === "POST" && seg.length === 1) return h.json(res, 200, A.createPrompt(body || {}));
      const pr = seg[1] && A.getPrompt(seg[1]);
      if (!pr) return h.json(res, 404, { error: "No such prompt." });
      if (m === "GET" && seg.length === 2) return h.json(res, 200, A.promptView(pr));
      if (m === "POST" && seg.length === 2) return h.json(res, 200, A.updatePrompt(pr.id, body || {}));
      if (m === "DELETE" && seg.length === 2) return h.json(res, 200, A.deletePrompt(pr.id));
      if (m === "POST" && seg[2] === "fill") return h.json(res, 200, { text: A.fillPrompt(pr.text, body?.values) });
      if (m === "POST" && seg[2] === "run") return h.json(res, 202, start(h, promptRun(pr, body, A.getAgent)));
      if (m === "POST" && seg[2] === "share") return h.json(res, 200, await A.share("prompt", pr.id, body?.workspaceId));
      if (m === "POST" && seg[2] === "listing") return h.json(res, 200, A.prepareListing("prompt", pr.id, body || {}));
      return false;
    }

    // ---- one agent ----
    const a = seg[0] && A.getAgent(seg[0]);
    if (!a) return h.json(res, 404, { error: "No such agent." });
    if (m === "GET" && seg.length === 1) return h.json(res, 200, A.agentView(a));
    if (m === "POST" && seg.length === 1) return h.json(res, 200, A.updateAgent(a.id, body || {}));
    if (m === "DELETE" && seg.length === 1) return h.json(res, 200, A.deleteAgent(a.id));
    if (m === "POST" && seg[1] === "run") return h.json(res, 202, start(h, A.runOptions(a, { prompt: body?.prompt, projectId: projectOf(body), search: body?.search })));
    if (m === "POST" && seg[1] === "share") return h.json(res, 200, await A.share("agent", a.id, body?.workspaceId));
    if (m === "POST" && seg[1] === "listing") return h.json(res, 200, A.prepareListing("agent", a.id, body || {}));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, missing: e.missing, flagged: e.flagged });
  }
  return false;
}
