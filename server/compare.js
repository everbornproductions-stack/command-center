// Side-by-side comparison (Phase 17): one prompt goes to 2 to 6 models the person picked, the answers
// stream into parallel columns, and each column reports its cost and latency.
//
//  - The person's own keys only. A column is never swapped for another model (smart fallback would defeat
//    the comparison): a provider at 100% of its monthly spend cap, or without a saved key, is skipped with
//    a note, and a provider that fails shows its error in its column.
//  - Every call is in the ledger (role "compare", the run id as missionId) and in the health lights; the
//    learning router sees each column as one job of the prompt's task type (no prompt text is kept there).
//  - "Pick winner" is a thumbs-up for the winning model through the ratings plugin (Phase 3 ratings), so
//    the router reads it like any other rating. One winner per comparison.
//  - Runs and presets are per-user documents (local: data folder; hosted: the user's own rows).
//  - Events: compare.update { run } on every column status change, compare.delta { runId, i, text }.
//    They are separate from agent.* so a comparison never takes over the Command view's live run.
import { PROVIDERS, findModel, estimateCostAt } from "./registry.js";
import { streamChat } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall } from "./health.js";
import { emit } from "./events.js";
import { doc, putDoc } from "./store.js";
import { hasSecret } from "./vault.js";
import { demosHidden, realJobSkipsDemo } from "./demo-visibility.js";
import { heuristicClassify } from "./router.js";
import { observe } from "./brain.js";
import { troubleKind, markTrouble } from "./fallback.js";
import { withMemory } from "./project-memory.js";
import { shouldWait, openWait, onSlotAnswer, onSlotStep, slotInfo } from "./answer-wait.js";

export const RUNS = "compare.runs";
export const PRESETS = "compare.presets";
export const MIN_COLUMNS = 2, MAX_COLUMNS = 6;
export const MAX_PROMPT = 20000, MAX_KEEP = 30, MAX_PRESETS = 50, MAX_TEXT = 20000;
const SYSTEM = "Answer the user as a sharp expert. Be concrete and complete but not padded. Markdown allowed.";

const bad = (msg, status = 400, code) => Object.assign(new Error(msg), { status, code });
const nameOf = (pid) => PROVIDERS[pid]?.name || pid;
const modelName = (m) => findModel(m)?.name || m;
const capped = () => doc("alerts.state", () => undefined)?.stop || []; // read only; the alerts plugin owns it
const keyed = (p) => !!p && hasSecret(p.id, p.keyEnv); // the router's rule (router.js availableModels)
const tokens = (chars) => Math.ceil(Number(chars || 0) / 4);

// in-flight runs, so a winner pick or a reload sees the live state before the last save
const live = new Map();

// ---------- what can be compared ----------
// Every text model the person can call right now, with an estimate for this prompt length.
export function compareModels({ chars = 400, maxTokens = 1200 } = {}) {
  const stop = capped();
  const inTok = tokens(chars) + 40, outTok = Math.round(Math.min(Number(maxTokens) || 1200, 4000) * 0.6);
  const out = [];
  for (const p of Object.values(PROVIDERS).filter((x) => x.kind === "text")) { // custom and demo AIs included
    if (p.demo && (!hasSecret(p.id) || demosHidden())) continue;
    const k = keyed(p);
    for (const m of p.models || []) out.push({ provider: p.id, providerName: p.name, color: p.color || null, model: m.id, name: m.name, tier: m.tier || null, keyed: k, capped: stop.includes(p.id), demo: !!p.demo, estCost: +estimateCostAt(m.id, inTok, outTok).toFixed(6) });
  }
  return { models: out, estimate: { inTok, outTok } };
}

// ---------- cleaning input ----------
function cleanColumns(cols) {
  if (!Array.isArray(cols)) throw bad("Pick 2 to 6 models to compare.");
  const seen = new Set(), out = [];
  for (const c of cols) {
    const provider = String(c?.provider || ""), model = String(c?.model || "");
    const p = PROVIDERS[provider];
    if (!p || p.kind !== "text") throw bad(`Unknown AI: ${provider || "(none)"}`);
    if (!(p.models || []).some((m) => m.id === model)) throw bad(`${p.name} has no model ${model || "(none)"}`);
    if (seen.has(`${provider}/${model}`)) continue; // the same model twice compares nothing
    seen.add(`${provider}/${model}`);
    out.push({ provider, model });
  }
  if (out.length < MIN_COLUMNS || out.length > MAX_COLUMNS) throw bad(`Pick ${MIN_COLUMNS} to ${MAX_COLUMNS} different models to compare (got ${out.length}).`);
  return out;
}

