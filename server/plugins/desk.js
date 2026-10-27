// Home, private mode, readers, backup, repeat, double-check, tone, chats, plain credits.
import { heuristicClassify, rank } from "../router.js";
import { councilPlan, planMode } from "../modes.js";
import { PROVIDERS } from "../registry.js";
import { completeFallback } from "../fallback.js";
import { guardFeature } from "../feature-gate.js";
import { ctx } from "../store.js";
import { allStatus } from "../health.js";
import { enabledTools } from "../mcp.js";
import { pickAgent } from "../agents.js";
import { searchSettings } from "../search.js";
import {
  FIRST_COUNCIL, PRIVATE_LINE, TONES, armTone, backupDocument, chatRows, consumeTone, creditsView, homeCard,
  projectRemoval, readBackup, readersFor, repeatBody, secondReader, takeMembers, writerLine, writerOf,
} from "../desk.js";

import { runnableOnly } from "../runnable.js";

export const id = "desk";

const nameOf = (pid) => PROVIDERS[pid]?.name || pid || "AI";

function fail(status, message, code) {
  const e = new Error(message);
  e.status = status;
  e.code = code || null;
  throw e;
}

function missions() {
  try { return ctx().store.listMissions((m) => m).filter(Boolean); }
  catch { return []; }
}

function namesFor(mode, prompt) {
  const cls = heuristicClassify(prompt || "");
  const plan = councilPlan(mode === "mission" ? "balanced" : mode === "savings" ? "savings" : "balanced");
  const priority = mode === "mission" ? planMode("balanced") : plan.priority;
  const ranked = runnableOnly(rank({ ...cls, mode: priority })); // an AI that is paused or out of credits is not a reader
  const members = takeMembers(ranked, { limit: mode === "mission" ? 4 : plan.members });
  const readers = members.map((m) => ({ id: m.provider, name: nameOf(m.provider) }));
  // the planner is the AI the Mission planner will really pick (reasoning, hard), not just the first reader
  const real = mode === "mission" ? runnableOnly(rank({ capability: "reasoning", difficulty: 3, needWeb: false, mode: priority }))[0] : null;
  const planner = real ? nameOf(real.provider) : readers[0]?.name || "";
  if (real && !readers.some((r) => r.id === real.provider)) readers.unshift({ id: real.provider, name: nameOf(real.provider) });
  return { readers, names: readers.map((r) => r.name), planner };
}

// Tools that are already on, and services this prompt would actually reach. No MCP start, no search, no spend.
function audienceFor(mode, prompt) {
  const tools = enabledTools().map((t) => ({ name: t.tool?.name || t.name, server: t.server?.name || "" }));
  const services = [];
  const pick = pickAgent({ prompt });
  if (pick.use && pick.agent) services.push({ id: pick.agent.id, name: pick.agent.name });
  if (searchSettings().on?.[mode]) services.push({ id: "search", name: "Web search" });
  return { tools, services };
}

