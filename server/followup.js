// A reply under an answer, or a follow-up on the whole job.
// The same run keeps the new turns. Nothing here starts a second job.
import { PROVIDERS } from "./registry.js";
import { ctx } from "./store.js";
import { emit } from "./events.js";
import { recordCall } from "./ledger.js";
import { completeFallback, announce as announceFallback, fallbackRecord } from "./fallback.js";
import { AGENT_ID as GROKBOT, onJobFinished, dispatch as dispatchGrokbot, awaitJob as awaitGrokbotJob } from "./grokbot.js";

const TERMINAL = new Set(["done", "done-with-errors", "failed", "aborted"]);
const KINDS = new Set(["single", "council", "mission"]);
const MAX_TEXT = 8000;
const CLIP = 12000;
const busy = new Set();

function fail(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code || null;
  return e;
}

export function clip(text, max = CLIP) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n[truncated]";
}

// Prior turns, then the new message last. Assistant turns are the earlier answers.
export function messagesFor({ prompt, prior, history, followup }) {
  const msgs = [];
  if (prompt) msgs.push({ role: "user", content: clip(prompt) });
  if (prior) msgs.push({ role: "assistant", content: clip(prior) });
  for (const t of history || []) {
    if (t?.role !== "user" && t?.role !== "assistant") continue;
    const text = t.text || t.content || "";
    if (!text) continue;
    msgs.push({ role: t.role, content: clip(text) });
  }
  msgs.push({ role: "user", content: clip(followup, MAX_TEXT) });
  return msgs;
}

// Direct replies to that AI, then earlier whole-job rounds that included them.
export function historyFor(direct, jobThread, model) {
  const out = [];
  for (const t of direct || []) {
    if ((t?.role === "user" || t?.role === "assistant") && t.text) out.push({ role: t.role, text: t.text });
  }
  for (const t of jobThread || []) {
    if (t?.role === "user" && t.text) { out.push({ role: "user", text: t.text }); continue; }
    if (t?.role !== "assistant") continue;
    if (Array.isArray(t.parts) && model) {
      const part = t.parts.find((p) => p && (p.model === model || p.target === model));
      if (part?.text) out.push({ role: "assistant", text: part.text });
    } else if (!t.parts && t.text) out.push({ role: "assistant", text: t.text });
  }
  return out;
}

const nameOf = (id) => PROVIDERS[id]?.name || id || "AI";
const now = () => Date.now();
const cleanRunId = (id) => String(id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 80);
function cleanTarget(id) {
  const s = String(id || "").trim();
  if (!s || s.length > 200 || /\.\.|[\\]/.test(s)) return "";
  return /^[A-Za-z0-9._:/-]+$/.test(s) ? s : "";
}

function parse(body) {
  const runId = cleanRunId(body?.runId);
  const text = String(body?.text || "").trim();
  const scope = body?.scope === "answer" || body?.scope === "job" ? body.scope : "";
  const target = cleanTarget(body?.target);
  if (!runId) throw fail(400, "Which job should this reply go to?", "run");
  if (!text) throw fail(400, "Type a reply first.", "text");
  if (text.length > MAX_TEXT) throw fail(400, "That reply is too long.", "text");
  if (!scope) throw fail(400, "Say whether this replies to one AI or to the whole job.", "scope");
  if (scope === "answer" && !target) throw fail(400, "Say which AI this reply is for.", "target");
  return { runId, text, scope, target };
}

