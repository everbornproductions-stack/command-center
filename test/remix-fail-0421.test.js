// 0.4.21 dogfood 09: a Remix build whose mission failed never says the game is saved on this computer and
// never offers the saved folder. One plain line says which AI failed and why, with Try again with another AI,
// and a plan step routed to an agent that is not set up never stops the mission with a raw program error.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { remixBuiltView, remixMissionFailed, RETRY_AI_LABEL } from "../web/next-actions.js";
import { stepAgentName, handToWorkingAI, unavailableNamed, scrubUnavailable } from "../server/plan-safe.js";

const read = (...p) => fs.readFileSync(path.resolve(import.meta.dirname, "..", ...p), "utf8");

const failedMission = () => ({
  id: "m-dogfood09",
  kind: "mission",
  projectId: "remix-abc123",
  status: "failed",
  error: "Nothing came back. Every step failed, so there is nothing to hand over.",
  tasks: [
    { id: "t1", title: "Write the page", status: "failed", provider: "groq", agentName: "Groq · code", error: "You exceeded your current quota, check billing" },
    { id: "t2", title: "Check the page", status: "failed", provider: "google", agentName: "Google Gemini · analysis", error: "Key rejected (401)" },
  ],
});

test("a failed build mission: one plain message, no saved claim, and Try again with another AI", () => {
  const view = remixBuiltView(failedMission(), { projectName: "Star Cat" });
  const text = `${view.message} ${view.action}`;
  assert.equal(view.failed, true, "the failed mission is seen as failed");
  assert.equal(view.action, RETRY_AI_LABEL);
  assert.match(text, /Try again with another AI/);
  assert.doesNotMatch(text, /saved/i, "nothing claims the game is saved");
  assert.match(view.message, /Groq/, "says which AI");
  assert.match(view.message, /exceeded your current quota/, "says the error from the task");
  assert.deepEqual(view.avoid, ["groq", "google"], "the AIs that failed are left out of the next build");
  // the plain line only, no folder button in it
  assert.doesNotMatch(view.message, /Open saved location/);
});

test("every task failed is a failure too, and a finished build still says it plainly", () => {
  assert.equal(remixMissionFailed({ status: "done", tasks: [{ status: "failed", error: "x" }, { status: "failed" }] }), true);
  assert.equal(remixMissionFailed({ status: "failed" }), true);
  assert.equal(remixMissionFailed({ status: "failed", tasks: { a: { status: "failed", error: "x" } } }), true);
  assert.equal(remixMissionFailed({ status: "running", tasks: [{ status: "done" }] }), false);
  assert.equal(remixMissionFailed(null), false);
  assert.equal(remixMissionFailed(undefined), false);
  const ok = remixBuiltView(null, { projectName: "Star Cat" });
  assert.equal(ok.failed, false);
  assert.equal(ok.action, "");
  assert.match(ok.message, /Star Cat is saved on this computer/);
});

test("a plan step routed to an agent that is not set up never throws and goes to a working AI", () => {
  const plan = {
    tasks: [
      { id: "t1", title: "Read the pages", capability: "research", provider: "antigravity-not-set-up", instructions: "Ask Antigravity to read the pages" },
      { id: "t2", title: "Draft", capability: "writing", agent: "Antigravity" },
    ],
  };
  // the plan still names the agent: that is found, cleaned up, and never throws
  const hits = unavailableNamed(plan, { goal: "write a page", readyIds: new Set(["groq"]) });
  assert.deepEqual(hits.map((h) => h.id), ["antigravity"]);
  assert.doesNotThrow(() => scrubUnavailable(plan, hits));
  assert.doesNotThrow(() => unavailableNamed(plan, { goal: "write a page", readyIds: new Set() }));
  // the engine's own step: an id the registry does not know has no name, so it is handed to a working AI
  assert.equal(stepAgentName("antigravity-not-set-up"), "");
  assert.equal(stepAgentName("some-agent-that-went-away"), "");
  assert.equal(stepAgentName(""), "");
  assert.equal(stepAgentName(undefined), "");
  assert.notEqual(stepAgentName("groq"), "", "a working AI does have a name");
  const step = { ...plan.tasks[0] };
  assert.doesNotThrow(() => handToWorkingAI(step, []));
  const fix = handToWorkingAI(step, [{ provider: "groq", model: "groq/llama", providerName: "Groq" }]);
  assert.equal(fix.provider, "groq");
  assert.match(fix.agentName, /Groq/);
  const lazy = handToWorkingAI(step, () => [{ provider: "groq", model: "groq/llama", providerName: "Groq" }]);
  assert.equal(lazy.provider, "groq", "the working AIs may be looked up only when they are needed");
  assert.equal(handToWorkingAI(step, []), null, "no working AI: the step keeps its own message instead of crashing");
  assert.equal(handToWorkingAI({ ...step, provider: "openai" }, []), null, "a working AI is left alone");
  assert.equal(handToWorkingAI({ ...step, agent: true }, [{ provider: "groq" }]), null, "an agent step runs on its own path");
  assert.equal(handToWorkingAI({ ...step, app: true }, [{ provider: "groq" }]), null, "an app step runs on its own path");
  assert.equal(handToWorkingAI(null, [{ provider: "groq" }]), null);
});

test("source: the mission never reads a provider name straight off the registry, and Build can leave an AI out", () => {
  const mission = read("server", "mission.js");
  assert.doesNotMatch(mission, /PROVIDERS\[[^\]]*\]\.name/, "every name goes through stepAgentName");
  assert.match(mission, /stepAgentName\(/);
  assert.match(mission, /handToWorkingAI\(/);
  const plugin = read("server", "plugins", "remix.js");
  assert.match(plugin, /avoidProviders/, "the body may name the AIs to leave out");
  assert.match(plugin, /skip: avoidProviders/, "the list goes to the mission router");
  const ui = read("web", "features", "remix.js");
  assert.match(ui, /id="remix-retry"/);
  assert.match(ui, /remixBuiltView/);
  assert.match(ui, /remixMissionFailed/);
  assert.match(ui, /avoidProviders/);
  assert.match(ui, /showBuildFailure/);
});
