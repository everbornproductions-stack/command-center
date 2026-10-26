// Finish path (flag_finishpath, 0.4.19): the Finish preview card text, and Undo last step / Branch from
// here on a project's steps. Nothing here calls an AI, sends or spends. Off, every route says so.
import { flagOn } from "../flags.js";
import { previewCard, canUndo, undoLast, branchWalk } from "../../web/finishpath.js";

export const id = "finishpath";
const KIND = "walkthrough.items";

function load(h) {
  const d = h.doc(KIND, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/finishpath/, "") || "/";
  if (!flagOn("finishpath")) return h.json(res, 404, { error: "The finish path is turned off on this install.", code: "flag_off" });
  if (req.method !== "POST") return false;

  if (p === "/preview") {
    const card = previewCard({ kind: body?.kind, text: body?.text, name: body?.name, projectName: body?.projectName });
    if (!card) return h.json(res, 400, { error: "There is nothing to finish yet.", code: "empty" });
    return h.json(res, 200, { card });
  }

  if (p === "/undo" || p === "/branch") {
    const wid = String(body?.walkId || "");
    const d = load(h);
    const w = d.items.find((x) => x.id === wid);
    if (!w) return h.json(res, 404, { error: "That project was not found.", code: "walk" });
    if (w.example) return h.json(res, 409, { error: "This is example data. It is read-only.", code: "example_readonly" });
    if (["building", "planning", "revising"].includes(w.status)) return h.json(res, 409, { error: "Wait for the current step to stop first.", code: "busy" });

    if (p === "/undo") {
      if (!canUndo(w)) return h.json(res, 409, { error: "There is no finished step to undo.", code: "nothing" });
      const out = undoLast(w);
      const i = d.items.findIndex((x) => x.id === wid);
      out.walk.updatedAt = Date.now();
      d.items[i] = out.walk;
      h.putDoc(KIND, d);
      return h.json(res, 200, { ok: true, undone: out.step, walkId: wid });
    }

    const out = branchWalk(w, String(body?.stepId || ""), "sp-" + Date.now().toString(36) + "b");
    if (!out.ok) return h.json(res, 400, { error: out.reason, code: "step" });
    d.items.unshift(out.walk);
    d.items = d.items.slice(0, 40);
    h.putDoc(KIND, d);
    return h.json(res, 200, { ok: true, walkId: out.walk.id, branchOf: wid });
  }
  return false;
}
