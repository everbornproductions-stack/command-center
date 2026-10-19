// Council mode: the same question goes to several AIs at once. They then review each other's
// answers anonymously, a chair writes the verdict, and the router learns who won.
import { PROVIDERS } from "./registry.js";
import { complete, extractJson, streamChat } from "./providers.js";
import { recordCall } from "./ledger.js";
import { noteCall } from "./health.js";
import { emit } from "./events.js";
import { classify, recordOutcome, rank } from "./router.js";
import { ctx } from "./store.js";
import { augment as webAugment, nativeSupported, sourcesFromCitations, recordNative, sourcesBlock } from "./search.js";

const LETTERS = "ABCDEFGHIJ";

export async function runCouncil({ prompt, members, chair, projectId, qa = true, maxTokens = 1800, lite = false, search }) {
  const id = "c-" + Date.now().toString(36);
  const t0 = Date.now();
  const cls = await classify(prompt, { onCall: (c) => recordCall({ ...c, missionId: id }) });
  if (!members?.length) {
    const ranked = rank({ ...cls, mode: lite ? "economy" : "balanced" });
    const seen = new Set();
    members = [];
    for (const m of ranked) {
      if (seen.has(m.provider)) continue;
      seen.add(m.provider);
      members.push({ provider: m.provider, model: m.model });
      if (members.length >= (lite ? 3 : 4)) break;
    }
  }
  if (!members.length) throw new Error("No AI is available. Add at least one API key in Settings.");
  chair ||= rank({ ...cls, mode: "quality" }).find((m) => members.some((x) => x.model === m.model)) || members[0];
  chair = { provider: chair.provider, model: chair.model };

  const council = { id, kind: "council", prompt, projectId: projectId || null, classification: cls, members, chair, startedAt: t0, answers: {}, reviews: {}, verdict: null, scoreboard: null, cost: 0, status: "running", sources: [] };
  emit("council.update", { council: pub(council) });
  emit("log", { text: `Council convened: ${members.map((m) => PROVIDERS[m.provider].name).join(", ")}. Chair: ${PROVIDERS[chair.provider].name}.`, missionId: id });

  // ---- live web search (Phase 15): one search, the same numbered sources for every member and the chair ----
  const web = await webAugment({ prompt, kind: "council", missionId: id, explicit: typeof search === "boolean" ? search : undefined });
  if (web?.sources?.length) { council.sources = web.sources; council.searchEngine = web.name; council.cost += web.cost || 0; emit("council.update", { council: pub(council) }); }
  const askPrompt = web?.prompt || prompt;
  const nativeFor = (m) => !!web?.native && nativeSupported(m.provider, m.model);

  // ---- Round 1: everyone answers, in parallel, streaming ----
  await Promise.all(members.map(async (m, i) => {
    const agent = `${id}:${m.provider}`;
    emit("agent.start", { agent, provider: m.provider, model: m.model, role: "answer", missionId: id, label: `${PROVIDERS[m.provider].name} answering${nativeFor(m) ? " (with its own web search)" : ""}` });
    const s = Date.now();
    let text = "", usage = null, citations = null;
    try {
      for await (const ev of streamChat({ provider: m.provider, model: m.model, maxTokens, webSearch: nativeFor(m), system: "Answer the user as a sharp expert. Be concrete and complete but not padded. Markdown allowed.", messages: [{ role: "user", content: askPrompt }] })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, text: ev.text }); }
        else if (ev.type === "done") { usage = ev.usage; citations = ev.citations || null; }
      }
      const ms = Date.now() - s;
      noteCall(m.provider, true, ms);
      const e = recordCall({ provider: m.provider, model: m.model, usage, missionId: id, role: "answer", ms });
      council.cost += e.cost;
      if (nativeFor(m) && citations?.length) {
        // a member that searched on its own: its pages join the shared list, numbered after the others
        council.sources = [...council.sources, ...sourcesFromCitations(citations, council.sources.length)];
        council.searchEngine = council.searchEngine || web.name;
        council.cost += recordNative(m.provider, citations, { missionId: id });
      }
      council.answers[m.model] = { provider: m.provider, model: m.model, text, usage, ms, cost: e.cost, letter: LETTERS[i] };
      emit("agent.done", { agent, provider: m.provider, model: m.model, missionId: id, ms, cost: e.cost, chars: text.length });
    } catch (err) {
      noteCall(m.provider, false, Date.now() - s, err.status);
      council.answers[m.model] = { provider: m.provider, model: m.model, error: err.message, letter: LETTERS[i] };
      emit("agent.error", { agent, provider: m.provider, model: m.model, missionId: id, error: err.message });
    }
    emit("council.update", { council: pub(council) });
  }));

  const good = Object.values(council.answers).filter((a) => a.text);
  if (!good.length) { council.status = "failed"; emit("council.update", { council: pub(council) }); return save(council); }

  // ---- Round 2: anonymous peer review ----
  if (qa && good.length > 1) {
    const packet = good.map((a) => `### Answer ${a.letter}\n${a.text}`).join("\n\n");
    await Promise.all(good.map(async (reviewer) => {
      const agent = `${id}:${reviewer.provider}:review`;
      emit("agent.start", { agent, provider: reviewer.provider, model: reviewer.model, role: "review", missionId: id, label: `${PROVIDERS[reviewer.provider].name} reviewing` });
      for (const other of good) if (other !== reviewer) emit("agent.msg", { from: reviewer.provider, to: other.provider, missionId: id, text: `reviewing answer ${other.letter}` });
      const s = Date.now();
      try {
        const r = await complete({
          provider: reviewer.provider, model: reviewer.model, maxTokens: 700,
          system: `You are a strict judge. Several anonymous answers to the same question follow. Score each 1-10 for accuracy, usefulness and concision (do not reward length). Reply with JSON only: {"scores": {"A": n, ...}, "best": "A", "notes": {"A": "<=20 words", ...}, "disagreement": "<=30 words on where the answers conflict, or 'none'"}`,
          messages: [{ role: "user", content: `QUESTION:\n${prompt}\n\nANSWERS:\n${packet}` }],
        });
        const ms = Date.now() - s;
        noteCall(reviewer.provider, true, ms);
        const e = recordCall({ provider: reviewer.provider, model: reviewer.model, usage: r.usage, missionId: id, role: "review", ms });
        council.cost += e.cost;
        const j = extractJson(r.text) || {};
        council.reviews[reviewer.model] = { provider: reviewer.provider, scores: j.scores || {}, best: j.best, notes: j.notes || {}, disagreement: j.disagreement || "", cost: e.cost };
        emit("agent.done", { agent, provider: reviewer.provider, model: reviewer.model, missionId: id, ms, cost: e.cost });
      } catch (err) {
        noteCall(reviewer.provider, false, Date.now() - s, err.status);
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
      for (const a of good) recordOutcome(a.model, cls.capability, a.model === winner[0]);
      council.winner = winner[0];
      emit("log", { text: `Council scoreboard: ${PROVIDERS[board[winner[0]].provider].name} ranked best for ${cls.capability}.`, missionId: id });
    }
  }

  // ---- Round 3: chair verdict ----
  {
    const agent = `${id}:${chair.provider}:chair`;
    emit("agent.start", { agent, provider: chair.provider, model: chair.model, role: "chair", missionId: id, label: `${PROVIDERS[chair.provider].name} writing the verdict` });
    for (const a of good) if (a.provider !== chair.provider) emit("agent.msg", { from: a.provider, to: chair.provider, missionId: id, text: `answer ${a.letter} to chair` });
    const s = Date.now();
    try {
      const packet = good.map((a) => `### Answer ${a.letter} (${PROVIDERS[a.provider].name}${council.scoreboard?.[a.model]?.avg != null ? `, peer score ${council.scoreboard[a.model].avg}/10` : ""})\n${a.text}`).join("\n\n");
      const disagreements = Object.values(council.reviews).map((r) => r.disagreement).filter((d) => d && d.toLowerCase() !== "none");
      const cite = council.sources.length ? `\n\n${sourcesBlock(council.sources, council.searchEngine)}\n\nKeep the [n] citations from the answers exactly as they are; they refer to the numbered sources above.` : "";
      let text = "";
      for await (const ev of streamChat({
        provider: chair.provider, model: chair.model, maxTokens: Math.max(1200, maxTokens),
        system: "You chair a council of AI experts. Write the single best final answer for the user, merging the strongest material from the answers below and fixing their errors. Then add a short section '**Where the council disagreed**' (2-5 bullets, or 'None') and '**Credits**' naming which answer contributed what in one line each. No preamble.",
        messages: [{ role: "user", content: `QUESTION:\n${prompt}\n\nANSWERS:\n${packet}${disagreements.length ? `\n\nREVIEWERS FLAGGED THESE CONFLICTS:\n- ${disagreements.join("\n- ")}` : ""}${cite}` }],
      })) {
        if (ev.type === "delta") { text += ev.text; emit("agent.delta", { agent, missionId: id, text: ev.text }); }
        else if (ev.type === "done") {
          const ms = Date.now() - s;
          noteCall(chair.provider, true, ms);
          const e = recordCall({ provider: chair.provider, model: chair.model, usage: ev.usage, missionId: id, role: "chair", ms });
          council.cost += e.cost;
          emit("agent.done", { agent, provider: chair.provider, model: chair.model, missionId: id, ms, cost: e.cost });
        }
      }
      council.verdict = { provider: chair.provider, model: chair.model, text };
    } catch (err) {
      noteCall(chair.provider, false, Date.now() - s, err.status);
      council.verdict = { provider: chair.provider, model: chair.model, error: err.message, text: good.sort((a, b) => (council.scoreboard?.[b.model]?.avg || 0) - (council.scoreboard?.[a.model]?.avg || 0))[0].text };
      emit("agent.error", { agent, provider: chair.provider, model: chair.model, missionId: id, error: err.message });
    }
  }
  council.status = "done";
  council.finishedAt = Date.now();
  council.cost = +council.cost.toFixed(5);
  emit("council.update", { council: pub(council) });
  emit("mission.update", { mission: summaryOf(council) });
  emit("log", { text: `Council finished in ${((council.finishedAt - t0) / 1000).toFixed(0)}s for $${council.cost.toFixed(4)}.`, missionId: id });
  return save(council);
}

function pub(c) { return c; }
function save(c) {
  ctx().store.saveMission(c, summaryOf(c));
  return c;
}
export function summaryOf(c) {
  return { id: c.id, kind: c.kind, title: c.prompt.slice(0, 90), projectId: c.projectId, status: c.status, startedAt: c.startedAt, finishedAt: c.finishedAt || null, cost: c.cost, members: c.members?.map((m) => m.provider), winner: c.winner ? PROVIDERS[c.answers[c.winner]?.provider]?.name : null };
}
