// Workstream E: background runs with in-app done alerts (Pro), what ratings taught
// plus a reset, and pause / edit / resume for missions (Pro). Real waits, local mocks,
// fake keys, and every server is stopped. Nothing here reads data/ or talks to Square.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT, waitBudget } from "./helpers.js";
import { gateAllows, assertGate } from "../server/feature-gate.js";
import { TIERS } from "../server/license.js";

const EM = "\u2014";
const EN = "\u2013";
const KEY = "xai-workstreamEfakefake000";
const MARK = "PAUSEEDIT-QUILL-7741";

test("gates: background and pause are Pro, ratings stay on Free, release is 0.4.16", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.4.21");
  assert.equal(gateAllows("free", "backgroundRuns"), false);
  assert.equal(gateAllows("free", "missionPause"), false);
  assert.equal(gateAllows("free", "learnedFromRatings"), true);
  assert.equal(gateAllows("pro", "backgroundRuns"), true);
  assert.equal(gateAllows("owner", "missionPause"), true);
  assert.equal(gateAllows("studio", "notAGate"), false);
  assert.throws(() => assertGate("free", "backgroundRuns"), (e) => e.status === 402 && e.code === "pro_required");
  assert.doesNotThrow(() => assertGate("free", "learnedFromRatings"));
  assert.throws(() => assertGate("pro", "notAGate"), (e) => e.status === 402);
  assert.equal(TIERS.free.backgroundRuns, false);
  assert.equal(TIERS.free.missionPause, false);
  assert.equal(TIERS.free.learnedFromRatings, true);
  assert.equal(TIERS.pro.backgroundRuns, true);
  assert.equal(TIERS.pro.missionPause, true);
  for (const rel of [
    "server/feature-gate.js", "server/background.js", "server/plugins/background.js",
    "web/features/background.js", "web/features/ratings.js", "web/app.js",
    "docs/help/getting-started.md", "docs/help/missions-media.md",
    ".github/workflows/mac-ci.yml", ".github/workflows/windows-ci.yml",
  ]) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(text.includes(EM), false, rel);
    assert.equal(text.includes(EN), false, rel);
  }
  const mac = fs.readFileSync(path.join(ROOT, ".github/workflows/mac-ci.yml"), "utf8");
  const win = fs.readFileSync(path.join(ROOT, ".github/workflows/windows-ci.yml"), "utf8");
  assert.match(mac, /workflow_dispatch:/);
  assert.match(mac, /tags: \["v\*"\]/);
  assert.doesNotMatch(mac, /pull_request:/);
  assert.match(win, /pull_request:/);
  assert.doesNotMatch(mac, /secrets\./);
});

