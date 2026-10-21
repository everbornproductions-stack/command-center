// Inbox summary, reply drafts, and local reminders.
// GET  /api/everyday-inbox
// POST /api/everyday-inbox/summary          { sample?: true } read only
// POST /api/everyday-inbox/draft            { from, subject, instruction, accountId?, messageId? }
// POST /api/everyday-inbox/drafts/:id/send  { confirm: true, to, subject, body }
// POST /api/everyday-inbox/plain            { text } reminder or to-do from the words
// POST /api/everyday-inbox/reminders        { text }
// POST /api/everyday-inbox/todos            { text }
// POST /api/everyday-inbox/bulk             { kind, items, confirm? } more than 10 asks first
// POST /api/everyday-inbox/reminders/:id/done
// DELETE /api/everyday-inbox/reminders/:id
// POST /api/everyday-inbox/todos/:id/done
// DELETE /api/everyday-inbox/todos/:id
import * as E from "../everyday-inbox.js";

export const id = "everyday-inbox";

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/everyday-inbox\/?/, "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, E.view());
    if (m === "POST" && seg[0] === "summary" && seg.length === 1) {
      const sample = body?.sample === true;
      const accounts = sample ? E.SAMPLES : await E.collectLive();
      const sum = E.summarizeAccounts(accounts);
      sum.sample = sample;
      sum.empty = !sample && accounts.length === 0;
      h.emit("log", { text: sample ? "Inbox summary used the sample mailboxes. Nothing was sent." : "Inbox summary read the connected mailboxes. Nothing was sent." });
      return h.json(res, 200, sum);
    }
    if (m === "POST" && seg[0] === "draft" && seg.length === 1) {
      const draft = E.draftReply({
        from: body?.from, subject: body?.subject, instruction: body?.instruction,
        tone: E.currentTone(), accountId: body?.accountId || null, messageId: body?.messageId || null,
      });
      h.emit("log", { text: `Drafted a reply to ${draft.to}. It is not sent.` });
      return h.json(res, 200, { draft: E.rememberDraft(draft), sent: false });
    }
    if (m === "POST" && seg[0] === "drafts" && seg[2] === "send") {
      const out = await E.sendDraft(seg[1], body || {});
      h.emit("log", { text: out.log });
      return h.json(res, 200, { draft: out.draft, via: out.via, sent: true });
    }
    if (m === "POST" && seg[0] === "plain" && seg.length === 1) {
      const parsed = E.parsePlain(body?.text);
      const item = parsed.kind === "reminder" ? E.addReminder(body.text) : E.addTodo(body.text);
      h.emit("log", { text: parsed.kind === "reminder" ? `Reminder saved: ${item.title}` : `To-do saved: ${item.title}` });
      return h.json(res, 200, { kind: parsed.kind, item, sent: false });
    }
    if (m === "POST" && seg[0] === "reminders" && seg.length === 1) {
      const item = E.addReminder(body?.text);
      h.emit("log", { text: `Reminder saved: ${item.title}` });
      return h.json(res, 200, { item, sent: false });
    }
    if (m === "POST" && seg[0] === "todos" && seg.length === 1) {
      const item = E.addTodo(body?.text);
      h.emit("log", { text: `To-do saved: ${item.title}` });
      return h.json(res, 200, { item, sent: false });
    }
    if (m === "POST" && seg[0] === "bulk" && seg.length === 1) {
      const kind = body?.kind === "reminder" ? "reminder" : "todo";
      const out = E.addMany(kind, body?.items, { confirm: body?.confirm === true });
      if (!out.needsConfirm) h.emit("log", { text: `Saved ${out.count} ${kind === "reminder" ? "reminders" : "to-dos"}.` });
      return h.json(res, 200, out);
    }
    if (seg[0] === "reminders" && seg[1]) {
      if (m === "POST" && seg[2] === "done") return h.json(res, 200, { item: E.completeReminder(seg[1]) });
      if (m === "DELETE") return h.json(res, 200, E.removeItem("reminder", seg[1]));
    }
    if (seg[0] === "todos" && seg[1]) {
      if (m === "POST" && seg[2] === "done") return h.json(res, 200, { item: E.completeTodo(seg[1]) });
      if (m === "DELETE") return h.json(res, 200, E.removeItem("todo", seg[1]));
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
