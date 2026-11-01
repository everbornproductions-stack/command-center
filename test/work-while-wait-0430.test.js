// 0.4.30 "Work while you wait" (Chris 2026-10-22): when the official apps are out of usage, a waiting answer keeps
// Continue in and Paste reply, and Meldmind also tries the apps again by itself when the first one is back.
// In-process with a fake app, no network, no real key, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpDir, ROOT, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-www-");
const HOME = tmpDir("cc-www-home-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_SUBCLI_HOME = HOME;
process.env.CC_SUBCLI_NO_PATH = "1";
process.env.CC_SUBCLI_EXEC = process.execPath;
process.env.CC_CLAUDE_BIN = path.join(ROOT, "test", "fixtures", "fake-sub-cli.mjs");

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const AW = await import("../server/answer-wait.js");
const SR = await import("../server/sub-routes.js");
const { waitBoxHtml, retryClock } = await import("../web/backup-panel.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = waitBudget(15000)) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}
const cred = path.join(HOME, ".claude", ".credentials.json");
fs.mkdirSync(path.dirname(cred), { recursive: true }); fs.writeFileSync(cred, "{}");
const filled = [];
AW.onSlotAnswer("single", async (job, res) => { filled.push({ job, res }); });

test("nextRetryAt: only apps that ran out come back; a minute after the earliest reset, never sooner than 5 minutes", () => {
  const now = Date.UTC(2026, 9, 31, 20, 0);
  assert.equal(AW.nextRetryAt({ tried: [] }, now), null, "no app tried: nothing to wait for");
  assert.equal(AW.nextRetryAt({ tried: [{ route: "claude-code", code: "signin" }] }, now), null, "signed out does not fix itself");
  assert.equal(AW.nextRetryAt({ tried: [{ route: "claude-code", code: "quota" }] }, now), now + AW.RETRY_EVERY_MS, "no reset time: every 30 minutes");
  const r = AW.nextRetryAt({ tried: [{ route: "codex", code: "quota", until: now + 3 * 3600e3 }, { route: "claude-code", code: "quota", until: now + 40 * 60e3 }] }, now);
  assert.equal(r, now + 41 * 60e3, "the earliest reset plus a minute");
  assert.equal(AW.nextRetryAt({ tried: [{ route: "claude-code", code: "quota", until: now + 1000 }] }, now), now + AW.RETRY_MIN_MS);
  assert.equal(AW.nextRetryAt({ autoTries: AW.MAX_AUTO_TRIES, tried: [{ route: "claude-code", code: "quota" }] }, now), null, "gives up after 16 tries");
});

test("out of usage: the job waits with a retry time, and the next try answers through the app once it is back", { timeout: waitBudget(60000) }, async () => {
  SR.clearStatusCache?.();
  process.env.FAKE_SUBCLI_MODE = "quota";
  const info = AW.openWait({ kind: "single", runId: "s-www1", provider: "anthropic", model: "claude-x", ask: "Name a bakery." });
  let job = await until(() => { const j = AW.findJob(info.jobId); return j?.step === "copy" && j.retryAt ? j : null; });
  assert.ok(job, "waiting on copy with a retry time");
  assert.ok(job.retryAt >= Date.now() + AW.RETRY_MIN_MS - 2000, "not sooner than 5 minutes");
  assert.ok(AW._test.retryTimers.has(info.jobId), "the timer is armed");
  const pub = AW.publicJob(job);
  assert.equal(pub.retryAt, job.retryAt);
  assert.match(pub.headline, /tries your apps again by itself/);

  // the box says when, in plain words
  const html = waitBoxHtml({ jobId: job.id, ai: "Claude", step: "copy", retryAt: job.retryAt, since: job.createdAt });
  assert.match(html, /tries them again by itself at \d{1,2}:\d{2}\s?[AP]M/);
  assert.match(html, /Continue in Claude/, "copy it over still works meanwhile");

  // after a restart the time is kept and the timer is armed again, without re-running the apps now
  AW._test.retryTimers.forEach((t) => clearTimeout(t)); AW._test.retryTimers.clear();
  AW.resumeAll();
  assert.ok(AW._test.retryTimers.has(info.jobId));
  assert.equal(AW.findJob(info.jobId).step, "copy");

  // usage is back: the try answers through the app and the box fills in
  process.env.FAKE_SUBCLI_MODE = "ok";
  SR.clearSignedOut?.();
  assert.equal(await AW.retryNow(info.jobId), true);
  job = await until(() => AW.findJob(info.jobId)?.status === "answered" && AW.findJob(info.jobId));
  assert.ok(job, "answered");
  assert.equal(job.answeredBy, "app");
  assert.equal(job.autoTries, 1);
  assert.equal(job.retryAt, null);
  assert.equal(AW._test.retryTimers.has(info.jobId), false, "the timer is cleared");
  assert.match(filled.at(-1).res.text, /Answer from the fake app/);
});

test("Stop waiting clears the next try; a missing app gets no retry time", { timeout: waitBudget(60000) }, async () => {
  process.env.FAKE_SUBCLI_MODE = "quota";
  let info = AW.openWait({ kind: "single", runId: "s-www2", provider: "anthropic", model: "claude-x", ask: "Q2" });
  await until(() => AW.findJob(info.jobId)?.retryAt);
  await AW.stopWait(info.jobId);
  assert.equal(AW._test.retryTimers.has(info.jobId), false);
  assert.equal(AW.publicJob(AW.findJob(info.jobId)).retryAt, null);
  assert.equal(await AW.retryNow(info.jobId), false, "a stopped job is never tried again");

  fs.rmSync(cred, { force: true }); SR.clearStatusCache?.();
  info = AW.openWait({ kind: "single", runId: "s-www3", provider: "anthropic", model: "claude-x", ask: "Q3" });
  const job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.equal(job.retryAt, null, "nothing to wait for");
  await AW.stopWait(info.jobId);
  process.env.FAKE_SUBCLI_MODE = "ok";
});

test("retryClock: today shows the time, another day shows the weekday", () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime();
  assert.match(retryClock(new Date(2026, 9, 31, 15, 40).getTime(), now), /^3:40\s?PM$/);
  assert.match(retryClock(new Date(2026, 10, 1, 9, 5).getTime(), now), /^Sun 9:05\s?AM$/);
});
