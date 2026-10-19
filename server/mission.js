// Mission mode: marching orders in, a finished deliverable out.
// 1. A planner model breaks the goal into tasks with a capability tag and dependencies.
// 2. The router assigns each task to the best available AI (mode: quality / balanced / economy).
// 3. Tasks run in dependency waves, in parallel, streaming. Each AI may run as several
//    sub-agents (one per task). A different AI QA-reviews each deliverable when qa is on.
// 4. An assembler compiles the final deliverable.
import { PROVIDERS } from "./registry.js";
import { complete, extractJson, streamChat } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall } from "./health.js";
import { emit } from "./events.js";
import { classify, pick, rank } from "./router.js";
import { ctx, doc, putDoc } from "./store.js";
import { augment as webAugment, sourcesBlock } from "./search.js";

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

export async function runMission({ goal, mode = "balanced", projectId, qa = true, budgetUsd = 2, maxTasks = 6, context = "", search }) {
  const id = "m-" + Date.now().toString(36);
  const ctl = new AbortController();
  running.set(id, ctl);
  const t0 = Date.now();
  const mission = { id, kind: "mission", prompt: goal, projectId: projectId || null, mode, qa, budgetUsd, status: "planning", startedAt: t0, tasks: [], plan: null, cost: 0, deliverable: null, log: [], sources: [] };
  const log = (text, extra = {}) => { mission.log.push({ ts: Date.now(), text }); emit("log", { text, missionId: id, ...extra }); };
  const update = () => { emit("mission.update", { mission: publicMission(mission) }); save(mission); };
  const spend = (e) => { mission.cost = +(mission.cost + e.cost).toFixed(5); };
  const explicitSearch = typeof search === "boolean" ? search : undefined;

  try {
    update();
    const cls = await classify(goal, { onCall: (c) => { spend(recordCall({ ...c, missionId: id })); } });
    mission.classification = cls;

    // ---- live web search (Phase 15): one search on the goal; the sources ride along as context ----
    const web = await webAugment({ prompt: goal, kind: "mission", missionId: id, explicit: explicitSearch });
    const searchOn = !!web && !web.native && !web.skipped;
    if (web?.native) log("Search the web is set to the model's own search, which missions cannot use. Pick Tavily, Brave or Serper in Settings > Web search.");
    if (web?.sources?.length) { mission.sources = web.sources; mission.searchEngine = web.name; spend({ cost: web.cost || 0 }); context = `${context ? `${context}\n\n` : ""}${web.block}`; }

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
      const r = await complete({
        provider: planner.provider, model: planner.model, maxTokens: 1500, signal: ctl.signal,
        system: `You are the chief of staff for a small creative/marketing business. Break the goal into ${Math.min(maxTasks, 6)} or fewer concrete tasks that different AI specialists can do independently, with dependencies where one needs another's output. Reply with JSON only:
{"title": "<=8 words", "tasks": [{"id": "t1", "title": "<=10 words", "capability": "reasoning|code|writing|research|creative|analysis|math", "difficulty": 1|2|3, "needWeb": false, "deps": [], "instructions": "precise instructions for the specialist, 1-3 sentences", "deliverable": "what the output must contain"}], "assembly": "how the final deliverable should be put together, 1-2 sentences"}
Keep it tight: no task that just restates the goal. Research tasks need needWeb true only if live information is required.`,
        messages: [{ role: "user", content: `GOAL:\n${goal}${context ? `\n\nCONTEXT:\n${context}` : ""}` }],
      });
      const ms = Date.now() - s0;
      noteCall(planner.provider, true, ms);
      spend(recordCall({ provider: planner.provider, model: planner.model, usage: r.usage, missionId: id, role: "plan", ms }));
      plan = extractJson(r.text);
      emit("agent.done", { agent: pAgent, provider: planner.provider, model: planner.model, missionId: id, ms });
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
    log(`Plan: ${mission.tasks.length} tasks → ${[...used.keys()].map((p) => PROVIDERS[p].name).join(", ")}. Estimated $${est.toFixed(3)}.`);
    if (est > budgetUsd) {
      log(`Estimate exceeds the $${budgetUsd} budget. Switching every task to economy mode.`);
      for (const t of mission.tasks) {
        const e = pick({ capability: t.capability, difficulty: t.difficulty, mode: "economy", needWeb: needsWebModel(t) });
        if (e) { t.provider = e.provider; t.model = e.model; t.agentName = `${e.providerName} · ${t.capability}`; t.estCost = e.estCost; }
      }
    }
    mission.status = "running";
    update();

    // ---- 3. Execute in waves ----
    const done = new Set();
    const outputs = {};
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
          for await (const ev of streamChat({
            provider: t.provider, model: t.model, maxTokens: 2500, signal: ctl.signal,
            system: `You are a specialist (${t.capability}) on a team working toward this goal:\n${goal}\n\nDo only your task. Output the deliverable itself in Markdown, no preamble, no questions back.`,
            messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE: ${t.deliverable}${inputs ? `\n\n${inputs}` : ""}${context ? `\n\nCONTEXT:\n${context}` : ""}${taskWeb ? `\n\n${taskWeb}` : ""}` }],
          })) {
            if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, taskId: t.id, text: ev.text }); }
            else if (ev.type === "done") {
              const ms = Date.now() - s;
              noteCall(t.provider, true, ms);
              const e = recordCall({ provider: t.provider, model: t.model, usage: ev.usage, missionId: id, taskId: t.id, role: "work", ms });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              emit("agent.done", { agent, provider: t.provider, model: t.model, missionId: id, taskId: t.id, ms, cost: e.cost });
            }
          }
          t.output = text;
          outputs[t.id] = text;
          t.status = qa ? "review" : "done";
        } catch (err) {
          noteCall(t.provider, false, Date.now() - s, err.status);
          emit("agent.error", { agent, provider: t.provider, model: t.model, missionId: id, taskId: t.id, error: err.message });
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
              t.output = r.text; outputs[t.id] = r.text; t.status = qa ? "review" : "done";
            } catch (err2) {
              noteCall(alt.provider, false, Date.now() - s2, err2.status);
              t.status = "failed"; t.error = err2.message;
            }
          } else { t.status = "failed"; t.error = err.message; }
        }
        emit("task.update", { missionId: id, task: pubTask(t) });

        // ---- QA by a different AI ----
        if (t.status === "review") {
          const reviewer = rank({ capability: "analysis", difficulty: 2, mode: mode === "quality" ? "balanced" : "economy", exclude: [t.model] }).find((m) => m.provider !== t.provider) || rank({ capability: "analysis", mode: "economy" })[0];
          if (reviewer) {
            const ragent = `${id}:${t.id}:qa`;
            emit("agent.msg", { from: t.provider, to: reviewer.provider, missionId: id, text: `QA "${t.title}"` });
            emit("agent.start", { agent: ragent, provider: reviewer.provider, model: reviewer.model, role: "qa", missionId: id, taskId: t.id, label: `${reviewer.providerName} checking "${t.title}"` });
            const s3 = Date.now();
            try {
              const r = await complete({ provider: reviewer.provider, model: reviewer.model, maxTokens: 500, signal: ctl.signal, system: `You QA another AI's deliverable. Reply with JSON only: {"pass": true|false, "score": 1-10, "issues": ["<=15 words each", ...], "fix": "if not pass, the single most important correction in <=40 words"}`, messages: [{ role: "user", content: `TASK: ${t.title}\nINSTRUCTIONS: ${t.instructions}\nDELIVERABLE REQUIRED: ${t.deliverable}\n\nOUTPUT TO CHECK:\n${t.output.slice(0, 12000)}` }] });
              const ms = Date.now() - s3;
              noteCall(reviewer.provider, true, ms);
              const e = recordCall({ provider: reviewer.provider, model: reviewer.model, usage: r.usage, missionId: id, taskId: t.id, role: "qa", ms });
              spend(e); t.cost = +(t.cost + e.cost).toFixed(5);
              const j = extractJson(r.text) || { pass: true, score: null, issues: [] };
              t.review = { provider: reviewer.provider, model: reviewer.model, pass: j.pass !== false, score: j.score ?? null, issues: j.issues || [], fix: j.fix || null };
              emit("agent.done", { agent: ragent, provider: reviewer.provider, model: reviewer.model, missionId: id, taskId: t.id, ms, cost: e.cost });
              if (!t.review.pass && t.review.fix && !ctl.signal.aborted) {
                emit("agent.msg", { from: reviewer.provider, to: t.provider, missionId: id, text: `revise: ${t.review.fix.slice(0, 60)}` });
                const s4 = Date.now();
                try {
                  const r2 = await complete({ provider: t.provider, model: t.model, maxTokens: 2500, signal: ctl.signal, system: `Revise your deliverable. Apply the QA correction and output the full corrected deliverable in Markdown, nothing else.`, messages: [{ role: "user", content: `TASK: ${t.title}\n\nYOUR DRAFT:\n${t.output}\n\nQA CORRECTION:\n${t.review.fix}\nISSUES: ${(t.review.issues || []).join("; ")}` }] }, (d) => emit("agent.delta", { agent, missionId: id, taskId: t.id, text: d }));
                  noteCall(t.provider, true, Date.now() - s4);
                  const e2 = recordCall({ provider: t.provider, model: t.model, usage: r2.usage, missionId: id, taskId: t.id, role: "revise", ms: Date.now() - s4 });
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
        if (t.status === "done") done.add(t.id);
        t.finishedAt = Date.now();
        emit("task.update", { missionId: id, task: pubTask(t) });
        update();
      }));
      // failed tasks count as resolved so the loop ends
      for (const t of mission.tasks) if (t.status === "failed") done.add(t.id);
    }

    // ---- 4. Assemble ----
    const finished = mission.tasks.filter((t) => t.output);
    if (!finished.length) throw new Error("Every task failed.");
    mission.status = "assembling"; update();
    const asm = pick({ capability: "writing", difficulty: 3, mode: mode === "economy" ? "balanced" : "quality" }) || planner;
    mission.assembler = { provider: asm.provider, model: asm.model };
    const aAgent = `${id}:assembler`;
    emit("agent.start", { agent: aAgent, provider: asm.provider, model: asm.model, role: "assemble", missionId: id, label: `${asm.providerName} assembling the deliverable` });
    for (const t of finished) if (t.provider !== asm.provider) emit("agent.msg", { from: t.provider, to: asm.provider, missionId: id, text: `deliver "${t.title}"` });
    const s5 = Date.now();
    let text = "";
    try {
      for await (const ev of streamChat({
        provider: asm.provider, model: asm.model, maxTokens: 4000, signal: ctl.signal,
        system: `You assemble the final deliverable for the user from the team's task outputs. Assembly guidance: ${plan.assembly || "combine into one clean document"}. Output the deliverable in Markdown, well structured, no preamble. Do not mention tasks or teams; just deliver.${mission.sources.length ? " Keep every [n] citation exactly as written; the numbers refer to the web sources listed at the end." : ""}`,
        messages: [{ role: "user", content: `GOAL:\n${goal}\n\n${finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n")}${mission.sources.length ? `\n\n${sourcesBlock(mission.sources, mission.searchEngine)}` : ""}` }],
      })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent: aAgent, missionId: id, text: ev.text }); }
        else if (ev.type === "done") {
          const ms = Date.now() - s5;
          noteCall(asm.provider, true, ms);
          spend(recordCall({ provider: asm.provider, model: asm.model, usage: ev.usage, missionId: id, role: "assemble", ms }));
          emit("agent.done", { agent: aAgent, provider: asm.provider, model: asm.model, missionId: id, ms });
        }
      }
      mission.deliverable = text;
    } catch (err) {
      noteCall(asm.provider, false, Date.now() - s5, err.status);
      emit("agent.error", { agent: aAgent, provider: asm.provider, model: asm.model, missionId: id, error: err.message });
      mission.deliverable = finished.map((t) => `## ${t.title}\n${t.output}`).join("\n\n");
    }
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
  }
  return mission;
}

function pubTask(t) {
  return { id: t.id, title: t.title, capability: t.capability, difficulty: t.difficulty, deps: t.deps, status: t.status, provider: t.provider, model: t.model, agentName: t.agentName, estCost: t.estCost, cost: t.cost, review: t.review, retried: !!t.retried, revised: !!t.revised, error: t.error || null, startedAt: t.startedAt || null, finishedAt: t.finishedAt || null, chars: t.output ? t.output.length : 0 };
}
export function publicMission(m) {
  return { id: m.id, kind: m.kind, title: m.title || m.prompt.slice(0, 90), prompt: m.prompt, projectId: m.projectId, mode: m.mode, qa: m.qa, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt || null, cost: m.cost, estimatedCost: m.estimatedCost, budgetUsd: m.budgetUsd, planner: m.planner, assembler: m.assembler, plan: m.plan, classification: m.classification, tasks: m.tasks.map(pubTask), deliverable: m.deliverable, error: m.error || null, log: m.log, sources: m.sources || [], searchEngine: m.searchEngine || null };
}
function save(m) {
  saveDoc(m);
}
