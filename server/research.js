// Pro search and Deep Research, on top of the Phase 15 search engines.
// Pro search runs a few queries and keeps one numbered source list.
// Deep Research reads pages, writes a cited report, and asks a second AI from
// another vendor to cross-check it. The run is a mission row, so it shows up
// with the rest of the work and can continue as a mission (browser and desktop).
import { emit } from "./events.js";
import { ctx } from "./store.js";
import { PROVIDERS } from "./registry.js";
import { recordCall } from "./ledger.js";
import { completeFallback } from "./fallback.js";
import { pick, rank } from "./router.js";
import { localFetch } from "./loopback-fetch.js";
import { htmlToText } from "./receipts.js";
import { requireResearch } from "./feature-gate.js";
import { reportPdf, reportDocx } from "./research-export.js";
import {
  augment, runSearch, resolveEngine, sourcesBlock, queryFor, normalizeFilter, mayCallLive,
} from "./search.js";

export { reportPdf, reportDocx };

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
    return proSearch(opts);
  }
  return augment(opts);
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

async function fetchText(url, signal) {
  if (!/^https?:\/\//i.test(String(url || ""))) return "";
  if (!mayCallLive(url)) return "";
  throwIfStopped(signal);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await localFetch(url, { headers: { accept: "text/html, text/plain;q=0.9" }, signal: ctl.signal });
    if (signal?.aborted) throw new ResearchStopped();
    if (!res.ok) return "";
    const txt = await res.text();
    if (signal?.aborted) throw new ResearchStopped();
    return htmlToText(txt).slice(0, 3500);
  } catch (err) {
    if (signal?.aborted || err?.code === "aborted") throw err?.code === "aborted" ? err : new ResearchStopped();
    return "";
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function readSources(sources, limit = 4, signal) {
  const reads = [];
  for (const s of (sources || []).slice(0, limit)) {
    throwIfStopped(signal);
    const text = await fetchText(s.url, signal);
    if (text) reads.push({ n: s.n, url: s.url, title: s.title, chars: text.length, excerpt: text.slice(0, 500), text });
  }
  return reads;
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
  return reads.map((r) => `[${r.n}] ${r.title}\n${r.url}\n${r.text}`).join("\n\n");
}

async function work(m, signal) {
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

    const reads = m.sources?.length ? await readSources(m.sources, 4, signal) : [];
    throwIfStopped(signal);
    m.reads = reads;
    setTask(m, "read", { status: "done" });
    setTask(m, "write", { status: "running" });
    publish(m);

    const writer = pick({ capability: "research", difficulty: 3, mode: "quality" }) || pick({ capability: "writing", difficulty: 2, mode: "balanced" });
    if (!writer) throw new Error("No AI is available to write the report. Add an API key in Settings.");
    const block = sourcesBlock(m.sources, m.searchEngine);
    const pages = readingBlock(reads);
    const draft = await ask(m, writer, {
      role: "write", capability: "research", difficulty: 3, signal,
      system: "You write a cited research report from the sources below. Cite facts with the source number in square brackets, like [1]. Only cite those numbers. Never invent a source. Markdown. Put a short title on the first line. No preamble.",
      content: `QUESTION:\n${m.prompt}\n\n${block || "No live pages were fetched."}${pages ? `\n\nPAGE TEXT:\n${pages}` : ""}`,
    });
    setTask(m, "write", { status: "done", provider: draft.provider, model: draft.model, cost: m.cost });
    let report = String(draft.text || "").trim() || "The report came back empty.";
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

export function beginDeep({ prompt, filter, projectId } = {}) {
  const q = String(prompt || "").trim();
  if (!q) { const e = new Error("Type a question first."); e.status = 400; throw e; }
  const gate = requireResearch("deepResearch");
  if (!gate.ok) { const e = new Error(gate.message); e.status = gate.status || 402; e.code = gate.code; throw e; }
  const m = blank(q, filter, projectId);
  persist(m);
  publish(m);
  const ctl = new AbortController();
  running.set(m.id, ctl);
  work(m, ctl.signal).catch(() => {});
  return { id: m.id };
}

export async function loadResearch(id) {
  const safe = String(id || "").replace(/[^a-z0-9-]/gi, "");
  if (!safe) return null;
  try { return await ctx().store.getMission(safe); }
  catch { return null; }
}

export function exportReport(m, format) {
  const title = m.title || "Research report";
  const body = `${m.deliverable || ""}\n\nSources\n${(m.sources || []).map((s) => `[${s.n}] ${s.title} ${s.url}`).join("\n")}`;
  if (format === "pdf") return { bytes: reportPdf({ title, body }), type: "application/pdf", ext: "pdf" };
  if (format === "docx") return { bytes: reportDocx({ title, body }), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
  const e = new Error("Export pdf or docx.");
  e.status = 400;
  throw e;
}
