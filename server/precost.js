// 0.4.21 (Melius idea): one plain line BEFORE a run: "Free" or "About $0.02 on Claude".
// It reads the same ranking the router uses, so the line matches the AI that will probably answer.
// If build K's costText is present in the app (server/free-first.js), the wording matches it:
// "$0 (free: Groq)". Nothing here calls an AI or spends anything.
import { PROVIDERS } from "./registry.js";
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
  return lineFor(real[0] || null);
}
