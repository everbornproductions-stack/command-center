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
import { creditCheck } from "./free-first.js";

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

// 0.4.21 Auto picks the mode. Quick answers stay Single; coding and multi-part jobs become a Mission; judgment calls
// become a Council. Needs two or more AIs that can really work, otherwise it stays Single.
const JUDGMENT = /\b(should (i|we)|which (is|one is|option|should)|better,? .{1,40}\bor\b|pros and cons|what do you think|your opinion|second opinion|decide between|recommend (one|between)|\bvs\.?\b|compare .{1,60}\b(and|with|to)\b|is it (worth|a good idea))/i;
const MULTI = /(\b(and then|step by step|plan,? (build|write)|then (write|build|make|create)|each of|for every|campaign|content calendar|full (plan|report)|end[- ]to[- ]end)\b|(^|\n)\s*(\d+[.)]|[-*])\s+\S[\s\S]*(\n\s*(\d+[.)]|[-*])\s+\S)[\s\S]*(\n\s*(\d+[.)]|[-*])\s+\S))/i;
export function chooseMode(prompt, { coding, workers }) {
  const t = String(prompt || "");
  if (workers < 2) return { mode: "single", line: workers === 1 ? "Auto picked Single: only one AI is ready right now." : "" };
  if (coding) return { mode: "mission", line: `Auto picked Mission: this looks like a coding job, so it is split across ${workers} AIs (plan, build, review). Change it under More options.` };
  if (JUDGMENT.test(t)) return { mode: "council", line: `Auto picked Council: this is a judgment call, so ${Math.min(workers, 3)} AIs weigh in and one writes the verdict. Change it under More options.` };
  if (t.length > 700 || MULTI.test(t)) return { mode: "mission", line: `Auto picked Mission: this has several parts, so it is split across ${workers} AIs. Change it under More options.` };
  return { mode: "single", line: "Auto picked Single: a quick answer from one AI. Change it under More options." };
}

export async function sendCheck({ prompt = "", explicit = false, priority, force = false } = {}) {
  const ais = connectedAis();
  const check = await creditCheck({ force, connected: ais, whyOut });
  const out = check.out.map((o) => ({ ...o }));
  const outIds = new Set(out.map((o) => o.provider));
  const working = ais.filter((a) => !outIds.has(a.provider) && check.ready.some((r) => r.provider === a.provider));
  const coding = isCodingJob(prompt);
  // the next working AI for this job, ranked as a normal send would
  let next = null;
  try { const best = rank({ ...heuristicClassify(String(prompt || "")), mode: priority || "balanced" })[0]; if (best && !outIds.has(best.provider) && !whyOut(best.provider)) next = { provider: best.provider, model: best.model, name: best.providerName || nameOf(best.provider) }; } catch {}
  if (!next && check.ready[0]) next = { provider: check.ready[0].provider, model: check.ready[0].model, name: check.ready[0].name };
  const workers = Math.max(working.length, check.ready.length);
  const picked = chooseMode(prompt, { coding, workers });
  // a person who chose Single (or any mode) keeps it; Auto only decides when nothing was chosen
  const autoMode = explicit ? "single" : picked.mode;
  let banner = null;
  if (out.length) {
    const names = out.map((o) => o.name);
    const first = out[0];
    const allDown = !check.ready.length;
    banner = {
      kind: allDown ? "all-out" : "some-out",
      providers: out.map((o) => o.provider),
      summary: check.summary,
      title: allDown
        ? `${names.join(" and ")} cannot take work right now.`
        : `${out.map((o) => o.why).join(". ")}.`,
      text: allDown
        ? "No connected AI can answer right now. Add a free key from Get free AIs, add credits, then send again."
        : `${check.replace || `Meldmind will use ${next?.name || working[0]?.name} for this instead.`}`,
      fix: {
        switchTo: next,
        addCredits: first.billing || null,
        settings: true,
        freeAis: true,
      },
    };
  }
  return { coding, autoMode, autoLine: explicit ? "" : picked.line, working: working.map((w) => ({ provider: w.provider, name: w.name })), ready: check.ready.map((r) => ({ provider: r.provider, name: r.name, free: r.free, tier: r.tier })), out: out.map((o) => ({ provider: o.provider, name: o.name, kind: o.kind, why: o.why })), summary: check.summary, freeOnly: check.freeOnly, next, banner, allDown: !check.ready.length && ais.length > 0, nothingReady: check.nothingReady };
}
