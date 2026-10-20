// Hosted schedule clock. A Cloudflare cron wakes the container and POSTs here with a shared secret.
// The secret is CC_TICK_SECRET (a wrangler secret, never written into wrangler.jsonc).
// Each call runs schedules tick() for every user who has a due cron slot. A slot is claimed in tick()
// before the run starts, so a second tick does not run it again. Caps and approvals are unchanged.
import crypto from "node:crypto";
import { HOSTED, allContexts, getContext, runAs } from "./store.js";
import { CFG, rest } from "./hosted.js";
import { contextForUser } from "./auth.js";
import * as S from "./schedules.js";

export const TICK_PATH = "/api/internal/schedules/tick";
export const TICK_HEADER = "x-cc-tick-secret";

export function tickSecretOk(presented, secret = process.env.CC_TICK_SECRET || "") {
  const a = Buffer.from(String(presented ?? ""));
  const b = Buffer.from(String(secret));
  if (!secret || a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function listScheduleDocs() {
  if (!HOSTED || !CFG.url) return [];
  try {
    const rows = await rest("user_docs?kind=eq.schedules&select=user_id,data");
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error(`[schedules] could not list schedules: ${e.message}`);
    return [];
  }
}

function dueIn(data, now) {
  const list = Array.isArray(data?.list) ? data.list : [];
  for (const s of list) {
    if (!s?.enabled || s.trigger?.type !== "cron" || !s.trigger.cron) continue;
    try { if (S.cronDue(S.parseCron(s.trigger.cron), s.lastSlot, now) !== null) return true; }
    catch { /* a bad expression is skipped */ }
  }
  return false;
}

// One pass at `now`: every user with a due slot, whether they are already in memory or only in Supabase.
export async function tickDueUsers(now = Date.now()) {
  const ids = new Set();
  for (const c of allContexts()) {
    if (c?.userId && dueIn(c.docs?.schedules, now)) ids.add(c.userId);
  }
  for (const row of await listScheduleDocs()) {
    if (row?.user_id && dueIn(row.data, now)) ids.add(row.user_id);
  }
  const runs = [];
  for (const id of ids) {
    let c = getContext(id);
    if (!c) {
      try { c = await contextForUser(id); }
      catch (e) { console.error(`[schedules] ${id}: ${e.message}`); continue; }
    } else if (!c.ready && c.loading) {
      try { await c.loading; } catch { continue; }
    }
    if (!c?.ready) continue;
    c.lastSeen = Date.now();
    let out = [];
    try { out = runAs(c, () => S.tick(now)); }
    catch (e) { console.error(`[schedules] tick ${id}: ${e.message}`); }
    for (const r of out || []) runs.push({ userId: id, id: r.id, scheduleId: r.scheduleId, slot: r.slot });
  }
  return runs;
}

// The signed-in user who owns this schedule id, loaded from memory or from Supabase.
export async function ownerForSchedule(scheduleId) {
  for (const c of allContexts()) {
    if (runAs(c, () => S.getSchedule(scheduleId))) return c;
  }
  for (const row of await listScheduleDocs()) {
    if (!row?.user_id || !Array.isArray(row.data?.list)) continue;
    if (!row.data.list.some((s) => s.id === scheduleId)) continue;
    return getContext(row.user_id) || contextForUser(row.user_id);
  }
  return null;
}

export async function handleScheduleTick(req, res, send) {
  if (!HOSTED) return send(res, 404, { error: "not found" });
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "POST only" }); }
  if (!tickSecretOk(req.headers[TICK_HEADER])) return send(res, 401, { error: "unauthorized" });
  try {
    const runs = await tickDueUsers(Date.now());
    return send(res, 200, { ok: true, runs: runs.length, items: runs });
  } catch (e) {
    console.error("[schedules] tick:", e.message);
    return send(res, 500, { error: "tick failed" });
  }
}
