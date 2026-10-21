// The router decides which AI gets which job, and how to do it for fewer credits.
// Score = learned capability (baseline + what the council taught us) minus a cost penalty
// whose weight depends on the mode. Providers that are red or have no key are excluded.
// With a track record for the task type (server/brain.js, Phase 28) quality, cost and speed come from it.
import { CAPABILITIES, PROVIDERS, TEXT_PROVIDERS, estimateCost, estimateCostAt, activeDiscount, nextDiscountStart, modelPrice } from "./registry.js";
import { demosHidden, realAiConnected } from "./demo-visibility.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc } from "./store.js";
import { extractJson } from "./providers.js";
import { getStatus } from "./health.js";
import { troubled, freeNow, completeFallback } from "./fallback.js";
import { adjust } from "./brain.js";
import { describePause } from "./pause.js";
import { unconnectedMcp } from "./provider-access.js";
import { planOf, applyPreferFree, readPreferFree } from "./plans.js";
import { bestModelEach, costWeight, normalizeMode, speedBoost } from "./modes.js";
import { applyLocalFirst, batchNote, isBlockedFree, isLocalFree, keepCheapestSeller } from "./savings.js";

const skills = () => doc("skills", () => ({})); // { modelId: { capability: { wins, total } } }

// What was learned on top of the baseline, kept apart by source: council votes (wins / rounds) and the
// person's own thumbs up / down (R4). Each source moves a capability only after 2 signals.
export function learnedDeltas(modelId) {
  const out = { council: {}, human: {} };
  const s = skills()[modelId];
  if (!s) return out;
  for (const cap of CAPABILITIES) {
    const r = s[cap];
    if (!r) continue;
    // shift by up to about ±20 points depending on win rate vs expected 1/N
    if (r.total >= 2) out.council[cap] = Math.round((r.wins / r.total - 0.35) * 30);
    // shift by up to ±12 points: all thumbs up +12, all down -12
    const n = (r.up || 0) + (r.down || 0);
    if (n >= 2) out.human[cap] = Math.round(((r.up || 0) / n - 0.5) * 24);
  }
  return out;
}

export function learnedCaps(modelId, base) {
  const out = { ...base };
  const d = learnedDeltas(modelId);
  for (const cap of CAPABILITIES) {
    const delta = (d.council[cap] || 0) + (d.human[cap] || 0);
    if (cap in d.council || cap in d.human) out[cap] = Math.max(0, Math.min(100, (base[cap] || 50) + delta));
  }
  return out;
}

// One council round for a model (won or lost).
export function recordOutcome(modelId, capability, won) {
  const sk = skills();
  sk[modelId] ||= {};
  const r = (sk[modelId][capability] ||= { wins: 0, total: 0 });
  r.total++;
  if (won) r.wins++;
  putDoc("skills", sk);
}

// One human rating (R4). `prev` ({ capability, up }) is the earlier thumb on the same run and model,
// which this one replaces, so changing your mind never counts twice.
export function recordHuman(modelId, capability, up, prev = null) {
  const sk = skills();
  sk[modelId] ||= {};
  const row = (cap) => { const r = (sk[modelId][cap] ||= { wins: 0, total: 0 }); r.up ||= 0; r.down ||= 0; return r; };
  if (prev && CAPABILITIES.includes(prev.capability)) { const o = row(prev.capability); if (prev.up) o.up = Math.max(0, o.up - 1); else o.down = Math.max(0, o.down - 1); }
  const r = row(capability);
  if (up) r.up++; else r.down++;
  putDoc("skills", sk);
}
export const skillTable = () => skills();

export function availableModels() {
  const out = [];
  for (const p of TEXT_PROVIDERS) {
    const st = getStatus(p.id);
    const keyed = hasSecret(p.id, p.keyEnv);
    if (p.demo && (!keyed || demosHidden())) continue; // pretend AIs leave once a real AI is connected
    for (const m of p.models) {
      const d = activeDiscount(p.id);
      const pr = modelPrice(m.id);
      out.push({ provider: p.id, providerName: p.name, color: p.color, model: m.id, name: m.name, tier: m.tier, in: pr.in, out: pr.out, caps: learnedCaps(m.id, m.caps), baseCaps: m.caps, available: keyed && st.status !== "red", keyed, status: st.status, statusDetail: st.detail, balance: st.balance || null, discount: d ? { pct: d.pct, name: d.name } : null, web: !!m.web });
    }
  }
  return out;
}

