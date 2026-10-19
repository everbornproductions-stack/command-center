// Mission mode: marching orders in, a finished deliverable out.
// 1. A planner model breaks the goal into tasks with a capability tag and dependencies.
// 2. The router assigns each task to the best available AI (mode: quality / balanced / economy).
// 3. Tasks run in dependency waves, in parallel, streaming. Each AI may run as several
//    sub-agents (one per task). A different AI QA-reviews each deliverable when qa is on.
// 4. An assembler compiles the final deliverable.
import { PROVIDERS } from "./registry.js";
import { complete, extractJson } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall } from "./health.js";
import { emit } from "./events.js";
import { classify, pick, rank } from "./router.js";
import { ctx, doc, putDoc } from "./store.js";
import { augment as webAugment, sourcesBlock } from "./search.js";
import { fallbackChat, completeFallback, fallbackRecord, announce as announceFallback, troubleKind } from "./fallback.js";
import { observe } from "./brain.js";
import { AGENT_ID as GROKBOT } from "./grokbot.js";
import { missionAgent, agentName, cancelAgentJob, onAnyJobFinished } from "./agents.js";

const running = new Map(); // id -> AbortController (ids are unique across users)
const scheduledOf = () => ctx().scheduled; // per user: id -> { timer, mission, opts }
const saveDoc = (m) => ctx().store.saveMission(m, missionSummary(m));

// Compact row for lists (the same shape index.js used to build from the files).
export function missionSummary(m) {
  return { id: m.id, kind: m.kind, title: m.title || m.prompt?.slice(0, 90), projectId: m.projectId, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt || null, cost: m.cost, tasks: m.tasks?.length || 0, providers: [...new Set((m.tasks || []).map((t) => t.provider))].concat(m.provider ? [m.provider] : []) };
}

export function abortMission(id) {
  const scheduled = scheduledOf();
  if (scheduled.has(id)) {
    clearTimeout(scheduled.get(id).timer);
    const m = scheduled.get(id).mission;
    scheduled.delete(id); persistScheduled();
    m.status = "cancelled"; m.finishedAt = Date.now();
    emit("mission.update", { mission: m });
    emit("log", { text: `Scheduled mission cancelled: ${m.title}`, missionId: id });
    return true;
  }
  running.get(id)?.abort();
  return running.has(id);
}

function persistScheduled() {
  putDoc("scheduled", [...scheduledOf().values()].map((s) => ({ mission: s.mission, opts: s.opts })));
}
// Queue a mission for a cheaper window (the next time-of-day discount) instead of running now.
export function scheduleMission(opts, at, reason) {
  const id = "q-" + Date.now().toString(36);
  const mission = { id, kind: "mission", title: opts.goal.slice(0, 90), prompt: opts.goal, projectId: opts.projectId || null, mode: opts.mode, status: "scheduled", startedAt: Date.now(), scheduledFor: at.getTime(), reason, tasks: [], cost: 0, log: [] };
  const delay = Math.max(0, at.getTime() - Date.now());
  const scheduled = scheduledOf();
  const timer = setTimeout(() => {
    scheduled.delete(id); persistScheduled();
    mission.status = "started"; mission.finishedAt = Date.now();
    saveDoc(mission);
    emit("mission.update", { mission });
    emit("log", { text: `Off-peak window open: starting "${mission.title}".`, missionId: id });
    runMission(opts).catch((e) => emit("log", { text: `Mission failed: ${e.message}`, level: "error" }));
  }, delay);
  timer.unref?.();
  scheduled.set(id, { timer, mission, opts, at: at.getTime() });
  persistScheduled();
  saveDoc(mission);
  emit("mission.update", { mission });
  emit("log", { text: `Mission queued for ${at.toLocaleString()} (${reason}).`, missionId: id });
  return mission;
}
export const scheduledMissions = () => [...scheduledOf().values()].map((s) => s.mission);
export function restoreScheduled() {
  const list = doc("scheduled", () => []);
  for (const s of list) {
    const at = new Date(Math.max(Date.now() + 5000, s.mission.scheduledFor || 0));
    scheduleMission(s.opts, at, s.mission.reason || "restored after restart");
  }
}

