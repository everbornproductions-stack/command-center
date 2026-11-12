// The router decides which AI gets which job, and how to do it for fewer credits.
// Score = learned capability (baseline + what the council taught us) minus a cost penalty
// whose weight depends on the mode. Providers that are red or have no key are excluded.
// With a track record for the task type (server/brain.js, Phase 28) quality, cost and speed come from it.
import { CAPABILITIES, PROVIDERS, TEXT_PROVIDERS, estimateCost, estimateCostAt, activeDiscount, nextDiscountStart, modelPrice, findModel, isLiteModel, isLongOutputJob, knownPrice, livePrice, tierByPrice } from "./registry.js";
import { demosHidden, realAiCanAnswer } from "./demo-visibility.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc, ctx } from "./store.js";
import { extractJson } from "./providers.js";
import { getStatus } from "./health.js";
import { troubled, troubledModels, modelKey, freeNow, completeFallback } from "./fallback.js";
import { adjust } from "./brain.js";
import { describePause } from "./pause.js";
import { unconnectedMcp } from "./provider-access.js";
import { planOf, applyPreferFree, readPreferFree, readPlanFirst } from "./plans.js";
import { bestModelEach, costWeight, normalizeMode, speedBoost } from "./modes.js";
import { applyLocalFirst, batchNote, isBlockedFree, isLocalFree, keepCheapestSeller } from "./savings.js";
import { extraRouteModels } from "./route-extras.js";
import { searchCoversAnyModel } from "./search.js";
import { applyTune } from "./learn-tune.js";
import { freeOnlyOn, isFreeModel, costTier, isPlanProvider, GROKBOT_TEXT } from "./free-first.js";

// 0.4.27 (dogfood 2026-10-30): the apps on this PC that answer through a whole agent run (Claude Code, Codex and
// Gemini CLI through the person's plan, Antigravity, Grok Bot) take a minute or more per step. A plain text step
// does not need their tools, so they go after the fast API models, never in front of them.
export function isSlowAgent(m) {
  if (!m) return false;
  const pid = typeof m === "string" ? m : m.provider;
  if (typeof m === "object" && m.planRoute) return true;
  return isPlanProvider(pid) || pid === "antigravity" || pid === "opencode" || pid === GROKBOT_TEXT || PROVIDERS[pid]?.kind === "agent";
}
// Points a slow agent loses on a step that needs no tools. Max quality keeps the old ranking.
export const AGENT_PENALTY = { savings: 30, speed: 40, balanced: 15, quality: 8, max: 0 };
// Max savings and Speed: every fast free API model (and this PC) goes before a slow agent on a text step.
const FAST_FIRST_MODES = new Set(["savings", "speed"]);

// "Use my plan first" keeps its locked order: this PC, free allowances, then the login, then paid API. The old
// check read a free Gemini or Groq model as paid on any job that was not "small" (its list price is above 0),
// so the login jumped in front of every free model. The cost tier says what a model really costs.
export function placePlanRows(scored, on = readPlanFirst()) {
  if (!on || !Array.isArray(scored) || scored.length < 2) return scored;
  const plan = scored.filter((m) => m.planRoute);
  if (!plan.length) return scored;
  const rest = scored.filter((m) => !m.planRoute);
  const at = rest.findIndex((m) => costTier(m.provider, m.model) >= 3 && !m.free && !m.localFree);
  const tagged = plan.map((m) => ({ ...m, planFirst: true }));
  if (at < 0) return [...rest, ...tagged];
  return [...rest.slice(0, at), ...tagged, ...rest.slice(at)];
}
// Max savings and Speed with no tools needed: slow agents go right after the last fast free row.
// Paid rows keep their place relative to each other.
export function fastFreeFirst(list) {
  if (!Array.isArray(list) || list.length < 2) return list;
  const slow = list.filter((m) => isSlowAgent(m));
  if (!slow.length) return list;
  const rest = list.filter((m) => !isSlowAgent(m));
  let lastFree = -1;
  rest.forEach((m, i) => { if (costTier(m.provider, m.model) <= 1) lastFree = i; });
  if (lastFree < 0) return list;
  const firstSlow = list.indexOf(slow[0]);
  const freeAfter = list.findIndex((m, i) => i > firstSlow && !isSlowAgent(m) && costTier(m.provider, m.model) <= 1);
  if (freeAfter < 0) return list; // already behind every free row
  return [...rest.slice(0, lastFree + 1), ...slow, ...rest.slice(lastFree + 1)];
}

