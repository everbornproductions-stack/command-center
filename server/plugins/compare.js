// Phase 17: side-by-side comparison.
// One prompt goes to 2 to 6 models at once. Answers stream in parallel.
// Cost and speed are recorded with the existing ledger (recordCall: cost, ms, model, role "compare").
// Pick winner writes the same ratings.log rows as Phase 3 and calls recordOutcome, so the router
// (and later the Phase 28 learning router) can read the thumbs, the task type, and the cost and
// speed. The ledger line and the rating never store the prompt or the answer text.
import { heuristicClassify, recordOutcome, availableModels } from "../router.js";
import { noteCall } from "../health.js";

export const id = "compare";
export const MIN_MODELS = 2;
export const MAX_MODELS = 6;

const RUNS = "compare.runs";
const PRESETS = "compare.presets";
const RATINGS = "ratings.log";
const MAX_PROMPT = 8000;
const MAX_RUNS = 30;
const MAX_PRESETS = 40;

export function selectionError(models) {
  if (!Array.isArray(models) || models.length < MIN_MODELS || models.length > MAX_MODELS) return "Pick 2 to 6 models.";
  const keys = [];
  for (const m of models) {
    if (!m || typeof m.provider !== "string" || typeof m.model !== "string" || !m.provider.trim() || !m.model.trim()) return "Each model needs a provider and a model id.";
    keys.push(`${m.provider}\0${m.model}`);
  }
  if (new Set(keys).size !== keys.length) return "Each model can only be picked once.";
  return null;
}

export function capSkipNote(providerName) {
  return `Skipped: ${providerName} is at its monthly spend cap, so this column was not called.`;
}
export function keySkipNote(providerName) {
  return `Skipped: no key is saved for ${providerName}, so this column was not called.`;
}

function liveMap(h) {
  const c = h.ctx();
  if (!c.compareLive) c.compareLive = new Map();
  return c.compareLive;
}
function remember(h, run) {
  const m = liveMap(h);
  m.set(run.id, run);
  while (m.size > MAX_RUNS) m.delete(m.keys().next().value);
}

export function snapshot(run) {
  return {
    id: run.id,
    kind: "compare",
    prompt: run.prompt,
    presetId: run.presetId || null,
    classification: run.classification ? { capability: run.classification.capability, difficulty: run.classification.difficulty, source: run.classification.source } : null,
    columns: (run.columns || []).map((c) => ({
      id: c.id, provider: c.provider, providerName: c.providerName, model: c.model, modelName: c.modelName,
      status: c.status, text: c.text || "", cost: c.cost ?? null, ms: c.ms ?? null,
      startedAt: c.startedAt || null, finishedAt: c.finishedAt || null, note: c.note || null, error: c.error || null,
    })),
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    cost: run.cost || 0,
    winner: run.winner || null,
    votes: run.votes ? { ...run.votes } : {},
  };
}

function summarize(run) {
  const s = snapshot(run);
  return { ...s, prompt: String(s.prompt || "").slice(0, 90), columns: s.columns.map(({ text, ...rest }) => rest) };
}

function cappedIds(h) {
  // Same list the router reads (alerts plugin writes it when a provider hits 100% of its cap).
  const stop = h.ctx().docs["alerts.state"]?.stop;
  return new Set(Array.isArray(stop) ? stop : []);
}

function resolveOne(h, m) {
  const p = h.PROVIDERS[m.provider];
  if (!p || p.kind !== "text") return { error: `Unknown provider: ${m.provider}.` };
  const spec = (p.models || []).find((x) => x.id === m.model);
  if (!spec) return { error: `Unknown model: ${m.model}.` };
  return { provider: p, spec };
}

function columnFor(h, m, i, capped) {
  const { provider: p, spec } = m;
  const col = {
    id: `c${i}`, provider: p.id, providerName: p.name, model: spec.id, modelName: spec.name,
    status: "queued", text: "", cost: null, ms: null, startedAt: null, finishedAt: null, note: null, error: null,
  };
  if (capped.has(p.id)) { col.status = "skipped"; col.note = capSkipNote(p.name); }
  else if (!h.hasSecret(p.id, p.keyEnv)) { col.status = "skipped"; col.note = keySkipNote(p.name); }
  return col;
}

function presetsDoc(h) { return h.doc(PRESETS, () => ({ items: [] })); }
function runsDoc(h) { return h.doc(RUNS, () => ({ items: [] })); }

function saveRun(h, run) {
  remember(h, run);
  const d = runsDoc(h);
  const snap = snapshot(run);
  const i = d.items.findIndex((x) => x.id === run.id);
  if (i >= 0) d.items[i] = snap; else d.items.unshift(snap);
  d.items = d.items.slice(0, MAX_RUNS);
  h.putDoc(RUNS, d);
  return snap;
}

