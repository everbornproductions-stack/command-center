// Phase 29: live project view. Mocked mission events drive the step, the agent and the running
// cost. The link builder and the flow-map state are pure: no provider URL is fetched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WebSocket } from "ws";
import { startServer, tmpDir } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-live-");
process.env.CC_HQ_DIR = tmpDir("cc-live-hq-");
process.env.CC_STATUS_PAGES = "off";

const lv = await import("../server/liveview.js");
const {
  HISTORY_NOTE, createState, applyLiveEvent, buildLiveView, openIn, klingTaskUrl,
  makeFlow, presentFlow, pulseMoves, layoutNodes, formatUsd,
} = lv;
const { registerExternalAgent, unregisterExternalAgent } = await import("../server/external-agents.js");

const root = new URL("..", import.meta.url);

test("open in: usage dashboards and the Kling task page, never fetched, never the chat site", () => {
  const openai = openIn("openai");
  assert.equal(openai.label, "Open in OpenAI");
  assert.equal(openai.url, "https://platform.openai.com/usage");
  assert.equal(openai.watchHere, true);
  const anthropic = openIn("anthropic");
  assert.equal(anthropic.label, "Open in Anthropic");
  assert.equal(anthropic.url, "https://platform.claude.com/usage");
  assert.equal(anthropic.watchHere, true);
  const xai = openIn("xai");
  assert.equal(xai.label, "Open in xAI");
  assert.equal(xai.url, "https://console.x.ai/team/default/usage");
  assert.equal(xai.watchHere, true);
  for (const link of [openai, anthropic, xai]) {
    assert.equal(link instanceof Promise, false);
    for (const l of link.links) assert.doesNotMatch(l.url, /chatgpt\.com|claude\.ai|grok\.com/);
  }
  assert.equal(openIn("kling").url, null, "no task id, no Kling page");
  const kling = openIn("kling", { taskId: "task/42" });
  assert.equal(kling.label, "Open in Kling");
  assert.equal(kling.url, "https://app.klingai.com/global/video?task=task%2F42");
  const padded = klingTaskUrl(" https://evil.example ");
  assert.match(padded, /^https:\/\/app\.klingai\.com\/global\/video\?task=/);
  assert.doesNotMatch(padded, /^https:\/\/evil\.example/);
  assert.equal(klingTaskUrl("a b"), null);
  assert.equal(klingTaskUrl("a\nb"), null);
  assert.match(klingTaskUrl("ok_1"), /^https:\/\/app\.klingai\.com\/global\/video\?task=ok_1$/);
  assert.equal(openIn("grokbot").url, null);
  assert.equal(openIn("browser-helper").url, null);
  assert.equal(openIn("google").url, null);
  assert.equal(openIn("nope").url, null);
  assert.equal(formatUsd(0.02), "$0.02");
  assert.doesNotMatch(HISTORY_NOTE, /\u2014/);
  assert.match(HISTORY_NOTE, /claude\.ai, grok\.com or ChatGPT history/);
});

