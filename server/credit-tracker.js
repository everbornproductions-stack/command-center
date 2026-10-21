// Tracked credits: a running balance for AI providers that have no balance API (or no key for it).
//  - The person types the credits they have now, with the date ("Update balance"). From then on
//    Meldmind subtracts every ledger call to that provider, and shows "tracked since <date>".
//  - Usage outside Meldmind is reported by agent-type AIs that can run tools (Claude Code, Antigravity,
//    Grok Bot and other MCP or webhook agents): the Meldmind MCP tool report_usage, or a usage line in a
//    report back. Each report is subtracted once (report ids are remembered).
//  - Plain chat apps cannot report, so a usage, balance or top-up email updates the balance on its own,
//    with an "updated from email <date>" note, a history line, and Undo. No flag and no confirm step.
//  - There is no "balance is old" nudge. A soft "possibly off" note shows only when a mismatch is seen:
//    a live spend report that is higher than what Meldmind tracked, or a usage email with no amount.
// Only numbers, dates, a short note and a message id are stored. Never an email body, subject or key.
import crypto from "node:crypto";
import { PROVIDERS } from "./registry.js";
import { doc, putDoc } from "./store.js";

const DOC = "services.tracked"; // { [providerId]: { amount, at, source, sourceAt, by, note, refs: [], outside: [], history: [], flag } }
const HISTORY_MAX = 30;
const OUTSIDE_MAX = 200;
const REFS_MAX = 300;

const r2 = (n) => +Number(n || 0).toFixed(2);
const money = (n) => `$${r2(n).toFixed(2)}`;
export const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const newId = () => "h-" + crypto.randomBytes(5).toString("hex");
const nameOf = (pid) => PROVIDERS[pid]?.name || pid;
const vendorOf = (pid) => PROVIDERS[pid]?.vendor || nameOf(pid);

export class TrackError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

// Where each AI shows its own usage and credit history, in plain words. emails: the service sends
// receipts or usage emails the read-only mail scan can read, so those keep the balance current.
export const USAGE_GUIDE = {
  openai: { where: "Sign in at platform.openai.com, open Settings, then Usage for spend and Billing for credits left.", url: "https://platform.openai.com/usage", emails: true },
  anthropic: { where: "Sign in at the Claude Console, open Settings, then Billing for credits left and Usage for spend.", url: "https://platform.claude.com/settings/billing", emails: true },
  google: { where: "Google AI Studio shows usage per key. Paid use is billed in Google Cloud under Billing.", url: "https://aistudio.google.com/usage", emails: false },
  xai: { where: "Sign in at console.x.ai and open Billing for credits left and usage.", url: "https://console.x.ai", emails: true },
  openrouter: { where: "Sign in at openrouter.ai, open Credits for the balance and Activity for each call.", url: "https://openrouter.ai/settings/credits", emails: true },
  deepseek: { where: "Sign in at platform.deepseek.com and open Usage for spend and the balance.", url: "https://platform.deepseek.com/usage", emails: false },
  groq: { where: "Sign in at console.groq.com and open Settings, then Billing and Usage.", url: "https://console.groq.com/settings/billing", emails: true },
  together: { where: "Sign in at api.together.ai and open Settings, then Billing.", url: "https://api.together.ai/settings/billing", emails: true },
  fireworks: { where: "Sign in at fireworks.ai and open Account, then Billing.", url: "https://fireworks.ai/account/billing", emails: true },
  mistral: { where: "Sign in at console.mistral.ai and open Usage, or Billing for credits.", url: "https://console.mistral.ai/usage", emails: true },
  perplexity: { where: "Sign in at perplexity.ai, open Settings, then API, then Billing.", url: "https://www.perplexity.ai/account/api/billing", emails: true },
};
const GENERIC_GUIDE = { where: "Open this AI's own website, sign in, and look for Billing or Usage.", url: null, emails: false };

