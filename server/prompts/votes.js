// One vote per person per prompt. A later vote replaces the earlier one.
// The local document is the fallback when Supabase cannot be reached.
// Community totals, when we have them, do not include this person's latest
// vote twice: synced is what we believe the cloud already counted.

export const VOTE_KIND = "prompts.votes";

export function emptyVotes() {
  return { mine: {}, community: {}, synced: {}, pending: {} };
}

function cleanChoice(value) {
  return value === "up" || value === "down" ? value : "";
}

function cleanMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw)) {
    const key = String(id || "").slice(0, 80);
    const vote = cleanChoice(value);
    if (key && vote) out[key] = vote;
  }
  return out;
}

function cleanPending(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw)) {
    const key = String(id || "").slice(0, 80);
    if (!key) continue;
    if (value === "up" || value === "down" || value === "clear") out[key] = value;
  }
  return out;
}

function cleanTotals(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw)) {
    const key = String(id || "").slice(0, 80);
    if (!key || !value || typeof value !== "object") continue;
    out[key] = {
      up: Math.max(0, Math.round(Number(value.up) || 0)),
      down: Math.max(0, Math.round(Number(value.down) || 0)),
    };
  }
  return out;
}

export function normalizeVotes(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    mine: cleanMap(d.mine),
    community: cleanTotals(d.community),
    synced: cleanMap(d.synced),
    pending: cleanPending(d.pending),
  };
}

export function castVote(state, promptId, vote) {
  const id = String(promptId || "").trim().slice(0, 80);
  if (!id) {
    const err = new Error("Pick a prompt first.");
    err.status = 400;
    throw err;
  }
  const nextVote = vote === "clear" || vote === "none" || vote === "" ? "" : cleanChoice(vote);
  if (vote && vote !== "clear" && vote !== "none" && !nextVote) {
    const err = new Error("Choose thumbs up or thumbs down.");
    err.status = 400;
    throw err;
  }
  const next = normalizeVotes(state);
  if (nextVote) next.mine[id] = nextVote;
  else delete next.mine[id];
  const synced = next.synced[id] || "";
  const mine = next.mine[id] || "";
  if (mine === synced) delete next.pending[id];
  else next.pending[id] = mine || "clear";
  return next;
}

// Rows shaped like the Supabase table: one row per user and prompt.
export function upsertVoteRow(rows, { userId, promptId, vote }) {
  const user = String(userId || "");
  const id = String(promptId || "");
  const choice = vote === "clear" || vote === "none" || vote === "" ? "" : cleanChoice(vote);
  const kept = (rows || []).filter((row) => !(row.userId === user && row.promptId === id));
  if (choice) kept.push({ userId: user, promptId: id, vote: choice });
  return kept;
}

export function tallyVotes(rows) {
  const out = {};
  for (const row of rows || []) {
    const id = String(row.promptId || "");
    if (!id) continue;
    const t = out[id] || { up: 0, down: 0 };
    if (row.vote === "up") t.up += 1;
    else if (row.vote === "down") t.down += 1;
    out[id] = t;
  }
  return out;
}

export function countsFor(state, promptId) {
  const id = String(promptId || "");
  const base = state?.community?.[id] || { up: 0, down: 0 };
  let up = base.up;
  let down = base.down;
  const synced = state?.synced?.[id] || "";
  const mine = state?.mine?.[id] || "";
  if (synced === "up") up -= 1;
  if (synced === "down") down -= 1;
  if (mine === "up") up += 1;
  if (mine === "down") down += 1;
  return { up: Math.max(0, up), down: Math.max(0, down), mine: mine || null };
}

export function markSynced(state, promptId) {
  const next = normalizeVotes(state);
  const id = String(promptId || "");
  if (!id) return next;
  if (next.mine[id]) next.synced[id] = next.mine[id];
  else delete next.synced[id];
  delete next.pending[id];
  return next;
}