// ---------- runs ----------
const runsDoc = () => doc(RUNS, () => ({ items: [] }));
function save(run) {
  const d = runsDoc();
  const stored = { ...run, columns: run.columns.map((c) => ({ ...c, text: String(c.text || "").slice(0, MAX_TEXT) })) };
  d.items = [stored, ...d.items.filter((x) => x.id !== run.id)].slice(0, MAX_KEEP);
  putDoc(RUNS, d);
}
export const summaryOf = (r) => ({ id: r.id, title: r.prompt.slice(0, 90), status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt || null, cost: r.cost, capability: r.capability, columns: r.columns.map((c) => ({ provider: c.provider, model: c.model, name: c.name, status: c.status })), winner: r.winner?.model || null });
export const listRuns = () => runsDoc().items.map((r) => summaryOf(live.get(r.id) || r));
export const getRun = (id) => live.get(id) || runsDoc().items.find((r) => r.id === id) || null;
const publish = (run) => emit("compare.update", { run });

// Starts the comparison and returns the run at once; the columns stream in through events.
// `done` resolves with the finished run (tests and callers that want to wait).
export function startCompare({ prompt, columns, maxTokens = 1200, projectId = null } = {}) {
  prompt = String(prompt || "").trim();
  if (!prompt) throw bad("Type a prompt to compare.");
  if (prompt.length > MAX_PROMPT) throw bad(`The prompt is too long (${prompt.length} characters, the limit is ${MAX_PROMPT}).`);
  const cols = cleanColumns(columns);
  maxTokens = Math.min(4000, Math.max(100, Math.round(Number(maxTokens) || 1200)));
  const cls = heuristicClassify(prompt);
  const id = "x-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const stop = capped();
  const run = {
    id, kind: "compare", prompt, projectId: projectId || null, capability: cls.capability, difficulty: cls.difficulty, maxTokens,
    startedAt: Date.now(), finishedAt: null, status: "running", cost: 0, winner: null,
    columns: cols.map((c, i) => {
      const p = PROVIDERS[c.provider];
      const base = { i, provider: c.provider, providerName: p.name, color: p.color || null, model: c.model, name: modelName(c.model), status: "queued", note: null, text: "", ms: null, ttftMs: null, cost: null, inTok: null, outTok: null, exact: false, startedAt: null, finishedAt: null };
      if (stop.includes(c.provider)) return { ...base, status: "skipped", note: `Skipped: ${p.name} has reached its monthly spend cap. Raise the cap in Settings > Spend caps to include it.` };
      if (realJobSkipsDemo(p)) return { ...base, status: "skipped", note: `Skipped: ${p.name} is a demo AI, and a real AI is connected.` };
      if (!keyed(p)) return { ...base, status: "skipped", note: `Skipped: no API key saved for ${p.name}. Add it in Settings.` };
      return base;
    }),
  };
  live.set(id, run);
  save(run);
  publish(run);
  const going = run.columns.filter((c) => c.status === "queued");
  emit("log", { text: `Side-by-side: ${going.map((c) => c.name).join(", ") || "nothing to run"}${run.columns.length > going.length ? ` (${run.columns.length - going.length} skipped)` : ""}.`, missionId: id });
  const done = Promise.all(going.map((c) => runColumn(run, c))).then(() => {
    run.status = runStatus(run);
    run.finishedAt = Date.now();
    run.cost = +run.columns.reduce((a, c) => a + (c.cost || 0), 0).toFixed(6);
    save(run);
    live.delete(id);
    publish(run);
    emit("log", { text: `Side-by-side finished in ${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s for $${run.cost.toFixed(4)}. Pick the winner to teach the router.`, missionId: id });
    return run;
  });
  return { run, done };
}

async function runColumn(run, c) {
  const s = Date.now();
  c.status = "streaming"; c.startedAt = s;
  publish(run);
  let usage = null;
  try {
    for await (const ev of streamChat({ provider: c.provider, model: c.model, maxTokens: run.maxTokens, system: SYSTEM, messages: [{ role: "user", content: withMemory(run.prompt, run.projectId) }] })) {
      if (ev.type === "delta") {
        if (c.ttftMs == null) c.ttftMs = Date.now() - s;
        c.text += ev.text;
        emit("compare.delta", { runId: run.id, i: c.i, text: ev.text });
      } else if (ev.type === "done") usage = ev.usage;
    }
    const ms = Date.now() - s;
    noteCall(c.provider, true, ms);
    const e = recordCall({ provider: c.provider, model: c.model, usage: usage || { input: tokens(run.prompt.length), output: tokens(c.text.length), estimated: true }, missionId: run.id, role: "compare", ms });
    Object.assign(c, { status: "done", ms, cost: e.cost, inTok: e.inTok, outTok: e.outTok, exact: !!e.exact, finishedAt: Date.now() });
    observe({ provider: c.provider, model: c.model, capability: run.capability, difficulty: run.difficulty, runId: run.id, ok: true, cost: e.cost, ms, free: e.free });
  } catch (err) {
    const ms = Date.now() - s;
    noteCall(c.provider, false, ms, err);
    const kind = troubleKind(err);
    if (kind) markTrouble(c.provider, kind, err.message, { quiet: true, missionId: run.id }); // smart fallback learns of it for other jobs
    else observe({ provider: c.provider, model: c.model, capability: run.capability, difficulty: run.difficulty, runId: run.id, ok: false });
    if (shouldWait(err)) {
      // out of API credits: this column keeps its own AI and answers through the person's own plan
      const waiting = openWait({ kind: "compare", runId: run.id, slot: c.i, provider: c.provider, model: c.model, ask: withMemory(run.prompt, run.projectId), system: SYSTEM, title: run.prompt });
      Object.assign(c, { status: "waiting", ms, waiting, note: waiting.headline, text: "" });
    } else Object.assign(c, { status: "error", ms, note: err.message || "the call failed", finishedAt: Date.now() });
  }
  publish(run);
}

