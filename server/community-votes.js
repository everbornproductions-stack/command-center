// Shared prompt votes flow into the prompt library ranking.
// When server/prompts/votes.js from the prompt voting work is present, that store is used.
// Otherwise the same document shape is written so a later merge keeps these votes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const votesFile = path.join(dir, "prompts", "votes.js");
const rankFile = path.join(dir, "prompts", "rank.js");

function localPopularity(up, down) {
  const good = Math.max(0, Number(up) || 0) + 2;
  const bad = Math.max(0, Number(down) || 0) + 2;
  const n = good + bad;
  const z = 1.96;
  const z2 = z * z;
  const phat = good / n;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return (centre - margin) / denom;
}

function localLabel(up, down) {
  const good = Math.max(0, Number(up) || 0);
  const bad = Math.max(0, Number(down) || 0);
  if (good + bad === 0) return "No votes yet";
  return `${good} up, ${bad} down`;
}

function blankVotes() {
  return { mine: {}, community: {}, synced: {}, pending: {} };
}

function asVotes(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    mine: { ...(d.mine || {}) },
    community: { ...(d.community || {}) },
    synced: { ...(d.synced || {}) },
    pending: { ...(d.pending || {}) },
  };
}

export async function rankPromptRows(rows, now = Date.now()) {
  if (fs.existsSync(rankFile)) {
    const rank = await import("./prompts/rank.js");
    return rank.rankPrompts(rows, now);
  }
  const ranked = (rows || []).map((row) => ({
    ...row,
    up: Math.max(0, Number(row.up) || 0),
    down: Math.max(0, Number(row.down) || 0),
    popularity: localPopularity(row.up, row.down),
    scoreLabel: localLabel(row.up, row.down),
  }));
  ranked.sort((a, b) => b.popularity - a.popularity || String(a.title || a.id).localeCompare(String(b.title || b.id)));
  return ranked;
}

// mine is "up", "down", or "". others is everyone else's tally for this prompt.
export async function saveLibraryVote(h, { promptId, mine, others }) {
  const id = String(promptId || "").trim().slice(0, 80);
  if (!id) return null;
  const votes = fs.existsSync(votesFile) ? await import("./prompts/votes.js") : null;
  const kind = votes?.VOTE_KIND || "prompts.votes";
  const empty = votes?.emptyVotes ? votes.emptyVotes() : blankVotes();
  let state = votes?.normalizeVotes ? votes.normalizeVotes(h.doc(kind, () => empty)) : asVotes(h.doc(kind, () => empty));
  const choice = mine === "up" || mine === "down" ? mine : "clear";
  if (votes?.castVote) state = votes.castVote(state, id, choice);
  else if (choice === "up" || choice === "down") state.mine[id] = choice;
  else delete state.mine[id];
  state.community = {
    ...(state.community || {}),
    [id]: {
      up: Math.max(0, Number(others?.up) || 0),
      down: Math.max(0, Number(others?.down) || 0),
    },
  };
  if (state.synced) delete state.synced[id];
  h.putDoc(kind, state);
  const counts = votes?.countsFor
    ? votes.countsFor(state, id)
    : {
      up: (Number(others?.up) || 0) + (choice === "up" ? 1 : 0),
      down: (Number(others?.down) || 0) + (choice === "down" ? 1 : 0),
      mine: choice === "up" || choice === "down" ? choice : null,
    };
  const [ranked] = await rankPromptRows([{ id, title: id, up: counts.up, down: counts.down }]);
  return {
    integrated: !!votes,
    up: counts.up,
    down: counts.down,
    mine: counts.mine,
    scoreLabel: ranked?.scoreLabel || localLabel(counts.up, counts.down),
  };
}
