// Live-share link: a read-only, expiring page that mirrors one run (graph, tasks, feed) for a client
// or for recording. No prompts' secrets, no keys; costs only if the owner allows it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bus } from "../events.js";
export const id = "share";
const KIND = "share.tokens"; // { [token]: { missionId, createdAt, expiresAt, showCosts, userId } }

// tokens are looked up without a user session, so keep a process-wide index too
const index = new Map(); // token -> { missionId, expiresAt, showCosts, ctxRef }
const feeds = new Map(); // missionId -> recent events (ring)

export async function init(h) {
  h.bus.on("event", (ev) => {
    const mid = ev.missionId || ev.mission?.id || ev.council?.id;
    if (!mid) return;
    if (!["log", "agent.start", "agent.done", "agent.error", "agent.msg", "task.update", "mission.update", "council.update"].includes(ev.type)) return;
    const arr = feeds.get(mid) || []; arr.push(ev); if (arr.length > 300) arr.shift(); feeds.set(mid, arr);
  });
}

function sanitizeMission(m, showCosts) {
  if (!m) return null;
  const strip = (o) => { if (!o) return o; const c = { ...o }; if (!showCosts) { delete c.cost; delete c.estCost; delete c.estimatedCost; delete c.budgetUsd; } return c; };
  const out = strip({ id: m.id, kind: m.kind, title: m.title || m.prompt?.slice(0, 90), status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt, mode: m.mode, cost: m.cost, estimatedCost: m.estimatedCost });
  if (m.kind === "mission") { out.tasks = (m.tasks || []).map((t) => strip({ id: t.id, title: t.title, capability: t.capability, status: t.status, provider: t.provider, model: t.model, agentName: t.agentName, deps: t.deps, cost: t.cost, estCost: t.estCost, review: t.review ? { pass: t.review.pass, score: t.review.score } : null })); out.deliverable = m.deliverable || null; }
  if (m.kind === "council") { out.members = m.members; out.answers = Object.fromEntries(Object.entries(m.answers || {}).map(([k, a]) => [k, strip({ provider: a.provider, model: a.model, letter: a.letter, text: a.text, ms: a.ms, cost: a.cost })])); out.scoreboard = m.scoreboard || null; out.winner = m.winner || null; out.verdict = m.verdict ? { provider: m.verdict.provider, text: m.verdict.text } : null; }
  if (m.kind === "single") out.deliverable = m.deliverable || null;
  return out;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/share/, "");
  if (req.method === "POST" && p === "/create") {
    const missionId = String(body.missionId || ""); if (!missionId) return h.json(res, 400, { error: "missionId required" });
    const token = crypto.randomBytes(18).toString("base64url");
    const ttl = Math.min(7 * 24 * 60, Math.max(5, Number(body.ttlMinutes) || 24 * 60));
    const rec = { missionId, createdAt: Date.now(), expiresAt: Date.now() + ttl * 60000, showCosts: !!body.showCosts, ctxRef: h.ctx() };
    index.set(token, rec);
    const d = h.doc(KIND, () => ({})); d[token] = { missionId, createdAt: rec.createdAt, expiresAt: rec.expiresAt, showCosts: rec.showCosts }; h.putDoc(KIND, d);
    h.emit("log", { text: `Share link created for ${missionId} (expires in ${ttl >= 60 ? Math.round(ttl / 60) + " h" : ttl + " min"}).`, missionId });
    return h.json(res, 200, { token, url: `/share.html?t=${token}`, expiresAt: rec.expiresAt });
  }
  if (req.method === "GET" && p.startsWith("/t/")) {
    const token = p.slice(3).replace(/[^A-Za-z0-9_-]/g, "");
    const rec = index.get(token);
    if (!rec) return h.json(res, 404, { error: "unknown link" });
    if (Date.now() > rec.expiresAt) { index.delete(token); return h.json(res, 410, { error: "this link has expired" }); }
    // read the mission: the owner's live snapshot first, then the stored copy (local file, or the owner's store in hosted mode)
    let m = null;
    const lr = rec.ctxRef?.lastRun; if (lr && lr.id === rec.missionId) m = lr;
    if (!m) {
      const file = path.join(h.DATA_DIR, "missions", rec.missionId.replace(/[^a-z0-9-]/gi, "") + ".json");
      if (!h.HOSTED && fs.existsSync(file)) { try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch {} }
      else if (rec.ctxRef?.store?.getMission) { try { m = await h.runAs(rec.ctxRef, () => rec.ctxRef.store.getMission(rec.missionId)); } catch {} }
    }
    const feed = (feeds.get(rec.missionId) || []).slice(-80).map((e) => ({ ts: e.ts, type: e.type, provider: e.provider, from: e.from, to: e.to, text: e.text || e.label || e.error || "", ...(rec.showCosts ? { cost: e.cost } : {}) }));
    return h.json(res, 200, { expiresAt: rec.expiresAt, mission: sanitizeMission(m, rec.showCosts), feed, providers: Object.fromEntries(Object.values(h.PROVIDERS).map((pr) => [pr.id, { name: pr.name, color: pr.color }])) });
  }
  if (req.method === "GET" && p === "/list") { const d = h.doc(KIND, () => ({})); return h.json(res, 200, Object.entries(d).map(([t, r]) => ({ token: t, ...r, expired: Date.now() > r.expiresAt }))); }
  if (req.method === "DELETE" && p.startsWith("/t/")) { const t = p.slice(3); index.delete(t); const d = h.doc(KIND, () => ({})); delete d[t]; h.putDoc(KIND, d); return h.json(res, 200, { ok: true }); }
  return false;
}
