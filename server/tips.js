// One short upgrade tip after a run, never during it. Local log only: provider id, task type, why.
// At most one tip per provider per task type per 7 days.
import { TEXT_PROVIDERS, PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc, ctx } from "./store.js";
import { bus, emit } from "./events.js";
import { adjust } from "./brain.js";
import { describePause } from "./pause.js";
import { planOf } from "./plans.js";
import { unconnectedMcp } from "./provider-access.js";
import { FREE_TIERS, freeUsage, fallbackSettings } from "./fallback.js";

export const TIP_DOC = "tips.log";
export const TIP_MARGIN = 12;
export const TIP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const seenRuns = new Set();

export function tipsOn(settings) {
  if (!settings) return true;
  if (settings.showUpgradeTips === false) return false;
  return true;
}

function memory() {
  const d = doc(TIP_DOC, () => ({ last: {}, events: [] }));
  if (!d.last || typeof d.last !== "object") d.last = {};
  if (!Array.isArray(d.events)) d.events = [];
  return d;
}

export function blockReason(id) {
  const p = PROVIDERS[id];
  if (!p || p.demo || p.kind !== "text") return null;
  if (describePause(id)) return "credits";
  if (p.auth === "mcp" || p.auth === "oauth") return unconnectedMcp(id) ? "connect" : null;
  if (!hasSecret(id, p.keyEnv)) return "key";
  if (planOf(id) === "free") {
    const tier = FREE_TIERS[id];
    const cfg = fallbackSettings().freeTiers?.[id];
    if (tier && cfg?.on && freeUsage(id).today >= cfg.perDay) return "free";
  }
  return null;
}

function qualityOf(model, capability, difficulty, mode) {
  if (!model) return 0;
  const base = model.caps?.[capability] ?? 60;
  const learned = adjust({ model: model.id, baseCaps: model.caps, capability, difficulty, mode, estCost: 0.01 });
  return learned ? learned.quality : base;
}

export function tipText(name, why) {
  if (why === "credits") return `${name} usually does this better. Add credits to use it.`;
  if (why === "free") return `${name} usually does this better. Its free limit is used up.`;
  if (why === "connect") return `${name} usually does this better. Connect it to use it.`;
  return `${name} usually does this better. Add a key to use it.`;
}

export function chooseTip({ capability = "reasoning", usedProvider, usedQuality = 0, candidates = [], now = Date.now(), last = {}, enabled = true, margin = TIP_MARGIN, windowMs = TIP_WINDOW_MS } = {}) {
  if (enabled === false) return null;
  const best = [...candidates].sort((a, b) => b.quality - a.quality)[0];
  if (!best || best.provider === usedProvider) return null;
  if (best.quality < usedQuality + margin) return null;
  const key = `${best.provider}|${capability}`;
  if (now - (last[key] || 0) < windowMs) return null;
  const href = best.why === "credits" || best.why === "free" ? best.billing : best.keys;
  return {
    provider: best.provider,
    name: best.name,
    capability,
    why: best.why,
    text: tipText(best.name, best.why),
    href: href || null,
    billing: best.why === "credits" ? best.billing || null : null,
  };
}

function candidatesFor(capability, difficulty, mode) {
  const out = [];
  for (const p of TEXT_PROVIDERS) {
    if (p.demo) continue;
    const why = blockReason(p.id);
    if (!why) continue;
    const model = (p.models || []).find((m) => m.default) || p.models?.[0];
    out.push({
      provider: p.id,
      name: p.name,
      why,
      quality: qualityOf(model, capability, difficulty, mode),
      billing: p.links?.billing || null,
      keys: p.links?.keys || p.links?.console || null,
    });
  }
  return out;
}

export function considerRun(run) {
  if (!run?.id || seenRuns.has(run.id)) return null;
  if (run.status !== "done" && run.status !== "done-with-errors") return null;
  seenRuns.add(run.id);
  let settings = null;
  try { settings = ctx().docs?.settings || null; } catch { settings = null; }
  if (!tipsOn(settings)) return null;
  const capability = run.classification?.capability || run.tasks?.find((t) => t.capability)?.capability || "reasoning";
  const difficulty = run.classification?.difficulty || 2;
  const used = run.provider || run.chair?.provider || run.tasks?.find((t) => t.provider)?.provider || null;
  if (!used || !PROVIDERS[used]) return null;
  const usedModel = (PROVIDERS[used].models || []).find((m) => m.id === run.model) || (PROVIDERS[used].models || []).find((m) => m.default) || PROVIDERS[used].models?.[0];
  const tip = chooseTip({
    capability,
    usedProvider: used,
    usedQuality: qualityOf(usedModel, capability, difficulty, "balanced"),
    candidates: candidatesFor(capability, difficulty, "balanced"),
    now: Date.now(),
    last: memory().last,
    enabled: true,
  });
  if (!tip) return null;
  const d = memory();
  d.last[`${tip.provider}|${tip.capability}`] = Date.now();
  d.events.push({ at: Date.now(), provider: tip.provider, capability: tip.capability, why: tip.why });
  if (d.events.length > 200) d.events = d.events.slice(-200);
  putDoc(TIP_DOC, d);
  emit("log", { text: `Upgrade tip for ${tip.capability}: ${tip.provider}.` });
  emit("tip", { missionId: run.id, tip });
  return tip;
}

let watching = false;
export function watchRuns() {
  if (watching) return;
  watching = true;
  bus.on("event", (ev) => {
    const run = ev.mission || ev.council;
    if (!run) return;
    try { considerRun(run); } catch { /* a tip must never break a run */ }
  });
}

watchRuns();