function mutableRun(h, id) {
  const live = liveMap(h).get(id);
  if (live) return live;
  const found = runsDoc(h).items.find((x) => x.id === id);
  if (found) remember(h, found);
  return found || null;
}

function overview(h) {
  const capped = cappedIds(h);
  const models = availableModels().filter((m) => m.keyed).map((m) => ({
    provider: m.provider, providerName: m.providerName, color: m.color, model: m.model, name: m.name,
    in: m.in, out: m.out, capped: capped.has(m.provider),
  }));
  return { min: MIN_MODELS, max: MAX_MODELS, models, presets: presetsDoc(h).items, runs: runsDoc(h).items.map(summarize) };
}

function bad(res, h, error, status = 400) { return h.json(res, status, { error }); }

function loadModels(h, body) {
  let models = body.models;
  let presetId = null;
  if ((!Array.isArray(models) || !models.length) && body.presetId) {
    const preset = presetsDoc(h).items.find((p) => p.id === body.presetId);
    if (!preset) return { error: "Unknown preset.", status: 404 };
    models = preset.models;
    presetId = preset.id;
  }
  const sel = selectionError(models);
  if (sel) return { error: sel };
  const resolved = [];
  for (const m of models) {
    const r = resolveOne(h, m);
    if (r.error) return { error: r.error };
    resolved.push(r);
  }
  return { resolved, presetId };
}

let seq = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/compare\/?/, "");
  if (req.method === "GET" && p === "") return h.json(res, 200, overview(h));
  if (req.method === "POST" && p === "") return start(res, body, h);
  if (req.method === "GET" && p === "presets") return h.json(res, 200, { presets: presetsDoc(h).items });
  if (req.method === "POST" && p === "presets") return savePreset(res, body, h);
  if (req.method === "DELETE" && p.startsWith("presets/")) return deletePreset(res, decodeURIComponent(p.slice("presets/".length)), h);
  const win = p.match(/^([^/]+)\/winner$/);
  if (req.method === "POST" && win) return pickWinner(res, decodeURIComponent(win[1]), body, h);
  if (req.method === "GET" && p && !p.includes("/")) {
    const run = mutableRun(h, decodeURIComponent(p));
    return run ? h.json(res, 200, snapshot(run)) : bad(res, h, "Comparison not found.", 404);
  }
  return false;
}

function start(res, body, h) {
  const prompt = String(body.prompt || "").trim();
  if (!prompt) return bad(res, h, "Write a prompt first.");
  if (prompt.length > MAX_PROMPT) return bad(res, h, `That prompt is too long (${MAX_PROMPT} characters max).`);
  const loaded = loadModels(h, body || {});
  if (loaded.error) return bad(res, h, loaded.error, loaded.status || 400);
  const cls = heuristicClassify(prompt);
  const capped = cappedIds(h);
  const run = {
    id: newId("k"), kind: "compare", prompt, presetId: loaded.presetId, classification: cls,
    columns: loaded.resolved.map((m, i) => columnFor(h, m, i, capped)),
    status: "running", startedAt: Date.now(), finishedAt: null, cost: 0, winner: null, votes: {},
  };
  saveRun(h, run);
  const skipped = run.columns.filter((c) => c.status === "skipped");
  const names = run.columns.filter((c) => c.status !== "skipped").map((c) => c.providerName);
  h.emit("log", { text: `Side-by-side started${names.length ? `: ${names.join(", ")}` : ""}.` });
  for (const c of skipped) h.emit("log", { text: c.note });
  h.emit("compare.update", { compare: snapshot(run) });
  runCompare(h, run).catch((err) => {
    run.status = "failed"; run.error = err.message; run.finishedAt = Date.now();
    saveRun(h, run);
    h.emit("compare.update", { compare: snapshot(run) });
    h.emit("log", { text: `Side-by-side failed: ${err.message}`, level: "error" });
  });
  return h.json(res, 202, { ok: true, id: run.id, compare: snapshot(run) });
}

async function runCompare(h, run) {
  const jobs = run.columns.filter((c) => c.status === "queued");
  if (jobs.length) await Promise.all(jobs.map((col) => answerColumn(h, run, col)));
  const answered = run.columns.some((c) => c.status === "done");
  const errored = run.columns.some((c) => c.status === "error");
  run.status = answered || !errored ? "done" : "failed";
  run.finishedAt = Date.now();
  run.cost = +run.columns.reduce((a, c) => a + (Number(c.cost) || 0), 0).toFixed(6);
  saveRun(h, run);
  h.emit("compare.update", { compare: snapshot(run) });
  const secs = ((run.finishedAt - run.startedAt) / 1000).toFixed(0);
  h.emit("log", { text: `Side-by-side finished in ${secs}s for $${run.cost.toFixed(4)}.` });
}

