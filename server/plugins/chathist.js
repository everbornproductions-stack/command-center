// Chat history routes (0.4.21). Plain list of past chats, councils and missions, one-click redo, quick picks,
// and a recall search for Memories. Reads the saved mission files; writes only the small "chathist" document.
//   GET  /api/chathist?q=&limit=&projectId=     { format, version, items }  newest first, pinned on top
//   GET  /api/chathist/picks                    { recent, saved }  for the start box
//   GET  /api/chathist/recall?q=                { hits }  earlier work that matches (private chats left out)
//   GET  /api/chathist/recall-all?q=&projectId= { memories, past, text }  saved Memories (if present) plus past work
//   POST /api/chathist/redo { id, change? }     run it again (with a change added), 202 { ok, kind, replayedFrom }
//   POST /api/chathist/pin | hide | rename      { id, on? | title? }
import * as H from "../chat-history.js";
import { ctx } from "../store.js";
import { listPrompts } from "../custom-agents.js";

export const id = "chathist";

const all = () => ctx().store.listMissions((m) => m).filter(Boolean);
const cleanId = (v) => String(v || "").replace(/[^a-z0-9-]/gi, "");

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/chathist/, "") || "/";
  const q = url.searchParams;
  const fail = (status, error, code) => (h.json(res, status, { error, code }), true);

  if (req.method === "GET" && p === "/") {
    const items = H.listRows(all(), { q: q.get("q") || "", limit: q.get("limit"), projectId: q.get("projectId") || "" });
    return h.json(res, 200, { format: H.HISTORY_FORMAT, version: H.HISTORY_VERSION, items }), true;
  }
  if (req.method === "GET" && p === "/picks") {
    let saved = []; try { saved = listPrompts(); } catch { /* none saved */ }
    return h.json(res, 200, H.quickPicks(all(), saved)), true;
  }
  if (req.method === "GET" && p === "/recall-all") return h.json(res, 200, await H.recallAll(q.get("q") || "", all(), { projectId: q.get("projectId") || null })), true;
  if (req.method === "GET" && p === "/recall") return h.json(res, 200, { hits: H.recallPast(q.get("q") || "", all(), { limit: Number(q.get("limit")) || 5 }) }), true;

  if (req.method === "POST" && p === "/redo") {
    const run = await ctx().store.getMission(cleanId(body?.id));
    const spec = H.redoSpec(run, body?.change);
    if (spec.error) return fail(spec.status || 400, spec.error, "redo");
    try {
      const started = spec.kind === "single" ? h.runChat(spec.body) : spec.kind === "council" ? h.runCouncil(spec.body) : h.runMission(spec.body);
      Promise.resolve(started).catch(() => {});
    } catch (e) { return fail(e.status || 500, e.message, e.code); }
    return h.json(res, 202, { ok: true, kind: spec.kind, replayedFrom: run.id, changed: !!spec.changed }), true;
  }
  if (req.method === "POST" && ["/pin", "/hide", "/rename"].includes(p)) {
    const rid = cleanId(body?.id);
    if (!rid) return fail(400, "Pick a chat first.", "id");
    if (p === "/pin") H.pin(rid, body?.on !== false);
    else if (p === "/hide") H.hide(rid, body?.on !== false);
    else H.rename(rid, body?.title);
    return h.json(res, 200, { ok: true }), true;
  }
  return false;
}
