// The router decides which AI gets which job, and how to do it for fewer credits.
// Score = learned capability (baseline + what the council taught us) minus a cost penalty
// whose weight depends on the mode. Providers that are red or have no key are excluded.
// With a track record for the task type (server/brain.js, Phase 28) quality, cost and speed come from it.
import { CAPABILITIES, TEXT_PROVIDERS, estimateCost, estimateCostAt, activeDiscount, nextDiscountStart, modelPrice } from "./registry.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc } from "./store.js";
import { extractJson } from "./providers.js";
import { getStatus } from "./health.js";
import { troubled, freeNow, completeFallback } from "./fallback.js";
import { adjust } from "./brain.js";

const skills = () => doc("skills", () => ({})); // { modelId: { capability: { wins, total } } }

export function learnedCaps(modelId, base) {
  const out = { ...base };
  const s = skills()[modelId];
  if (!s) return out;
  for (const cap of CAPABILITIES) {
    const r = s[cap];
    if (r && r.total >= 2) {
      // shift baseline by up to ±12 points depending on win rate vs expected 1/N
      const rate = r.wins / r.total;
      out[cap] = Math.max(0, Math.min(100, (base[cap] || 50) + Math.round((rate - 0.35) * 30)));
    }
  }
  return out;
}

export function recordOutcome(modelId, capability, won) {
  const sk = skills();
  sk[modelId] ||= {};
  const r = (sk[modelId][capability] ||= { wins: 0, total: 0 });
  r.total++;
  if (won) r.wins++;
  putDoc("skills", sk);
}
export const skillTable = () => skills();

export function availableModels() {
  const out = [];
  for (const p of TEXT_PROVIDERS) {
    const st = getStatus(p.id);
    const keyed = hasSecret(p.id, p.keyEnv);
    if (p.demo && !keyed) continue; // demo AIs only exist for users who turned demo mode on
    for (const m of p.models) {
      const d = activeDiscount(p.id);
      const pr = modelPrice(m.id);
      out.push({ provider: p.id, providerName: p.name, color: p.color, model: m.id, name: m.name, tier: m.tier, in: pr.in, out: pr.out, caps: learnedCaps(m.id, m.caps), baseCaps: m.caps, available: keyed && st.status !== "red", keyed, status: st.status, statusDetail: st.detail, balance: st.balance || null, discount: d ? { pct: d.pct, name: d.name } : null, web: !!m.web });
    }
  }
  return out;
}

// mode: quality | balanced | economy
export function rank({ capability = "reasoning", difficulty = 2, mode = "balanced", exclude = [], needWeb = false, estIn = 1500, estOut = 800, when = new Date(), small = false }) {
  const costWeight = { quality: 0.15, balanced: 0.5, economy: 1.1 }[mode] ?? 0.5;
  let list = availableModels().filter((m) => m.available && !exclude.includes(m.model) && (!needWeb || m.web));
  // spend caps (alerts plugin): a provider at 100% of its monthly cap gets no new work while another is available
  const capped = doc("alerts.state", () => null)?.stop || [];
  if (capped.length && list.some((m) => !capped.includes(m.provider))) list = list.filter((m) => !capped.includes(m.provider));
  // smart fallback (Phase 26): a provider that is out of credits, rate limited, refusing its key or unreachable
  // is skipped for new work while another is available; it comes back on the next good health check or call
  const skip = troubled();
  if (Object.keys(skip).length && list.some((m) => !skip[m.provider])) list = list.filter((m) => !skip[m.provider]);
  // balance-aware: a provider that is nearly out of prepaid credit is skipped while others exist
  const starved = (m) => m.balance && m.balance.unit === "USD" && m.balance.left != null && m.balance.left < 1;
  if (list.some((m) => !starved(m))) list = list.filter((m) => !starved(m));
  const scored = list.map((m) => {
    const est = estimateCostAt(m.model, estIn, estOut, when);
    // learning router (Phase 28): the person's own track record for this task type, when there is one,
    // replaces the older skills shift: base score blended with the record, cost per job, speed
    const learned = adjust({ model: m.model, baseCaps: m.baseCaps, capability, difficulty, mode, estCost: est });
    const cost = learned ? learned.cost : est;
    const quality = learned ? learned.quality : m.caps[capability] ?? 60;
    // hard tasks need quality; easy ones mostly need to be done
    const q = difficulty >= 3 ? quality : difficulty === 2 ? quality * 0.85 + 10 : quality * 0.6 + 30;
    // cost penalty scaled so $0.10 per task ≈ 25 points at weight 1
    const penalty = Math.log10(1 + cost * 100) * 25 * costWeight;
    // health penalty: amber (incident, rate-limited, slow, low balance) costs 12 points; low prepaid balance another 8
    let health = 0, warnings = [];
    if (m.status === "amber") { health += 12; warnings.push(m.statusDetail || "amber"); }
    if (m.balance && m.balance.unit === "USD" && m.balance.left != null && m.balance.left < 5) { health += 8; warnings.push(`only $${m.balance.left} left`); }
    // small jobs (classify, QA, titles) go to a free tier the person has while its allowance lasts (Phase 26)
    const free = small && freeNow(m.provider, m.model);
    const bonus = free ? 40 : 0;
    const skipReason = skip[m.provider]?.reason || null;
    const speed = learned ? learned.latencyPenalty : 0;
    const record = learned ? { jobs: learned.jobs, quality: learned.quality, base: learned.base, confidence: learned.confidence, avgCost: learned.avgCost, avgSec: learned.avgSec, failRate: learned.failRate, speedPenalty: speed } : null;
    return { ...m, estCost: free ? 0 : +cost.toFixed(5), listCost: +estimateCost(m.model, estIn, estOut).toFixed(5), quality: +quality.toFixed(1), healthPenalty: health, warnings, free, skipped: skipReason, learned: record, score: +(q - penalty - health - speed + bonus).toFixed(1) };
  });
  return scored.sort((a, b) => b.score - a.score);
}

