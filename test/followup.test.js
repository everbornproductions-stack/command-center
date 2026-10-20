// Replies in Live Ops. A finished chat, council, or mission had no way to answer the AIs.
// POST /followup stays on that same job, sends the earlier turns, and keeps the new ones.
// The page puts a box under each answer and one on the whole job, in Simple and in Expert.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, freePort, ROOT } from "./helpers.js";

const FU = await import("../server/followup.js");

test("a follow-up keeps the question, the earlier answer, and the new message, in that order", () => {
  const msgs = FU.messagesFor({
    prompt: "Name a bakery.",
    prior: "PRIOR-MARK loaf.",
    history: [{ role: "user", text: "Shorter." }, { role: "assistant", text: "Crumb." }],
    followup: "Now add a street.",
  });
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.equal(msgs[0].content, "Name a bakery.");
  assert.match(msgs[1].content, /PRIOR-MARK loaf/);
  assert.equal(msgs.at(-1).content, "Now add a street.");
  const again = FU.historyFor(
    [{ role: "user", text: "Only you." }, { role: "assistant", text: "Just me." }],
    [{ role: "user", text: "Whole job." }, { role: "assistant", text: "chair", parts: [{ model: "grok-4.7", text: "From Grok." }] }],
    "grok-4.7",
  );
  assert.deepEqual(again.map((t) => t.text), ["Only you.", "Just me.", "Whole job.", "From Grok."]);
  assert.ok(FU.clip("x".repeat(50), 10).endsWith("[truncated]"));
  for (const s of [
    "You are continuing this conversation with one person.",
    "You are one voice in a council that already answered.",
    "You chair this council.",
    "You already finished your part of a mission.",
    "You assembled this mission.",
    "You are one of the AIs on this mission.",
    "The person replied to every AI on this council. Continue with that context.",
    "Reply to all",
    "waiting on Grok Bot",
  ]) assert.doesNotMatch(s, /—/);
});

test("Live Ops shows a reply under each answer and one for the job, in both modes, including a narrow window", () => {
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "web", "styles.css"), "utf8");
  assert.match(app, /function answerReply/);
  assert.match(app, /function jobReply/);
  assert.match(app, /const label = "Reply to all"/);
  assert.doesNotMatch(app, /Follow up with the council/);
  assert.doesNotMatch(app, /Follow up on this mission/);
  assert.doesNotMatch(app, /Follow up on this chat/);
  assert.match(app, /waiting on Grok Bot/);
  assert.match(app, /Reply to this AI/);
  const follow = fs.readFileSync(path.join(ROOT, "server", "followup.js"), "utf8");
  assert.match(follow, /REPLY_TASK = "reply-all"/);
  assert.match(follow, /dispatchGrokbot/);
  assert.match(follow, /every AI on the mission/);
  assert.doesNotMatch(follow, /—/);
  assert.match(app, /scope: "answer"/);
  assert.match(app, /scope: "job"/);
  assert.match(app, /api\("\/followup"/);
  assert.match(app, /S\.uiMode !== "expert"/, "Simple mode renders the same reply boxes on the answer");
  assert.match(css, /\.reply-box \{[^}]*width:\s*100%/);
  assert.match(css, /\.reply-box textarea \{[^}]*max-width:\s*100%/);
  assert.match(css, /\.reply-box textarea \{[^}]*min-width:\s*0/);
  assert.match(css, /\.task-follow \{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(css, /\.grok-wait \{/);
  const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(phone, /\.reply-box textarea \{ min-height: 72px; \}/);
  assert.match(phone, /\.ans \{ max-height: none; \}/);
  assert.doesNotMatch(app.slice(app.indexOf("function replyForm"), app.indexOf("function answerReply")), /—/);
  assert.doesNotMatch(css.slice(css.indexOf(".reply-box")), /—/);
});

function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream", connection: "close", "cache-control": "no-cache" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function replyText(messages) {
  const users = messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : ""));
  const prior = messages.filter((m) => m.role === "assistant").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
  const last = users.at(-1) || "";
  const saw = prior.includes("PRIOR-MARK") ? "saw-prior" : "no-prior";
  return `OK ${saw} :: ${last.replace(/\s+/g, " ").slice(0, 160)}`;
}

