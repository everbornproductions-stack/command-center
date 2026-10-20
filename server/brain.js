// Learning router, the app's own brain (Phase 28, core, every customer).
// Every job teaches the router which model is best at what, for the price, per user.
//
//  - Saved per model per task type (capability and difficulty from the classifier): jobs, successes and
//    failures, council peer scores and wins, mission QA scores, the person's thumbs up / down, cost per
//    job and latency. Nothing else: no prompt or answer text, no secrets, no personal data. Run ids are
//    kept for a while only so a thumbs up given later lands on the right task type.
//  - rank() in router.js asks adjust() for each model: quality is the registry's base score blended with
//    the track record (the more jobs, the more the record counts), cost per job blends the estimate with
//    what jobs really cost, and a model that is slower than its registry speed loses a few points (faster
//    gains). With no record the ranking is exactly the registry's, so a new user starts from the baseline.
//  - A failure caused by the account (out of credits, rate limited, key rejected, unreachable) is smart
//    fallback's business (Phase 26) and is not held against the model; a model that errors on the job is.
//  - Stored as the user's own document "brain" (local: data/brain.json; hosted: their own user_docs row),
//    so it is exported and deleted with the rest of their data. Reset clears it and the older skills table.
//  - Sharing: an anonymous aggregate could train a small routing model of our own. New setups start
//    with it on. The person can turn it off any time. Nothing is sent anywhere by this build; the
//    preview shows what it would contain.
import { CAPABILITIES, PROVIDERS, findModel } from "./registry.js";
import { doc, putDoc } from "./store.js";
import { emit } from "./events.js";
import { clearCommunity, communityModels, communityStat } from "./community.js";

export const KIND = "brain";
export const VERSION = 1;
export const DEFAULTS = { on: true, shareOptIn: true };
// how many quality signals before the record counts as much as the registry score
export const QUALITY_K = 4;
// how many jobs before observed cost / latency count as much as the estimate
export const COST_K = 3, LATENCY_K = 3;
// thumbs count double: they are the person's own judgment
export const THUMB_WEIGHT = 2;
// a thumbs up / down as a quality signal on the 0-100 scale
export const THUMB_SCORE = { up: 95, down: 15 };
// latency weight per priority: quality cares least about speed
export const LATENCY_WEIGHT = { quality: 0.3, balanced: 0.8, economy: 0.6 };
const MAX_RUNS = 600;
const TASK_CAPS = CAPABILITIES;

const emptyStat = () => ({ jobs: 0, ok: 0, fail: 0, rounds: 0, wins: 0, scoreSum: 0, scoreN: 0, qaSum: 0, qaN: 0, up: 0, down: 0, cost: 0, costN: 0, ms: 0, msN: 0, last: 0 });
const fresh = () => ({ v: VERSION, since: Date.now(), settings: { ...DEFAULTS }, jobs: 0, stats: {}, runs: {} });

export function brain() {
  const b = doc(KIND, fresh);
  b.settings = { ...DEFAULTS, ...(b.settings || {}) };
  b.stats ||= {}; b.runs ||= {};
  return b;
}
const save = (b) => putDoc(KIND, b);
export const brainSettings = () => brain().settings;
export const learningOn = () => brainSettings().on !== false;

export function saveBrainSettings(patch = {}) {
  const b = brain();
  if (patch.on !== undefined) b.settings.on = !!patch.on;
  if (patch.shareOptIn !== undefined) b.settings.shareOptIn = !!patch.shareOptIn;
  save(b);
  return b.settings;
}

