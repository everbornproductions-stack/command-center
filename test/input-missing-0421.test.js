// 0.4.21 dogfood 08: a step whose earlier step failed or came back empty is not run on "(missing)" input
// (that redid the earlier work and billed it twice). It stops with "Input missing" and the card says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { missingInputs, inputMissingLine } from "../server/step-guard.js";

const read = (...p) => fs.readFileSync(path.resolve(import.meta.dirname, "..", ...p), "utf8");

test("an earlier step that failed or came back empty is missing; one still waiting on an agent or media is not", () => {
  const tasks = [
    { id: "t1", title: "Sort the leads", status: "failed" },
    { id: "t2", title: "Write the texts", status: "done", output: "  " },
    { id: "t3", title: "Ask Grok Bot", status: "waiting" },
    { id: "t4", title: "Make the picture", status: "done", media: { kind: "image" } },
    { id: "t5", title: "Plan", status: "done", output: "a plan" },
  ];
  const step = { id: "t6", title: "Make the files", deps: ["t1", "t2", "t3", "t4", "t5"] };
  assert.deepEqual(missingInputs(step, tasks, { t5: "a plan" }).map((m) => m.id), ["t1", "t2"]);
  assert.deepEqual(missingInputs({ id: "x", deps: ["t5"] }, tasks, { t5: "a plan" }), []);
  assert.deepEqual(missingInputs({ id: "x" }, tasks, {}), []);
  assert.deepEqual(missingInputs(null, tasks, {}), []);
});

test("the line names the missing step, says it was not run and nothing was charged, in plain words", () => {
  const line = inputMissingLine([{ id: "t2", title: "Write the texts" }]);
  assert.match(line, /^Input missing: "Write the texts" did not come back/);
  assert.match(line, /not run/);
  assert.match(line, /nothing was charged/);
  assert.doesNotMatch(line, /\u2014/, "no em dashes");
  assert.match(inputMissingLine([{ title: "A" }, { title: "B" }]), /"A" and "B".*those steps/);
});

test("the mission stops the step before it is sent, shares inputMissing on the task, and the step row shows a chip", () => {
  const m = read("server", "mission.js");
  const at = m.indexOf("const missingIn = missingInputs(t, mission.tasks, outputs)");
  assert.ok(at > 0, "the mission checks the inputs");
  assert.ok(at < m.indexOf('emit("agent.start", { agent, provider: t.provider, model: t.model, role: "work"'), "before the step is sent to an AI");
  assert.match(m, /inputMissing: t\.inputMissing \|\| null/);
  assert.match(read("web", "app.js"), /t\.inputMissing\?\.length \? `<span class="chip red"[^`]*>input missing<\/span>`/);
});

test("the whole-result thumbs down can say the content was good but the file is missing (dogfood 08)", () => {
  const r = read("web", "features", "ratings.js");
  assert.match(r, /\["file missing", "The content is good, the file is missing"\]/);
  const srv = read("server", "plugins", "ratings.js");
  assert.equal("file missing".replace(/[^\w -]/g, ""), "file missing", "the server keeps the reason as it is");
  assert.match(srv, /reason: String\(reason \|\| ""\)/);
});