// Sender domains of the AI services whose emails can carry a balance, a top-up, or a usage note.
const SENDERS = [
  [/(^|\.)openai\.com$/, "openai"], [/(^|\.)anthropic\.com$/, "anthropic"], [/(^|\.)x\.ai$/, "xai"],
  [/(^|\.)openrouter\.ai$/, "openrouter"], [/(^|\.)deepseek\.com$/, "deepseek"], [/(^|\.)groq\.com$/, "groq"],
  [/(^|\.)together\.(ai|xyz)$/, "together"], [/(^|\.)fireworks\.ai$/, "fireworks"], [/(^|\.)mistral\.ai$/, "mistral"],
  [/(^|\.)perplexity\.ai$/, "perplexity"],
];

export function guideFor(pid) {
  const g = USAGE_GUIDE[pid] || GENERIC_GUIDE;
  const report = "Agents that can run tools (Claude Code, Antigravity, Grok Bot) report their own use to Meldmind once they are set up.";
  const email = g.emails ? `${vendorOf(pid)} emails receipts. With your mailbox connected, Meldmind updates the balance from them on its own.` : null;
  return { where: g.where, url: g.url, emails: !!g.emails, email, report };
}

function all() { return doc(DOC, () => ({})); }
function save(d) { putDoc(DOC, d); }
const snapshot = (t) => (t ? { amount: t.amount, at: t.at, source: t.source, sourceAt: t.sourceAt, by: t.by || null, note: t.note || null, flag: t.flag || null } : null);

function provOk(pid) {
  const p = PROVIDERS[pid];
  if (!p || p.kind !== "text" || p.demo) throw new TrackError("Pick an AI provider first.");
  return p;
}
function amountOk(n, what = "balance") {
  const v = Number(String(n ?? "").replace(/[$,\s]/g, ""));
  if (String(n ?? "").trim() === "" || !Number.isFinite(v) || v < 0 || v > 1e6) throw new TrackError(`Type the ${what} in dollars, for example 20 or 12.50.`);
  return r2(v);
}

// "2026-10-21" or a timestamp. Today means now. A past day means the end of that day, so use later
// that day is not counted twice. The future is not allowed.
export function asOf(date, now = Date.now()) {
  if (date == null || date === "") return now;
  let t;
  if (typeof date === "number") t = date;
  else {
    const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { t = Date.parse(String(date)); if (Number.isNaN(t)) throw new TrackError("Pick the date you saw that balance."); }
    else {
      const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      const today = new Date(now); today.setHours(0, 0, 0, 0);
      if (start === today.getTime()) return now;
      t = start + 86400000 - 1;
    }
  }
  if (t > now + 60000) throw new TrackError("That date is in the future. Pick today or an earlier day.");
  return t;
}

function pushHistory(t, entry, prev) {
  t.history = [...(t.history || []), { id: newId(), ts: Date.now(), ...entry, prev }];
  if (t.history.length > HISTORY_MAX) t.history.splice(0, t.history.length - HISTORY_MAX);
}
function seenRef(t, ref) { return !!(ref && (t?.refs || []).includes(ref)); }
function addRef(t, ref) { if (!ref) return; t.refs = [...(t.refs || []), ref]; if (t.refs.length > REFS_MAX) t.refs.splice(0, t.refs.length - REFS_MAX); }

// The person typed the balance (source "you"), or an email or agent report gave one.
export function setBalance(pid, { amount, date, source = "you", by = null, ref = null, now = Date.now() } = {}) {
  provOk(pid);
  const value = amountOk(amount);
  const at = asOf(date, now);
  const d = all();
  const cur = d[pid] || null;
  if (seenRef(cur, ref)) return { changed: false, duplicate: true, tracked: cur };
  // an older email never replaces a newer balance
  if (cur && source === "email" && at < cur.at) { if (ref) { addRef(cur, ref); save(d); } return { changed: false, older: true, tracked: cur }; }
  const prev = snapshot(cur);
  const t = { ...(cur || {}), amount: value, at, source, sourceAt: now, by: by ? clip(by, 60) : null, note: null, flag: null, outside: (cur?.outside || []).filter((o) => o.ts > at) };
  const text = source === "email" ? `Updated from email ${fmtDate(at)}: ${money(value)} left.`
    : source === "agent" ? `${clip(by, 60) || "An agent"} reported ${money(value)} left.`
    : `You set the balance to ${money(value)} (${fmtDate(at)}).`;
  pushHistory(t, { kind: "set", source, text }, prev);
  addRef(t, ref);
  d[pid] = t;
  save(d);
  return { changed: true, tracked: t };
}

