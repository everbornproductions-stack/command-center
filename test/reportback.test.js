// Report-back relay. The hub keeps a result only for the account that created the job,
// deletes it on ack or after the ttl, and logs the job id and status only.
// Waits below are real timers. Each server is a child and is killed in finally.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT, waitBudget } from "./helpers.js";
import { pasteBlock, reportBlockText, parsePasted, cleanReport, workerOn, ttlMs, TTL_MS } from "../server/reportback.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const EM = "\u2014";

const TOKEN_A = "acctA-worker-token-91xkQm";
const TOKEN_B = "acctB-worker-token-92xkQm";
const SUMMARY = "ZephyrDockSummary88421";
const FILE_TEXT = "ZephyrFileBody88421";
const LINK = "https://example.com/zephyr-report-88421";
const EXPIRE_SUMMARY = "ExpiryOnlySummary77210";
const LATE_SUMMARY = "LateExpirySummary77211";
const DESK_SUMMARY = "DockSummaryAccountA55190";
const GROK_SUMMARY = "GrokReportBackInvoice66120";
const RATE_TOKEN = "rate-bearer-token-77zzQm";
const SENDER = "gbk_reportback_sender_key_01";

function post(s, p, token, body, headers = {}) {
  return s.raw({
    method: "POST",
    path: p,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body,
    timeout: 15000,
  });
}
function inbox(s, token, wait = 0) {
  return s.raw({
    method: "GET",
    path: `/api/handoff/inbox?wait=${wait}`,
    headers: { authorization: `Bearer ${token}` },
    timeout: 15000,
  });
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.size < 2_000_000) out.push([p, fs.readFileSync(p)]);
  }
  return out;
}
function hits(dir, needle) {
  const buf = Buffer.from(needle);
  return walk(dir).filter(([, b]) => b.includes(buf)).map(([p]) => path.relative(dir, p));
}
function reportLines(log) {
  return String(log || "").split("\n").map((l) => l.trim()).filter((l) => l.includes("report-back "));
}

// The hub logs from a child process. On Windows a write to a pipe is async, so the
// HTTP reply can arrive before the log line. Wait for the line with a real deadline.
async function waitForReport(hub, line, ms = waitBudget(5000)) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (reportLines(hub.log).some((l) => l === line)) return true;
    await sleep(50);
  }
  return reportLines(hub.log).some((l) => l === line);
}

