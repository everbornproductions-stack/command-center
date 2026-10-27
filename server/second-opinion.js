// Phase 58. Two AIs answer the same orders. The app flags where they disagree, in plain words,
// and keeps both answers. It sits beside Single, Council, and Mission. It does not replace Council.
// Demo mode uses the pretend AIs and records no spend. The learning router keeps the task type only.
import { PROVIDERS } from "./registry.js";
import { rank, heuristicClassify } from "./router.js";
import { completeFallback } from "./fallback.js";
import { observe } from "./brain.js";
import { recordCall } from "./ledger.js";
import { gate } from "./feature-gate.js";
import { emit } from "./events.js";
import { ctx } from "./store.js";
import { missionSummary } from "./mission.js";

const STOP = new Set(["this", "that", "with", "from", "your", "have", "will", "they", "them", "then", "than", "into", "about", "would", "could", "should", "there", "their", "what", "when", "where", "which", "while", "also", "just", "only", "more", "some", "such", "each", "other"]);

function sentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);
}

function tokens(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function clip(s, n = 220) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

// Where two answers do not say the same thing. Plain words, no extra model call.
export function findDisagreements(aText, bText) {
  const left = sentences(aText).map((text) => ({ text, tokens: tokens(text) })).filter((s) => s.tokens.size >= 3);
  const right = sentences(bText).map((text) => ({ text, tokens: tokens(text) })).filter((s) => s.tokens.size >= 3);
  const points = [];
  const used = new Set();
  for (const s of left) {
    let best = 0;
    let match = null;
    for (const o of right) {
      const score = overlap(s.tokens, o.tokens);
      if (score > best) { best = score; match = o; }
    }
    if (best >= 0.55 || !match) continue;
    const key = `${s.text}|${match.text}`;
    if (used.has(key)) continue;
    used.add(key);
    points.push({ left: clip(s.text), right: clip(match.text) });
    if (points.length >= 4) break;
  }
  return { agree: points.length === 0, points };
}

export function opinionText({ leftName, rightName, leftText, rightText, diff }) {
  const lines = ["## Where they differ", ""];
  if (!diff || diff.agree) {
    lines.push("They agree. No clear disagreement showed up. Both answers are kept below. You decide.");
  } else {
    lines.push(`They disagree on ${diff.points.length} point${diff.points.length === 1 ? "" : "s"}. You decide.`);
    lines.push("");
    for (const p of diff.points) {
      lines.push(`- ${leftName} says: ${p.left}`);
      lines.push(`- ${rightName} says: ${p.right}`);
    }
  }
  lines.push("", `## ${leftName}`, "", leftText || "(no answer)", "", `## ${rightName}`, "", rightText || "(no answer)");
  return lines.join("\n");
}

export function assertOpinionReady(prompt) {
  gate("secondOpinion");
  return pickPair(prompt);
}

function pickPair(prompt) {
  const cls = heuristicClassify(prompt);
  const ranked = rank({ ...cls, mode: "balanced" });
  const first = ranked[0];
  if (!first) {
    const err = new Error("No AI available. Add a key in Settings, or turn demo mode on.");
    err.status = 400;
    throw err;
  }
  const second = ranked.find((m) => m.provider !== first.provider) || ranked.find((m) => m.model !== first.model);
  if (!second) {
    const err = new Error("Second opinion needs two AIs. Add another key, or turn demo mode on.");
    err.status = 400;
    throw err;
  }
  return { cls, first, second };
}

const SYSTEM = "Answer the person's question in plain words. Be concrete. Do not say you are comparing your answer with anyone else.";

async function oneAnswer({ id, pick, prompt, cls }) {
  const provider = pick.provider;
  const model = pick.model;
  const name = PROVIDERS[provider]?.name || provider;
  const agent = `${id}:${provider}`;
  emit("agent.start", { agent, provider, model, role: "answer", missionId: id, label: `${name} answering` });
  const t0 = Date.now();
  const demo = !!PROVIDERS[provider]?.demo;
  try {
    const r = await completeFallback({ allowStandIn: true,
      provider, model, maxTokens: 900, system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }, { missionId: id, role: "answer", cls, mode: "balanced", tools: false });
    const ms = Date.now() - t0;
    let cost = 0;
    if (!demo) {
      const e = recordCall({ provider: r.provider || provider, model: r.model || model, usage: r.usage, missionId: id, role: "answer", ms });
      cost = e.cost || 0;
      observe({ provider: r.provider || provider, model: r.model || model, capability: cls.capability, difficulty: cls.difficulty, runId: id, ok: true, cost, ms, free: !!e.free });
    } else {
      observe({ provider, model, capability: cls.capability, difficulty: cls.difficulty, runId: id, ok: true, cost: 0, ms, free: true });
    }
    emit("agent.done", { agent, provider, model, missionId: id, ms, cost });
    return { provider: r.provider || provider, model: r.model || model, name: PROVIDERS[r.provider || provider]?.name || name, text: r.text || "", cost: demo ? 0 : cost };
  } catch (e) {
    emit("agent.error", { agent, provider, model, missionId: id, error: e.message });
    if (!demo) observe({ provider, model, capability: cls.capability, difficulty: cls.difficulty, runId: id, ok: false });
    return { provider, model, name, text: "", cost: 0, error: e.message };
  }
}

export async function runSecondOpinion({ id, prompt, projectId }) {
  gate("secondOpinion");
  const { cls, first, second } = pickPair(prompt);
  const title = prompt.slice(0, 90);
  const m = {
    id, kind: "opinion", title, prompt, projectId: projectId || null, status: "running",
    startedAt: Date.now(), cost: 0, deliverable: "", answers: [], disagreements: [], tasks: [],
  };
  emit("mission.update", { mission: m });
  try {
    const [a, b] = await Promise.all([
      oneAnswer({ id, pick: first, prompt, cls }),
      oneAnswer({ id, pick: second, prompt, cls }),
    ]);
    const diff = findDisagreements(a.text, b.text);
    m.answers = [a, b].map((x) => ({ provider: x.provider, model: x.model, name: x.name, text: x.text, error: x.error || null }));
    m.disagreements = diff.points;
    m.agree = diff.agree;
    m.tasks = [a, b].map((x, i) => ({ id: `a${i + 1}`, title: x.name, provider: x.provider, status: x.error ? "failed" : "done" }));
    m.provider = a.provider;
    m.deliverable = opinionText({ leftName: a.name, rightName: b.name, leftText: a.text, rightText: b.text, diff });
    m.cost = +((a.cost || 0) + (b.cost || 0)).toFixed(6);
    m.status = a.error && b.error ? "failed" : "done";
    if (a.error && b.error) m.error = a.error;
  } catch (e) {
    m.status = "failed";
    m.error = e.message;
    m.deliverable = e.message;
  }
  m.finishedAt = Date.now();
  ctx().store.saveMission(m, missionSummary(m));
  emit("mission.update", { mission: m });
  emit("log", { text: m.status === "done" ? "Second opinion finished. Both answers are kept." : `Second opinion failed: ${m.error || "unknown"}`, level: m.status === "done" ? "info" : "error", missionId: id });
  return m;
}
