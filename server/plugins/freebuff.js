// Freebuff, the free coder inside Meldmind (0.4.22). Routes under /api/freebuff. The engine is server/freebuff-agent.js.
//   GET  /status  installed, signed in, model, hours left, the live transcript and the sponsored card
//   POST /start   { folder? }  starts the built-in window and picks the safe model
//   POST /ask     { text, folder? }  types the request for the person and returns the cleaned answer
//   POST /stop
import os from "node:os";
import path from "node:path";
import { freebuff } from "../freebuff-agent.js";
export const id = "freebuff";

export const routes = makeRoutes(freebuff);

// The manager is a parameter so tests can use a fake terminal.
// 0.4.23 (audit X5): a folder sent by the page must sit inside Meldmind's projects folder or its Freebuff work
// folder; any other path on the PC is refused.
export function allowedFolder(h, folder) {
  if (folder === undefined || folder === null || folder === "") return { folder: undefined };
  const raw = String(folder);
  if (/[\u0000-\u001F\u007F]/.test(raw)) return { error: "That folder name has hidden characters." };
  const dir = path.resolve(raw);
  const roots = [h?.DATA_DIR ? path.join(h.DATA_DIR, "projects") : null, path.join(os.tmpdir(), "meldmind-freebuff")].filter(Boolean).map((r) => path.resolve(r));
  if (!roots.some((r) => dir === r || dir.startsWith(r + path.sep))) return { error: "Freebuff can only work in a Meldmind project folder." };
  return { folder: dir };
}

export function makeRoutes(freebuff) { return async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/freebuff/, "") || "/";
  const m = req.method;
  const fo = m === "POST" ? allowedFolder(h, body?.folder) : { folder: undefined };
  if (fo.error) return h.json(res, 400, { error: fo.error, code: "folder" });
  if (body && typeof body === "object" && "folder" in body) body = { ...body, folder: fo.folder };
  try {
    if (m === "GET" && (p === "/" || p === "/status")) return h.json(res, 200, await freebuff.status());
    if (m === "POST" && p === "/start") return h.json(res, 200, await freebuff.start({ folder: body?.folder }));
    if (m === "POST" && p === "/ask") {
      const r = await freebuff.ask(body?.text, { folder: body?.folder });
      return h.json(res, 200, { ...r, label: "Free", status: freebuff.view() });
    }
    if (m === "POST" && p === "/stop") return h.json(res, 200, await freebuff.stop());
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code, status: freebuff.view() });
  }
  return false;
};
}