function sse(res, chunks) {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  res.writeHead(200, { "content-type": "text/event-stream", "content-length": Buffer.byteLength(body), connection: "close" });
  res.end(body);
}
function answerFor(j) {
  const sys = j.messages.find((m) => m.role === "system")?.content || "";
  if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
  if (/Break the goal into/.test(sys)) {
    return JSON.stringify({
      title: "Two steps",
      tasks: [
        { id: "t1", title: "Draft it", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write the draft.", deliverable: "Draft" },
        { id: "t2", title: "Check it", capability: "writing", difficulty: 1, needWeb: false, deps: ["t1"], instructions: "Check the draft.", deliverable: "Notes" },
      ],
      assembly: "One short note.",
    });
  }
  return `Answer from ${j.model}.`;
}
async function mockXai() {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const send = (code, j) => { const body = JSON.stringify(j); res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" }); res.end(body); };
    const url = new URL(req.url, "http://127.0.0.1");
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: `mock: no route ${url.pathname}` });
    const j = JSON.parse(raw || "{}");
    seen.push(j.messages?.filter((m) => m.role === "user").map((m) => m.content).join("\n") || "");
    return sse(res, [{ model: j.model, choices: [{ delta: { content: answerFor(j) } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 8 } }]);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    seen,
    close: () => new Promise((r) => srv.close(r)),
    env: {
      CC_DEV_OWNER: "1",
      CC_STATUS_PAGES: "off",
      CC_MISSION_WAVE_HOLD_MS: "4000",
      CC_BASE_URL_XAI: `http://127.0.0.1:${srv.address().port}/v1`,
      XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "",
      DEEPSEEK_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "",
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(s, pred, label, ms = 90000) {
  const budget = waitBudget(ms);
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < budget) {
    try {
      const hit = await pred();
      if (hit) return hit;
    } catch (e) { last = e?.message || String(e); }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last}` : ""}\n${(s.log || "").slice(-600)}`);
}

test("Free: background and pause are closed, a normal chat still starts, ratings stay readable", async () => {
  const s = await startServer();
  try {
    const before = (await s.api("/missions")).json;
    const denied = await s.api("/chat", { method: "POST", body: { prompt: "Write one line about bread.", background: true } });
    assert.equal(denied.status, 402);
    assert.equal(denied.json.code, "pro_required");
    assert.match(denied.json.error, /Background runs/);
    await sleep(waitBudget(400));
    assert.equal((await s.api("/missions")).json.length, before.length, "a refused background run does not start");
    const ok = await s.api("/chat", { method: "POST", body: { prompt: "Write one line about bread." } });
    assert.equal(ok.status, 202);
    assert.equal((await s.api("/mission/m-missing/pause", { method: "POST", body: {} })).status, 402);
    assert.equal((await s.api("/mission/m-missing/resume", { method: "POST", body: {} })).status, 402);
    const learned = await s.api("/ratings/learned");
    assert.equal(learned.status, 200);
    assert.equal(learned.json.count, 0);
    assert.equal((await s.api("/ratings/reset", { method: "POST", body: {} })).status, 400);
    assert.equal(s.log.includes(KEY), false);
  } finally { await s.stop(); }
});

test("owner: a background chat alerts when it is done, and a ratings reset keeps the jobs", async () => {
  const m = await mockXai();
  const s = await startServer({ env: m.env });
  try {
    assert.ok((await s.api("/state")).json.plugins.includes("background"));
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } })).json.status.status, "green");
    const one = await s.api("/ratings", { method: "POST", body: { missionId: "s-rate-a", kind: "single", provider: "xai", model: "grok-4.3", capability: "writing", up: true } });
    assert.equal(one.status, 200);
    let learned = (await s.api("/ratings/learned")).json;
    assert.equal(learned.count, 1);
    assert.ok(learned.early.some((row) => /Not enough ratings yet/.test(row.note)));
    await s.api("/ratings", { method: "POST", body: { missionId: "s-rate-b", kind: "single", provider: "xai", model: "grok-4.3", capability: "writing", up: true } });
    learned = (await s.api("/ratings/learned")).json;
    assert.equal(learned.lines.length, 1);
    assert.match(learned.lines[0].note, /favoured for writing/);
    const skills = (await s.api("/state")).json.skills["grok-4.3"].writing;
    assert.ok(skills.up >= 2);

    const started = await s.api("/chat", { method: "POST", body: { prompt: "Write a tagline for a bakery.", provider: "xai", model: "grok-4.3", background: true } });
    assert.equal(started.status, 202);
    assert.ok(started.json.runId);
    const alert = await waitFor(s, async () => {
      const view = (await s.api("/background")).json;
      return view.alerts.find((a) => a.id === started.json.runId && a.headline === "Chat done");
    }, "chat done alert");
    assert.equal(alert.seen, false);
    assert.equal(alert.kind, "single");
    const jobs = (await s.api("/brain")).json.jobs;
    assert.ok(jobs >= 1, "the chat is still a job");

    assert.equal((await s.api("/ratings/reset", { method: "POST", body: {} })).status, 400);
    const cleared = await s.api("/ratings/reset", { method: "POST", body: { confirm: true } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.count, 0);
    const after = (await s.api("/state")).json.skills["grok-4.3"].writing;
    assert.equal(after.up || 0, 0);
    assert.equal(after.down || 0, 0);
    assert.equal((await s.api("/brain")).json.jobs, jobs, "reset clears thumbs, not jobs");

    const mix = await s.api("/mission", { method: "POST", body: { goal: "Write a short note.", background: true, runAt: "offpeak", qa: false, search: false } });
    assert.equal(mix.status, 400);
    assert.match(mix.json.error, /A background run starts now/);
    assert.equal(s.log.includes(KEY), false);
    assert.equal(m.seen.join("\n").includes(KEY), false);
  } finally { await s.stop(); await m.close(); }
});

