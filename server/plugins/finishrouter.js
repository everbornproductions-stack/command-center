// Finish router routes (flag_finishrouter, 0.4.19). Picks the Finish editor for a piece of work.
// Nothing here calls an AI, publishes or sends. Off, every route says so.
import { flagOn } from "../flags.js";
import { CATEGORIES, THRESHOLDS, classifyWithLearning, recordOverride, readHistory, clearHistory, readGeneral, saveGeneral } from "../finish-router.js";

export const id = "finishrouter";

const pick = (body) => ({ text: String(body?.text || "").slice(0, 20000), name: String(body?.name || "").slice(0, 200), mime: String(body?.mime || "").slice(0, 100), kind: String(body?.kind || "").slice(0, 30), tags: Array.isArray(body?.tags) ? body.tags.slice(0, 20).map((t) => String(t).slice(0, 40)) : [] });

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/finishrouter/, "") || "/";
  if (!flagOn("finishrouter")) return h.json(res, 404, { error: "The Finish router is turned off on this install.", code: "flag_off" });

  if (req.method === "GET" && p === "/categories") return h.json(res, 200, { categories: CATEGORIES, thresholds: THRESHOLDS });

  // Classify and Re-classify are the same call. Re-classify just asks again with the latest words.
  if (req.method === "POST" && (p === "/classify" || p === "/reclassify")) {
    const input = pick(body);
    if (!input.text && !input.name && !input.mime && !input.kind && !input.tags.length) return h.json(res, 400, { error: "There is nothing to look at yet.", code: "empty" });
    return h.json(res, 200, classifyWithLearning(input));
  }

  if (req.method === "POST" && p === "/override") {
    try {
      const input = pick(body);
      const entry = recordOverride({ original: body?.original, corrected: body?.corrected, text: input.text, name: input.name, kind: input.kind });
      return h.json(res, 200, { ok: true, entry });
    } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code || "error" }); }
  }

  if (req.method === "GET" && p === "/history") return h.json(res, 200, { items: readHistory() });
  if (req.method === "DELETE" && p === "/history") { clearHistory(); return h.json(res, 200, { ok: true }); }

  if (req.method === "GET" && p === "/general") return h.json(res, 200, readGeneral(url.searchParams.get("ref")));
  if (req.method === "PUT" && p === "/general") return h.json(res, 200, saveGeneral(body?.ref, body));
  return false;
}