// ---------- cleaning: only known shapes are ever stored ----------
const cleanId = (s, max = 120) => String(s || "").replace(/[^A-Za-z0-9._:/@+-]/g, "").slice(0, max);
const cleanRun = (s) => String(s || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
export const cleanCap = (c) => (TASK_CAPS.includes(c) ? c : "reasoning");
export const cleanDiff = (d) => Math.min(3, Math.max(1, Math.round(Number(d) || 2)));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function statFor(b, provider, model, cap, diff) {
  const m = (b.stats[model] ||= { provider, t: {} });
  if (provider) m.provider = provider;
  return (m.t[`${cap}:${diff}`] ||= emptyStat());
}
function rememberRun(b, runId, model, cap, diff) {
  if (!runId) return;
  const r = (b.runs[runId] ||= { ts: Date.now(), m: {} });
  r.m[model] ||= { cap, diff, up: null }; // the first job a model did in a run is the one a thumb is about
  const ids = Object.keys(b.runs);
  if (ids.length > MAX_RUNS) for (const id of ids.sort((x, y) => b.runs[x].ts - b.runs[y].ts).slice(0, ids.length - MAX_RUNS)) delete b.runs[id];
}

// One job by one model. score / qa are 1-10, won is true / false / null (no council round), cost in USD,
// ms the wall time of the call. free calls (Phase 26 free tiers) do not count toward cost per job.
export function observe({ provider, model, capability, difficulty, runId, ok = true, score = null, qa = null, won = null, cost = null, ms = null, free = false } = {}) {
  if (!learningOn()) return null;
  const mid = cleanId(model);
  if (!mid) return null;
  const b = brain();
  const cap = cleanCap(capability), diff = cleanDiff(difficulty), pid = cleanId(provider, 60) || null;
  const s = statFor(b, pid, mid, cap, diff);
  s.jobs++; s.last = Date.now(); b.jobs = (b.jobs || 0) + 1;
  if (ok) s.ok++; else s.fail++;
  const sc = num(score); if (sc != null && sc > 0) { s.scoreSum += clamp(sc, 0, 10); s.scoreN++; }
  const q = num(qa); if (q != null && q > 0) { s.qaSum += clamp(q, 0, 10); s.qaN++; }
  if (won === true || won === false) { s.rounds++; if (won) s.wins++; }
  const c = num(cost); if (ok && c != null && c >= 0 && !free) { s.cost += c; s.costN++; }
  const t = num(ms); if (ok && t != null && t > 0) { s.ms += t; s.msN++; }
  rememberRun(b, cleanRun(runId), mid, cap, diff);
  save(b);
  emit("brain.update", { model: mid, capability: cap, jobs: s.jobs });
  return s;
}

// The person's thumbs up / down on one model's part of a run. A second rating on the same run and model
// replaces the first. The task type comes from the run when the brain saw it, else from the caller.
export function rate({ runId, provider, model, capability, difficulty, up } = {}) {
  if (!learningOn()) return null;
  const mid = cleanId(model), rid = cleanRun(runId);
  if (!mid) return null;
  const b = brain();
  const seen = rid ? b.runs[rid]?.m?.[mid] : null;
  const cap = seen?.cap || cleanCap(capability), diff = seen?.diff || cleanDiff(difficulty);
  const s = statFor(b, cleanId(provider, 60) || b.stats[mid]?.provider || null, mid, cap, diff);
  if (seen && seen.up !== null && seen.up !== undefined) { if (seen.up) s.up = Math.max(0, s.up - 1); else s.down = Math.max(0, s.down - 1); }
  if (up) s.up++; else s.down++;
  s.last = Date.now();
  if (rid) { rememberRun(b, rid, mid, cap, diff); b.runs[rid].m[mid].up = !!up; }
  save(b);
  emit("brain.update", { model: mid, capability: cap });
  return s;
}

// Pro prompt matches (template id and a count only). No prompt text, no inputs, no secrets.
// Called when a template is suggested, applied, removed, or halted. Learning off records nothing.
export function noteTemplate({ id, action } = {}) {
  if (!learningOn()) return null;
  const clean = String(id || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  if (!clean) return null;
  const act = ["suggested", "applied", "removed", "halted"].includes(action) ? action : "suggested";
  const b = brain();
  const bag = b.templates || (b.templates = {});
  const row = bag[clean] || (bag[clean] = { suggested: 0, applied: 0, removed: 0, halted: 0, last: 0 });
  row[act] += 1;
  row.last = Date.now();
  save(b);
  return { id: clean, ...row };
}

// ---------- reading the record ----------
function addStat(a, b) {
  const out = emptyStat();
  for (const f of Object.keys(out)) {
    if (f === "last") out.last = Math.max(a?.last || 0, b?.last || 0);
    else out[f] = (a?.[f] || 0) + (b?.[f] || 0);
  }
  return out;
}

function merged(model, cap, diff) {
  const m = brain().stats[model];
  const out = emptyStat();
  if (!m) return out;
  for (const [k, s] of Object.entries(m.t)) {
    const [c, d] = k.split(":");
    if (c !== cap) continue;
    // the exact difficulty counts fully, the other difficulties of the same capability count half
    const w = diff == null || Number(d) === diff ? 1 : 0.5;
    for (const f of Object.keys(out)) if (f !== "last") out[f] += (s[f] || 0) * w; else out.last = Math.max(out.last, s.last || 0);
  }
  return out;
}

// Quality evidence on the 0-100 scale and how many signals it rests on.
export function evidence(s) {
  let sum = 0, w = 0;
  if (s.scoreN > 0) { sum += (s.scoreSum / s.scoreN) * 10 * s.scoreN; w += s.scoreN; }
  if (s.qaN > 0) { sum += (s.qaSum / s.qaN) * 10 * s.qaN * 0.5; w += s.qaN * 0.5; }
  if (s.rounds > 0) { const wr = s.wins / s.rounds; sum += clamp(50 + (wr - 0.35) * 100, 0, 100) * s.rounds * 0.5; w += s.rounds * 0.5; }
  const thumbs = s.up + s.down;
  if (thumbs > 0) { sum += (s.up * THUMB_SCORE.up + s.down * THUMB_SCORE.down) * THUMB_WEIGHT; w += thumbs * THUMB_WEIGHT; }
  return { quality: w > 0 ? sum / w : null, signals: w };
}
const priorSec = (fast) => 1 + (100 - (Number(fast) || 60)) / 6;
const latPoints = (sec) => Math.log10(1 + Math.max(0, sec)) * 10;

// What the track record changes for one model on one task type. Returns null when there is no record
// (or learning is off): the router then uses the registry exactly as before.
export function adjust({ model, baseCaps = {}, capability = "reasoning", difficulty = 2, mode = "balanced", estCost = 0 }) {
  if (!learningOn()) return null;
  const cap = cleanCap(capability), diff = cleanDiff(difficulty);
  const s = addStat(merged(model, cap, diff), communityStat(model, cap));
  if (s.jobs <= 0 && s.up + s.down <= 0) return null;
  const base = baseCaps[cap] ?? 60;
  const ev = evidence(s);
  const conf = ev.signals / (ev.signals + QUALITY_K);
  let quality = ev.quality == null ? base : base * (1 - conf) + ev.quality * conf;
  // failures on the job itself pull the score down, more so as the record grows
  const failRate = s.jobs > 0 ? s.fail / s.jobs : 0;
  const failPenalty = failRate * 35 * (s.jobs / (s.jobs + 2));
  quality = clamp(quality - failPenalty, 0, 100);
  const cc = s.costN / (s.costN + COST_K);
  const obsCost = s.costN > 0 ? s.cost / s.costN : null;
  const cost = obsCost == null ? estCost : estCost * (1 - cc) + obsCost * cc;
  const lc = s.msN / (s.msN + LATENCY_K);
  const obsSec = s.msN > 0 ? s.ms / s.msN / 1000 : null;
  const prior = priorSec(baseCaps.fast);
  const sec = obsSec == null ? prior : prior * (1 - lc) + obsSec * lc;
  const latencyPenalty = +((latPoints(sec) - latPoints(prior)) * (LATENCY_WEIGHT[mode] ?? 0.8)).toFixed(2);
  return {
    quality: +quality.toFixed(1), base, cost, latencyPenalty, confidence: +conf.toFixed(2),
    jobs: Math.round(s.jobs), signals: +ev.signals.toFixed(1), failRate: +failRate.toFixed(2),
    avgCost: obsCost == null ? null : +obsCost.toFixed(6), avgSec: obsSec == null ? null : +obsSec.toFixed(2),
  };
}

// ---------- "Who's best at what" ----------
const COST_WEIGHT = { quality: 0.15, balanced: 0.5, economy: 1.1 };
function modelMeta(id) {
  const m = findModel(id);
  const pid = brain().stats[id]?.provider;
  return { name: m?.name || id, provider: pid || null, providerName: PROVIDERS[pid]?.name || pid || "", color: PROVIDERS[pid]?.color || null, baseCaps: m?.caps || {} };
}
export function bestAtWhat({ mode = "balanced", top = 5 } = {}) {
  const b = brain();
  const caps = [];
  const ids = new Set([...Object.keys(b.stats), ...communityModels()]);
  for (const cap of TASK_CAPS) {
    const rows = [];
    for (const model of ids) {
      const personal = b.stats[model];
      const hasPersonal = !!personal && Object.keys(personal.t || {}).some((k) => k.startsWith(cap + ":"));
      const comm = communityStat(model, cap);
      const hasCommunity = comm.jobs > 0 || comm.up + comm.down > 0;
      if (!hasPersonal && !hasCommunity) continue;
      const s = addStat(merged(model, cap, null), comm);
      if (s.jobs <= 0 && s.up + s.down <= 0) continue;
      const meta = modelMeta(model);
      const a = adjust({ model, baseCaps: meta.baseCaps, capability: cap, difficulty: 2, mode, estCost: s.costN > 0 ? s.cost / s.costN : 0 }) || {};
      const cost = a.avgCost ?? 0;
      const score = (a.quality ?? 0) - Math.log10(1 + cost * 100) * 25 * (COST_WEIGHT[mode] ?? 0.5) - (a.latencyPenalty || 0);
      rows.push({
        model, name: meta.name, provider: meta.provider, providerName: meta.providerName, color: meta.color,
        jobs: Math.round(s.jobs), ok: Math.round(s.ok), fail: Math.round(s.fail),
        successRate: s.jobs > 0 ? +(s.ok / s.jobs).toFixed(2) : null,
        rounds: Math.round(s.rounds), wins: Math.round(s.wins), winRate: s.rounds > 0 ? +(s.wins / s.rounds).toFixed(2) : null,
        avgScore: s.scoreN > 0 ? +(s.scoreSum / s.scoreN).toFixed(2) : null, avgQa: s.qaN > 0 ? +(s.qaSum / s.qaN).toFixed(2) : null,
        up: Math.round(s.up), down: Math.round(s.down),
        costPerJob: a.avgCost ?? null, avgSec: a.avgSec ?? null,
        learned: a.quality ?? null, base: a.base ?? null, confidence: a.confidence ?? 0, score: +score.toFixed(1),
      });
    }
    if (!rows.length) continue;
    rows.sort((x, y) => y.score - x.score);
    caps.push({ capability: cap, jobs: rows.reduce((n, r) => n + r.jobs, 0), models: rows.slice(0, top) });
  }
  return { mode, since: b.since, jobs: b.jobs || 0, settings: b.settings, capabilities: caps };
}

// ---------- export, reset, opt-in preview ----------
export function exportBrain() {
  const b = brain();
  const out = { app: "command-ai", kind: "learning-router", version: VERSION, exportedAt: new Date().toISOString(), since: b.since, jobs: b.jobs || 0, settings: b.settings, stats: b.stats };
  if (b.templates) out.templates = b.templates;
  return out;
}
export function resetBrain() {
  const prev = brain();
  const next = { ...fresh(), settings: { ...prev.settings }, resetAt: Date.now() };
  save(next);
  // the older skills table (council wins and thumbs, before Phase 28) is learned history too
  putDoc("skills", {});
  clearCommunity();
  emit("brain.update", { reset: true });
  return next;
}
// What an opt-in share would contain: per model and capability only counts and averages; no run ids,
// no user id, no dates finer than the month. Nothing is sent by this build.
export function sharePreview() {
  const b = brain(), rows = [];
  for (const [model, m] of Object.entries(b.stats)) for (const cap of TASK_CAPS) {
    if (!Object.keys(m.t).some((k) => k.startsWith(cap + ":"))) continue;
    const s = merged(model, cap, null);
    rows.push({ model, capability: cap, jobs: Math.round(s.jobs), successRate: s.jobs ? +(s.ok / s.jobs).toFixed(2) : null, winRate: s.rounds ? +(s.wins / s.rounds).toFixed(2) : null, avgScore: s.scoreN ? +(s.scoreSum / s.scoreN).toFixed(1) : null, thumbsUp: Math.round(s.up), thumbsDown: Math.round(s.down), costPerJob: s.costN ? +(s.cost / s.costN).toFixed(5) : null, avgSec: s.msN ? +(s.ms / s.msN / 1000).toFixed(1) : null });
  }
  return { optedIn: !!b.settings.shareOptIn, sent: false, month: new Date().toISOString().slice(0, 7), rows };
}
