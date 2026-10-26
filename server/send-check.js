// 0.4.21 (dogfood finding 01): what to tell the person BEFORE they send.
//  - which connected AIs are known to be out of credits, out of quota, busy or refusing their key
//    (the fallback trouble table plus the pause bookkeeping), with a one-click fix
//  - whether Auto should split a coding job across several AIs (plan, build, review) instead of one
// Nothing here calls a provider. It only reads what the app already remembers.
import { PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { availableModels, rank, heuristicClassify } from "./router.js";
import { trouble } from "./fallback.js";
import { describePause } from "./pause.js";

const nameOf = (pid) => PROVIDERS[pid]?.name || pid;
const WHY = {
  credits: "is out of credits or quota",
  rate: "is busy and asked us to slow down",
  key: "did not accept its key",
  unreachable: "could not be reached a moment ago",
  server: "had a problem on its side",
  cap: "reached its spending limit",
};

const CODE_EXTRA = /\b(refactor|repository|unit tests?|stack trace|pull request|compile[rd]?|build script|source code|codebase)\b/i;
export const isCodingJob = (prompt) => { const t = String(prompt || ""); return heuristicClassify(t).capability === "code" || CODE_EXTRA.test(t); };

// Connected real text AIs, one row per provider.
export function connectedAis() {
  const seen = new Map();
  for (const m of availableModels()) {
    const p = PROVIDERS[m.provider];
    if (!m.available || !p || p.kind !== "text" || p.demo || m.kind === "app") continue;
    if (!seen.has(m.provider)) seen.set(m.provider, { provider: m.provider, name: nameOf(m.provider), model: m.model, modelName: m.name, keyed: hasSecret(m.provider, p.keyEnv) });
  }
  return [...seen.values()];
}

// Why an AI is out right now, or null when it can take work.
export function whyOut(pid) {
  const t = trouble(pid);
  if (t && t.kind !== "unreachable") return { kind: t.kind, detail: t.detail || "", until: t.until || null };
  const p = describePause(pid);
  if (p) return { kind: p.rate ? "rate" : "credits", detail: p.detail || "", until: null, billing: p.billing };
  return null;
}

export function sendCheck({ prompt = "", explicit = false, priority } = {}) {
  const ais = connectedAis();
  const out = [];
  const working = [];
  for (const a of ais) {
    const w = whyOut(a.provider);
    if (w) out.push({ ...a, kind: w.kind, why: `${a.name} ${WHY[w.kind] || WHY.server}`, billing: w.billing || PROVIDERS[a.provider]?.links?.billing || null });
    else working.push(a);
  }
  const coding = isCodingJob(prompt);
  // the next working AI for this job, ranked as a normal send would
  let next = null;
  try { const best = rank({ ...heuristicClassify(String(prompt || "")), mode: priority || "balanced" })[0]; if (best && !whyOut(best.provider)) next = { provider: best.provider, model: best.model, name: best.providerName || nameOf(best.provider) }; } catch {}
  if (!next && working[0]) next = { provider: working[0].provider, model: working[0].model, name: working[0].name };
  // Auto splits a coding job (plan, build, review) when two or more AIs can really work. A person who chose Single keeps Single.
  const autoMode = !explicit && coding && working.length >= 2 ? "mission" : "single";
  let banner = null;
  if (out.length) {
    const names = out.map((o) => o.name);
    const first = out[0];
    const allDown = !working.length;
    banner = {
      kind: allDown ? "all-out" : "some-out",
      providers: out.map((o) => o.provider),
      title: allDown
        ? `${names.join(" and ")} cannot take work right now.`
        : `${out.map((o) => o.why).join(". ")}.`,
      text: allDown
        ? "No connected AI can answer right now. Add credits or a key in Settings, then send again."
        : `Meldmind will use ${next?.name || working[0].name} for this instead.`,
      fix: {
        switchTo: next,
        addCredits: first.billing || null,
        settings: true,
      },
    };
  }
  return { coding, autoMode, working: working.map((w) => ({ provider: w.provider, name: w.name })), out: out.map((o) => ({ provider: o.provider, name: o.name, kind: o.kind, why: o.why })), next, banner, allDown: !working.length && ais.length > 0 };
}

