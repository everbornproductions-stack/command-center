// Outside agents on the hub (Phase 12): Grok Bot and the built-in browser helper (Phase 27) get their own
// cards next to Claude, ChatGPT, Grok and Gemini, with a status light and what they are doing right now.
// They ride along in the provider list with kind "agent"; they are never in PROVIDERS, so the text router,
// health checks and key cards leave them alone.
// Councils and missions pick at most one agent per job through pickAgent(): Grok Bot when it is set up and
// fits, else the browser helper (for people without Grok Bot), never for plain text work.
import * as GB from "./grokbot.js";
import * as BH from "./browser.js";

// want(): does this one step fit the agent (used once the mission's agent is chosen)
const adapter = (M) => ({ id: M.AGENT_ID, name: M.NAME, dispatch: M.dispatch, awaitJob: M.awaitJob, waitMs: M.waitMs, STATUS_LABEL: M.STATUS_LABEL, TAGS: M.TAGS, TAG_LABEL: M.TAG_LABEL, readiness: M.readiness, want: ({ prompt, explicit }) => M.wantAgent({ prompt, explicit }) });
export const AGENTS = { [GB.AGENT_ID]: adapter(GB), [BH.AGENT_ID]: adapter(BH) };
export const agentById = (id) => AGENTS[id] || AGENTS[GB.AGENT_ID];
export const agentName = (id) => AGENTS[id]?.name || id;
export const cancelAgentJob = (id, why) => (String(id).startsWith("bh-") ? BH.stopJob(id, why) : GB.cancelJob(id, why));

// Grok Bot counts as "set up" once its connection is saved or its mock is on: then it takes these jobs, and
// the helper only joins when the person asks for it (even on a run where Grok Bot is left out).
const grokbotSetUp = () => { const c = GB.configView(); return !!(c.mock || (c.urlSaved && c.keySaved)); };

// explicit flags: true (always), false (never), undefined (decide by what the job needs)
export function pickAgent({ prompt, grokbot, browser } = {}) {
  const g = GB.wantAgent({ prompt, explicit: grokbot });
  if (g.use) return { ...g, agent: AGENTS[GB.AGENT_ID] };
  const b = BH.wantAgent({ prompt, explicit: browser, grokbotSetUp: grokbotSetUp() });
  if (b.use) return { ...b, agent: AGENTS[BH.AGENT_ID] };
  return { use: false, needs: g.needs, reason: g.reason, agent: null };
}

// Missions: which agent the planner may hand steps to (null: none).
export function missionAgent({ grokbot, browser } = {}) {
  if (grokbot !== false && GB.readiness().ready && (grokbot === true || GB.settings().auto)) return AGENTS[GB.AGENT_ID];
  if (browser !== false && BH.readiness().ready && (browser === true || (BH.settings().auto && !grokbotSetUp()))) return AGENTS[BH.AGENT_ID];
  return null;
}

export function onAnyJobFinished(fn) { GB.onJobFinished(fn); BH.onJobFinished(fn); }

export const hubAgents = () => [GB.hubCard(), BH.hubCard()];
export const AGENT_IDS = new Set([GB.AGENT_ID, BH.AGENT_ID]);
