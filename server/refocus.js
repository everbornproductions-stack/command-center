// Refocus: find related work, put it in date order, and plan one complete version.
// Finding is read only. The rebuild mission starts only after a click, in the plugin.
import { ctx, putDoc } from "./store.js";
import { expandQuery, scoreFields, rank } from "./refocus-search.js";

export const STATUSES = ["finished", "partial", "abandoned"];
const DONE = new Set(["done", "finished", "complete", "completed"]);
const STOPPED = new Set(["cancelled", "canceled", "aborted", "abandoned"]);
const OPEN = new Set(["running", "planning", "queued", "working", "started", "awaiting_ok", "needs_approval", "waiting", "partial", "scheduled"]);
const EARLY = /\b(half[- ]done|unfinished|wip|draft|to-?do|left off|not finished)\b/i;
const KIND = "refocus.record";

export function isPrivate(item) {
  return !!(item && (item.private === true || item.privateMode === true || item.excludeFromHistory === true));
}

export function topicWords(topic) {
  return String(topic || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
}

// Any query word (or a word it stands for, such as invoice for billing) is enough to match.
// Items that match more words rank higher. A file item arrives already scored by the walker.
export function scoreItem(item, topic) {
  if (item && Number(item.matched) > 0) return { matched: Number(item.matched), score: Number(item.score) || 0 };
  const groups = expandQuery(topic);
  if (!groups.length) return { matched: 0, score: 0 };
  return scoreFields({ name: item?.title || "", folders: `${item?.source || ""} ${item?.where || ""}`, text: `${item?.text || ""} ${item?.summary || ""}`, kind: item?.fileType || "" }, groups);
}

export function matchesTopic(item, topic) {
  return scoreItem(item, topic).matched > 0;
}

export function summaryOf(text, title) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const base = t || String(title || "").trim() || "No summary";
  const sentence = base.split(/(?<=[.!?])\s/)[0] || base;
  return sentence.slice(0, 180);
}

export function statusOf(item = {}) {
  const raw = String(item.status || "").toLowerCase();
  const text = `${item.title || ""}\n${item.text || ""}\n${item.summary || ""}`;
  const body = String(item.text || item.summary || "").trim();
  if (STOPPED.has(raw)) return "abandoned";
  if (raw === "failed" && body.length < 40) return "abandoned";
  if (raw === "failed") return "partial";
  if (DONE.has(raw)) {
    if (item.openQuestion) return "partial";
    if (EARLY.test(text)) return "partial";
    return "finished";
  }
  if (OPEN.has(raw) || item.openQuestion) return "partial";
  if (!body) return "abandoned";
  return "partial";
}

export function whenOf(item) {
  const n = Number(item?.date);
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

export function byDate(items) {
  return [...(items || [])].sort((a, b) => whenOf(a) - whenOf(b) || String(a.id).localeCompare(String(b.id)));
}

function wordsOf(s) {
  return new Set(String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length >= 4));
}

function shares(a, b) {
  const left = wordsOf(a);
  const right = wordsOf(b);
  let n = 0;
  for (const w of left) if (right.has(w)) n++;
  return n >= 2;
}

export function decorate(item) {
  return { ...item, status: statusOf(item), summary: item.summary || summaryOf(item.text, item.title) };
}

export function buildPlan(items, record = {}) {
  const worked = new Set((record.worked || []).map((w) => w.source));
  const boost = (item) => (worked.has(item.sourceKind) ? 1 : 0);
  const kept = items.filter((i) => i.status === "finished")
    .sort((a, b) => boost(b) - boost(a) || whenOf(a) - whenOf(b) || String(a.id).localeCompare(String(b.id)))
    .map((i) => ({
      id: i.id, source: i.source, sourceKind: i.sourceKind, date: i.date, summary: i.summary,
      why: worked.has(i.sourceKind) ? "This kind of source worked on an earlier Refocus." : "This one was finished.",
    }));
  const improved = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    if (cur.status === "abandoned") continue;
    const earlier = items.slice(0, i).filter((x) => x.status === "finished" || x.status === "partial");
    if (!earlier.length) continue;
    if (earlier.some((p) => shares(p.summary, cur.summary) || shares(p.title, cur.title))) {
      improved.push({ id: cur.id, source: cur.source, sourceKind: cur.sourceKind, date: cur.date, summary: cur.summary, why: "A later pass added to an earlier one." });
    }
  }
  const missing = items.filter((i) => i.status === "partial" || i.status === "abandoned").map((i) => ({
    id: i.id, source: i.source, sourceKind: i.sourceKind, date: i.date, status: i.status, summary: i.summary,
    why: i.status === "abandoned" ? "This was left unfinished." : "This is only partly done.",
  }));
  return {
    title: "Complete version",
    kept, improved, missing,
    note: "This plan is built on this computer from what was found. Nothing is sent until you click Rebuild it.",
  };
}

