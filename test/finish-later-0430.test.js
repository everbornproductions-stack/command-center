// 0.4.30 "Finish it later": a job that stopped because the AI was out of credit or usage is queued, with one click,
// to run again by itself when the first switched-on helper is back. Server route, the time rule, and the button.
// Helper-process test: run it on its own on Windows. No real key, no network, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, waitBudget, tmpDir } from "./helpers.js";
import { failureHtml, laterFits, LATER_LABEL } from "../web/failure-cause.js";

test("finishLaterAt: a minute after the first helper is back, else 30 minutes, never sooner than 5", async () => {
  process.env.CC_DATA_DIR = tmpDir("cc-fl-");
  const store = await import("../server/store.js");
  store.setDefaultContext(store.newContext("local", new store.FileStore(process.env.CC_DATA_DIR)));
  const WP = await import("../server/worker-pool.js");
  const now = Date.now();
  let r = WP.finishLaterAt(now);
  assert.equal(r.at, now + WP.FINISH_LATER_DEFAULT_MS); assert.equal(r.helperBack, false);
  WP.noteRest("claude-code", { until: now + 2 * 3600e3, now });
  WP.noteRest("gemini-cli", { until: now + 50 * 60e3, now });
  r = WP.finishLaterAt(now);
  assert.equal(r.at, now + 51 * 60e3); assert.equal(r.helperBack, true);
  WP.setEnabled("gemini-cli", false);
  assert.equal(WP.finishLaterAt(now).at, now + 2 * 3600e3 + 60e3, "a switched-off helper does not count");
  WP.noteRest("claude-code", { until: now + 1000, now });
  WP.setEnabled("gemini-cli", true); WP.clearRest("gemini-cli");
  assert.equal(WP.finishLaterAt(now).at, now + WP.FINISH_LATER_MIN_MS, "back in a second still waits the 5 minute floor");
});

test("the failure card offers Finish it later only for out of credit or usage", () => {
  assert.equal(laterFits("credit"), true); assert.equal(laterFits("rate"), true);
  assert.equal(laterFits("key"), false); assert.equal(laterFits("budget"), false); assert.equal(laterFits("other"), false);
  assert.match(failureHtml({ text: "OpenAI: 429 usage limit reached", later: true }), new RegExp(`id="cc-fail-later"[^>]*>${LATER_LABEL}<`));
  assert.doesNotMatch(failureHtml({ text: "Incorrect API key provided", later: true }), /cc-fail-later/);
  assert.doesNotMatch(failureHtml({ text: "OpenAI: 429 usage limit reached" }), /cc-fail-later/, "only when the card has the job's words");
});

test("POST /api/mission with runAt when-back queues the job for later and does not run it now", { timeout: waitBudget(120000) }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const before = Date.now();
    const r = await s.api("/mission", { method: "POST", body: { goal: "Write a short note for the team.", runAt: "when-back", qa: false, search: false } });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.json.scheduled.status, "scheduled");
    assert.ok(r.json.at >= before + 5 * 60e3 - 1000, "not sooner than 5 minutes");
    assert.equal(r.json.scheduled.scheduledFor, r.json.at);
    assert.match(r.json.scheduled.reason, /short rest|AIs are back/);
    const st = (await s.api("/state")).json;
    const row = (st.missions || []).find((m) => m.id === r.json.scheduled.id);
    assert.ok(row && row.status === "scheduled", "listed as scheduled, nothing ran");
    // cancel it the normal way, so nothing is left behind
    const ab = await s.api(`/mission/${r.json.scheduled.id}/abort`, { method: "POST" });
    assert.ok(ab.status < 300, ab.text);
  } finally { await s.stop(); }
});
