// Rate the result: a thumbs up/down on each deliverable teaches the router from real outcomes,
// kept separate from what the council votes taught it (the skills matrix shows both sources apart).
import { recordHuman, skillTable, learnedDeltas, clearHumanRatings } from "../router.js";
import { CAPABILITIES } from "../registry.js";
import { rate, clearRatingMemory } from "../brain.js";
import { noteThumb } from "../learn-tune.js";
export const id = "ratings";
const KIND = "ratings.log";

// One rating, from the thumbs or from another feature (Phase 17 "Pick winner"): logged, and taught to both routers.
export function saveRating(h, { missionId, kind, provider, model, capability, up, note, stepId, stepKind, scope, reason, wrongStep }) {
  const d = h.doc(KIND, () => ({ items: [] }));
  // 0.4.21: a whole-result thumb ("Is this usable?") has no model; a step thumb carries the step id, so every step
  // (code and QA steps too) is rated on its own. An image step is kept as media/image, not "writing" or "code".
  if (scope === "result") {
    const item = { ts: Date.now(), missionId, kind: kind || null, scope: "result", up: !!up, reason: String(reason || "").replace(/[^\w -]/g, "").slice(0, 40) || null, wrongStep: wrongStep ? String(wrongStep).slice(0, 40) : null, note: String(note || "").slice(0, 300) };
    d.items = d.items.filter((x) => !(x.scope === "result" && x.missionId === missionId));
    d.items.unshift(item);
    d.items = d.items.slice(0, 2000);
    h.putDoc(KIND, d);
    h.emit("log", { text: `${up ? "👍" : "👎"} whole result${item.reason ? ` (${item.reason})` : ""}${note ? `: ${String(note).slice(0, 60)}` : ""}` });
    return item;
  }
  const media = capability === "media" || /^media\//.test(String(stepKind || ""));
  const cap = media ? "media" : CAPABILITIES.includes(capability) ? capability : "writing";
  const item = { ts: Date.now(), missionId, kind: kind || null, provider, model, capability: cap, stepKind: media ? (/^media\/(image|video|voice)$/.test(String(stepKind || "")) ? stepKind : "media/image") : (stepKind || null), stepId: stepId ? String(stepId).slice(0, 40) : null, up: !!up, note: String(note || "").slice(0, 300) };
  const same = (x) => x.missionId === missionId && !x.scope && (item.stepId ? x.stepId === item.stepId : (x.model === model && !x.stepId));
  const prev = d.items.find(same) || null;
  d.items = d.items.filter((x) => x !== prev); // one rating per step (or per model for an older rating without a step)
  d.items.unshift(item);
  d.items = d.items.slice(0, 2000);
  h.putDoc(KIND, d);
  // teach the router: human thumbs are counted on their own, never as council wins, and a changed mind replaces the old thumb
  if (!media) {
    recordHuman(model, cap, item.up, prev && CAPABILITIES.includes(prev.capability) ? { capability: prev.capability, up: prev.up } : null);
    // learning router (Phase 28): the thumb lands on the task type the model did in that run (no note text is kept there)
    rate({ runId: missionId, provider, model, capability: cap, up: item.up });
    try { noteThumb({ model, up: item.up }); } catch { /* the thumb is already saved */ }
  }
  h.emit("log", { text: `${up ? "👍" : "👎"} ${model} for ${media ? item.stepKind : cap}${note ? `: ${String(note).slice(0, 60)}` : ""}` });
  return item;
}

// What the thumbs changed, kept apart from council votes. A shift appears after 2 ratings
// for that model and task type (the same bar the router uses). Fewer than that stays "early".
export function learnedView(items) {
  const byModel = {};
  for (const r of items) {
    if (!r.model || r.scope === "result" || r.capability === "media") continue;
    const b = (byModel[r.model] ||= { provider: r.provider, up: 0, down: 0, byCap: {} });
    if (r.up) b.up++; else b.down++;
    const c = (b.byCap[r.capability] ||= { up: 0, down: 0 });
    if (r.up) c.up++; else c.down++;
  }
  const lines = [];
  const early = [];
  for (const [model, b] of Object.entries(byModel)) {
    const human = learnedDeltas(model).human || {};
    for (const [cap, n] of Object.entries(b.byCap)) {
      const total = n.up + n.down;
      const delta = human[cap];
      const row = { model, provider: b.provider, capability: cap, up: n.up, down: n.down, basedOn: total, delta: delta ?? null };
      if (delta == null) {
        early.push({ ...row, note: "Not enough ratings yet to move the pick." });
        continue;
      }
      const lean = delta > 0 ? "favoured" : delta < 0 ? "used less" : "unchanged";
      const signed = delta > 0 ? `+${delta}` : String(delta);
      const note = delta === 0
        ? `${model} is unchanged for ${cap} (${total} rating${total === 1 ? "" : "s"}).`
        : `${model} is ${lean} for ${cap} (${signed} from ${total} rating${total === 1 ? "" : "s"}).`;
      lines.push({ ...row, lean, note });
    }
  }
  return { count: items.length, lines, early };
}

// Clears the rating log, the thumbs on the skills table, and the thumbs in the learning record.
// Council wins, jobs, cost, and latency stay.
export function resetLearned(h) {
  h.putDoc(KIND, { items: [] });
  clearHumanRatings();
  clearRatingMemory();
  h.emit("log", { text: "Ratings reset. What your thumbs taught has been cleared. Council scores stay." });
  return learnedView([]);
}

// Per model: human thumbs and council rounds, side by side, plus the score shift each one causes.
export function summary(items) {
  const byModel = {};
  for (const r of items) { if (!r.model || r.scope === "result") continue; const b = (byModel[r.model] ||= { provider: r.provider, up: 0, down: 0, byCap: {} }); r.up ? b.up++ : b.down++; const c = (b.byCap[r.capability] ||= { up: 0, down: 0 }); r.up ? c.up++ : c.down++; }
  const sk = skillTable();
  const separated = {};
  for (const model of new Set([...Object.keys(byModel), ...Object.keys(sk)])) {
    const caps = {};
    for (const [cap, r] of Object.entries(sk[model] || {})) caps[cap] = { council: { wins: r.wins || 0, rounds: r.total || 0 }, human: { up: r.up || 0, down: r.down || 0 } };
    separated[model] = { caps, deltas: learnedDeltas(model) };
  }
  return { count: items.length, byModel, recent: items.slice(0, 20), skills: separated };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/ratings/, "");
  if (req.method === "POST" && (p === "" || p === "/")) {
    if (!body.missionId || (body.scope !== "result" && !body.model)) return h.json(res, 400, { error: "missionId and model required" });
    return h.json(res, 200, saveRating(h, body));
  }
  if (req.method === "GET" && p === "/summary") return h.json(res, 200, summary(h.doc(KIND, () => ({ items: [] })).items));
  if (req.method === "GET" && p === "/learned") {
    h.guard("learnedFromRatings");
    return h.json(res, 200, learnedView(h.doc(KIND, () => ({ items: [] })).items));
  }
  if (req.method === "POST" && p === "/reset") {
    h.guard("learnedFromRatings");
    if (body?.confirm !== true) return h.json(res, 400, { error: "Send confirm: true to reset what your ratings taught." });
    return h.json(res, 200, resetLearned(h));
  }
  if (req.method === "GET" && p.startsWith("/mission/")) {
    const mid = p.slice("/mission/".length);
    return h.json(res, 200, h.doc(KIND, () => ({ items: [] })).items.filter((x) => x.missionId === mid));
  }
  return false;
}