async function answerColumn(h, run, col) {
  col.status = "running";
  col.startedAt = Date.now();
  h.emit("compare.update", { compare: snapshot(run) });
  let usage = null;
  let last = 0;
  try {
    for await (const ev of h.streamChat({
      provider: col.provider, model: col.model, maxTokens: 1500,
      system: "Answer the user as a sharp expert. Be concrete and complete but not padded. Markdown allowed.",
      messages: [{ role: "user", content: run.prompt }],
    })) {
      if (ev.type === "delta") {
        col.text += ev.text;
        const now = Date.now();
        if (now - last >= 300) { last = now; h.emit("compare.update", { compare: snapshot(run) }); }
      } else if (ev.type === "done") usage = ev.usage || null;
    }
    const ms = Date.now() - col.startedAt;
    noteCall(col.provider, true, ms);
    const safeUsage = {
      input: Number(usage?.input) || 0, output: Number(usage?.output) || 0,
      estimated: !usage || !!usage.estimated, cost: typeof usage?.cost === "number" ? usage.cost : undefined,
      actualModel: usage?.actualModel,
    };
    const e = h.recordCall({ provider: col.provider, model: col.model, usage: safeUsage, missionId: run.id, role: "compare", ms });
    col.cost = e.cost;
    col.ms = e.ms ?? ms;
    col.finishedAt = Date.now();
    col.status = "done";
    saveRun(h, run);
    h.emit("compare.update", { compare: snapshot(run) });
  } catch (err) {
    noteCall(col.provider, false, Date.now() - col.startedAt, err.status);
    col.status = "error";
    col.error = String(err.message || "The call failed").slice(0, 300);
    col.note = col.error;
    col.ms = Date.now() - col.startedAt;
    col.finishedAt = Date.now();
    saveRun(h, run);
    h.emit("compare.update", { compare: snapshot(run) });
    h.emit("log", { text: `${col.providerName} could not answer in the side-by-side: ${col.error}`, level: "error" });
  }
}

function savePreset(res, body, h) {
  const name = String(body.name || "").trim();
  if (!name || name.length > 48) return bad(res, h, "Name the preset (48 characters max).");
  const sel = selectionError(body.models);
  if (sel) return bad(res, h, sel);
  for (const m of body.models) {
    const r = resolveOne(h, m);
    if (r.error) return bad(res, h, r.error);
  }
  const d = presetsDoc(h);
  const preset = {
    id: newId("p"), name, createdAt: Date.now(),
    models: body.models.map((m) => ({ provider: m.provider, model: m.model })),
  };
  d.items.unshift(preset);
  d.items = d.items.slice(0, MAX_PRESETS);
  h.putDoc(PRESETS, d);
  h.emit("log", { text: `Saved comparison preset "${name}".` });
  return h.json(res, 200, { preset, presets: d.items });
}

function deletePreset(res, id, h) {
  const d = presetsDoc(h);
  const next = d.items.filter((p) => p.id !== id);
  if (next.length === d.items.length) return bad(res, h, "Unknown preset.", 404);
  d.items = next;
  h.putDoc(PRESETS, d);
  return h.json(res, 200, { presets: d.items });
}

// One rating per model for this run, in the same document Phase 3 uses.
// recordOutcome runs only when the thumbs value is new, so changing the winner does not double-count.
function writeRating(h, item) {
  const d = h.doc(RATINGS, () => ({ items: [] }));
  const prev = d.items.find((x) => x.missionId === item.missionId && x.model === item.model);
  d.items = d.items.filter((x) => !(x.missionId === item.missionId && x.model === item.model));
  d.items.unshift(item);
  d.items = d.items.slice(0, 2000);
  h.putDoc(RATINGS, d);
  if (!prev || prev.up !== item.up || prev.capability !== item.capability) recordOutcome(item.model, item.capability, item.up);
  return item;
}

function pickWinner(res, id, body, h) {
  const run = mutableRun(h, id);
  if (!run) return bad(res, h, "Comparison not found.", 404);
  if (run.status === "running") return bad(res, h, "Wait until the columns finish, then pick a winner.");
  const model = String(body.model || "");
  const col = run.columns.find((c) => c.model === model);
  if (!col || col.status !== "done" || !col.text) return bad(res, h, "That column did not answer, so it cannot win.");
  const capability = run.classification?.capability || "writing";
  run.votes ||= {};
  for (const c of run.columns) {
    if (c.status !== "done" || !c.text) continue;
    const up = c.model === model;
    writeRating(h, {
      ts: Date.now(), missionId: run.id, kind: "compare", provider: c.provider, model: c.model,
      capability, up, cost: c.cost, ms: c.ms,
      note: up ? "Picked as the winner in a side-by-side comparison." : "Not picked in a side-by-side comparison.",
    });
    run.votes[c.model] = up;
  }
  run.winner = model;
  saveRun(h, run);
  h.emit("log", { text: `Winner picked: ${col.providerName} (${model}) for ${capability}. The router will favour it next time.` });
  h.emit("compare.update", { compare: snapshot(run) });
  return h.json(res, 200, snapshot(run));
}