test("owner: pause, edit, and resume keep the finished step and run the new instructions", async () => {
  const m = await mockXai();
  const s = await startServer({ env: m.env });
  try {
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: KEY } })).json.status.status, "green");
    const goal = "Write a short note and then check it.";
    const started = await s.api("/mission", { method: "POST", body: { goal, mode: "balanced", qa: false, budgetUsd: 2, search: false, background: true } });
    assert.equal(started.status, 202);
    const id = started.json.id;
    assert.ok(id);
    const ready = await waitFor(s, async () => {
      const row = (await s.api(`/missions/${id}`)).json;
      const tasks = row?.tasks || [];
      if (tasks.some((t) => t.status === "done") && tasks.some((t) => !["done", "failed", "waiting"].includes(t.status))) return row;
      return null;
    }, "one mission step done");
    const kept = ready.tasks.find((t) => t.status === "done");
    assert.ok(kept.output);
    const pause = await s.api(`/mission/${id}/pause`, { method: "POST", body: {} });
    assert.equal(pause.status, 202);
    const paused = await waitFor(s, async () => {
      const row = (await s.api(`/missions/${id}`)).json;
      return row.status === "paused" ? row : null;
    }, "mission paused");
    assert.equal(paused.finishedAt, null);
    const quiet = (await s.api("/background")).json;
    assert.equal(quiet.alerts.some((a) => a.id === id), false, "paused is not a done alert");
    const edit = await s.api(`/mission/${id}/edit`, { method: "POST", body: { tasks: [{ id: "t2", instructions: MARK }] } });
    assert.equal(edit.status, 200);
    assert.equal(edit.json.tasks.find((t) => t.id === "t2").instructions, MARK);
    const resume = await s.api(`/mission/${id}/resume`, { method: "POST", body: {} });
    assert.equal(resume.status, 202);
    const done = await waitFor(s, async () => {
      const row = (await s.api(`/missions/${id}`)).json;
      return ["done", "done-with-errors"].includes(row.status) ? row : null;
    }, "mission resumed");
    const t1 = done.tasks.find((t) => t.id === kept.id);
    assert.equal(t1.output, kept.output, "the finished step stays");
    const t2 = done.tasks.find((t) => t.id === "t2");
    assert.equal(t2.instructions, MARK);
    assert.equal(t2.status, "done");
    assert.ok(m.seen.some((text) => text.includes(MARK)), "the mock saw the edited instructions");
    const alert = await waitFor(s, async () => {
      const view = (await s.api("/background")).json;
      return view.alerts.find((a) => a.id === id && a.headline === "Mission done");
    }, "mission done alert");
    assert.equal(alert.kind, "mission");

    const second = await s.api("/mission", { method: "POST", body: { goal, mode: "balanced", qa: false, budgetUsd: 2, search: false } });
    assert.equal(second.status, 202);
    const again = await waitFor(s, async () => {
      const rows = (await s.api("/missions")).json;
      const row = rows.find((r) => r.kind === "mission" && r.id !== id && r.tasks > 0);
      if (!row) return null;
      const full = (await s.api(`/missions/${row.id}`)).json;
      const tasks = full.tasks || [];
      if (tasks.some((t) => t.status === "done") && tasks.some((t) => !["done", "failed", "waiting"].includes(t.status))) return full;
      return null;
    }, "second mission ready to pause");
    assert.equal((await s.api(`/mission/${again.id}/pause`, { method: "POST", body: {} })).status, 202);
    await waitFor(s, async () => {
      const row = (await s.api(`/missions/${again.id}`)).json;
      return row.status === "paused" ? row : null;
    }, "second mission paused");
    assert.equal((await s.api(`/mission/${again.id}/abort`, { method: "POST", body: {} })).json.aborted, true);
    const aborted = (await s.api(`/missions/${again.id}`)).json;
    assert.equal(aborted.status, "aborted");
    assert.equal(typeof aborted.finishedAt, "number");
    assert.equal(s.log.includes(KEY), false);
  } finally { await s.stop(); await m.close(); }
});
