// Phase 40. The learning router nudges quality, cost, and speed from thumbs, picks, and
// an explicit priority change. Each nudge is shown and can be undone.
// Stored: counts and the priority. Never a prompt, a note, or a key (decision 18).

import { findModel } from "./registry.js";
import { ctx, doc, putDoc } from "./store.js";
import { brainSettings } from "./brain.js";
import { normalizeMode, MODE_LABEL } from "./modes.js";

const DOC = "learn.tune";
const NEED = 3;

const empty = () => ({
  weights: { quality: 0, cost: 0, speed: 0 },
  signals: { quality: 0, cost: 0, speed: 0 },
  appliedLean: null,
  seenMode: null,
  quietMode: null,
  changes: [],
});

function load() {
  const saved = doc(DOC, empty);
  const base = empty();
  return {
    ...base,
    ...saved,
    weights: { ...base.weights, ...(saved?.weights || {}) },
    signals: { ...base.signals, ...(saved?.signals || {}) },
    changes: Array.isArray(saved?.changes) ? saved.changes : [],
  };
}

function save(next) {
  putDoc(DOC, next);
  return next;
}

export function leanFor(model) {
  const m = findModel(model);
  if (!m) return null;
  const price = (Number(m.in) || 0) + (Number(m.out) || 0);
  const fast = m.caps?.fast || 0;
  const quality = Math.max(m.caps?.reasoning || 0, m.caps?.writing || 0, m.caps?.analysis || 0);
  if (fast >= 90 && price <= 1) return "speed";
  if (price <= 1) return "cost";
  if (quality >= 90) return "quality";
  return "cost";
}

const WHY = {
  cost: "You favored lower cost models, so routing leaned that way.",
  quality: "You favored higher quality models, so routing leaned that way.",
  speed: "You favored faster models, so routing leaned that way.",
};

const TARGET = {
  cost: { quality: 0, cost: 0.35, speed: 0, mode: "savings" },
  quality: { quality: 0.2, cost: -0.2, speed: 0, mode: "quality" },
  speed: { quality: 0, cost: 0, speed: 0.4, mode: "speed" },
};

function patchSettings(patch) {
  const cur = doc("settings", () => ({})) || {};
  putDoc("settings", { ...cur, ...patch });
}

function writeMode(state, mode) {
  const next = normalizeMode(mode) || "balanced";
  state.quietMode = next;
  state.seenMode = next;
  patchSettings({ defaultMode: next });
}

function pushChange(state, { why, weights, mode }) {
  const from = { weights: { ...state.weights }, mode: state.seenMode || normalizeMode(doc("settings", () => ({}))?.defaultMode) || "balanced" };
  state.weights = { ...weights };
  if (mode) writeMode(state, mode);
  const to = { weights: { ...state.weights }, mode: state.seenMode || from.mode };
  const id = `lt-${Date.now().toString(36)}-${state.changes.length}`;
  state.changes.unshift({ id, at: Date.now(), why, from, to, undone: false });
  state.changes = state.changes.slice(0, 40);
  return id;
}

function maybeApply(state) {
  if (brainSettings().on === false) return state;
  const ranked = ["quality", "cost", "speed"].sort((a, b) => state.signals[b] - state.signals[a]);
  const lean = ranked[0];
  if (!lean || state.signals[lean] < NEED) return state;
  if (state.signals[lean] <= state.signals[ranked[1]]) return state;
  if (state.appliedLean === lean) return state;
  const target = TARGET[lean];
  pushChange(state, { why: WHY[lean], weights: { quality: target.quality, cost: target.cost, speed: target.speed }, mode: target.mode });
  state.appliedLean = lean;
  return state;
}

// A thumb or a Pick winner. `up` false takes the signal back. No note text is kept.
export function noteThumb({ model, up = true } = {}) {
  const lean = leanFor(model);
  if (!lean) return publicState();
  const state = load();
  const step = up ? 1 : -1;
  state.signals[lean] = Math.max(0, (state.signals[lean] || 0) + step);
  maybeApply(state);
  save(state);
  return publicState();
}

// The person changed Default priority in Settings. The next read records it so Undo can put it back.
export function syncModeFromSettings() {
  const mode = normalizeMode(doc("settings", () => ({}))?.defaultMode) || "balanced";
  const state = load();
  if (state.seenMode == null) {
    state.seenMode = mode;
    return save(state);
  }
  if (state.quietMode === mode) {
    state.quietMode = null;
    state.seenMode = mode;
    return save(state);
  }
  if (state.seenMode !== mode) {
    const label = MODE_LABEL[mode] || mode;
    pushChange(state, { why: `You set the default priority to ${label}.`, weights: { ...state.weights }, mode });
    state.appliedLean = null;
  }
  return save(state);
}

export function undo() {
  const state = load();
  const hit = state.changes.find((c) => !c.undone);
  if (!hit) {
    const err = new Error("Nothing to undo.");
    err.status = 409;
    throw err;
  }
  hit.undone = true;
  state.weights = { ...hit.from.weights };
  writeMode(state, hit.from.mode || "balanced");
  state.appliedLean = null;
  save(state);
  return publicState();
}

export function publicState() {
  syncQuiet();
  const state = load();
  const open = state.changes.find((c) => !c.undone) || null;
  return {
    weights: state.weights,
    signals: state.signals,
    appliedLean: state.appliedLean,
    mode: normalizeMode(doc("settings", () => ({}))?.defaultMode) || "balanced",
    change: open ? { id: open.id, at: open.at, why: open.why } : null,
    canUndo: !!open,
    plain: open ? `${open.why} Undo puts the last change back.` : "Routing is using your priority as you set it.",
  };
}

// syncModeFromSettings writes. publicState must not recurse through it on every field.
function syncQuiet() {
  const mode = normalizeMode(doc("settings", () => ({}))?.defaultMode) || "balanced";
  const state = load();
  if (state.seenMode == null) {
    state.seenMode = mode;
    save(state);
    return;
  }
  if (state.quietMode === mode) return;
  if (state.seenMode !== mode) syncModeFromSettings();
}

export function applyTune(ordered) {
  if (!Array.isArray(ordered) || ordered.length < 2) return ordered;
  let weights;
  try {
    const saved = ctx().docs?.[DOC];
    weights = saved?.weights;
  } catch { return ordered; }
  const q = Number(weights?.quality) || 0;
  const c = Number(weights?.cost) || 0;
  const s = Number(weights?.speed) || 0;
  if (!q && !c && !s) return ordered;
  const scored = ordered.map((row) => {
    const cost = Number(row.estCost) || 0;
    const fast = row.baseCaps?.fast ?? row.caps?.fast ?? 60;
    const nudge = (-Math.log10(1 + cost * 100) * 25 * c) + ((Number(row.quality) || 0) * q) + ((Number(fast) - 60) * s);
    return { ...row, score: +((Number(row.score) || 0) + nudge).toFixed(2), tuned: true };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