function answerOf(run, target) {
  if (run.kind === "single") {
    if (run.model && target && target !== run.model && target !== run.provider) return null;
    if (!run.model || !run.provider) return null;
    if (!(run.deliverable || "").trim()) return null;
    return { provider: run.provider, model: run.model, text: run.deliverable, thread: run.answerThread || [] };
  }
  if (run.kind === "council") {
    const a = run.answers?.[target];
    if (!a?.text || a.pending || a.agent) return null;
    if (!PROVIDERS[a.provider] || PROVIDERS[a.provider].kind !== "text") return null;
    return { provider: a.provider, model: a.model || target, text: a.text, thread: a.thread || [], key: target };
  }
  const t = (run.tasks || []).find((x) => x.id === target);
  if (!t?.output || !t.provider || !t.model) return null;
  if (!PROVIDERS[t.provider] || PROVIDERS[t.provider].kind !== "text") return null;
  return { provider: t.provider, model: t.model, text: t.output, thread: t.thread || [], task: t, key: t.id };
}

function councilMembers(run) {
  return (run.members || []).filter((m) => {
    const a = run.answers?.[m.model];
    return a?.text && !a.pending && !a.agent && PROVIDERS[m.provider]?.kind === "text";
  });
}

function textTasks(run) {
  return (run.tasks || []).filter((t) => t?.output && t.status === "done" && !t.agent && t.provider && t.model && PROVIDERS[t.provider]?.kind === "text");
}

// A Grok Bot seat already on this job. Reply to all hands it the same webhook again.
function grokSeat(run) {
  if (run.kind === "council") {
    const seat = (run.agents || []).find((a) => a.id === GROKBOT);
    if (!seat) return null;
    return { prior: run.answers?.[GROKBOT]?.text || "", needs: seat.needs || [], target: GROKBOT, title: "", instructions: "" };
  }
  if (run.kind === "mission") {
    const t = (run.tasks || []).find((x) => x.provider === GROKBOT || x.model === GROKBOT);
    if (!t) return null;
    return { prior: t.output || "", needs: t.needs || [], target: t.id || GROKBOT, title: t.title || "Grok Bot", instructions: t.instructions || "", task: t };
  }
  return null;
}

function assertReady(run, spec) {
  if (!KINDS.has(run.kind)) throw fail(400, "Replies work on a chat, a council, or a mission.", "kind");
  if (!TERMINAL.has(run.status)) throw fail(409, "This job is still running.", "running");
  if (spec.scope === "answer") {
    if (!answerOf(run, spec.target)) throw fail(404, "That AI has no answer to reply to yet.", "target");
    return;
  }
  if (run.kind === "single" && !answerOf(run, run.model)) throw fail(400, "There is no answer to follow up on yet.", "empty");
  if (run.kind === "council" && !councilMembers(run).length && !grokSeat(run)) throw fail(400, "The council has no answer to follow up on yet.", "empty");
  if (run.kind === "mission") {
    const asm = run.assembler?.provider ? run.assembler : null;
    const fallback = textTasks(run)[0] || (run.tasks || []).find((t) => t.output && t.provider && PROVIDERS[t.provider]?.kind === "text");
    if (!textTasks(run).length && !grokSeat(run) && !asm && !fallback) throw fail(400, "The mission has no answer to follow up on yet.", "empty");
    if (!textTasks(run).length && !grokSeat(run) && !(run.deliverable || fallback?.output)) throw fail(400, "The mission has no answer to follow up on yet.", "empty");
  }
}

async function speak({ run, provider, model, system, messages, scope, target }) {
  const missionId = run.id;
  const agent = `${missionId}:follow:${provider}:${target || "job"}`;
  const mode = run.mode || "balanced";
  emit("agent.start", { agent, provider, model, role: "followup", followup: true, scope, target: target || "", missionId, label: `${nameOf(provider)} replying` });
  const t0 = Date.now();
  let current = agent;
  try {
    const r = await completeFallback(
      { allowStandIn: true, provider, model, maxTokens: 1800, system, messages },
      { missionId, tools: false, role: "followup", mode, cls: run.classification || undefined },
      {
        onDelta: (chunk) => emit("agent.delta", { agent: current, missionId, text: chunk, followup: true, scope, target: target || "", role: "followup" }),
        onFallback: (ev) => {
          run.fallbacks = run.fallbacks || [];
          run.fallbacks.push(fallbackRecord(ev));
          const next = `${missionId}:follow:${ev.to.provider}:${target || "job"}`;
          announceFallback(ev, { missionId, agentFrom: current, agentTo: next, role: "followup" });
          current = next;
        },
      },
    );
    const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId, role: "followup", ms: Date.now() - t0 });
    run.cost = +((Number(run.cost) || 0) + (e.cost || 0)).toFixed(6);
    emit("agent.done", { agent: current, provider: r.provider, model: r.model, missionId, ms: Date.now() - t0, cost: e.cost, followup: true, role: "followup" });
    return { text: r.text || "", provider: r.provider, model: r.model, cost: e.cost || 0 };
  } catch (err) {
    emit("agent.error", { agent: current, provider, model, missionId, error: err.message, followup: true, role: "followup" });
    throw err;
  }
}