// A top-up email: credits added on top of the tracked balance. Ignored until a balance is tracked,
// and ignored when the top-up is older than the tracked balance (it is already in that number).
export function addTopUp(pid, { amount, date, ref = null, now = Date.now() } = {}) {
  provOk(pid);
  const value = amountOk(amount, "top-up");
  const at = asOf(date, now);
  const d = all();
  const cur = d[pid];
  if (!cur) return { changed: false, untracked: true };
  if (seenRef(cur, ref)) return { changed: false, duplicate: true, tracked: cur };
  if (at <= cur.at) { addRef(cur, ref); save(d); return { changed: false, older: true, tracked: cur }; }
  const prev = snapshot(cur);
  const t = { ...cur, amount: r2(cur.amount + value), source: "email", sourceAt: now, by: null, flag: null };
  pushHistory(t, { kind: "topup", source: "email", text: `Top-up from email ${fmtDate(at)}: +${money(value)}.` }, prev);
  addRef(t, ref);
  d[pid] = t;
  save(d);
  return { changed: true, tracked: t };
}

// Credits an agent spent outside Meldmind (report_usage, or usage in a report back).
// Stored even before a balance is tracked, so a balance typed later for an earlier day still counts it.
export function reportOutside(pid, { cost, by = "An agent", note = "", ref = null, at, now = Date.now() } = {}) {
  provOk(pid);
  const value = amountOk(cost, "amount spent");
  const ts = at ? asOf(at, now) : now;
  const d = all();
  const t = d[pid] || { amount: null, at: null, source: null, history: [] };
  if (seenRef(t, ref)) return { changed: false, duplicate: true };
  const prev = snapshot(t);
  t.outside = [...(t.outside || []), { id: newId(), ts, cost: value, by: clip(by, 60) || "An agent", note: clip(note, 140) }];
  if (t.outside.length > OUTSIDE_MAX) t.outside.splice(0, t.outside.length - OUTSIDE_MAX);
  pushHistory(t, { kind: "outside", source: "agent", text: `${clip(by, 60) || "An agent"} reported ${money(value)} spent outside Meldmind${note ? ` (${clip(note, 80)})` : ""}.` }, { ...prev, outsideLen: t.outside.length - 1 });
  addRef(t, ref);
  d[pid] = t;
  save(d);
  return { changed: true };
}

// A usage email that did not say how much is left: the only case besides a live mismatch that shows "possibly off".
export function flagUsageEmail(pid, { date, ref = null, now = Date.now() } = {}) {
  provOk(pid);
  const d = all();
  const t = d[pid];
  if (!t || t.amount == null || seenRef(t, ref)) return { changed: false };
  const at = asOf(date, now);
  if (at <= t.at) return { changed: false, older: true };
  t.flag = { kind: "email", at, text: `a usage email from ${fmtDate(at)} did not say how much is left` };
  addRef(t, ref);
  save(d);
  return { changed: true };
}

// Undo the latest change: the balance goes back to what it was before it.
export function undoLast(pid) {
  provOk(pid);
  const d = all();
  const t = d[pid];
  const last = t?.history?.[t.history.length - 1];
  if (!last) throw new TrackError("Nothing to undo.", 404);
  const history = t.history.slice(0, -1);
  const prev = last.prev;
  if (last.kind === "outside") {
    t.outside = (t.outside || []).slice(0, prev?.outsideLen ?? Math.max(0, (t.outside || []).length - 1));
    t.history = history;
  } else if (!prev || prev.amount == null) {
    if (!(t.outside || []).length && !history.length) { delete d[pid]; save(d); return { undone: last.text, tracked: null }; }
    Object.assign(t, { amount: null, at: null, source: null, sourceAt: null, by: null, note: null, flag: null, history });
  } else {
    Object.assign(t, { amount: prev.amount, at: prev.at, source: prev.source, sourceAt: prev.sourceAt, by: prev.by, note: prev.note, flag: prev.flag, history });
  }
  save(d);
  return { undone: last.text, tracked: t };
}