// Would waiting for a discount window save real money on this job? Looks 48 h ahead.
export function deferAdvice(cls, mode = "balanced") {
  const now = pick({ ...cls, mode });
  if (!now) return null;
  let best = null;
  for (const p of TEXT_PROVIDERS) {
    const nx = nextDiscountStart(p.id);
    if (!nx) continue;
    const later = rank({ ...cls, mode, when: nx.at }).find((m) => m.provider === p.id);
    if (!later) continue;
    const saving = now.estCost > 0 ? 1 - later.estCost / now.estCost : 0;
    const qualityDrop = Math.max(0, (now.caps[cls.capability] || 0) - (later.caps[cls.capability] || 0));
    if (saving >= 0.2 && qualityDrop <= 12 && (!best || saving > best.saving)) best = { at: nx.at, rule: nx.rule.name, pct: nx.rule.pct, provider: p.id, model: later.name, saving: Math.round(saving * 100), nowModel: now.name, nowCost: now.estCost, laterCost: later.estCost };
  }
  return best;
}
export function nextDiscountWindow(from = new Date()) {
  let best = null;
  for (const p of TEXT_PROVIDERS) { const nx = nextDiscountStart(p.id, from); if (nx && (!best || nx.at < best.at)) best = { ...nx, provider: p.id }; }
  return best;
}

export function pick(opts) {
  return rank(opts)[0] || null;
}

// Which model is cheap and available for housekeeping (classification, planning helpers)?
export function cheapest(needQuality = 70) {
  const list = rank({ capability: "fast", difficulty: 1, mode: "economy", small: true }).filter((m) => (m.caps.reasoning || 0) >= needQuality);
  return list[0] || rank({ mode: "economy", small: true })[0] || null;
}

const KEYWORDS = {
  code: /\b(code|script|function|bug|api|javascript|python|typescript|html|css|sql|regex|deploy|github|node|react)\b/i,
  research: /\b(research|find out|latest|news|compare prices|who is|what is the current|statistics|sources|cite|look up|market)\b/i,
  creative: /\b(story|lyrics|song|poem|video|script for|caption|hook|slogan|brand|creative|storyboard|scene|reel)\b/i,
  writing: /\b(write|draft|email|blog|post|article|copy|rewrite|edit|summar|outline|proposal|letter)\b/i,
  math: /\b(calculate|math|equation|percent|forecast|projection|budget|roi|numbers)\b/i,
  analysis: /\b(analy|evaluate|assess|review|audit|pros and cons|decide|strategy|plan)\b/i,
};

export function heuristicClassify(prompt) {
  let capability = "reasoning";
  let best = 0;
  for (const [cap, re] of Object.entries(KEYWORDS)) {
    const n = (prompt.match(new RegExp(re.source, "gi")) || []).length;
    if (n > best) { best = n; capability = cap; }
  }
  const len = prompt.length;
  const difficulty = len > 1200 || /\b(detailed|comprehensive|complete|full|entire|end-to-end)\b/i.test(prompt) ? 3 : len > 250 ? 2 : 1;
  return { capability, difficulty, needWeb: /\b(latest|today|current|news|2026|price of|this week)\b/i.test(prompt), source: "heuristic" };
}

// Ask the cheapest model to classify; fall back to keywords.
export async function classify(prompt, { onCall } = {}) {
  const h = heuristicClassify(prompt);
  const m = cheapest(68);
  if (!m) return h;
  try {
    const t0 = Date.now();
    // a small job: free tiers first, and a stand-in if the cheap model's provider is out of credits (Phase 26)
    const r = await completeFallback({
      provider: m.provider, model: m.model, maxTokens: 200,
      system: `Classify the user's request. Reply with JSON only: {"capability": one of ${JSON.stringify(CAPABILITIES.filter((c) => c !== "fast"))}, "difficulty": 1|2|3 (1 trivial, 2 normal, 3 hard/long), "needWeb": boolean (true only if the answer depends on live/current information), "summary": "<=8 words"}`,
      messages: [{ role: "user", content: prompt.slice(0, 4000) }],
    }, { role: "classify", small: true, cls: { capability: "fast", difficulty: 1 }, mode: "economy", tools: false });
    onCall?.({ provider: r.provider, model: r.model, usage: r.usage, ms: Date.now() - t0, role: "classify" });
    const j = extractJson(r.text);
    if (j?.capability && CAPABILITIES.includes(j.capability)) {
      return { capability: j.capability, difficulty: Math.min(3, Math.max(1, Number(j.difficulty) || 2)), needWeb: !!j.needWeb, summary: j.summary || "", source: m.model };
    }
  } catch {}
  return h;
}

// Plain-English "do it for less" advice for a prompt.
export function cheaperRoute(cls) {
  const best = pick({ ...cls, mode: "quality" });
  const econ = pick({ ...cls, mode: "economy" });
  if (!best || !econ || best.model === econ.model) return { best, econ, advice: null, savingsPct: 0 };
  const savings = best.estCost > 0 ? Math.round((1 - econ.estCost / best.estCost) * 100) : 0;
  const qualityDrop = Math.max(0, (best.caps[cls.capability] || 0) - (econ.caps[cls.capability] || 0));
  const advice = qualityDrop <= 12
    ? `${econ.name} can do this for about ${savings}% less than ${best.name} with little quality loss.`
    : `${econ.name} would be about ${savings}% cheaper, but it is noticeably weaker at ${cls.capability}. Keep ${best.name} for this one.`;
  return { best, econ, advice, savingsPct: savings, qualityDrop };
}