test("server: a reply stays on the same job and sends the earlier answer with it", { timeout: 180000 }, async () => {
  const port = await freePort();
  const seen = [];
  let releaseHold = () => {};
  let hold = new Promise((r) => { releaseHold = r; });
  const mock = http.createServer(async (req, res) => {
    if (req.method === "GET" && /\/models$/.test(req.url)) {
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(JSON.stringify({ data: [{ id: "mock" }] }));
      return;
    }
    let body = "";
    for await (const c of req) body += c;
    let j = {};
    try { j = JSON.parse(body || "{}"); } catch { j = {}; }
    const messages = Array.isArray(j.messages) ? j.messages : [];
    const sys = messages.find((m) => m.role === "system")?.content || "";
    const last = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    seen.push({ url: req.url, model: j.model, sys: String(sys).slice(0, 80), messages });
    if (String(last).includes("HOLD-PLEASE")) await hold;
    sse(res, replyText(messages));
  });
  await new Promise((r) => mock.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${port}`;
  const write = (dir, name, obj) => {
    const folder = path.join(dir, "missions");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), JSON.stringify(obj));
  };
  const s = await startServer({
    env: { CC_STATUS_PAGES: "off", CC_BASE_URL_XAI: `${base}/xai/v1`, CC_BASE_URL_GROQ: `${base}/groq/v1`, CC_GROKBOT_MOCK_MS: "1500" },
    seed(dir) {
      write(dir, "s-reply1.json", {
        id: "s-reply1", kind: "single", prompt: "Name a bakery.", status: "done", startedAt: 1, finishedAt: 2,
        provider: "xai", model: "grok-4.7", cost: 0, deliverable: "PRIOR-MARK single loaf.", tasks: [],
      });
      write(dir, "c-reply1.json", {
        id: "c-reply1", kind: "council", prompt: "Pick a name.", status: "done", startedAt: 1, finishedAt: 2, cost: 0, mode: "balanced",
        members: [{ provider: "xai", model: "grok-4.7" }, { provider: "groq", model: "openai/gpt-oss-120b" }],
        chair: { provider: "xai", model: "grok-4.7" },
        answers: {
          "grok-4.7": { provider: "xai", model: "grok-4.7", text: "PRIOR-MARK grok name.", letter: "A" },
          "openai/gpt-oss-120b": { provider: "groq", model: "openai/gpt-oss-120b", text: "PRIOR-MARK groq name.", letter: "B" },
        },
        verdict: { provider: "xai", model: "grok-4.7", text: "PRIOR-MARK verdict." },
      });
      write(dir, "m-reply1.json", {
        id: "m-reply1", kind: "mission", prompt: "Plan a launch.", title: "Plan a launch.", status: "done",
        startedAt: 1, finishedAt: 2, cost: 0, mode: "balanced", deliverable: "PRIOR-MARK mission deliverable.",
        assembler: { provider: "xai", model: "grok-4.7" },
        tasks: [
          { id: "t1", title: "Draft", capability: "writing", status: "done", provider: "groq", model: "openai/gpt-oss-120b", output: "PRIOR-MARK task draft.", instructions: "Write the draft." },
          { id: "t2", title: "Check", capability: "analysis", status: "done", provider: "xai", model: "grok-4.7", output: "PRIOR-MARK task check.", instructions: "Check it." },
        ],
      });
      write(dir, "c-grok1.json", {
        id: "c-grok1", kind: "council", prompt: "Check the inbox and pick a name.", status: "done", startedAt: 1, finishedAt: 2, cost: 0, mode: "balanced",
        members: [{ provider: "xai", model: "grok-4.7" }],
        chair: { provider: "xai", model: "grok-4.7" },
        agents: [{ id: "grokbot", name: "Grok Bot", letter: "B", needs: ["gmail"], jobId: "gb-oldjob0001", status: "done" }],
        answers: {
          "grok-4.7": { provider: "xai", model: "grok-4.7", text: "PRIOR-MARK grok name.", letter: "A" },
          grokbot: { provider: "grokbot", model: "grokbot", text: "PRIOR-MARK grokbot inbox.", letter: "B", agent: true, jobId: "gb-oldjob0001" },
        },
        verdict: { provider: "xai", model: "grok-4.7", text: "PRIOR-MARK verdict." },
      });
      write(dir, "m-grok1.json", {
        id: "m-grok1", kind: "mission", prompt: "Plan a launch and check the inbox.", title: "Plan a launch and check the inbox.", status: "done",
        startedAt: 1, finishedAt: 2, cost: 0, mode: "balanced", deliverable: "PRIOR-MARK mission deliverable.",
        assembler: { provider: "xai", model: "grok-4.7" },
        tasks: [
          { id: "t1", title: "Draft", capability: "writing", status: "done", provider: "groq", model: "openai/gpt-oss-120b", output: "PRIOR-MARK task draft.", instructions: "Write the draft." },
          { id: "tg", title: "Inbox", capability: "agent", status: "waiting", provider: "grokbot", model: "grokbot", agent: true, output: "", instructions: "Check the inbox.", needs: ["gmail"], agentJob: { jobId: "gb-oldjob0002", status: "working" } },
        ],
      });
    },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitRun = async (id, pred) => {
    for (let i = 0; i < 240; i++) {
      const g = await s.api(`/missions/${id}`);
      if (g.status === 200 && pred(g.json)) return g.json;
      await sleep(250);
    }
    return null;
  };
  try {
    const kx = await s.api("/keys", { method: "POST", body: { provider: "xai", key: "xai-fakefakefakefakefake" } });
    assert.equal(kx.status, 200, kx.text);
    const kg = await s.api("/keys", { method: "POST", body: { provider: "groq", key: "gsk_fakefakefakefakefake" } });
    assert.equal(kg.status, 200, kg.text);

    assert.equal((await s.api("/followup", { method: "POST", body: { text: "Hi" } })).status, 400);
    assert.equal((await s.api("/followup", { method: "POST", body: { runId: "s-reply1", text: "Hi", scope: "nope" } })).status, 400);
    assert.equal((await s.api("/followup", { method: "POST", body: { runId: "s-reply1", text: "Hi", scope: "answer" } })).status, 400);
    assert.equal((await s.api("/followup", { method: "POST", body: { runId: "missing", text: "Hi", scope: "job" } })).status, 404);
    assert.equal((await s.api("/followup", { method: "POST", body: { runId: "c-reply1", text: "Hi", scope: "answer", target: "no-such-model" } })).status, 404);

    const before = seen.length;
    const first = await s.api("/followup", { method: "POST", body: { runId: "s-reply1", text: "HOLD-PLEASE add a street.", scope: "answer", target: "grok-4.7" } });
    assert.equal(first.status, 202, first.text);
    assert.equal(first.json.runId, "s-reply1");
    const again = await s.api("/followup", { method: "POST", body: { runId: "s-reply1", text: "second", scope: "job" } });
    assert.equal(again.status, 409, again.text);
    releaseHold();
    hold = Promise.resolve();
    const one = await waitRun("s-reply1", (m) => (m.answerThread || []).some((t) => t.role === "assistant" && /saw-prior/.test(t.text || "")));
    assert.ok(one, "the chat reply landed on the same job");
    assert.equal(one.id, "s-reply1");
    assert.match(one.answerThread.at(-1).text, /saw-prior/);
    assert.match(one.answerThread.at(-1).text, /HOLD-PLEASE/);
    const call = seen.slice(before).find((x) => x.url.includes("/xai/"));
    assert.ok(call, "the reply went to the AI that answered");
    const assistant = call.messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
    assert.match(assistant, /PRIOR-MARK single loaf/);

    const job = await s.api("/followup", { method: "POST", body: { runId: "s-reply1", text: "Make it a lane.", scope: "job" } });
    assert.equal(job.status, 202, job.text);
    const two = await waitRun("s-reply1", (m) => (m.thread || []).some((t) => /lane/.test(t.text || "")));
    assert.ok(two, "the whole-chat follow-up stayed on the same job");
    assert.equal(two.kind, "single");
    const files = fs.readdirSync(path.join(s.dir, "missions")).filter((f) => f.startsWith("s-"));
    assert.deepEqual(files, ["s-reply1.json"]);

    const member = await s.api("/followup", { method: "POST", body: { runId: "c-reply1", text: "Soften the groq name.", scope: "answer", target: "openai/gpt-oss-120b" } });
    assert.equal(member.status, 202, member.text);
    const councilOne = await waitRun("c-reply1", (m) => (m.answers?.["openai/gpt-oss-120b"]?.thread || []).some((t) => t.role === "assistant" && t.text));
    assert.ok(councilOne, "the council member reply is stored on that answer");
    assert.match(councilOne.answers["openai/gpt-oss-120b"].thread.at(-1).text, /saw-prior/);
    assert.equal(councilOne.answers["grok-4.7"].thread, undefined, "the other AI was not called for this reply");
    const groqCalls = seen.filter((x) => x.url.includes("/groq/") && /Soften the groq name/.test(JSON.stringify(x.messages)));
    const xaiForMember = seen.filter((x) => x.url.includes("/xai/") && /Soften the groq name/.test(JSON.stringify(x.messages)));
    assert.equal(groqCalls.length, 1);
    assert.equal(xaiForMember.length, 0);

    const mark = seen.length;
    const whole = await s.api("/followup", { method: "POST", body: { runId: "c-reply1", text: "Give us one more name.", scope: "job" } });
    assert.equal(whole.status, 202, whole.text);
    const councilJob = await waitRun("c-reply1", (m) => (m.thread || []).some((t) => t.role === "assistant" && t.parts?.length >= 2));
    assert.ok(councilJob, "the council follow-up kept both voices and the verdict");
    const round = seen.slice(mark);
    assert.ok(round.some((x) => x.url.includes("/xai/") && /one voice in a council/.test(x.sys)));
    assert.ok(round.some((x) => x.url.includes("/groq/") && /one voice in a council/.test(x.sys)));
    assert.ok(round.some((x) => /You chair this council/.test(x.sys)));
    assert.ok(round.filter((x) => /one voice in a council/.test(x.sys)).every((x) => x.messages.some((m) => m.role === "assistant" && /PRIOR-MARK/.test(m.content || ""))));

    const task = await s.api("/followup", { method: "POST", body: { runId: "m-reply1", text: "Shorten the draft.", scope: "answer", target: "t1" } });
    assert.equal(task.status, 202, task.text);
    const missionOne = await waitRun("m-reply1", (m) => (m.tasks || []).find((t) => t.id === "t1" && (t.thread || []).some((x) => x.role === "assistant" && x.text)));
    assert.ok(missionOne, "the specialist reply is on that task");
    const t1 = missionOne.tasks.find((t) => t.id === "t1");
    assert.match(t1.thread.at(-1).text, /saw-prior/);
    assert.match(t1.output, /PRIOR-MARK task draft/);
    assert.equal((missionOne.tasks.find((t) => t.id === "t2").thread || []).length, 0);

    const missionJob = await s.api("/followup", { method: "POST", body: { runId: "m-reply1", text: "Add a date.", scope: "job" } });
    assert.equal(missionJob.status, 202, missionJob.text);
    const missionTwo = await waitRun("m-reply1", (m) => (m.thread || []).some((t) => t.role === "assistant" && /saw-prior/.test(t.text || "")));
    assert.ok(missionTwo, "the mission follow-up stayed on the same mission");
    assert.equal(missionTwo.id, "m-reply1");
    assert.match(missionTwo.deliverable, /PRIOR-MARK mission deliverable/);
    const asm = seen.filter((x) => /You assembled this mission/.test(x.sys));
    assert.equal(asm.length, 1);
    assert.match(asm[0].messages.map((m) => m.content).join("\n"), /PRIOR-MARK mission deliverable/);
    assert.match(asm[0].messages.map((m) => m.content).join("\n"), /PRIOR-MARK task draft/);
    const voices = seen.filter((x) => /one of the AIs on this mission/.test(x.sys) && /Add a date/.test(JSON.stringify(x.messages)));
    assert.equal(voices.length, 2, "Reply to all asks every specialist on the mission");
    assert.ok(voices.some((x) => x.url.includes("/groq/")));
    assert.ok(voices.some((x) => x.url.includes("/xai/")));
    assert.ok(voices.every((x) => x.messages.some((m) => m.role === "assistant" && /PRIOR-MARK/.test(m.content || ""))));

    const mockOn = await s.api("/grokbot/config", { method: "POST", body: { mock: true } });
    assert.equal(mockOn.status, 200, mockOn.text);
    const grokReply = await s.api("/followup", { method: "POST", body: { runId: "c-grok1", text: "Add one more name for Grok Bot.", scope: "job" } });
    assert.equal(grokReply.status, 202, grokReply.text);
    assert.equal(grokReply.json.runId, "c-grok1");
    let sawPending = false;
    const grokDone = await waitRun("c-grok1", (m) => {
      const part = (m.thread || []).flatMap((t) => t.parts || []).find((p) => p.provider === "grokbot");
      if (part?.pending) sawPending = true;
      return part && part.pending === false && part.text ? m : null;
    });
    assert.ok(sawPending, "Reply to all keeps a waiting on Grok Bot part until the handoff comes back");
    assert.ok(grokDone, "the Grok Bot handoff result landed on the same council");
    assert.equal(grokDone.id, "c-grok1");
    assert.match(grokDone.thread.at(-1).parts.find((p) => p.provider === "grokbot").text, /Grok Bot \(mock\)/);
    assert.equal(grokDone.answers.grokbot.followPending, false);
    assert.match(grokDone.answers.grokbot.text, /PRIOR-MARK grokbot inbox/);
    const jobs = (await s.api("/grokbot/jobs")).json;
    const hand = jobs.find((j) => j.source?.runId === "c-grok1" && j.source?.taskId === "reply-all");
    assert.ok(hand, "Reply to all used the Grok Bot handoff");
    assert.equal(hand.task, "Add one more name for Grok Bot.");
    assert.equal(hand.status, "done");
    const stored = JSON.parse(fs.readFileSync(path.join(s.dir, "grokbot.jobs.json"), "utf8"));
    const handoff = stored.find((j) => j.id === hand.id);
    assert.equal(String(handoff.context).includes("PRIOR-MARK grokbot inbox"), true);
    assert.equal(String(handoff.context).includes("Continue with that context."), true);
    assert.equal(handoff.tokenHash, null, "a finished handoff burns the callback token");

    const missionGrok = await s.api("/followup", { method: "POST", body: { runId: "m-grok1", text: "Look again for Grok Bot.", scope: "job" } });
    assert.equal(missionGrok.status, 202, missionGrok.text);
    let missionPending = false;
    const missionGrokDone = await waitRun("m-grok1", (m) => {
      const part = (m.thread || []).flatMap((t) => t.parts || []).find((p) => p.provider === "grokbot");
      if (part?.pending) missionPending = true;
      return part && part.pending === false && part.text ? m : null;
    });
    assert.ok(missionPending, "the mission shows waiting on Grok Bot before the handoff comes back");
    assert.ok(missionGrokDone, "the Grok Bot handoff result landed on the same mission");
    assert.equal(missionGrokDone.id, "m-grok1");
    assert.match(missionGrokDone.thread.at(-1).parts.find((p) => p.provider === "grokbot").text, /Grok Bot \(mock\)/);
    const inbox = missionGrokDone.tasks.find((t) => t.id === "tg");
    assert.equal(inbox.output, "");
    assert.equal(inbox.followPending, false);
    const missionHand = (await s.api("/grokbot/jobs")).json.find((j) => j.source?.runId === "m-grok1" && j.source?.taskId === "reply-all");
    assert.ok(missionHand, "the mission Reply to all used the same handoff");
    assert.equal(missionHand.task, "Look again for Grok Bot.");

    const raw = fs.readFileSync(path.join(s.dir, "missions", "s-reply1.json"), "utf8");
    assert.equal(raw.includes("xai-fakefakefakefakefake"), false);
    assert.equal(s.log.includes("xai-fakefakefakefakefake"), false);
    assert.equal(s.log.includes("gsk_fakefakefakefakefake"), false);
  } finally {
    releaseHold();
    await s.stop();
    await new Promise((r) => mock.close(r));
  }
});