export function clearTracked(pid) { const d = all(); delete d[pid]; save(d); }
export const trackedRaw = (pid) => all()[pid] || null;

const monthStart = (now) => { const x = new Date(now); return new Date(x.getFullYear(), x.getMonth(), 1).getTime(); };

// The running balance for one provider, or null when the person has not given one.
//  entries: ledger lines; liveMtd: month-to-date spend from a live report (OpenAI or Anthropic admin key).
export function trackedView(pid, { entries = [], liveMtd = null, now = Date.now() } = {}) {
  const t = all()[pid];
  if (!t || t.amount == null || !t.at) return null;
  const inApp = entries.reduce((a, e) => a + (e.provider === pid && e.ts > t.at && !e.demo ? Number(e.cost || 0) : 0), 0);
  const outside = (t.outside || []).reduce((a, o) => a + (o.ts > t.at ? o.cost : 0), 0);
  const value = r2(Math.max(0, t.amount - inApp - outside));
  const sourceNote = t.source === "email" ? `updated from email ${fmtDate(t.at)}`
    : t.source === "agent" ? `reported by ${t.by || "an agent"} ${fmtDate(t.at)}`
    : `you entered ${money(t.amount)} on ${fmtDate(t.at)}`;
  // A mismatch only: live month-to-date spend is clearly higher than everything Meldmind knows about.
  let possiblyOff = null;
  if (liveMtd != null && Number.isFinite(Number(liveMtd))) {
    const ms = monthStart(now);
    const known = entries.reduce((a, e) => a + (e.provider === pid && e.ts >= ms && !e.demo ? Number(e.cost || 0) : 0), 0)
      + (t.outside || []).reduce((a, o) => a + (o.ts >= ms ? o.cost : 0), 0);
    const gap = Number(liveMtd) - known;
    if (gap > Math.max(1, Number(liveMtd) * 0.1)) possiblyOff = `Possibly off: the ${vendorOf(pid)} usage report shows ${money(gap)} more spent this month than Meldmind tracked. Type the balance in Update balance to fix it.`;
  }
  if (!possiblyOff && t.flag?.text) possiblyOff = `Possibly off: ${t.flag.text}. Type the balance in Update balance to fix it.`;
  const history = (t.history || []).slice(-8).reverse().map((h) => ({ id: h.id, ts: h.ts, kind: h.kind, text: h.text }));
  return {
    value, total: r2(t.amount), unit: "USD", source: "tracked", estimated: true, since: t.at,
    label: `tracked since ${fmtDate(t.at)}`, sourceNote,
    spentInApp: r2(inApp), spentOutside: r2(outside), possiblyOff, history, canUndo: history.length > 0,
  };
}

// ---------- emails ----------
const NUM = String.raw`(?:US)?\$\s?([\d,]+(?:\.\d{1,2})?)`;
const BALANCE_RES = [
  new RegExp(String.raw`(?:remaining|current|available|credit|prepaid|account)\s+(?:credit\s+)?balance(?:\s+is|\s+of|\s+now)?\s*:?\s*` + NUM, "i"),
  new RegExp(String.raw`(?:you\s+have|balance\s+left|left\s+on\s+your\s+account)\s*:?\s*` + NUM + String.raw`(?:\s+(?:in\s+)?credits?)?(?:\s+(?:left|remaining))?`, "i"),
  new RegExp(NUM + String.raw`\s+(?:in\s+)?(?:credits?\s+)?(?:left|remaining)\b`, "i"),
];
const TOPUP_RES = [
  new RegExp(String.raw`(?:purchased|bought|added|top[- ]?up\s+of|credit\s+purchase\s+of|credit\s+grant\s+of)\s*` + NUM + String.raw`(?:\s+(?:of|in))?\s*(?:API\s+)?credits?`, "i"),
  new RegExp(NUM + String.raw`\s+(?:of\s+|in\s+)?(?:API\s+)?credits?\s+(?:were\s+|have\s+been\s+)?(?:added|purchased)`, "i"),
];
const USAGE_RE = /\b(usage|credits?\s+(?:are\s+)?running\s+low|low\s+(?:credit\s+)?balance|spend\s+(?:limit|threshold)|billing\s+threshold)\b/i;

