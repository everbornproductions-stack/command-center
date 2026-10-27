// Pro search and Deep Research, on top of the Phase 15 search engines.
// Pro search runs a few queries and keeps one numbered source list.
// Deep Research reads pages, writes a cited report, and asks a second AI from
// another vendor to cross-check it. The run is a mission row, so it shows up
// with the rest of the work and can continue as a mission (browser and desktop).
import { emit } from "./events.js";
import fs from "node:fs";
import path from "node:path";
import { ctx, doc, putDoc, HOSTED } from "./store.js";
import { DATA_DIR } from "./paths.js";
import { assertSpendAllowed } from "./cost-guard.js";
import { PROVIDERS } from "./registry.js";
import { recordCall } from "./ledger.js";
import { completeFallback } from "./fallback.js";
import { pick, rank } from "./router.js";
import { localFetch } from "./loopback-fetch.js";
import { htmlToText } from "./receipts.js";
import { requireResearch } from "./feature-gate.js";
import { reportPdf, reportDocx } from "./research-export.js";
import { openSources, pagesBlock, coverageLine, searchPreflight, sourceStatus } from "./page-reader.js";
import {
  augment, runSearch, resolveEngine, sourcesBlock, queryFor, normalizeFilter, mayCallLive,
} from "./search.js";

export { reportPdf, reportDocx };

export const FLAG_AGENTS = "flag_agents";
export const COST_MULTIPLIER = 15;
export const COST_WARNING = "Deep research runs parallel agents and uses about 15 times the tokens of a normal chat.";
export const EFFORT_RULES = {
  simple: { level: "simple", subAgents: 1, facets: 2, searchesPerAgent: 1, readsPerAgent: 2, maxToolCalls: 3 },
  standard: { level: "standard", subAgents: 3, facets: 3, searchesPerAgent: 2, readsPerAgent: 2, maxToolCalls: 6 },
  complex: { level: "complex", subAgents: 5, facets: 5, searchesPerAgent: 2, readsPerAgent: 2, maxToolCalls: 10 },
};

export function agentsFlagOn() {
  try {
    const appSettings = doc("settings", () => ({})) || {};
    if (typeof appSettings.flag_agents === "boolean") return appSettings.flag_agents;
    const bhSettings = doc("browser.settings", () => ({})) || {};
    if (typeof bhSettings.flag_agents === "boolean") return bhSettings.flag_agents;
  } catch {}
  return !(process.env.CC_FLAG_AGENTS === "0" || process.env.flag_agents === "0" || process.env.CC_FLAG_AGENTS === "false");
}

export function setAgentsFlag(on) {
  const val = !!on;
  try {
    const cur = doc("settings", () => ({})) || {};
    putDoc("settings", { ...cur, flag_agents: val });
  } catch {}
  return val;
}

export function scaleEffort(prompt = "", opts = {}) {
  if (opts?.effort && EFFORT_RULES[opts.effort]) {
    const base = EFFORT_RULES[opts.effort];
    const facets = opts.facets ? Math.max(2, Math.min(5, Number(opts.facets))) : base.facets;
    return { ...base, facets, subAgents: Math.min(5, Math.max(1, opts.subAgents ? Number(opts.subAgents) : base.subAgents)) };
  }
  const text = String(prompt || "").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const clauses = (text.match(/[?;,]|\band\b|\bversus\b|\bvs\.?\b/gi) || []).length;
  const complexMarkers = /\b(compare|comparison|market|competitor|comprehensive|deep dive|architecture|trade-?offs|pros and cons|synthesis|multi-?angle|landscape|benchmark|forecast|regulatory)\b/i.test(text);
  if (words >= 22 || (complexMarkers && words >= 10) || clauses >= 3) {
    const count = words >= 28 || clauses >= 4 ? 5 : 4;
    return { ...EFFORT_RULES.complex, facets: count, subAgents: count };
  }
  if (words <= 7 && !complexMarkers && clauses === 0) return { ...EFFORT_RULES.simple };
  return { ...EFFORT_RULES.standard };
}

export function costWarning(effort = EFFORT_RULES.standard) {
  return {
    multiplier: COST_MULTIPLIER,
    text: COST_WARNING,
    level: effort?.level || "standard",
    subAgents: effort?.subAgents || 3,
    facets: effort?.facets || 3,
  };
}

const FACET_TEMPLATES = [
  { key: "overview", title: "Core facts and current state", suffix: "overview key facts", angle: "Establish the baseline facts, definitions, and current metrics." },
  { key: "evidence", title: "Primary data and recent findings", suffix: "data study report", angle: "Gather concrete numbers, primary studies, and recent updates." },
  { key: "comparison", title: "Comparisons and alternatives", suffix: "comparison alternatives", angle: "Compare competing approaches, options, or benchmarks." },
  { key: "risks", title: "Limits, risks, and counter-arguments", suffix: "limits risks challenges", angle: "Identify limitations, failure modes, and opposing evidence." },
  { key: "outlook", title: "Practical takeaways and outlook", suffix: "trends outlook implementation", angle: "Summarize practical implications and what happens next." },
];

