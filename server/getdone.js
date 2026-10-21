// Get it done: a standing OK for one job. Ordinary steps run without asking.
// Spending money and a permanent delete always ask. Sending a message asks
// unless this job turned that on. The grant ends when the job ends.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { emit } from "./events.js";
import { heuristicClassify } from "./router.js";

const DOC = "getdone.state";
const LOG_MAX = 200;
const GRANT_MAX = 80;

export const JOB_KINDS = ["reasoning", "code", "writing", "research", "creative", "analysis", "math"];
export const KIND_LABEL = {
  reasoning: "Reasoning",
  code: "Code",
  writing: "Writing",
  research: "Research",
  creative: "Creative",
  analysis: "Analysis",
  math: "Math",
};

export const ASK_LINE = "Permission: ask before each step that changes something. Spending money, a permanent delete, and sending a message still need the person's OK.";
export const AUTO_LINE = "Permission: Get it done for this job only. Run each step without asking. Still stop and ask before spending money or a permanent delete. Do not send a message to anyone. This ends when the job ends.";
export const SEND_LINE = "Permission: Get it done for this job only. Run each step without asking. Sending a message is allowed for this job. Still stop and ask before spending money or a permanent delete. This ends when the job ends.";

const TERMINAL = new Set(["done", "done-with-errors", "failed", "aborted", "cancelled"]);

