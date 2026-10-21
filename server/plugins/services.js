// Subscriptions and services page (Phase 25): the routes behind the Subscriptions tab. The logic lives
// in server/services.js (live balances, admin keys, read-only mail scan, totals, hints) and
// server/receipts.js (the receipt parser). Renewal reminders are the alerts plugin's renewalSweep.
// Like the tracker it builds on, this is a Pro feature: Free users get { locked: true }.
// Keys and mail tokens go to the vault and never come back to the browser (masked only).
import { servicesView, refreshLive, apiRows, saveAdminKey, saveBudget, removeAdminKey, setMailClient, mailStart, mailFinish, mailDisconnect, scanMail, confirmCandidate, dismissCandidate, mailView, MAIL_SOURCES, removeSubscription, undoAutoRow, rescanConnected } from "../services.js";
import { subscriptionView } from "../subscriptions.js";
import { subscriptionsLocked } from "../license.js";
import { renewalSweep, raise } from "./alerts.js";
import { scheduler } from "../perf/scheduler.js";

export const id = "services";
let H = null;
export async function init(h) {
  H = h;
  if (h.HOSTED) return;
  // provider balances every 15 minutes while the app is in use (skipped while idle or on battery)
  scheduler.register({
    id: "detection",
    everyMs: 15 * 60 * 1000,
    firstMs: 45000,
    lightEveryMs: 3600 * 1000,
    pause: true,
    run: () => tick(),
  });
  // keep auto-detected rows current: rescan connected mailboxes once a day, paused while idle or on battery
  scheduler.register({
    id: "subscriptions-rescan",
    everyMs: 24 * 3600 * 1000,
    firstMs: 10 * 60 * 1000,
    pause: true,
    run: () => rescanTick(),
  });
}

// Pro only (the tracker's gate); does nothing until a mailbox is connected.
async function rescanTick() {
  if (!H || H.HOSTED || subscriptionsLocked()) return;
  try { H.guard("subscriptions"); } catch { return; }
  const out = await rescanConnected({ save: (row, meta) => H.saveSubscription(row, meta) });
  const added = out.reduce((a, x) => a + (x.added || 0), 0), updated = out.reduce((a, x) => a + (x.updated || 0), 0);
  if (added || updated) H.emit("log", { text: `Subscriptions rescan: ${added} auto-detected row${added === 1 ? "" : "s"} added, ${updated} updated from receipt emails.` });
}

const monthKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

// low or empty balances found by a live check go out through the alerts channels (once per level per month)
function balanceAlerts(h) {
  for (const r of apiRows()) {
    if (r.credits?.source !== "api" || r.credits.unit !== "USD") continue;
    if (r.credits.value <= 0) raise(h, `balance:${r.provider}:red:${monthKey()}`, `${r.name} has no credits left`, `$${r.credits.value} left (auto-detected from the ${r.name} API). Work goes to the next-best AI until you top up.`, "stop");
    else if (r.credits.value < 2) raise(h, `balance:${r.provider}:amber:${monthKey()}`, `${r.name} is low on credits`, `$${r.credits.value} left (auto-detected from the ${r.name} API).`, "amber");
  }
}

export async function routes(req, res, url, body, h) {
  try { return await handle(req, res, url, body, h); }
  catch (e) {
    if (e.status === 402) throw e; // the Pro gate, answered by the plugin loader
    return h.json(res, e.status || (e.network ? 502 : 400), { error: e.message, code: e.code });
  }
}