function pushAnswer(run, key, userText, reply) {
  const turnUser = { role: "user", text: userText, at: now(), scope: "answer" };
  const turnAi = reply.error
    ? { role: "assistant", text: "", error: reply.error, at: now(), scope: "answer" }
    : { role: "assistant", text: reply.text, at: now(), scope: "answer", provider: reply.provider, model: reply.model, label: nameOf(reply.provider) };
  if (run.kind === "single") {
    run.answerThread = [...(run.answerThread || []), turnUser, turnAi];
    return;
  }
  if (run.kind === "council") {
    const a = run.answers[key];
    a.thread = [...(a.thread || []), turnUser, turnAi];
    return;
  }
  const t = run.tasks.find((x) => x.id === key);
  t.thread = [...(t.thread || []), turnUser, turnAi];
}

function jobPrompt(run) {
  if (run.kind === "mission") {
    const tasks = (run.tasks || []).filter((t) => t.output).map((t) => `## ${t.title}\n${t.output}`).join("\n\n");
    return `GOAL:\n${run.prompt || ""}\n\nTASK OUTPUTS:\n${tasks}\n\nDELIVERABLE:\n${run.deliverable || ""}`;
  }
  return run.prompt || "";
}

async function replyToOne(run, spec) {
  const a = answerOf(run, spec.target);
  const history = historyFor(a.thread, run.kind === "single" ? run.thread : [], a.model);
  const prompt = run.kind === "mission"
    ? `TASK: ${a.task.title}\nINSTRUCTIONS: ${a.task.instructions || ""}`
    : (run.prompt || "");
  const system = run.kind === "mission"
    ? "You already finished your part of a mission. The earlier turns are your task and your output. Answer the person's latest message about your part. Markdown allowed. No filler."
    : "You are continuing this conversation with one person. The earlier turns are the question and your previous answer. Answer the latest message. Use the earlier turns as context. Markdown allowed. No filler.";
  try {
    const spoken = await speak({
      run, provider: a.provider, model: a.model, system, scope: "answer", target: run.kind === "single" ? a.model : spec.target,
      messages: messagesFor({ prompt, prior: a.text, history, followup: spec.text }),
    });
    pushAnswer(run, spec.target, spec.text, spoken);
  } catch (err) {
    pushAnswer(run, spec.target, spec.text, { error: err.message });
  }
}

const REPLY_TASK = "reply-all";
const openRuns = new Map();
const appliedHandoffs = new Set();

function grokPart(job, target) {
  if (job.status === "done") return { provider: GROKBOT, model: GROKBOT, name: "Grok Bot", text: job.text || "", target, jobId: job.id, pending: false };
  return { provider: GROKBOT, model: GROKBOT, name: "Grok Bot", text: "", error: job.error || "Grok Bot reported a failure.", target, jobId: job.id, pending: false };
}

function findGrokPart(run, jobId) {
  for (const t of run.thread || []) {
    const p = (t.parts || []).find((x) => x?.jobId === jobId);
    if (p) return p;
  }
  return null;
}