test("prompt block, paste parse, and link cleanup use plain words", () => {
  assert.equal(workerOn(), false);
  assert.equal(ttlMs(), TTL_MS);
  const paste = pasteBlock();
  assert.equal(paste, "When finished, let Meldmind know: reply with DONE: <summary> and the user can paste it back.");
  assert.doesNotMatch(paste, /Authorization|Bearer|\/api\/handoff\//);
  assert.equal(paste.includes(EM), false);
  const url = "https://hub.example/api/handoff/rb-example1/done";
  const token = "job-token-example-0123456789";
  const block = reportBlockText({ url, token });
  assert.ok(block.startsWith(`When finished, let Meldmind know: POST ${url} with header Authorization: Bearer ${token} and JSON {status, summary, links}. If you can't make web requests, reply with DONE: <summary> and the user can paste it back.`));
  assert.match(block, new RegExp(`curl -sS -X POST "${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(block, /-H "Authorization: Bearer job-token-example-0123456789"/);
  assert.match(block, /-d '\{"status":"done","summary":"<summary>","links":\[\]\}'/);
  assert.equal(parsePasted("DONE: The chairs arrived.").summary, "The chairs arrived.");
  assert.equal(parsePasted("  done:  hi there").summary, "hi there");
  const clean = cleanReport({ status: "done", summary: "ok", links: [LINK, "javascript:alert(1)"], files: [{ name: "note.txt", text: "kept" }, { name: "skip" }] });
  assert.deepEqual(clean.links, [LINK]);
  assert.equal(clean.files.length, 1);
  assert.equal(clean.files[0].text, "kept");
  assert.throws(() => cleanReport({ status: "finished", summary: "x" }), (e) => e.status === 400);
});

test("help, tour, guide, and the page say Paste result, with no em-dash", () => {
  const files = [
    "server/reportback.js",
    "web/features/handoff.js",
    "web/features/grokbot.js",
    "web/features/tour.js",
    "docs/help/handoff.md",
    "docs/help/what-meldmind-can-do.md",
    "docs/help/faq.md",
    "docs/WHATS-NEW.json",
    "docs/USER-GUIDE.md",
    "docs/guide-pdf.json",
    "docs/hosted-hub.md",
  ];
  for (const f of files) assert.equal(read(f).includes(EM), false, f);
  const news = JSON.parse(read("docs/WHATS-NEW.json"));
  assert.ok(Object.values(news).flatMap((v) => v.bullets || []).some((b) => b.includes("Paste result") && b.includes("You get a notice")));
  const guide = JSON.parse(read("docs/guide-pdf.json"));
  const titles = guide.sections.map((s) => s.title);
  assert.ok(titles.includes("What can Meldmind do"));
  assert.ok(titles.includes("When another AI finishes"));
  assert.match(JSON.stringify(guide), /Paste result/);
  assert.match(read("docs/USER-GUIDE.md"), /## 9\. When another AI finishes/);
  assert.match(read("docs/USER-GUIDE.md"), /deletes it when your app picks it up, or after 7 days/);
  assert.match(read("docs/help/what-meldmind-can-do.md"), /Someone else's account cannot open it/);
  assert.match(read("docs/help/handoff.md"), /lastUpdatedVersion: \d+\.\d+\.\d+/);
  assert.match(read("docs/help/faq.md"), /lastUpdatedVersion: 0\.4\.3/);
  assert.match(read("web/features/tour.js"), /title: "When another AI finishes"/);
  assert.match(read("web/features/tour.js"), /use Paste result/);
  assert.match(read("web/features/handoff.js"), /Paste result/);
  assert.match(read("web/features/handoff.js"), /id="ho-paste-open"/);
  assert.match(read("electron/main.cjs"), /handle\("app:notify"/);
  assert.match(read("electron/desk-preload.cjs"), /notify: \(title, body\)/);
  assert.match(read("docs/hosted-hub.md"), /https:\/\/meldmind-hub\.fly\.dev/);
  assert.match(read("docs/hosted-hub.md"), /CC_HUB_URL` stays `https:\/\/hub\.everbornproductions\.com/);
  assert.match(read("docs/grokbot.md"), /callback_url` is unchanged/);
  assert.doesNotMatch(read("server/reportback.js"), /\/api\/handoff\/admin/);
  const notify = read("electron/main.cjs").slice(read("electron/main.cjs").indexOf('handle("app:notify"'));
  assert.doesNotMatch(notify.slice(0, 500), /console\.log/);
});

test("hub: one account cannot read another, and the relay keeps no admin copy", { timeout: 60000 }, async () => {
  const hub = await startServer({ env: { CC_STATUS_PAGES: "off", CC_REPORTBACK_TTL_MS: "60000", CC_REPORTBACK_RATE_MAX: "500" } });
  try {
    assert.equal((await post(hub, "/api/handoff/jobs", "short-token", {})).status, 401);
    assert.equal((await hub.raw({ method: "POST", path: "/api/handoff/jobs", headers: { "content-type": "application/json", "x-cc-token": hub.token }, body: {} })).status, 401, "the session token is not an account");

    const a = await post(hub, "/api/handoff/jobs", TOKEN_A, { jobId: "rb-isolationA01" });
    assert.equal(a.status, 200);
    assert.equal(a.json.jobId, "rb-isolationA01");
    assert.ok(a.json.token.length >= 16);
    const b = await post(hub, "/api/handoff/jobs", TOKEN_B, { jobId: "rb-isolationB01" });
    assert.equal(b.status, 200);
    const again = await post(hub, "/api/handoff/jobs", TOKEN_A, { jobId: "rb-isolationA01" });
    assert.equal(again.status, 409);
    assert.doesNotMatch(again.text, new RegExp(a.json.token));

    const donePath = "/api/handoff/rb-isolationA01/done";
    assert.equal((await post(hub, donePath, "wrong-token-not-the-job", { status: "done", summary: SUMMARY })).status, 401);
    assert.equal((await post(hub, donePath, "", { status: "done", summary: SUMMARY })).status, 401);
    assert.equal((await post(hub, donePath, TOKEN_A, { status: "done", summary: SUMMARY })).status, 401, "the account token cannot post a result");
    assert.equal((await post(hub, donePath, a.json.token, { status: "nope", summary: SUMMARY })).status, 400);
    assert.equal((await hub.raw({ method: "POST", path: donePath, headers: { "content-type": "text/plain", authorization: `Bearer ${a.json.token}` }, body: "status=done" })).status, 415);
    assert.equal((await hub.raw({ method: "POST", path: donePath, headers: { "content-type": "application/json", authorization: `Bearer ${a.json.token}` }, body: "{not json" })).status, 400);

    const done = await post(hub, donePath, a.json.token, {
      status: "done", summary: SUMMARY, links: [LINK, "javascript:alert(1)"], files: [{ name: "note.txt", text: FILE_TEXT }, { name: "skip" }],
    });
    assert.equal(done.status, 200);
    assert.deepEqual(done.json, { ok: true, jobId: "rb-isolationA01", status: "done" });
    assert.doesNotMatch(done.text, new RegExp(SUMMARY));
    assert.equal((await post(hub, donePath, a.json.token, { status: "done", summary: "second" })).status, 401, "single use");

    const asJob = await inbox(hub, a.json.token);
    assert.equal(asJob.status, 200);
    assert.equal(asJob.json.results.length, 0, "the per-job token cannot read");
    assert.doesNotMatch(asJob.text, new RegExp(SUMMARY));

    const t0 = Date.now();
    const other = await inbox(hub, TOKEN_B, 400);
    const waited = Date.now() - t0;
    assert.equal(other.status, 200);
    assert.ok(waited >= 250, `account B waited ${waited}ms`);
    assert.doesNotMatch(other.text, new RegExp(SUMMARY));
    assert.doesNotMatch(other.text, new RegExp(FILE_TEXT));
    const stolen = await post(hub, "/api/handoff/rb-isolationA01/ack", TOKEN_B, {});
    assert.equal(stolen.status, 404);
    const mine = await inbox(hub, TOKEN_A);
    assert.equal(mine.json.results.length, 1);
    assert.equal(mine.json.results[0].summary, SUMMARY);
    assert.deepEqual(mine.json.results[0].links, [LINK]);
    assert.equal(mine.json.results[0].files[0].text, FILE_TEXT);
    assert.equal((await post(hub, "/api/handoff/rb-isolationA01/ack", a.json.token, {})).status, 404, "the job token cannot ack");
    assert.equal((await inbox(hub, TOKEN_A)).json.results[0].summary, SUMMARY, "a failed ack leaves the result");

    const peek = await hub.raw({ method: "GET", path: donePath, headers: { authorization: `Bearer ${a.json.token}` } });
    assert.notEqual(peek.status, 200);
    assert.doesNotMatch(peek.text, new RegExp(SUMMARY));
    const admin = await hub.raw({ path: "/api/handoff/admin", headers: { authorization: `Bearer ${TOKEN_A}` } });
    assert.notEqual(admin.status, 200);
    assert.doesNotMatch(admin.text, new RegExp(SUMMARY));
    const listed = await hub.api("/handoff/jobs");
    assert.notEqual(listed.status, 200);
    assert.doesNotMatch(listed.text, new RegExp(SUMMARY));
    const open = await hub.raw({ path: "/api/handoff/jobs" });
    assert.equal(open.status, 401);

    assert.equal((await post(hub, "/api/handoff/rb-isolationA01/ack", TOKEN_A, {})).status, 200);
    assert.deepEqual((await inbox(hub, TOKEN_A)).json.results, []);

    const need = await post(hub, "/api/handoff/jobs", TOKEN_A, { jobId: "rb-isolationA02" });
    const needDone = await post(hub, "/api/handoff/rb-isolationA02/done", need.json.token, { status: "needs_input", summary: "NeedMoreFromYou99331" });
    assert.equal(needDone.status, 200);
    assert.equal(needDone.json.status, "needs_input");
    assert.doesNotMatch(needDone.text, /NeedMoreFromYou99331/);
    assert.equal((await inbox(hub, TOKEN_B)).json.results.length, 0);
    assert.equal((await inbox(hub, TOKEN_A)).json.results[0].status, "needs_input");
    assert.equal((await post(hub, "/api/handoff/rb-isolationA02/ack", TOKEN_A, {})).status, 200);

    let woke = null;
    for (let attempt = 0; attempt < 3 && !woke; attempt++) {
      const reg = await post(hub, "/api/handoff/jobs", TOKEN_A, {});
      const started = Date.now();
      const pending = inbox(hub, TOKEN_A, 2200);
      await sleep(350);
      const posted = await post(hub, `/api/handoff/${reg.json.jobId}/done`, reg.json.token, { status: "done", summary: "LongPollWake66110", links: [] });
      assert.equal(posted.status, 200);
      const got = await pending;
      const elapsed = Date.now() - started;
      const hit = (got.json?.results || []).some((r) => r.summary === "LongPollWake66110");
      if (hit && elapsed >= 300 && elapsed < 1900) woke = { elapsed };
      await post(hub, `/api/handoff/${reg.json.jobId}/ack`, TOKEN_A, {});
    }
    assert.ok(woke, "long-poll woke before the full wait");

    const fat = await post(hub, "/api/handoff/jobs", TOKEN_A, { jobId: "rb-fatbody0001" });
    const big = JSON.stringify({ status: "done", summary: "x".repeat(70 * 1024) });
    assert.ok(Buffer.byteLength(big) > 64 * 1024);
    const tooBig = await post(hub, "/api/handoff/rb-fatbody0001/done", fat.json.token, big);
    assert.equal(tooBig.status, 413);

    const lines = reportLines(hub.log);
    assert.ok(lines.length > 0);
    for (const line of lines) assert.match(line, /^report-back [A-Za-z0-9_-]+ [a-z_]+$/, line);
    for (const secret of [TOKEN_A, TOKEN_B, a.json.token, b.json.token, SUMMARY, FILE_TEXT, LINK, "LongPollWake66110", "NeedMoreFromYou99331", "x".repeat(80)]) {
      assert.equal(hub.log.includes(secret), false, `hub log leaked ${secret.slice(0, 24)}`);
      assert.deepEqual(hits(hub.dir, secret), [], `hub data leaked ${secret.slice(0, 24)}`);
    }
  } finally { await hub.stop(); }
});

test("hub: a result is deleted after the real ttl, and the summary is never logged", { timeout: 30000 }, async () => {
  const hub = await startServer({ env: { CC_STATUS_PAGES: "off", CC_REPORTBACK_TTL_MS: "1200", CC_REPORTBACK_RATE_MAX: "100" } });
  try {
    const reg = await post(hub, "/api/handoff/jobs", TOKEN_A, { jobId: "rb-expiry0001" });
    assert.equal(reg.status, 200);
    const done = await post(hub, "/api/handoff/rb-expiry0001/done", reg.json.token, { status: "done", summary: EXPIRE_SUMMARY });
    assert.equal(done.status, 200);
    await sleep(1600);
    const gone = await inbox(hub, TOKEN_A);
    assert.deepEqual(gone.json.results, []);
    assert.ok(await waitForReport(hub, "report-back rb-expiry0001 expired"));
    assert.equal(hub.log.includes(EXPIRE_SUMMARY), false);

    const late = await post(hub, "/api/handoff/jobs", TOKEN_A, { jobId: "rb-expiry0002" });
    await sleep(1600);
    const refused = await post(hub, "/api/handoff/rb-expiry0002/done", late.json.token, { status: "failed", summary: LATE_SUMMARY });
    assert.equal(refused.status, 401);
    assert.equal(hub.log.includes(LATE_SUMMARY), false);
    assert.deepEqual(hits(hub.dir, EXPIRE_SUMMARY).concat(hits(hub.dir, LATE_SUMMARY)), []);
    assert.equal(hub.log.includes(reg.json.token), false);
    assert.equal(hub.log.includes(TOKEN_A), false);
  } finally { await hub.stop(); }
});

test("hub: the fourth report on a tight limit is refused, and the token is not logged", { timeout: 30000 }, async () => {
  const hub = await startServer({ env: { CC_STATUS_PAGES: "off", CC_REPORTBACK_RATE_MAX: "3" } });
  try {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(hub, "/api/handoff/jobs", RATE_TOKEN, { jobId: `rb-rate000${i}x` })).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
    assert.equal(hub.log.includes(RATE_TOKEN), false);
    for (const line of reportLines(hub.log)) assert.match(line, /^report-back rb-rate000[0-2]x registered$/);
  } finally { await hub.stop(); }
});

test("desktop: the app picks up only its own result, then the hub deletes it", { timeout: 90000 }, async () => {
  const hook = { hits: [] };
  const mock = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, obj) => {
      const text = JSON.stringify(obj);
      res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(text), connection: "close" });
      res.end(text);
    };
    if (url.pathname === "/hook") {
      hook.hits.push(JSON.parse(body || "null"));
      return send(200, { status: "queued" });
    }
    send(404, { error: "no route" });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockBase = `http://127.0.0.1:${mock.address().port}`;
  let hub, desk;
  try {
    hub = await startServer({ env: { CC_STATUS_PAGES: "off", CC_REPORTBACK_TTL_MS: "60000", CC_REPORTBACK_RATE_MAX: "500" } });
    desk = await startServer({ env: {
      CC_STATUS_PAGES: "off", CC_DEV_OWNER: "1",
      CC_WORKER_URL: hub.base, CC_WORKER_TOKEN: TOKEN_A, CC_REPORTBACK_POLL_WAIT_MS: "2000",
      OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
    } });
    const thread = "s-rbdesk1";
    fs.writeFileSync(path.join(desk.dir, "missions", thread + ".json"), JSON.stringify({
      id: thread, kind: "single", title: "Dock", prompt: "Note the dock", deliverable: "Existing note.", status: "done", startedAt: Date.now(),
      messages: [{ role: "user", text: "Note the dock" }],
    }));
    const built = await desk.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", threadId: thread } });
    assert.equal(built.status, 200);
    const prompt = built.json.prompt;
    const jobId = built.json.jobId;
    assert.match(prompt, new RegExp(`When finished, let Meldmind know: POST ${hub.base}/api/handoff/${jobId}/done with header Authorization: Bearer `));
    assert.match(prompt, /curl -sS -X POST /);
    assert.match(prompt, /DONE: <summary>/);
    assert.doesNotMatch(prompt, new RegExp(`127\\.0\\.0\\.1:${desk.port}`));
    assert.doesNotMatch(prompt, new RegExp(TOKEN_A));
    const jobToken = prompt.match(/Authorization: Bearer ([A-Za-z0-9_-]+)/)[1];
    assert.notEqual(jobToken, TOKEN_A);

    const posted = await post(hub, `/api/handoff/${jobId}/done`, jobToken, { status: "done", summary: DESK_SUMMARY, links: [LINK] });
    assert.equal(posted.status, 200);
    const other = await inbox(hub, TOKEN_B, 200);
    assert.doesNotMatch(other.text, new RegExp(DESK_SUMMARY));

    const full = await (async () => {
      const budget = waitBudget(12000);
      const t0 = Date.now();
      while (Date.now() - t0 < budget) {
        const m = await desk.api(`/missions/${thread}`);
        if (m.json?.deliverable && m.json.deliverable.includes(DESK_SUMMARY)) return m.json;
        await sleep(100);
      }
      return null;
    })();
    assert.ok(full, `summary did not land\n${desk.log.slice(-500)}\n${hub.log.slice(-500)}`);
    assert.match(full.deliverable, /From the other AI/);
    assert.match(full.deliverable, new RegExp(LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const acked = await (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < waitBudget(8000)) {
        const box = await inbox(hub, TOKEN_A);
        if (!box.json.results.some((r) => r.summary === DESK_SUMMARY)) return true;
        await sleep(100);
      }
      return false;
    })();
    assert.equal(acked, true, "the app ack deleted the result");
    assert.ok(await waitForReport(hub, `report-back ${jobId} deleted`));

    const saved = await desk.api("/grokbot/config", { method: "POST", body: { url: `${mockBase}/hook`, key: SENDER } });
    assert.equal(saved.status, 200);
    const handed = await desk.api("/grokbot/jobs", { method: "POST", body: { task: "Check the dock receipt" } });
    assert.equal(handed.status, 202);
    const hit = hook.hits.at(-1);
    assert.equal(handed.json.job.task, "Check the dock receipt");
    assert.doesNotMatch(handed.json.job.task, /Bearer/);
    assert.match(hit.callback_url, new RegExp(`^http://127\\.0\\.0\\.1:${desk.port}/api/grokbot/callback/${handed.json.job.id}\\?t=`));
    assert.doesNotMatch(hit.callback_url, /handoff/);
    assert.match(hit.task, new RegExp(`${hub.base}/api/handoff/${handed.json.job.id}/done`));
    assert.match(hit.task, /curl -sS -X POST /);
    const grokToken = hit.task.match(/Authorization: Bearer ([A-Za-z0-9_-]+)/)[1];
    assert.equal((await post(hub, `/api/handoff/${handed.json.job.id}/done`, grokToken, { status: "done", summary: GROK_SUMMARY, links: [LINK] })).status, 200);
    const grokJob = await (async () => {
      const budget = waitBudget(12000);
      const t0 = Date.now();
      while (Date.now() - t0 < budget) {
        const rows = (await desk.api("/grokbot/jobs")).json;
        const row = rows.find((j) => j.id === handed.json.job.id);
        if (row?.text && row.text.includes(GROK_SUMMARY)) return row;
        await sleep(100);
      }
      return null;
    })();
    assert.ok(grokJob, "Grok Bot job did not receive the report");
    assert.equal(grokJob.status, "done");
    const stored = JSON.parse(fs.readFileSync(path.join(desk.dir, "grokbot.jobs.json"), "utf8"));
    const storedJob = stored.find((j) => j.id === handed.json.job.id);
    assert.equal(storedJob.task, "Check the dock receipt");
    assert.doesNotMatch(storedJob.task, /Bearer/);

    for (const secret of [TOKEN_A, jobToken, grokToken, SENDER]) {
      assert.equal(hub.log.includes(secret), false, `hub log ${secret.slice(0, 12)}`);
      assert.equal(desk.log.includes(secret), false, `desk log ${secret.slice(0, 12)}`);
      assert.deepEqual(hits(hub.dir, secret), [], `hub file ${secret.slice(0, 12)}`);
      assert.deepEqual(hits(desk.dir, secret), [], `desk file ${secret.slice(0, 12)}`);
    }
    for (const secret of [DESK_SUMMARY, GROK_SUMMARY, SUMMARY]) {
      assert.equal(hub.log.includes(secret), false, `hub logged ${secret}`);
      assert.deepEqual(hits(hub.dir, secret), [], `hub stored ${secret}`);
    }
    assert.ok(hits(desk.dir, DESK_SUMMARY).length > 0, "the person's own app keeps the summary");
  } finally {
    if (desk) await desk.stop();
    if (hub) await hub.stop();
    await new Promise((r) => mock.close(r));
  }
});