// Triage tiers (four gates). A trivial job raises the cost weight and lifts economy models a little; a top job
// cuts the cost weight and lifts flagships a little. Standard (2) and hard (3) jobs are not touched.
export const TIER_TUNING = { trivialCostScale: 1.5, economyBonus: 4, topCostWeight: 0.25, flagshipBonus: 6 };
const TIER_RANK = { economy: 1, balanced: 2, flagship: 3 };
// Equal scores between models of different registry tiers: the cheaper one goes first, unless the job is
// high stakes, where the bigger model goes first. Same tier or an unknown tier keeps today's order.
export function tieBreak(a, b, stakes = false) {
  const ra = TIER_RANK[a?.modelTier] || 0, rb = TIER_RANK[b?.modelTier] || 0;
  if (!ra || !rb || ra === rb) return 0;
  if (stakes) return rb - ra;
  return ((a.estCost || 0) - (b.estCost || 0)) || (ra - rb);
}

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
// Clears thumbs only. Council wins and rounds stay.
export function clearHumanRatings() {
  const sk = skills();
  for (const model of Object.keys(sk)) {
    for (const cap of Object.keys(sk[model] || {})) {
      const r = sk[model][cap];
      if (!r) continue;
      r.up = 0;
      r.down = 0;
    }
  }
  putDoc("skills", sk);
}
export const skillTable = () => skills();

// Accepted model switches (Phase 32). Read only. Missing state changes nothing.
function routeOverlay() {
  try {
    const d = ctx().docs["modelwatch.state"];
    if (!d || !Array.isArray(d.accepted)) return [];
    return d.accepted.filter((r) => r && r.provider && r.hide && r.model?.id);
  } catch { return []; }
}

// A custom provider's ladder from the prices known right now (live prices can arrive after it was registered).
// A model with no known price keeps the tier it was registered with. Built-in tiers never change.
function customTiers(p) {
  if (!p?.custom) return null;
  const rows = p.models.map((m) => { const pr = knownPrice(m.id); return { id: m.id, tier: m.tier || (m.default ? "balanced" : "economy"), in: pr ? pr.in : null, out: pr ? pr.out : null }; });
  return new Map(tierByPrice(rows).map((m) => [m.id, m.tier]));
}
// The tier for a model-watch row: from the provider's price ladder when the row has a saved or live price,
// else the tier of the model it replaces.
function overlayTier(p, row, donor) {
  const saved = Number.isFinite(row.in) || Number.isFinite(row.out);
  const live = livePrice(row.id);
  if (!saved && !live) return donor.tier;
  const price = saved ? { in: Number.isFinite(row.in) ? row.in : 0, out: Number.isFinite(row.out) ? row.out : 0 } : { in: Number(live.in) || 0, out: Number(live.out) || 0 };
  const ladder = tierByPrice([...p.models.filter((m) => m.id !== row.id).map((m) => { const pr = modelPrice(m.id); return { id: m.id, tier: m.tier, in: pr.in, out: pr.out }; }), { id: row.id, tier: donor.tier, ...price }]);
  return ladder.find((m) => m.id === row.id)?.tier || donor.tier;
}

