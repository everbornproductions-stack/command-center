// Generic adapter for outside agents the app hands work to.
// Grok Bot (webhook handoff), the built-in browser helper, Cursor cloud builders,
// and any later agent registered with registerExternalAgent().
// This module only describes the agent and shapes a handoff record.
// It never calls the agent and never fetches a page.
const STATUS_MAP = {
  sent: "sent",
  queued: "sent",
  working: "working",
  needs_approval: "working",
  reported: "reported",
  done: "reported",
  failed: "reported",
  error: "reported",
};
export const STATUS_LABEL = { sent: "Sent", working: "Working", reported: "Reported back" };

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

export function safeHttps(url) {
  const s = String(url || "").trim();
  if (!s || s.length > 300 || /\s/.test(s)) return "";
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (u.protocol !== "https:" || u.username || u.password) return "";
  return u.toString();
}
export function safeExternalId(id) {
  const s = String(id || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(s) ? s : "";
}

function specOf(raw) {
  const id = String(raw?.id || "");
  return {
    id,
    aliases: (raw.aliases || []).map((a) => String(a)),
    name: clip(raw.name || id, 40) || id,
    color: /^#[0-9a-fA-F]{3,8}$/.test(raw.color || "") ? raw.color : "#c4b5fd",
    kind: "external",
    via: clip(raw.via || "external", 40),
    open: typeof raw.open === "function" ? raw.open : null,
  };
}

// Built-ins. Aliases collapse onto one node so "grok-bot" and "grokbot" are the same agent.
const BUILTIN = [
  specOf({
    id: "grokbot",
    aliases: ["grok-bot", "grok_bot"],
    name: "Grok Bot",
    color: "#c4b5fd",
    via: "webhook",
  }),
  specOf({
    id: "browser-helper",
    aliases: ["browser", "browser_helper"],
    name: "Browser helper",
    color: "#38bdf8",
    via: "in-app",
  }),
  specOf({
    id: "cursor",
    aliases: ["cursor-cloud", "cursor-agent", "cursor_cloud"],
    name: "Cursor",
    color: "#a5f3fc",
    via: "cloud",
    // The cloud builder's own page. The id is checked; the URL is never fetched.
    open(h) {
      const id = safeExternalId(h?.externalId);
      return id ? { url: `https://cursor.com/agents/${id}` } : null;
    },
  }),
];

const extra = new Map();

function catalog() {
  const map = new Map(BUILTIN.map((s) => [s.id, s]));
  for (const [id, s] of extra) map.set(id, s);
  return map;
}

// Add a later agent. id is lowercase letters, digits, hyphens. open(handoff) may return { url }.
export function registerExternalAgent(raw) {
  const id = String(raw?.id || "");
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error("external agent id required");
  if (BUILTIN.some((s) => s.id === id)) throw new Error("that agent is already built in");
  const spec = specOf({ ...raw, id });
  extra.set(id, spec);
  return { id: spec.id, name: spec.name, color: spec.color, via: spec.via, aliases: spec.aliases };
}

export function unregisterExternalAgent(id) { extra.delete(id); }

export function listExternalAgents() {
  return [...catalog().values()].map(({ open, ...rest }) => rest);
}

export function resolveExternalAgent(id) {
  const key = String(id || "");
  const all = catalog();
  if (all.has(key)) return all.get(key);
  for (const spec of all.values()) if (spec.aliases.includes(key)) return spec;
  return null;
}

// Known agents collapse to their canonical id. Everyone else is left unchanged.
export function canonAgent(id) {
  return resolveExternalAgent(id)?.id || (id ? String(id) : "");
}

export function mapHandoffStatus(status) {
  return STATUS_MAP[String(status || "").trim().toLowerCase()] || "";
}

// The Open link for a handoff. https only. A bad adapter result is ignored.
export function handoffLink(agentId, handoff) {
  const spec = resolveExternalAgent(agentId);
  let url = "";
  if (spec?.open) {
    try {
      const got = spec.open(handoff);
      url = safeHttps(got?.url);
    } catch { url = ""; }
  }
  if (!url) url = safeHttps(handoff?.page);
  if (!url) return null;
  return { rel: "agent", agent: spec?.id || agentId, label: "Open", url };
}

// One handoff event becomes one record. Context, tokens, and artifacts are not kept.
export function normalizeHandoff(raw) {
  if (!raw || typeof raw !== "object") return null;
  const agent = canonAgent(raw.agent || raw.provider || "");
  if (!agent || !/^[a-z0-9][a-z0-9_-]{0,40}$/.test(agent)) return null;
  const status = mapHandoffStatus(raw.status);
  if (!status) return null;
  const jobId = String(raw.jobId || raw.job_id || "").trim();
  if (!jobId || jobId.length > 80 || /[\u0000-\u001f\s]/.test(jobId)) return null;
  const spec = resolveExternalAgent(agent);
  const sentAt = Number(raw.sentAt ?? raw.sent_at);
  const failed = status === "reported" && (raw.failed === true || /^(failed|error)$/i.test(String(raw.status || "")));
  return {
    jobId,
    agent,
    name: spec?.name || clip(raw.name, 40) || agent,
    status,
    task: clip(raw.task || raw.job || "", 160),
    result: clip(raw.result || raw.text || "", 240),
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : null,
    externalId: safeExternalId(raw.externalId || raw.bcId || raw.agentRunId),
    page: safeHttps(raw.page || raw.openUrl),
    missionId: typeof raw.missionId === "string" ? raw.missionId.slice(0, 80) : "",
    projectId: typeof raw.projectId === "string" ? raw.projectId.slice(0, 80) : "",
    failed,
  };
}