// "Pick winner": a thumbs-up for that model, written through the ratings plugin so the router reads it.
// rateFn(item) is the ratings plugin's saveRating bound to the request helpers.
export function pickWinner(id, { column, model } = {}, rateFn) {
  const run = getRun(id);
  if (!run) throw bad("No such comparison.", 404);
  if (run.status === "running") throw bad("Wait until every column has finished, then pick the winner.", 409);
  if (run.winner) throw bad(`The winner of this comparison is already picked (${run.winner.name}).`, 409);
  const c = run.columns.find((x) => (column !== undefined && column !== null ? x.i === Number(column) : x.model === model));
  if (!c) throw bad("Pick one of this comparison's columns.");
  if (c.status !== "done") throw bad("Only a column that answered can win.");
  const rating = rateFn({ missionId: run.id, kind: "compare", provider: c.provider, model: c.model, capability: run.capability, up: true, note: `won a side-by-side against ${run.columns.filter((x) => x !== c && x.status === "done").map((x) => x.name).join(", ") || "no other answer"}` });
  run.winner = { i: c.i, provider: c.provider, model: c.model, name: c.name, at: Date.now() };
  save(run);
  publish(run);
  emit("log", { text: `Side-by-side winner: ${c.name} (${nameOf(c.provider)}) for ${run.capability}. The router will favour it for this kind of work.`, missionId: run.id });
  return { run, rating };
}

// ---------- presets: saved model sets ----------
const presetsDoc = () => doc(PRESETS, () => ({ items: [] }));
export const listPresets = () => presetsDoc().items;
export function savePreset({ name, columns } = {}) {
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw bad("Give the preset a name.");
  const cols = cleanColumns(columns);
  const d = presetsDoc();
  const prev = d.items.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const item = { id: prev?.id || "cp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, columns: cols, createdAt: prev?.createdAt || Date.now(), updatedAt: Date.now() };
  if (!prev && d.items.length >= MAX_PRESETS) throw bad(`You have ${MAX_PRESETS} presets. Delete one first.`, 409);
  d.items = [item, ...d.items.filter((x) => x.id !== item.id)];
  putDoc(PRESETS, d);
  return item;
}
export function deletePreset(pid) {
  const d = presetsDoc();
  const n = d.items.length;
  d.items = d.items.filter((x) => x.id !== pid);
  if (d.items.length === n) throw bad("No such preset.", 404);
  putDoc(PRESETS, d);
  return true;
}

// ---------- a column that waited on the person's own plan (server/answer-wait.js) ----------
function runStatus(run) {
  if (run.columns.some((c) => c.status === "done")) return "done";
  if (run.columns.some((c) => c.status === "waiting")) return "waiting";
  return "failed";
}
onSlotAnswer("compare", (job, res) => {
  const run = getRun(job.runId);
  if (!run) return;
  const c = run.columns.find((x) => x.i === Number(job.slot));
  if (!c || c.status !== "waiting") return;
  if (res.stopped) Object.assign(c, { status: "error", waiting: null, note: `Stopped waiting. No answer came back from ${job.aiName}.`, finishedAt: Date.now() });
  else Object.assign(c, { status: "done", waiting: null, text: String(res.text || "").slice(0, MAX_TEXT), note: res.tag, via: "subscription", cost: 0, inTok: 0, outTok: 0, exact: true, finishedAt: Date.now() });
  if (!live.has(run.id)) {
    run.status = runStatus(run);
    run.finishedAt = run.finishedAt || Date.now();
    save(run);
  }
  publish(run);
});
onSlotStep("compare", (job) => {
  const run = getRun(job.runId);
  const c = run?.columns.find((x) => x.i === Number(job.slot));
  if (!c || c.status !== "waiting") return;
  c.waiting = slotInfo(job);
  c.note = c.waiting.headline;
  if (!live.has(run.id)) save(run);
  publish(run);
});