// Reply to all uses the same handoff as the original job: dispatch, then the callback or the
// built-in mock. A result that is already finished is stored now. One that is still out is
// stored as waiting, and applyReplyHandoff fills it in when the job reaches done or failed.
async function handGrokbot(run, spec, seat) {
  const context = [
    `Earlier question:\n${clip(run.prompt || run.title || "")}`,
    seat.title ? `Your task: ${seat.title}\n${seat.instructions || ""}` : "",
    seat.prior ? `Your earlier result:\n${clip(seat.prior)}` : "You have not reported a result for this job yet.",
    `The person replied to every AI on this ${run.kind}. Continue with that context.`,
  ].filter(Boolean).join("\n\n");
  try {
    const job = await dispatchGrokbot({
      task: spec.text,
      context,
      needs: Array.isArray(seat.needs) ? seat.needs : [],
      source: { kind: run.kind === "mission" ? "mission" : "council", runId: run.id, taskId: REPLY_TASK, projectId: run.projectId || null },
    });
    if (job.status === "failed") {
      appliedHandoffs.add(job.id);
      return grokPart(job, seat.target);
    }
    const fin = await awaitGrokbotJob(job.id, { timeoutMs: 0 });
    if (fin && (fin.status === "done" || fin.status === "failed")) {
      appliedHandoffs.add(fin.id);
      return grokPart(fin, seat.target);
    }
    return { provider: GROKBOT, model: GROKBOT, name: "Grok Bot", text: "", pending: true, target: seat.target, jobId: job.id };
  } catch (err) {
    return { provider: GROKBOT, model: GROKBOT, name: "Grok Bot", text: "", error: err.message, target: seat.target };
  }
}

function markGrokPending(run, seat, part) {
  if (!part?.pending) return;
  if (run.kind === "council" && run.answers?.[GROKBOT]) run.answers[GROKBOT].followPending = true;
  if (seat?.task) seat.task.followPending = true;
}

async function applyReplyHandoff(job) {
  if (job?.source?.taskId !== REPLY_TASK) return;
  if (job.status !== "done" && job.status !== "failed") return;
  if (appliedHandoffs.has(job.id)) return;
  appliedHandoffs.add(job.id);
  const runId = job.source.runId;
  if (!runId) return;
  const run = openRuns.get(runId) || await ctx().store.getMission(runId);
  if (!run) return;
  const part = findGrokPart(run, job.id);
  const next = grokPart(job, part?.target || GROKBOT);
  if (part) Object.assign(part, next);
  else {
    const last = [...(run.thread || [])].reverse().find((t) => t.role === "assistant" && Array.isArray(t.parts));
    if (last) last.parts.push(next);
    else run.thread = [...(run.thread || []), { role: "assistant", text: "", at: now(), scope: "job", label: "Grok Bot", parts: [next] }];
  }
  if (run.kind === "council" && run.answers?.[GROKBOT]) run.answers[GROKBOT].followPending = false;
  if (run.kind === "mission") {
    const t = (run.tasks || []).find((x) => x.provider === GROKBOT || x.model === GROKBOT);
    if (t) t.followPending = false;
  }
  try { ctx().store.saveMission(run); } catch (err) { emit("log", { text: `Grok Bot reply could not be saved: ${err.message}`, level: "error", missionId: run.id }); }
  await publish(run);
}

onJobFinished((job) => {
  applyReplyHandoff(job).catch((err) => emit("log", { text: `Grok Bot reply could not be saved: ${err.message}`, level: "error" }));
});

