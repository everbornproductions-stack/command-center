// Report and block for rooms, team spaces, and group chat replies.
// Saved on this computer only. Nothing is sent.
import { fileReport, blockPerson, unblockPerson, readMod } from "../moderation.js";

export const id = "moderation";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/moderation/, "").replace(/\/$/, "") || "/";
  if (req.method === "GET" && p === "/") {
    const d = readMod(h);
    return h.json(res, 200, { blocks: d.blocks, reports: d.reports, sent: false });
  }
  if (req.method === "POST" && p === "/block") return h.json(res, 200, blockPerson(h, body.key || body.email || body.id));
  if (req.method === "POST" && p === "/unblock") return h.json(res, 200, unblockPerson(h, body.key || body.email || body.id));
  if (req.method === "POST" && p === "/report") return h.json(res, 200, fileReport(h, body));
  return false;
}
