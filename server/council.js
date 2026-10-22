// Council mode: the same question goes to several AIs at once. They then review each other's
// answers anonymously, a chair writes the verdict, and the router learns who won.
import { PROVIDERS } from "./registry.js";
import { extractJson } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall } from "./health.js";
import { emit } from "./events.js";
import { classify, recordOutcome, rank } from "./router.js";
import { isDemoProvider, realAiConnected } from "./demo-visibility.js";
import { ctx } from "./store.js";
import { nativeSupported, sourcesFromCitations, recordNative, sourcesBlock } from "./search.js";
import { prepareWeb } from "./research.js";
import { augment as libraryAugment, publicSources as publicLibrarySources } from "./libraries.js";
import { fallbackChat, completeFallback, fallbackRecord, announce as announceFallback, troubleKind, trouble } from "./fallback.js";
import { observe, markPrivateRun } from "./brain.js";
import { AGENT_ID as GROKBOT } from "./grokbot.js";
import { AGENT_ID as BROWSER } from "./browser.js";
import { pickAgent, agentName, onAnyJobFinished } from "./agents.js";
import { withMemory, contextFor, MARKER as MEMORY_MARKER } from "./project-memory.js";
import { withImported } from "./history-refs.js";
import { councilPlan, outputShape, reviewMode } from "./modes.js";
import { cleanSkip, skipAvoid, takeMembers, toneAdd } from "./desk.js";
import { openGrant, endGrant } from "./getdone.js";
import { shouldWait, openWait, onSlotAnswer, onSlotStep, slotInfo } from "./answer-wait.js";

const LETTERS = "ABCDEFGHIJ";
const nameOf = (pid) => PROVIDERS[pid]?.name || agentName(pid);

