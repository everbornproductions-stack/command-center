// Morning briefing, email holds, and find-a-time. Local mocks only. Send is a click.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { extractEmail, openSlots, isDue, TRY_BRIEF, TRY_EXTRACT, TRY_SLOTS } from "../server/everyday-plan.js";

const EM = "\u2014";
const tue = new Date(2026, 9, 20, 9, 0, 0).getTime();

test("a hold stays local, slots skip busy time, and a briefing waits for the clock", () => {
  const parsed = extractEmail({ from: "Sam <sam@shop.test>", subject: "Lunch", body: "Lunch Thursday at 2 at Tacos Uno", now: tue });
  assert.equal(parsed.needsClick, true);
  assert.equal(parsed.hold.where, undefined);
  assert.equal(new Date(parsed.hold.start).getDay(), 4);
  assert.equal(new Date(parsed.hold.start).getHours(), 14);
  assert.throws(() => extractEmail({ subject: "Login", body: "password is hunter2", now: tue }), /password/);
  const wed9 = new Date(2026, 9, 21, 9, 0, 0).getTime();
  const wed10 = new Date(2026, 9, 21, 10, 0, 0).getTime();
  const slots = openSlots({ busy: [{ start: wed9, end: wed10 }], now: new Date(2026, 9, 20, 15, 0, 0).getTime(), minutes: 30, count: 3, days: 7 });
  assert.equal(slots.length, 3);
  assert.equal(slots[0].start, wed10);
  const routine = { enabled: true, weekdays: true, hour: 8, minute: 0 };
  assert.equal(isDue(routine, new Date(2026, 9, 20, 7, 0, 0).getTime(), null), false);
  assert.equal(isDue(routine, new Date(2026, 9, 20, 8, 5, 0).getTime(), null), true);
  assert.equal(isDue(routine, new Date(2026, 9, 18, 9, 0, 0).getTime(), null), false);
  for (const file of ["server/everyday-plan.js", "server/plugins/everyday-plan.js", "web/features/everyday-plan.js", "docs/help/everyday-briefing.md", "docs/help/everyday-email-task.md", "docs/help/everyday-find-time.md"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  }
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/everyday-find-time.md"), "utf8"), /Try saying: Find 3 open 30 min slots/);
  assert.equal(TRY_BRIEF.includes(EM) || TRY_EXTRACT.includes(EM) || TRY_SLOTS.includes(EM), false);
});

async function sink() {
  const m = { sent: [] };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    if (req.url === "/send") m.sent.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  m.base = `http://127.0.0.1:${srv.address().port}`;
  m.close = () => new Promise((resolve) => { try { srv.closeAllConnections(); } catch {} srv.close(resolve); });
  return m;
}

test("briefing prepares without sending, and a slot email waits for Send", async () => {
  const m = await sink();
  let s;
  try {
    s = await startServer({ env: {
      CC_EVERYDAY_MAIL_URL: `${m.base}/send`,
      CC_STATUS_PAGES: "off",
      ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
      PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
    } });
    assert.ok((await s.api("/state")).json.plugins.includes("everyday-plan"));
    const page = await s.api("/everyday-plan");
    assert.equal(page.json.trySaying.slots, TRY_SLOTS);
    assert.equal((await s.api("/everyday-plan/routines", { method: "POST", body: { name: "Weekday morning", hour: 8, minute: 0, weekdays: true, city: "Austin" } })).status, 200);
    const second = await s.api("/everyday-plan/routines", { method: "POST", body: { name: "Another", hour: 9, minute: 0 } });
    assert.equal(second.status, 402, second.text);
    const early = await s.api("/everyday-plan/tick", { method: "POST", body: { now: new Date(2026, 9, 20, 7, 0, 0).getTime() } });
    assert.equal(early.json.prepared, 0);
    const sunday = await s.api("/everyday-plan/tick", { method: "POST", body: { now: new Date(2026, 9, 18, 9, 0, 0).getTime() } });
    assert.equal(sunday.json.prepared, 0);
    const due = await s.api("/everyday-plan/tick", { method: "POST", body: { now: new Date(2026, 9, 20, 8, 5, 0).getTime() } });
    assert.equal(due.status, 200, due.text);
    assert.equal(due.json.prepared, 1);
    assert.equal(due.json.outputs[0].sends, false);
    assert.match(due.json.outputs[0].sections.find((x) => x.id === "weather").lines[0], /not fetched/);
    assert.match(due.json.outputs[0].sections.find((x) => x.id === "news").lines[0], /not fetched/);
    const again = await s.api("/everyday-plan/tick", { method: "POST", body: { now: new Date(2026, 9, 20, 8, 6, 0).getTime() } });
    assert.equal(again.json.prepared, 0);
    assert.equal(m.sent.length, 0, "a briefing does not send");

    const preview = await s.api("/everyday-plan/extract", { method: "POST", body: { from: "Sam <sam@shop.test>", subject: "Lunch", body: "Lunch Thursday at 2", now: tue } });
    assert.equal(preview.status, 200, preview.text);
    assert.equal(preview.json.needsClick, true);
    assert.equal((await s.api("/everyday-plan")).json.tasks.length, 0, "preview does not save");
    const saved = await s.api("/everyday-plan/extract/save", { method: "POST", body: preview.json.task ? { from: "Sam <sam@shop.test>", subject: "Lunch", body: "Lunch Thursday at 2", now: tue } : {} });
    assert.equal(saved.json.wroteCalendar, false);
    assert.equal(saved.json.hold.where, "local");
    assert.equal((await s.api(`/everyday-plan/holds/${saved.json.hold.id}`, { method: "DELETE" })).status, 200);
    const secret = await s.api("/everyday-plan/extract/save", { method: "POST", body: { subject: "Keys", body: "password hunter2" } });
    assert.equal(secret.status, 400);
    const bulk = await s.api("/everyday-plan/extract/bulk", { method: "POST", body: { emails: Array.from({ length: 11 }, (_, i) => ({ subject: `Note ${i}`, body: "Thanks" })) } });
    assert.equal(bulk.json.needsConfirm, true);
    assert.equal(bulk.json.sample.length, 3);
    assert.equal(bulk.json.saved.length, 0);

    const draft = await s.api("/everyday-plan/slots", { method: "POST", body: { to: "ana@client.test", name: "Ana", minutes: 30, count: 3, days: 7, now: tue } });
    assert.equal(draft.status, 200, draft.text);
    assert.equal(draft.json.sent, false);
    assert.equal(draft.json.draft.slots.length, 3);
    assert.match(draft.json.draft.body, /Ana/);
    assert.equal(m.sent.length, 0);
    const blocked = await s.api(`/everyday-plan/drafts/${draft.json.draft.id}/send`, { method: "POST", body: { to: draft.json.draft.to, subject: draft.json.draft.subject, body: draft.json.draft.body } });
    assert.equal(blocked.status, 400);
    assert.equal(m.sent.length, 0);
    const exact = { confirm: true, to: "ana@client.test", subject: draft.json.draft.subject, body: draft.json.draft.body };
    const sent = await s.api(`/everyday-plan/drafts/${draft.json.draft.id}/send`, { method: "POST", body: exact });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.via, "loopback");
    assert.equal(m.sent.length, 1);
    assert.equal(m.sent[0].to, exact.to);
    assert.equal(m.sent[0].body, exact.body);
    assert.equal(s.log.includes("ana@client.test") && s.log.includes("hunter2"), false);
  } finally {
    if (s) await s.stop();
    await m.close();
  }
});