export function availableModels() {
  const routes = routeOverlay();
  const out = [];
  for (const p of TEXT_PROVIDERS) {
    const st = getStatus(p.id);
    const keyed = hasSecret(p.id, p.keyEnv);
    if (p.demo && (!keyed || demosHidden())) continue; // pretend AIs leave once a real AI is connected
    const hidden = new Set(routes.filter((r) => r.provider === p.id).map((r) => r.hide));
    const d = activeDiscount(p.id);
    const ladder = customTiers(p);
    for (const m of p.models) {
      if (hidden.has(m.id)) continue;
      const pr = modelPrice(m.id);
      out.push({ provider: p.id, providerName: p.name, color: p.color, model: m.id, name: m.name, tier: ladder?.get(m.id) || m.tier, in: pr.in, out: pr.out, caps: learnedCaps(m.id, m.caps), baseCaps: m.caps, available: keyed && st.status !== "red", keyed, status: st.status, statusDetail: st.detail, balance: st.balance || null, discount: d ? { pct: d.pct, name: d.name } : null, web: !!m.web });
    }
    for (const r of routes) {
      if (r.provider !== p.id || out.some((x) => x.model === r.model.id)) continue;
      const donor = p.models.find((m) => m.id === r.hide) || p.models.find((m) => m.default) || p.models[0];
      if (!donor) continue;
      const prIn = r.model.in == null || r.model.in === "" ? NaN : Number(r.model.in);
      const prOut = r.model.out == null || r.model.out === "" ? NaN : Number(r.model.out);
      const price = { in: Number.isFinite(prIn) ? prIn : donor.in, out: Number.isFinite(prOut) ? prOut : donor.out };
      const tier = overlayTier(p, { id: r.model.id, in: prIn, out: prOut }, donor);
      out.push({ provider: p.id, providerName: p.name, color: p.color, model: r.model.id, name: r.model.name || r.model.id, tier, in: price.in, out: price.out, caps: learnedCaps(r.model.id, donor.caps), baseCaps: donor.caps, available: keyed && st.status !== "red", keyed, status: st.status, statusDetail: st.detail, balance: st.balance || null, discount: d ? { pct: d.pct, name: d.name } : null, web: false });
    }
  }
  for (const row of extraRouteModels()) out.push(row);
  return out;
}