test("no hub: the prompt says to paste, and Paste result saves only on confirm", { timeout: 40000 }, async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "" } });
  try {
    const thread = "s-rbpaste1";
    fs.writeFileSync(path.join(s.dir, "missions", thread + ".json"), JSON.stringify({
      id: thread, kind: "single", title: "Chairs", prompt: "Where are the chairs", deliverable: "", status: "done", startedAt: Date.now(),
      messages: [{ role: "user", text: "Where are the chairs" }],
    }));
    const built = await s.api("/handoff/prompt", { method: "POST", body: { targetId: "chatgpt", threadId: thread } });
    assert.equal(built.status, 200);
    assert.match(built.json.prompt, /DONE: <summary>/);
    assert.match(built.json.prompt, /paste it back/);
    assert.doesNotMatch(built.json.prompt, /\/api\/handoff\//);
    assert.doesNotMatch(built.json.prompt, /Authorization: Bearer/);
    assert.equal((await s.api("/handoff/paste", { method: "POST", body: { text: "DONE: The chairs arrived.", threadId: thread, confirm: false }, noToken: true })).status, 401);
    const early = await s.api("/handoff/paste", { method: "POST", body: { text: "DONE: The chairs arrived.", threadId: thread, confirm: false } });
    assert.equal(early.status, 400);
    assert.deepEqual(hits(s.dir, "The chairs arrived."), []);
    const saved = await s.api("/handoff/paste", { method: "POST", body: { text: "DONE: The chairs arrived.", threadId: thread, confirm: true } });
    assert.equal(saved.status, 200);
    const full = (await s.api(`/missions/${thread}`)).json;
    assert.match(full.deliverable, /Pasted result/);
    assert.match(full.deliverable, /The chairs arrived\./);
    assert.equal(s.log.includes("The chairs arrived."), false);
  } finally { await s.stop(); }
});
