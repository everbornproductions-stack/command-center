// Google Calendar for the signed-in account. List is a read. Create and update run only
// because this route was requested (a click). Grok Bot's calendar handoff is not used here.
import * as G from "../google.js";

export const id = "calendar";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/calendar/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && (p === "" || p === "/")) return h.json(res, 200, G.calendarStatus());
    if (m === "GET" && p === "/events") {
      return h.json(res, 200, { events: await G.listEvents({ q: url.searchParams.get("q") || "", timeMin: url.searchParams.get("timeMin") || "", timeMax: url.searchParams.get("timeMax") || "" }) });
    }
    if (m === "POST" && p === "/events") return h.json(res, 200, { event: await G.createEvent(body || {}) });
    if (m === "POST" && seg[0] === "events" && seg[1] && !seg[2]) return h.json(res, 200, { event: await G.updateEvent(decodeURIComponent(seg[1]), body || {}) });
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
