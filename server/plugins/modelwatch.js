// Model watch routes (Phase 32). Check is a click, and the daily loop is off in tests.
// Notes go out on the model.version event, which the Together news list stores when it is installed.
import { readState, runWatch, acceptSuggestion, undoSuggestion, startLoop } from "../model-watch.js";

export const id = "modelwatch";

export function init(h) {
  startLoop(() => runWatch(h, { source: "daily" }));
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/modelwatch/, "").replace(/\/$/, "") || "/";
  if (req.method === "GET" && p === "/") return h.json(res, 200, readState(h));
  if (req.method === "POST" && p === "/check") return h.json(res, 200, await runWatch(h, { source: "click" }));
  if (req.method === "POST" && p === "/accept") return h.json(res, 200, acceptSuggestion(h, String(body.id || "")));
  if (req.method === "POST" && p === "/undo") return h.json(res, 200, undoSuggestion(h, String(body.id || "")));
  return false;
}
