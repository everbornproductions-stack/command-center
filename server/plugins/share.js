// Live-share link: a read-only, expiring page that mirrors one run (graph, tasks, feed) for a client
// or for recording, with the owner's brand kit applied. No keys; costs only if the owner allows it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { brandKit } from "./brand.js";
import { requirePro } from "../feature-gate.js";
export const id = "share";
const KIND = "share.tokens"; // { [token]: { missionId, createdAt, expiresAt, showCosts, userId, snapshot? } }
const SETTINGS = "share.settings";

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

export function checkPublicBase(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { throw Object.assign(new Error("The public address must be an https URL."), { status: 400 }); }
  if (u.username || u.password) throw Object.assign(new Error("The public address cannot include a password."), { status: 400 });
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
  if (u.protocol !== "https:") throw Object.assign(new Error("The public address must be https."), { status: 400 });
  return u.origin;
}

export function reachOf(base) {
  if (!base) return "this-computer";
  try {
    const u = new URL(base);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return "this-computer";
  } catch { return "this-computer"; }
  return "public";
}

function savedBase(h) {
  const saved = String(h.doc(SETTINGS, () => ({})).publicBase || "");
  if (saved) return saved;
  if (h.HOSTED) {
    const hub = String(process.env.CC_HUB_URL || "").replace(/\/$/, "");
    if (hub.startsWith("https://")) return hub;
  }
  return "";
}

export function buildSnapshot(m, showCosts) {
  const mission = sanitizeMission(m, showCosts);
  if (!mission) return null;
  if (mission.deliverable) mission.deliverable = scrub(mission.deliverable, showCosts).slice(0, 100000);
  if (mission.verdict?.text) mission.verdict.text = scrub(mission.verdict.text, showCosts);
  if (mission.answers) {
    for (const a of Object.values(mission.answers)) if (a?.text) a.text = scrub(a.text, showCosts);
  }
  return mission;
}

async function missionFor(rec, h) {
  let m = null;
  const lr = rec.ctxRef?.lastRun; if (lr && lr.id === rec.missionId) m = lr;
  if (!m) {
    const file = path.join(h.DATA_DIR, "missions", rec.missionId.replace(/[^a-z0-9-]/gi, "") + ".json");
    if (!h.HOSTED && fs.existsSync(file)) { try { m = JSON.parse(fs.readFileSync(file, "utf8")); } catch {} }
    else if (rec.ctxRef?.store?.getMission) { try { m = await h.runAs(rec.ctxRef, () => rec.ctxRef.store.getMission(rec.missionId)); } catch {} }
  }
  return m || rec.snapshot || null;
}

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
  if (req.method === "GET" && p === "/settings") {
    const base = savedBase(h);
    return h.json(res, 200, { publicBase: base, reach: reachOf(base) });
  }
  if (req.method === "POST" && p === "/settings") {
    let publicBase = "";
    try { publicBase = checkPublicBase(body.publicBase); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message }); }
    h.putDoc(SETTINGS, { publicBase });
    return h.json(res, 200, { publicBase, reach: reachOf(publicBase) });
  }
  if (req.method === "POST" && p === "/public") {
    try { requirePro("publicShare"); }
    catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
    const missionId = String(body.missionId || "");
    if (!missionId) return h.json(res, 400, { error: "missionId required" });
    const showCosts = !!body.showCosts;
    const live = await missionFor({ missionId, ctxRef: h.ctx() }, h);
    if (!live) return h.json(res, 404, { error: "That run was not found." });
    const snapshot = buildSnapshot(live, showCosts);
    const token = crypto.randomBytes(18).toString("base64url");
    const ttl = Math.min(30 * 24 * 60, Math.max(5, Number(body.ttlMinutes) || 7 * 24 * 60));
    const base = savedBase(h);
    const rec = { missionId, createdAt: Date.now(), expiresAt: Date.now() + ttl * 60000, showCosts, public: true, snapshot, ctxRef: h.ctx() };
    index.set(token, rec);
    const d = h.doc(KIND, () => ({}));
    d[token] = { missionId, createdAt: rec.createdAt, expiresAt: rec.expiresAt, showCosts, public: true, snapshot };
    h.putDoc(KIND, d);
    const pathUrl = `/share.html?t=${token}`;
    const url = base ? `${base}${pathUrl}` : pathUrl;
    h.emit("log", { text: `Public share link created for ${missionId}.`, missionId });
    const reach = reachOf(base);
    return h.json(res, 200, {
      token, url, publicUrl: reach === "public" ? url : null, reach, expiresAt: rec.expiresAt,
      note: reach === "public" ? "Anyone with this link can open the page. Nothing was posted." : "This link works on this computer. Add an https address under Share to make it a public link. Nothing was posted.",
    });
  }
  if (req.method === "GET" && p.startsWith("/t/")) {
    const token = cleanToken(p.slice(3));
    const rec = token ? lookup(token, h) : null;
    if (!rec) return h.json(res, 404, { error: "unknown link" });
    if (Date.now() > rec.expiresAt) { index.delete(token); return h.json(res, 410, { error: "this link has expired" }); }
    // read the mission: the owner's live snapshot first, then the stored copy (local file, or the owner's store in hosted mode)
    const live = await missionFor(rec, h);
    const m = rec.public && rec.snapshot ? rec.snapshot : (live || rec.snapshot || null);
    const feed = (feeds.get(rec.missionId) || []).slice(-80).map((e) => ({ ts: e.ts, type: e.type, provider: e.provider, from: e.from, to: e.to, text: scrub(e.text || e.label || e.error || "", rec.showCosts), ...(rec.showCosts ? { cost: e.cost } : {}) }));
    let brand = null; try { brand = publicBrand(rec.ctxRef ? h.runAs(rec.ctxRef, () => brandKit(h)) : brandKit(h)); } catch {}
    return h.json(res, 200, { expiresAt: rec.expiresAt, showCosts: rec.showCosts, public: !!rec.public, brand, mission: sanitizeMission(m, rec.showCosts), feed, providers: Object.fromEntries(Object.values(h.PROVIDERS).map((pr) => [pr.id, { name: pr.name, color: pr.color }])) });
  }
  if (req.method === "GET" && p === "/list") {
    // owner only (behind the session token); expired links older than a day are dropped from the record
    const d = h.doc(KIND, () => ({})); const now = Date.now(); let pruned = false;
    for (const [t, r] of Object.entries(d)) if (now > r.expiresAt + 86400000) { delete d[t]; index.delete(t); pruned = true; }
    if (pruned) h.putDoc(KIND, d);
    const mid = url.searchParams.get("missionId");
    return h.json(res, 200, Object.entries(d).filter(([, r]) => !mid || r.missionId === mid).map(([t, r]) => { const { snapshot, ...rest } = r; return { token: t, url: `/share.html?t=${t}`, ...rest, expired: now > r.expiresAt }; }).sort((a, b) => b.createdAt - a.createdAt));
  }
  if (req.method === "DELETE" && p.startsWith("/t/")) { const t = cleanToken(p.slice(3)); index.delete(t); const d = h.doc(KIND, () => ({})); delete d[t]; h.putDoc(KIND, d); h.emit("log", { text: "Share link revoked." }); return h.json(res, 200, { ok: true }); }
  return false;
}