export function planFacets(prompt = "", opts = {}) {
  const effort = scaleEffort(prompt, opts);
  const count = Math.max(2, Math.min(5, Number(opts.facets || effort.facets || 3)));
  const base = queryFor(prompt).split(" ").slice(0, 8).join(" ") || String(prompt || "").trim().slice(0, 80);
  const facets = FACET_TEMPLATES.slice(0, count).map((tpl, i) => ({
    id: `facet-${i + 1}`,
    index: i + 1,
    key: tpl.key,
    title: tpl.title,
    query: String(`${base} ${tpl.suffix}`).replace(/\s+/g, " ").trim().slice(0, 260),
    angle: tpl.angle,
    outputFormat: "Concise bullet findings with [n] citations and source URLs",
    doneBoundary: `Stop after reading up to ${effort.readsPerAgent} relevant sources or ${effort.searchesPerAgent} search steps`,
    status: "pending",
  }));
  return { leadRole: "LeadResearcher", prompt: String(prompt || "").trim().slice(0, 500), effort, count: facets.length, facets };
}

export function researchMemoryPath(id) {
  const safe = String(id || "").replace(/[^a-z0-9-]/gi, "");
  return path.join(DATA_DIR, "research", `${safe}.json`);
}

export function readExternalMemory(id) {
  const safe = String(id || "").replace(/[^a-z0-9-]/gi, "");
  if (!safe) return null;
  try {
    if (!HOSTED) {
      const fp = researchMemoryPath(safe);
      if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf8"));
    }
  } catch {}
  try { return doc(`research.memory.${safe}`, () => null); } catch { return null; }
}

export function writeExternalMemory(id, patch = {}) {
  const safe = String(id || "").replace(/[^a-z0-9-]/gi, "");
  if (!safe) return null;
  const prev = readExternalMemory(safe) || { id: safe, createdAt: Date.now(), checkpoints: [] };
  const next = {
    ...prev,
    ...patch,
    id: safe,
    updatedAt: Date.now(),
    checkpoints: [
      ...(prev.checkpoints || []).slice(-30),
      ...(patch.phase ? [{ phase: patch.phase, ts: Date.now(), cost: patch.cost ?? prev.cost ?? 0 }] : []),
    ],
  };
  try { putDoc(`research.memory.${safe}`, next); } catch {}
  if (!HOSTED) {
    try {
      const fp = researchMemoryPath(safe);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(next, null, 2), "utf8");
    } catch {}
  }
  return next;
}