export async function runMission({ goal, mode = "balanced", projectId, qa = true, budgetUsd = 2, maxTasks = 6, context = "", search, tools, grokbot, browser }) {
  const id = "m-" + Date.now().toString(36);
  const ctl = new AbortController();
  running.set(id, ctl);
  lateWhileRunning.set(id, []);
  const t0 = Date.now();
  const mission = { id, kind: "mission", prompt: goal, projectId: projectId || null, mode, qa, budgetUsd, status: "planning", startedAt: t0, tasks: [], plan: null, cost: 0, deliverable: null, log: [], sources: [], toolCalls: [], fallbacks: [] };
  const log = (text, extra = {}) => { mission.log.push({ ts: Date.now(), text }); emit("log", { text, missionId: id, ...extra }); };
  const update = () => { emit("mission.update", { mission: publicMission(mission) }); save(mission); };
  const spend = (e) => { mission.cost = +(mission.cost + e.cost).toFixed(5); };
  const spendEntry = (e) => { spend(e); return e; };
  const explicitSearch = typeof search === "boolean" ? search : undefined;
  // smart fallback (Phase 26): every hop is kept on the mission and announced in the feed
  const stoodIn = (ev, agent, role, taskId = null) => { mission.fallbacks.push(fallbackRecord(ev)); announceFallback(ev, { missionId: id, taskId, agentFrom: agent, agentTo: agent, role }); };

  try {
    update();
    const cls = await classify(goal, { onCall: (c) => { spend(recordCall({ ...c, missionId: id })); } });
    mission.classification = cls;

    // ---- live web search (Phase 15): one search on the goal; the sources ride along as context ----
    const web = await webAugment({ prompt: goal, kind: "mission", missionId: id, explicit: explicitSearch });
    const searchOn = !!web && !web.native && !web.skipped;
    if (web?.native) log("Search the web is set to the model's own search, which missions cannot use. Pick Tavily, Brave or Serper in Settings > Web search.");
    if (web?.sources?.length) { mission.sources = web.sources; mission.searchEngine = web.name; spend({ cost: web.cost || 0 }); context = `${context ? `${context}\n\n` : ""}${web.block}`; }

    // Grok Bot (Phase 12), else the built-in browser helper (Phase 27): offered to the planner only when it
    // is ready and not left out by the person
    const MA = missionAgent({ grokbot, browser });
    const agentOn = !!MA;
    const agentLine = !agentOn ? "" : MA.id === GROKBOT
      ? `\nA step that must act in the person's signed-in browser, Gmail, Google Drive, Google Calendar or with their teammate bots gets capability "agent" and "needs": a list from ${JSON.stringify(MA.TAGS)}; their own assistant, ${MA.name}, does those steps. Never use "agent" for plain writing, research or analysis.`
      : `\nA step that must act on a website (signed-in pages, forms), in the person's Gmail or in their Google Drive gets capability "agent" and "needs": a list from ${JSON.stringify(MA.TAGS)}; the built-in ${MA.name} does those steps in its own browser window (every send, post or form submit waits for the person's OK). Never use "agent" for plain writing, research or analysis.`;

    // ---- 1. Plan ----
    const planner = pick({ capability: "reasoning", difficulty: 3, mode: mode === "economy" ? "balanced" : "quality" });
    if (!planner) throw new Error("No AI is available to plan. Add an API key in Settings.");
    mission.planner = { provider: planner.provider, model: planner.model };
    const pAgent = `${id}:planner`;
    emit("agent.start", { agent: pAgent, provider: planner.provider, model: planner.model, role: "plan", missionId: id, label: `${planner.providerName} planning` });
    log(`${planner.providerName} is drawing up the plan.`);
    const s0 = Date.now();
    let plan;
    try {
      const r = await completeFallback({
        provider: planner.provider, model: planner.model, maxTokens: 1500, signal: ctl.signal,
        system: `You are the chief of staff for a small creative/marketing business. Break the goal into ${Math.min(maxTasks, 6)} or fewer concrete tasks that different AI specialists can do independently, with dependencies where one needs another's output. Reply with JSON only:
{"title": "<=8 words", "tasks": [{"id": "t1", "title": "<=10 words", "capability": "reasoning|code|writing|research|creative|analysis|math${agentOn ? "|agent" : ""}", "difficulty": 1|2|3, "needWeb": false, "deps": [], "instructions": "precise instructions for the specialist, 1-3 sentences", "deliverable": "what the output must contain"}], "assembly": "how the final deliverable should be put together, 1-2 sentences"}
Keep it tight: no task that just restates the goal. Research tasks need needWeb true only if live information is required.${agentLine}`,
        messages: [{ role: "user", content: `GOAL:\n${goal}${context ? `\n\nCONTEXT:\n${context}` : ""}` }],
      }, { missionId: id, role: "plan", tools: false, cls: { capability: "reasoning", difficulty: 3 }, mode: mode === "economy" ? "balanced" : "quality" }, { onFallback: (ev) => { stoodIn(ev, pAgent, "plan"); mission.planner = { provider: ev.to.provider, model: ev.to.model, standIn: { for: ev.from.provider, reason: ev.reason, via: ev.via || null } }; } });
      const ms = Date.now() - s0;
      noteCall(r.provider, true, ms);
      spend(recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, role: "plan", ms }));
      plan = extractJson(r.text);
      emit("agent.done", { agent: pAgent, provider: r.provider, model: r.model, missionId: id, ms });
    } catch (err) {
      noteCall(planner.provider, false, Date.now() - s0, err.status);
      emit("agent.error", { agent: pAgent, provider: planner.provider, model: planner.model, missionId: id, error: err.message });
      throw err;
    }
    if (!plan?.tasks?.length) {
      plan = { title: goal.slice(0, 40), tasks: [{ id: "t1", title: "Do the job", capability: cls.capability, difficulty: cls.difficulty, needWeb: cls.needWeb, deps: [], instructions: goal, deliverable: "The complete answer" }], assembly: "Use the single task output." };
    }
    plan.tasks = plan.tasks.slice(0, maxTasks).map((t, i) => ({ ...t, id: t.id || `t${i + 1}`, deps: (t.deps || []).filter(Boolean) }));
    mission.plan = { title: plan.title, assembly: plan.assembly };
    mission.title = plan.title;

    // ---- 2. Assign ----
    // a task that needs live information is limited to models with their own web access, unless the
    // search engine is on: then any model can do it, because the task gets its own search results
    const needsWebModel = (t) => !!t.needWeb && !searchOn;
    const used = new Map();
    for (const t of plan.tasks) {
      // a step that needs signed-in browsing, Gmail, Drive, Calendar or teammate bots goes to the agent
      const fit = agentOn ? MA.want({ prompt: `${t.title}. ${t.instructions || ""}`, explicit: MA.id === GROKBOT ? grokbot : browser }) : null;
      if (agentOn && (t.capability === "agent" || (fit.use && fit.needs.length))) {
        const needs = [...new Set([...(Array.isArray(t.needs) ? t.needs.filter((x) => MA.TAGS.includes(x)) : []), ...fit.needs])];
        mission.tasks.push({ ...t, capability: "agent", needs, agent: true, status: "queued", provider: MA.id, model: MA.id, agentName: `${MA.name} · ${needs.map((x) => MA.TAG_LABEL[x]).join(", ") || (MA.id === GROKBOT ? "its own computer" : "its own window")}`, estCost: 0, output: null, review: null, cost: 0 });
        continue;
      }
      if (t.capability === "agent") t.capability = "research"; // nobody to hand it to: the best text AI does what it can
      const ranked = rank({ capability: t.capability || "reasoning", difficulty: Number(t.difficulty) || 2, mode, needWeb: needsWebModel(t) });
      // spread the load: prefer a provider not already carrying 2 tasks when scores are close
      let choice = ranked[0];
      for (const c of ranked.slice(0, 4)) {
        if ((used.get(c.provider) || 0) < 2 && c.score >= (ranked[0].score - 6)) { choice = c; break; }
      }
      if (!choice) choice = ranked[0];
      if (!choice) throw new Error(`No AI available for task "${t.title}" (${t.capability}${t.needWeb ? ", needs web: turn on Search the web or add a Perplexity key" : ""}).`);
      used.set(choice.provider, (used.get(choice.provider) || 0) + 1);
      mission.tasks.push({ ...t, status: "queued", provider: choice.provider, model: choice.model, agentName: `${choice.providerName} · ${t.capability}`, estCost: choice.estCost, output: null, review: null, cost: 0 });
    }
    const est = mission.tasks.reduce((a, t) => a + t.estCost, 0) * (qa ? 1.6 : 1.1);
    mission.estimatedCost = +est.toFixed(4);
    const agentTasks = mission.tasks.filter((t) => t.agent).length;
    log(`Plan: ${mission.tasks.length} tasks → ${[...used.keys()].map((p) => PROVIDERS[p].name).concat(agentTasks ? [`${MA.name} (${agentTasks}, results are async and can take minutes)`] : []).join(", ")}. Estimated $${est.toFixed(3)}.`);
    if (est > budgetUsd) {
      log(`Estimate exceeds the $${budgetUsd} budget. Switching every task to economy mode.`);
      for (const t of mission.tasks) {
        if (t.agent) continue;
        const e = pick({ capability: t.capability, difficulty: t.difficulty, mode: "economy", needWeb: needsWebModel(t) });
        if (e) { t.provider = e.provider; t.model = e.model; t.agentName = `${e.providerName} · ${t.capability}`; t.estCost = e.estCost; }
      }
    }
    mission.status = "running";
    update();

    // ---- 3. Execute in waves ----
    const done = new Set();
    const outputs = {};
    // An agent step (Grok Bot or the browser helper): hand it over, then wait for the result (up to the
    // mission wait). A result that comes back later is added to this mission by the finish listener at the end of this file.
    const agentTask = async (t) => {
      const agent = `${id}:${t.id}`;
      const AID = MA.id, ANAME = MA.name;
      t.status = "running"; t.startedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      emit("agent.start", { agent, provider: AID, model: AID, role: "work", missionId: id, taskId: t.id, label: `${ANAME}: ${t.title} (results are async and can take minutes)` });
      for (const d of t.deps) { const dep = mission.tasks.find((x) => x.id === d); if (dep && dep.provider !== AID) emit("agent.msg", { from: dep.provider, to: AID, missionId: id, text: `handing off "${dep.title}"` }); }
      const inputs = t.deps.map((d) => `### Input from task "${mission.tasks.find((x) => x.id === d)?.title}"\n${outputs[d] || "(missing)"}`).join("\n\n");
      const s = Date.now();
      try {
        const job = await MA.dispatch({ task: `${t.title}\n${t.instructions || ""}\nDeliverable: ${t.deliverable || "a short report of what was done"}`, context: [`Mission goal: ${goal}`, inputs, context].filter(Boolean).join("\n\n"), needs: t.needs, source: { kind: "mission", runId: id, taskId: t.id, projectId } });
        t.agentJob = { jobId: job.id, status: job.status };
        if (job.status === "failed") throw new Error(job.error);
        emit("task.update", { missionId: id, task: pubTask(t) }); update();
        const fin = await MA.awaitJob(job.id, { timeoutMs: MA.waitMs("mission"), signal: ctl.signal, onUpdate: (j) => { t.agentJob.status = j.status; emit("task.update", { missionId: id, task: pubTask(t) }); update(); } });
        if (fin) t.agentJob.status = fin.status;
        if (fin?.status === "done") {
          t.output = fin.text || `${ANAME} reported this step done.`; t.artifacts = fin.artifacts || []; outputs[t.id] = t.output; t.status = "done";
          t.work = { cost: 0, ms: Date.now() - s, free: true };
          observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: id, ok: true, cost: 0, ms: Date.now() - s });
          emit("agent.done", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, ms: Date.now() - s, cost: 0 });
        } else if (fin?.status === "failed") {
          throw new Error(fin.error || `${ANAME} reported a failure`);
        } else if (ctl.signal.aborted) {
          try { cancelAgentJob(job.id, "mission aborted"); } catch {}
          t.status = "failed"; t.error = "Mission aborted";
        } else {
          // still out: dependents go on without it; its result is added to this mission when it comes back
          t.status = "waiting"; outputs[t.id] = `(${ANAME} is still working on "${t.title}"; its result is added to this mission when it comes back.)`;
          log(`${ANAME} is still on "${t.title}" (${MA.STATUS_LABEL[t.agentJob.status].toLowerCase()}). The mission goes on; the result is added here when it comes back${AID === GROKBOT ? `, or paste it in on the ${ANAME} card` : ""}.`);
          emit("agent.done", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, ms: Date.now() - s, cost: 0 });
        }
      } catch (err) {
        t.status = "failed"; t.error = err.message;
        emit("agent.error", { agent, provider: AID, model: AID, missionId: id, taskId: t.id, error: err.message });
      }
      if (t.status !== "failed") done.add(t.id);
      t.finishedAt = Date.now();
      emit("task.update", { missionId: id, task: pubTask(t) });
      update();
    };
    while (done.size < mission.tasks.length) {
      if (ctl.signal.aborted) throw new Error("Mission aborted");
      const wave = mission.tasks.filter((t) => !done.has(t.id) && t.status !== "failed" && t.deps.every((d) => done.has(d)));
      if (!wave.length) {
        // unresolved deps (cycle or failed dep): run the rest without inputs
        const rest = mission.tasks.filter((t) => !done.has(t.id) && t.status !== "failed");
        if (!rest.length) break;
        for (const t of rest) t.deps = [];
        continue;
      }
      await Promise.all(wave.map(async (t) => {
        if (t.agent) return agentTask(t);
        const agent = `${id}:${t.id}`;
        t.status = "running"; t.startedAt = Date.now();
        emit("task.update", { missionId: id, task: pubTask(t) });
        emit("agent.start", { agent, provider: t.provider, model: t.model, role: "work", missionId: id, taskId: t.id, label: `${PROVIDERS[t.provider].name}: ${t.title}` });
        for (const d of t.deps) { const dep = mission.tasks.find((x) => x.id === d); if (dep && dep.provider !== t.provider) emit("agent.msg", { from: dep.provider, to: t.provider, missionId: id, text: `handing off "${dep.title}"` }); }
        const inputs = t.deps.map((d) => `### Input from task "${mission.tasks.find((x) => x.id === d)?.title}"\n${outputs[d] || "(missing)"}`).join("\n\n");
        // a task that needs live information gets its own search, numbered after the mission's sources
        let taskWeb = "";
        if (searchOn && t.needWeb && !ctl.signal.aborted) {
          const tw = await webAugment({ prompt: `${t.title}. ${t.instructions || ""}`, kind: "mission", missionId: id, taskId: t.id, explicit: true, offset: mission.sources.length, role: "task-search" });
          if (tw?.sources?.length) { mission.sources = [...mission.sources, ...tw.sources]; mission.searchEngine = mission.searchEngine || tw.name; spend({ cost: tw.cost || 0 }); taskWeb = tw.block; update(); }
        }
        const s = Date.now();
        let text = "";
        try {
          // MCP tools (Phase 16) ride along for specialists that can call them; writes ask first.
          // Smart fallback (Phase 26): a specialist whose provider is out of credits, rate limited or refusing
          // its key is replaced (same model via OpenRouter first, then the next-best model) and the task says so.
          for await (const ev of fallbackChat({
            provider: t.provider, model: t.model, maxTokens: 2500, signal: ctl.signal,
            system: `You are a specialist (${t.capability}) on a team working toward this goal:\n${goal}\n\nDo only your task. Output the deliverable itself in Markdown, no preamble, no questions back.`,
            messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE: ${t.deliverable}${inputs ? `\n\n${inputs}` : ""}${context ? `\n\nCONTEXT:\n${context}` : ""}${taskWeb ? `\n\n${taskWeb}` : ""}` }],
          }, { missionId: id, taskId: t.id, tools, role: "work", mode, cls: { capability: t.capability, difficulty: t.difficulty, needWeb: needsWebModel(t) } })) {
            if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, taskId: t.id, text: ev.text }); }
            else if (ev.type === "fallback") {
              text = ""; stoodIn(ev, agent, "work", t.id);
              t.provider = ev.to.provider; t.model = ev.to.model; t.agentName = `${ev.to.providerName} · ${t.capability} (for ${ev.from.providerName})`; t.retried = true; t.standIn = { for: ev.from.provider, forModel: ev.from.model, reason: ev.reason, via: ev.via || null };
              emit("task.update", { missionId: id, task: pubTask(t) }); update();
            }
            else if (ev.type === "tool" && ev.phase === "done") { mission.toolCalls.push({ taskId: t.id, by: t.provider, tool: ev.tool, server: ev.server, ok: ev.ok, denied: ev.denied, ms: ev.ms }); t.toolCalls = (t.toolCalls || 0) + 1; update(); }
            else if (ev.type === "done") {
              const ms = Date.now() - s;
              noteCall(t.provider, true, ms);
              const e = recordCall({ provider: t.provider, model: t.model, usage: ev.usage, missionId: id, taskId: t.id, role: "work", ms });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              t.work = { cost: e.cost, ms, free: !!e.free };
              emit("agent.done", { agent, provider: t.provider, model: t.model, missionId: id, taskId: t.id, ms, cost: e.cost });
            }
          }
          t.output = text;
          outputs[t.id] = text;
          t.status = qa ? "review" : "done";
        } catch (err) {
          noteCall(t.provider, false, Date.now() - s, err.status);
          emit("agent.error", { agent, provider: t.provider, model: t.model, missionId: id, taskId: t.id, error: err.message });
          // learning router (Phase 28): a model that failed the job itself is marked; account trouble is not held against it
          if (!troubleKind(err) && !ctl.signal.aborted) observe({ provider: t.provider, model: t.model, capability: t.capability, difficulty: t.difficulty, runId: id, ok: false });
          // one retry on a different provider
          const alt = rank({ capability: t.capability, difficulty: t.difficulty, mode, needWeb: needsWebModel(t), exclude: [t.model] }).find((m) => m.provider !== t.provider);
          if (alt && !ctl.signal.aborted) {
            log(`${PROVIDERS[t.provider].name} failed "${t.title}" (${err.message.slice(0, 80)}). Re-assigning to ${alt.providerName}.`);
            emit("agent.msg", { from: t.provider, to: alt.provider, missionId: id, text: `re-assign "${t.title}"` });
            t.provider = alt.provider; t.model = alt.model; t.agentName = `${alt.providerName} · ${t.capability}`; t.retried = true;
            const s2 = Date.now();
            try {
              const r = await complete({ provider: alt.provider, model: alt.model, maxTokens: 2500, signal: ctl.signal, system: `You are a specialist (${t.capability}). Goal: ${goal}. Do only your task; output the deliverable in Markdown.`, messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE: ${t.deliverable}${inputs ? `\n\n${inputs}` : ""}` }] }, (d) => emit("agent.delta", { agent, missionId: id, taskId: t.id, text: d }));
              noteCall(alt.provider, true, Date.now() - s2);
              const e = recordCall({ provider: alt.provider, model: alt.model, usage: r.usage, missionId: id, taskId: t.id, role: "work", ms: Date.now() - s2 });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              t.work = { cost: e.cost, ms: Date.now() - s2, free: !!e.free };
              t.output = r.text; outputs[t.id] = r.text; t.status = qa ? "review" : "done";
            } catch (err2) {
              noteCall(alt.provider, false, Date.now() - s2, err2.status);
              if (!troubleKind(err2) && !ctl.signal.aborted) observe({ provider: alt.provider, model: alt.model, capability: t.capability, difficulty: t.difficulty, runId: id, ok: false });
              t.status = "failed"; t.error = err2.message;
            }
          } else { t.status = "failed"; t.error = err.message; }
        }
        emit("task.update", { missionId: id, task: pubTask(t) });

        // ---- QA by a different AI ----
        if (t.status === "review") {
          // QA is a small job: free tiers first (Phase 26)
          const reviewer = rank({ capability: "analysis", difficulty: 2, mode: mode === "quality" ? "balanced" : "economy", exclude: [t.model], small: true }).find((m) => m.provider !== t.provider) || rank({ capability: "analysis", mode: "economy", small: true })[0];
          if (reviewer) {
            const ragent = `${id}:${t.id}:qa`;
            emit("agent.msg", { from: t.provider, to: reviewer.provider, missionId: id, text: `QA "${t.title}"` });
            emit("agent.start", { agent: ragent, provider: reviewer.provider, model: reviewer.model, role: "qa", missionId: id, taskId: t.id, label: `${reviewer.providerName} checking "${t.title}"` });
            const s3 = Date.now();
            try {
              const r = await completeFallback({ provider: reviewer.provider, model: reviewer.model, maxTokens: 500, signal: ctl.signal, system: `You QA another AI's deliverable. Reply with JSON only: {"pass": true|false, "score": 1-10, "issues": ["<=15 words each", ...], "fix": "if not pass, the single most important correction in <=40 words"}`, messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE REQUIRED: ${t.deliverable}\n\nOUTPUT TO CHECK:\n${t.output.slice(0, 12000)}` }] },
                { missionId: id, taskId: t.id, role: "qa", small: true, tools: false, cls: { capability: "analysis", difficulty: 2 }, mode: "economy", avoid: [{ provider: t.provider, model: t.model }] }, { onFallback: (ev) => stoodIn(ev, ragent, "qa", t.id) });
              const ms = Date.now() - s3;
              noteCall(r.provider, true, ms);
              const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, taskId: t.id, role: "qa", ms });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              const j = extractJson(r.text) || { pass: true, score: null, issues: [] };
              t.review = { provider: r.provider, model: r.model, pass: j.pass !== false, score: j.score ?? null, issues: j.issues || [], fix: j.fix || null };
              emit("agent.done", { agent: ragent, provider: r.provider, model: r.model, missionId: id, taskId: t.id, ms, cost: e.cost });
              if (!t.review.pass && t.review.fix && !ctl.signal.aborted) {
                emit("agent.msg", { from: r.provider, to: t.provider, missionId: id, text: `revise: ${t.review.fix.slice(0, 60)}` });
                const s4 = Date.now();
                try {
                  const r2 = await completeFallback({ provider: t.provider, model: t.model, maxTokens: 2500, signal: ctl.signal, system: `Revise your deliverable. Apply the QA correction and output the full corrected deliverable in Markdown, nothing else.`, messages: [{ role: "user", content: `TASK: ${t.title}\n\nYOUR DRAFT:\n${t.output}\n\nQA CORRECTION:\n${t.review.fix}\nISSUES: ${(t.review.issues || []).join("; ")}` }] },
                    { missionId: id, taskId: t.id, role: "revise", tools: false, cls: { capability: t.capability, difficulty: t.difficulty }, mode }, { onDelta: (d) => emit("agent.delta", { agent, missionId: id, taskId: t.id, text: d }), onFallback: (ev) => stoodIn(ev, agent, "revise", t.id) });
                  noteCall(r2.provider, true, Date.now() - s4);
                  const e2 = recordCall({ provider: r2.provider, model: r2.model, usage: r2.usage, missionId: id, taskId: t.id, role: "revise", ms: Date.now() - s4 });
                  spend(e2); t.cost = +(t.cost + e2.cost).toFixed(5);
                  t.output = r2.text; outputs[t.id] = r2.text; t.revised = true;
                } catch (err3) { noteCall(t.provider, false, Date.now() - s4, err3.status); }
              }
            } catch (err) {
              noteCall(reviewer.provider, false, Date.now() - s3, err.status);
              emit("agent.error", { agent: ragent, provider: reviewer.provider, model: reviewer.model, missionId: id, taskId: t.id, error: err.message });
            }
          }
          t.status = "done";
        }
        if (t.status === "done") {
          done.add(t.id);
          // learning router (Phase 28): the job, its QA score, what the work call cost and how long it took
          observe({ provider: t.provider, model: t.model, capability: t.capability, difficulty: t.difficulty, runId: id, ok: true, qa: t.review?.score ?? null, cost: t.work?.cost ?? null, ms: t.work?.ms ?? null, free: !!t.work?.free });
        }
        t.finishedAt = Date.now();
        emit("task.update", { missionId: id, task: pubTask(t) });
        update();
      }));
      // failed tasks count as resolved so the loop ends
      for (const t of mission.tasks) if (t.status === "failed") done.add(t.id);
    }

    // ---- 4. Assemble ----
    const finished = mission.tasks.filter((t) => t.output);
    const waiting = mission.tasks.filter((t) => t.status === "waiting");
    if (!finished.length && !waiting.length) throw new Error("Every task failed.");
    const pendingNote = waiting.length ? `\n\n---\n**Still waiting on ${MA.name}:** ${waiting.map((t) => `"${t.title}"`).join(", ")}. Each result is added to this mission when it comes back${MA.id === GROKBOT ? `, or paste it in on the ${MA.name} card` : ""}.` : "";
    if (!finished.length) mission.deliverable = pendingNote.trim();
    else await assemble(plan, planner);
    if (finished.length && pendingNote) mission.deliverable = (mission.deliverable || "") + pendingNote;
    mission.status = mission.tasks.some((t) => t.status === "failed") ? "done-with-errors" : "done";
  } catch (err) {
    mission.status = ctl.signal.aborted ? "aborted" : "failed";
    mission.error = err.message;
    log(`Mission ${mission.status}: ${err.message}`);
  } finally {
    running.delete(id);
    mission.finishedAt = Date.now();
    update();
    log(`Mission ${mission.status} in ${((mission.finishedAt - t0) / 1000).toFixed(0)}s, $${mission.cost.toFixed(4)}.`);
    for (const job of lateWhileRunning.get(id) || []) lateResult(job).catch((e) => console.error("[mission] late result:", e.message));
    lateWhileRunning.delete(id);
  }
  return mission;

  async function assemble(plan, planner) {
    const finished = mission.tasks.filter((t) => t.output);
    mission.status = "assembling"; update();
    const asm = { ...(pick({ capability: "writing", difficulty: 3, mode: mode === "economy" ? "balanced" : "quality" }) || planner) };
    mission.assembler = { provider: asm.provider, model: asm.model };
    const aAgent = `${id}:assembler`;
    emit("agent.start", { agent: aAgent, provider: asm.provider, model: asm.model, role: "assemble", missionId: id, label: `${asm.providerName} assembling the deliverable` });
    for (const t of finished) if (t.provider !== asm.provider) emit("agent.msg", { from: t.provider, to: asm.provider, missionId: id, text: `deliver "${t.title}"` });
    const s5 = Date.now();
    let text = "";
    try {
      for await (const ev of fallbackChat({
        provider: asm.provider, model: asm.model, maxTokens: 4000, signal: ctl.signal,
        system: `You assemble the final deliverable for the user from the team's task outputs. Assembly guidance: ${plan.assembly || "combine into one clean document"}. Output the deliverable in Markdown, well structured, no preamble. Do not mention tasks or teams; just deliver.${mission.sources.length ? " Keep every [n] citation exactly as written; the numbers refer to the web sources listed at the end." : ""}`,
        messages: [{ role: "user", content: `GOAL:\n${goal}\n\n${finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n")}${mission.sources.length ? `\n\n${sourcesBlock(mission.sources, mission.searchEngine)}` : ""}` }],
      }, { missionId: id, role: "assemble", tools: false, cls: { capability: "writing", difficulty: 3 }, mode: mode === "economy" ? "balanced" : "quality" })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent: aAgent, missionId: id, text: ev.text }); }
        else if (ev.type === "fallback") { text = ""; stoodIn(ev, aAgent, "assemble"); asm.provider = ev.to.provider; asm.model = ev.to.model; mission.assembler = { provider: asm.provider, model: asm.model, standIn: { for: ev.from.provider, reason: ev.reason, via: ev.via || null } }; update(); }
        else if (ev.type === "done") {
          const ms = Date.now() - s5;
          noteCall(asm.provider, true, ms);
          const e = spendEntry(recordCall({ provider: asm.provider, model: asm.model, usage: ev.usage, missionId: id, role: "assemble", ms }));
          observe({ provider: asm.provider, model: asm.model, capability: "writing", difficulty: 3, runId: id, ok: true, cost: e.cost, ms, free: e.free });
          emit("agent.done", { agent: aAgent, provider: asm.provider, model: asm.model, missionId: id, ms });
        }
      }
      mission.deliverable = text;
    } catch (err) {
      noteCall(asm.provider, false, Date.now() - s5, err.status);
      if (!troubleKind(err) && !ctl.signal.aborted) observe({ provider: asm.provider, model: asm.model, capability: "writing", difficulty: 3, runId: id, ok: false });
      emit("agent.error", { agent: aAgent, provider: asm.provider, model: asm.model, missionId: id, error: err.message });
      mission.deliverable = finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n");
    }
  }
}

