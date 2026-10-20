// Anonymous community track records, kept on this computer.
// Quality, Balanced, and Economy all read them. Nothing is uploaded.
// A row is counts and averages only: task type, which model, and the score. No prompts, answers, or keys.
import { CAPABILITIES } from "./registry.js";
import { doc, putDoc } from "./store.js";

export const KIND = "brain.community";
const ALLOWED = new Set(["model", "capability", "jobs", "successRate", "winRate", "avgScore", "thumbsUp", "thumbsDown", "costPerJob", "avgSec"]);
const FIELDS = ["jobs", "ok", "fail", "rounds", "wins", "scoreSum", "scoreN", "qaSum", "qaN", "up", "down", "cost", "costN", "ms", "msN"];

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const cleanId = (s) => String(s || "").replace(/[^A-Za-z0-9._:/@+-]/g, "").slice(0, 120);
const empty = () => ({ jobs: 0, ok: 0, fail: 0, rounds: 0, wins: 0, scoreSum: 0, scoreN: 0, qaSum: 0, qaN: 0, up: 0, down: 0, cost: 0, costN: 0, ms: 0, msN: 0, last: 0 });
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function blank() { return { v: 1, updatedAt: 0, models: {} }; }
function load() {
  const d = doc(KIND, blank);
  d.models ||= {};
  return d;
}

export function communitySummary() {
  const d = load();
  let rows = 0;
  for (const caps of Object.values(d.models)) rows += Object.keys(caps).length;
  return { rows, models: Object.keys(d.models).length, updatedAt: d.updatedAt || null };
}

export function communityModels() {
  return Object.keys(load().models);
}

export function communityStat(model, cap) {
  const out = empty();
  const row = load().models?.[model]?.[cap];
  if (!row) return out;
  for (const f of FIELDS) out[f] = Number(row[f]) || 0;
  return out;
}

export function clearCommunity() {
  putDoc(KIND, blank());
}

function rowStat(row) {
  const jobs = num(row.jobs);
  if (jobs == null || jobs < 0 || jobs > 1e7) throw bad("Jobs must be a number from 0 to 10000000.");
  const n = Math.round(jobs);
  const rate = (name) => {
    if (row[name] == null) return null;
    const v = num(row[name]);
    if (v == null || v < 0 || v > 1) throw bad(`${name} must be from 0 to 1.`);
    return v;
  };
  const success = rate("successRate");
  const win = rate("winRate");
  let score = null;
  if (row.avgScore != null) {
    score = num(row.avgScore);
    if (score == null || score < 0 || score > 10) throw bad("avgScore must be from 0 to 10.");
  }
  const up = row.thumbsUp == null ? 0 : num(row.thumbsUp);
  const down = row.thumbsDown == null ? 0 : num(row.thumbsDown);
  if (up == null || down == null || up < 0 || down < 0 || up > 1e7 || down > 1e7) throw bad("Thumbs must be a number from 0 up.");
  let cost = null;
  if (row.costPerJob != null) {
    cost = num(row.costPerJob);
    if (cost == null || cost < 0 || cost > 1000) throw bad("costPerJob must be a dollar amount.");
  }
  let sec = null;
  if (row.avgSec != null) {
    sec = num(row.avgSec);
    if (sec == null || sec < 0 || sec > 3600) throw bad("avgSec must be seconds.");
  }
  const s = empty();
  s.jobs = n;
  s.ok = success == null ? n : Math.round(success * n);
  s.fail = Math.max(0, n - s.ok);
  if (win != null && n > 0) { s.rounds = n; s.wins = Math.round(win * n); }
  if (score != null && n > 0) { s.scoreN = n; s.scoreSum = score * n; }
  s.up = Math.round(up);
  s.down = Math.round(down);
  if (cost != null && n > 0) { s.costN = n; s.cost = cost * n; }
  if (sec != null && n > 0) { s.msN = n; s.ms = sec * 1000 * n; }
  return s;
}

// Replace the on-device community pool. Called only from an explicit import.
export function replaceCommunity(rows) {
  if (!Array.isArray(rows)) throw bad("Send rows: a list of anonymous totals.");
  if (rows.length > 400) throw bad("Too many rows.");
  const models = {};
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw bad("Each row must be an object.");
    for (const k of Object.keys(row)) if (!ALLOWED.has(k)) throw bad("A row has a field that is not an anonymous total.");
    const model = cleanId(row.model);
    if (!model) throw bad("A row needs a model id.");
    if (!CAPABILITIES.includes(row.capability)) throw bad("A row needs a known task type.");
    const s = rowStat(row);
    const slot = (models[model] ||= {});
    const prev = slot[row.capability];
    if (!prev) slot[row.capability] = s;
    else for (const f of FIELDS) prev[f] += s[f];
  }
  const saved = { v: 1, updatedAt: Date.now(), models };
  putDoc(KIND, saved);
  return communitySummary();
}
