// 0.4.21 item 10: backup step 2, the website. A fake browser helper stands in for the window: no page is ever opened.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpDir, ROOT, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-webstep-");
process.env.CC_DATA_DIR = DIR;
process.env.CC_SUBCLI_HOME = tmpDir("cc-webstep-home-");
process.env.CC_SUBCLI_NO_PATH = "1";
const EM = String.fromCharCode(0x2014);

const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const AW = await import("../server/answer-wait.js");
const SR = await import("../server/sub-routes.js");
const WS = await import("../server/website-step.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = waitBudget(15000)) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(50); }
  return null;
}
const filled = [];
AW.onSlotAnswer("single", async (job, res) => { filled.push({ job, res }); });

const fakeHelper = (over = {}) => {
  const seen = { tasks: [], stopped: [] };
  return {
    seen,
    readiness: () => ({ ready: true, via: "window" }),
    driverInfo: () => ({ kind: "window" }),
    dispatch: async (task, source) => { seen.tasks.push({ task, source }); return { id: "bh-1" }; },
    awaitJob: async () => ({ status: "done", text: "The website answer." }),
    stopJob: async (id, why) => { seen.stopped.push([id, why]); },
    ...over,
  };
};
const JOB = { provider: "openai", aiName: "ChatGPT", runId: "s-1" };

test("the task opens the AI's own site, never types a password, and carries the question", async () => {
  const h = fakeHelper();
  const r = await WS.askWebsite(JOB, "Name a bakery", h);
  assert.deepEqual([r.ok, r.text, r.site], [true, "The website answer.", "ChatGPT"]);
  const t = h.seen.tasks[0].task;
  assert.match(t, /Open https:\/\/chatgpt\.com\//);
  assert.match(t, /never type a password/);
  assert.match(t, /QUESTION\nName a bakery/);
  assert.equal(h.seen.tasks[0].source.runId, "s-1");
  assert.deepEqual(Object.keys(WS.SITES).sort(), ["anthropic", "openai", "xai"]);
  assert.ok(!t.includes(EM));
});

test("each way the website can fail says so in plain words and never answers", async () => {
  assert.equal((await WS.askWebsite({ provider: "google", aiName: "Gemini" }, "Q", fakeHelper())).code, "no-site");
  assert.equal((await WS.askWebsite(JOB, "Q", fakeHelper({ readiness: () => ({ ready: false, detail: "switched off" }) }))).code, "not-ready");
  const reader = await WS.askWebsite(JOB, "Q", fakeHelper({ driverInfo: () => ({ kind: "reader" }) }));
  assert.equal(reader.code, "no-window");
  assert.match(reader.message, /desktop app/);
  assert.equal((await WS.askWebsite(JOB, "Q", fakeHelper({ dispatch: async () => { throw new Error("boom"); } }))).code, "start");
  const h = fakeHelper({ awaitJob: async () => null });
  const timeout = await WS.askWebsite(JOB, "Q", h);
  assert.equal(timeout.code, "timeout");
  assert.equal(h.seen.stopped.length, 1, "a job nobody answered is stopped");
  assert.equal((await WS.askWebsite(JOB, "Q", fakeHelper({ awaitJob: async () => ({ status: "failed", error: "No." }) }))).code, "failed");
  assert.equal((await WS.askWebsite(JOB, "Q", fakeHelper({ awaitJob: async () => ({ status: "done", text: "sign in needed" }) }))).code, "signin");
  assert.equal((await WS.askWebsite(JOB, "Q", fakeHelper({ awaitJob: async () => ({ status: "done", text: "  " }) }))).code, "empty");
});

test("the chain: apps have nothing, so the website answers and fills the waiting box (no copy-over needed)", async () => {
  SR.saveRouteSettings({ website: true, confirm: true });
  AW._test.setWebDeps(fakeHelper());
  filled.length = 0;
  const info = AW.openWait({ kind: "single", runId: "s-chain1", provider: "openai", model: "gpt-x", ask: "Q1" });
  const hit = await until(() => filled.find((f) => f.job.id === info.jobId));
  assert.ok(hit, "the answer arrived");
  assert.equal(hit.res.text, "The website answer.");
  assert.equal(hit.res.route, "website");
  assert.equal(hit.res.tag, "via ChatGPT website");
  assert.equal(AW.findJob(info.jobId).status, "answered");
});

test("the chain: a website that cannot answer hands on to copy-over, in order", async () => {
  AW._test.setWebDeps(fakeHelper({ awaitJob: async () => ({ status: "failed", error: "No." }) }));
  const info = AW.openWait({ kind: "single", runId: "s-chain2", provider: "openai", model: "gpt-x", ask: "Q2" });
  const job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.ok(job.tried.some((t) => t.route === "website" && t.code === "failed"));
  assert.ok(job.prompt.includes("MELDMIND ANSWER"));
  await AW.stopWait(info.jobId);
});

test("the chain: website mode off means the website is never touched", async () => {
  SR.saveRouteSettings({ website: false });
  const h = fakeHelper();
  AW._test.setWebDeps(h);
  const info = AW.openWait({ kind: "single", runId: "s-chain3", provider: "openai", model: "gpt-x", ask: "Q3" });
  const job = await until(() => AW.findJob(info.jobId)?.step === "copy" && AW.findJob(info.jobId));
  assert.ok(job);
  assert.equal(h.seen.tasks.length, 0);
  await AW.stopWait(info.jobId);
  AW._test.setWebDeps(null);
});

test("no leftover 'later update' wording anywhere a person reads", async () => {
  const fs = await import("node:fs");
  for (const f of ["server/sub-routes.js", "server/answer-wait.js", "web/backup-panel.js", "docs/help/handoff.md"]) {
    assert.ok(!/coming in a later update/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")), f);
  }
});
