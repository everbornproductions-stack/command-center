// Weekly report: spend by AI (this week vs last), credits running low, renewals due, what shipped,
// and keep/downgrade/cancel suggestions. Generated in-app every Monday from 07:00 local (or the next
// time the app runs after that), or on demand. Nothing is sent automatically: the person gets an
// email draft (opens their own mail app) and a Markdown export, and sends it themselves if they want.
import { allEntries } from "../ledger.js";
import { PROVIDERS } from "../registry.js";
export const id = "reports";
const LATEST = "reports.latest", HIST = "reports.history", STATE = "reports.state", PREFS = "reports.prefs";
const DONE = new Set(["done", "done-with-errors"]);

let H = null;
export async function init(h) {
  H = h;
  // catch up shortly after start when this week's Monday 07:00 report was missed (the app was closed)
  setTimeout(() => scheduledRun(), 60 * 1000).unref();
}

function weekRange(offsetWeeks = 0, now = new Date()) {
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - offsetWeeks * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start: start.getTime(), end: Math.min(end.getTime(), now.getTime() + 1) };
}

// The most recent Monday 07:00 at or before `now`.
export function lastMonday7(now = new Date()) {
  const day = (now.getDay() + 6) % 7;
  let t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 7);
  if (t.getTime() > now.getTime()) t = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 7, 7);
  return t.getTime();
}
// Due when no report has been generated since the most recent Monday 07:00.
export const isDue = (lastRun, now = new Date()) => (Number(lastRun) || 0) < lastMonday7(now);

function shippedThisWeek(h, start) {
  let list = [];
  try { list = h.ctx().store.listMissions((m) => ({ id: m.id, kind: m.kind, status: m.status, title: m.title || String(m.prompt || "").slice(0, 90), finishedAt: m.finishedAt || 0, demo: !!m.demo })); } catch {}
  return list.filter((m) => m && DONE.has(m.status) && m.finishedAt >= start).sort((a, b) => b.finishedAt - a.finishedAt);
}

const fmtDate = (t) => new Date(t).toLocaleDateString();

export function buildReport(h, now = new Date()) {
  const entries = allEntries();
  const thisW = weekRange(0, now), lastW = weekRange(1, now);
  const sum = (r) => { const by = {}; let total = 0, calls = 0; for (const e of entries) if (e.kind === "call" && e.ts >= r.start && e.ts < r.end) { by[e.provider] = (by[e.provider] || 0) + (e.cost || 0); total += e.cost || 0; calls++; } return { by, total, calls }; };
  const a = sum(thisW), b = sum(lastW);
  const providers = [...new Set([...Object.keys(a.by), ...Object.keys(b.by)])].map((pid) => ({ id: pid, name: PROVIDERS[pid]?.name || pid, thisWeek: +(a.by[pid] || 0).toFixed(4), lastWeek: +(b.by[pid] || 0).toFixed(4) })).sort((x, y) => y.thisWeek - x.thisWeek);
  const subs = h.subscriptionView();
  const low = subs.filter((s) => s.signal === "low" || s.signal === "attention");
  const renewals = subs.filter((s) => s.daysLeft != null && s.daysLeft >= 0 && s.daysLeft <= 7);
  const usedProviders = new Set(entries.filter((e) => e.ts > now.getTime() - 30 * 86400000).map((e) => e.provider));
  const idle = subs.filter((s) => s.provider && !usedProviders.has(s.provider) && (s.monthly || s.listPrice));
  const shipped = shippedThisWeek(h, thisW.start);
  const st = h.doc("alerts.state", () => null);
  const caps = st?.perProvider ? Object.entries(st.perProvider).filter(([, r]) => r.level !== "ok").map(([pid, r]) => `${PROVIDERS[pid]?.name || pid} at ${r.pct}% of $${r.cap}`) : [];
  const lines = [];
  lines.push(`# Weekly report · ${fmtDate(thisW.start)} to ${fmtDate(now)}`);
  lines.push(`\n## Spend`);
  lines.push(`API spend this week **$${a.total.toFixed(2)}** (${a.calls} calls) vs **$${b.total.toFixed(2)}** last week.`);
  if (providers.length) { lines.push(`\n| AI | This week | Last week |\n|---|---:|---:|`); for (const p of providers) lines.push(`| ${p.name} | $${p.thisWeek.toFixed(3)} | $${p.lastWeek.toFixed(3)} |`); }
  if (caps.length) lines.push(`\nCaps: ${caps.join("; ")}.`);
  lines.push(`\n## Credits and renewals`);
  lines.push(low.length ? low.map((s) => `- **${s.name}**: ${s.why || s.signal}`).join("\n") : "- Nothing running low.");
  lines.push(renewals.length ? renewals.map((s) => `- **${s.name}** renews in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}${s.monthly != null ? ` ($${s.monthly})` : ""}`).join("\n") : "- No renewals in the next 7 days.");
  lines.push(`\n## What shipped`);
  if (shipped.length) {
    lines.push(`${shipped.length} run${shipped.length === 1 ? "" : "s"} finished this week.`);
    lines.push(shipped.slice(0, 15).map((m) => `- ${m.title || m.kind} (${m.kind}, ${fmtDate(m.finishedAt)})${m.demo ? " [demo]" : ""}`).join("\n"));
    if (shipped.length > 15) lines.push(`- and ${shipped.length - 15} more`);
  } else lines.push("- Nothing finished this week.");
  lines.push(`\n## Keep, downgrade, cancel`);
  lines.push(idle.length ? idle.map((s) => `- **${s.name}**: no API use in 30 days${s.monthly != null ? `, $${s.monthly}/month` : s.listPrice ? `, list ~$${s.listPrice}/month` : ""}. Consider cancelling or downgrading, unless you use it outside this console.`).join("\n") : "- Every tracked subscription with an API saw use this month.");
  const unpriced = subs.filter((s) => s.monthly == null).length;
  if (unpriced) lines.push(`- ${unpriced} subscription${unpriced === 1 ? "" : "s"} still have no confirmed price; fill them in on the Subscriptions tab for a real total.`);
  return { ts: now.getTime(), week: thisW, markdown: lines.join("\n"), totals: { thisWeek: +a.total.toFixed(4), lastWeek: +b.total.toFixed(4), calls: a.calls, runs: shipped.length }, shipped: shipped.slice(0, 15).map(({ id, kind, title, finishedAt }) => ({ id, kind, title, finishedAt })), low: low.length, renewals: renewals.length, idle: idle.length, cancel: idle.map((s) => s.name) };
}

