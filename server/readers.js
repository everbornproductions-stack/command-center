// Who will read this. Council, mission, and Refocus all use this list.
// It names the AIs and services that would receive the words. It does not send them.
import { rank, heuristicClassify } from "./router.js";
import { councilPlan, planMode, reviewMode, normalizeMode } from "./modes.js";
import { pickAgent } from "./agents.js";
import { searchSettings, resolveEngine } from "./search.js";
import { whyOut } from "./send-check.js";

function takeUnique(list, n) {
  const out = [];
  const seen = new Set();
  for (const m of list || []) {
    if (!m?.provider || seen.has(m.provider)) continue;
    seen.add(m.provider);
    out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

function safeRank(rankFn, cls, mode) {
  try { return rankFn({ ...cls, mode: normalizeMode(mode) || "balanced" }) || []; }
  catch { return []; }
}

function searchRows(search) {
  if (search === false || search == null) return [];
  const rows = [];
  const add = (on, id, name) => {
    if (!on) return;
    rows.push({ id, name, kind: "service", council: !!search.council, mission: !!search.mission, receives: "the search words" });
  };
  if (search.council || search.mission) add(true, search.id || "search", search.name || "Web search");
  if (rows.length) {
    rows[0].council = !!search.council;
    rows[0].mission = !!search.mission;
  }
  return rows;
}

function liveSearch() {
  try {
    const s = searchSettings();
    const on = s.on || {};
    if (!on.council && !on.mission) return false;
    const eng = resolveEngine({});
    if (!eng?.engine) return false;
    return { council: !!on.council, mission: !!on.mission, id: `search:${eng.engine}`, name: eng.name || "Web search" };
  } catch { return false; }
}

function agentRow(agent) {
  if (!agent?.use) return null;
  const id = agent.agent?.id || agent.id;
  const name = agent.agent?.name || agent.name;
  if (!id || !name) return null;
  return { id, name, kind: "service", council: true, mission: true, receives: "the step that needs a signed-in service" };
}

export function orderReaders(readers, record) {
  const score = new Map((record?.ais || []).map((a) => [a.id, Number(a.n) || 0]));
  return [...(readers || [])].sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0));
}

// rankFn, search, and agent can be passed in tests. Otherwise the live router, search
// settings, and agent picker are used. Nothing in this function leaves the computer.
export function whoWillRead({ prompt = "", mode = "balanced", classification, rankFn, search, agent, record } = {}) {
  const priority = normalizeMode(mode) || "balanced";
  const cls = classification || heuristicClassify(String(prompt || ""));
  const useRank = rankFn || rank;
  const seats = takeUnique(safeRank(useRank, cls, priority), councilPlan(priority).members);
  const planner = safeRank(useRank, cls, planMode(priority))[0] || null;
  const reviewer = safeRank(useRank, cls, reviewMode(priority))[0] || null;
  const missionIds = new Set(seats.map((m) => m.provider));
  for (const m of [planner, reviewer]) if (m?.provider) missionIds.add(m.provider);
  const councilIds = new Set(seats.map((m) => m.provider));
  const readers = [];
  const seen = new Set();
  const addAi = (m) => {
    if (!m?.provider || seen.has(m.provider)) return;
    seen.add(m.provider);
    readers.push({
      id: m.provider,
      name: m.providerName || m.name || m.provider,
      model: m.model || null,
      kind: "ai",
      council: councilIds.has(m.provider),
      mission: missionIds.has(m.provider),
      receives: "the orders and the short excerpts",
    });
  };
  for (const m of seats) addAi(m);
  addAi(planner);
  addAi(reviewer);
  const picked = agent !== undefined ? agent : (() => { try { return pickAgent({ prompt: String(prompt || "") }); } catch { return { use: false }; } })();
  const extra = agentRow(picked);
  if (extra && !seen.has(extra.id)) { seen.add(extra.id); readers.push(extra); }
  const look = search !== undefined ? search : liveSearch();
  for (const row of searchRows(look)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    readers.push(row);
  }
  // 0.4.21: an AI that is out of credits is dropped from the readers and listed with an "out of credits" tag
  const out = [];
  const live = readers.filter((r) => {
    if (r.kind !== "ai") return true;
    let w = null; try { w = whyOut(r.id); } catch { /* unknown AI: keep it */ }
    if (!w) return true;
    out.push({ id: r.id, name: r.name, kind: w.kind, tag: w.kind === "credits" ? "out of credits" : w.kind === "rate" ? "busy right now" : "not available" });
    return false;
  });
  const ordered = orderReaders(live, record);
  return {
    heading: "Who will read this",
    out,
    readers: ordered,
    note: ordered.length ? "Nothing is sent until you click." : "No AI is available yet. Add a key in Settings. Nothing was sent.",
  };
}
