// Side-by-side comparison (Phase 17). One prompt goes to 2 to 6 models the person picked.
// Answers stream in parallel. Cost and latency are the normal ledger lines (recordCall);
// "Pick winner" is a Phase 3 rating, so the router (and a later learning router) reads it
// from the same skills table as a thumbs up. No prompt text is stored on those records.
import { heuristicClassify, recordOutcome } from "../router.js";
import { noteCall } from "../health.js";

export const id = "compare";
const RUNS = "compare.runs";
const PRESETS = "compare.presets";
export const LIMITS = { min: 2, max: 6 };

const live = new Map();

export function selectionError(models) {
  if (!Array.isArray(models) || models.length < LIMITS.min || models.length > LIMITS.max) return `Choose ${LIMITS.min} to ${LIMITS.max} models.`;
  const seen = new Set();
  for (const m of models) {
    if (!m || typeof m.provider !== "string" || typeof m.model !== "string") return "Each model needs a provider and a model id.";
    const provider = m.provider.trim();
    const model = m.model.trim();
    if (!provider || !model || provider.length > 80 || model.length > 160) return "Each model needs a provider and a model id.";
    const key = `${provider}\n${model}`;
    if (seen.has(key)) return "Each model can only appear once.";
    seen.add(key);
  }
  return null;
}

export const spendCapNote = (name) => `Skipped: ${name} is at its monthly spend cap. No call was made.`;
export const noKeyNote = (name) => `Skipped: ${name} has no key saved. No call was made.`;

const stopped = (h) => new Set(h.ctx().docs["alerts.state"]?.stop || []);

function lookup(h, providerId, modelId) {
  const p = h.PROVIDERS[providerId];
  if (!p || p.kind !== "text") return null;
  const m = (p.models || []).find((x) => x.id === modelId);
  if (!m) return null;
  return { provider: p, model: m };
}

function snapshot(run) {
  return {
    id: run.id, kind: "compare", prompt: run.prompt, projectId: run.projectId || null,
    classification: run.classification, status: run.status, startedAt: run.startedAt,
    finishedAt: run.finishedAt || null, cost: run.cost || 0, winner: run.winner || null,
    columns: run.columns.map((c) => ({
      provider: c.provider, providerName: c.providerName, color: c.color, model: c.model, modelName: c.modelName,
      status: c.status, text: c.text || "", cost: c.cost ?? null, ms: c.ms ?? null, note: c.note || null, winner: !!c.winner,
    })),
  };
}

function remember(run) {
  live.set(run.id, run);
  if (live.size > 40) {
    const old = [...live.values()].filter((r) => r.status !== "running").sort((a, b) => a.startedAt - b.startedAt)[0];
    if (old) live.delete(old.id);
  }
  return run;
}

