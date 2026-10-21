// Phase 29: live project view and the flow-map animation state.
// Numbers come from the usage ledger. Health lights come from the health table.
// Jobs, missions and councils are the ones the app already stores. This module does not
// keep a second ledger, and it never fetches a provider page. "Open in <service>" is only a URL
// the person's browser opens after they click.
import { PROVIDERS } from "./registry.js";
import { canonAgent, handoffLink, normalizeHandoff, resolveExternalAgent, STATUS_LABEL } from "./external-agents.js";
import { jobCounts, isUsageJob, isTiny, bubbleScales, layoutBubbles, USAGE_MAX } from "../web/graph-usage.js";

export const HISTORY_NOTE = "API chats do not appear in claude.ai, grok.com or ChatGPT history. Watch the work here.";
export const HUB_TIP = "Router. Each step goes out to the AI that should do it, and the result comes back.";

// Usage dashboards for API spend. OpenAI's page already lives on the registry (links.usage).
// Anthropic and xAI do not, so they are named here. Nothing in this file requests these URLs.
const USAGE_PAGES = {
  anthropic: "https://platform.claude.com/usage",
  xai: "https://console.x.ai/team/default/usage",
};
const SERVICE_NAMES = { openai: "OpenAI", anthropic: "Anthropic", xai: "xAI", kling: "Kling" };
const WATCH_HERE = new Set(["openai", "anthropic", "xai"]);
const SHORT_NAMES = {
  anthropic: "Claude", openai: "GPT", xai: "Grok", google: "Gemini", kling: "Kling",
  grokbot: "Grok Bot", "grok-bot": "Grok Bot", browser: "Browser helper", "browser-helper": "Browser helper",
};
const EXTRA = {
  grokbot: { color: "#c4b5fd", kind: "agent" },
  antigravity: { color: "#34d399", kind: "agent" },
  "grok-bot": { color: "#c4b5fd", kind: "agent" },
  browser: { color: "#38bdf8", kind: "agent" },
  "browser-helper": { color: "#38bdf8", kind: "agent" },
};
const NODE_ORDER = ["anthropic", "openai", "xai", "google", "perplexity", "openrouter", "deepseek", "groq", "mistral", "kling", "grokbot", "grok-bot", "browser-helper", "browser", "cursor"];
const WORKING = new Set(["planning", "running", "assembling", "review", "processing", "queued", "working"]);
const STATUS_STEP = {
  planning: "Planning", scheduled: "Queued for later", running: "Working", assembling: "Assembling the deliverable",
  review: "QA check", processing: "Generating", queued: "Queued", done: "Done", "done-with-errors": "Done, with errors",
  failed: "Failed", aborted: "Stopped", cancelled: "Cancelled", "dry-run": "Dry run, nothing spent",
  awaiting_ok: "Waiting for your OK", declined: "Not made (you said no)",
};

