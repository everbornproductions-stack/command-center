// First-run setup and Simple mode helpers. No real key. The server checks use a temp data dir.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { FAILURE, MODE_STEP, PLACEHOLDER, STARTERS, spendLine, savingsCount } from "../web/simple-ui.js";
import { FIELDS } from "../server/prompts/profile.js";
import { shouldAnnounceReport } from "../server/plugins/reports.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";

test("Simple copy, starters, spend line, and failed-run savings", () => {
  assert.equal(MODE_STEP.title, "Which mode do you want to start in?");
  assert.match(MODE_STEP.simpleLine, /One chat box/);
  assert.match(MODE_STEP.expertLine, /Every menu/);
  assert.equal(PLACEHOLDER, "Ask anything. Meldmind picks the best AI for you.");
  assert.deepEqual(STARTERS.map((s) => s.label), ["Reply to a customer", "Fix my email", "Write a post", "Plan my week", "Explain this"]);
  assert.equal(FAILURE.title, "That AI is busy. Nothing was charged.");
  assert.equal(spendLine(0), "Free so far");
  assert.equal(spendLine(0.03), "This month: 3 cents");
  assert.equal(spendLine(0.01), "This month: 1 cent");
  assert.equal(spendLine(1.2), "This month: $1.20");
  assert.equal(savingsCount("failed", 4), 0);
  assert.equal(savingsCount("aborted", 4), 0);
  assert.equal(savingsCount("done", 4), 4);
  assert.equal(shouldAnnounceReport("run now", false), true);
  assert.equal(shouldAnnounceReport("Monday 07:00", false), false);
  assert.equal(shouldAnnounceReport("Monday 07:00", true), true);
  const keys = ["businessName", "offer", "customer", "profession", "directness", "length", "pushback", "jargon", "toneNotes", "voiceSample", "wordsIUse", "wordsIAvoid", "sentenceStyle"];
  for (const key of keys) assert.equal(FIELDS.find((f) => f.key === key).required, false, key);
  assert.ok(FIELDS.every((f) => f.required === false));
  for (const file of ["web/simple-ui.js", "web/compare.js", "web/app.js", "web/features/growth.js", "docs/billing.md"]) {
    assert.equal(read(...file.split("/")).includes(EM), false, file);
  }
});

test("the shell asks for a mode inside setup, hides the old popup, and prompts on Pro", () => {
  const app = read("web", "app.js");
  // 0.4.17: the mode choice is one row on the welcome screen.
  assert.match(app, /function renderWelcome/);
  assert.match(app, /data-ui-pick="simple"/);
  assert.match(app, /history: false/);
  assert.match(read("web", "simple-ui.js"), /tryIt: "Try it now"/);
  assert.match(app, /Turn on demo mode/);
  assert.match(app, /data-simple-mic/);
  assert.match(app, /cc-upgrade/);
  assert.match(app, /function showUpgrade/);
  assert.match(read("web", "nav.js"), /id: "settings", label: "Settings", direct: true/);
  assert.match(app, /S\.view = "settings"/);
  assert.match(app, /expertConfirmed/);
  assert.match(app, /Not connected\. A free allowance needs your own AI Studio key\./);
  assert.match(read("web", "failure-cause.js"), /id="cc-fail"/, "the failure card moved to failure-cause.js (0.4.20)");
  assert.match(app, /failureHtml\(\{/);
  assert.doesNotMatch(app, /function renderAsk\(\) \{\s*let box/);
  const tour = read("web", "features", "tour.js");
  const invite = tour.slice(tour.indexOf("function maybeInvite"), tour.indexOf("function showNews"));
  const news = invite.indexOf("showNews()");
  // The tour is a quiet link offered once, after a few answers (0.4.17).
  const answered = invite.indexOf("answeredEnough()");
  const create = invite.indexOf('className = "cc-tour-invite quiet"');
  assert.ok(news !== -1 && answered !== -1 && create !== -1 && news < answered && answered < create);
});

test("an unkeyed Google card is grey, and a failed run does not count as savings", async () => {
  const s = await startServer({
    env: { GEMINI_API_KEY: "" },
    seed(dir) {
      fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
      const now = Date.now();
      fs.writeFileSync(path.join(dir, "missions", "m-fail.json"), JSON.stringify({ id: "m-fail", kind: "single", status: "failed", title: "nope", startedAt: now }));
      fs.writeFileSync(path.join(dir, "missions", "m-ok.json"), JSON.stringify({ id: "m-ok", kind: "single", status: "done", title: "ok", startedAt: now }));
      const line = (id) => JSON.stringify({ ts: now, kind: "call", provider: "demo-nova", model: "nova-lite", inTok: 10, outTok: 10, cost: 0.01, missionId: id, savings: { actual: 0.01, baseline: 0.05, saved: 0.04 } });
      fs.writeFileSync(path.join(dir, "ledger.jsonl"), `${line("m-fail")}\n${line("m-ok")}\n`);
    },
  });
  try {
    const st = await s.api("/state");
    const g = st.json.providers.find((p) => p.id === "google");
    assert.ok(g, "google provider");
    assert.equal(g.name, "Google Gemini");
    assert.equal(g.keyed, false);
    assert.equal(g.status.status, "grey");
    assert.equal(g.status.detail, "no key");
    const totals = await s.api("/receipt/totals");
    assert.equal(totals.status, 200);
    assert.ok(Math.abs(totals.json.allTime.saved - 0.04) < 1e-6, `saved ${totals.json.allTime.saved}`);
  } finally { await s.stop(); }
});