test("events drive the live view: step, agent, ledger cost, health, and no prompt text", () => {
  const state = createState();
  const secret = "sk-ant-SECRETVALUE";
  applyLiveEvent(state, { type: "mission.update", mission: {
    id: "m-1", kind: "mission", title: "Launch plan", projectId: "p1", status: "planning", cost: 9,
    prompt: `FULL PROMPT ${secret}`, deliverable: secret, tasks: [],
  } });
  applyLiveEvent(state, { type: "agent.start", agent: "m-1:planner", provider: "anthropic", model: "claude-sonnet-5-5", role: "plan", missionId: "m-1", label: "Claude planning" });
  const a = { kind: "call", provider: "anthropic", model: "claude-sonnet-5-5", missionId: "m-1", cost: 0.02, inTok: 10, outTok: 4 };
  applyLiveEvent(state, { type: "ledger.entry", entry: a });
  applyLiveEvent(state, { type: "task.update", missionId: "m-1", task: { id: "t1", title: "Draft the post", status: "running", provider: "openai", model: "gpt-6.1-sol", instructions: secret } });
  applyLiveEvent(state, { type: "agent.start", agent: "m-1:t1", provider: "openai", model: "gpt-6.1-sol", role: "work", missionId: "m-1", label: "GPT drafting" });
  const b = { kind: "call", provider: "openai", model: "gpt-6.1-sol", missionId: "m-1", cost: 0.03 };
  applyLiveEvent(state, { type: "agent.done", agent: "m-1:planner", provider: "anthropic", model: "claude-sonnet-5-5", missionId: "m-1", ms: 12 });
  const before = state.seq;
  assert.equal(applyLiveEvent(state, { type: "agent.delta", missionId: "m-1", text: secret }), null);
  assert.equal(state.seq, before, "deltas do not add animation pulses");

  const projects = [{ id: "p1", name: "Launch site", color: "#22d3ee" }, { id: "p2", name: "Empty", color: "#888" }];
  const view = buildLiveView({
    state, projects, missions: [], ledger: [a, b], jobs: [],
    health: { openai: { status: "amber", detail: "rate limited" }, anthropic: { status: "green", detail: "ok" } },
  });
  const project = view.projects.find((p) => p.id === "p1");
  const run = project.runs.find((r) => r.id === "m-1");
  assert.equal(run.step, "GPT drafting");
  assert.equal(run.working, true);
  assert.equal(run.cost, 0.05, "ledger wins over the stale mission cost");
  assert.equal(project.cost, 0.05);
  const gpt = run.workers.find((w) => w.provider === "openai");
  const claude = run.workers.find((w) => w.provider === "anthropic");
  assert.equal(gpt.active, true);
  assert.equal(gpt.name, "GPT");
  assert.equal(claude.active, false);
  assert.equal(gpt.health.status, "amber");
  assert.equal(run.watchHere, true);
  assert.ok(run.links.some((l) => l.label === "Open in OpenAI" && l.url === "https://platform.openai.com/usage"));
  assert.ok(run.links.some((l) => l.label === "Open in Anthropic"));
  const idle = view.projects.find((p) => p.id === "p2");
  assert.equal(idle.working, false);
  assert.equal(idle.step, "Idle");
  assert.equal(idle.cost, 0);
  const dumped = JSON.stringify(view);
  assert.equal(dumped.includes(secret), false);
  assert.equal(dumped.includes("FULL PROMPT"), false);
  assert.equal(view.note, HISTORY_NOTE);
});

test("flow map: nodes, edges, pulses, active highlight, tooltip, reduced motion", () => {
  const state = createState();
  applyLiveEvent(state, { type: "council.update", council: { id: "c-1", kind: "council", projectId: "p1", status: "running", cost: 0, prompt: "Which hook works", members: [{ provider: "anthropic", model: "claude-sonnet-5-5" }, { provider: "xai", model: "grok-4.7" }] } });
  let view = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
  let names = view.projects[0].flow.nodes.map((n) => n.name);
  assert.deepEqual(names, ["Router", "Claude", "Grok"]);
  assert.equal(view.projects[0].flow.pulses.length, 0, "convened, not yet sent");

  applyLiveEvent(state, { type: "agent.start", agent: "c-1:a", provider: "anthropic", model: "claude-sonnet-5-5", role: "answer", missionId: "c-1", label: "Claude answering" });
  applyLiveEvent(state, { type: "agent.msg", from: "anthropic", to: "grokbot", missionId: "c-1", text: "hand this to Grok Bot" });
  applyLiveEvent(state, { type: "agent.start", agent: "c-1:gb", provider: "grokbot", model: "grok-bot", role: "work", missionId: "c-1", label: "Grok Bot checking the inbox" });
  applyLiveEvent(state, { type: "agent.msg", from: "grokbot", to: "browser-helper", missionId: "c-1", text: "open the folder" });
  applyLiveEvent(state, { type: "agent.start", agent: "c-1:bh", provider: "browser-helper", role: "browse", missionId: "c-1", label: "Browser helper opening the page" });
  const entry = { kind: "call", provider: "anthropic", missionId: "c-1", cost: 0.02 };
  const flow = makeFlow(buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [entry], jobs: [], health: {} }).projects[0].runs, state, { ledger: [entry] });
  const byId = Object.fromEntries(flow.nodes.map((n) => [n.id, n]));
  assert.equal(byId.hub.name, "Router");
  assert.equal(byId.anthropic.active, true);
  assert.equal(byId.anthropic.spin, true);
  assert.equal(byId.grokbot.name, "Grok Bot");
  assert.equal(byId.grokbot.initials, "GB");
  assert.equal(byId["browser-helper"].name, "Browser helper");
  assert.equal(byId["browser-helper"].initials, "BH");
  assert.equal(byId.xai.presence, "ghost");
  assert.equal(byId.xai.active, false);
  assert.equal(byId.grokbot.presence, "live");
  assert.match(byId.anthropic.tip, /Claude answering/);
  assert.match(byId.anthropic.tip, /\$0\.02 so far/);
  assert.ok(flow.edges.some((e) => e.from === "hub" && e.to === "anthropic" && e.hot));
  assert.ok(flow.pulses.some((p) => p.from === "hub" && p.to === "anthropic" && p.animate === true));
  const handoff = flow.pulses.find((p) => p.from === "grokbot" && p.to === "browser-helper");
  assert.ok(handoff);
  assert.match(handoff.path, /^M/);
  assert.match(handoff.path, / Q/);
  assert.equal(pulseMoves(handoff, false), true);
  const laid = layoutNodes(flow.nodes.map((n) => n.id));
  assert.deepEqual(laid, layoutNodes(flow.nodes.map((n) => n.id)));
  assert.ok(byId.anthropic.y < byId.hub.y, "first agent sits above the router");

  const still = presentFlow(flow, { reducedMotion: true });
  assert.equal(still.reducedMotion, true);
  assert.equal(still.motion, "calm");
  assert.ok(still.nodes.some((n) => n.active), "the highlight stays");
  assert.ok(still.nodes.every((n) => n.spin === false));
  assert.ok(still.pulses.every((p) => p.animate === false));
  assert.equal(pulseMoves(still.pulses[0], true), false);
  assert.equal(pulseMoves(still.pulses[0], false), false, "animate false stops the dot even without the media query");
});

