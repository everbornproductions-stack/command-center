// "Test the guard" (0.4.21): paste a message and see what the send guard would say. No connection is needed and
// nothing is sent, saved or spent. The same rules as a real text, email or post.
import { checkOutgoing, maskSensitive } from "../compliance-guard.js";

export const id = "guardtest";

export async function routes(req, res, url, body, h) {
  if (req.method === "POST" && url.pathname === "/api/guardtest") {
    const text = String(body?.text || "").slice(0, 5000);
    if (!text.trim()) return h.json(res, 400, { error: "Paste a message first." });
    const channel = ["sms", "email", "post"].includes(body?.channel) ? body.channel : "post";
    const g = checkOutgoing({ text, channel, consent: body?.consent === true, sendTime: body?.sendTime || undefined });
    const summary = g.blocked.length ? "This would be stopped. Nothing can be sent until it is fixed." : g.needsAck ? "This would show a warning first. You could still choose Send anyway." : "No problems found by these rules. You still read it before it goes.";
    return h.json(res, 200, { ok: g.ok, summary, warnings: g.warnings, blocked: g.blocked, masked: maskSensitive(text) !== text, sent: false });
  }
  return false;
}
