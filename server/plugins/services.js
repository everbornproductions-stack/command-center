// Subscriptions and services page (Phase 25): the routes behind the Subscriptions tab. The logic lives
// in server/services.js (live balances, admin keys, read-only mail scan, totals, hints) and
// server/receipts.js (the receipt parser). Renewal reminders are the alerts plugin's renewalSweep.
// Like the tracker it builds on, this is a Pro feature: Free users get { locked: true }.
// Keys and mail tokens go to the vault and never come back to the browser (masked only).
import { servicesView, refreshLive, apiRows, saveAdminKey, removeAdminKey, setMailClient, mailStart, mailFinish, mailDisconnect, scanMail, confirmCandidate, dismissCandidate, mailView, MAIL_SOURCES } from "../services.js";
import { subscriptionView, deleteSubscription } from "../subscriptions.js";
import { subscriptionsLocked } from "../license.js";
import { renewalSweep, raise } from "./alerts.js";

export const id = "services";
let H = null;
export async function init(h) { H = h; }

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

  if (m === "POST" && p === "/admin-key") return h.json(res, 200, { ...(await saveAdminKey(String(body.provider || ""), body.key)), view: servicesView() });
  if (m === "DELETE" && seg[0] === "admin-key" && seg[1]) { await removeAdminKey(seg[1]); h.emit("log", { text: "Admin key removed from the vault." }); return h.json(res, 200, servicesView()); }

  // manual add and edit, always available with or without the email scan; every field changed here is "you entered"
  if (m === "POST" && p === "/subscriptions") {
    const { origin, confidence, source, ...row } = body || {};
    try { const saved = h.saveSubscription(row, { origin: "user" }); return h.json(res, 200, { saved, view: servicesView() }); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
  }
  if (m === "DELETE" && seg[0] === "subscriptions" && seg[1]) { deleteSubscription(seg[1]); return h.json(res, 200, servicesView()); }

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
      const r = await scanMail(src, { days: body.days, max: body.max, subs: subscriptionView(), accountId: body.accountId || null });
      h.emit("log", { text: `Receipt scan (${src === "demo" ? "sample emails" : src}): ${r.found} suggestion${r.found === 1 ? "" : "s"} to confirm, ${r.failed.length} email${r.failed.length === 1 ? "" : "s"} not understood.` });
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

// live balances: shortly after start, then hourly (local mode; the hosted hub refreshes on demand)
const tick = () => { try { if (H && !H.HOSTED && !subscriptionsLocked()) refreshLive().then(() => balanceAlerts(H)).catch(() => {}); } catch {} };
setTimeout(tick, 45000).unref();
setInterval(tick, 3600 * 1000).unref();