test("Kling job link, credits from the ledger, and a mission cost when the ledger is empty", () => {
  const jobs = [{ id: "mj-1", provider: "kling", kind: "video", projectId: "p1", status: "processing", taskId: "kt-9", estimate: { usd: 0.35, credits: 50 }, params: { prompt: "SECRET PROMPT", model: "kling-v2-5-turbo" }, createdAt: 1 }];
  let view = buildLiveView({ state: createState(), projects: [{ id: "p1", name: "Video", color: "#7CF5A0" }], missions: [], ledger: [], jobs, health: {} });
  const live = view.projects[0];
  assert.equal(live.working, true);
  assert.match(live.step, /Kling generating video/);
  assert.equal(live.runs[0].links[0].label, "Open in Kling");
  assert.match(live.runs[0].links[0].url, /task=kt-9/);
  assert.match(live.flow.nodes.find((n) => n.id === "kling").tip, /about \$0\.35 still running/);
  assert.equal(JSON.stringify(view).includes("SECRET PROMPT"), false);

  const credit = { kind: "credits", provider: "kling", units: 50, cost: 0.35, project: "p1" };
  jobs[0] = { ...jobs[0], status: "done" };
  view = buildLiveView({ state: createState(), projects: [{ id: "p1", name: "Video", color: "#7CF5A0" }], missions: [], ledger: [credit], jobs, health: {} });
  assert.equal(view.projects[0].credits, 50);
  assert.equal(view.projects[0].cost, 0.35);
  assert.match(view.projects[0].flow.nodes.find((n) => n.id === "kling").tip, /50 credits/);

  const disk = buildLiveView({
    state: createState(),
    projects: [{ id: "p1", name: "P", color: "#22d3ee" }],
    missions: [{ id: "m-9", kind: "mission", title: "Write the brief", projectId: "p1", status: "running", cost: 1.25, tasks: [{ id: "t1", title: "Write the brief", status: "running", provider: "google", model: "gemini-4-argon", agentName: "Gemini" }], deliverable: "SECRET PROMPT" }],
    ledger: [], jobs: [], health: {},
  });
  const run = disk.projects[0].runs[0];
  assert.equal(run.cost, 1.25);
  assert.equal(run.workers[0].active, true);
  assert.equal(run.workers[0].name, "Gemini");
  assert.match(disk.projects[0].flow.nodes.find((n) => n.id === "google").tip, /\$1\.25 so far/);
  assert.equal(JSON.stringify(disk).includes("SECRET PROMPT"), false);
});