function senderDomain(from) {
  const m = String(from || "").match(/@([a-z0-9.-]+)/i);
  return m ? m[1].toLowerCase() : "";
}
export function providerOfSender(from) {
  const dom = senderDomain(from);
  if (!dom) return null;
  for (const [re, pid] of SENDERS) if (re.test(dom)) return pid;
  return null;
}
const num = (s) => r2(Number(String(s).replace(/,/g, "")));

// { from, subject, date, text } -> { provider, balance?, topUp?, usageOnly?, date } or null.
// Only the sender's own domain picks the provider, so a forwarded or look-alike email does nothing.
export function parseBalanceEmail(email = {}) {
  const provider = providerOfSender(email.from);
  if (!provider) return null;
  const body = `${email.subject || ""}\n${String(email.text || "").slice(0, 20000)}`;
  const t = Date.parse(email.date || "");
  const date = Number.isNaN(t) ? null : t;
  for (const re of BALANCE_RES) { const m = body.match(re); if (m) return { provider, balance: num(m[1]), date }; }
  for (const re of TOPUP_RES) { const m = body.match(re); if (m) return { provider, topUp: num(m[1]), date }; }
  if (USAGE_RE.test(body)) return { provider, usageOnly: true, date };
  return null;
}

// Apply one parsed email. ref is "<mailbox>:<message id>" so a rescan never applies it twice.
// Returns a short summary for the scan log, or null when nothing changed.
export function applyBalanceEmail(parsed, { ref, now = Date.now() } = {}) {
  if (!parsed?.provider || !PROVIDERS[parsed.provider]) return null;
  const date = parsed.date ? Math.min(parsed.date, now) : now;
  try {
    if (parsed.balance != null) { const r = setBalance(parsed.provider, { amount: parsed.balance, date, source: "email", ref, now }); return r.changed ? { provider: parsed.provider, kind: "balance" } : null; }
    if (parsed.topUp != null) { const r = addTopUp(parsed.provider, { amount: parsed.topUp, date, ref, now }); return r.changed ? { provider: parsed.provider, kind: "topup" } : null; }
    if (parsed.usageOnly) { const r = flagUsageEmail(parsed.provider, { date, ref, now }); return r.changed ? { provider: parsed.provider, kind: "usage" } : null; }
  } catch { return null; }
  return null;
}

// ---------- agent reporting ----------
// The standing instruction an agent-type AI keeps, so its own use outside Meldmind is subtracted too.
export function standingInstruction() {
  return [
    "Meldmind keeps track of my AI credits. Whenever you finish a task that used paid AI credits outside Meldmind, report what it cost.",
    "If you can use tools: call the Meldmind tool report_usage with provider (for example anthropic, openai, xai, google, openrouter), credits_spent in US dollars, and a short note.",
    "If you report back to Meldmind with a JSON result instead, add usage: [{ \"provider\": \"anthropic\", \"cost\": 0.42 }] to it.",
    "Report only real numbers you can see. Never include keys or passwords.",
  ].join("\n");
}

// Provider ids an agent may name, with a few everyday aliases.
const ALIASES = { claude: "anthropic", gpt: "openai", chatgpt: "openai", grok: "xai", gemini: "google" };
export function resolveProvider(name) {
  const k = String(name || "").trim().toLowerCase();
  const id = ALIASES[k] || k;
  const p = PROVIDERS[id];
  return p && p.kind === "text" && !p.demo ? id : null;
}

// Validates one usage report from an agent (MCP tool, bridge route or report back).
export function acceptUsageReport({ provider, credits_spent, cost, note, report_id, by } = {}) {
  const pid = resolveProvider(provider);
  if (!pid) throw new TrackError("provider must be an AI provider Meldmind knows, such as anthropic, openai, xai, google, or openrouter.");
  const spent = credits_spent ?? cost;
  const ref = report_id ? `agent:${clip(report_id, 80)}` : null;
  const r = reportOutside(pid, { cost: spent, by: by || "An agent", note, ref });
  return { ok: true, provider: pid, duplicate: !!r.duplicate };
}
