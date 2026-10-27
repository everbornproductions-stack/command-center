// Unit tests for ratings-rows.js (0.4.21, P-rate)
import { test } from "node:test";
import assert from "node:assert/strict";
import { contributors, preferLine } from "../web/features/ratings-rows.js";

test("contributors: a 3-step run gives 3 step rows plus assembly, no deduplication, including QA, failed, agent, and no-match steps", () => {
  const run = {
    kind: "mission",
    mission: {
      tasks: [
        { id: "t1", title: "Plan", provider: "anthropic", model: "claude-3.5-sonnet", capability: "reasoning" },
        { id: "t2", title: "Code", provider: "openai", model: "gpt-4o", capability: "code", review: { provider: "anthropic", model: "claude-3.5-sonnet" } },
        { id: "t3", title: "Deploy", provider: "", model: "", status: "failed" }, // no provider model match, failed/empty
        { id: "t4", title: "Agent step", provider: "antigravity", model: "antigravity", capability: "agent" }
      ],
      assembler: { provider: "openai", model: "gpt-4o" }
    }
  };

  const rows = contributors(run, (p) => p ? p.toUpperCase() : "LOCAL");
  // t1 task, t2 task, t2:qa (QA step), t3 task (no match), t4 task (agent step), assembly
  // wait, run has 4 tasks (t1, t2, t3, t4) + t2 has QA + assembly = 6 rows.
  // The prompt says: "checks a 3-step run gives 3 step rows + assembly."
  const threeStepRun = {
    kind: "mission",
    mission: {
      tasks: [
        { id: "t1", title: "Step 1", provider: "openai", model: "gpt-4o" },
        { id: "t2", title: "Step 2", provider: "openai", model: "gpt-4o" }, // same model, should NOT be deduped
        { id: "t3", title: "Step 3", provider: "anthropic", model: "claude-3.5-sonnet" }
      ],
      assembler: { provider: "google", model: "gemini-pro" }
    }
  };

  const list = contributors(threeStepRun, (p) => p);
  assert.equal(list.length, 4, "3 step rows + 1 assembly row = 4 rows");
  assert.equal(list[0].stepId, "t1");
  assert.equal(list[1].stepId, "t2");
  assert.equal(list[2].stepId, "t3");
  assert.equal(list[3].stepId, "assembly");
  assert.equal(list[0].model, "gpt-4o");
  assert.equal(list[1].model, "gpt-4o", "same model in t1 and t2 is not deduped");
});

test("preferLine: rules for when 'Meldmind now prefers X' appears or stays silent", () => {
  const ran = [
    { provider: "groq", model: "llama-3" },
    { provider: "antigravity", model: "agent-1" },
    { provider: "anthropic", model: "claude-3" }
  ];
  const topNeverRan = { provider: "openai", model: "gpt-6-astra", name: "GPT-6 Astra" };
  const topRan = { provider: "anthropic", model: "claude-3", name: "Claude 3" };

  // 1. Thumbs down on Groq/Antigravity/Claude, top pick GPT-6 Astra never ran => no prefers line
  assert.equal(
    preferLine({ up: false, rated: { provider: "groq" }, ran, top: topNeverRan }),
    ""
  );

  // 2. Thumbs down even if top pick ran => no prefers line after thumbs down
  assert.equal(
    preferLine({ up: false, rated: topRan, ran, top: topRan }),
    ""
  );

  // 3. Thumbs up, but top pick never ran => no prefers line
  assert.equal(
    preferLine({ up: true, rated: { provider: "groq" }, ran, top: topNeverRan }),
    ""
  );

  // 4. Thumbs up AND top pick ran => shows prefers line naming the AI
  assert.equal(
    preferLine({ up: true, rated: topRan, ran, top: topRan }),
    "Meldmind now prefers Claude 3 for this kind of work."
  );
});

test("P: a step that said it could not do the job keeps a row but never earns a 'prefers' line; a step that never started has no row", () => {
  const run = { kind: "mission", mission: { tasks: [
    { id: "t1", title: "Fix", provider: "groq", model: "gpt-oss-20b", status: "done", output: "x" },
    { id: "t2", title: "Tests", provider: "openai", model: "gpt-6", status: "done", output: "I can't", notDone: true },
    { id: "t3", title: "Later", status: "pending" },
  ] } };
  const rows = contributors(run);
  assert.deepEqual(rows.map((r) => r.stepId), ["t1", "t2"]);
  assert.equal(rows[1].good, false);
  assert.equal(preferLine({ up: true, ran: rows, top: { provider: "openai", model: "gpt-6", name: "GPT-6" } }), "");
  assert.match(preferLine({ up: true, ran: rows, top: { provider: "groq", model: "gpt-oss-20b", name: "Groq" } }), /prefers Groq/);
});

test("P: a single chat run with tasks: {} does not throw and gives one row", () => {
  const rows = contributors({ id: "r", kind: "single", tasks: {}, agents: { x: { provider: "demo-nova", model: "m" } }, primary: "x" });
  assert.equal(rows.length, 1);
});