export async function routes(req, res, url, body, h) {
  const method = req.method;
  const sub = url.pathname.replace(/^\/api\/desk\/?/, "");
  const tier = () => h.licenseState().tier;

  if (method === "GET" && (sub === "" || sub === "home")) {
    const s = h.settings();
    const hasKey = Object.values(ctx().secrets || {}).some((v) => v && v.key);
    const card = homeCard({ missions: missions(), projects: h.listProjects(), onboarded: !!s.onboarded, keyed: hasKey });
    return h.json(res, 200, card), true;
  }

  if (method === "GET" && sub === "chats") return h.json(res, 200, { chats: chatRows(missions()) }), true;

  if (method === "GET" && sub === "credits") {
    return h.json(res, 200, creditsView({ ledger: h.ledgerSummary(), statuses: allStatus(), providers: PROVIDERS })), true;
  }

  if (method === "GET" && sub === "tones") return h.json(res, 200, { tones: TONES.map(({ id: tid, label }) => ({ id: tid, label })) }), true;

  if (method === "POST" && sub === "readers") {
    const mode = body?.mode === "mission" ? "mission" : body?.mode === "council" ? "council" : "";
    const prompt = String(body?.prompt || "").trim();
    if (!mode) return fail(400, "Say whether this is a council or a mission.", "mode");
    if (!prompt) return fail(400, "Type the prompt first.", "prompt");
    const picked = namesFor(mode, prompt.slice(0, 8000));
    const who = audienceFor(mode, prompt.slice(0, 8000));
    const view = readersFor({ mode, names: picked.names, planner: picked.planner, readers: picked.readers, tools: who.tools, services: who.services });
    const s = h.settings();
    if (mode === "council" && !s.councilIntro) view.explain = FIRST_COUNCIL;
    if (s.privateMode) view.private = PRIVATE_LINE;
    view.privateOn = !!s.privateMode;
    return h.json(res, 200, view), true;
  }

  if (method === "POST" && sub === "private") {
    guardFeature("privateMode", tier());
    const on = !!body?.on;
    const { putDoc } = await import("../store.js");
    const s = h.settings();
    putDoc("settings", { ...s, privateMode: on });
    return h.json(res, 200, { privateMode: on, line: on ? PRIVATE_LINE : "Private mode is off." }), true;
  }

  if (method === "GET" && sub === "backup") {
    guardFeature("backup", tier());
    const file = backupDocument({ projects: h.listProjects(), chats: missions(), settings: h.settings() });
    return h.json(res, 200, file), true;
  }

  if (method === "POST" && sub === "restore") {
    guardFeature("backup", tier());
    const data = readBackup(body?.file ?? body);
    const { putDoc } = await import("../store.js");
    const current = h.settings();
    const next = { ...current, ...(data.settings || {}) };
    if (current.cloud) next.cloud = current.cloud;
    putDoc("settings", next);
    putDoc("projects", { projects: data.projects });
    let restored = 0;
    for (const chat of data.chats) {
      if (!chat || !chat.id || !chat.kind) continue;
      ctx().store.saveMission(chat);
      restored++;
    }
    return h.json(res, 200, { ok: true, projects: data.projects.length, chats: restored, includesKeys: false }), true;
  }

  if (method === "POST" && sub === "repeat") {
    guardFeature("repeats", tier());
    const run = await ctx().store.getMission(String(body?.id || "").replace(/[^a-z0-9-]/gi, ""));
    const spec = repeatBody(run);
    if (spec.error) return fail(spec.status || 400, spec.error, "repeat");
    const taken = consumeTone(h.settings());
    if (taken.tone) {
      const { putDoc } = await import("../store.js");
      putDoc("settings", taken.settings);
      spec.body.tone = taken.tone.instruction;
      spec.body.toneId = taken.tone.id;
    }
    try {
      const started = spec.kind === "single" ? h.runChat(spec.body) : spec.kind === "council" ? h.runCouncil(spec.body) : h.runMission(spec.body);
      Promise.resolve(started).catch(() => {});
    } catch (e) {
      if (taken.tone) {
        const { putDoc } = await import("../store.js");
        putDoc("settings", { ...h.settings(), nextTone: taken.tone.id });
      }
      return fail(e.status || 500, e.message, e.code);
    }
    return h.json(res, 202, { ok: true, kind: spec.kind, replayedFrom: run.id }), true;
  }

  if (method === "POST" && sub === "review") {
    guardFeature("doubleCheck", tier());
    const run = await ctx().store.getMission(String(body?.id || "").replace(/[^a-z0-9-]/gi, ""));
    if (!run) return fail(404, "That chat was not found.", "missing");
    const wrote = writerOf(run);
    if (!wrote?.text) return fail(400, "There is no answer to double-check yet.", "empty");
    const cls = heuristicClassify(String(wrote.prompt || wrote.text).slice(0, 2000));
    const other = secondReader(rank({ ...cls, mode: "balanced" }), wrote.provider);
    if (!other) return fail(400, "Add another AI to double-check this.", "reader");
    const system = "You are a second reader. Check the answer for mistakes and missing points. Be brief. Do not invent facts. Do not send, post, or buy anything.";
    const messages = [{ role: "user", content: `Question:\n${String(wrote.prompt || "").slice(0, 4000)}\n\nAnswer:\n${String(wrote.text).slice(0, 8000)}` }];
    const r = await completeFallback(
      { provider: other.provider, model: other.model, maxTokens: 700, system, messages },
      { missionId: run.id, tools: false, role: "review", mode: "balanced", cls },
    );
    const e = h.recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: run.id, role: "review" });
    run.cost = +((Number(run.cost) || 0) + (e.cost || 0)).toFixed(6);
    const review = {
      provider: r.provider,
      model: r.model,
      name: nameOf(r.provider),
      text: r.text || "",
      at: Date.now(),
      writer: nameOf(wrote.provider),
      line: `${writerLine(nameOf(wrote.provider))} Checked by ${nameOf(r.provider)}.`.trim(),
    };
    run.doubleCheck = review;
    ctx().store.saveMission(run);
    return h.json(res, 200, { ok: true, review }), true;
  }

  if (method === "POST" && sub === "tone") {
    const spec = armTone(h.settings().nextTone, body?.tone);
    if (spec.error) return fail(spec.status || 400, spec.error, "tone");
    const { putDoc } = await import("../store.js");
    putDoc("settings", { ...h.settings(), nextTone: spec.nextTone });
    return h.json(res, 200, { ok: true, tone: spec.nextTone, label: spec.label, line: spec.line }), true;
  }

  if (method === "GET" && sub === "project-receipt") {
    const id = String(url.searchParams.get("id") || "");
    if (!id) return fail(400, "project id required", "project");
    return h.json(res, 200, projectRemoval(id, { remove: false })), true;
  }

  return false;
}

export function init() {}
