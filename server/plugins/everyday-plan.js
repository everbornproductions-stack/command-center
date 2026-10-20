// Day plan routes. Briefings prepare only. Holds stay local. Mail waits for Send.
// GET  /api/everyday-plan
// POST /api/everyday-plan/routines          { name, hour, minute, weekdays, city }
// POST /api/everyday-plan/tick              { now?, sample? }
// POST /api/everyday-plan/prepare           { id, now?, sample? }
// POST /api/everyday-plan/extract           { from, subject, body, now? } preview
// POST /api/everyday-plan/extract/save      the same body, writes the task and local hold
// POST /api/everyday-plan/extract/bulk      { emails, confirm? }
// POST /api/everyday-plan/busy              { title, start, end }
// POST /api/everyday-plan/slots             { to, name, minutes, days, count, now? }
// POST /api/everyday-plan/drafts/:id/send   { confirm, to, subject, body }
// POST /api/everyday-plan/tasks/:id/done
// DELETE /api/everyday-plan/holds/:id
import * as P from "../everyday-plan.js";

export const id = "everyday-plan";

function tierOf(h) {
  try { return h.licenseState().tier; } catch { return "free"; }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/everyday-plan\/?/, "");
  const seg = p.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;
  try {
    if (m === "GET" && !seg.length) return h.json(res, 200, { ...P.view(), tier: tierOf(h) });
    if (m === "POST" && seg[0] === "routines" && seg.length === 1) {
      const row = P.createRoutine(body || {}, { tier: tierOf(h) });
      h.emit("log", { text: `Morning routine saved: ${row.name}. It only prepares a briefing.` });
      return h.json(res, 200, { routine: row });
    }
    if (m === "POST" && seg[0] === "prepare" && seg.length === 1) {
      const routines = h.doc(P.DOC, () => ({ routines: [] })).routines || [];
      const row = routines.find((r) => r.id === body?.id) || routines[0];
      if (!row) return h.json(res, 404, { error: "Save a routine first." });
      const out = await P.prepareBriefing(row, Number(body?.now) || Date.now(), { sample: body?.sample === true });
      h.emit("log", { text: "Morning briefing prepared. Nothing was sent." });
      return h.json(res, 200, out);
    }
    if (m === "POST" && seg[0] === "tick" && seg.length === 1) {
      const made = await P.tick(Number(body?.now) || Date.now(), { sample: body?.sample === true });
      if (made.length) h.emit("log", { text: `Prepared ${made.length} briefing${made.length === 1 ? "" : "s"}. Nothing was sent.` });
      return h.json(res, 200, { prepared: made.length, outputs: made });
    }
    if (m === "POST" && seg[0] === "extract" && seg[1] === "bulk") {
      const preview = P.previewMany(body?.emails);
      if (preview.needsConfirm && body?.confirm !== true) return h.json(res, 200, { ...preview, saved: [] });
      const saved = [];
      for (const email of body?.emails || []) saved.push(P.saveExtraction(P.extractEmail({ ...email, now: Number(body?.now) || Date.now() })));
      h.emit("log", { text: `Saved ${saved.length} tasks from email. Holds stay on this computer.` });
      return h.json(res, 200, { ...preview, needsConfirm: false, saved });
    }
    if (m === "POST" && seg[0] === "extract" && seg[1] === "save") {
      const parsed = P.extractEmail(body || {});
      const saved = P.saveExtraction(parsed);
      h.emit("log", { text: saved.hold ? `Saved a task and a local calendar hold: ${saved.task.title}` : `Saved a task: ${saved.task.title}` });
      return h.json(res, 200, saved);
    }
    if (m === "POST" && seg[0] === "extract" && seg.length === 1) {
      return h.json(res, 200, P.extractEmail(body || {}));
    }
    if (m === "POST" && seg[0] === "busy") return h.json(res, 200, { busy: P.addBusy(body || {}) });
    if (m === "POST" && seg[0] === "slots" && seg.length === 1) {
      const now = Number(body?.now) || Date.now();
      const local = P.view().busy.concat(P.view().holds.map((h) => ({ start: h.start, end: h.end })));
      const remote = await P.extraBusy(now, now + 8 * 86400000);
      const slots = P.openSlots({ busy: local.concat(remote), now, days: body?.days || 7, minutes: body?.minutes || 30, count: body?.count || 3 });
      const draft = P.proposeMail({ to: body?.to, name: body?.name, slots, minutes: body?.minutes || 30 });
      h.emit("log", { text: `Drafted ${slots.length} time options for ${draft.to}. Nothing was sent.` });
      return h.json(res, 200, { draft: P.rememberDraft(draft), sent: false });
    }
    if (m === "POST" && seg[0] === "drafts" && seg[2] === "send") {
      const out = await P.sendDraft(seg[1], body || {});
      h.emit("log", { text: `Sent time options to ${out.draft.to}.` });
      return h.json(res, 200, { ...out, sent: true });
    }
    if (m === "POST" && seg[0] === "tasks" && seg[2] === "done") return h.json(res, 200, { task: P.completeTask(seg[1]) });
    if (m === "DELETE" && seg[0] === "holds") return h.json(res, 200, P.removeHold(seg[1]));
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