async function handle(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/services/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  if (m === "GET" && p === "/") return h.json(res, 200, subscriptionsLocked() ? { locked: true } : servicesView());
  h.guard("subscriptions"); // 402 with the Pro message on Free

  if (m === "POST" && p === "/refresh") { await refreshLive({ only: body.provider || undefined }); balanceAlerts(h); return h.json(res, 200, servicesView()); }

  if (m === "POST" && p === "/admin-key") return h.json(res, 200, { ...(await saveAdminKey(String(body.provider || ""), body.key, { teamId: body.teamId })), view: servicesView() });
  // a monthly budget or prepaid credit amount per provider: the estimate when there is no live balance
  if (m === "POST" && p === "/budget") { const saved = saveBudget(String(body.provider || ""), { amount: body.amount, kind: body.kind }); return h.json(res, 200, { saved, view: servicesView() }); }
  if (m === "DELETE" && seg[0] === "admin-key" && seg[1]) { await removeAdminKey(seg[1]); h.emit("log", { text: "Admin key removed from the vault." }); return h.json(res, 200, servicesView()); }

  // manual add and edit, always available with or without the email scan; every field changed here is "you entered"
  if (m === "POST" && p === "/subscriptions") {
    const { origin, confidence, source, ...row } = body || {};
    try { const saved = h.saveSubscription(row, { origin: "user" }); return h.json(res, 200, { saved, view: servicesView() }); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
  }
  // Remove any row; on an auto-detected row it also remembers the dismissal so a rescan does not add it back
  if (m === "DELETE" && seg[0] === "subscriptions" && seg[1]) { removeSubscription(seg[1]); return h.json(res, 200, servicesView()); }
  // Undo an auto-detected row: removes it and remembers the dismissal
  if (m === "POST" && seg[0] === "subscriptions" && seg[1] && seg[2] === "undo") { const r = undoAutoRow(seg[1]); return h.json(res, 200, { ...r, view: servicesView() }); }

  // read-only mail connection
  if (seg[0] === "mail") {
    if (m === "POST" && seg[1] === "client") return h.json(res, 200, await setMailClient(String(body.source || ""), { clientId: body.clientId, clientSecret: body.clientSecret }));
    if (m === "POST" && seg[1] === "start") {
      const origin = String(body.origin || "");
      if (!/^https?:\/\/[^\s/]+$/.test(origin.replace(/\/$/, ""))) return h.json(res, 400, { error: "origin required" });
      return h.json(res, 200, mailStart(String(body.source || ""), { redirectUri: `${origin.replace(/\/$/, "")}/`, accountId: body.accountId || null }));
    }
    if (m === "POST" && seg[1] === "finish") { const r = await mailFinish({ code: body.code, state: body.state }); return h.json(res, 200, { ...r, mail: mailView() }); }
    if (m === "POST" && seg[1] === "scan") {
      const src = String(body.source || "");
      if (src !== "demo" && !MAIL_SOURCES.includes(src)) return h.json(res, 400, { error: "source must be gmail, outlook or demo" });
      const r = await scanMail(src, { days: body.days, max: body.max, subs: subscriptionView(), accountId: body.accountId || null, save: (row, meta) => h.saveSubscription(row, meta) });
      h.emit("log", { text: `Receipt scan (${src === "demo" ? "sample emails" : src}): ${r.added.length} auto-detected row${r.added.length === 1 ? "" : "s"} added, ${r.updated.length} updated, ${r.found} suggestion${r.found === 1 ? "" : "s"} to confirm, ${r.failed.length} email${r.failed.length === 1 ? "" : "s"} not understood.` });
      return h.json(res, 200, { ...r, view: servicesView() });
    }
    if (m === "DELETE" && seg[1]) return h.json(res, 200, await mailDisconnect(seg[1]));
  }
  if (m === "POST" && seg[0] === "pending" && seg[1] && seg[2] === "confirm") {
    const saved = confirmCandidate(seg[1], { edits: body.edits || {}, target: body.target }, (row, meta) => h.saveSubscription(row, meta));
    return h.json(res, 200, { saved, view: servicesView() });
  }
  if (m === "POST" && seg[0] === "pending" && seg[1] && seg[2] === "dismiss") { dismissCandidate(seg[1]); return h.json(res, 200, servicesView()); }

  if (m === "POST" && p === "/sweep") { const sent = renewalSweep(h); return h.json(res, 200, { sent, view: servicesView() }); }
  return false;
}

// live balances: the shared scheduler runs this (local mode; the hosted hub refreshes on demand)
const tick = () => { try { if (H && !H.HOSTED && !subscriptionsLocked()) refreshLive({ maxAgeMs: 10 * 60 * 1000 }).then(() => balanceAlerts(H)).catch(() => {}); } catch {} };
