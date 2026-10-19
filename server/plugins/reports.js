// Weekly report: spend by AI (this week vs last), credits running low, renewals due, what shipped,
// and keep/downgrade/cancel suggestions. Runs Monday 07:00 local, or on demand. In-app, email, push.
import { allEntries } from "../ledger.js";
import { PROVIDERS } from "../registry.js";
export const id = "reports";
const LATEST = "reports.latest", HIST = "reports.history", STATE = "reports.state", PREFS = "reports.prefs";

let H = null;
export async function init(h) { H = h; }

function weekRange(offsetWeeks = 0) {
  const now = new Date(); const day = (now.getDay() + 6) % 7; // Monday = 0
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day - offsetWeeks * 7);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { start: start.getTime(), end: Math.min(end.getTime(), Date.now() + 1) };
}

export function buildReport(h) {
  const entries = allEntries();
  const thisW = weekRange(0), lastW = weekRange(1);
  const sum = (r) => { const by = {}; let total = 0, calls = 0; for (const e of entries) if (e.kind === "call" && e.ts >= r.start && e.ts < r.end) { by[e.provider] = (by[e.provider] || 0) + (e.cost || 0); total += e.cost || 0; calls++; } return { by, total, calls }; };
  const a = sum(thisW), b = sum(lastW);
  const providers = [...new Set([...Object.keys(a.by), ...Object.keys(b.by)])].map((pid) => ({ id: pid, name: PROVIDERS[pid]?.name || pid, thisWeek: +(a.by[pid] || 0).toFixed(4), lastWeek: +(b.by[pid] || 0).toFixed(4) })).sort((x, y) => y.thisWeek - x.thisWeek);
  const subs = h.subscriptionView();
  const low = subs.filter((s) => s.signal === "low" || s.signal === "attention");
  const renewals = subs.filter((s) => s.daysLeft != null && s.daysLeft >= 0 && s.daysLeft <= 7);
  const usedProviders = new Set(entries.filter((e) => e.ts > Date.now() - 30 * 86400000).map((e) => e.provider));
  const idle = subs.filter((s) => s.provider && !usedProviders.has(s.provider) && (s.monthly || s.listPrice));
  // what shipped: missions/councils done this week (from the ledger's missionIds)
  const runs = new Set(entries.filter((e) => e.kind === "call" && e.ts >= thisW.start && e.missionId).map((e) => e.missionId));
  const st = h.doc("alerts.state", () => null);
  const caps = st?.perProvider ? Object.entries(st.perProvider).filter(([, r]) => r.level !== "ok").map(([pid, r]) => `${PROVIDERS[pid]?.name || pid} at ${r.pct}% of $${r.cap}`) : [];
  const lines = [];
  lines.push(`# Weekly report · ${new Date(thisW.start).toLocaleDateString()} – ${new Date().toLocaleDateString()}`);
  lines.push(`\n## Spend`);
  lines.push(`API spend this week **$${a.total.toFixed(2)}** (${a.calls} calls) vs **$${b.total.toFixed(2)}** last week.`);
  if (providers.length) { lines.push(`\n| AI | This week | Last week |\n|---|---:|---:|`); for (const p of providers) lines.push(`| ${p.name} | $${p.thisWeek.toFixed(3)} | $${p.lastWeek.toFixed(3)} |`); }
  if (caps.length) lines.push(`\nCaps: ${caps.join("; ")}.`);
  lines.push(`\n## Credits and renewals`);
  lines.push(low.length ? low.map((s) => `- **${s.name}**: ${s.why || s.signal}`).join("\n") : "- Nothing running low.");
  lines.push(renewals.length ? renewals.map((s) => `- **${s.name}** renews in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"}${s.monthly != null ? ` ($${s.monthly})` : ""}`).join("\n") : "- No renewals in the next 7 days.");
  lines.push(`\n## What shipped`);
  lines.push(runs.size ? `- ${runs.size} run${runs.size === 1 ? "" : "s"} completed this week (missions, councils, single answers).` : "- No runs this week.");
  lines.push(`\n## Keep, downgrade, cancel`);
  lines.push(idle.length ? idle.map((s) => `- **${s.name}**: no API use in 30 days${s.monthly != null ? `, $${s.monthly}/month` : s.listPrice ? `, list ~$${s.listPrice}/month` : ""}. Keep only if you use it outside this console.`).join("\n") : "- Every tracked subscription with an API saw use this month.");
  const unpriced = subs.filter((s) => s.monthly == null).length;
  if (unpriced) lines.push(`- ${unpriced} subscription${unpriced === 1 ? "" : "s"} still have no confirmed price; fill them in on the Subscriptions tab for a real total.`);
  return { ts: Date.now(), week: thisW, markdown: lines.join("\n"), totals: { thisWeek: +a.total.toFixed(4), lastWeek: +b.total.toFixed(4), calls: a.calls, runs: runs.size }, low: low.length, renewals: renewals.length, idle: idle.length };
}

async function deliver(h, rep, reason) {
  h.putDoc(LATEST, rep);
  const hist = h.doc(HIST, () => ({ items: [] })); hist.items.unshift({ ts: rep.ts, totals: rep.totals, reason }); hist.items = hist.items.slice(0, 52); h.putDoc(HIST, hist);
  h.emit("log", { text: `Weekly report ready (${reason}): $${rep.totals.thisWeek.toFixed(2)} this week, ${rep.low} low, ${rep.renewals} renewing.` });
  const prefs = h.doc(PREFS, () => ({ email: "", emailOn: false }));
  const k = h.getSecret("resend")?.key;
  if (prefs.emailOn && prefs.email && k) {
    try { await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify({ from: "Command AI <reports@everbornproductions.com>", to: prefs.email, subject: `Weekly report: $${rep.totals.thisWeek.toFixed(2)} this week`, text: rep.markdown }) }); }
    catch (e) { h.emit("log", { text: `Report email failed: ${e.message}`, level: "error" }); }
  }
}

function dueNow(h) {
  const st = h.doc(STATE, () => ({ lastRun: 0 }));
  const now = new Date();
  const isMonday7 = now.getDay() === 1 && now.getHours() >= 7;
  const thisMonday7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 7).getTime();
  return isMonday7 && st.lastRun < thisMonday7;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/reports/, "");
  if (req.method === "GET" && p === "/latest") return h.json(res, 200, { latest: h.doc(LATEST, () => null), history: h.doc(HIST, () => ({ items: [] })).items, prefs: h.doc(PREFS, () => ({ email: "", emailOn: false })) });
  if (req.method === "POST" && p === "/run-now") { const rep = buildReport(h); await deliver(h, rep, "run now"); h.putDoc(STATE, { lastRun: Date.now() }); return h.json(res, 200, rep); }
  if (req.method === "POST" && p === "/prefs") { const prefs = { ...h.doc(PREFS, () => ({})), ...(body.email !== undefined ? { email: String(body.email).trim() } : {}), ...(body.emailOn !== undefined ? { emailOn: !!body.emailOn } : {}) }; h.putDoc(PREFS, prefs); return h.json(res, 200, prefs); }
  return false;
}

// schedule check every 10 minutes (local mode; hosted runs per user when they next load, see onEvent)
setInterval(async () => { try { if (H && !H.HOSTED && dueNow(H)) { const rep = buildReport(H); await deliver(H, rep, "Monday 07:00"); H.putDoc(STATE, { lastRun: Date.now() }); } } catch {} }, 10 * 60 * 1000).unref();
