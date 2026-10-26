// Phase 4: weekly report (R6). Pure checks (when a Monday report is due, including a missed Monday; the
// email draft), then the running server in a temp data dir, a priced AI on a local mock (no real key or
// URL; practice AIs add $0 since 0.4.20): Run now lists what shipped, the draft and the export work, and nothing is ever sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, startMockOpenAI, tmpDir, ROOT } from "./helpers.js";

const DIR = tmpDir("cc-reports-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR;
const { isDue, lastMonday7, draftOf } = await import("../server/plugins/reports.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

test("Monday 07:00 schedule: due once per week, caught up after a missed Monday", () => {
  // 2026-10-19 is a Monday
  assert.equal(lastMonday7(at(2026, 10, 19, 7)), at(2026, 10, 19, 7).getTime());
  assert.equal(lastMonday7(at(2026, 10, 19, 6, 59)), at(2026, 10, 12, 7).getTime(), "before 7 the previous Monday counts");
  assert.equal(lastMonday7(at(2026, 10, 25, 23)), at(2026, 10, 19, 7).getTime(), "Sunday");
  assert.equal(isDue(0, at(2026, 10, 19, 7, 5)), true);
  assert.equal(isDue(at(2026, 10, 19, 7, 5).getTime(), at(2026, 10, 19, 9)), false, "already made this week");
  assert.equal(isDue(at(2026, 10, 12, 8).getTime(), at(2026, 10, 21, 10)), true, "app closed on Monday: made on Wednesday");
  assert.equal(isDue(at(2026, 10, 20, 8).getTime(), at(2026, 10, 25, 10)), false, "a Run now after Monday counts for the week");
});

test("email draft: subject, plain text body, mailto link, never sent", () => {
  const rep = { totals: { thisWeek: 1.5 }, markdown: "# Weekly report\n\nAPI spend **$1.50**" };
  const d = draftOf(rep, "me@example.com");
  assert.equal(d.subject, "Weekly report: $1.50 this week");
  assert.ok(!d.body.includes("**"));
  assert.ok(d.mailto.startsWith("mailto:me%40example.com?subject=Weekly%20report"));
  const long = draftOf({ totals: { thisWeek: 0 }, markdown: "x".repeat(5000) });
  assert.ok(decodeURIComponent(long.mailto).includes("cut short"), "long reports point to the export");
});

test("weekly report: run now lists what shipped; draft and export; nothing sent", { timeout: 120000 }, async () => {
  const mock = await startMockOpenAI();
  const s = await startServer({ env: { CC_STATUS_PAGES: "off", CC_BASE_URL_OPENAI: mock.base } });
  try {
    let d = (await s.api("/reports/latest")).json;
    assert.equal(d.latest, null); assert.deepEqual(d.prefs, { email: "" }); assert.ok(d.nextRun > Date.now());
    assert.equal((await s.api("/reports/draft")).status, 404, "no report yet");
    assert.equal((await s.api("/reports/latest", { noToken: true })).status, 401);

    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: "sk-test-not-a-real-key-0001" } })).json.status.status, "green");
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Write a two-line tagline for a bakery.", provider: "openai", model: "gpt-6-luna" } })).status, 202);
    let m = null;
    for (let i = 0; i < 240 && !m; i++) { m = (await s.api("/missions")).json.find((x) => x.kind === "single" && x.status === "done"); if (!m) await sleep(250); }
    assert.ok(m, "the chat finished");

    const rep = (await s.api("/reports/run-now", { method: "POST" })).json;
    assert.equal(rep.totals.runs, 1); assert.ok(rep.totals.calls >= 1 && rep.totals.thisWeek > 0);
    assert.equal(rep.shipped[0].id, m.id);
    for (const h of ["## Spend", "## Credits and renewals", "## What shipped", "## Keep, downgrade, cancel"]) assert.ok(rep.markdown.includes(h), h);
    assert.match(rep.markdown, /Write a two-line tagline for a bakery\./);
    assert.ok(!rep.markdown.includes("—") && !rep.markdown.includes("–"), "no em or en dashes");

    assert.equal((await s.api("/reports/prefs", { method: "POST", body: { email: " me@example.com ", emailOn: true } })).json.email, "me@example.com");
    d = (await s.api("/reports/latest")).json;
    assert.equal(d.latest.ts, rep.ts); assert.equal(d.history.length, 1); assert.equal(d.history[0].reason, "run now");
    assert.deepEqual(Object.keys(d.prefs), ["email"], "there is no auto-email switch");

    const dr = (await s.api("/reports/draft")).json;
    assert.equal(dr.sent, false); assert.equal(dr.to, "me@example.com"); assert.match(dr.mailto, /^mailto:me%40example\.com\?subject=/);
    const ex = await s.api("/reports/export");
    assert.equal(ex.status, 200); assert.match(ex.headers["content-type"], /text\/markdown/); assert.match(ex.headers["content-disposition"], /attachment; filename="weekly-report-\d{4}-\d{2}-\d{2}\.md"/);
    assert.equal(ex.text, rep.markdown);
    assert.ok(!s.stub.hits.some((h) => /email|resend/i.test(h.path)), "nothing sent anywhere");
  } finally { await s.stop(); await mock.close(); }
});

test("reports code: no automatic sending, draft / export / copy buttons, no em-dashes", () => {
  const srv = fs.readFileSync(path.join(ROOT, "server/plugins/reports.js"), "utf8");
  assert.doesNotMatch(srv, /fetch\(|api\.resend|getSecret/i, "the report plugin makes no network call of its own");
  // 0.4.21: sending exists, but only behind the Send click (POST /send); the Monday run and Run now never send
  assert.equal((srv.match(/sendOwnMail\(/g) || []).length, 1, "one send call");
  assert.ok(srv.indexOf("sendOwnMail(") > srv.indexOf('p === "/send"'), "the send call sits in the click route");
  assert.ok(srv.indexOf("sendOwnMail(") < srv.indexOf('p === "/draft"'));
  const ui = fs.readFileSync(path.join(ROOT, "web/features/reports.js"), "utf8");
  for (const id of ["rp-draft", "rp-export", "rp-copy", "rp-run"]) assert.ok(ui.includes(`id="${id}"`), id);
  assert.doesNotMatch(ui, /emailOn/);
  for (const f of ["server/plugins/reports.js", "web/features/reports.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
