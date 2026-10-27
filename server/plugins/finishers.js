// Category finisher routes (flag_finishers, 0.4.19). Documents, accounting, automations, music,
// presentations, programs and games. Nothing here sends, books, pays or deploys. Off, every route says so.
import { flagOn } from "../flags.js";
import { requirePro } from "../feature-gate.js";
import * as F from "../finishers.js";

export const id = "finishers";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/finishers/, "") || "/";
  if (!flagOn("finishers")) return h.json(res, 404, { error: "The category finishers are turned off on this install.", code: "flag_off" });
  const fail = (e) => h.json(res, e.status || 500, { error: e.message, code: e.code || "error" });
  try {
    if (req.method === "GET" && p === "/kinds") return h.json(res, 200, { kinds: F.KINDS, themes: F.THEMES, gameTypes: F.GAME_TYPES });
    if (req.method === "GET" && p === "/items") return h.json(res, 200, { items: F.listItems(url.searchParams.get("kind") || "") });
    if (req.method === "POST" && p === "/items") return h.json(res, 200, F.createItem(body || {}));
    const m = /^\/items\/([a-z0-9_]+)(?:\/([a-z]+))?$/.exec(p);
    if (!m) return false;
    const [, id, act] = m;
    if (!act) {
      if (req.method === "GET") { const it = F.getItem(id); return it ? h.json(res, 200, it) : h.json(res, 404, { error: "That item was not found.", code: "missing" }); }
      if (req.method === "PUT") return h.json(res, 200, F.updateItem(id, body || {}));
      if (req.method === "DELETE") return h.json(res, 200, F.deleteItem(id));
      return false;
    }
    if (req.method !== "POST") return false;
    if (act === "section") return h.json(res, 200, F.editSection(id, body || {}));
    if (act === "approve") return h.json(res, 200, F.approveItem(id, body));
    if (act === "unapprove") return h.json(res, 200, F.unapproveItem(id));
    if (act === "test") return h.json(res, 200, await F.testItem(id));
    if (act === "schedule") return h.json(res, 200, F.scheduleItem(id, body || {}));
    if (act === "activate") { h.guard("scheduler"); }
    if (act === "activate") return h.json(res, 200, await F.activateItem(id, body));
    if (act === "deactivate") return h.json(res, 200, await F.deactivateItem(id));
    if (act === "export") {
      const it = F.getItem(id);
      const fmt = String(body?.format || "").toLowerCase();
      if (it && it.kind === "document" && (fmt === "docx" || fmt === "pdf")) requirePro("documentExport");
      return h.json(res, 200, F.exportItem(id, fmt));
    }
    return false;
  } catch (e) { return fail(e); }
}
