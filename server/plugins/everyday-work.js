// Docs, meetings, and mock lead routes. Sends wait for a click.
// GET  /api/everyday-work
// POST /api/everyday-work/pages
// POST /api/everyday-work/find
// POST /api/everyday-work/save
// POST /api/everyday-work/meetings
// POST /api/everyday-work/meetings/:id/prep
// POST /api/everyday-work/meetings/:id/summary
// POST /api/everyday-work/meetings/:id/tasks
// POST /api/everyday-work/leads
// POST /api/everyday-work/leads/:id/send
import * as W from "../everyday-work.js";

export const id = "everyday-work";

function tierOf(h) {
  try { return h.licenseState().tier; } catch { return "free"; }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/everyday-work\/?/, "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  const tier = tierOf(h);
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, { ...W.view(), tier });
    if (m === "POST" && seg[0] === "pages") return h.json(res, 200, { page: W.addPage(body || {}) });
    if (m === "POST" && seg[0] === "find") return h.json(res, 200, await W.findDocs(body?.q || ""));
    if (m === "POST" && seg[0] === "save") {
      const out = W.saveCopy(body || {});
      h.emit("log", { text: "Saved a copy on this computer. Drive and Notion were not written." });
      return h.json(res, 200, out);
    }
    if (m === "POST" && seg[0] === "meetings" && seg.length === 1) return h.json(res, 200, { meeting: W.addMeeting(body || {}) });
    if (m === "POST" && seg[0] === "meetings" && seg[2] === "prep") return h.json(res, 200, W.prepMeeting(seg[1]));
    if (m === "POST" && seg[0] === "meetings" && seg[2] === "summary") return h.json(res, 200, W.summarizeMeeting(seg[1]));
    if (m === "POST" && seg[0] === "meetings" && seg[2] === "tasks") return h.json(res, 200, W.saveTasks(seg[1], body || {}));
    if (m === "POST" && seg[0] === "leads" && seg.length === 1) return h.json(res, 200, { lead: W.addLead(body || {}, { tier }) });
    if (m === "POST" && seg[0] === "leads" && seg[2] === "send") {
      const out = await W.sendLead(seg[1], body || {}, { tier });
      h.emit("log", { text: `Recorded a ${out.outbox.channel} follow-up in the local outbox. No outside service was called.` });
      return h.json(res, 200, out);
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