// mode: max | quality | balanced | savings (alias: economy) | speed
// needTools: the step must use files or tools itself, so a slow agent app is not held back.
// longOutput: the step writes a long answer (code, a page, a document); the smallest lite models sit out while
// another model can take it. Left out, it follows the task type (code, or writing that is not trivial).
// providers: only models of these provider ids are ranked (after the availability filters). Left out, every provider.
// gates: the triage gates from classify(); gates.stakes breaks a tie between tiers toward the bigger model.
export function rank({ capability = "reasoning", difficulty = 2, mode = "balanced", exclude = [], needWeb = false, estIn = 1500, estOut = 800, when = new Date(), small = false, includeApps = false, needTools = false, longOutput = null, providers = null, gates = null }) {
  mode = normalizeMode(mode) || "balanced";
  const long = longOutput == null ? (!small && isLongOutputJob({ capability, difficulty })) : !!longOutput;
  // Triage tiers: a trivial job leans on price and economy models, a top job on quality and flagships.
  // Standard and hard jobs keep the weights they always had.
  const level = Number(difficulty);
  let weight = costWeight(mode);
  if (level === 1) weight *= TIER_TUNING.trivialCostScale;
  else if (level >= 4) weight = Math.min(weight, TIER_TUNING.topCostWeight);
  const tierBonus = (m) => (level === 1 && m.tier === "economy" ? TIER_TUNING.economyBonus : level >= 4 && m.tier === "flagship" ? TIER_TUNING.flagshipBonus : 0);
  const only = Array.isArray(providers) && providers.length ? new Set(providers.map(String)) : null;
  const covered = !!needWeb && searchCoversAnyModel();
  let list = availableModels().filter((m) => m.available && !exclude.includes(m.model) && (!needWeb || covered || m.web) && !isBlockedFree(m) && !isBlockedFree(PROVIDERS[m.provider]));
  // Allowed programs are scored with the same formula, then listed after the text models.
  // Text jobs, pick(), and missions keep the text ranking unless the caller asks for apps.
  if (!includeApps) list = list.filter((m) => m.kind !== "app");
  // A real job never goes to Nova, Atlas or Sage while a real AI is connected, even if demo mode was turned back on.
  // A tools server, app, CLI or sign-in alone cannot answer, so the demos stay in the ranking then.
  if (realAiCanAnswer()) list = list.filter((m) => !PROVIDERS[m.provider]?.demo);
  // spend caps (alerts plugin): a provider at 100% of its monthly cap gets no new work while another is available
  const capped = doc("alerts.state", () => null)?.stop || [];
  if (capped.length && list.some((m) => !capped.includes(m.provider))) list = list.filter((m) => !capped.includes(m.provider));
  // smart fallback (Phase 26): a provider that is out of credits, rate limited, refusing its key or unreachable
  // is skipped for new work while another is available; it comes back on the next good health check or call
  const skip = troubled();
  if (Object.keys(skip).length && list.some((m) => !skip[m.provider])) list = list.filter((m) => !skip[m.provider]);
  const bench = troubledModels();
  // paused (no credits, spending limit, payment required, rate limited) and an MCP that is not signed in
  // stay out of auto-picks while any other model can take the job
  const blocked = (m) => !!describePause(m.provider) || unconnectedMcp(m.provider);
  if (list.some((m) => !blocked(m))) list = list.filter((m) => !blocked(m));
  // balance-aware: a provider that is nearly out of prepaid credit is skipped while others exist
  const starved = (m) => m.balance && m.balance.unit === "USD" && m.balance.left != null && m.balance.left < 1;
  if (list.some((m) => !starved(m))) list = list.filter((m) => !starved(m));
  // 0.4.21 Free only (never spend money): only this PC and free-allowance AIs are ranked. Nothing paid, even when it is the only AI.
  const freeOnly = freeOnlyOn();
  if (freeOnly) list = list.filter((m) => isFreeModel(m.provider, m.model));
  // 0.4.21 Gemini check: a 429 or a 503 benches ONE model of a provider ("provider:model"), not all of them.
  // Checked after Free only, so a bench never empties the list while a model that can answer is left.
  if (Object.keys(bench).length && list.some((m) => !bench[modelKey(m.provider, m.model)])) list = list.filter((m) => !bench[modelKey(m.provider, m.model)]);
  // Provider-only pin: stay inside the named providers. Empty means nothing there can take the job.
  if (only) list = list.filter((m) => only.has(m.provider));
  // Max quality keeps the best model each connected AI offers. Spend caps above still apply.
  // Prefer-free is skipped so a cheaper model does not replace that flagship.
  if (mode === "max") list = bestModelEach(list, capability);
  // 0.4.27: long builds on Gemini Flash-Lite came back cut off (dogfood 2026-10-30). Lite sits out while a bigger model is left.
  if (long && list.some((m) => !isLiteModel(m.model))) list = list.filter((m) => !isLiteModel(m.model));
  const scoreOf = (m) => {
    let est = estimateCostAt(m.model, estIn, estOut, when);
    // A model accepted from the provider list is not in the built-in table yet. Use the price that was saved with the switch.
    if (est === 0 && !findModel(m.model) && ((m.in || 0) > 0 || (m.out || 0) > 0)) est = (estIn / 1e6) * (m.in || 0) + (estOut / 1e6) * (m.out || 0);
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
    // 0.4.21 free first for every job, not only small ones: this PC and free allowances with room left get a lift,
    // smaller for hard jobs, none when the person asked for Quality or Max quality. A paid AI wins when it pays off.
    const tier = costTier(m.provider, m.model);
    let freeFirst = 0;
    if (!small && mode !== "max" && mode !== "quality") {
      if (tier === 0) freeFirst = difficulty >= 3 ? 10 : 25;
      else if (tier === 1 && freeNow(m.provider, m.model)) freeFirst = difficulty >= 3 ? 6 : 18;
    }
    const bonus = (free ? 40 : 0) + freeFirst;
    const slowAgent = !needTools && isSlowAgent(m) ? (AGENT_PENALTY[mode] || 0) : 0;
    const skipReason = skip[m.provider]?.reason || bench[modelKey(m.provider, m.model)]?.reason || null;
    const plan = planOf(m.provider);
    const speed = learned ? learned.latencyPenalty : 0;
    const fast = speedBoost(mode, m.baseCaps?.fast ?? m.caps?.fast);
    const meta = PROVIDERS[m.provider];
    const localFree = isLocalFree(m, meta);
    const record = learned ? { jobs: learned.jobs, quality: learned.quality, base: learned.base, confidence: learned.confidence, avgCost: learned.avgCost, avgSec: learned.avgSec, failRate: learned.failRate, speedPenalty: speed } : null;
    const ladder = tierBonus(m);
    return { ...m, modelTier: m.tier, estCost: free ? 0 : +cost.toFixed(5), listCost: +estimateCost(m.model, estIn, estOut).toFixed(5), quality: +quality.toFixed(1), healthPenalty: health, warnings, free, tier, ...(localFree && freeFirst ? { localFirst: true } : {}), plan, localFree, skipped: skipReason, learned: record, ...(slowAgent ? { slowAgent: true } : {}), ...(ladder ? { tierBonus: ladder } : {}), score: +(q - penalty - health - speed + bonus + fast - slowAgent + ladder).toFixed(1) };
  };
  // `tier` on a scored row is the cost tier (0 this PC .. 3 paid); `modelTier` is the registry tier.
  const byScore = (a, b) => (b.score - a.score) || tieBreak(a, b, !!gates?.stakes);
  const scored = list.map(scoreOf);
  let ordered = placePlanRows(applyLocalFirst(applyPreferFree(keepCheapestSeller(scored.sort(byScore)), mode === "max" ? false : readPreferFree()), mode));
  if (!needTools && FAST_FIRST_MODES.has(mode)) ordered = fastFreeFirst(ordered);
  if (includeApps) {
    const appRows = extraRouteModels().filter((m) => m && m.kind === "app" && m.available && !exclude.includes(m.model) && (!needWeb || m.web) && !isBlockedFree(m) && (!only || only.has(m.provider)));
    if (appRows.length) ordered = ordered.concat(appRows.map(scoreOf).sort((a, b) => b.score - a.score));
  }
  return applyTune(ordered);
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

// Triage (four gates). Difficulty 1 trivial (one obvious answer, no judgment), 2 standard (well scoped, needs
// competence), 3 hard (gate A or gate B), 4 top (both, or high stakes). Gate C says a concrete do-this verb has a
// named target; gate D is money, security, legal, production or anything that cannot be undone.
const TIER_NAMES = { 1: "trivial", 2: "standard", 3: "hard", 4: "top" };
export const GATE_KEYS = ["ambiguous", "large", "execution", "stakes"];
const clampLevel = (d, dflt = 2) => { const n = Math.round(Number(d)); return Math.min(4, Math.max(1, Number.isFinite(n) && n !== 0 ? n : dflt)); };
export function tierName(difficulty) {
  return TIER_NAMES[clampLevel(difficulty)];
}
const GATE_A = /\b(figure out|somehow|why (?:does|do|did|is|are|was|were|would|can't|won't|doesn't|isn't)|not sure|best way|investigate|root cause|explore|brainstorm|come up with|what should|how should|sometimes|intermittent(?:ly)?|unclear|any ideas)\b/i;
const GATE_B = /\b(entire|across (?:all|every|the (?:whole|entire))|whole (?:system|app|codebase|project|site|repo|checkout|stack|pipeline)|every (?:file|page|screen|module)|all (?:the )?(?:files|pages|screens|modules|services)|many files|refactor(?:ing)?|end-to-end|codebase|cross-system|architecture|overhaul|comprehensive|detailed|complete|full)\b/i;
const GATE_C_VERB = /\b(rename|fix|add|change|update|remove|delete|replace|move|create|write|implement|build|make|convert|translate|edit|set|bump|insert|format|sort|capitali[sz]e|refactor)\b/i;
const GATE_C_TARGET = /([\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|cs|cpp|c|h|css|scss|html|json|md|yml|yaml|sql|sh|ps1|txt|csv|xlsx|docx)\b)|`[^`]+`|"[^"]+"|'[^']{2,}'|\b(?:function|method|class|variable|file|component|button|field|column|table|endpoint|route|header|heading|title|label|tab|page|setting|toggle)\b/i;
const GATE_D = /\b(payments?|billing|security|legal|contracts?|production|delete|deleting|migrate|migration|tax(?:es)?)\b/i;
const TRIVIAL_VERB = /\b(rename|typo|spelling|capitali[sz]e|lowercase|uppercase|reword|swap|bump)\b/i;
const andList = (parts) => parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "";
// A short plain phrase for why the job got its tier. No em-dashes.
export function triageReason(difficulty, gates = {}, { stakesWord = "", trivialEdit = false, long = false } = {}) {
  const d = clampLevel(difficulty);
  const g = gates || {};
  const stakes = g.stakes ? `high stakes${stakesWord ? ` (${stakesWord.toLowerCase()})` : ""}` : "";
  if (d >= 3) {
    if (trivialEdit && g.stakes && !g.ambiguous && !g.large) return `small edit but ${stakes}`;
    const parts = [g.ambiguous ? "open-ended" : "", g.large ? (long && !g.ambiguous ? "long and wide in scope" : "cross-system") : "", stakes].filter(Boolean);
    if (parts.length) return andList(parts);
    return d >= 4 ? "needs the strongest model" : "needs careful work";
  }
  if (d === 2) return g.execution ? "clear single-file task" : "well-scoped, needs competence";
  return g.execution ? "clear single-file edit" : "short with one obvious answer";
}
export function heuristicClassify(prompt) {
  prompt = String(prompt ?? "");
  let capability = "reasoning";
  let best = 0;
  for (const [cap, re] of Object.entries(KEYWORDS)) {
    const n = (prompt.match(new RegExp(re.source, "gi")) || []).length;
    if (n > best) { best = n; capability = cap; }
  }
  const len = prompt.length;
  const long = len > 1200;
  const stakesHit = prompt.match(GATE_D);
  const gates = {
    ambiguous: GATE_A.test(prompt),
    large: long || GATE_B.test(prompt),
    execution: GATE_C_VERB.test(prompt) && GATE_C_TARGET.test(prompt),
    stakes: !!stakesHit,
  };
  const trivialEdit = gates.execution && TRIVIAL_VERB.test(prompt) && len <= 250;
  let difficulty;
  if (gates.stakes) difficulty = trivialEdit && !gates.ambiguous && !gates.large ? 3 : 4;
  else if (gates.ambiguous && gates.large) difficulty = 4;
  else if (gates.ambiguous || gates.large) difficulty = 3;
  else if (len > 250 || (gates.execution && !trivialEdit)) difficulty = 2;
  else difficulty = 1;
  const reason = triageReason(difficulty, gates, { stakesWord: stakesHit?.[0] || "", trivialEdit, long });
  return { capability, difficulty, gates, needWeb: /\b(latest|today|current|news|2026|price of|this week)\b/i.test(prompt), source: "heuristic", reason };
}

// Strip what a model might add to a short line: control characters, em and en dashes, extra spaces.
const cleanLine = (v, max) => (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, max);
// The model's answer, checked: a known capability, difficulty 1..4, boolean gates (the heuristic fills a missing
// one), and stakes stays on when a stakes word is in the prompt, so a money or delete job is never treated lightly.
export function cleanClassification(j, h, source) {
  if (!j || typeof j !== "object" || !CAPABILITIES.includes(j.capability) || j.capability === "fast") return null;
  let difficulty = clampLevel(j.difficulty, h.difficulty);
  const gates = {};
  const own = (k) => typeof j.gates?.[k] === "boolean" && j.gates[k];
  for (const k of GATE_KEYS) gates[k] = typeof j.gates?.[k] === "boolean" ? j.gates[k] : !!h.gates?.[k];
  // The model's own gates set a floor: both A and B is top, A or B or stakes is at least hard.
  // Gates filled in from the heuristic never move the model's difficulty.
  if (own("ambiguous") && own("large")) difficulty = 4;
  else if (own("ambiguous") || own("large") || own("stakes")) difficulty = Math.max(difficulty, 3);
  if (h.gates?.stakes) gates.stakes = true;
  const reason = cleanLine(j.reason, 120) || triageReason(difficulty, gates);
  return { capability: j.capability, difficulty, gates, needWeb: j.needWeb === true, summary: cleanLine(j.summary, 80), reason, source };
}

// Ask the cheapest model to classify; fall back to keywords.
export async function classify(prompt, { onCall } = {}) {
  const h = heuristicClassify(prompt);
  const m = cheapest(68);
  if (!m) return h;
  try {
    const t0 = Date.now();
    // a small job: free tiers first, and a stand-in if the cheap model's provider is out of credits (Phase 26)
    const r = await completeFallback({ allowStandIn: true,
      provider: m.provider, model: m.model, maxTokens: 300,
      system: `Classify the user's request. Reply with JSON only: {"capability": one of ${JSON.stringify(CAPABILITIES.filter((c) => c !== "fast"))}, "difficulty": 1|2|3|4, "gates": {"ambiguous": boolean, "large": boolean, "execution": boolean, "stakes": boolean}, "needWeb": boolean (true only if the answer depends on live/current information), "summary": "<=8 words", "reason": "<=8 plain words on why this difficulty"}