export function saidGetItDone(text) {
  const t = String(text || "").toLowerCase().replace(/[’‘]/g, "'");
  if (!/\bget it done\b/.test(t)) return false;
  return /\b(?:don't|dont|do not) ask me\b/.test(t);
}

export function jobKindOf(text) {
  const cap = heuristicClassify(String(text || "").slice(0, 4000)).capability;
  return JOB_KINDS.includes(cap) ? cap : "reasoning";
}

function load() {
  const d = doc(DOC, () => ({ grants: [], rules: [], log: [] }));
  if (!d || typeof d !== "object") return { grants: [], rules: [], log: [] };
  if (!Array.isArray(d.grants)) d.grants = [];
  if (!Array.isArray(d.rules)) d.rules = [];
  if (!Array.isArray(d.log)) d.log = [];
  return d;
}
function save(d) {
  putDoc(DOC, { grants: d.grants.slice(0, GRANT_MAX), rules: d.rules.slice(0, 40), log: d.log.slice(-LOG_MAX) });
}
function pushLog(d, runId, text) {
  d.log.push({ at: Date.now(), runId: String(runId || "").slice(0, 80), text: String(text || "").slice(0, 240) });
  if (d.log.length > LOG_MAX) d.log.splice(0, d.log.length - LOG_MAX);
}
function changed() {
  try { emit("getdone.update", view()); } catch {}
}

export function permissionLine(grant) {
  if (!grant || grant.endedAt) return ASK_LINE;
  return grant.send ? SEND_LINE : AUTO_LINE;
}

export function grantFor(runId) {
  const id = String(runId || "");
  if (!id) return null;
  const g = load().grants.find((x) => x.runId === id && !x.endedAt);
  return g || null;
}

export function grantView(runId) {
  const g = grantFor(runId);
  return g ? publicGrant(g) : null;
}

function publicGrant(g) {
  return {
    id: g.id,
    runId: g.runId,
    send: !!g.send,
    jobKind: g.jobKind,
    source: g.source,
    openedAt: g.openedAt,
    label: "Get it done",
  };
}
function publicRule(r) {
  return { id: r.id, jobKind: r.jobKind, label: KIND_LABEL[r.jobKind] || r.jobKind, send: !!r.send, createdAt: r.createdAt };
}

function activeRule(kind) {
  return load().rules.find((r) => r.jobKind === kind && !r.revokedAt) || null;
}

// Phrase or the per-job toggle or a saved rule. Sending stays off unless this
// call passed send, or a rule is the only reason and that rule allows sending.
export function openGrant({ runId, text, toggle, send, jobKind } = {}) {
  const id = String(runId || "").slice(0, 80);
  if (!id) return null;
  const existing = grantFor(id);
  if (existing) return existing;
  const phrase = saidGetItDone(text);
  const toggled = toggle === true;
  const kind = JOB_KINDS.includes(jobKind) ? jobKind : jobKindOf(text);
  const rule = activeRule(kind);
  if (!phrase && !toggled && !rule) return null;
  const allowSend = send === true || (!phrase && !toggled && !!rule?.send);
  const source = phrase ? "phrase" : toggled ? "toggle" : "rule";
  const d = load();
  const grant = {
    id: "gdg-" + crypto.randomBytes(6).toString("base64url"),
    runId: id,
    send: allowSend,
    jobKind: kind,
    source,
    openedAt: Date.now(),
    endedAt: null,
  };
  d.grants.unshift(grant);
  if (d.grants.length > GRANT_MAX) d.grants.length = GRANT_MAX;
  pushLog(d, id, allowSend
    ? "Get it done is on for this job, including sending a message. Stop is still here."
    : "Get it done is on for this job. Sending a message stays off. Stop is still here.");
  save(d);
  changed();
  return grant;
}

export function endGrant(runId, why = "ended") {
  const id = String(runId || "");
  if (!id) return null;
  const d = load();
  const g = d.grants.find((x) => x.runId === id && !x.endedAt);
  if (!g) return null;
  g.endedAt = Date.now();
  g.endWhy = why === "stopped" ? "stopped" : "ended";
  pushLog(d, id, why === "stopped"
    ? "Stopped. Get it done is off for this job."
    : "Get it done ended for this job.");
  save(d);
  changed();
  return g;
}

export function maySkipAsk({ runId, kind } = {}) {
  const g = grantFor(runId);
  if (!g) return { skip: false, reason: "ask" };
  const k = String(kind || "");
  const d = load();
  const hold = (reason, text) => {
    pushLog(d, g.runId, text);
    save(d);
    changed();
    return { skip: false, reason };
  };
  if (k === "purchase") return hold("money", "Still asked, because it spends money.");
  if (k === "delete") return hold("delete", "Still asked, because it would permanently delete something.");
  if (k === "your turn") return hold("you", "Still asked, because it needs you.");
  if ((k === "send" || k === "post") && !g.send) return hold("send", "Still asked, because sending a message is off.");
  pushLog(d, g.runId, "A step went ahead without asking.");
  save(d);
  changed();
  return { skip: true, reason: "get-it-done" };
}

// Parent job first. Otherwise open one for this handoff or click, when the words, the toggle, or a rule say so.
export function permissionFor({ runId, ownId, text, toggle, send } = {}) {
  const parent = runId ? grantFor(runId) : null;
  if (parent) return { grant: parent, line: permissionLine(parent) };
  const id = String(ownId || runId || "");
  if (!id) return { grant: null, line: permissionLine(null) };
  const grant = openGrant({ runId: id, text, toggle, send });
  return { grant, line: permissionLine(grant) };
}

export function saveRule({ jobKind, send } = {}) {
  if (!JOB_KINDS.includes(jobKind)) {
    const e = new Error("Pick a kind of job."); e.status = 400; throw e;
  }
  const d = load();
  let rule = d.rules.find((r) => r.jobKind === jobKind && !r.revokedAt);
  if (rule) rule.send = send === true;
  else {
    rule = {
      id: "gdr-" + crypto.randomBytes(6).toString("base64url"),
      jobKind,
      send: send === true,
      createdAt: Date.now(),
      revokedAt: null,
    };
    d.rules.unshift(rule);
  }
  pushLog(d, "", `Always for ${KIND_LABEL[jobKind]} jobs is on.`);
  save(d);
  changed();
  return publicRule(rule);
}

export function revokeRule(id) {
  const d = load();
  const rule = d.rules.find((r) => r.id === id && !r.revokedAt);
  if (!rule) {
    const e = new Error("That rule is not on."); e.status = 404; throw e;
  }
  rule.revokedAt = Date.now();
  pushLog(d, "", `Always for ${KIND_LABEL[rule.jobKind] || "that"} jobs was revoked.`);
  save(d);
  changed();
  return { ok: true, id: rule.id };
}

export function view() {
  const d = load();
  return {
    rules: d.rules.filter((r) => !r.revokedAt).map(publicRule),
    grants: d.grants.filter((g) => !g.endedAt).map(publicGrant),
    log: d.log.slice(-80),
  };
}

export function bannerFor(runId) {
  const g = grantFor(runId);
  if (!g) return null;
  return { on: true, send: !!g.send, text: "Get it done is on for this job. Stop is still here." };
}

export function noteJobEnd(ev) {
  if (!ev || typeof ev !== "object") return;
  if (ev.type === "mission.update" && TERMINAL.has(ev.mission?.status)) endGrant(ev.mission.id);
  if (ev.type === "council.update" && TERMINAL.has(ev.council?.status)) endGrant(ev.council.id);
  if (ev.type === "browser.job" && TERMINAL.has(ev.job?.status)) endGrant(ev.job.id);
  if (ev.type === "grokbot.job" && TERMINAL.has(ev.job?.status)) endGrant(ev.job.id);
  if (ev.type === "reportback.result") {
    if (ev.threadId) endGrant(ev.threadId);
    if (ev.jobId) endGrant(ev.jobId);
  }
}