// A Monday catch-up stays quiet until some job has run. Run now is a click, so it may announce.
export function shouldAnnounceReport(reason, hasJob) {
  if (reason === "run now") return true;
  return !!hasJob;
}

function hasJob(h) {
  try { if (allEntries().some((e) => e && e.kind === "call")) return true; } catch { /* ledger not ready */ }
  try {
    const list = h.ctx().store.listMissions((m) => (m && m.id ? m.id : null));
    return Array.isArray(list) && list.some(Boolean);
  } catch { return false; }
}

// In-app only: the report is stored and announced in the live feed. No email, no push, no network.
function store(h, rep, reason) {
  if (!shouldAnnounceReport(reason, hasJob(h))) return;
  h.putDoc(LATEST, rep);
  const hist = h.doc(HIST, () => ({ items: [] })); hist.items.unshift({ ts: rep.ts, totals: rep.totals, reason }); hist.items = hist.items.slice(0, 52); h.putDoc(HIST, hist);
  h.putDoc(STATE, { lastRun: rep.ts });
  h.emit("log", { text: `Weekly report ready (${reason}): $${rep.totals.thisWeek.toFixed(2)} this week, ${rep.low} low, ${rep.renewals} renewing. Open Reports to read, export or draft an email.` });
  h.emit("reports.ready", { ts: rep.ts, reason });
}

function scheduledRun() {
  try { if (H && !H.HOSTED && isDue(H.doc(STATE, () => ({ lastRun: 0 })).lastRun)) store(H, buildReport(H), "Monday 07:00"); } catch (e) { console.error("[reports]", e.message); }
}

const prefsOf = (h) => ({ email: "", ...h.doc(PREFS, () => ({ email: "" })) });

// A plain-text draft for the person's own mail app. Built here so the page and the tests share it.
export function draftOf(rep, to = "") {
  const subject = `Weekly report: $${rep.totals.thisWeek.toFixed(2)} this week`;
  const body = rep.markdown.replace(/\*\*(.+?)\*\*/g, "$1");
  const enc = encodeURIComponent;
  // mailto bodies over ~1800 characters are cut by some mail apps, so the draft says where the full copy is
  const short = body.length > 1800 ? body.slice(0, 1800) + "\n\n(cut short: export the full report from Meldmind > Reports)" : body;
  return { to, subject, body, mailto: `mailto:${encodeURIComponent(to)}?subject=${enc(subject)}&body=${enc(short)}` };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/reports/, "");
  if (req.method === "GET" && p === "/latest") return h.json(res, 200, { latest: h.doc(LATEST, () => null), history: h.doc(HIST, () => ({ items: [] })).items, prefs: prefsOf(h), nextRun: lastMonday7() + 7 * 86400000 });
  if (req.method === "POST" && p === "/run-now") { const rep = buildReport(h); store(h, rep, "run now"); return h.json(res, 200, rep); }
  if (req.method === "POST" && p === "/prefs") { const prefs = { email: body.email !== undefined ? String(body.email).trim().slice(0, 200) : prefsOf(h).email }; h.putDoc(PREFS, prefs); return h.json(res, 200, prefs); }
  if (req.method === "GET" && (p === "/draft" || p === "/export")) {
    const rep = h.doc(LATEST, () => null);
    if (!rep) return h.json(res, 404, { error: "no report yet: click Run now" });
    if (p === "/draft") return h.json(res, 200, { ...draftOf(rep, prefsOf(h).email), sent: false });
    const name = `weekly-report-${new Date(rep.ts).toISOString().slice(0, 10)}.md`;
    res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" });
    res.end(rep.markdown);
    return true;
  }
  return false;
}

// schedule check every 10 minutes (local mode; hosted users get theirs from Run now)
setInterval(scheduledRun, 10 * 60 * 1000).unref();
