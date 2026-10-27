// 0.4.21 (Melius idea): one plain line BEFORE a run: "Free" or "About $0.02 on Claude".
// It reads the same ranking the router uses, so the line matches the AI that will probably answer.
// If build K's costText is present in the app (server/free-first.js), the wording matches it:
// "$0 (free: Groq)". Nothing here calls an AI or spends anything.
import { PROVIDERS, estimateCost } from "./registry.js";
import { isDeadNow, heldByRealFailure } from "./health.js";
import { rank, heuristicClassify } from "./router.js";

const nameOf = (pid) => PROVIDERS[pid]?.name || pid;
const money = (n) => (n < 0.01 ? "less than 1 cent" : `$${n.toFixed(2)}`);

// Pure: turn the top ranked row into the line.
export function lineFor(row, { steps = 1 } = {}) {
  if (!row) return { line: "", free: null, usd: null, ai: "" };
  const ai = nameOf(row.provider);
  const free = !!(row.free || row.localFree || row.plan || !(row.estCost > 0));
  if (free) return { line: row.plan ? `Free: uses your ${ai} plan` : `Free: ${ai}`, free: true, usd: 0, ai };
  const usd = +(row.estCost * Math.max(1, steps)).toFixed(4);
  return { line: `About ${money(usd)} on ${ai}`, free: false, usd, ai };
}

export function preRunLine({ prompt = "", mode = "balanced" } = {}) {
  const text = String(prompt || "").trim();
  if (text.length < 3) return { line: "", free: null, usd: null, ai: "" };
  let cls = { capability: "reasoning", difficulty: 2 };
  try { cls = heuristicClassify(text); } catch { /* keep the default */ }
  let rows = [];
  try {
    rows = rank({ capability: cls.capability, difficulty: cls.difficulty, mode, estIn: Math.ceil(text.length / 3) + 500, estOut: 800 });
  } catch { rows = []; }
  const real = rows.filter((r) => r.available !== false && !PROVIDERS[r.provider]?.demo);
  return lineFor(liveFirst(real)[0] || null);
}

// An AI that is out of credits or held after a real failure takes no new work, so the price shown is the one of
// the AI that will really answer (a stand-in is often far dearer than the dead first choice).
export function canTakeWork(row) { try { return !isDeadNow(row.provider) && !heldByRealFailure(row.provider); } catch { return true; } }
export function liveFirst(list) { const live = (list || []).filter(canTakeWork); return live.length ? live : list || []; }

// What a mission spends besides the work steps: the classifier, the planner, the assembler and one QA review per
// AI step. Each call has a realistic token count and is priced as the AI that will really run it ({ model, free }).
export const OVERHEAD_TOKENS = {
  classify: { in: 500, out: 120 },
  plan: { in: 900, out: 1000 },
  assemble: { inBase: 500, inPerStep: 700, out: 1200 },
  qa: { in: 1100, out: 180 },
};
const callUsd = (row, tin, tout) => (!row || row.free || row.localFree || row.plan || !row.model ? 0 : estimateCost(row.model, tin, tout));
export function overheadCost({ steps = 1, qa = true, classifier = null, planner = null, assembler = null, reviewers = [] } = {}) {
  const n = Math.max(1, steps), T = OVERHEAD_TOKENS;
  const parts = {
    classify: callUsd(classifier, T.classify.in, T.classify.out),
    plan: callUsd(planner, T.plan.in, T.plan.out),
    assemble: callUsd(assembler, T.assemble.inBase + T.assemble.inPerStep * n, T.assemble.out),
    qa: qa ? (reviewers.length ? reviewers : [null]).reduce((a, r) => a + callUsd(r, T.qa.in, T.qa.out), 0) : 0,
  };
  return { ...parts, total: parts.classify + parts.plan + parts.assemble + parts.qa };
}