Gates: ambiguous = the goal is loosely defined and needs discovery or planning ("figure out", "why does", "not sure", "best way"). large = it spans whole systems, many files or a long piece of work ("entire", "across all", "refactor", "end-to-end"). execution = a concrete do-this request with a named target (a file, a function, a field). stakes = money, billing, security, legal, contracts, production, deleting, migrating or tax.
Difficulty: 1 trivial (one obvious answer, no judgment). 2 standard (well-scoped, needs competence). 3 hard (ambiguous or large). 4 top (ambiguous and large, or high stakes).`,
      messages: [{ role: "user", content: prompt.slice(0, 4000) }],
    }, { role: "classify", small: true, cls: { capability: "fast", difficulty: 1 }, mode: "economy", tools: false });
    onCall?.({ provider: r.provider, model: r.model, usage: r.usage, ms: Date.now() - t0, role: "classify" });
    const c = cleanClassification(extractJson(r.text), h, m.model);
    if (c) return c;
  } catch {}
  return h;
}

// What the person sees: the tier, the task type, the classifier's summary and why. `note` is added to the reason
// (for example when a provider-only pick had nothing ready). A task type with no gates gets the heuristic's gates.
export function triageOf(cls, { note = "", prompt = "" } = {}) {
  const base = cls && typeof cls === "object" ? cls : {};
  const h = !base.gates || !base.reason ? heuristicClassify(prompt) : null;
  const difficulty = clampLevel(base.difficulty, h?.difficulty || 2);
  const gates = {};
  for (const k of GATE_KEYS) gates[k] = !!(base.gates ? base.gates[k] : h?.gates?.[k]);
  const reason = base.reason && Number(base.difficulty) === difficulty ? base.reason : triageReason(difficulty, gates);
  return { difficulty, tier: tierName(difficulty), capability: base.capability || h?.capability || "reasoning", summary: base.summary || "", reason: note ? `${reason}; ${note}` : reason, source: base.source || "heuristic", gates };
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