async function replyToJob(run, spec) {
  const at = now();
  if (run.kind === "council") {
    const members = councilMembers(run);
    const parts = [];
    await Promise.all(members.map(async (m) => {
      const a = run.answers[m.model];
      const history = historyFor(a.thread, run.thread, m.model);
      try {
        const spoken = await speak({
          run, provider: m.provider, model: m.model, scope: "job", target: m.model,
          system: "You are one voice in a council that already answered. The earlier turns are the question and your previous answer. Answer the person's follow-up. Do not repeat the whole previous answer. Markdown allowed.",
          messages: messagesFor({ prompt: run.prompt, prior: a.text, history, followup: spec.text }),
        });
        parts.push({ provider: spoken.provider, model: spoken.model, name: nameOf(spoken.provider), text: spoken.text, target: m.model });
      } catch (err) {
        parts.push({ provider: m.provider, model: m.model, name: nameOf(m.provider), text: "", error: err.message, target: m.model });
      }
    }));
    const good = parts.filter((p) => p.text);
    let verdict = "";
    let chair = run.chair || (members[0] ? { provider: members[0].provider, model: members[0].model } : null);
    if (good.length && chair) {
      const packet = good.map((p) => `### ${p.name}\n${p.text}`).join("\n\n");
      const earlier = [...(run.thread || [])].reverse().find((t) => t.role === "assistant" && t.text)?.text;
      const priorVerdict = (earlier || run.verdict?.text) ? `\n\nPREVIOUS VERDICT:\n${earlier || run.verdict.text}` : "";
      try {
        const spoken = await speak({
          run, provider: chair.provider, model: chair.model, scope: "job", target: "chair",
          system: "You chair this council. Write an updated verdict that answers the follow-up, using the members' new replies. Markdown allowed. Do not mention that you are the chair.",
          messages: messagesFor({ prompt: `QUESTION:\n${run.prompt}${priorVerdict}\n\nNEW REPLIES:\n${packet}`, prior: "", history: [], followup: spec.text }),
        });
        verdict = spoken.text;
        chair = { provider: spoken.provider, model: spoken.model };
      } catch (err) {
        verdict = "";
        parts.push({ provider: chair.provider, model: chair.model, name: nameOf(chair.provider), text: "", error: err.message, target: "chair" });
      }
    }
    const seat = grokSeat(run);
    if (seat) {
      const g = await handGrokbot(run, spec, seat);
      parts.push(g);
      markGrokPending(run, seat, g);
    }
    run.thread = [...(run.thread || []), { role: "user", text: spec.text, at, scope: "job" }, { role: "assistant", text: verdict, at: now(), scope: "job", label: "Council", provider: chair?.provider, model: chair?.model, parts }];
    return;
  }

  if (run.kind === "mission") {
    const tasks = textTasks(run);
    const parts = [];
    await Promise.all(tasks.map(async (t) => {
      const history = historyFor(t.thread, run.thread, t.id);
      try {
        const spoken = await speak({
          run, provider: t.provider, model: t.model, scope: "job", target: t.id,
          system: "You are one of the AIs on this mission. The earlier turns are your task and your output. The person sent a follow-up to every AI on the mission. Answer that follow-up about your part. Markdown allowed. No filler.",
          messages: messagesFor({ prompt: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions || ""}`, prior: t.output, history, followup: spec.text }),
        });
        parts.push({ provider: spoken.provider, model: spoken.model, name: nameOf(spoken.provider), text: spoken.text, target: t.id });
      } catch (err) {
        parts.push({ provider: t.provider, model: t.model, name: nameOf(t.provider), text: "", error: err.message, target: t.id });
      }
    }));
    const seat = grokSeat(run);
    if (seat) {
      const g = await handGrokbot(run, spec, seat);
      parts.push(g);
      markGrokPending(run, seat, g);
    }
    const good = parts.filter((p) => p.text && p.provider !== GROKBOT);
    const asm = run.assembler?.provider && PROVIDERS[run.assembler.provider]?.kind === "text"
      ? run.assembler
      : tasks[0];
    let verdict = "";
    let who = asm;
    if (asm && (good.length || run.deliverable)) {
      const packet = good.map((p) => `### ${p.name}\n${p.text}`).join("\n\n");
      const earlier = (run.thread || []).filter((t) => t.role === "assistant" && t.text).map((t) => t.text).join("\n\n");
      const prompt = `${jobPrompt(run)}${earlier ? `\n\nEARLIER FOLLOW-UPS:\n${earlier}` : ""}${packet ? `\n\nNEW REPLIES:\n${packet}` : ""}`;
      try {
        const spoken = await speak({
          run, provider: asm.provider, model: asm.model, scope: "job", target: "",
          system: "You assembled this mission. The earlier turns are the goal, the task outputs, and the deliverable. Answer the follow-up. Markdown allowed. No filler.",
          messages: messagesFor({ prompt, prior: run.deliverable || "", history: historyFor([], run.thread, "assembler"), followup: spec.text }),
        });
        verdict = spoken.text;
        who = { provider: spoken.provider, model: spoken.model };
      } catch (err) {
        parts.push({ provider: asm.provider, model: asm.model, name: nameOf(asm.provider), text: "", error: err.message, target: "assembler" });
      }
    }
    run.thread = [...(run.thread || []), { role: "user", text: spec.text, at, scope: "job" }, { role: "assistant", text: verdict, at: now(), scope: "job", label: "Mission", provider: who?.provider, model: who?.model, parts }];
    return;
  }

  const single = answerOf(run, run.model);
  const provider = single.provider;
  const model = single.model;
  const prior = run.deliverable || "";
  const history = historyFor(run.answerThread, run.thread, model);
  try {
    const spoken = await speak({
      run, provider, model, scope: "job", target: "",
      system: "You are continuing this conversation with one person. The earlier turns are the question and your previous answer. Answer the latest message. Use the earlier turns as context. Markdown allowed. No filler.",
      messages: messagesFor({ prompt: run.prompt || "", prior, history, followup: spec.text }),
    });
    run.thread = [...(run.thread || []), { role: "user", text: spec.text, at, scope: "job" }, { role: "assistant", text: spoken.text, at: now(), scope: "job", provider: spoken.provider, model: spoken.model, label: nameOf(spoken.provider) }];
  } catch (err) {
    run.thread = [...(run.thread || []), { role: "user", text: spec.text, at, scope: "job" }, { role: "assistant", text: "", error: err.message, at: now(), scope: "job" }];
  }
}

function publish(run) {
  if (run.kind === "council") {
    emit("council.update", { council: run });
    return;
  }
  if (run.kind === "mission") {
    // Lazy import keeps mission.js from loading this module in a circle.
    return import("./mission.js").then(({ publicMission }) => {
      emit("mission.update", { mission: publicMission(run) });
    });
  }
  const title = String(run.prompt || run.title || "").slice(0, 90);
  emit("mission.update", { mission: { ...run, title, tasks: run.tasks || [] } });
}

async function runFollowup(run, spec) {
  openRuns.set(run.id, run);
  try {
    try {
      if (spec.scope === "answer") await replyToOne(run, spec);
      else await replyToJob(run, spec);
    } catch (err) {
      emit("log", { text: `Reply failed: ${err.message}`, level: "error", missionId: run.id });
    }
    try { ctx().store.saveMission(run); } catch (err) { emit("log", { text: `Reply could not be saved: ${err.message}`, level: "error", missionId: run.id }); }
    await publish(run);
  } finally {
    openRuns.delete(run.id);
  }
}

export async function beginFollowup(body) {
  const spec = parse(body || {});
  const user = ctx();
  const key = `${user.userId || "local"}:${spec.runId}`;
  if (busy.has(key)) throw fail(409, "A reply is already on the way for this job.", "busy");
  busy.add(key);
  try {
    const run = await user.store.getMission(spec.runId);
    if (!run) throw fail(404, "That job was not found.", "missing");
    assertReady(run, spec);
    const job = runFollowup(run, spec);
    job.finally(() => busy.delete(key)).catch(() => {});
    return { ok: true, runId: run.id };
  } catch (err) {
    busy.delete(key);
    throw err;
  }
}