export async function runCouncil({ prompt, members, chair, projectId, qa = true, maxTokens = 1800, lite = false, mode: asked, search, searchMode, filter, tools, grokbot, browser, libraries, private: isPrivate = false, skip, tone, toneId, id: givenId, getItDone, sendMessages }) {
  const id = givenId || ("c-" + Date.now().toString(36));
  if (isPrivate) markPrivateRun(id);
  openGrant({ runId: id, text: prompt, toggle: getItDone === true, send: sendMessages === true });
  try {
  const t0 = Date.now();
  const plan = councilPlan(asked, lite);
  const mode = plan.priority;
  const skipped = cleanSkip(skip);
  const skipSet = new Set(skipped);
  const held = skipAvoid(skipped);
  const shape = outputShape(mode);
  const answerTokens = shape.maxTokens || maxTokens;
  const cls = await classify(prompt, { onCall: (c) => recordCall({ ...c, missionId: id }) });
  // Grok Bot (Phase 12) and the browser helper (Phase 27) are agents, not text models: one of them is picked
  // by what the job needs (signed-in browsing, Gmail, Drive, Calendar, teammate bots), never for plain text
  // work, and it answers asynchronously
  if (members?.some((m) => m?.provider === GROKBOT)) { grokbot = grokbot ?? true; members = members.filter((m) => m?.provider !== GROKBOT); }
  if (members?.some((m) => m?.provider === BROWSER)) { browser = browser ?? true; members = members.filter((m) => m?.provider !== BROWSER); }
  // A named seat on Nova, Atlas or Sage is dropped while a real AI is connected. The router fills the council.
  if (realAiConnected()) members = (members || []).filter((m) => m && !isDemoProvider(PROVIDERS[m.provider] || { id: m.provider }));
  const agentPick = pickAgent({ prompt, grokbot, browser });
  const A = agentPick.agent;
  // A named seat list (Do this again) keeps those seats. A removed reader is dropped and not replaced.
  const hadNamed = Array.isArray(members) && members.length > 0;
  if (hadNamed && skipSet.size) members = members.filter((m) => m && !skipSet.has(m.provider));
  if (!hadNamed) members = takeMembers(rank({ ...cls, mode }), { limit: plan.members, skip: skipped });
  if (!members.length) throw new Error("No AI is available. Add at least one API key in Settings.");
  if (chair && realAiConnected() && isDemoProvider(PROVIDERS[chair.provider] || { id: chair.provider })) chair = null;
  if (chair && skipSet.has(chair.provider)) chair = null;
  chair ||= rank({ ...cls, mode }).find((m) => members.some((x) => x.model === m.model) && !skipSet.has(m.provider)) || members[0];
  chair = { provider: chair.provider, model: chair.model };

  // project memory (R5): members, reviewers and the chair all see the project's voice, offers and never-say list
  const memBlock = contextFor(projectId);
  const memNote = memBlock && !prompt.includes(MEMORY_MARKER) ? `\n\n${memBlock}` : "";
  const answerSystem = toneAdd("Answer the user as a sharp expert. Be concrete and complete but not padded. Markdown allowed.", tone);
  const chairSystem = toneAdd("You chair a council of AI experts. Write the single best final answer for the user, merging the strongest material from the answers below and fixing their errors. Then add a short section '**Where the council disagreed**' (2-5 bullets, or 'None') and '**Credits**' naming which answer contributed what in one line each. No preamble.", tone);
  const council = { id, kind: "council", prompt, projectId: projectId || null, private: !!isPrivate, memory: !!memBlock || prompt.includes(MEMORY_MARKER), classification: cls, members, chair, mode, startedAt: t0, answers: {}, reviews: {}, verdict: null, scoreboard: null, cost: 0, status: "running", sources: [], toolCalls: [], fallbacks: [], agents: [], ...(toneId ? { tone: toneId } : {}) };
  runningCouncils.set(id, council);
  emit("council.update", { council: pub(council) });
  emit("log", { text: `Council convened: ${members.map((m) => PROVIDERS[m.provider].name).join(", ")}${agentPick.use ? `, plus ${A.name} (${agentPick.reason})` : ""}. Chair: ${PROVIDERS[chair.provider].name}.`, missionId: id });

  // ---- the agent gets the same question as a job; its answer joins round 1 if it is back in time ----
  let agentWait = null;
  if (agentPick.use) {
    lateWhileRunning.set(id, []);
    const AID = A.id;
    const seat = { id: AID, name: A.name, letter: LETTERS[members.length], needs: agentPick.needs, reason: agentPick.reason, jobId: null, status: "queued" };
    council.agents.push(seat);
    const agent = `${id}:${AID}`;
    emit("agent.start", { agent, provider: AID, model: AID, role: "answer", missionId: id, label: `${A.name} on the job (results are async and can take minutes)` });
    const s = Date.now();
    try {
      const job = await A.dispatch({ task: prompt, context: memNote.trim(), needs: agentPick.needs, source: { kind: "council", runId: id, projectId } });
      seat.jobId = job.id; seat.status = job.status;
      if (job.status === "failed") throw new Error(job.error);
      emit("council.update", { council: pub(council) });
      agentWait = A.awaitJob(job.id, { timeoutMs: A.waitMs("council"), onUpdate: (j) => { seat.status = j.status; emit("council.update", { council: pub(council) }); } }).then((j) => {
        if (j?.status === "done" && j.text) {
          seat.status = "done";
          council.answers[AID] = { provider: AID, model: AID, text: j.text, artifacts: j.artifacts, ms: Date.now() - s, cost: 0, free: true, letter: seat.letter, agent: true, jobId: j.id, by: j.by };
          emit("agent.done", { agent, provider: AID, model: AID, missionId: id, ms: Date.now() - s, cost: 0, chars: j.text.length });
        } else if (j?.status === "failed" || j?.status === "done") {
          seat.status = j.status;
          council.answers[AID] = { provider: AID, model: AID, error: j.error || `${A.name} sent no text`, letter: seat.letter, agent: true, jobId: j.id };
          emit("agent.error", { agent, provider: AID, model: AID, missionId: id, error: j.error || "no text" });
        } else {
          // still out: the council goes on; the answer is added to this council when it comes back
          council.answers[AID] = { provider: AID, model: AID, pending: true, status: seat.status, letter: seat.letter, agent: true, jobId: seat.jobId };
          emit("agent.done", { agent, provider: AID, model: AID, missionId: id, ms: Date.now() - s, cost: 0 });
          emit("log", { text: `${A.name} is still on it (${A.STATUS_LABEL[seat.status].toLowerCase()}). The council goes on; its answer is added to this council and scored when it comes back.`, missionId: id });
        }
        emit("council.update", { council: pub(council) });
      });
    } catch (err) {
      seat.status = "failed";
      council.answers[AID] = { provider: AID, model: AID, error: err.message, letter: seat.letter, agent: true, jobId: seat.jobId };
      emit("agent.error", { agent, provider: AID, model: AID, missionId: id, error: err.message });
      emit("council.update", { council: pub(council) });
    }
  }

  // ---- live web search (Phase 15): one search, the same numbered sources for every member and the chair ----
  const web = await prepareWeb({ prompt, kind: "council", missionId: id, explicit: typeof search === "boolean" ? search : undefined, needWeb: !!cls?.needWeb, filter, mode: searchMode === "pro" ? "pro" : undefined });
  council.searched = web != null;
  if (web?.sources?.length) { council.sources = web.sources; council.searchEngine = web.name; council.cost += web.cost || 0; emit("council.update", { council: pub(council) }); }
  // ---- knowledge libraries (Phase 18): the same excerpts for every member and the chair, cited as [L1], [L2] ----
  const lib = await libraryAugment({ prompt, projectId, missionId: id, explicit: Array.isArray(libraries) ? libraries : undefined });
  if (lib) { council.librarySources = publicLibrarySources(lib.sources); council.cost += lib.cost || 0; if (lib.sources.length) emit("council.update", { council: pub(council) }); }
  let askPrompt = withMemory(`${web?.prompt || prompt}${lib?.block ? `\n\n${lib.block}` : ""}`, projectId);
  const importedRefs = withImported(prompt, askPrompt);
  askPrompt = importedRefs.ask;
  if (importedRefs.used.length) council.importedRefs = importedRefs.used;
  const nativeFor = (m) => !!web?.native && nativeSupported(m.provider, m.model);

  // ---- Round 1: everyone answers, in parallel, streaming ----
  await Promise.all(members.map(async (m, i) => {
    let agent = `${id}:${m.provider}`;
    const orig = { provider: m.provider, model: m.model };
    const sitting = trouble(m.provider);
    if (!(sitting && (sitting.kind === "credits" || sitting.kind === "rate"))) emit("agent.start", { agent, provider: m.provider, model: m.model, role: "answer", missionId: id, label: `${PROVIDERS[m.provider].name} answering${nativeFor(m) ? " (with its own web search)" : ""}` });
    const s = Date.now();
    let text = "", usage = null, citations = null;
    try {
      // MCP tools (Phase 16) ride along for members that can call them; smart fallback (Phase 26) swaps in
      // another model when this member's provider is out of credits, rate limited or refusing its key
      for await (const ev of fallbackChat({ provider: m.provider, model: m.model, maxTokens: answerTokens, ...(shape.effort ? { effort: shape.effort } : {}), webSearch: nativeFor(m), system: answerSystem, messages: [{ role: "user", content: askPrompt }] }, { missionId: id, tools, role: "answer", cls, mode, avoid: [...members.filter((x) => x !== m), ...held] })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, text: ev.text }); }
        else if (ev.type === "fallback") {
          text = ""; council.fallbacks.push(fallbackRecord(ev));
          const next = `${id}:${ev.to.provider}`;
          announceFallback(ev, { missionId: id, agentFrom: agent, agentTo: next, role: "answer" });
          agent = next; m.provider = ev.to.provider; m.model = ev.to.model; m.standIn = { for: ev.from.provider, forModel: ev.from.model, reason: ev.reason, via: ev.via || null };
          emit("council.update", { council: pub(council) });
        }
        else if (ev.type === "tool" && ev.phase === "done") { council.toolCalls.push({ by: m.provider, tool: ev.tool, server: ev.server, ok: ev.ok, denied: ev.denied, ms: ev.ms }); emit("council.update", { council: pub(council) }); }
        else if (ev.type === "done") { usage = ev.usage; citations = ev.citations || null; }
      }
      const ms = Date.now() - s;
      noteCall(m.provider, true, ms);
      const e = recordCall({ provider: m.provider, model: m.model, usage, missionId: id, role: "answer", ms });
      council.cost += e.cost;
      let own = [];
      if (nativeFor(m) && citations?.length) {
        // this member's own pages stay on its answer, numbered after the shared list
        own = sourcesFromCitations(citations, council.sources.length);
        council.searchEngine = council.searchEngine || web?.name;
        council.cost += recordNative(m.provider, citations, { missionId: id });
      }
      const shared = council.sources || [];
      const extra = own.filter((s) => !shared.some((x) => x.url === s.url));
      const answerSources = extra.length ? [...shared, ...extra] : shared;
      council.answers[m.model] = { provider: m.provider, model: m.model, text, usage, ms, cost: e.cost, free: !!e.free, letter: LETTERS[i], standIn: m.standIn || null, sources: answerSources };
      emit("agent.done", { agent, provider: m.provider, model: m.model, missionId: id, ms, cost: e.cost, chars: text.length });
    } catch (err) {
      noteCall(m.provider, false, Date.now() - s, err);
      if (shouldWait(err)) {
        // out of API credits and no API route left: this seat answers through the person's own plan
        m.provider = orig.provider; m.model = orig.model; delete m.standIn;
        const waiting = openWait({ kind: "council", runId: id, slot: orig.model, provider: orig.provider, model: orig.model, ask: askPrompt, system: answerSystem, title: prompt });
        council.answers[orig.model] = { provider: orig.provider, model: orig.model, waiting, account: true, letter: LETTERS[i] };
        emit("agent.done", { agent, provider: orig.provider, model: orig.model, missionId: id, ms: Date.now() - s, cost: 0 });
      } else {
        council.answers[m.model] = { provider: m.provider, model: m.model, error: err.message, account: !!troubleKind(err), letter: LETTERS[i] };
        emit("agent.error", { agent, provider: m.provider, model: m.model, missionId: id, error: err.message });
      }
    }
    emit("council.update", { council: pub(council) });
  }));
  if (agentWait) await agentWait; // its timer started at the hand-off, so this waits at most the council wait

  const good = Object.values(council.answers).filter((a) => a.text);
  if (!good.length) {
    // every seat is waiting on a subscription answer: the council fills in as they come back
    council.status = waitingSeats(council).length ? "waiting" : "failed";
    endGrant(id);
    emit("council.update", { council: pub(council) });
    emit("mission.update", { mission: summaryOf(council) });
    return finish(council);
  }

  // ---- Round 2: anonymous peer review ----
  if (qa && good.length > 1) {
    const packet = good.map((a) => `### Answer ${a.letter}\n${a.text}`).join("\n\n");
    // Grok Bot's answer is reviewed and scored like the others; it does not review (it answers asynchronously)
    await Promise.all(good.filter((a) => !a.agent).map(async (reviewer) => {
      const agent = `${id}:${reviewer.provider}:review`;
      emit("agent.start", { agent, provider: reviewer.provider, model: reviewer.model, role: "review", missionId: id, label: `${PROVIDERS[reviewer.provider].name} reviewing` });
      for (const other of good) if (other !== reviewer) emit("agent.msg", { from: reviewer.provider, to: other.provider, missionId: id, text: `reviewing answer ${other.letter}` });
      const s = Date.now();
      try {
        // a small job: a stand-in (free tier first) takes over if the reviewer's provider fails (Phase 26)
        const r = await completeFallback({
          provider: reviewer.provider, model: reviewer.model, maxTokens: 700,
          system: `You are a strict judge. Several anonymous answers to the same question follow. Score each 1-10 for accuracy, usefulness and concision (do not reward length). Reply with JSON only: {"scores": {"A": n, ...}, "best": "A", "notes": {"A": "<=20 words", ...}, "disagreement": "<=30 words on where the answers conflict, or 'none'"}`,
          messages: [{ role: "user", content: `QUESTION:\n${prompt}${memNote}\n\nANSWERS:\n${packet}` }],
        }, { missionId: id, role: "review", small: true, tools: false, cls: { capability: "analysis", difficulty: 2 }, mode: reviewMode(mode) }, { onFallback: (ev) => { council.fallbacks.push(fallbackRecord(ev)); announceFallback(ev, { missionId: id, agentFrom: agent, agentTo: agent, role: "review" }); } });
        const ms = Date.now() - s;
        noteCall(r.provider, true, ms);
        const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: id, role: "review", ms });
        council.cost += e.cost;
        const j = extractJson(r.text) || {};
        council.reviews[reviewer.model] = { provider: r.provider, model: r.model, scores: j.scores || {}, best: j.best, notes: j.notes || {}, disagreement: j.disagreement || "", cost: e.cost, standIn: r.fallback ? { for: reviewer.provider, forModel: reviewer.model, reason: r.fallback[r.fallback.length - 1].reason, via: r.via } : null };
        emit("agent.done", { agent, provider: r.provider, model: r.model, missionId: id, ms, cost: e.cost });
      } catch (err) {
        noteCall(reviewer.provider, false, Date.now() - s, err);
        emit("agent.error", { agent, provider: reviewer.provider, model: reviewer.model, missionId: id, error: err.message });
      }
      emit("council.update", { council: pub(council) });
    }));

    // Scoreboard: average of other members' scores for each answer
    const board = {};
    for (const a of good) {
      const vals = [];
      for (const [rm, rv] of Object.entries(council.reviews)) {
        if (rm === a.model) continue; // no self-scoring
        const v = Number(rv.scores?.[a.letter]);
        if (!Number.isNaN(v) && v > 0) vals.push(v);
      }
      board[a.model] = { letter: a.letter, provider: a.provider, avg: vals.length ? +(vals.reduce((x, y) => x + y, 0) / vals.length).toFixed(2) : null, votes: vals.length, bestVotes: Object.values(council.reviews).filter((rv) => rv.best === a.letter).length };
    }
    council.scoreboard = board;
    const winner = Object.entries(board).sort((a, b) => (b[1].avg || 0) - (a[1].avg || 0))[0];
    if (winner && winner[1].avg != null) {
      for (const a of good) if (!a.agent) recordOutcome(a.model, cls.capability, a.model === winner[0]);
      council.winner = winner[0];
      emit("log", { text: `Council scoreboard: ${nameOf(board[winner[0]].provider)} ranked best for ${cls.capability}.`, missionId: id });
    }
  }

  // learning router (Phase 28): every member's job, with its peer score and whether it won the round
  // (a member that failed because of its account, such as no credits, is smart fallback's business, not held against the model)
  for (const a of Object.values(council.answers)) {
    if ((!a.text && a.account) || a.pending || a.waiting) continue;
    const b = council.scoreboard?.[a.model];
    observe({ provider: a.provider, model: a.model, capability: cls.capability, difficulty: cls.difficulty, runId: id, ok: !!a.text, score: b?.avg ?? null, won: council.winner ? a.model === council.winner : null, cost: a.cost, ms: a.ms, free: a.free });
  }

  // ---- Round 3: chair verdict ----
  {
    let agent = `${id}:${chair.provider}:chair`;
    emit("agent.start", { agent, provider: chair.provider, model: chair.model, role: "chair", missionId: id, label: `${PROVIDERS[chair.provider].name} writing the verdict` });
    for (const a of good) if (a.provider !== chair.provider) emit("agent.msg", { from: a.provider, to: chair.provider, missionId: id, text: `answer ${a.letter} to chair` });
    const s = Date.now();
    try {
      const packet = good.map((a) => `### Answer ${a.letter} (${nameOf(a.provider)}${council.scoreboard?.[a.model]?.avg != null ? `, peer score ${council.scoreboard[a.model].avg}/10` : ""})\n${a.text}`).join("\n\n");
      const disagreements = Object.values(council.reviews).map((r) => r.disagreement).filter((d) => d && d.toLowerCase() !== "none");
      const cite = council.sources.length ? `\n\n${sourcesBlock(council.sources, council.searchEngine)}\n\nKeep the [n] citations from the answers exactly as they are; they refer to the numbered sources above.` : "";
      const libCite = lib?.sources?.length ? `\n\n${lib.block}\n\nKeep the [L1], [L2] ... library tags from the answers exactly as they are; they refer to the library excerpts above.` : "";
      let text = "";
      for await (const ev of fallbackChat({
        provider: chair.provider, model: chair.model, maxTokens: Math.max(shape.maxTokens || 0, 1200, maxTokens), ...(shape.effort ? { effort: shape.effort } : {}),
        system: chairSystem,
        messages: [{ role: "user", content: `QUESTION:\n${prompt}${memNote}\n\nANSWERS:\n${packet}${disagreements.length ? `\n\nREVIEWERS FLAGGED THESE CONFLICTS:\n- ${disagreements.join("\n- ")}` : ""}${cite}${libCite}` }],
      }, { missionId: id, role: "chair", tools: false, cls: { ...cls, difficulty: 3 }, mode, avoid: held })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, text: ev.text }); }
        else if (ev.type === "fallback") {
          text = ""; council.fallbacks.push(fallbackRecord(ev));
          const next = `${id}:${ev.to.provider}:chair`;
          announceFallback(ev, { missionId: id, agentFrom: agent, agentTo: next, role: "chair" });
          agent = next; chair.provider = ev.to.provider; chair.model = ev.to.model; chair.standIn = { for: ev.from.provider, forModel: ev.from.model, reason: ev.reason, via: ev.via || null };
          emit("council.update", { council: pub(council) });
        }
        else if (ev.type === "done") {
          const ms = Date.now() - s;
          noteCall(chair.provider, true, ms);
          const e = recordCall({ provider: chair.provider, model: chair.model, usage: ev.usage, missionId: id, role: "chair", ms });
          council.cost += e.cost;
          observe({ provider: chair.provider, model: chair.model, capability: cls.capability, difficulty: 3, runId: id, ok: true, cost: e.cost, ms, free: e.free });
          emit("agent.done", { agent, provider: chair.provider, model: chair.model, missionId: id, ms, cost: e.cost });
        }
      }
      council.verdict = { provider: chair.provider, model: chair.model, text };
    } catch (err) {
      noteCall(chair.provider, false, Date.now() - s, err);
      if (!troubleKind(err)) observe({ provider: chair.provider, model: chair.model, capability: cls.capability, difficulty: 3, runId: id, ok: false });
      council.verdict = { provider: chair.provider, model: chair.model, error: err.message, text: good.sort((a, b) => (council.scoreboard?.[b.model]?.avg || 0) - (council.scoreboard?.[a.model]?.avg || 0))[0].text };
      emit("agent.error", { agent, provider: chair.provider, model: chair.model, missionId: id, error: err.message });
    }
  }
  council.status = "done";
  council.finishedAt = Date.now();
  council.cost = +council.cost.toFixed(5);
  endGrant(id);
  emit("council.update", { council: pub(council) });
  emit("mission.update", { mission: summaryOf(council) });
  emit("log", { text: `Council finished in ${((council.finishedAt - t0) / 1000).toFixed(0)}s for $${council.cost.toFixed(4)}.`, missionId: id });
  return finish(council);
  } finally {
    endGrant(id);
    if (runningCouncils.has(id)) { runningCouncils.delete(id); subWhileRunning.delete(id); }
  }
}