export function assemble({ runs = [], files = [], outputs = [], drive = [], local = [], ai = [], topic, record } = {}) {
  const raw = [...runs, ...files, ...outputs, ...drive, ...ai, ...local];
  const skippedPrivate = raw.filter(isPrivate).length;
  const seen = new Set();
  const scored = [];
  for (const x of raw) {
    if (!x || isPrivate(x) || seen.has(x.id)) continue;
    const s = scoreItem(x, topic);
    if (!s.matched) continue;
    seen.add(x.id);
    scored.push(decorate({ ...x, score: s.score, matched: s.matched }));
  }
  const results = rank(scored).slice(0, 200);
  const items = byDate(results);
  return { items, results, plan: buildPlan(items, record), skippedPrivate };
}

export function publicItem(item) {
  const date = Number(item.date);
  return {
    id: item.id,
    source: item.source,
    sourceKind: item.sourceKind || null,
    date: Number.isFinite(date) && date > 0 && date < Number.MAX_SAFE_INTEGER ? date : null,
    title: item.title || "",
    status: item.status,
    summary: item.summary || "",
    madeBy: item.madeBy || item.source || null,
    where: item.where || null,
    path: item.path || null,
    fileType: item.fileType || null,
    links: Array.isArray(item.links) ? item.links.slice(0, 10) : [],
    score: Number(item.score) || 0,
  };
}

export function goalFrom(topic, plan) {
  const line = (rows) => (rows || []).map((r) => `- ${r.source}: ${r.summary}`).join("\n") || "- (none)";
  return [
    `Build one complete version of this work: ${String(topic || "").slice(0, 200)}.`,
    "Use only the pieces below. Do not invent facts that are not in them.",
    "",
    "Kept:",
    line(plan?.kept),
    "",
    "Improved:",
    line(plan?.improved),
    "",
    "Still missing:",
    line(plan?.missing),
  ].join("\n");
}

const NAMES = { chatgpt: "ChatGPT", claude: "Claude" };

export function fromRun(m, names = {}) {
  if (!m || typeof m !== "object" || !m.id) return null;
  const messages = Array.isArray(m.messages) ? m.messages : [];
  const answers = m.answers && typeof m.answers === "object" ? Object.values(m.answers) : [];
  const text = [m.prompt, m.goal, m.deliverable, ...messages.map((x) => x?.text), ...answers.map((a) => a?.text || a?.answer || "")].filter(Boolean).join("\n");
  const last = messages.length ? messages[messages.length - 1] : null;
  let source = "Saved chat";
  let sourceKind = m.kind || "chat";
  if (m.kind === "imported") {
    source = NAMES[m.source] || "Imported chat";
    sourceKind = `import:${m.source || "chat"}`;
  } else if (m.kind === "council") {
    source = "Council";
    sourceKind = "council";
  } else if (m.kind === "mission") {
    source = "Mission";
    sourceKind = "mission";
  } else if (m.provider) {
    source = names[m.provider] || m.providerName || "Saved chat";
    sourceKind = `chat:${m.provider}`;
  }
  const madeBy = sourceKind.startsWith("import:") || sourceKind.startsWith("chat:") ? source : (m.providerName || names[m.provider] || source);
  return {
    id: m.id,
    madeBy,
    title: String(m.title || m.prompt || m.goal || "Untitled").slice(0, 120),
    text,
    status: m.status,
    openQuestion: last?.role === "user" || last?.role === "human",
    date: Number(m.updatedAt || m.finishedAt || m.startedAt || 0),
    source,
    sourceKind,
    private: m.private === true || m.privateMode === true || m.excludeFromHistory === true,
    privateMode: m.privateMode === true,
    excludeFromHistory: m.excludeFromHistory === true,
  };
}

export function fromDrive(file) {
  const name = String(file?.name || "Drive file");
  const modified = file?.modified ? Date.parse(file.modified) : 0;
  return {
    id: `drive:${file?.id || name}`,
    title: name,
    text: `${name}\n${file?.text || ""}`,
    status: "done",
    date: Number.isFinite(modified) ? modified : 0,
    source: "Google Drive",
    sourceKind: "drive",
  };
}

