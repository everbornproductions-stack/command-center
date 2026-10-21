// Extra Pro prompts: the nine added templates load, halt, and keep their fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CATEGORIES, TEMPLATES, getTemplate } from "../server/prompts/catalog.js";
import { renderTemplate } from "../server/prompts/render.js";
import { heuristicMatch } from "../server/prompts/intent.js";

const GUARD = "no fabricated results, testimonials or income claims";

const PACK = [
  {
    id: "coaching-sbi",
    name: "Coaching conversation (SBI)",
    category: "People/hiring",
    fields: ["situation", "values"],
    role: "corporate leadership coach and industrial psychologist",
    phrase: "Run a coaching conversation (SBI) on this",
    need: ["opening script", "non-threatening", "Situation", "Behavior", "Impact", "discovery questions", "accountability pact", "next week"],
  },
  {
    id: "delegation-handoff",
    name: "Delegation hand-off plan",
    category: "Strategy/ops",
    fields: ["task", "process", "delegatee"],
    role: "systems engineer and operations documentation specialist",
    phrase: "Write a delegation hand-off plan",
    need: ["Week 1", "Week 2", "Week 3", "Week 4", "I do", "we do", "you do", "screen-recording", "30%", "quality audit", "sign-off", "KPI"],
  },
  {
    id: "dm-booked-call",
    name: "DM sequence to booked call",
    category: "Sales/clients",
    fields: ["platform", "trigger", "offer"],
    role: "inbound conversation closer and B2B sales psychologist",
    phrase: "Write a DM sequence to booked call",
    need: ["DM 1", "DM 2", "DM 3", "DM 4", "role question", "#1 problem", "peer example", "screen-share"],
    sales: true,
  },
  {
    id: "weekly-time-audit",
    name: "Weekly time audit",
    category: "Personal/coaching",
    fields: ["hourlyValue", "highValue", "taskLog"],
    role: "performance-driven executive coach",
    phrase: "Run a weekly time audit",
    need: ["hourly value", "energizing or draining", "automate, delegate, or eliminate", "deep-work"],
  },
  {
    id: "prelaunch-risk-audit",
    name: "Pre-launch risk audit",
    category: "Strategy/ops",
    fields: ["company", "project", "launchDate", "tools"],
    role: "operations and systems architect",
    phrase: "Do a pre-launch risk audit",
    need: ["bottleneck", "one sentence", "L/M/H", "manual fallback", "testing hours", "over-allocated", "go/no-go", "48 hours"],
  },
  {
    id: "thought-leadership-outline",
    name: "Thought leadership article outline",
    category: "Content",
    fields: ["reader", "lesson", "tone"],
    role: "B2B ghostwriter and positioning specialist",
    phrase: "Need a thought leadership article outline",
    need: ["3 headlines", "industry myth", "time or money", "framework", "4-step checklist", "comment a keyword"],
    sales: true,
  },
  {
    id: "win-back-lead",
    name: "Win back a lost lead",
    category: "Sales/clients",
    fields: ["offer", "declined", "brandVoice"],
    role: "B2B pipeline strategist",
    phrase: "Win back a lost lead from last quarter",
    need: ["Message 1", "3-sentence", "no pitch", "Message 2", "4 days", "solved", "priority this quarter"],
    sales: true,
  },
  {
    id: "personal-touch-handoff",
    name: "Hand off 'only I can do it' tasks",
    category: "Personal/coaching",
    fields: ["hourlyValue", "highValue", "personalTasks"],
    role: "executive efficiency coach",
    phrase: "Hand off 'only I can do it' tasks",
    need: ["hidden rule", "AI workflow", "style guide", "48 hours"],
  },
];

const FILLED = {
  "coaching-sbi": { situation: "Strong technical work, late to stand-up, dashboards stale.", values: "Ownership, clarity, respect." },
  "delegation-handoff": { task: "Weekly invoice export", process: "90 minutes in Sheets, then email.", delegatee: "Operations coordinator" },
  "dm-booked-call": { platform: "Instagram", trigger: "Comment KEYWORD", offer: "A pipeline review" },
  "weekly-time-audit": { hourlyValue: "80 dollars", highValue: "Sales calls and product design", taskLog: "Inbox, proposal, status meeting" },
  "prelaunch-risk-audit": { company: "North", project: "Checkout relaunch", launchDate: "June 2", tools: "Stripe, the app, email" },
  "thought-leadership-outline": { reader: "Ops leads at 20-person firms", lesson: "Map the hand-off before you hire.", tone: "Direct and practical" },
  "win-back-lead": { offer: "A pipeline review", declined: "Budget was frozen.", brandVoice: "Short, warm, no hype." },
  "personal-touch-handoff": { hourlyValue: "80 dollars", highValue: "Sales calls and product design", personalTasks: "Client welcome note, proposal polish" },
};

function body(row) {
  return `${row.role}\n${row.command}\n${row.format}\n${row.output}`;
}

test("the added templates load with their required fields", () => {
  assert.equal(PACK.length, 8);
  const ids = TEMPLATES.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const spec of PACK) {
    const row = getTemplate(spec.id);
    assert.ok(row, spec.id);
    assert.equal(row.name, spec.name);
    assert.ok(CATEGORIES.includes(row.category), spec.id);
    assert.equal(row.category, spec.category);
    assert.deepEqual(row.inputs.map((field) => field.key), spec.fields);
    for (const field of row.inputs) {
      assert.equal(field.required, true, `${spec.id} ${field.key}`);
      assert.ok(field.label.trim(), field.key);
      assert.match(row.context, new RegExp(`\\{\\{\\s*${field.key}\\s*\\}\\}`));
    }
    for (const key of ["role", "context", "command", "format", "output", "description"]) {
      assert.ok(String(row[key] || "").trim(), `${spec.id} ${key}`);
    }
    assert.match(row.role, new RegExp(spec.role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const text = body(row);
    for (const bit of spec.need) assert.ok(text.includes(bit), `${spec.id} missing ${bit}`);
    if (spec.sales) assert.ok(text.includes(GUARD), spec.id);
    else assert.equal(text.includes(GUARD), false, spec.id);
    const halted = renderTemplate(spec.id, {}, {});
    assert.equal(halted.halted, true, spec.id);
    assert.equal(halted.questions.length, spec.fields.length, spec.id);
    const run = renderTemplate(spec.id, FILLED[spec.id], {});
    assert.equal(run.halted, false, spec.id);
    assert.match(run.prompt, /ROLE:/);
    assert.match(run.prompt, /CONTEXT:/);
    assert.match(run.prompt, /COMMAND:/);
    assert.match(run.prompt, /FORMAT:/);
    const match = heuristicMatch(spec.phrase, TEMPLATES);
    assert.equal(match.id, spec.id, `${spec.phrase} -> ${match.id}`);
    assert.equal(match.autoApply, true, spec.phrase);
  }
});

test("the added pack does not use banned coach terms or an em dash", () => {
  const src = fs.readFileSync(new URL("../server/prompts/pack-more.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\u2014|\u2013/);
  assert.doesNotMatch(src, /Dan Martell|Buyback Rate|Genius Work|Deportation Protocol|Effective Hourly Rate|effective hourly rate|buyback rate/i);
  const prior = heuristicMatch("Use contrarian hooks", TEMPLATES);
  assert.equal(prior.id, "contrarian-hooks");
  assert.equal(prior.autoApply, true);
  const spec = heuristicMatch("Please spec it out", TEMPLATES);
  assert.equal(spec.id, "spec-it-out");
  assert.equal(spec.autoApply, true);
});
