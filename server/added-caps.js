// What a user-added app or AI is good at. The name and model ids give a first guess.
// The person can name the task types instead. Scores from jobs then move the router
// (server/brain.js). No prompt text, no keys, no network.
import { CAPABILITIES } from "./registry.js";
import { adjust } from "./brain.js";

const HINTS = [
  ["code", /\b(code|coder|coding|aider|opencode|cursor|devstral|starcoder|codellama|codestral)\b/i],
  ["writing", /\b(write|writer|prose|copywriter)\b/i],
  ["research", /\b(research|search|sonar|perplex)\b/i],
  ["creative", /\b(creat|story|lyric|poet)\b/i],
  ["math", /\b(math|reasoner|solver)\b/i],
  ["analysis", /\b(analy|audit)\b/i],
  ["reasoning", /\b(reason|logic|think)\b/i],
  ["fast", /\b(fast|flash|mini|lite|small|haiku)\b/i],
];

// An unnamed gateway stays even, the same shape custom providers used before this.
const GENERAL = { reasoning: 75, code: 75, writing: 75, research: 70, creative: 72, analysis: 75, math: 72, fast: 75 };
const MATCH = 90;
const MISS = 46;

export function inferCapabilities({ name = "", models = [] } = {}) {
  const hay = `${name} ${(Array.isArray(models) ? models : []).join(" ")}`;
  const found = [];
  for (const [cap, re] of HINTS) if (re.test(hay)) found.push(cap);
  return found;
}

export function cleanCapabilities(list) {
  if (!Array.isArray(list)) {
    const err = new Error("capabilities must be a list of task types.");
    err.status = 400;
    throw err;
  }
  const out = [];
  for (const raw of list) {
    const cap = String(raw || "").trim().toLowerCase();
    if (!cap) continue;
    if (!CAPABILITIES.includes(cap)) {
      const err = new Error(`Unknown task type "${cap}".`);
      err.status = 400;
      throw err;
    }
    if (!out.includes(cap)) out.push(cap);
  }
  return out;
}

// Chosen or inferred task types score high. The others stay low so matching work wins.
// No signal at all keeps the even general scores.
export function capsFor(capabilities) {
  const list = (capabilities || []).filter((c) => CAPABILITIES.includes(c));
  const tasks = list.filter((c) => c !== "fast");
  if (!tasks.length && !list.includes("fast")) return { ...GENERAL };
  const caps = {};
  for (const cap of CAPABILITIES) {
    if (cap === "fast") caps.fast = list.includes("fast") ? 90 : 62;
    else caps[cap] = tasks.includes(cap) ? MATCH : MISS;
  }
  return caps;
}

export function profileFor({ name, models, capabilities, previous } = {}) {
  if (Array.isArray(capabilities)) {
    const list = cleanCapabilities(capabilities);
    return { capabilities: list, capabilitiesSource: list.length ? "chosen" : "general" };
  }
  if (previous?.capabilitiesSource === "chosen") {
    return { capabilities: previous.capabilities || [], capabilitiesSource: "chosen" };
  }
  const list = inferCapabilities({ name, models });
  return { capabilities: list, capabilitiesSource: list.length ? "name" : "general" };
}

// Scores that clearly beat the starting guess. The router already uses these jobs.
// This list is what the settings card shows.
export function learnedStrengths(models) {
  const out = [];
  for (const m of models || []) {
    const id = m.id || m;
    const base = m.caps || {};
    for (const cap of CAPABILITIES) {
      if (cap === "fast") continue;
      const learned = adjust({ model: id, baseCaps: base, capability: cap, difficulty: 2, mode: "balanced", estCost: 0 });
      if (!learned || learned.jobs < 4) continue;
      const start = base[cap] ?? 60;
      if (learned.quality >= start + 8) out.push({ model: id, capability: cap, jobs: learned.jobs, quality: learned.quality });
    }
  }
  return out;
}