function pub(c) { return c; }
function save(c) {
  ctx().store.saveMission(c, summaryOf(c));
  return c;
}
// the council's last save; a Grok Bot answer that came back while it was still reviewing is added now
function finish(c) {
  save(c);
  runningCouncils.delete(c.id);
  const q = lateWhileRunning.get(c.id) || [];
  lateWhileRunning.delete(c.id);
  for (const job of q) lateAnswer(job).catch((e) => console.error("[council] late answer:", e.message));
  const subs = subWhileRunning.get(c.id) || [];
  subWhileRunning.delete(c.id);
  (async () => { for (const [job, res] of subs) await subscriptionAnswer(job, res); })().catch((e) => console.error("[council] subscription answer:", e.message));
  return c;
}
export function summaryOf(c) {
  return { id: c.id, kind: c.kind, title: c.prompt.slice(0, 90), projectId: c.projectId, private: !!c.private, status: c.status, startedAt: c.startedAt, finishedAt: c.finishedAt || null, cost: c.cost, members: (c.members || []).map((m) => m.provider).concat((c.agents || []).map((a) => a.id)), winner: c.winner ? nameOf(c.answers[c.winner]?.provider) || null : null };
}

// ---- an agent's answer (Grok Bot or the browser helper) that came back after the council moved on ----
// It is added next to the other answers and scored by one judge on the same 1-10 scale the peers use;
// the judge call is in the ledger like every other call.
const lateWhileRunning = new Map(); // council id -> jobs that finished after the wait but before the council saved
onAnyJobFinished(lateAnswer);
async function lateAnswer(job) {
  if (job.source?.kind !== "council" || !job.source.runId) return;
  if (lateWhileRunning.has(job.source.runId)) { lateWhileRunning.get(job.source.runId).push(job); return; }
  const c = await ctx().store.getMission(job.source.runId);
  if (!c || c.kind !== "council") return;
  const seat = (c.agents ||= []).find((a) => a.jobId === job.id);
  if (!seat) return;
  seat.status = job.status;
  const AID = job.agent || seat.id || GROKBOT, ANAME = agentName(AID);
  const a = { provider: AID, model: AID, letter: seat.letter, agent: true, jobId: job.id, late: true, by: job.by };
  if (job.status === "done" && job.text) {
    Object.assign(a, { text: job.text, artifacts: job.artifacts, cost: 0, free: true });
    try {
      const r = await completeFallback({
        provider: c.chair?.provider, model: c.chair?.model, maxTokens: 300,
        system: `You are a strict judge. Score this answer to the question 1-10 for accuracy, usefulness and concision (do not reward length). Reply with JSON only: {"score": n, "note": "<=20 words"}`,
        messages: [{ role: "user", content: `QUESTION:\n${c.prompt}\n\nANSWER:\n${job.text.slice(0, 12000)}` }],
      }, { missionId: c.id, role: "review", small: true, tools: false, cls: { capability: "analysis", difficulty: 2 }, mode: reviewMode(c.mode) });
      const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: c.id, role: "review" });
      c.cost = +((c.cost || 0) + e.cost).toFixed(5);
      const score = Number(extractJson(r.text)?.score);
      if (score > 0) {
        c.scoreboard ||= {};
        c.scoreboard[AID] = { letter: seat.letter, provider: AID, avg: +Math.min(10, score).toFixed(2), votes: 1, bestVotes: 0, late: true, judge: r.provider };
        a.score = c.scoreboard[AID].avg;
      }
    } catch (err) { a.scoreError = err.message; }
    observe({ provider: AID, model: AID, capability: c.classification?.capability, difficulty: c.classification?.difficulty, runId: c.id, ok: true, score: a.score ?? null, cost: 0 });
  } else {
    a.error = job.error || `${ANAME} sent no text`;
    observe({ provider: AID, model: AID, capability: c.classification?.capability, difficulty: c.classification?.difficulty, runId: c.id, ok: false });
  }
  const prev = c.answers?.[AID];
  if (prev?.thread?.length) a.thread = prev.thread;
  if (prev?.followPending) a.followPending = true;
  c.answers = { ...(c.answers || {}), [AID]: a };
  save(c);
  emit("grokbot.late", { runId: c.id, kind: "council", council: c, agent: AID });
  emit("log", { text: `${ANAME}'s answer arrived after the verdict and was added to the council${a.score ? ` (judge score ${a.score}/10)` : ""}.`, missionId: c.id });
}

