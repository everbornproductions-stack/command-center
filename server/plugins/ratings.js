// Rate the result: a thumbs up/down on each deliverable teaches the router from real outcomes,
// kept separate from what the council votes taught it (the skills matrix shows both sources apart).
import { recordHuman, skillTable, learnedDeltas } from "../router.js";
import { CAPABILITIES } from "../registry.js";
import { rate } from "../brain.js";
export const id = "ratings";
const KIND = "ratings.log";

// One rating, from the thumbs or from another feature (Phase 17 "Pick winner"): logged, and taught to both routers.
export function saveRating(h, { missionId, kind, provider, model, capability, up, note }) {
  const d = h.doc(KIND, () => ({ items: [] }));
  const cap = CAPABILITIES.includes(capability) ? capability : "writing";
  const item = { ts: Date.now(), missionId, kind: kind || null, provider, model, capability: cap, up: !!up, note: String(note || "").slice(0, 300) };
  const prev = d.items.find((x) => x.missionId === missionId && x.model === model) || null;
  d.items = d.items.filter((x) => x !== prev); // one rating per run per model
  d.items.unshift(item);
  d.items = d.items.slice(0, 2000);
  h.putDoc(KIND, d);
  // teach the router: human thumbs are counted on their own, never as council wins, and a changed mind replaces the old thumb
  recordHuman(model, cap, item.up, prev ? { capability: prev.capability, up: prev.up } : null);
  // learning router (Phase 28): the thumb lands on the task type the model did in that run (no note text is kept there)
  rate({ runId: missionId, provider, model, capability: cap, up: item.up });
  h.emit("log", { text: `${up ? "👍" : "👎"} ${model} for ${cap}${note ? `: ${String(note).slice(0, 60)}` : ""}` });
  return item;
}

// Per model: human thumbs and council rounds, side by side, plus the score shift each one causes.
export function summary(items) {
  const byModel = {};
  for (const r of items) { const b = (byModel[r.model] ||= { provider: r.provider, up: 0, down: 0, byCap: {} }); r.up ? b.up++ : b.down++; const c = (b.byCap[r.capability] ||= { up: 0, down: 0 }); r.up ? c.up++ : c.down++; }
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
    if (!body.missionId || !body.model) return h.json(res, 400, { error: "missionId and model required" });
    return h.json(res, 200, saveRating(h, body));
  }
  if (req.method === "GET" && p === "/summary") return h.json(res, 200, summary(h.doc(KIND, () => ({ items: [] })).items));
  if (req.method === "GET" && p.startsWith("/mission/")) {
    const mid = p.slice("/mission/".length);
    return h.json(res, 200, h.doc(KIND, () => ({ items: [] })).items.filter((x) => x.missionId === mid));
  }
  return false;
}