function persist(h, run) {
  const d = h.doc(RUNS, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  const snap = snapshot(run);
  const i = d.items.findIndex((x) => x.id === run.id);
  if (i >= 0) d.items[i] = snap; else d.items.unshift(snap);
  d.items = d.items.slice(0, 30);
  h.putDoc(RUNS, d);
  return snap;
}

function load(h, runId) {
  if (!/^[a-z0-9-]{4,40}$/.test(runId)) return null;
  if (live.has(runId)) return live.get(runId);
  const found = (h.doc(RUNS, () => ({ items: [] })).items || []).find((x) => x.id === runId);
  if (found) live.set(runId, found);
  return found || null;
}

function presets(h) {
  const d = h.doc(PRESETS, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}

function modelChoices(h) {
  const stop = stopped(h);
  const out = [];
  for (const p of Object.values(h.PROVIDERS)) {
    if (p.kind !== "text" || !h.hasSecret(p.id, p.keyEnv)) continue;
    for (const m of p.models || []) out.push({ provider: p.id, providerName: p.name, color: p.color, model: m.id, modelName: m.name, tier: m.tier, capped: stop.has(p.id) });
  }
  return out;
}

function resolveList(h, models) {
  const err = selectionError(models);
  if (err) return { error: err };
  const stop = stopped(h);
  const columns = [];
  for (const raw of models) {
    const hit = lookup(h, raw.provider.trim(), raw.model.trim());
    if (!hit) return { error: `Unknown model: ${raw.model}` };
    const col = { provider: hit.provider.id, providerName: hit.provider.name, color: hit.provider.color, model: hit.model.id, modelName: hit.model.name, status: "queued", text: "", cost: null, ms: null, note: null, winner: false };
    if (!h.hasSecret(hit.provider.id, hit.provider.keyEnv)) { col.status = "skipped"; col.note = noKeyNote(hit.provider.name); }
    else if (stop.has(hit.provider.id)) { col.status = "skipped"; col.note = spendCapNote(hit.provider.name); }
    columns.push(col);
  }
  return { columns };
}

// Same shape as server/plugins/ratings.js so a side-by-side pick is a normal rating.
function writeRating(h, { missionId, provider, model, capability, up, note }) {
  const d = h.doc("ratings.log", () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  const item = { ts: Date.now(), missionId, kind: "compare", provider, model, capability: capability || "writing", up: !!up, note: String(note || "").slice(0, 300) };
  d.items = d.items.filter((x) => !(x.missionId === missionId && x.model === model));
  d.items.unshift(item);
  d.items = d.items.slice(0, 2000);
  h.putDoc("ratings.log", d);
  recordOutcome(model, item.capability, item.up);
  return item;
}

async function answerOne(h, run, col) {
  col.status = "streaming";
  h.emit("compare.update", { compare: snapshot(run) });
  const s = Date.now();
  let text = "";
  try {
    for await (const ev of h.streamChat({
      provider: col.provider, model: col.model, maxTokens: 1800,
      system: "Answer the user as a sharp expert. Be concrete and complete but not padded. Markdown allowed.",
      messages: [{ role: "user", content: run.prompt }],
    })) {
      if (ev.type === "delta") {
        text += ev.text;
        col.text = text;
        h.emit("compare.delta", { id: run.id, provider: col.provider, model: col.model, text: ev.text });
      } else if (ev.type === "done") {
        const ms = Date.now() - s;
        noteCall(col.provider, true, ms);
        const e = h.recordCall({ provider: col.provider, model: col.model, usage: ev.usage, missionId: run.id, role: "compare", ms });
        col.ms = e.ms;
        col.cost = e.cost;
        col.status = "done";
        col.text = text;
        run.cost = +run.columns.reduce((a, c) => a + (c.cost || 0), 0).toFixed(6);
      }
    }
    if (col.status === "streaming") { col.status = "done"; col.text = text; col.ms = Date.now() - s; }
  } catch (err) {
    noteCall(col.provider, false, Date.now() - s, err.status);
    col.status = "error";
    col.ms = Date.now() - s;
    col.note = String(err.message || "The call failed.").slice(0, 300);
    h.emit("log", { text: `${col.providerName} failed in the side-by-side: ${col.note}`, level: "error", missionId: run.id });
  }
  h.emit("compare.update", { compare: snapshot(run) });
  persist(h, run);
}

async function execute(h, run) {
  await Promise.all(run.columns.filter((c) => c.status === "queued").map((c) => answerOne(h, run, c)));
  const anyAnswer = run.columns.some((c) => c.status === "done");
  const anySkip = run.columns.some((c) => c.status === "skipped");
  run.status = anyAnswer || anySkip ? "done" : "failed";
  run.finishedAt = Date.now();
  run.cost = +run.columns.reduce((a, c) => a + (c.cost || 0), 0).toFixed(6);
  persist(h, run);
  h.emit("compare.update", { compare: snapshot(run) });
  h.emit("log", { text: `Side-by-side finished in ${((run.finishedAt - run.startedAt) / 1000).toFixed(0)}s for $${run.cost.toFixed(4)}.`, missionId: run.id });
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/compare/, "") || "/";
  const bad = (code, error) => h.json(res, code, { error });

  if (req.method === "GET" && (p === "/" || p === "")) {
    const items = h.doc(RUNS, () => ({ items: [] })).items || [];
    const active = [...live.values()].find((r) => r.status === "running");
    return h.json(res, 200, { min: LIMITS.min, max: LIMITS.max, models: modelChoices(h), presets: presets(h).items, recent: items.slice(0, 12).map((r) => ({ id: r.id, prompt: r.prompt, status: r.status, cost: r.cost, startedAt: r.startedAt, winner: r.winner, columns: r.columns.map((c) => ({ provider: c.provider, model: c.model, modelName: c.modelName, status: c.status, cost: c.cost, ms: c.ms, winner: c.winner })) })), active: active ? active.id : null });
  }

  if (req.method === "GET" && p === "/presets") return h.json(res, 200, { items: presets(h).items });

  if (req.method === "POST" && p === "/presets") {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) return bad(400, "Name the preset.");
    const resolved = resolveList(h, body.models);
    if (resolved.error) return bad(400, resolved.error);
    if (resolved.columns.some((c) => c.status === "skipped" && /no key/i.test(c.note || ""))) return bad(400, "A preset can only hold models that have a key.");
    const d = presets(h);
    const item = { id: "cp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, models: resolved.columns.map((c) => ({ provider: c.provider, model: c.model })), createdAt: Date.now() };
    d.items = d.items.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
    d.items.unshift(item);
    d.items = d.items.slice(0, 40);
    h.putDoc(PRESETS, d);
    return h.json(res, 200, item);
  }

  const presetId = p.match(/^\/presets\/([a-z0-9-]+)$/);
  if (presetId && req.method === "GET") {
    const item = presets(h).items.find((x) => x.id === presetId[1]);
    return item ? h.json(res, 200, item) : bad(404, "That preset was not found.");
  }
  if (presetId && req.method === "DELETE") {
    const d = presets(h);
    const before = d.items.length;
    d.items = d.items.filter((x) => x.id !== presetId[1]);
    if (d.items.length === before) return bad(404, "That preset was not found.");
    h.putDoc(PRESETS, d);
    return h.json(res, 200, { ok: true });
  }

  if (req.method === "POST" && (p === "/" || p === "")) {
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return bad(400, "Type a prompt first.");
    let models = body.models;
    if ((!Array.isArray(models) || !models.length) && body.presetId) {
      const preset = presets(h).items.find((x) => x.id === body.presetId);
      if (!preset) return bad(404, "That preset was not found.");
      models = preset.models;
    }
    const resolved = resolveList(h, models);
    if (resolved.error) return bad(400, resolved.error);
    const cls = heuristicClassify(prompt.slice(0, 4000));
    const run = remember({
      id: "x-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      kind: "compare", prompt: prompt.slice(0, 8000), projectId: body.projectId || null,
      classification: { capability: cls.capability, difficulty: cls.difficulty, source: "heuristic" },
      status: "running", startedAt: Date.now(), finishedAt: null, cost: 0, winner: null, columns: resolved.columns,
    });
    persist(h, run);
    h.emit("log", { text: `Side-by-side started: ${run.columns.map((c) => c.modelName).join(", ")}.`, missionId: run.id });
    h.emit("compare.update", { compare: snapshot(run) });
    const bodyOut = snapshot(run);
    execute(h, run).catch((err) => {
      run.status = "failed"; run.error = String(err.message || "failed").slice(0, 300); run.finishedAt = Date.now();
      persist(h, run);
      h.emit("compare.update", { compare: snapshot(run) });
      h.emit("log", { text: `Side-by-side failed: ${run.error}`, level: "error", missionId: run.id });
    });
    return h.json(res, 202, { id: run.id, compare: bodyOut });
  }

  const winnerPath = p.match(/^\/([a-z0-9-]+)\/winner$/);
  if (winnerPath && req.method === "POST") {
    const run = load(h, winnerPath[1]);
    if (!run) return bad(404, "That comparison was not found.");
    if (run.status === "running") return bad(409, "Wait until the answers finish.");
    const model = String(body.model || "").trim();
    const provider = body.provider ? String(body.provider).trim() : "";
    const col = run.columns.find((c) => c.model === model && (!provider || c.provider === provider) && c.status === "done" && c.text);
    if (!col) return bad(400, "Pick a column that answered.");
    const cap = run.classification?.capability || "writing";
    for (const c of run.columns) {
      c.winner = false;
      if (c.status !== "done" || !c.text) continue;
      const up = c === col;
      c.winner = up;
      writeRating(h, { missionId: run.id, provider: c.provider, model: c.model, capability: cap, up, note: up ? "Picked as the best side-by-side answer" : "Another answer was picked" });
    }
    run.winner = { provider: col.provider, model: col.model };
    persist(h, run);
    h.emit("compare.update", { compare: snapshot(run) });
    h.emit("log", { text: `Picked ${col.modelName} as the best for ${cap}.`, missionId: run.id });
    return h.json(res, 200, { compare: snapshot(run), capability: cap });
  }

  const one = p.match(/^\/([a-z0-9-]+)$/);
  if (one && req.method === "GET") {
    const run = load(h, one[1]);
    return run ? h.json(res, 200, snapshot(run)) : bad(404, "That comparison was not found.");
  }

  return false;
}
