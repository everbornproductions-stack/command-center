// Dogfood 11, item P-agent: one place to create a custom agent (name, job, when it runs, a monthly spend
// limit and the "Never send or post" switch), a real noSend setting with a run-time tool filter, and a
// Schedules Agent select that offers to create an agent instead of a dead option.
// The checks here are on the page sources (normalised for a Windows checkout) and on the local routes the
// box posts to. The server comes from test/helpers.js: temp data folder, stub addresses, no real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

test("the create box sits at the top of the Agents page with every field, not behind a details fold", () => {
  const src = read("web/features/agents.js");
  const box = src.slice(src.indexOf("function createBox"), src.indexOf("function wireCreate"));
  assert.ok(box.includes("Create your own agent"), "the box has its heading");
  assert.match(src, /\$\{createBox\(\)\}\$\{employeesPanel\(\)\}/, "the box renders first, above the page body");
  for (const id of ["ac-name", "ac-job", "ac-when", "ac-cap", "ac-nosend"]) assert.ok(box.includes(`id="${id}"`), `field ${id} is in the box`);
  assert.equal(box.includes("<details"), false, "nothing is folded away");
  assert.equal(/More options|Pro only|Upgrade/.test(box), false, "no More options fold and no Pro popup");
  assert.match(box, /id="ac-nosend" checked/, "Never send or post is checked by default");
  assert.match(box, /Never send or post/);
  assert.match(box, /value="1"/, "the spend limit starts at $1");
});

test("Create posts the agent to the existing route and, when days are picked, a schedule with that agent and the cap", () => {
  const src = read("web/features/agents.js");
  const wire = src.slice(src.indexOf("function wireCreate"), src.indexOf("// ---------- the tab"));
  assert.match(wire, /api\("\/agents", \{ method: "POST", body: \{ name, instructions: job/, "the agent route");
  assert.match(wire, /noSend: q\("#ac-nosend"\)\.checked/, "the switch goes with the agent");
  assert.match(wire, /api\("\/schedules", \{ method: "POST"/, "a schedule is created too");
  assert.match(wire, /kind: "agent", agentId: made\.id/, "the schedule runs that agent");
  assert.match(wire, /capUsd: cap/, "the schedule cap is the monthly spend limit");
  assert.match(wire, /Created \$\{made\.name\}\. It is in My agents/, "it says what was made and where it appears");
  // the when block reuses the Schedules form's day buttons and time box
  assert.match(src, /import \{ DAYS, whenHtml, readWhen, wireWhen \} from "\.\/schedules\.js"/, "shared day and time logic, not a second copy");
  const sched = read("web/features/schedules.js");
  assert.match(sched, /export const DAYS/, "the schedule form's helpers are exported for reuse");
  assert.match(sched, /export function whenHtml/, "the day buttons come from the schedule form");
  assert.match(sched, /export function readWhen/, "the cron is read the same way");
  assert.match(sched, /export function wireWhen/, "one wiring for both forms");
});

test("the schedule route accepts what the box posts: target kind agent, that agent id, the cap", { timeout: 120000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    const made = await s.api("/agents", { method: "POST", body: { name: "Nightly report", instructions: "Write the nightly report." } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const body = {
      name: `${made.json.name} schedule`,
      target: { kind: "agent", agentId: made.json.id, text: "" },
      trigger: { type: "cron", cron: "0 9 * * 1,3,5" },
      capUsd: 1,
      after: { action: "none" },
    };
    const sch = await s.api("/schedules", { method: "POST", body });
    assert.equal(sch.status, 200, JSON.stringify(sch.json));
    assert.equal(sch.json.schedule.target.kind, "agent");
    assert.equal(sch.json.schedule.target.agentId, made.json.id);
    assert.equal(sch.json.schedule.capUsd, 1);
    const listed = (await s.api("/schedules")).json.items.find((x) => x.id === sch.json.schedule.id);
    assert.equal(listed.target.kind, "agent");
    assert.equal(listed.target.agentId, made.json.id);
    assert.equal(listed.capUsd, 1);
  } finally { await s.stop(); }
});
