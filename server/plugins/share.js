// Live-share link: a read-only, expiring page that mirrors one run (graph, tasks, feed) for a client
// or for recording, with the owner's brand kit applied. No keys; costs only if the owner allows it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { brandKit } from "./brand.js";
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

// Feed lines are free text, so dollar amounts are hidden unless costs are shown, and anything shaped
// like an API key or bearer token is always hidden.
const KEYISH = /\b(?:sk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9]{12,}|gsk_[A-Za-z0-9]{12,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g;
const MONEY = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?/g;
export function scrub(text, showCosts) {
  let t = String(text ?? "").replace(KEYISH, "[hidden]");
  if (!showCosts) t = t.replace(MONEY, "[cost hidden]");
  return t;
}

// What the share page may show of the brand kit (the kit is validated when saved: hex colours, safe logo).
export function publicBrand(kit) {
  return { name: kit.name || "", tagline: kit.tagline || "", primary: kit.primary || null, secondary: kit.secondary || null, logo: kit.logo || null };
}

const cleanToken = (t) => String(t || "").replace(/[^A-Za-z0-9_-]/g, "");

// After a restart the in-memory index is empty; in local mode the stored copy brings the link back.
function lookup(token, h) {
  let rec = index.get(token);
  if (!rec && !h.HOSTED) {
    const d = h.doc(KIND, () => ({}));
    if (d[token]) { rec = { ...d[token], ctxRef: h.ctx() }; index.set(token, rec); }
  }
  return rec || null;
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
    const token = cleanToken(p.slice(3));
    const rec = token ? lookup(token, h) : null;
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
    const feed = (feeds.get(rec.missionId) || []).slice(-80).map((e) => ({ ts: e.ts, type: e.type, provider: e.provider, from: e.from, to: e.to, text: scrub(e.text || e.label || e.error || "", rec.showCosts), ...(rec.showCosts ? { cost: e.cost } : {}) }));
    let brand = null; try { brand = publicBrand(rec.ctxRef ? h.runAs(rec.ctxRef, () => brandKit(h)) : brandKit(h)); } catch {}
    return h.json(res, 200, { expiresAt: rec.expiresAt, showCosts: rec.showCosts, brand, mission: sanitizeMission(m, rec.showCosts), feed, providers: Object.fromEntries(Object.values(h.PROVIDERS).map((pr) => [pr.id, { name: pr.name, color: pr.color }])) });
  }
  if (req.method === "GET" && p === "/list") {
    // owner only (behind the session token); expired links older than a day are dropped from the record
    const d = h.doc(KIND, () => ({})); const now = Date.now(); let pruned = false;
    for (const [t, r] of Object.entries(d)) if (now > r.expiresAt + 86400000) { delete d[t]; index.delete(t); pruned = true; }
    if (pruned) h.putDoc(KIND, d);
    const mid = url.searchParams.get("missionId");
    return h.json(res, 200, Object.entries(d).filter(([, r]) => !mid || r.missionId === mid).map(([t, r]) => ({ token: t, url: `/share.html?t=${t}`, ...r, expired: now > r.expiresAt })).sort((a, b) => b.createdAt - a.createdAt));
  }
  if (req.method === "DELETE" && p.startsWith("/t/")) { const t = cleanToken(p.slice(3)); index.delete(t); const d = h.doc(KIND, () => ({})); delete d[t]; h.putDoc(KIND, d); h.emit("log", { text: "Share link revoked." }); return h.json(res, 200, { ok: true }); }
  return false;
}