function pubTask(t) {
  return { id: t.id, title: t.title, capability: t.capability, difficulty: t.difficulty, deps: t.deps, status: t.status, provider: t.provider, model: t.model, agentName: t.agentName, estCost: t.estCost, cost: t.cost, review: t.review, retried: !!t.retried, revised: !!t.revised, standIn: t.standIn || null, error: t.error || null, startedAt: t.startedAt || null, finishedAt: t.finishedAt || null, chars: t.output ? t.output.length : 0, toolCalls: t.toolCalls || 0, agent: !!t.agent, needs: t.needs || null, agentJob: t.agentJob || null, artifacts: t.artifacts || null, late: !!t.late };
}
export function publicMission(m) {
  return { id: m.id, kind: m.kind, title: m.title || m.prompt.slice(0, 90), prompt: m.prompt, projectId: m.projectId, mode: m.mode, qa: m.qa, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt || null, cost: m.cost, estimatedCost: m.estimatedCost, budgetUsd: m.budgetUsd, planner: m.planner, assembler: m.assembler, plan: m.plan, classification: m.classification, tasks: m.tasks.map(pubTask), deliverable: m.deliverable, error: m.error || null, log: m.log, sources: m.sources || [], searchEngine: m.searchEngine || null, toolCalls: m.toolCalls || [], fallbacks: m.fallbacks || [] };
}
function save(m) {
  saveDoc(m);
}

