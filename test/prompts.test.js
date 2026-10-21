// Pro prompts: the pack, the halt, the profile, safety, intent, and the routes.
// Temp data dir only. Demo mode for the one chat that must be stored. No real key or URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";
import { CATEGORIES, NOTE, TEMPLATES, getTemplate, SCHEDULED_IDS } from "../server/prompts/catalog.js";
import { renderTemplate } from "../server/prompts/render.js";
import { detectIntent, heuristicMatch } from "../server/prompts/intent.js";
import { annotateOutput } from "../server/prompts/safety.js";
import { normalizeProfile } from "../server/prompts/profile.js";

const DIR = tmpDir("cc-prompts-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const B = await import("../server/brain.js");
const { expandJob } = await import("../server/prompts/apply.js");

const NEED = ["smart-profession", "analyze-improve", "plan-with-me", "automate-week", "build-it-right", "learn-fast", "fix-sop", "recording-to-sop", "spec-it-out", "brain-dump-brief", "agent-team", "pre-mortem", "what-went-wrong", "vacation-test", "feature-cleanup", "chief-of-staff", "friday-checkin", "daily-sundown", "buy-back-time", "cfo-cost-cutter", "ai-leverage", "pricing-tiers", "ad-funnel", "reply-lead", "speed-to-lead", "discovery-call", "head-off-objections", "revive-quiet", "first-outreach", "save-client", "stalled-client", "best-worst-clients", "first-hour-win", "graceful-goodbye", "turn-into-content", "slice-platforms", "content-angles", "contrarian-hooks", "customer-words-ads", "reel-scripts", "job-scorecard", "interview-questions", "hiring-test", "first-5-days", "one-on-one", "quarterly-review", "turnaround-30", "exit-interview", "friday-coach", "tough-love", "talk-to-me", "business-profile", "master-voice"];

test("the pack lists every template in ROLE / CONTEXT / COMMAND / FORMAT", () => {
  assert.equal(NOTE, "Pre-built pro prompts, written by our team, so you get expert-level results without being a prompt expert.");
  assert.equal(CATEGORIES.length, 6);
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of NEED) assert.ok(getTemplate(id), id);
  for (const t of TEMPLATES) {
    assert.ok(CATEGORIES.includes(t.category), t.id);
    for (const key of ["role", "context", "command", "format", "output"]) assert.ok(String(t[key] || "").trim(), `${t.id} ${key}`);
  }
  assert.deepEqual(SCHEDULED_IDS.sort(), ["chief-of-staff", "daily-sundown", "friday-checkin", "friday-coach"]);
  const src = fs.readFileSync(new URL("../server/prompts/catalog.js", import.meta.url), "utf8")
    + fs.readFileSync(new URL("../web/features/prompts.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\u2014/);
});

test("a missing fact halts, a profile fills the gap, and secrets never enter the prompt", () => {
  const halted = renderTemplate("buy-back-time", {}, {});
  assert.equal(halted.halted, true);
  assert.ok(halted.questions.length);
  const filled = renderTemplate("analyze-improve", {}, normalizeProfile({ businessName: "North", offer: "audits", customer: "shops" }));
  assert.equal(filled.halted, true, "piece and goal are still required");
  const profile = normalizeProfile({
    businessName: "North", offer: "audits", customer: "shops", directness: "blunt", voiceSample: "We ship on Tuesday.", scf: true,
  });
  const run = renderTemplate("analyze-improve", { piece: "Client SSN 123-45-6789 account number 123456789012", goal: "shorter" }, profile);
  assert.equal(run.halted, false);
  assert.match(run.prompt, /ROLE:/);
  assert.match(run.prompt, /CONTEXT:/);
  assert.match(run.prompt, /COMMAND:/);
  assert.match(run.prompt, /FORMAT:/);
  assert.match(run.prompt, /HOW TO TALK TO ME/);
  assert.match(run.prompt, /blunt/);
  assert.match(run.prompt, /We ship on Tuesday/);
  assert.match(run.prompt, /\[CROA\]/);
  assert.match(run.prompt, /DRAFT ONLY/);
  assert.doesNotMatch(run.prompt, /123-45-6789/);
  assert.doesNotMatch(run.prompt, /123456789012/);
  assert.match(renderTemplate("speed-to-lead", { inquiry: "Pat called about a review" }, {}).prompt, /\[CROA\]/);
});

test("intent auto-applies a clear phrase, ignores hello, and uses the router only when unsure", async () => {
  const buy = heuristicMatch("Please buy back my time this quarter", TEMPLATES);
  assert.equal(buy.id, "buy-back-time");
  assert.equal(buy.autoApply, true);
  const coach = heuristicMatch("Run friday coach on this week", TEMPLATES);
  assert.equal(coach.id, "friday-coach");
  assert.equal(coach.autoApply, true);
  const hello = heuristicMatch("hello", TEMPLATES);
  assert.equal(hello.autoApply, false);
  assert.equal(hello.suggest, false);
  const picked = await detectIntent("zzzzqqq no keywords here", TEMPLATES, { ask: async () => '{"id":"cfo-cost-cutter","why":"costs"}' });
  assert.equal(picked.id, "cfo-cost-cutter");
  assert.equal(picked.source, "router");
  assert.equal(picked.autoApply, false);
  assert.equal(picked.suggest, true);
  const bad = await detectIntent("zzzzqqq no keywords here", TEMPLATES, { ask: async () => '{"id":"not-a-template"}' });
  assert.equal(bad.id, null);
  const down = await detectIntent("zzzzqqq no keywords here", TEMPLATES, { ask: async () => { throw new Error("offline"); } });
  assert.equal(down.fallback, "unavailable");
});

test("answers flag invented numbers, CROA, RESPA, and drafts", () => {
  const text = annotateOutput("We gained 40 customers. A case study proved it. Dear Pat, your score will jump. Pay a referral fee.", "the notes had no figures", { scf: true });
  assert.match(text, /40 customers\. \[VERIFY\]/);
  assert.match(text, /case study proved it\. \[VERIFY\]/i);
  assert.match(text, /\[CROA\]/);
  assert.match(text, /\[RESPA REVIEW\]/);
  assert.match(text, /DRAFT ONLY/);
});

test("expandJob keeps the person's words and a removed chip is left alone", () => {
  assert.throws(
    () => expandJob({ prompt: "hi", promptPack: { templateId: "friday-coach", inputs: {} } }, "prompt"),
    (e) => e.status === 409 && e.code === "prompt_halt" && e.questions.length > 0,
  );
  const next = expandJob({
    prompt: "shipped the site",
    context: "MEMORY LINE about the brand",
    promptPack: { templateId: "friday-coach", inputs: { week: "shipped the site" } },
  }, "prompt");
  assert.match(next.prompt, /ROLE:/);
  assert.match(next.prompt, /USER ORDERS:\nshipped the site/);
  assert.match(next.prompt, /MEMORY LINE about the brand/);
  assert.match(next.system, /Friday coach|Friday Coach|friday/i);
  const goal = expandJob({ goal: "the week", context: "MEMORY LINE", promptPack: { templateId: "friday-coach", inputs: { week: "the week" } } }, "goal");
  assert.match(goal.goal, /USER ORDERS:\nthe week/);
  assert.match(goal.context, /MEMORY LINE/);
  assert.doesNotMatch(goal.goal, /MEMORY LINE/);
  const left = expandJob({ prompt: "hello zebra", promptPack: { removed: true, templateId: "friday-coach" } }, "prompt");
  assert.equal(left.prompt, "hello zebra");
  assert.equal(left.promptPackApplied, undefined);
});

test("the learning router stores the template id and counts, not the prompt", () => {
  B.resetBrain();
  assert.equal(B.brain().templates, undefined);
  const row = B.noteTemplate({ id: "friday-coach", action: "applied" });
  assert.equal(row.applied, 1);
  B.noteTemplate({ id: "friday-coach", action: "suggested" });
  const raw = fs.readFileSync(path.join(DIR, "brain.json"), "utf8");
  assert.match(raw, /friday-coach/);
  assert.doesNotMatch(raw, /ROLE:|USER ORDERS|shipped the site|123-45/);
  const keys = Object.keys(JSON.parse(raw));
  for (const k of keys) assert.ok(["v", "since", "settings", "jobs", "stats", "runs", "resetAt", "templates"].includes(k), k);
  const ex = B.exportBrain();
  assert.equal(ex.templates["friday-coach"].applied, 1);
  assert.equal(ex.templates["friday-coach"].suggested, 1);
  B.resetBrain();
  assert.equal(B.exportBrain().templates, undefined);
});

test("routes: list, halt, redact, chat, schedules, team, pipelines, saved prompt", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const list = await s.api("/prompts");
    assert.equal(list.status, 200);
    assert.equal(list.json.note, NOTE);
    assert.ok(list.json.templates.length >= NEED.length);
    assert.equal(list.json.integrations.schedules, true);
    assert.equal(list.json.integrations.kling, true);

    const detect = await s.api("/prompts/detect", { method: "POST", body: { text: "buy back my time", llm: false } });
    assert.equal(detect.json.match.id, "buy-back-time");
    assert.equal(detect.json.match.autoApply, true);
    const none = await s.api("/prompts/detect", { method: "POST", body: { text: "hello", llm: false } });
    assert.equal(none.json.match.autoApply, false);

    const halt = await s.api("/prompts/render", { method: "POST", body: { id: "friday-coach", inputs: {} } });
    assert.equal(halt.status, 409);
    assert.equal(halt.json.code, "prompt_halt");
    assert.ok(halt.json.questions.length);

    const saved = await s.api("/prompts/profile", { method: "POST", body: { businessName: "North", offer: "SSN 123-45-6789", customer: "date of birth: 01/02/1990", toneNotes: "account number: 998877665544" } });
    assert.equal(saved.status, 200);
    assert.doesNotMatch(saved.json.profile.offer, /123-45-6789/);
    const onDisk = fs.readFileSync(path.join(s.dir, "prompts.profile.json"), "utf8");
    assert.doesNotMatch(onDisk, /123-45-6789/);
    assert.doesNotMatch(onDisk, /01\/02\/1990/);

    const blocked = await s.api("/chat", { method: "POST", body: { prompt: "go", promptPack: { templateId: "friday-coach", inputs: {} } } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, "prompt_halt");

    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const started = await s.api("/chat", { method: "POST", body: { prompt: "shipped the site", context: "MEMORY LINE", promptPack: { templateId: "friday-coach", inputs: { week: "shipped the site" } } } });
    assert.equal(started.status, 202);
    let full = null;
    for (let i = 0; i < 40 && !full; i++) {
      const rows = (await s.api("/missions")).json || [];
      const row = rows.find((m) => m.kind === "single");
      if (row) {
        const got = await s.api(`/missions/${row.id}`);
        if (got.json?.prompt && /ROLE:/.test(got.json.prompt)) full = got.json;
      }
      if (!full) await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(full, "the packed chat was stored");
    assert.match(full.prompt, /USER ORDERS:\nshipped the site/);
    assert.match(full.prompt, /MEMORY LINE/);
    assert.doesNotMatch(full.prompt, /123-45-6789/);

    const plain = await s.api("/chat", { method: "POST", body: { prompt: "hello zebra prompt", promptPack: { removed: true, templateId: "friday-coach" } } });
    assert.equal(plain.status, 202);
    let raw = null;
    for (let i = 0; i < 40 && !raw; i++) {
      const rows = (await s.api("/missions")).json || [];
      for (const row of rows) {
        const got = await s.api(`/missions/${row.id}`);
        if (got.json?.prompt === "hello zebra prompt") raw = got.json;
      }
      if (!raw) await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(raw, "a removed chip does not rewrite the prompt");
    assert.doesNotMatch(raw.prompt, /ROLE:/);

    const sched = await s.api("/prompts/schedules", { method: "POST", body: {} });
    assert.equal(sched.status, 200);
    assert.equal(sched.json.installed.length, 4);
    assert.ok(sched.json.installed.every((row) => row.status === "paused"));
    const listed = await s.api("/schedules");
    const mine = (listed.json.schedules || listed.json.items || []).filter((row) => SCHEDULED_IDS.map((id) => getTemplate(id).name).includes(row.name));
    assert.equal(mine.length, 4);
    assert.ok(mine.every((row) => row.enabled === false));

    const team = await s.api("/prompts/team", { method: "POST", body: {} });
    assert.equal(team.status, 200);
    assert.equal(team.json.agents.length, 3);
    assert.equal(team.json.pipeline.id, "pp-agent-team");
    const agents = await s.api("/agents");
    assert.equal(agents.json.agents.filter((a) => team.json.agents.some((t) => t.name === a.name)).length, 3);

    const pipes = await s.api("/prompts/pipelines", { method: "POST", body: { id: "ai-leverage" } });
    assert.equal(pipes.status, 200);
    assert.deepEqual(pipes.json.pipelines.map((p) => p.id).sort(), ["pp-leverage-capture", "pp-leverage-report"]);
    const all = await s.api("/pipelines");
    assert.ok(all.json.some((p) => p.id === "pp-agent-team"));

    const prompt = await s.api("/prompts/save", { method: "POST", body: { name: "From the chat", text: "Use {{topic}} next time." } });
    assert.equal(prompt.status, 200);
    const again = await s.api("/prompts/saved");
    assert.ok(again.json.items.some((p) => p.name === "From the chat"));

    const brain = fs.readFileSync(path.join(s.dir, "brain.json"), "utf8");
    assert.match(brain, /buy-back-time|friday-coach/);
    assert.doesNotMatch(brain, /shipped the site|hello zebra|123-45-6789|MEMORY LINE/);
  } finally { await s.stop(); }
});
