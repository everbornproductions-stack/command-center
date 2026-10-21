// Optional Supabase reads and writes for packs and votes.
// A missing table, a refused call, or no cloud config is the offline path.
// The local vote document is already saved before this runs.
import { HOSTED, ctx } from "../store.js";
import { rest } from "../hosted.js";
import { cloud } from "../license.js";

const PACK_SELECT = "id,title,category,industry,prompt,source_name,source_url,popularity_note,added_week,builder,feature";

function anonHeaders(cfg) {
  const headers = { apikey: cfg.anonKey, accept: "application/json", "content-type": "application/json" };
  if (String(cfg.anonKey).startsWith("eyJ")) headers.authorization = `Bearer ${cfg.anonKey}`;
  return headers;
}

async function anonFetch(pathq, { method = "GET", body } = {}) {
  const cfg = cloud();
  if (!cfg.url || !cfg.anonKey) return { offline: true, body: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/${pathq}`, {
      method,
      headers: anonHeaders(cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!res.ok) return { offline: true, body: parsed };
    return { offline: false, body: parsed };
  } catch {
    return { offline: true, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCloudPacks() {
  if (HOSTED) {
    try {
      const rows = await rest(`prompt_packs?select=${PACK_SELECT}`, { token: ctx().token });
      return { offline: false, rows: Array.isArray(rows) ? rows : [] };
    } catch {
      return { offline: true, rows: [] };
    }
  }
  const got = await anonFetch(`prompt_packs?select=${PACK_SELECT}`);
  return { offline: got.offline, rows: Array.isArray(got.body) ? got.body : [] };
}

export async function fetchCloudTotals() {
  const read = (rows) => (Array.isArray(rows) ? rows : []).map((row) => ({
    promptId: String(row.prompt_id || ""),
    up: Number(row.up_count) || 0,
    down: Number(row.down_count) || 0,
  })).filter((row) => row.promptId);
  if (HOSTED) {
    try {
      const rows = await rest("rpc/prompt_vote_totals", { method: "POST", token: ctx().token, body: {} });
      return { offline: false, rows: read(rows) };
    } catch {
      return { offline: true, rows: [] };
    }
  }
  const got = await anonFetch("rpc/prompt_vote_totals", { method: "POST", body: {} });
  return { offline: got.offline, rows: got.offline ? [] : read(got.body) };
}

export async function pushCloudVote(promptId, vote) {
  if (!HOSTED) return { offline: true };
  let userId = "";
  let token = "";
  try {
    userId = ctx().userId || "";
    token = ctx().token || "";
  } catch {
    return { offline: true };
  }
  if (!userId || !token) return { offline: true };
  const id = encodeURIComponent(promptId);
  try {
    if (vote !== "up" && vote !== "down") {
      await rest(`prompt_votes?user_id=eq.${userId}&prompt_id=eq.${id}`, { method: "DELETE", token, prefer: "return=minimal" });
    } else {
      await rest("prompt_votes", {
        method: "POST",
        token,
        prefer: "resolution=merge-duplicates,return=minimal",
        body: { user_id: userId, prompt_id: promptId, vote: vote === "up" ? 1 : -1, updated_at: new Date().toISOString() },
      });
    }
    return { offline: false };
  } catch {
    return { offline: true };
  }
}
