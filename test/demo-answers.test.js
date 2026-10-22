// 0.4.17: practice answers in demo mode are short, task-shaped examples, still labeled
// "Practice answer from a pretend AI", offline and free. The three pretend AIs answer in
// different styles, so a practice council shows a real-looking disagreement.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PRACTICE_LABEL, kindOf, subjectOf, voiceOf, practiceAnswer, practiceVerdict, practiceDisagreement, requestOf } from "../server/demo-answers.js";
import { startServer, waitBudget } from "./helpers.js";

const ASKS = {
  post: "Write a Saturday post for my bakery",
  email: "Draft a follow-up email to a client about the kitchen remodel",
  plan: "Make a 4 week launch plan for my cleaning business",
  summary: "Summarize this\nThe meeting covered budgets. We agreed to hire one person. The launch moves to May.",
  code: "Write a python script to read a csv",
  list: "Give me 5 content ideas for my gym",
  answer: "Should I raise my prices?",
};

test("each kind of request gets an answer shaped like it", () => {
  for (const [kind, ask] of Object.entries(ASKS)) assert.equal(kindOf(requestOf(ask)), kind, ask);
  assert.equal(subjectOf("Write a Saturday post for my bakery"), "bakery");
  assert.equal(subjectOf("Hello there"), "");
  assert.equal(subjectOf("Write a short Instagram post for our Saturday bakery special"), "bakery special", "the day is not repeated in the subject");
  assert.match(practiceAnswer(ASKS.post, "nova-ultra"), /Saturday at the bakery/);
  assert.match(practiceAnswer(ASKS.post, "atlas-pro"), /Option A[\s\S]*Option B/);
  assert.match(practiceAnswer(ASKS.email, "nova-ultra"), /\*\*Subject:\*\*[\s\S]*Hi \[Name\]/);
  assert.match(practiceAnswer(ASKS.plan, "atlas-pro"), /\| Week \| Focus \| Done when \|/);
  assert.match(practiceAnswer(ASKS.summary, "nova-ultra"), /We agreed to hire one person\./, "a summary uses the text it was given");
  assert.match(practiceAnswer(ASKS.code, "sage-mini"), /```python[\s\S]*def read_rows/);
  assert.match(practiceAnswer(ASKS.list, "nova-ultra"), /^1\. /m);
  assert.match(practiceAnswer(ASKS.answer, "sage-mini"), /Start small/);
});

test("every practice answer is labeled, short, plain, and the pretend AIs differ", () => {
  for (const ask of Object.values(ASKS)) {
    const texts = ["nova-ultra", "atlas-pro", "sage-mini"].map((m) => practiceAnswer(ask, m));
    assert.equal(new Set(texts).size, 3, `the three pretend AIs answer differently: ${ask}`);
    for (const t of texts) {
      assert.match(t, new RegExp(`${PRACTICE_LABEL} \\(`));
      assert.match(t, /Nothing was spent/);
      assert.doesNotMatch(t, /placeholder|lorem/i);
      assert.doesNotMatch(t, /[\u2013\u2014]/, "no em or en dashes");
      assert.ok(t.length < 1400, `short: ${t.length}`);
    }
  }
  assert.equal(voiceOf("nova-lite"), 0); assert.equal(voiceOf("atlas-pro"), 1); assert.equal(voiceOf("sage-mini"), 2);
  assert.match(practiceAnswer("Plan my week", "nova-ultra", ["*Speaking as your custom agent **X**.*"]), /^\*Speaking as your custom agent \*\*X\*\*\.\*/);
});

test("a practice council verdict names where the pretend AIs disagreed and who added what", () => {
  const user = "QUESTION:\nWrite a Saturday post for my bakery\n\nANSWERS:\n### Answer A (Nova (demo), peer score 7/10)\nx\n\n### Answer B (Atlas (demo))\ny\n\n### Answer C (Sage (demo), peer score 6.5/10)\nz";
  const v = practiceVerdict(user, "atlas-pro");
  assert.match(v, /\*\*Where the council disagreed\*\*\n- Nova \(demo\) wanted a warmer, longer caption; Sage \(demo\) wanted one short line\./);
  assert.match(v, /\*\*Credits\*\*\n- Answer A \(Nova \(demo\)\)/);
  assert.match(v, new RegExp(PRACTICE_LABEL));
  assert.notEqual(practiceDisagreement("QUESTION:\nWrite a post\n"), "none");
  assert.doesNotMatch(v, /[\u2013\u2014]/);
  const mock = fs.readFileSync(new URL("../server/mock.js", import.meta.url), "utf8");
  assert.doesNotMatch(mock, /placeholder content|demo note|first take/, "the old filler text is gone");
  assert.doesNotMatch(mock + fs.readFileSync(new URL("../server/demo-answers.js", import.meta.url), "utf8"), /\bfetch\s*\(/, "practice answers never call the network");
});

async function waitDone(s, pred, label) {
  const budget = waitBudget(90000);
  const t0 = Date.now();
  while (Date.now() - t0 < budget) {
    try {
      const hit = pred((await s.api("/state")).json);
      if (hit) return hit;
    } catch { /* a reset socket on a busy PC: poll again */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${label}\n${s.log.slice(-800)}`);
}

test("server: demo chat and council give labeled, task-shaped practice answers", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const chat = await s.api("/chat", { method: "POST", body: { prompt: ASKS.email } });
    assert.equal(chat.status, 202, chat.text);
    const id = chat.json.runId;
    const run = await waitDone(s, (st) => (st.missions || []).find((m) => m.id === id && ["done", "failed"].includes(m.status)), "demo chat");
    const full = (await s.api(`/missions/${run.id}`)).json;
    assert.equal(full.status, "done", full.error);
    assert.match(full.deliverable, /\*\*Subject:\*\*/);
    assert.match(full.deliverable, new RegExp(PRACTICE_LABEL));

    const before = new Set(((await s.api("/state")).json.missions || []).map((m) => m.id));
    const posted = await s.api("/council", { method: "POST", body: { prompt: ASKS.post } });
    assert.equal(posted.status, 202, posted.text);
    const c = await waitDone(s, (st) => (st.missions || []).find((m) => m.kind === "council" && !before.has(m.id) && ["done", "failed"].includes(m.status)), "demo council");
    const cf = (await s.api(`/missions/${c.id}`)).json;
    assert.equal(cf.status, "done", cf.error);
    assert.match(cf.verdict.text, /\*\*Where the council disagreed\*\*/);
    assert.match(cf.verdict.text, new RegExp(PRACTICE_LABEL));
    const texts = Object.values(cf.answers).map((a) => a.text).filter(Boolean);
    assert.ok(texts.length >= 2 && new Set(texts).size === texts.length, "the pretend AIs gave different answers");
    assert.ok(Object.values(cf.reviews || {}).some((r) => r.disagreement && r.disagreement !== "none"), "the reviewers name a difference");
  } finally { await s.stop(); }
});
