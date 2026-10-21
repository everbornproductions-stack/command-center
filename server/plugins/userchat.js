// People chat routes (Phase 92). Send is the only click that stores a message.
// A hub delivery, when a hub address is set, happens on that same click.
import { overview, openThread, sendMessage, blockPerson, unblockPerson, fileReport, receiveInbox } from "../user-chat.js";

export const id = "userchat";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/userchat/, "").replace(/\/$/, "") || "/";
  if (req.method === "GET" && p === "/") return h.json(res, 200, await overview(h));
  if (req.method === "POST" && p === "/threads") return h.json(res, 200, await openThread(h, body));
  if (req.method === "POST" && p === "/block") return h.json(res, 200, await blockPerson(h, body.email || body.key));
  if (req.method === "POST" && p === "/unblock") return h.json(res, 200, await unblockPerson(h, body.email || body.key));
  if (req.method === "POST" && p === "/report") return h.json(res, 200, await fileReport(h, body));
  if (req.method === "POST" && p === "/inbox") return h.json(res, 200, await receiveInbox(h, body));
  const msg = p.match(/^\/threads\/([^/]+)\/messages$/);
  if (req.method === "POST" && msg) return h.json(res, 200, await sendMessage(h, decodeURIComponent(msg[1]), body));
  return false;
}