test("external agents: sent, working, reported back, Open link, and a later adapter", () => {
  const state = createState();
  const secret = "sk-ant-SECRETVALUE";
  const sentAt = Date.parse("2026-10-19T05:12:00Z");
  assert.equal(applyLiveEvent(state, { type: "external.handoff", agent: "nope agent", jobId: "j", status: "sent", task: "x", projectId: "p1" }), null);
  assert.equal(applyLiveEvent(state, { type: "external.handoff", agent: "cursor-cloud", jobId: "bad id", status: "sent", task: "x", projectId: "p1" }), null);

  applyLiveEvent(state, {
    type: "external.handoff", agent: "cursor-cloud", jobId: "job-1", status: "queued", task: "Build the settings page",
    projectId: "p1", externalId: "bc-abc", sentAt, context: secret, token: secret, callback_url: secret,
  });
  applyLiveEvent(state, {
    type: "external.handoff", agent: "grok-bot", jobId: "job-2", status: "working", task: "Check the inbox",
    projectId: "p1", missionId: "m-ext", page: "https://hooks.example/job-2",
  });
  applyLiveEvent(state, {
    type: "external.handoff", agent: "browser", jobId: "job-3", status: "needs_approval", task: "Open the receipt",
    projectId: "p1", page: "http://insecure.example/nope",
  });
  let view = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
  const project = view.projects[0];
  const byId = Object.fromEntries(project.flow.nodes.map((n) => [n.id, n]));
  assert.equal(byId.cursor.name, "Cursor");
  assert.equal(byId.cursor.presence, "live");
  assert.equal(byId.cursor.handoff.status, "sent");
  assert.equal(byId.cursor.handoff.statusLabel, "Sent");
  assert.equal(byId.cursor.handoff.task, "Build the settings page");
  assert.equal(byId.cursor.handoff.sentLabel, "2026-10-19 05:12 UTC");
  assert.match(byId.cursor.tip, /Sent/);
  assert.match(byId.cursor.tip, /Build the settings page/);
  assert.match(byId.cursor.tip, /2026-10-19 05:12 UTC/);
  const cursorRun = project.runs.find((r) => r.handoffs?.some((h) => h.jobId === "job-1"));
  assert.equal(cursorRun.handoffs.find((h) => h.jobId === "job-1").link.url, "https://cursor.com/agents/bc-abc");
  assert.equal(cursorRun.handoffs.find((h) => h.jobId === "job-1").link.label, "Open");
  assert.equal(byId.grokbot.handoff.status, "working");
  assert.equal(byId.grokbot.presence, "live");
  assert.equal(project.runs.flatMap((r) => r.handoffs).find((h) => h.agent === "grokbot").link.url, "https://hooks.example/job-2");
  const browser = project.runs.flatMap((r) => r.handoffs).find((h) => h.agent === "browser-helper");
  assert.equal(browser.status, "working");
  assert.equal(browser.task, "Open the receipt");
  assert.equal(browser.link, null);
  assert.ok(project.flow.pulses.some((p) => p.from === "hub" && p.to === "cursor"));
  assert.equal(JSON.stringify(view).includes(secret), false);
  assert.equal(openIn("cursor").url, null);

  const before = state.pulses.length;
  applyLiveEvent(state, { type: "external.handoff", agent: "cursor", jobId: "job-1", status: "working", task: "Build the settings page", projectId: "p1", externalId: "bc-abc", sentAt });
  assert.ok(state.pulses.length > before, "moving to working sends another pulse");
  const held = state.pulses.length;
  applyLiveEvent(state, { type: "external.handoff", agent: "cursor", jobId: "job-1", status: "working", task: "Build the settings page", projectId: "p1" });
  assert.equal(state.pulses.length, held, "a repeat of the same status does not add a pulse");

  applyLiveEvent(state, { type: "external.handoff", agent: "cursor", jobId: "job-1", status: "done", task: "Build the settings page", projectId: "p1", externalId: "bc-abc", text: "Settings page is up" });
  applyLiveEvent(state, { type: "external.handoff", agent: "grokbot", jobId: "job-2", status: "failed", task: "Check the inbox", projectId: "p1", missionId: "m-ext", text: "The inbox needs a person" });
  view = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
  const flow = view.projects[0].flow;
  const cursor = flow.nodes.find((n) => n.id === "cursor");
  const bot = flow.nodes.find((n) => n.id === "grokbot");
  assert.ok(cursor, "a finished agent stays on the map");
  assert.equal(cursor.presence, "ghost");
  assert.equal(cursor.active, false);
  assert.equal(cursor.handoff.status, "reported");
  assert.equal(cursor.handoff.statusLabel, "Reported back");
  assert.equal(cursor.handoff.result, "Settings page is up");
  assert.match(cursor.tip, /Reported back/);
  assert.match(cursor.tip, /Settings page is up/);
  assert.equal(bot.handoff.status, "reported");
  assert.equal(bot.presence, "ghost");
  const failed = view.projects[0].runs.flatMap((r) => r.handoffs).find((h) => h.agent === "grokbot");
  assert.equal(failed.failed, true);
  assert.equal(failed.result, "The inbox needs a person");
  assert.ok(flow.pulses.some((p) => p.from === "cursor" && p.to === "hub"));

  registerExternalAgent({
    id: "lab-bot", name: "Lab bot", color: "#f472b6",
    open(h) { return { url: h.externalId === "bad" ? "javascript:alert(1)" : "https://lab.example/jobs/" + h.externalId }; },
  });
  try {
    applyLiveEvent(state, { type: "external.handoff", agent: "lab-bot", jobId: "job-9", status: "sent", task: "Watch the lab", projectId: "p1", externalId: "bad" });
    const lab = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
    const node = lab.projects[0].flow.nodes.find((n) => n.id === "lab-bot");
    assert.equal(node.name, "Lab bot");
    assert.equal(node.presence, "live");
    const row = lab.projects[0].runs.flatMap((r) => r.handoffs).find((h) => h.jobId === "job-9");
    assert.equal(row.link, null, "a javascript link is dropped");
    applyLiveEvent(state, { type: "external.handoff", agent: "field-bot", jobId: "job-8", status: "sent", task: "Note the field", projectId: "p1", name: "Field bot", page: "https://field.example/j" });
    const field = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
    const fieldNode = field.projects[0].flow.nodes.find((n) => n.id === "field-bot");
    assert.equal(fieldNode.name, "Field bot");
    assert.equal(field.projects[0].runs.flatMap((r) => r.handoffs).find((h) => h.jobId === "job-8").link.url, "https://field.example/j");
  } finally { unregisterExternalAgent("lab-bot"); }
});