export function fromMedia(job) {
  const words = job?.params?.prompt || job?.params?.text || job?.prompt || "";
  const names = (job?.outputs || []).map((o) => String(o).split(/[/\\]/).pop()).join(" ");
  return {
    id: job.id,
    title: String(words || job.kind || "Saved output").slice(0, 120),
    text: `${words}\n${names}`,
    status: job.status,
    date: Number(job.finishedAt || job.createdAt || 0),
    source: "Saved output",
    sourceKind: "output",
  };
}

export function fromArtifact(a) {
  const latest = a?.versions?.[a.versions.length - 1];
  return {
    id: a.id,
    title: a.title || "Saved output",
    text: latest?.content || a.title || "",
    status: "done",
    date: Date.parse(a.updated || a.created || "") || 0,
    source: "Saved output",
    sourceKind: "output",
  };
}

export function fromFile(hit) {
  return {
    id: `file:${hit.libraryId || "lib"}:${hit.docId || hit.chunkId || hit.title}`,
    title: hit.title || "Project file",
    text: hit.text || hit.title || "",
    status: "done",
    date: Number(hit.addedAt || 0),
    source: "Project file",
    sourceKind: "project-file",
  };
}

export function readRecord() {
  const existing = ctx().docs?.[KIND];
  const r = existing && typeof existing === "object" ? existing : { worked: [], ais: [], chosen: null };
  return {
    worked: Array.isArray(r.worked) ? r.worked : [],
    ais: Array.isArray(r.ais) ? r.ais : [],
    chosen: r.chosen || null,
  };
}

export function choiceFrom(plan, readers) {
  return {
    sources: [...new Set((plan?.kept || []).map((k) => k.sourceKind).filter(Boolean))].slice(0, 20),
    ais: [...new Set((readers || []).filter((r) => r.kind === "ai" && r.mission).map((r) => r.id).filter(Boolean))].slice(0, 20),
  };
}

function bump(list, key, field) {
  const row = list.find((x) => x[field] === key);
  if (row) row.n = (Number(row.n) || 0) + 1;
  else list.push({ [field]: key, n: 1 });
}

export function mergeWorked(record, chosen) {
  const worked = (record?.worked || []).map((x) => ({ source: x.source, n: Number(x.n) || 0 }));
  const ais = (record?.ais || []).map((x) => ({ id: x.id, n: Number(x.n) || 0 }));
  for (const s of chosen?.sources || []) if (s) bump(worked, s, "source");
  for (const id of chosen?.ais || []) if (id) bump(ais, id, "id");
  return { worked: worked.slice(0, 40), ais: ais.slice(0, 40) };
}

export function rememberChoice(plan, readers) {
  const cur = readRecord();
  const chosen = choiceFrom(plan, readers);
  putDoc(KIND, { worked: cur.worked, ais: cur.ais, chosen });
  return chosen;
}

export function noteWorked(chosen) {
  const cur = readRecord();
  const next = mergeWorked(cur, chosen);
  putDoc(KIND, { ...next, chosen: cur.chosen || null });
  return next;
}

const URL_RE = /https:\/\/[^\s"'<>)\]]+/g;

function linksIn(...parts) {
  const out = new Set();
  for (const p of parts) for (const m of String(p || "").match(URL_RE) || []) out.add(m.replace(/[.,;]+$/, ""));
  return [...out].slice(0, 10);
}

// A Grok Bot job and what it reported back, including Drive links it sent.
export function fromGrokJob(job) {
  if (!job || !job.id) return null;
  const arts = (Array.isArray(job.artifacts) ? job.artifacts : []).map((a) => (typeof a === "string" ? a : [a?.name, a?.title, a?.url, a?.link].filter(Boolean).join(" ")));
  const links = linksIn(job.text, ...arts);
  return {
    id: `grokbot:${job.id}`,
    title: String(job.task || "Grok Bot job").slice(0, 120),
    text: [job.task, job.text, ...arts].filter(Boolean).join("\n"),
    status: job.status,
    date: Number(job.updatedAt || job.createdAt || 0),
    source: "Grok Bot",
    sourceKind: "agent:grokbot",
    madeBy: "Grok Bot",
    links,
  };
}

// One outside agent handoff (Cursor, browser helper, and later agents), as the live view saw it.
export function fromHandoff(h) {
  if (!h || !h.jobId) return null;
  const name = h.name || h.agent || "Agent";
  return {
    id: `agent:${h.agent}:${h.jobId}`,
    title: String(h.task || `${name} job`).slice(0, 120),
    text: [h.task, h.result].filter(Boolean).join("\n"),
    status: h.status === "reported" ? (h.failed ? "failed" : "done") : "working",
    date: Number(h.at || h.sentAt || 0),
    source: name,
    sourceKind: `agent:${h.agent}`,
    madeBy: name,
    links: linksIn(h.result, h.page),
  };
}