// mode: max | quality | balanced | savings (alias: economy) | speed
export function rank({ capability = "reasoning", difficulty = 2, mode = "balanced", exclude = [], needWeb = false, estIn = 1500, estOut = 800, when = new Date(), small = false }) {
  mode = normalizeMode(mode) || "balanced";
  const weight = costWeight(mode);
  let list = availableModels().filter((m) => m.available && !exclude.includes(m.model) && (!needWeb || m.web) && !isBlockedFree(m) && !isBlockedFree(PROVIDERS[m.provider]));
  // A real job never goes to Nova, Atlas or Sage while a real AI is connected, even if demo mode was turned back on.
  if (realAiConnected()) list = list.filter((m) => !PROVIDERS[m.provider]?.demo);
  // spend caps (alerts plugin): a provider at 100% of its monthly cap gets no new work while another is available
  const capped = doc("alerts.state", () => null)?.stop || [];
  if (capped.length && list.some((m) => !capped.includes(m.provider))) list = list.filter((m) => !capped.includes(m.provider));
  // smart fallback (Phase 26): a provider that is out of credits, rate limited, refusing its key or unreachable
  // is skipped for new work while another is available; it comes back on the next good health check or call
  const skip = troubled();
  if (Object.keys(skip).length && list.some((m) => !skip[m.provider])) list = list.filter((m) => !skip[m.provider]);
  // paused (no credits, spending limit, payment required, rate limited) and an MCP that is not signed in
  // stay out of auto-picks while any other model can take the job
  const blocked = (m) => !!describePause(m.provider) || unconnectedMcp(m.provider);
  if (list.some((m) => !blocked(m))) list = list.filter((m) => !blocked(m));
  // balance-aware: a provider that is nearly out of prepaid credit is skipped while others exist
  const starved = (m) => m.balance && m.balance.unit === "USD" && m.balance.left != null && m.balance.left < 1;
  if (list.some((m) => !starved(m))) list = list.filter((m) => !starved(m));
  // Max quality keeps the best model each connected AI offers. Spend caps above still apply.
  // Prefer-free is skipped so a cheaper model does not replace that flagship.
  if (mode === "max") list = bestModelEach(list, capability);
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
    const penalty = Math.log10(1 + cost * 100) * 25 * weight;
    // health penalty: amber (incident, rate-limited, slow, low balance) costs 12 points; low prepaid balance another 8
    let health = 0, warnings = [];
    if (m.status === "amber") { health += 12; warnings.push(m.statusDetail || "amber"); }
    if (m.balance && m.balance.unit === "USD" && m.balance.left != null && m.balance.left < 5) { health += 8; warnings.push(`only $${m.balance.left} left`); }
    // small jobs (classify, QA, titles) go to a free tier the person has while its allowance lasts (Phase 26)
    const free = small && freeNow(m.provider, m.model);
    const bonus = free ? 40 : 0;
    const skipReason = skip[m.provider]?.reason || null;
    const plan = planOf(m.provider);
    const speed = learned ? learned.latencyPenalty : 0;
    const fast = speedBoost(mode, m.baseCaps?.fast ?? m.caps?.fast);
    const meta = PROVIDERS[m.provider];
    const localFree = isLocalFree(m, meta);
    const record = learned ? { jobs: learned.jobs, quality: learned.quality, base: learned.base, confidence: learned.confidence, avgCost: learned.avgCost, avgSec: learned.avgSec, failRate: learned.failRate, speedPenalty: speed } : null;
    return { ...m, estCost: free ? 0 : +cost.toFixed(5), listCost: +estimateCost(m.model, estIn, estOut).toFixed(5), quality: +quality.toFixed(1), healthPenalty: health, warnings, free, plan, localFree, skipped: skipReason, learned: record, score: +(q - penalty - health - speed + bonus + fast).toFixed(1) };
  });
  const ordered = applyLocalFirst(applyPreferFree(keepCheapestSeller(scored.sort((a, b) => b.score - a.score)), mode === "max" ? false : readPreferFree()), mode);
  return ordered;
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
  if (!best || !econ || best.model === econ.model) {
    const same = best?.estCost > 0 ? best : econ;
    return { best, econ, advice: null, savingsPct: 0, batchNote: batchNote(same?.provider, same?.estCost) };
  }
  const savings = best.estCost > 0 ? Math.round((1 - econ.estCost / best.estCost) * 100) : 0;
  const qualityDrop = Math.max(0, (best.caps[cls.capability] || 0) - (econ.caps[cls.capability] || 0));
  const advice = qualityDrop <= 12
    ? `${econ.name} can do this for about ${savings}% less than ${best.name} with little quality loss.`
    : `${econ.name} would be about ${savings}% cheaper, but it is noticeably weaker at ${cls.capability}. Keep ${best.name} for this one.`;
  const priced = best?.estCost > 0 ? best : econ;
  return { best, econ, advice, savingsPct: savings, qualityDrop, batchNote: batchNote(priced?.provider, priced?.estCost) };
}