test("Phase 12 and Phase 27 handoff events show Grok Bot and the browser helper", () => {
  const grok = fs.readFileSync(new URL("./server/grokbot.js", root), "utf8");
  const browser = fs.readFileSync(new URL("./server/browser.js", root), "utf8");
  assert.match(grok, /emit\("external\.handoff"/);
  assert.match(browser, /emit\("external\.handoff"/);
  const state = createState();
  const sentAt = Date.parse("2026-10-19T18:04:00Z");
  // Same fields server/grokbot.js and server/browser.js pass to emit.
  applyLiveEvent(state, {
    type: "external.handoff", agent: "grokbot", jobId: "gb-abc_12", status: "queued",
    task: "Check the inbox", result: "", sentAt: null, missionId: "c-9", projectId: "p1", failed: false,
  });
  applyLiveEvent(state, {
    type: "external.handoff", agent: "browser-helper", jobId: "bh-xyz_9", status: "working",
    task: "Open the receipt page", result: "", sentAt, missionId: "", projectId: "", failed: false,
  });
  let view = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
  const onProject = view.projects[0].flow.nodes.find((n) => n.id === "grokbot");
  assert.equal(onProject.name, "Grok Bot");
  assert.equal(onProject.presence, "live");
  assert.equal(onProject.handoff.status, "sent");
  assert.equal(onProject.handoff.task, "Check the inbox");
  const loose = view.unfiled.flow.nodes.find((n) => n.id === "browser-helper");
  assert.equal(loose.name, "Browser helper");
  assert.equal(loose.presence, "live");
  assert.equal(loose.handoff.status, "working");
  assert.equal(view.flow.nodes.some((n) => n.id === "grokbot" && n.presence === "live"), true);
  assert.equal(view.flow.nodes.some((n) => n.id === "browser-helper" && n.presence === "live"), true);
  applyLiveEvent(state, {
    type: "external.handoff", agent: "grokbot", jobId: "gb-abc_12", status: "done",
    task: "Check the inbox", result: "Three notes waiting", sentAt, missionId: "c-9", projectId: "p1", failed: false,
  });
  applyLiveEvent(state, {
    type: "external.handoff", agent: "browser-helper", jobId: "bh-xyz_9", status: "failed",
    task: "Open the receipt page", result: "The page did not load", sentAt, missionId: "", projectId: "", failed: true,
  });
  view = buildLiveView({ state, projects: [{ id: "p1", name: "P", color: "#22d3ee" }], missions: [], ledger: [], jobs: [], health: {} });
  const reported = view.projects[0].runs.flatMap((r) => r.handoffs).find((h) => h.jobId === "gb-abc_12");
  assert.equal(reported.status, "reported");
  assert.equal(reported.result, "Three notes waiting");
  assert.equal(reported.failed, false);
  const failed = view.unfiled.runs.flatMap((r) => r.handoffs).find((h) => h.jobId === "bh-xyz_9");
  assert.equal(failed.status, "reported");
  assert.equal(failed.failed, true);
  assert.equal(failed.result, "The page did not load");
  assert.equal(view.projects[0].flow.nodes.find((n) => n.id === "grokbot").presence, "ghost");
  assert.equal(view.unfiled.flow.nodes.find((n) => n.id === "browser-helper").presence, "ghost");
});

test("UI and server sources: no em-dash, no fetch of a provider page, reduced motion is honored", () => {
  const ui = fs.readFileSync(new URL("./web/features/liveview.js", root), "utf8");
  const server = fs.readFileSync(new URL("./server/liveview.js", root), "utf8");
  const plugin = fs.readFileSync(new URL("./server/plugins/liveview.js", root), "utf8");
  const agents = fs.readFileSync(new URL("./server/external-agents.js", root), "utf8");
  for (const src of [ui, server, plugin, agents]) assert.doesNotMatch(src, /\u2014/);
  assert.match(ui, /prefers-reduced-motion/);
  assert.match(ui, /lv-ghost/);
  assert.match(ui, /lv-stream/);
  assert.match(ui, /lv-pulse/);
  assert.match(ui, /claude\.ai/);
  assert.match(ui, /Open in /);
  assert.match(plugin, /external\.handoff/);
  assert.doesNotMatch(server, /\bfetch\s*\(/);
  assert.doesNotMatch(plugin, /\bfetch\s*\(/);
  assert.doesNotMatch(agents, /\bfetch\s*\(/);
  assert.doesNotMatch(ui, /klingai\.com|platform\.openai\.com|platform\.claude\.com|console\.x\.ai|cursor\.com/);
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function listen(s) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    const events = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error("websocket hello timed out")); }, 8000);
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
    ws.on("message", (buf) => {
      const ev = JSON.parse(String(buf));
      events.push(ev);
      if (ev.type === "hello") { clearTimeout(timer); resolve({ ws, events }); }
    });
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: s.token })));
  });
}

