// Freebuff, the free coder inside Meldmind (0.4.22). Routes under /api/freebuff. The engine is server/freebuff-agent.js.
//   GET  /status  installed, signed in, model, hours left, the live transcript and the sponsored card
//   POST /start   { folder? }  starts the built-in window and picks the safe model
//   POST /ask     { text, folder? }  types the request for the person and returns the cleaned answer
//   POST /stop
import { freebuff } from "../freebuff-agent.js";
export const id = "freebuff";

export const routes = makeRoutes(freebuff);

// The manager is a parameter so tests can use a fake terminal.
export function makeRoutes(freebuff) { return async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/freebuff/, "") || "/";
  const m = req.method;
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
