// Rate the result: a thumbs up/down on each deliverable teaches the router from real outcomes,
// kept separate from what the council votes taught it.
import { recordOutcome, skillTable } from "../router.js";
import { rate } from "../brain.js";
export const id = "ratings";
const KIND = "ratings.log";

// One rating, from the thumbs or from another feature (Phase 17 "Pick winner"): logged, and taught to both routers.
export function saveRating(h, { missionId, kind, provider, model, capability, up, note }) {
  const d = h.doc(KIND, () => ({ items: [] }));
  const item = { ts: Date.now(), missionId, kind: kind || null, provider, model, capability: capability || "writing", up: !!up, note: String(note || "").slice(0, 300) };
  d.items = d.items.filter((x) => !(x.missionId === missionId && x.model === model)); // one rating per run per model
  d.items.unshift(item);
  d.items = d.items.slice(0, 2000);
  h.putDoc(KIND, d);
  // teach the router: a thumbs-up counts like winning a council round for that capability; a thumbs-down like losing one
  recordOutcome(model, item.capability, item.up);
  // learning router (Phase 28): the thumb lands on the task type the model did in that run (no note text is kept there)
  rate({ runId: missionId, provider, model, capability: item.capability, up: item.up });
  h.emit("log", { text: `${up ? "👍" : "👎"} ${model} for ${item.capability}${note ? `: ${String(note).slice(0, 60)}` : ""}` });
  return item;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/ratings/, "");
  if (req.method === "POST" && (p === "" || p === "/")) {
    if (!body.missionId || !body.model) return h.json(res, 400, { error: "missionId and model required" });
    return h.json(res, 200, saveRating(h, body));
  }
  if (req.method === "GET" && p === "/summary") {
    const items = h.doc(KIND, () => ({ items: [] })).items;
    const byModel = {};
    for (const r of items) { const b = (byModel[r.model] ||= { provider: r.provider, up: 0, down: 0, byCap: {} }); r.up ? b.up++ : b.down++; const c = (b.byCap[r.capability] ||= { up: 0, down: 0 }); r.up ? c.up++ : c.down++; }
    return h.json(res, 200, { count: items.length, byModel, recent: items.slice(0, 20), skills: skillTable() });
  }
  if (req.method === "GET" && p.startsWith("/mission/")) {
    const mid = p.slice("/mission/".length);
    return h.json(res, 200, h.doc(KIND, () => ({ items: [] })).items.filter((x) => x.missionId === mid));
  }
  return false;
}