test("server: links, reduced motion, and a demo chat update the project over the websocket", async () => {
  const s = await startServer({ env: { CC_STATUS_PAGES: "off", CC_DEV_OWNER: "1" } });
  try {
    const home = await s.api("/liveview");
    assert.equal(home.status, 200);
    assert.equal(home.json.note, HISTORY_NOTE);
    assert.equal(home.json.flow.nodes[0].id, "hub");
    assert.equal(home.json.flow.reducedMotion, false);
    const still = await s.api("/liveview?motion=reduce");
    assert.equal(still.json.flow.reducedMotion, true);
    assert.ok(still.json.flow.nodes.every((n) => n.spin === false));
    const link = await s.api("/liveview/link?provider=kling&taskId=task_1");
    assert.equal(link.status, 200);
    assert.equal(link.json.label, "Open in Kling");
    assert.equal(link.json.url, "https://app.klingai.com/global/video?task=task_1");
    const openai = await s.api("/liveview/link?provider=openai");
    assert.equal(openai.json.url, "https://platform.openai.com/usage");
    assert.equal((await s.api("/liveview/link")).status, 400);
    assert.equal((await s.api("/liveview/project/missing")).status, 404);
    const idle = await s.api("/liveview/project/my-project");
    assert.equal(idle.status, 200);
    assert.equal(idle.json.working, false);
    assert.doesNotMatch(s.log, /klingai\.com|platform\.openai\.com|platform\.claude\.com|console\.x\.ai/);

    const { ws, events } = await listen(s);
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: "Say hi in one sentence.", projectId: "my-project" } })).status, 202);
    let project = null;
    for (let i = 0; i < 40; i++) {
      project = (await s.api("/liveview/project/my-project")).json;
      if (project.runs?.some((r) => r.status === "done" && r.cost > 0)) break;
      await sleep(300);
    }
    const run = project.runs.find((r) => r.kind === "single");
    assert.ok(run, "demo chat is on the project");
    assert.equal(run.status, "done");
    assert.ok(run.cost > 0, `running cost from the ledger (${run.cost})`);
    assert.ok(project.flow.nodes.some((n) => n.id !== "hub" && /demo/.test(n.name)));
    assert.ok(events.some((e) => e.type === "liveview.update" && (e.view?.flow?.pulses?.length || e.view?.flow?.nodes?.some((n) => n.active))));
    assert.equal(JSON.stringify(project).includes("demo-key"), false);
    ws.close();
  } finally { await s.stop(); }
});