export function citationPass(report = "", sources = [], reads = []) {
  const maxN = (sources || []).length;
  let invalidRemoved = 0;
  let cleaned = String(report || "").replace(/\[(\d+)\]/g, (m, num) => {
    const n = Number(num);
    if (n >= 1 && n <= maxN) return m;
    invalidRemoved += 1;
    return "";
  });
  if (!maxN) {
    return { role: "CitationAgent", text: cleaned.trim(), citationsAdded: 0, invalidRemoved, verifiedClaims: 0, ungroundedClaims: 0, sourceCount: 0 };
  }
  // Only a source whose page was really opened can back a claim. A title or snippet is a listing, not a check.
  const openedN = new Set((reads || []).filter((r) => r.opened !== false && (r.text || r.excerpt)).map((r) => r.n ?? (sources || []).find((s) => s.url === r.url)?.n));
  const sourceTokens = (sources || []).filter((s) => openedN.has(s.n)).map((s) => {
    const rd = (reads || []).find((r) => r.n === s.n || r.url === s.url);
    const bag = `${s.title || ""} ${s.snippet || ""} ${s.host || ""} ${rd?.excerpt || ""} ${rd?.text || ""}`.toLowerCase();
    const words = new Set((bag.match(/[a-z0-9]{4,}/g) || []).slice(0, 120));
    return { n: s.n, words };
  });
  const pickBestSource = (line) => {
    const lw = (String(line || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
    let bestN = sourceTokens[0].n, bestScore = -1;
    for (const st of sourceTokens) {
      let score = 0;
      for (const w of lw) if (st.words.has(w)) score += 1;
      if (score > bestScore) { bestN = st.n; bestScore = score; }
    }
    return bestN;
  };
  const parts = cleaned.split(/(\n## Cross-check[\s\S]*$)/i);
  const bodyLines = parts[0].split("\n");
  let citationsAdded = 0;
  let verifiedClaims = 0;
  let listingOnlyClaims = 0;
  const updatedLines = bodyLines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || idx === 0 || /^#{1,6}\s/.test(trimmed) || /^```/.test(trimmed) || /^Sources$/i.test(trimmed)) return line;
    if (/\[\d+\]/.test(trimmed)) {
      const cites = [...trimmed.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
      if (cites.some((n) => openedN.has(n))) verifiedClaims += 1; else listingOnlyClaims += 1;
      return line;
    }
    if (trimmed.length < 18 || !sourceTokens.length) return line;
    const bestN = pickBestSource(trimmed);
    citationsAdded += 1;
    verifiedClaims += 1;
    return /\.$/.test(trimmed) ? `${line.replace(/\.\s*$/, "")} [${bestN}].` : `${line} [${bestN}]`;
  });
  const finalText = updatedLines.join("\n") + (parts[1] || "");
  return { role: "CitationAgent", text: finalText.trim(), citationsAdded, invalidRemoved, verifiedClaims, listingOnlyClaims, ungroundedClaims: 0, sourceCount: maxN, openedCount: sourceTokens.length };
}

const running = new Map(); // id -> AbortController

class ResearchStopped extends Error {
  constructor() { super("Stopped."); this.code = "aborted"; this.name = "ResearchStopped"; }
}

function throwIfStopped(signal) {
  if (signal?.aborted) throw new ResearchStopped();
}

export function abortResearch(id) {
  const ctl = running.get(String(id || ""));
  if (!ctl || ctl.signal.aborted) return false;
  ctl.abort();
  return true;
}

const clean = (t, n = 300) => String(t || "").replace(/\s+/g, " ").trim().slice(0, n);

export function followQueries(prompt, sources, filter = "web") {
  const base = queryFor(prompt).split(" ").slice(0, 8).join(" ");
  const title = clean(String(sources?.[0]?.title || "").replace(/\(demo\)/gi, ""), 60);
  const second = clean(title ? `${base} ${title}` : `${base} details`, 300);
  const third = clean(filter === "academic" ? `${base} study` : filter === "news" ? `${base} latest report` : `${base} limits`, 300);
  return [...new Set([second, third].filter((q) => q && q !== queryFor(prompt)))];
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out.map((r, i) => ({ ...r, n: i + 1 }));
}

export async function prepareWeb(opts = {}) {
  if (opts.explicit === false) return null;
  if (opts.mode === "pro") {
    const gate = requireResearch("proSearch");
    if (!gate.ok) return { skipped: true, reason: gate.message, sources: [], block: "", prompt: opts.prompt, pro: true };
    return withPages(await proSearch(opts), { question: opts.prompt, signal: opts.signal });
  }
  return withPages(await augment(opts), { question: opts.prompt, signal: opts.signal });
}

export async function proSearch({ prompt, provider, model, missionId = null, taskId = null, filter, offset = 0, signal } = {}) {
  const useFilter = normalizeFilter(filter);
  const pickEngine = resolveEngine({ provider, model });
  if (pickEngine.native) return { native: true, provider: pickEngine.engine, name: pickEngine.name, sources: [], block: "", prompt, pro: true };
  if (!pickEngine.engine) {
    emit("log", { text: `Pro search is on, but ${pickEngine.reason}`, level: "error", missionId });
    return { skipped: true, reason: pickEngine.reason, sources: [], block: "", prompt, pro: true };
  }
  const steps = [queryFor(prompt, pickEngine.engine)];
  let rows = [];
  let cost = 0;
  let name = pickEngine.name;
  let demo = !!pickEngine.demo;
  for (let i = 0; i < 3; i++) {
    throwIfStopped(signal);
    const q = steps[i];
    if (!q) break;
    try {
      const r = await runSearch(q, { engine: pickEngine.engine, missionId, taskId, role: i === 0 ? "pro-search" : "pro-search-follow", filter: useFilter, offset: 0 });
      rows = dedupe([...rows, ...r.sources]);
      cost += r.cost || 0;
      name = r.name;
      demo = !!r.demo;
      if (i === 0) steps.push(...followQueries(prompt, rows, useFilter));
      if (rows.length >= 8) break;
    } catch (err) {
      if (signal?.aborted || err?.code === "aborted") throw err?.code === "aborted" ? err : new ResearchStopped();
      if (i === 0) {
        emit("log", { text: `Pro search skipped: ${err.message}`, level: "error", missionId });
        return { skipped: true, reason: err.message, sources: [], block: "", prompt, pro: true };
      }
      emit("log", { text: `Pro search stopped after ${rows.length} source${rows.length === 1 ? "" : "s"}: ${err.message}`, missionId });
      break;
    }
  }
  const sources = rows.map((r, i) => ({ ...r, n: offset + i + 1 }));
  const block = sourcesBlock(sources, name);
  emit("log", { text: `Pro search (${name}): ${steps.filter(Boolean).length} step${steps.filter(Boolean).length === 1 ? "" : "s"}, ${sources.length} source${sources.length === 1 ? "" : "s"}.`, missionId });
  return { engine: pickEngine.engine, name, demo, sources, block, prompt: block ? `${prompt}\n\n${block}` : prompt, cost, pro: true, filter: useFilter, steps: steps.filter(Boolean) };
}

// Every source gets a result: opened with text, or "could not open" with a plain reason (never a silent skip).
export async function readAll(sources, limit = 4, signal, { question = "", fetcher } = {}) {
  throwIfStopped(signal);
  const pages = await openSources(sources, { question, limit, fetcher: fetcher || pageFetcher, signal });
  throwIfStopped(signal);
  return pages;
}

// Tests swap this to a mock; the app uses the real fetcher.
let pageFetcher;
export function setPageFetcher(fn) { pageFetcher = fn || undefined; }

export async function readSources(sources, limit = 4, signal, opts) {
  return (await readAll(sources, limit, signal, opts)).filter((p) => p.opened);
}

// Chat, Council and Mission: after a search, open the top pages so the answer is built from pages, not titles.
export async function withPages(web, { question = "", limit = 3, signal } = {}) {
  if (!web?.sources?.length || web.demo || web.native) return web;
  const pages = await readAll(web.sources, limit, signal, { question });
  const note = "These are search listings. Only pages marked PAGE OPENED were read. Never say a fact is verified, confirmed or checked from a listing alone; say it comes from the search listing.";
  const block = `${web.block}\n\n${note}\n\n${pagesBlock(pages)}`;
  return { ...web, pages, coverage: coverageLine(pages), block, prompt: `${String(web.prompt).split("\n\nWEB SEARCH RESULTS")[0]}\n\n${block}` };
}

function task(id, title, capability, status) {
  return { id, title, capability, status, provider: null, model: null, cost: 0 };
}

function blank(prompt, filter, projectId) {
  const id = "r-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return {
    id, kind: "research", prompt, title: clean(prompt, 90), projectId: projectId || null,
    filter: normalizeFilter(filter), mode: "deep", status: "running", startedAt: Date.now(),
    cost: 0, deliverable: "", sources: [], reads: [], tasks: [
      task("search", "Search the web", "research", "running"),
      task("read", "Read sources", "research", "pending"),
      task("write", "Write the report", "writing", "pending"),
      task("check", "Cross-check with another AI", "analysis", "pending"),
    ],
    searchEngine: null, crossCheck: null, steps: [], fallbacks: [],
  };
}

function persist(m) {
  const summary = {
    id: m.id, kind: m.kind, title: m.title, projectId: m.projectId, status: m.status,
    startedAt: m.startedAt, finishedAt: m.finishedAt || null, cost: m.cost,
    tasks: m.tasks?.length || 0,
    providers: [...new Set((m.tasks || []).map((t) => t.provider).filter(Boolean))],
  };
  ctx().store.saveMission(m, summary);
  return summary;
}

const publish = (m) => {
  const copy = { ...m, reads: (m.reads || []).map(({ text, ...rest }) => rest) };
  emit("mission.update", { mission: copy });
};

function setTask(m, id, patch) {
  const t = m.tasks.find((x) => x.id === id);
  if (t) Object.assign(t, patch);
}

async function ask(m, who, { role, system, content, capability, difficulty, signal }) {
  if (m.orchestrated || agentsFlagOn()) {
    assertSpendAllowed({ provider: who.provider, missionSpend: m.cost || 0, maxMissionSpend: m.maxCostUsd });
  }
  throwIfStopped(signal);
  const agent = `${m.id}:${role}`;
  emit("agent.start", { agent, provider: who.provider, model: who.model, role, missionId: m.id, label: `${PROVIDERS[who.provider]?.name || who.provider}: ${role}` });
  const t0 = Date.now();
  const r = await completeFallback({
    provider: who.provider, model: who.model, maxTokens: role === "check" ? 900 : 2200, signal,
    system, messages: [{ role: "user", content }],
  }, { missionId: m.id, role, tools: false, cls: { capability, difficulty }, mode: "quality" });
  throwIfStopped(signal);
  const ms = Date.now() - t0;
  const e = recordCall({ provider: r.provider, model: r.model, usage: r.usage, missionId: m.id, role, ms });
  m.cost = +(m.cost + (e.cost || 0)).toFixed(6);
  emit("agent.done", { agent, provider: r.provider, model: r.model, missionId: m.id, ms, cost: e.cost });
  return r;
}

function readingBlock(reads) {
  if (!reads.length) return "";
  return pagesBlock(reads);
}

export async function runSubAgent(m, facet, { engine, filter = "web", readsPerAgent = 2, maxRetries = 1, signal } = {}) {
  throwIfStopped(signal);
  const contextId = `${m.id}:${facet.id}`;
  const isolatedMessages = [
    { role: "system", content: `You are Research Sub-agent ${facet.index} (${facet.title}). Objective: ${facet.angle}. Output format: ${facet.outputFormat}. Done boundary: ${facet.doneBoundary}.` },
    { role: "user", content: `FACET: ${facet.title}\nQUERY: ${facet.query}` },
  ];
  let attempts = 0;
  let lastErr = null;
  while (attempts <= maxRetries) {
    throwIfStopped(signal);
    attempts += 1;
    try {
      if (m.maxCostUsd && (m.cost || 0) >= m.maxCostUsd) {
        const capErr = new Error(`Spend cap reached ($${m.maxCostUsd}).`);
        capErr.code = "spend_cap";
        throw capErr;
      }
      const useEngine = engine || resolveEngine({}).engine;
      let sources = [];
      let cost = 0;
      let engineName = null;
      if (useEngine) {
        const sr = await runSearch(facet.query, { engine: useEngine, missionId: m.id, taskId: facet.id, role: `subagent-${facet.id}`, filter: normalizeFilter(filter), offset: 0 });
        sources = sr.sources || [];
        cost = sr.cost || 0;
        engineName = sr.name || useEngine;
      }
      throwIfStopped(signal);
      const top = sources.slice(0, readsPerAgent);
      const pages = await readAll(top.map((s, i) => ({ ...s, n: s.n || i + 1 })), top.length, signal, { question: facet.query });
      const reads = pages.filter((p) => p.opened);
      const bullets = sources.slice(0, 3).map((s) => {
        const rd = reads.find((r) => r.url === s.url);
        const pg = pages.find((r) => r.url === s.url);
        if (rd) return `- ${s.title} (${s.url}), page opened: ${clean(rd.excerpt, 220)}${rd.details?.length ? ` Details: ${rd.details.map((d) => `${d.kind} ${d.value}`).join(", ")}.` : ""}`;
        return `- ${s.title} (${s.url}), ${pg ? `could not open (${pg.reason})` : "not opened"}; search listing only: ${clean(s.snippet || s.title, 160)}`;
      });
      const condensed = bullets.length ? `### ${facet.title}\n${bullets.join("\n")}` : `### ${facet.title}\n- No live sources returned for "${facet.query}".`;
      return {
        facetId: facet.id,
        title: facet.title,
        angle: facet.angle,
        query: facet.query,
        role: "ResearchSubAgent",
        isolatedContext: true,
        contextId,
        contextSize: isolatedMessages.length,
        doneBoundary: facet.doneBoundary,
        status: "done",
        attempts,
        engineName,
        sources,
        reads,
        pages,
        condensed,
        cost,
      };
    } catch (err) {
      if (signal?.aborted || err?.code === "aborted" || err?.code === "spend_cap") throw err;
      lastErr = err;
      if (attempts > maxRetries) {
        return {
          facetId: facet.id,
          title: facet.title,
          angle: facet.angle,
          query: facet.query,
          role: "ResearchSubAgent",
          isolatedContext: true,
          contextId,
          doneBoundary: facet.doneBoundary,
          status: "failed",
          attempts,
          error: err.message || "sub-agent failed",
          sources: [],
          reads: [],
          condensed: `### ${facet.title}\n- Sub-agent could not complete this facet (${clean(err.message, 120)}).`,
          cost: 0,
        };
      }
    }
  }
  throw lastErr || new Error("sub-agent failed");
}

async function workOrchestrated(m, signal) {
  try {
    throwIfStopped(signal);
    const prevMem = readExternalMemory(m.id);
    const effort = m.effort || prevMem?.effort || scaleEffort(m.prompt, { effort: m.effortLevel, facets: m.facetCount, filter: m.filter });
    m.orchestrated = true;
    m.effort = effort;
    m.costWarning = m.costWarning || costWarning(effort);
    m.memoryPath = researchMemoryPath(m.id);
    assertSpendAllowed({ provider: "research", missionSpend: m.cost || 0, maxMissionSpend: m.maxCostUsd });

    const planned = prevMem?.facets?.length ? { facets: prevMem.facets, count: prevMem.facets.length } : planFacets(m.prompt, { effort: effort.level, facets: effort.facets, filter: m.filter });
    m.facets = planned.facets;
    writeExternalMemory(m.id, {
      prompt: m.prompt,
      filter: m.filter,
      effort,
      costWarning: m.costWarning,
      phase: "planned",
      facets: m.facets,
      cost: m.cost,
    });
    emit("log", { text: `LeadResearcher planned ${m.facets.length} facets (${effort.level} effort, up to ${effort.subAgents} parallel sub-agents). ${COST_WARNING}`, missionId: m.id });
    publish(m);

    const pickEng = resolveEngine({});
    const subResults = Array.isArray(prevMem?.subAgentResults) ? [...prevMem.subAgentResults] : [];
    const doneIds = new Set(subResults.filter((r) => r.status === "done").map((r) => r.facetId));
    const pendingFacets = m.facets.filter((f) => !doneIds.has(f.id));
    const batchSize = Math.max(1, Math.min(5, effort.subAgents || 3));

    for (let i = 0; i < pendingFacets.length; i += batchSize) {
      throwIfStopped(signal);
      const batch = pendingFacets.slice(i, i + batchSize);
      for (const f of batch) f.status = "running";
      publish(m);
      const batchOut = await Promise.all(batch.map((f) => runSubAgent(m, f, {
        engine: pickEng.engine,
        filter: m.filter,
        readsPerAgent: effort.readsPerAgent || 2,
        maxRetries: 1,
        signal,
      })));
      throwIfStopped(signal);
      for (const res of batchOut) {
        const f = m.facets.find((x) => x.id === res.facetId);
        if (f) { f.status = res.status; f.attempts = res.attempts; }
        m.cost = +(m.cost + (res.cost || 0)).toFixed(6);
        const existingIdx = subResults.findIndex((x) => x.facetId === res.facetId);
        if (existingIdx >= 0) subResults[existingIdx] = res;
        else subResults.push(res);
        if (res.query && !m.steps.includes(res.query)) m.steps.push(res.query);
        if (res.engineName && !m.searchEngine) m.searchEngine = res.engineName;
      }
      writeExternalMemory(m.id, {
        phase: "subagents",
        facets: m.facets,
        subAgentResults: subResults.map(({ reads, ...rest }) => ({ ...rest, reads: (reads || []).map(({ text, ...r }) => r) })),
        cost: m.cost,
      });
    }

    const rawSources = [];
    const rawReadsByUrl = new Map();
    for (const sr of subResults) {
      for (const s of sr.sources || []) rawSources.push(s);
      for (const r of sr.reads || []) if (r.url && !rawReadsByUrl.has(r.url)) rawReadsByUrl.set(r.url, r);
    }
    m.sources = dedupe(rawSources);
    if (!m.sources.length) {
      const web = await proSearch({ prompt: m.prompt, missionId: m.id, filter: m.filter, signal });
      throwIfStopped(signal);
      if (web?.sources?.length) {
        m.sources = web.sources;
        m.searchEngine = web.name;
        m.steps = web.steps || [];
        m.cost = +(m.cost + (web.cost || 0)).toFixed(6);
      }
    }
    setTask(m, "search", { status: m.sources?.length ? "done" : "failed" });
    setTask(m, "read", { status: "running" });
    publish(m);

    const mappedReads = [];
    for (const s of m.sources) {
      const r = rawReadsByUrl.get(s.url);
      if (r) mappedReads.push({ ...r, n: s.n, opened: true });
    }
    let pageList = mappedReads;
    if (!mappedReads.length && m.sources.length) {
      pageList = await readAll(m.sources, 4, signal, { question: m.prompt });
      mappedReads.push(...pageList.filter((p) => p.opened));
    } else {
      const failedByUrl = new Map();
      for (const sr of subResults) for (const p of sr.pages || []) if (!p.opened && !failedByUrl.has(p.url)) failedByUrl.set(p.url, p);
      for (const s of m.sources) { const f = failedByUrl.get(s.url); if (f && !mappedReads.some((r) => r.url === s.url)) pageList.push({ ...f, n: s.n }); }
    }
    throwIfStopped(signal);
    m.reads = mappedReads;
    m.pages = pageList.map(({ text, ...r }) => r);
    m.coverage = coverageLine(pageList);
    m.subAgents = subResults.map((r) => ({ facetId: r.facetId, title: r.title, status: r.status, attempts: r.attempts, isolatedContext: r.isolatedContext, contextId: r.contextId, sourceCount: (r.sources || []).length }));
    setTask(m, "read", { status: "done" });
    setTask(m, "write", { status: "running" });
    publish(m);

    const writer = pick({ capability: "research", difficulty: 3, mode: "quality" }) || pick({ capability: "writing", difficulty: 2, mode: "balanced" });
    if (!writer) throw new Error("No AI is available to write the report. Add an API key in Settings.");
    const block = sourcesBlock(m.sources, m.searchEngine);
    const pages = readingBlock(pageList);
    const facetNotes = subResults.map((r) => r.condensed).filter(Boolean).join("\n\n");
    const draft = await ask(m, writer, {
      role: "write", capability: "research", difficulty: 3, signal,
      system: "You write a cited research report from the sources below. Cite facts with the source number in square brackets, like [1]. Only cite those numbers. Never invent a source. Only pages marked PAGE OPENED were read; for any other source say it comes from the search listing and was not opened. Never write verified or confirmed for a fact that only a title or snippet supports. Markdown. Put a short title on the first line. No preamble.",
      content: `QUESTION:\n${m.prompt}\n\nFACET FINDINGS:\n${facetNotes}\n\n${block || "No live pages were fetched."}${pages ? `\n\nPAGE TEXT:\n${pages}` : ""}`,
    });
    setTask(m, "write", { status: "done", provider: draft.provider, model: draft.model, cost: m.cost });
    let report = String(draft.text || "").trim() || "The report came back empty.";
    const writerVendor = PROVIDERS[draft.provider]?.vendor || draft.provider;

    const cited = citationPass(report, m.sources, m.reads);
    report = cited.text;
    report += `\n\n## Pages opened\n\n${m.coverage}\n\n${m.sources.map((s) => `[${s.n}] ${s.title}: ${sourceStatus(s, pageList).label}`).join("\n")}`;
    if (!m.reads.length) report = `> Read this first: no page could be opened, so nothing here was checked against a page.\n\n${report}`;
    m.citationAudit = {
      role: cited.role,
      citationsAdded: cited.citationsAdded,
      invalidRemoved: cited.invalidRemoved,
      verifiedClaims: cited.verifiedClaims,
      listingOnlyClaims: cited.listingOnlyClaims,
      openedCount: cited.openedCount,
      ungroundedClaims: cited.ungroundedClaims,
      sourceCount: cited.sourceCount,
    };
    writeExternalMemory(m.id, {
      phase: "cited",
      sources: m.sources,
      draftReport: draft.text,
      citedReport: report,
      citationAudit: m.citationAudit,
      cost: m.cost,
    });

    setTask(m, "check", { status: "running" });
    publish(m);
    const checker = rank({ capability: "analysis", difficulty: 2, mode: "balanced" }).find((x) => x.provider !== draft.provider && (PROVIDERS[x.provider]?.vendor || x.provider) !== writerVendor);
    if (!checker) {
      const note = "Only one AI vendor is connected, so a second company did not cross-check this report.";
      m.crossCheck = { provider: null, model: null, vendor: null, text: note, checked: false };
      report += `\n\n## Cross-check\n\n${note}`;
      setTask(m, "check", { status: "done" });
    } else {
      const check = await ask(m, checker, {
        role: "check", capability: "analysis", difficulty: 2, signal,
        system: "You are a second AI from a different company. Cross-check the report against the sources. Reply in Markdown with what holds up and what is thin or missing. Keep the [n] numbers. Do not invent a source.",
        content: `QUESTION:\n${m.prompt}\n\nREPORT:\n${report}\n\n${block}${pages ? `\n\nPAGE TEXT:\n${pages}` : ""}`,
      });
      const vendor = PROVIDERS[check.provider]?.vendor || check.provider;
      const name = PROVIDERS[check.provider]?.name || check.provider;
      m.crossCheck = { provider: check.provider, model: check.model, vendor, text: check.text, checked: true, writer: draft.provider, writerVendor };
      report += `\n\n## Cross-check\n\nChecked by ${name} (${vendor}).\n\n${String(check.text || "").trim()}`;
      setTask(m, "check", { status: "done", provider: check.provider, model: check.model });
    }
    m.provider = draft.provider;
    m.model = draft.model;
    m.deliverable = report;
    m.status = "done";
    m.finishedAt = Date.now();
    writeExternalMemory(m.id, { phase: "done", deliverable: m.deliverable, crossCheck: m.crossCheck, cost: m.cost, finishedAt: m.finishedAt });
    persist(m);
    publish(m);
    const cross = m.crossCheck?.checked ? `Cross-checked by ${PROVIDERS[m.crossCheck.provider]?.name || "a second AI"}.` : "No second vendor was connected to cross-check it.";
    emit("research.done", { id: m.id, ok: true, title: "Deep research is done", body: `${m.title}. ${cross} Open it in Meldmind.` });
  } catch (err) {
    if (signal?.aborted || err?.code === "aborted") {
      m.status = "aborted";
      m.error = "Stopped.";
      m.finishedAt = Date.now();
      for (const t of m.tasks) if (t.status === "running" || t.status === "pending") t.status = "aborted";
      writeExternalMemory(m.id, { phase: "aborted", error: m.error, cost: m.cost });
      persist(m);
      publish(m);
      emit("log", { text: "Deep research stopped.", missionId: m.id });
      emit("research.done", { id: m.id, ok: false, aborted: true, title: "Deep research stopped", body: `${m.title}. The run was stopped before the report was finished.` });
      return;
    }
    m.status = "failed";
    m.error = err.message || "Deep research failed";
    m.finishedAt = Date.now();
    for (const t of m.tasks) if (t.status === "running" || t.status === "pending") t.status = "failed";
    if (!m.deliverable) m.deliverable = m.error;
    writeExternalMemory(m.id, { phase: "failed", error: m.error, cost: m.cost });
    persist(m);
    publish(m);
    emit("log", { text: `Deep research failed: ${m.error}`, level: "error", missionId: m.id });
    emit("research.done", { id: m.id, ok: false, title: "Deep research failed", body: m.error });
  } finally {
    running.delete(m.id);
  }

}

async function work(m, signal) {
  if (m.orchestrated || agentsFlagOn()) return workOrchestrated(m, signal);
  try {
    throwIfStopped(signal);
    const web = await proSearch({ prompt: m.prompt, missionId: m.id, filter: m.filter, signal });
    throwIfStopped(signal);
    if (web?.sources?.length) {
      m.sources = web.sources;
      m.searchEngine = web.name;
      m.steps = web.steps || [];
      m.cost = +(m.cost + (web.cost || 0)).toFixed(6);
    }
    setTask(m, "search", { status: web?.sources?.length ? "done" : "failed" });
    setTask(m, "read", { status: "running" });
    publish(m);

    const pageList = m.sources?.length ? await readAll(m.sources, 4, signal, { question: m.prompt }) : [];
    const reads = pageList.filter((p) => p.opened);
    throwIfStopped(signal);
    m.reads = reads;
    m.pages = pageList.map(({ text, ...r }) => r);
    m.coverage = coverageLine(pageList);
    setTask(m, "read", { status: "done" });
    setTask(m, "write", { status: "running" });
    publish(m);

    const writer = pick({ capability: "research", difficulty: 3, mode: "quality" }) || pick({ capability: "writing", difficulty: 2, mode: "balanced" });
    if (!writer) throw new Error("No AI is available to write the report. Add an API key in Settings.");
    const block = sourcesBlock(m.sources, m.searchEngine);
    const pages = readingBlock(pageList);
    const draft = await ask(m, writer, {
      role: "write", capability: "research", difficulty: 3, signal,
      system: "You write a cited research report from the sources below. Cite facts with the source number in square brackets, like [1]. Only cite those numbers. Never invent a source. Only pages marked PAGE OPENED were read; for any other source say it comes from the search listing and was not opened. Never write verified or confirmed for a fact that only a title or snippet supports. Markdown. Put a short title on the first line. No preamble.",
      content: `QUESTION:\n${m.prompt}\n\n${block || "No live pages were fetched."}${pages ? `\n\nPAGE TEXT:\n${pages}` : ""}`,
    });
    setTask(m, "write", { status: "done", provider: draft.provider, model: draft.model, cost: m.cost });
    let report = String(draft.text || "").trim() || "The report came back empty.";
    report += `\n\n## Pages opened\n\n${m.coverage}\n\n${(m.sources || []).map((s) => `[${s.n}] ${s.title}: ${sourceStatus(s, pageList).label}`).join("\n")}`;
    if (!reads.length) report = `> Read this first: no page could be opened, so nothing here was checked against a page.\n\n${report}`;
    const writerVendor = PROVIDERS[draft.provider]?.vendor || draft.provider;

    setTask(m, "check", { status: "running" });
    publish(m);
    const checker = rank({ capability: "analysis", difficulty: 2, mode: "balanced" }).find((x) => x.provider !== draft.provider && (PROVIDERS[x.provider]?.vendor || x.provider) !== writerVendor);
    if (!checker) {
      const note = "Only one AI vendor is connected, so a second company did not cross-check this report.";
      m.crossCheck = { provider: null, model: null, vendor: null, text: note, checked: false };
      report += `\n\n## Cross-check\n\n${note}`;
      setTask(m, "check", { status: "done" });
    } else {
      const check = await ask(m, checker, {
        role: "check", capability: "analysis", difficulty: 2, signal,
        system: "You are a second AI from a different company. Cross-check the report against the sources. Reply in Markdown with what holds up and what is thin or missing. Keep the [n] numbers. Do not invent a source.",
        content: `QUESTION:\n${m.prompt}\n\nREPORT:\n${report}\n\n${block}${pages ? `\n\nPAGE TEXT:\n${pages}` : ""}`,
      });
      const vendor = PROVIDERS[check.provider]?.vendor || check.provider;
      const name = PROVIDERS[check.provider]?.name || check.provider;
      m.crossCheck = { provider: check.provider, model: check.model, vendor, text: check.text, checked: true, writer: draft.provider, writerVendor };
      report += `\n\n## Cross-check\n\nChecked by ${name} (${vendor}).\n\n${String(check.text || "").trim()}`;
      setTask(m, "check", { status: "done", provider: check.provider, model: check.model });
    }
    m.provider = draft.provider;
    m.model = draft.model;
    m.deliverable = report;
    m.status = "done";
    m.finishedAt = Date.now();
    persist(m);
    publish(m);
    const cross = m.crossCheck?.checked ? `Cross-checked by ${PROVIDERS[m.crossCheck.provider]?.name || "a second AI"}.` : "No second vendor was connected to cross-check it.";
    emit("research.done", { id: m.id, ok: true, title: "Deep research is done", body: `${m.title}. ${cross} Open it in Meldmind.` });
  } catch (err) {
    if (signal?.aborted || err?.code === "aborted") {
      m.status = "aborted";
      m.error = "Stopped.";
      m.finishedAt = Date.now();
      for (const t of m.tasks) if (t.status === "running" || t.status === "pending") t.status = "aborted";
      persist(m);
      publish(m);
      emit("log", { text: "Deep research stopped.", missionId: m.id });
      emit("research.done", { id: m.id, ok: false, aborted: true, title: "Deep research stopped", body: `${m.title}. The run was stopped before the report was finished.` });
      return;
    }
    m.status = "failed";
    m.error = err.message || "Deep research failed";
    m.finishedAt = Date.now();
    for (const t of m.tasks) if (t.status === "running" || t.status === "pending") t.status = "failed";
    if (!m.deliverable) m.deliverable = m.error;
    persist(m);
    publish(m);
    emit("log", { text: `Deep research failed: ${m.error}`, level: "error", missionId: m.id });
    emit("research.done", { id: m.id, ok: false, title: "Deep research failed", body: m.error });
  } finally {
    running.delete(m.id);
  }
}

export function beginDeep({ prompt, filter, projectId, effort, facets, maxCostUsd } = {}) {
  const q = String(prompt || "").trim();
  if (!q) { const e = new Error("Type a question first."); e.status = 400; throw e; }
  const gate = requireResearch("deepResearch");
  if (!gate.ok) { const e = new Error(gate.message); e.status = gate.status || 402; e.code = gate.code; throw e; }
  const pre = searchPreflight({});
  if (!pre.ok) { const e = new Error(pre.message); e.status = 400; e.code = "no_search"; throw e; }
  const m = blank(q, filter, projectId);
  if (pre.level === "warn") m.searchWarning = pre.message;
  if (agentsFlagOn() || effort || facets) {
    m.orchestrated = true;
    m.effortLevel = effort || undefined;
    m.facetCount = facets || undefined;
    m.effort = scaleEffort(q, { effort, facets, filter });
    m.costWarning = costWarning(m.effort);
    if (maxCostUsd != null) m.maxCostUsd = Number(maxCostUsd);
  }
  persist(m);
  publish(m);
  const ctl = new AbortController();
  running.set(m.id, ctl);
  work(m, ctl.signal).catch(() => {});
  const warning = pre.level === "warn" ? { searchWarning: pre.message } : {};
  return m.orchestrated ? { id: m.id, effort: m.effort, costWarning: m.costWarning, ...warning } : { id: m.id, ...warning };
}

export async function resumeDeep(id) {
  const safe = String(id || "").replace(/[^a-z0-9-]/gi, "");
  const existing = await loadResearch(safe);
  const mem = readExternalMemory(safe);
  if (!existing && !mem) { const e = new Error("not found"); e.status = 404; throw e; }
  const m = existing || blank(mem.prompt || "Resumed research", mem.filter || "web", null);
  m.id = safe;
  m.orchestrated = true;
  m.status = "running";
  m.error = null;
  m.finishedAt = null;
  if (mem?.facets) m.facets = mem.facets;
  if (mem?.effort) m.effort = mem.effort;
  if (mem?.costWarning) m.costWarning = mem.costWarning;
  for (const t of m.tasks || []) if (t.status === "failed" || t.status === "aborted") t.status = "pending";
  persist(m);
  publish(m);
  const ctl = new AbortController();
  running.set(m.id, ctl);
  workOrchestrated(m, ctl.signal).catch(() => {});
  return { id: m.id, resumed: true, phase: mem?.phase || "planned" };
}

export async function loadResearch(id) {
  const safe = String(id || "").replace(/[^a-z0-9-]/gi, "");
  if (!safe) return null;
  try { return await ctx().store.getMission(safe); }
  catch { return null; }
}

export function exportReport(m, format) {
  const title = m.title || "Research report";
  // no sources, no "Sources" heading (an empty list used to print a bare heading)
  const src = (m.sources || []).map((s) => `[${s.n}] ${s.title} ${s.url}`);
  const body = `${m.deliverable || ""}${src.length ? `\n\nSources\n${src.join("\n")}` : ""}`;
  if (format === "pdf") return { bytes: reportPdf({ title, body }), type: "application/pdf", ext: "pdf" };
  if (format === "docx") return { bytes: reportDocx({ title, body }), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
  const e = new Error("Export pdf or docx.");
  e.status = 400;
  throw e;
}