// ---- a seat that waited on the person's own plan (out of API credits, server/answer-wait.js) ----
// The answer joins like a late agent answer: one judge scores it, and once no seat is still waiting the chair
// writes the verdict again with every answer. With no API AI left to do that, the answers are shown as they
// are and the verdict says plainly that no AI was available to write it.
const runningCouncils = new Map(); // council id -> the live record while it runs
const subWhileRunning = new Map(); // council id -> [[job, result]] that came back while the council was still running
const waitingSeats = (c) => Object.values(c.answers || {}).filter((a) => a?.waiting);
export const NO_AI_VERDICT = "No AI was available to write the verdict, so here are the answers as they came in.";
function answersAsTheyAre(c) {
  const good = Object.values(c.answers || {}).filter((a) => a.text);
  return `${NO_AI_VERDICT}\n\n${good.map((a) => `### Answer ${a.letter || ""} (${nameOf(a.provider)}${a.viaSubscription ? `, ${a.viaSubscription.tag}` : ""})\n${a.text}`).join("\n\n")}`;
}
async function subscriptionAnswer(job, res) {
  if (runningCouncils.has(job.runId)) {
    if (!subWhileRunning.has(job.runId)) subWhileRunning.set(job.runId, []);
    subWhileRunning.get(job.runId).push([job, res]);
    return;
  }
  const c = await ctx().store.getMission(job.runId);
  if (!c || c.kind !== "council") return;
  const key = job.slot;
  const prev = c.answers?.[key] || { provider: job.provider, model: job.model };
  if (res.stopped) {
    c.answers[key] = { ...prev, waiting: null, error: `Stopped waiting. No answer came back from ${job.aiName}.` };
  } else {
    const a = { provider: prev.provider || job.provider, model: prev.model || job.model, letter: prev.letter, text: res.text, late: true, cost: 0, free: true, jobId: job.id, viaSubscription: { tag: res.tag, by: res.by, route: res.route } };
    try {
      const judge = c.chair?.provider ? c.chair : (c.members || [])[0];
      const r = await completeFallback({
        provider: judge?.provider, model: judge?.model, maxTokens: 300,
        system: `You are a strict judge. Score this answer to the question 1-10 for accuracy, usefulness and concision (do not reward length). Reply with JSON only: {"score": n, "note": "<=20 words"}`,
        messages: [{ role: "user", content: `QUESTION:\n${c.prompt}\n\nANSWER:\n${res.text.slice(0, 12000)}` }],
      }, { missionId: c.id, role: "review", small: true, tools: false, cls: { capability: "analysis", difficulty: 2 }, mode: reviewMode(c.mode) });
      const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: c.id, role: "review" });
      c.cost = +((c.cost || 0) + e.cost).toFixed(5);
      const score = Number(extractJson(r.text)?.score);
      if (score > 0) {
        c.scoreboard ||= {};
        c.scoreboard[key] = { letter: a.letter, provider: a.provider, avg: +Math.min(10, score).toFixed(2), votes: 1, bestVotes: 0, late: true, judge: r.provider };
        a.score = c.scoreboard[key].avg;
      }
    } catch (err) { a.scoreError = err.message; }
    c.answers = { ...(c.answers || {}), [key]: a };
  }
  if (!waitingSeats(c).length) {
    const good = Object.values(c.answers || {}).filter((x) => x.text);
    if (good.length) {
      const chair = c.chair?.provider ? c.chair : (c.members || [])[0];
      try {
        const packet = good.map((x) => `### Answer ${x.letter} (${nameOf(x.provider)}${c.scoreboard?.[x.model]?.avg != null ? `, score ${c.scoreboard[x.model].avg}/10` : ""})\n${x.text}`).join("\n\n");
        const r = await completeFallback({
          provider: chair?.provider, model: chair?.model, maxTokens: 1800,
          system: "You chair a council of AI experts. Write the single best final answer for the user, merging the strongest material from the answers below and fixing their errors. Then add a short section '**Where the council disagreed**' (2-5 bullets, or 'None') and '**Credits**' naming which answer contributed what in one line each. No preamble.",
          messages: [{ role: "user", content: `QUESTION:\n${c.prompt}\n\nANSWERS:\n${packet}` }],
        }, { missionId: c.id, role: "chair", tools: false, cls: { ...(c.classification || {}), difficulty: 3 }, mode: c.mode });
        const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: c.id, role: "chair" });
        c.cost = +((c.cost || 0) + e.cost).toFixed(5);
        if (!String(r.text || "").trim()) throw new Error("the chair wrote nothing");
        c.verdict = { provider: r.provider, model: r.model, text: r.text, merged: true };
      } catch (err) {
        // keep a verdict the API AIs already wrote; with none, the answers are the result
        if (!c.verdict?.text || c.verdict.noAi) c.verdict = { provider: null, model: null, text: answersAsTheyAre(c), noAi: true, error: err.message };
      }
      c.status = "done";
    } else if (c.status === "waiting") c.status = "failed";
    c.finishedAt = c.finishedAt || Date.now();
  }
  save(c);
  emit("grokbot.late", { runId: c.id, kind: "council", council: c, agent: job.provider });
  emit("mission.update", { mission: summaryOf(c) });
}
onSlotAnswer("council", subscriptionAnswer);
// the waiting box redraws from the council record: its step (official app, then copy over) is kept there
onSlotStep("council", (job) => {
  (async () => {
    const live = runningCouncils.get(job.runId);
    if (live) { const a = live.answers?.[job.slot]; if (a?.waiting) { a.waiting = slotInfo(job); emit("council.update", { council: live }); } return; }
    const c = await ctx().store.getMission(job.runId);
    const a = c?.answers?.[job.slot];
    if (!a?.waiting) return;
    a.waiting = slotInfo(job);
    save(c);
    emit("grokbot.late", { runId: c.id, kind: "council", council: c, agent: job.provider });
  })().catch(() => {});
});