// ---- an agent's result (Grok Bot or the browser helper) that came back after its mission moved on (or after a restart) ----
// It lands on its task and is added to the deliverable under the task's title.
const lateWhileRunning = new Map(); // mission id -> jobs that finished after the wait, while the mission still ran
onAnyJobFinished(lateResult);
async function lateResult(job) {
  if (job.source?.kind !== "mission" || !job.source.runId) return;
  if (lateWhileRunning.has(job.source.runId)) { lateWhileRunning.get(job.source.runId).push(job); return; }
  const m = await ctx().store.getMission(job.source.runId);
  const t = m?.tasks?.find((x) => x.agentJob?.jobId === job.id);
  if (!t) return;
  const AID = job.agent || t.provider || GROKBOT, ANAME = agentName(AID);
  t.agentJob.status = job.status; t.late = true; t.finishedAt = Date.now();
  if (job.status === "done") {
    t.status = "done"; t.error = null; t.output = job.text || `${ANAME} reported this step done.`; t.artifacts = job.artifacts || [];
    const by = job.by === "you" ? "pasted in by you" : `from ${ANAME}, after the rest of the mission`;
    m.deliverable = `${m.deliverable || ""}\n\n## ${t.title} (${by})\n\n${t.output}`.trim();
    observe({ provider: AID, model: AID, capability: "agent", difficulty: t.difficulty, runId: m.id, ok: true, cost: 0 });
  } else { t.status = "failed"; t.error = job.error || `${ANAME} reported a failure`; }
  if (m.status === "done" && t.status === "failed") m.status = "done-with-errors";
  save(m);
  emit("grokbot.late", { runId: m.id, kind: "mission", mission: publicMission(m), agent: AID });
  emit("log", { text: `${ANAME} ${t.status === "done" ? "finished" : "could not finish"} "${t.title}"; the mission was updated.`, missionId: m.id });
}
