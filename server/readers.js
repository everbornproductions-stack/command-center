// Who will read this. Council, mission, and Refocus all use this list.
// It names the AIs and services that would receive the words. It does not send them.
import { rank, heuristicClassify } from "./router.js";
import { councilPlan, planMode, reviewMode, normalizeMode } from "./modes.js";
import { pickAgent } from "./agents.js";
import { searchSettings, resolveEngine } from "./search.js";
import { wantsSearch } from "./step-guard.js";
import { isDeadNow, heldByRealFailure } from "./health.js";
import { runnableOnly } from "./runnable.js";
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
  let list = [];
  try { list = runnableOnly(rankFn({ ...cls, mode: normalizeMode(mode) || "balanced" }) || []); } // only AIs that can run now
  catch { return []; }
  // 0.4.21 (dogfood 12): an AI that is out of credits, rate limited or holding after a real 402/429/403
  // is never named as the one that will plan or read, while any other AI can take the job.
  const live = list.filter((m) => { try { return !isDeadNow(m.provider) && !heldByRealFailure(m.provider); } catch { return true; } });
  return live.length ? live : list;
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

// 0.4.21 (dogfood 11, 12): will a web search really run for these words? The dialog must say the same thing
// as the run: needWeb false and nobody asking for search means no search row. A Mission searches only when the
// words or the request ask for it (and its switch or the classifier agrees); Single and Council also search on
// their own saved switch. No key, no search: a row only appears when an engine would really run it.
export function searchWillRun({ prompt = "", kind = "single", classification, search, settings } = {}) {
  if (search === false) return false;
  if (search === true) return true;
  if (search && typeof search === "object") return !!(search.council || search.mission);
  const cls = classification || heuristicClassify(String(prompt || ""));
  let on = false;
  try { on = !!(settings || searchSettings()).on?.[kind]; } catch { on = false; }
  if (kind === "mission") return wantsSearch(String(prompt || "")) && (on || !!cls?.needWeb);
  return on || !!cls?.needWeb;
}

// The engine a search would really use, as the row the dialog shows.
function liveSearch(kind = "single") {
  try {
    const eng = resolveEngine({});
    if (!eng?.engine) return false;
    return { council: kind !== "mission", mission: kind !== "council", id: `search:${eng.engine}`, name: eng.name || "Web search" };
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
export function whoWillRead({ prompt = "", mode = "balanced", classification, rankFn, search, agent, record, kind = "single" } = {}) {
  const priority = normalizeMode(mode) || "balanced";
  const cls = classification || heuristicClassify(String(prompt || ""));
  const useRank = rankFn || rank;
  const seats = takeUnique(safeRank(useRank, cls, priority), councilPlan(priority).members);
  // the AI that will really plan: the same pick the Mission planner makes (reasoning, hard), among AIs that can run
  const planner = safeRank(useRank, { ...cls, capability: "reasoning", difficulty: 3 }, planMode(priority))[0] || null;
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
  const look = search !== undefined ? search : (searchWillRun({ prompt, kind, classification: cls }) ? liveSearch(kind) : false);
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
    planner: planner ? { id: planner.provider, name: planner.providerName || planner.name || planner.provider } : null,
    out,
    readers: ordered.map((r) => (planner && r.id === planner.provider ? { ...r, role: "plan" } : r)),
    note: ordered.length ? "Nothing is sent until you click." : "No AI is available yet. Add a key in Settings. Nothing was sent.",
  };
}