const round6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const round1 = (n) => Math.round(Number(n) * 10) / 10;
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function formatUsd(v) {
  const n = Number(v) || 0;
  const d = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2;
  return "$" + n.toFixed(d);
}
function formatUnits(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
export function nodeName(id, providers = PROVIDERS) {
  return resolveExternalAgent(id)?.name || SHORT_NAMES[id] || providers[id]?.name || id || "AI";
}
function serviceName(id, providers = PROVIDERS) {
  return SERVICE_NAMES[id] || nodeName(id, providers);
}
function colorOf(id, providers = PROVIDERS) {
  return resolveExternalAgent(id)?.color || providers[id]?.color || EXTRA[id]?.color || "#94a3b8";
}
function kindOf(id, providers = PROVIDERS) {
  if (resolveExternalAgent(id)) return "external";
  if (EXTRA[id]) return EXTRA[id].kind;
  return providers[id]?.kind || "agent";
}
export function formatSent(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
export function initials(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || "?").slice(0, 2).toUpperCase();
}

// Kling's API task id is not a public deep link we can verify. The video page is the place that
// job shows up; the task id rides along in the query so the address names the job. Never fetched.
export function klingTaskUrl(taskId) {
  const id = String(taskId ?? "").trim();
  if (!id || id.length > 200 || /[\u0000-\u001f\s]/.test(id)) return null;
  return `https://app.klingai.com/global/video?task=${encodeURIComponent(id)}`;
}

export function openIn(providerId, { taskId } = {}, providers = PROVIDERS) {
  const id = String(providerId || "");
  const service = serviceName(id, providers);
  const links = [];
  if (id === "kling") {
    const url = klingTaskUrl(taskId);
    if (url) links.push({ rel: "job", service: "Kling", label: "Open in Kling", url });
  }
  const usage = providers[id]?.links?.usage || USAGE_PAGES[id] || null;
  if (usage && /^https:\/\//.test(usage)) links.push({ rel: "usage", service: SERVICE_NAMES[id] || service, label: `Open in ${SERVICE_NAMES[id] || service}`, url: usage });
  const primary = links.find((l) => l.rel === "job") || links.find((l) => l.rel === "usage") || null;
  return { provider: id, service: primary?.service || service, links, label: primary?.label || null, url: primary?.url || null, watchHere: WATCH_HERE.has(id) };
}

export function createState() {
  return { runs: new Map(), pulses: [], edges: new Map(), seq: 0 };
}

function ensureRun(state, id) {
  let r = state.runs.get(id);
  if (!r) {
    r = { id, kind: null, projectId: null, title: "", status: null, missionCost: 0, providers: new Set(), workers: new Map(), tasks: new Map(), handoffs: new Map(), updatedAt: 0 };
    state.runs.set(id, r);
  }
  return r;
}
function addPulse(state, run, { from, to, text }) {
  if (!from || !to) return;
  state.seq += 1;
  const p = { id: "p" + state.seq, from, to, text: clip(text, 80), missionId: run?.id || null, projectId: run?.projectId || null, at: Date.now() };
  state.pulses.push(p);
  if (state.pulses.length > 24) state.pulses.shift();
  state.edges.set(`${from}>${to}`, { from, to, at: p.at, missionId: run?.id || null });
}
function takeMission(run, m, kind) {
  run.kind = m.kind || kind || run.kind;
  if (m.projectId !== undefined) run.projectId = m.projectId || null;
  const title = m.title || (m.prompt ? clip(m.prompt, 90) : "");
  if (title) run.title = title;
  if (m.status) run.status = m.status;
  if (typeof m.cost === "number") { run.missionCost = m.cost; run.costKnown = true; }
  if (m.provider) run.providers.add(m.provider);
  if (m.planner?.provider) run.providers.add(m.planner.provider);
  if (m.assembler?.provider) run.providers.add(m.assembler.provider);
  if (m.chair?.provider) run.providers.add(m.chair.provider);
  for (const mem of m.members || []) if (mem?.provider) run.providers.add(mem.provider);
  if (Array.isArray(m.tasks)) {
    run.tasks = new Map();
    for (const t of m.tasks) {
      if (!t?.id) continue;
      run.tasks.set(t.id, { id: t.id, title: t.title || "", status: t.status || null, provider: t.provider || null, model: t.model || null, agentName: t.agentName || null });
      if (t.provider) run.providers.add(t.provider);
    }
  }
  run.updatedAt = Date.now();
}

// Fold one bus event into the live state. Cost is not copied off the event: the ledger is the
// source of truth, and buildLiveView reads it. Pulses are the animation instructions.
export function applyLiveEvent(state, ev) {
  if (!state || !ev?.type) return null;
  if (ev.type === "mission.update" && ev.mission?.id) {
    takeMission(ensureRun(state, ev.mission.id), ev.mission, "mission");
    return ev.mission.id;
  }
  if (ev.type === "council.update" && ev.council?.id) {
    takeMission(ensureRun(state, ev.council.id), ev.council, "council");
    return ev.council.id;
  }
  if ((ev.type === "agent.start" || ev.type === "agent.done" || ev.type === "agent.error") && ev.missionId) {
    const run = ensureRun(state, ev.missionId);
    const w = run.workers.get(ev.agent) || { agent: ev.agent };
    if (ev.provider) { w.provider = canonAgent(ev.provider); run.providers.add(w.provider); }
    if (ev.model) w.model = ev.model;
    if (ev.role) w.role = ev.role;
    if (ev.label) w.label = clip(ev.label, 120);
    if (ev.taskId) w.taskId = ev.taskId;
    if (ev.type === "agent.start") { w.done = false; w.error = null; addPulse(state, run, { from: "hub", to: w.provider, text: w.label || "working" }); }
    else { w.done = true; w.error = ev.error ? clip(ev.error, 160) : null; addPulse(state, run, { from: w.provider, to: "hub", text: w.error || "done" }); }
    run.workers.set(ev.agent, w);
    run.updatedAt = Date.now();
    return run.id;
  }
  if (ev.type === "agent.msg" && ev.missionId && ev.from && ev.to) {
    const run = ensureRun(state, ev.missionId);
    const from = canonAgent(ev.from), to = canonAgent(ev.to);
    run.providers.add(from); run.providers.add(to);
    addPulse(state, run, { from, to, text: ev.text || "" });
    run.updatedAt = Date.now();
    return run.id;
  }
  if (ev.type === "task.update" && ev.missionId && ev.task?.id) {
    const run = ensureRun(state, ev.missionId);
    const t = ev.task;
    run.tasks.set(t.id, { id: t.id, title: t.title || "", status: t.status || null, provider: t.provider || null, model: t.model || null, agentName: t.agentName || null });
    if (t.provider) run.providers.add(t.provider);
    run.updatedAt = Date.now();
    return run.id;
  }
  if (ev.type === "external.handoff") {
    const h = normalizeHandoff(ev);
    // A click with no project still shows, on an unfiled run. Council and mission jobs
    // carry the run id Phase 12 and Phase 27 already put on the event.
    if (!h) return null;
    const run = ensureRun(state, h.missionId || `ext-${h.jobId}`);
    if (h.projectId) run.projectId = run.projectId || h.projectId;
    if (!run.kind) run.kind = "handoff";
    if (!run.title && h.task) run.title = h.task;
    run.providers.add(h.agent);
    const prev = run.handoffs.get(h.jobId);
    const next = {
      ...h,
      sentAt: prev?.sentAt || h.sentAt || Date.now(),
      reportedAt: prev?.reportedAt || (h.status === "reported" ? Date.now() : null),
    };
    const changed = !prev || prev.status !== next.status;
    run.handoffs.set(h.jobId, next);
    if (changed && (next.status === "sent" || next.status === "working")) addPulse(state, run, { from: "hub", to: h.agent, text: next.task || STATUS_LABEL[next.status] });
    if (changed && next.status === "reported") addPulse(state, run, { from: h.agent, to: "hub", text: next.result || STATUS_LABEL.reported });
    const stillOut = [...run.handoffs.values()].some((x) => x.status === "sent" || x.status === "working") || [...run.workers.values()].some((w) => !w.done);
    if (next.status === "sent" || next.status === "working") run.status = run.status || "running";
    else if (!stillOut && run.kind === "handoff") run.status = "done";
    run.updatedAt = Date.now();
    return run.id;
  }
  if (ev.type === "ledger.entry" && ev.entry) {
    if (ev.entry.missionId) return ev.entry.missionId;
    if (ev.entry.project) return "project:" + ev.entry.project;
  }
  return null;
}

export function layoutNodes(ids, { width = 680, height = 320 } = {}) {
  const cx = width / 2, cy = height / 2;
  const rest = ids.filter((id) => id !== "hub");
  const rx = width * 0.34, ry = height * 0.30;
  const out = [{ id: "hub", x: round1(cx), y: round1(cy) }];
  rest.forEach((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(rest.length, 1);
    out.push({ id, x: round1(cx + rx * Math.cos(a)), y: round1(cy + ry * Math.sin(a)) });
  });
  return out;
}
export function edgePath(a, b) {
  if (!a || !b) return "";
  if (a.id === "hub" || b.id === "hub") return `M${a.x},${a.y} L${b.x},${b.y}`;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(36, len * 0.2);
  return `M${a.x},${a.y} Q${round1(mx - (dy / len) * k)},${round1(my + (dx / len) * k)} ${b.x},${b.y}`;
}
// A moving dot is drawn only when this is true. prefers-reduced-motion passes reducedMotion.
export function pulseMoves(pulse, reducedMotion = false) {
  if (reducedMotion) return false;
  return !pulse || pulse.animate !== false;
}

function sortIds(ids) {
  const rank = (id) => { const i = NODE_ORDER.indexOf(id); return i === -1 ? 1000 : i; };
  return [...ids].filter((id) => id && id !== "hub").sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}
function publicHealth(h) {
  if (!h || !h.status) return null;
  return { status: h.status, detail: h.detail ? clip(h.detail, 160) : "" };
}
function allowMission(m) {
  if (!m?.id) return null;
  const providers = new Set();
  if (m.provider) providers.add(m.provider);
  if (m.planner?.provider) providers.add(m.planner.provider);
  if (m.assembler?.provider) providers.add(m.assembler.provider);
  if (m.chair?.provider) providers.add(m.chair.provider);
  for (const mem of m.members || []) if (mem?.provider) providers.add(mem.provider);
  const tasks = [];
  for (const t of m.tasks || []) {
    if (!t?.id) continue;
    if (t.provider) providers.add(t.provider);
    tasks.push({ id: t.id, title: t.title || "", status: t.status || null, provider: t.provider || null, model: t.model || null, agentName: t.agentName || null });
  }
  return {
    id: m.id, kind: m.kind || "mission", projectId: m.projectId || null,
    title: m.title || clip(m.prompt || "", 90), status: m.status || null,
    startedAt: m.startedAt || null, finishedAt: m.finishedAt || null,
    missionCost: typeof m.cost === "number" ? m.cost : 0,
    provider: m.provider || null, model: m.model || null,
    providers, tasks,
  };
}
function workersFrom(live, disk) {
  if (live && live.workers.size) return [...live.workers.values()];
  const out = [];
  for (const t of disk?.tasks || []) {
    if (t.status !== "running" && t.status !== "review") continue;
    out.push({ agent: `${disk.id}:${t.id}`, provider: t.provider, model: t.model, role: t.status === "review" ? "qa" : "work", label: t.agentName ? `${t.agentName}: ${t.title}` : t.title, taskId: t.id, done: false, error: null });
  }
  return out;
}
function stepOf(status, workers, tasks) {
  const active = workers.filter((w) => !w.done);
  if (active.length) return active[active.length - 1].label || "Working";
  const t = (tasks || []).find((x) => x.status === "running" || x.status === "review");
  if (t) return t.status === "review" ? `QA check: ${t.title}` : (t.title || "Working");
  return STATUS_STEP[status] || (status ? String(status) : "Idle");
}
function runSpend(id, missionCost, ledger) {
  const lines = ledger.filter((e) => e && e.missionId === id);
  if (!lines.length) return { cost: round6(missionCost || 0), credits: 0, fromLedger: false };
  let cost = 0, credits = 0;
  for (const e of lines) { cost += Number(e.cost) || 0; if (e.kind === "credits") credits += Number(e.units) || 0; }
  return { cost: round6(cost), credits, fromLedger: true };
}
function tipOf({ name, step, cost, credits, pending, health, hub, handoff }) {
  if (hub) return HUB_TIP;
  const parts = [];
  if (handoff) {
    parts.push(handoff.statusLabel || name);
    if (handoff.task) parts.push(handoff.task);
    if (handoff.sentLabel) parts.push(`sent ${handoff.sentLabel}`);
    if (handoff.status === "reported" && handoff.result) parts.push(handoff.result);
  } else parts.push(step || name);
  parts.push(`${formatUsd(cost)} so far`);
  if (credits) parts.push(`${formatUnits(credits)} credits`);
  if (pending) parts.push(`about ${formatUsd(pending)} still running`);
  if (health && health.status && health.status !== "green" && health.status !== "grey" && health.detail) parts.push(health.detail);
  return parts.join(" · ");
}
function publicHandoff(h) {
  const link = handoffLink(h.agent, h);
  return {
    jobId: h.jobId, agent: h.agent, name: h.name, status: h.status, statusLabel: STATUS_LABEL[h.status] || "",
    task: h.task || "", result: h.status === "reported" ? (h.result || "") : "",
    sentAt: h.sentAt || null, sentLabel: h.sentAt ? formatSent(h.sentAt) : "",
    reportedAt: h.reportedAt || null, failed: !!h.failed, link,
  };
}

function assembleRuns(state, missions, jobs, ledger, health, providers) {
  const disk = new Map();
  for (const m of missions || []) { const b = allowMission(m); if (b) disk.set(b.id, b); }
  const ids = new Set([...disk.keys(), ...state.runs.keys()]);
  const runs = [];
  for (const id of ids) {
    const d = disk.get(id);
    const live = state.runs.get(id);
    const providersSet = new Set([...(d?.providers || []), ...(live?.providers || [])]);
    const tasks = live?.tasks?.size ? [...live.tasks.values()] : (d?.tasks || []);
    for (const t of tasks) if (t.provider) providersSet.add(t.provider);
    const handoffs = [...(live?.handoffs?.values() || [])].map(publicHandoff);
    for (const h of handoffs) providersSet.add(h.agent);
    const rawWorkers = workersFrom(live, d);
    for (const h of handoffs) {
      if (h.status !== "sent" && h.status !== "working") continue;
      rawWorkers.push({ agent: `ext:${h.jobId}`, provider: h.agent, model: null, role: "external", label: `${h.statusLabel}: ${h.task || h.name}`, taskId: h.jobId, done: false, error: null });
    }
    const workers = rawWorkers.map((w) => ({
      agent: w.agent, provider: w.provider || null, name: w.provider ? nodeName(w.provider, providers) : "",
      model: w.model || null, role: w.role || null, label: w.label || "", taskId: w.taskId || null,
      active: !w.done, error: w.error || null, health: publicHealth(w.provider ? health[w.provider] : null),
    }));
    const status = live?.status || d?.status || null;
    const working = workers.some((w) => w.active) || WORKING.has(status);
    const missionCost = live?.costKnown ? live.missionCost : (d?.missionCost ?? live?.missionCost ?? 0);
    const spend = runSpend(id, missionCost, ledger);
    const taskIds = {};
    for (const w of workers) if (w.provider && w.taskId) taskIds[w.provider] = w.taskId;
    runs.push({
      id, kind: live?.kind || d?.kind || "mission", projectId: live?.projectId || d?.projectId || null,
      title: live?.title || d?.title || "", status, startedAt: d?.startedAt || live?.updatedAt || 0, finishedAt: d?.finishedAt || null,
      step: stepOf(status, rawWorkers, tasks), working, cost: spend.cost, credits: spend.credits, pending: 0,
      providerIds: [...providersSet], workers, handoffs, taskIds, fromLedger: spend.fromLedger, model: d?.model || null,
    });
  }
  const usedCredits = new Set();
  for (const job of jobs || []) {
    if (!job?.id || !job.provider) continue;
    let run = runs.find((r) => r.id === job.id);
    if (!run) {
      run = { id: job.id, kind: "media", projectId: job.projectId || null, title: `${nodeName(job.provider, providers)} ${job.kind || "media"}`, status: job.status || null, startedAt: job.createdAt || 0, finishedAt: job.finishedAt || null, step: STATUS_STEP[job.status] || "Generating", working: WORKING.has(job.status), cost: 0, credits: 0, pending: 0, providerIds: [job.provider], workers: [], handoffs: [], taskIds: {}, fromLedger: false, model: job.params?.model || null };
      runs.push(run);
    }
    if (!run.providerIds.includes(job.provider)) run.providerIds.push(job.provider);
    if (job.taskId) run.taskIds[job.provider] = job.taskId;
    if (["queued", "processing"].includes(job.status)) {
      run.working = true;
      run.pending = Number(job.estimate?.usd) || 0;
      run.step = `${nodeName(job.provider, providers)} generating ${job.kind || "media"}`;
      if (!run.workers.some((w) => w.provider === job.provider && w.active)) {
        run.workers.push({ agent: `media:${job.id}`, provider: job.provider, name: nodeName(job.provider, providers), model: job.params?.model || job.provider, role: "media", label: run.step, taskId: job.taskId || null, active: true, error: null, health: publicHealth(health[job.provider]) });
      }
    }
    if (!run.fromLedger) {
      const hit = ledger.find((e) => e && e.kind === "credits" && !usedCredits.has(e) && e.provider === job.provider && (e.project || null) === (job.projectId || null));
      if (hit && !["queued", "processing"].includes(job.status)) { usedCredits.add(hit); run.cost = round6(hit.cost || 0); run.credits = Number(hit.units) || 0; run.fromLedger = true; }
    }
  }
  for (const run of runs) {
    const links = [];
    const seen = new Set();
    let watch = false;
    for (const pid of run.providerIds) {
      const o = openIn(pid, { taskId: run.taskIds[pid] || null }, providers);
      if (o.watchHere) watch = true;
      for (const l of o.links) if (!seen.has(l.url)) { seen.add(l.url); links.push(l); }
    }
    for (const h of run.handoffs || []) if (h.link && !seen.has(h.link.url)) { seen.add(h.link.url); links.push(h.link); }
    run.links = links;
    run.watchHere = watch;
    delete run.taskIds;
    delete run.fromLedger;
  }
  runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return runs;
}

function providerSpend(providerId, runs, ledger) {
  const runIds = new Set(runs.map((r) => r.id));
  const projects = new Set(runs.map((r) => r.projectId).filter(Boolean));
  let cost = 0, credits = 0, pending = 0;
  const seen = new Set();
  for (const e of ledger) {
    if (!e || e.provider !== providerId || seen.has(e)) continue;
    const onRun = e.missionId && runIds.has(e.missionId);
    const onProject = e.kind === "credits" && e.project && projects.has(e.project);
    if (!onRun && !onProject) continue;
    seen.add(e);
    cost += Number(e.cost) || 0;
    if (e.kind === "credits") credits += Number(e.units) || 0;
  }
  for (const run of runs) {
    if (!run.providerIds.includes(providerId)) continue;
    if (run.pending) pending += run.pending;
    const covered = ledger.some((e) => e && (e.missionId === run.id || (e.kind === "credits" && e.project && e.project === run.projectId && run.providerIds.includes(e.provider))));
    if (!covered && run.cost) cost += run.cost / run.providerIds.length;
  }
  return { cost: round6(cost), credits, pending: round6(pending) };
}
function providerStep(providerId, runs) {
  let last = null;
  for (const run of runs) for (const w of run.workers) {
    if (w.provider !== providerId) continue;
    if (w.label) last = w.label;
    if (w.active && w.label) return w.label;
  }
  return last;
}
function latestHandoff(providerId, runs) {
  let best = null;
  for (const run of runs) for (const h of run.handoffs || []) {
    if (h.agent !== providerId) continue;
    if (!best || (h.sentAt || 0) >= (best.sentAt || 0)) best = h;
  }
  return best;
}

// Jobs that belong to the runs on screen. Rows with no mission id stay in the 30-day resting tally.
function jobsInRuns(runs, ledger) {
  const runIds = new Set((runs || []).map((r) => r && r.id).filter(Boolean));
  const counts = {};
  for (const e of ledger || []) {
    if (!isUsageJob(e) || !e.missionId || !runIds.has(e.missionId)) continue;
    counts[e.provider] = (counts[e.provider] || 0) + 1;
  }
  return counts;
}

export function makeFlow(runs, state, { providers = PROVIDERS, health = {}, ledger = [], reducedMotion = false, width = 680, height = 320 } = {}) {
  const ids = new Set();
  const active = new Set();
  for (const run of runs) {
    for (const id of run.providerIds) ids.add(id);
    for (const w of run.workers) if (w.active && w.provider) active.add(w.provider);
  }
  const ordered = sortIds(ids);
  const laid = layoutNodes(["hub", ...ordered], { width, height });
  const live = active.size > 0;
  const frame = bubbleScales(ordered, jobCounts(ledger), {
    live,
    runCounts: live ? jobsInRuns(runs, ledger) : {},
    activeIds: [...active],
  });
  const bubbles = laid.map((n) => {
    if (n.id === "hub") return { id: "hub", x: n.x, y: n.y, r: 26, pin: true };
    const scale = frame.scales[n.id] ?? 1;
    // Lay out at the largest size so a bubble can grow during the run without covering a neighbour.
    return { id: n.id, x: n.x, y: n.y, r: 18 * USAGE_MAX, pin: false, usageScale: scale, tiny: isTiny(scale, frame.peak), tail: isTiny(scale, frame.peak) ? 2 : 14 };
  });
  const placed = layoutBubbles(bubbles, { width, height, pad: 8, margin: 4 });
  const pos = new Map(placed.map((n) => [n.id, { ...n }]));
  const runIds = new Set(runs.map((r) => r.id));
  const inScope = (p) => !p.missionId || runIds.has(p.missionId);
  const pulses = (state?.pulses || []).filter(inScope).slice(-8).map((p) => {
    const a = pos.get(p.from), b = pos.get(p.to);
    if (!a || !b) return null;
    return { id: p.id, from: p.from, to: p.to, text: p.text || "", path: edgePath(a, b), animate: true };
  }).filter(Boolean);
  const edgeMap = new Map();
  for (const p of state?.pulses || []) {
    if (!inScope(p) || !pos.has(p.from) || !pos.has(p.to)) continue;
    edgeMap.set(`${p.from}>${p.to}`, { from: p.from, to: p.to });
  }
  for (const id of active) if (pos.has(id)) edgeMap.set(`hub>${id}`, { from: "hub", to: id });
  const edges = [...edgeMap.values()].map((e) => ({ ...e, path: edgePath(pos.get(e.from), pos.get(e.to)), hot: active.has(e.to) || active.has(e.from) }));
  const nodes = laid.map((n) => {
    const at = pos.get(n.id) || n;
    if (n.id === "hub") return { id: "hub", name: "Router", initials: "R", kind: "hub", color: "#22d3ee", active: false, presence: "anchor", external: false, handoff: null, step: null, cost: 0, credits: 0, pending: 0, health: null, x: at.x, y: at.y, usageScale: 1, tiny: false, radius: 26, tip: HUB_TIP, spin: false };
    const spend = providerSpend(n.id, runs, ledger);
    const step = providerStep(n.id, runs);
    const h = publicHealth(health[n.id]);
    const ext = latestHandoff(n.id, runs);
    const name = ext?.name || nodeName(n.id, providers);
    const on = active.has(n.id);
    const node = {
      id: n.id, name, initials: initials(name), kind: kindOf(n.id, providers), color: colorOf(n.id, providers),
      active: on, presence: on ? "live" : "ghost", external: !!ext || kindOf(n.id, providers) === "external",
      handoff: ext ? { status: ext.status, statusLabel: ext.statusLabel, task: ext.task, result: ext.result, sentAt: ext.sentAt, sentLabel: ext.sentLabel } : null,
      step, cost: spend.cost, credits: spend.credits, pending: spend.pending, health: h, x: at.x, y: at.y,
      usageScale: at.usageScale ?? 1, tiny: !!at.tiny, radius: 18 * (at.usageScale ?? 1) * (at.fit || 1),
      tip: "", spin: false,
    };
    node.tip = tipOf(node);
    return node;
  });
  const summary = nodes.filter((n) => n.active).map((n) => n.tip).join(" · ") || "Nobody is working right now.";
  return presentFlow({ width, height, nodes, edges, pulses, summary, reducedMotion: false }, { reducedMotion });
}
export function presentFlow(flow, { reducedMotion = false } = {}) {
  if (!flow) return flow;
  const still = !!reducedMotion;
  return {
    ...flow,
    reducedMotion: still,
    motion: still ? "calm" : "live",
    pulses: (flow.pulses || []).map((p) => ({ ...p, animate: !still })),
    nodes: (flow.nodes || []).map((n) => ({ ...n, spin: !!n.active && !still })),
  };
}

function projectTotals(projectId, runs, ledger) {
  let cost = 0, credits = 0;
  for (const run of runs) { cost += run.cost || 0; credits += run.credits || 0; }
  for (const e of ledger) {
    if (!e || e.kind !== "credits" || e.project !== projectId) continue;
    const onRun = runs.some((r) => r.id === e.missionId || (r.kind === "media" && r.credits && r.providerIds.includes(e.provider)));
    if (onRun) continue;
    cost += Number(e.cost) || 0;
    credits += Number(e.units) || 0;
  }
  return { cost: round6(cost), credits };
}
function pack(runs, state, opts) {
  const flow = makeFlow(runs, state, opts);
  const links = [];
  const seen = new Set();
  let watch = false, cost = 0, credits = 0, pending = 0, working = false, step = "Idle";
  for (const run of runs) {
    if (run.working) { working = true; step = run.step; }
    pending += run.pending || 0;
    if (run.watchHere) watch = true;
    for (const l of run.links) if (!seen.has(l.url)) { seen.add(l.url); links.push(l); }
  }
  if (!working && runs[0]) step = runs[0].step || "Idle";
  return { runs, flow, links, watchHere: watch, working, step, pending: round6(pending), cost, credits };
}

export function buildLiveView({ state = createState(), projects = [], missions = [], ledger = [], jobs = [], health = {}, providers = PROVIDERS, reducedMotion = false } = {}) {
  const opts = { providers, health, ledger, reducedMotion };
  const runs = assembleRuns(state, missions, jobs, ledger, health, providers);
  const known = new Set((projects || []).map((p) => p.id));
  const grouped = new Map();
  for (const p of projects || []) grouped.set(p.id, []);
  const unfiled = [];
  for (const run of runs) {
    if (run.projectId && known.has(run.projectId)) grouped.get(run.projectId).push(run);
    else unfiled.push(run);
  }
  const projectViews = (projects || []).map((p) => {
    const list = grouped.get(p.id) || [];
    const box = pack(list, state, opts);
    const spend = projectTotals(p.id, list, ledger);
    box.cost = spend.cost; box.credits = spend.credits;
    return { id: p.id, name: p.name || p.id, color: p.color || "#22d3ee", ...box };
  });
  const loose = pack(unfiled, state, opts);
  loose.cost = round6(unfiled.reduce((s, r) => s + (r.cost || 0), 0));
  loose.credits = unfiled.reduce((s, r) => s + (r.credits || 0), 0);
  const activeRuns = runs.filter((r) => r.working);
  const focus = activeRuns.length ? activeRuns : runs.slice(0, 1);
  const flow = makeFlow(focus, state, opts);
  let cost = 0, credits = 0;
  for (const p of projectViews) { cost += p.cost; credits += p.credits; }
  cost = round6(cost + loose.cost); credits += loose.credits;
  return { note: HISTORY_NOTE, projects: projectViews, unfiled: loose, runs, flow, cost, credits, working: runs.some((r) => r.working) };
}
