// AI employees (0.4.14). Pure checks: the 20 playbook employees carry their full scripts, the library
// has 20+ more across the asked-for kinds of work, no em or en dashes, suggestions pick the right one,
// a mission step goes to the best fit. Then the running server in a temp data dir with the demo AIs
// (local mock, no real key or URL): the team and library, add / remove / customize, a run, a Simple chat
// with an employee, a project's team, and a mission handed to employees. Web checks are source checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { PLAYBOOK } from "../server/employee-playbook.js";
import { LIBRARY } from "../server/employee-library.js";
import { CATEGORIES, allEmployees, blanksIn, crewFor, crewSystem, suggestEmployees, systemForEmployee } from "../server/employees.js";
import { employeeHintHtml, missionTeamHtml, projectTeamHtml } from "../web/employees-ui.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DASHES = /[–—]/;

async function waitRun(s, id, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = await s.api(`/missions/${id}`); if (r.status === 200 && /^(done|fail|abort|paused|error|stopped)/.test(String(r.json.status || ""))) return r.json; await sleep(200); }
  throw new Error(`run ${id} did not finish`);
}

test("playbook: all 20 roles are preset, each with its full script", () => {
  assert.equal(PLAYBOOK.length, 20);
  // every playbook section with a script (1 to 8, 10 to 20; section 2 has two scripts, section 9 none)
  assert.deepEqual([...new Set(PLAYBOOK.map((e) => e.section))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  const firstAndLast = {
    receptionist: ["You are [Name], the virtual receptionist for [Business]", "the tech gives a quote on site. Want me to set that up?\""],
    "speed-to-lead": ["Got your request about [service]. Quick question so I can help", "[Services, area, hours, approved offer, FAQ answers]"],
    reactivation: ["Should I close out your file, or is [service] still on your list?", "[Services, area, hours, approved offer, FAQ answers]"],
    sdr: ["You are a sales research assistant for [Business].", "Email | Confidence 1 to 5"],
    "support-agent": ["You are the support assistant for [Business].", "[Paste FAQs, policies, shipping/service details, hours, contact info]"],
    "executive-assistant": ["You are my executive assistant. Every weekday at 7am", "say so in the brief instead of skipping it."],
    "social-content": ["You are the content writer for [Business].", "No emojis unless my examples use them."],
    "review-responder": ["You write public replies to reviews for [Business] in [City].", "reply neutrally and flag it."],
    bookkeeper: ["You are my bookkeeping assistant.", "with any change over 25% called out"],
    "marketing-strategist": ["You are a fractional CMO for small service businesses.", "say so and give the realistic number."],
    "ad-manager": ["You are my paid ads manager for [Business].", "[e.g. no \"guaranteed results\"]."],
    "viral-video": ["You write short-form video scripts (TikTok, Reels, Shorts)", "Avoid platform-banned claims for my industry: [list]."],
    designer: ["You are my creative director.", "No real people's likeness, copyrighted characters, or other brands' logos."],
    "website-builder": ["Build a [number]-page website for [Business]", "Do not invent reviews, awards, or stats."],
    coder: ["[One paragraph: what this app does, who uses it, the stack", "ask one question instead of guessing."],
    "tax-prep": ["You help me get organized for my CPA.", "If numbers don't reconcile (P&L vs bank), flag it first."],
    seo: ["You are my SEO strategist for [Business] in [city/area].", "as an estimate unless it came from my data."],
    "email-marketer": ["You are my email marketer.", "my business address placeholder in each email."],
    "data-analyst": ["You are my data analyst. I'm not technical.", "say what data I'd need."],
    recruiter: ["You help me hire for [role] at [Business].", "flag what to verify."],
  };
  for (const e of PLAYBOOK) {
    const [first, last] = firstAndLast[e.id] || [];
    assert.ok(first, `checked: ${e.id}`);
    assert.ok(e.instructions.includes(first), `${e.id} starts its script`);
    assert.ok(e.instructions.trimEnd().endsWith(last), `${e.id} ends its script`);
    assert.ok(e.instructions.length > 600, `${e.id} carries the whole script`);
    assert.ok(e.oneLiner.length > 20 && e.oneLiner.length < 120, `${e.id} one-liner`);
    assert.ok(CATEGORIES.includes(e.category), `${e.id} category`);
    assert.ok(e.starters.length >= 2 && e.keywords.length >= 4 && e.kinds.length >= 1, `${e.id} starters, keywords, kinds`);
  }
  assert.match(PLAYBOOK.find((e) => e.id === "receptionist").instructions, /Never collect card numbers, Social Security numbers, or passwords\./);
  assert.match(PLAYBOOK.find((e) => e.id === "sdr").instructions, /mark the prospect "SKIP: no signal\."/);
  assert.match(PLAYBOOK.find((e) => e.id === "reactivation").instructions, /Day 7, SMS: polite last touch/);
});

test("library: 20+ more ready-made employees across the kinds of work people asked for", () => {
  assert.ok(LIBRARY.length >= 20, `${LIBRARY.length} library employees`);
  const cats = new Set(LIBRARY.map((e) => e.category));
  for (const c of ["Small business", "Content and creators", "Sales", "Front desk and support", "Operations", "Money", "Legal basics", "Research", "Coding and tech"]) assert.ok(cats.has(c), `library covers ${c}`);
  for (const e of LIBRARY) {
    assert.ok(CATEGORIES.includes(e.category), `${e.id} category`);
    assert.ok(e.oneLiner.length > 20 && e.oneLiner.length < 120, `${e.id} one-liner`);
    assert.ok(e.instructions.includes("# Role") && e.instructions.length > 250, `${e.id} script`);
    assert.ok(e.starters.length >= 2 && e.keywords.length >= 4, `${e.id} starters and keywords`);
  }
  const ids = allEmployees().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.match(LIBRARY.find((e) => e.id === "contract-explainer").instructions, /not a lawyer and this is not legal advice/);
});

test("no em or en dashes in anything a person reads", () => {
  for (const e of allEmployees()) for (const k of ["name", "oneLiner", "instructions", "category"]) assert.equal(DASHES.test(e[k]), false, `${e.id}.${k}`);
  for (const e of allEmployees()) for (const s of e.starters) assert.equal(DASHES.test(s), false, `${e.id} starter`);
  for (const rel of ["server/employees.js", "server/persona-panel.js", "server/plugins/personas.js", "web/features/personas.js", "web/employees-ui.js", "web/features/agents.js"]) assert.equal(DASHES.test(read(rel)), false, rel);
});

test("suggestions: the right employee for what the person typed", () => {
  const top = (t) => suggestEmployees(t)[0]?.id;
  assert.equal(top("Reply to this 1 star Google review from Tom"), "review-responder");
  assert.equal(top("write a reminder for an overdue invoice"), "invoice-reminder");
  assert.equal(top("Can you explain this contract before I sign it?"), "contract-explainer");
  assert.equal(top("Plan 5 instagram posts for next week"), "social-content");
  assert.equal(top("my youtube thumbnail and title ideas"), "youtube-packager");
  assert.equal(top("write a job post for a part-time cook"), "recruiter");
  assert.deepEqual(suggestEmployees("hi"), []);
  assert.deepEqual(suggestEmployees("what is the weather on mars"), []);
  assert.ok(suggestEmployees("social media posts and a newsletter and seo", { limit: 3 }).length <= 3);
  assert.deepEqual(blanksIn("Hi [Name] from [Business], [Name] again").sort(), ["Business", "Name"]);
});

test("missions: each step goes to the best fit, and runs with that employee's script", () => {
  const crew = ["social-content", "seo", "email-marketer"].map((id) => { const e = allEmployees().find((x) => x.id === id); return { id, name: e.name, keywords: e.keywords, instructions: e.instructions }; });
  assert.equal(crewFor(crew, { title: "Write the newsletter email sequence", instructions: "" }).id, "email-marketer");
  assert.equal(crewFor(crew, { title: "Keyword map for local search", instructions: "" }).id, "seo");
  assert.equal(crewFor(crew, { title: "Unrelated step", instructions: "" }, 4).id, crew[1].id, "no match: take turns");
  assert.equal(crewFor([], { title: "x" }), null);
  const sys = crewSystem(crew[0], "Launch the fall menu");
  assert.match(sys, /^You are the AI employee "Social media writer" on a team working toward this goal:\nLaunch the fall menu/);
  assert.match(sys, /Do only your task\. Output the deliverable itself in Markdown/);
  assert.match(systemForEmployee(allEmployees()[0]), /^You are the AI employee "Receptionist"\./);
});

test("web helpers: hint, mission picker and project team in plain words", () => {
  const sug = { id: "review-responder", name: "Review responder", oneLiner: "Writes warm replies." };
  assert.match(employeeHintHtml({ suggestion: sug, esc }), /Best helper for this: <b>Review responder<\/b>.*data-emp-pick="review-responder">Use Review responder/);
  assert.match(employeeHintHtml({ chosen: sug, esc }), /Working with <b>Review responder<\/b>.*Stop using Review responder/);
  assert.equal(employeeHintHtml({ esc }), "");
  const team = [{ id: "seo", name: "SEO strategist", oneLiner: "x" }, { id: "coder", name: "Coding partner", oneLiner: "y" }];
  const html = missionTeamHtml({ team, picked: ["seo"], suggested: [{ id: "coder", name: "Coding partner", oneLiner: "y" }, { id: "seo", name: "SEO strategist", oneLiner: "x" }], esc });
  assert.match(html, /Employees for this mission:.*<span class="chip">SEO strategist<\/span>/s);
  assert.match(html, /data-emp-suggest="coder" title="y">\+ Coding partner/);
  assert.doesNotMatch(html, /data-emp-suggest="seo"/, "a picked employee is not suggested again");
  assert.match(html, /<summary class="small">Choose employees<\/summary>/, "the full list stays tucked away");
  assert.match(missionTeamHtml({ team, picked: [], esc }), /none picked, the planner uses its own specialists/);
  const pt = projectTeamHtml({ data: { saved: false, team: [], suggested: [team[0]] }, all: team, esc });
  assert.match(pt, /Suggested for this project/);
  assert.match(pt, /data-team="seo" checked/);
  assert.match(pt, /<summary class="small">More employees<\/summary>.*data-team="coder" >/s);
});

test("surfaces: Agents tab, Command view, Simple chat, projects", () => {
  const agents = read("web", "features", "agents.js");
  assert.match(agents, /Your AI employees/);
  assert.match(agents, /\+ Add more employees/);
  assert.match(agents, /Find an employee \(for example: invoices, YouTube, contracts\)/);
  assert.match(agents, /data-emp-add=/);
  assert.match(agents, /mountMissionTeam\(/);
  const app = read("web", "app.js");
  assert.match(app, /<div id="cc-emp-hint" aria-live="polite"><\/div>/);
  assert.match(app, /wireEmployeeHint\(\{ box: \$\("#cc-emp-hint"\), input: \$\("#orders"\), state: S, api, esc, onPick: /);
  assert.match(app, /if \(simple && S\.employee\?\.id\) packBody\.employee = S\.employee\.id;/);
  assert.match(app, /employees: S\.missionEmployees\?\.length \? S\.missionEmployees : undefined/);
  assert.match(app, /<div class="panel" id="proj-team"><\/div>/);
  assert.match(app, /renderProjectTeam\(\$\("#proj-team"\), p,/);
  // Simple keeps its short widget list: the hint lives in the chat page itself
  assert.match(read("web", "mode.js"), /export const SIMPLE_COMMAND = new Set\(\["voice", "desk"\]\);/);
});

test("server: team, library, run, Simple chat, project team, and a mission handed to employees", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    assert.equal((await s.api("/agents/employees", { noToken: true })).status, 401, "session token required");
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    let ov = (await s.api("/agents")).json;
    assert.deepEqual(ov.agents, [], "presets are employees, not entries in My agents");
    assert.equal(ov.employees.team.length, 20, "the 20 playbook employees are ready out of the box");
    assert.ok(ov.employees.library.length >= 20);
    assert.ok(ov.employees.team.every((e) => e.source === "playbook" && e.onTeam && !("instructions" in e)), "lists leave the long script out");

    // add from the library with one click, take a preset off, put it back
    let r = await s.api("/agents/employees/contract-explainer/add", { method: "POST" });
    assert.equal(r.status, 200); assert.equal(r.json.onTeam, true);
    r = await s.api("/agents/employees/receptionist/remove", { method: "POST" });
    assert.equal(r.json.onTeam, false);
    ov = (await s.api("/agents/employees")).json;
    assert.equal(ov.team.length, 20);
    assert.ok(ov.team.some((e) => e.id === "contract-explainer"));
    assert.ok(ov.library.some((e) => e.id === "receptionist"), "a preset taken off waits in the library");
    assert.equal((await s.api("/agents/employees/receptionist/add", { method: "POST" })).json.onTeam, true);
    assert.equal((await s.api("/agents/employees/nobody/add", { method: "POST" })).status, 404);

    const full = (await s.api("/agents/employees/receptionist")).json;
    assert.match(full.instructions, /^# Identity\nYou are \[Name\], the virtual receptionist/);
    assert.ok(full.blanks.includes("Business"));

    // customize: an editable copy in My agents
    const copy = (await s.api("/agents/employees/review-responder/customize", { method: "POST" })).json;
    assert.equal(copy.name, "Review responder");
    assert.match(copy.instructions, /4 to 5 stars \(auto-post\)/);
    assert.equal((await s.api("/agents")).json.agents.length, 1);

    // run one
    assert.equal((await s.api("/agents/employees/seo/run", { method: "POST", body: { prompt: "" } })).status, 400);
    const runId = (await s.api("/agents/employees/review-responder/run", { method: "POST", body: { prompt: "Reply to a 5-star review from Maria about the cupcakes." } })).json.runId;
    let run = await waitRun(s, runId);
    assert.equal(run.status, "done", run.error);
    assert.match(JSON.stringify(run), /Working as your AI employee \*\*Review responder\*\*/);

    // Simple chat: the suggestion, then a chat that uses it
    const sug = (await s.api(`/agents/employees/suggest?text=${encodeURIComponent("help me answer a bad google review")}&limit=1`)).json.items;
    assert.equal(sug[0].id, "review-responder");
    const chat = (await s.api("/chat", { method: "POST", body: { prompt: "Answer this 2 star review kindly.", employee: "review-responder" } })).json;
    run = await waitRun(s, chat.runId);
    assert.equal(run.status, "done", run.error);
    assert.match(JSON.stringify(run), /Working as your AI employee \*\*Review responder\*\*/);
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "x", employee: "nobody" } })).status, 404);

    // a project's suggested team, saved
    const proj = (await s.api("/projects", { method: "POST", body: { name: "Bakery social and reviews", summary: "Instagram posts and Google review replies" } })).json;
    let team = (await s.api(`/agents/employees/project/${proj.id}`)).json;
    assert.equal(team.saved, false);
    assert.ok(team.suggested.length >= 3 && team.suggested.length <= 4);
    assert.ok(team.suggested.some((e) => e.id === "social-content"), "posts in the summary suggest the social media writer");
    team = (await s.api(`/agents/employees/project/${proj.id}`, { method: "POST", body: { ids: ["social-content", "review-responder", "blog-writer", "nobody"] } })).json;
    assert.equal(team.saved, true);
    assert.deepEqual(team.team.map((e) => e.id), ["social-content", "review-responder", "blog-writer"]);
    assert.ok((await s.api("/agents/employees")).json.team.some((e) => e.id === "blog-writer"), "a library pick joins the team");

    // a mission handed to employees: every planned step has one, and runs with its script
    const started = (await s.api("/mission", { method: "POST", body: { goal: "Plan a week of Instagram posts and a newsletter email for the bakery.", mode: "economy", budgetUsd: 1, qa: false, background: true, employees: ["social-content", "email-marketer", copy.id] } })).json;
    assert.ok(started.id, JSON.stringify(started));
    const m = await waitRun(s, started.id, 120000);
    assert.equal(m.status, "done", m.error);
    assert.deepEqual(m.employees, ["social-content", "email-marketer", copy.id]);
    const steps = m.tasks.filter((t) => !t.agent && !t.media && !t.app);
    assert.ok(steps.length >= 3);
    assert.ok(steps.every((t) => t.employee?.name), "every step has an employee");
    assert.ok(m.log.some((l) => /^Team: /.test(l.text)), "the feed says who does what");
    assert.ok(steps.some((t) => /Working as your AI employee/.test(t.output)), "steps ran with an employee script");
  } finally { await s.stop(); }
});
