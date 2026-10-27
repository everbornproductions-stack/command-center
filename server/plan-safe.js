// A plan that names an AI or agent that cannot run right now (Antigravity, Grok Bot, an AI with no key) is
// re-planned on the AIs that are connected (0.4.21). Pure helpers: the mission planner passes in who is ready.
// A name only counts when a step hands work TO it ("ask Antigravity", "assigned to Grok Bot", an assignee field),
// and never when the person's own goal named it (then it is the subject, not the worker).
import { PROVIDERS } from "./registry.js";
import { localRouteName } from "./local-routes.js";

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// agents that are not providers, with the id the app uses for them
const AGENTS = [
  { id: "antigravity", name: "Antigravity", re: /\bantigravity\b/i },
  { id: "grokbot", name: "Grok Bot", re: /\bgrok[ -]?bot\b/i },
  { id: "claude-code", name: "Claude Code", re: /\bclaude code\b/i },
  { id: "codex", name: "Codex", re: /\bcodex\b/i },
  { id: "gemini-cli", name: "Gemini CLI", re: /\bgemini[ -]?cli\b/i },
];
const ASSIGN_FIELDS = ["agent", "assignee", "assignedTo", "assigned_to", "provider", "model", "ai", "tool", "worker", "owner", "use"];
const HANDOFF = (name) => new RegExp(`\\b(?:ask|have|let|use|using|via|through|hand(?:s|ed)?(?: this| it)? (?:off )?to|send(?:s)?(?: this| it)? to|delegate(?:s|d)? to|run(?:s)?(?: this| it)? (?:in|on|with)|assigned? to|handled by|done by|by|with|in)\\s+(?:the\\s+)?(?:${name})\\b`, "i");

function known() {
  const out = [...AGENTS];
  for (const p of Object.values(PROVIDERS)) {
    if (p.kind !== "text" || p.demo) continue;
    const names = [...new Set([p.name, p.vendor].filter(Boolean))];
    // "Grok" is the AI, "Grok Bot" is the agent; "Claude" is the AI, "Claude Code" is the app
    out.push({ id: p.id, name: p.name, re: new RegExp(`\\b(?:${names.map(esc).join("|")})\\b(?! ?(?:bot|code|cli)\\b)`, "i") });
  }
  return out;
}

// Names the plan hands work to that are not in `readyIds` and not in the person's goal.
export function unavailableNamed(plan, { goal = "", readyIds = new Set() } = {}) {
  const hits = [];
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  for (const k of known()) {
    if (readyIds.has(k.id) || k.re.test(String(goal))) continue;
    const handoff = HANDOFF(k.re.source.replace(/\\b/g, "\\b").replace(/^\\b|\\b$/g, ""));
    const named = tasks.some((t) => {
      const fields = ASSIGN_FIELDS.some((f) => typeof t?.[f] === "string" && k.re.test(t[f]));
      return fields || [t?.title, t?.instructions].some((s) => typeof s === "string" && k.re.test(s) && handoff.test(s));
    });
    if (named) hits.push({ id: k.id, name: k.name });
  }
  return hits;
}

// The planner's second try: same goal, with the people who cannot work named so it leaves them out.
export function replanLine(names, readyNames = []) {
  const who = readyNames.length ? ` The steps will be done by: ${readyNames.join(", ")}.` : "";
  return `\nThese AIs and agents cannot run right now: ${names.join(", ")}. Do not name them, ask them, or give them steps.${who} Plan every step for an AI that is connected.`;
}

// Last resort when the second plan still names them: drop the assignee fields and swap the name for plain words.
export function scrubUnavailable(plan, hits) {
  const tasks = (plan?.tasks || []).map((t) => {
    const n = { ...t };
    for (const f of ASSIGN_FIELDS) if (typeof n[f] === "string" && hits.some((h) => known().find((k) => k.id === h.id)?.re.test(n[f]))) delete n[f];
    for (const f of ["title", "instructions"]) {
      if (typeof n[f] !== "string") continue;
      for (const h of hits) { const k = known().find((x) => x.id === h.id); if (k) n[f] = n[f].replace(new RegExp(k.re.source, "gi"), "an available AI"); }
    }
    return n;
  });
  return { ...plan, tasks };
}

// 0.4.21 (dogfood 09): the plain name of the AI an id stands for. A step can be routed to an agent that is not
// set up (Antigravity, a plan route, an app), and those ids have no entry in PROVIDERS, so reading "name"
// straight off the registry stopped the mission with a raw program error. An id nothing knows has no name here.
export function stepAgentName(pid) {
  const id = typeof pid === "string" ? pid.trim() : "";
  if (!id) return "";
  return PROVIDERS[id]?.name || localRouteName(id) || "";
}

// The same step, handed to a working AI when its agent has no name (not set up, or gone). `ranked` is the
// working AIs, or a function that returns them (called only when the step needs one). Returns the fields to
// copy onto the step, or null when the step is fine as it is or no working AI is available.
export function handToWorkingAI(step, ranked = []) {
  const t = step && typeof step === "object" ? step : null;
  if (!t || t.agent || t.media || t.app || t.workaround) return null;
  if (stepAgentName(t.provider)) return null;
  const list = typeof ranked === "function" ? ranked() : ranked;
  const alt = (Array.isArray(list) ? list : []).find((r) => r && r.provider && stepAgentName(r.provider));
  if (!alt) return null;
  return {
    provider: alt.provider,
    model: alt.model,
    agentName: `${alt.providerName || stepAgentName(alt.provider)} · ${t.capability || "work"}`,
  };
}

// A capability the router does not know (the planner wrote "antigravity" or "grok bot" there) becomes plain reasoning.
const CAPS = new Set(["reasoning", "code", "writing", "research", "creative", "analysis", "math", "fast", "media", "agent"]);
export function cleanCapability(c, fallback = "reasoning") {
  const s = String(c || "").toLowerCase().trim();
  return CAPS.has(s) ? s : fallback;
}
