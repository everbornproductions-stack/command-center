// Publish plus routes (slice C4, flag publish): caption variations, a content calendar with hand approval,
// and one-click website publish with preview and rollback. Off, every route says so.
// Nothing here posts or deploys on its own. A social post still goes out only through /api/publish/post
// (preview, then a click). A website deploy needs a plan and a click on that plan.
//
//   GET    /api/publishplus/status
//   POST   /api/publishplus/variations          { text, platform?, tags? }
//   GET    /api/publishplus/calendar
//   POST   /api/publishplus/calendar            { channel, title?, text, mediaUrl?, when?, accountIds?, channelId?, channelName? }
//   PUT    /api/publishplus/calendar/<id>       same fields; any edit removes the approval
//   DELETE /api/publishplus/calendar/<id>
//   POST   /api/publishplus/calendar/<id>/approve   { hash, confirmed: true }  hash is the one the card showed
//   POST   /api/publishplus/calendar/<id>/revoke
//   GET    /api/publishplus/sites/drafts
//   POST   /api/publishplus/sites/connect       { target, token }   token goes to the vault, never back out
//   DELETE /api/publishplus/sites/connect/<target>
//   POST   /api/publishplus/sites/config        { target, accountId?, project?, siteId? }
//   POST   /api/publishplus/sites/plan          { draftId, target, production? }
//   POST   /api/publishplus/sites/deploy        { draftId, target, production, hash, confirmed: true }
//   GET    /api/publishplus/sites/history
//   POST   /api/publishplus/sites/rollback-plan { historyId }
//   POST   /api/publishplus/sites/rollback      { historyId, confirmed: true }
import { flagOn } from "../flags.js";
import { holdOutbound } from "../phone-approvals.js";
import * as Plus from "../publish/plus.js";
import * as Sites from "../publish/sites.js";

export const id = "publishplus";
const DRAFTS = "builders.drafts";
const fail = (h, res, e) => h.json(res, e.status || 500, { error: e.message, code: e.code || "error" });

function draftsView(h) {
  return (h.doc(DRAFTS, () => ({ items: [] })).items || [])
    .map((d) => ({ id: d.id, name: d.name || d.builderId || "Website", builderId: d.builderId, createdAt: d.createdAt, files: Sites.collectFiles(d).length }))
    .filter((d) => d.files > 0);
}
const findDraft = (h, draftId) => (h.doc(DRAFTS, () => ({ items: [] })).items || []).find((d) => d.id === String(draftId || "")) || null;
const connected = (h, target) => { try { return !!h.hasSecret(Sites.TARGETS[target].vault); } catch { return false; } };

function statusOf(h) {
  const cfg = Sites.readConfig(h);
  return {
    channels: Plus.CHANNELS.map((c) => ({ id: c, name: Plus.LIMITS[c].name })),
    platforms: Object.entries(Plus.LIMITS).map(([k, v]) => ({ id: k, name: v.name, max: v.max, times: v.times })),
    targets: Object.entries(Sites.TARGETS).map(([k, t]) => ({ id: k, name: t.name, connected: connected(h, k), fields: t.fields.map((f) => ({ id: f, label: t.words[f], value: cfg[k]?.[f] || "" })) })),
  };
}

function phone(body, action) {
  holdOutbound({ kind: "send", action, amount: null, approvalId: body?.approvalId, confirmed: body?.confirmed === true });
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/publishplus/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  if (!flagOn("publish")) return h.json(res, 404, { error: "Publish plus is turned off on this install.", code: "flag_off" });
  try {
    if (req.method === "GET" && p === "/status") return h.json(res, 200, statusOf(h));
    if (req.method === "POST" && p === "/variations") return h.json(res, 200, Plus.captionVariations({ text: String(body?.text || "").slice(0, 5000), platform: String(body?.platform || "instagram"), tags: Array.isArray(body?.tags) ? body.tags.slice(0, 10).map((t) => String(t).slice(0, 40)) : [] }));

    // ---------- calendar ----------
    if (seg[0] === "calendar") {
      if (req.method === "GET" && !seg[1]) return h.json(res, 200, { items: Plus.listCalendar(h) });
      if (req.method === "POST" && !seg[1]) return h.json(res, 200, Plus.addItem(h, body || {}));
      if (req.method === "PUT" && seg[1] && !seg[2]) return h.json(res, 200, Plus.updateItem(h, seg[1], body || {}));
      if (req.method === "DELETE" && seg[1] && !seg[2]) return h.json(res, 200, { ok: Plus.removeItem(h, seg[1]) });
      if (req.method === "POST" && seg[1] && seg[2] === "approve") return h.json(res, 200, Plus.approveItem(h, seg[1], { hash: body?.hash, confirmed: body?.confirmed }));
      if (req.method === "POST" && seg[1] && seg[2] === "revoke") return h.json(res, 200, Plus.revokeItem(h, seg[1]));
    }

    // ---------- websites ----------
    if (seg[0] === "sites") {
      const s = seg[1];
      if (req.method === "GET" && s === "drafts") return h.json(res, 200, { items: draftsView(h) });
      if (req.method === "GET" && s === "history") {
        const items = Sites.readHistory(h).slice(0, 100).map((x) => ({ ...x, canRollBack: Sites.canRollBackTo(x) }));
        return h.json(res, 200, { items });
      }
      if (req.method === "POST" && s === "config") return h.json(res, 200, { config: Sites.saveConfig(h, String(body?.target || ""), body || {}) });
      if (req.method === "POST" && s === "connect") {
        const t = Sites.TARGETS[String(body?.target || "")];
        const token = String(body?.token || "").trim();
        if (!t) return h.json(res, 400, { error: "Pick Cloudflare Pages, Vercel or Netlify.", code: "target" });
        if (token.length < 8 || token.length > 500) return h.json(res, 400, { error: "That token does not look usable.", code: "bad_token" });
        await h.setSecret(t.vault, { key: token }); // the vault holds it; it is never shown again
        return h.json(res, 200, { target: body.target, connected: true });
      }
      if (req.method === "DELETE" && s === "connect" && seg[2]) {
        const t = Sites.TARGETS[seg[2]];
        if (!t) return h.json(res, 400, { error: "Unknown host.", code: "target" });
        await h.setSecret(t.vault, null);
        return h.json(res, 200, { target: seg[2], connected: false });
      }
      if (req.method === "POST" && s === "plan") {
        const target = String(body?.target || "");
        const plan = Sites.planSite({ draft: findDraft(h, body?.draftId), target, production: body?.production === true, config: Sites.readConfig(h)[target] || {}, connected: Sites.TARGETS[target] ? connected(h, target) : false });
        return h.json(res, 200, plan);
      }
      if (req.method === "POST" && s === "deploy") {
        const target = String(body?.target || "");
        if (!Sites.TARGETS[target]) return h.json(res, 400, { error: "Pick Cloudflare Pages, Vercel or Netlify.", code: "target" });
        if (body?.confirmed !== true) return h.json(res, 400, { error: "Look at the plan and click to confirm. Nothing was sent.", code: "confirm_required" });
        const draft = findDraft(h, body?.draftId), config = Sites.readConfig(h)[target] || {};
        const production = body?.production === true;
        const plan = Sites.planSite({ draft, target, production, config, connected: connected(h, target) });
        if (!body?.hash || body.hash !== plan.hash) return h.json(res, 409, { error: "The files or settings changed since the plan. Look at the new plan, then confirm. Nothing was sent.", code: "plan_changed", plan });
        if (plan.problems.length) return h.json(res, 400, { error: `Fix these first: ${plan.problems.join(" ")}`, code: "plan_problems" });
        phone(body, `${production ? "Publish the live site" : "Send a site preview"} to ${plan.targetName}`);
        const entry = { id: "site-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), target, targetName: plan.targetName, production, draftId: String(body.draftId), name: draft.name || "Website", hash: plan.hash, count: plan.count, bytes: plan.bytes, where: plan.where, status: "pending" };
        if (plan.dryRun) { entry.status = "dry-run"; entry.note = "Not connected: recorded, nothing was sent."; }
        else {
          try {
            const r = await Sites.deploySite({ target, token: h.getSecret(Sites.TARGETS[target].vault)?.key || "", config, files: Sites.collectFiles(draft), production, fetchImpl: undefined });
            entry.status = "deployed"; entry.deployId = r.deployId || null; entry.url = r.url || null;
          } catch (e) { entry.status = "failed"; entry.error = e.message; }
        }
        Sites.addHistory(h, entry);
        if (entry.status === "deployed" && production) Sites.setLive(h, entry);
        h.emit("log", { text: `Website ${production ? "live deploy" : "preview"}: ${plan.targetName} ${entry.status}${entry.error ? ` · ${entry.error}` : ""}`, level: entry.status === "failed" ? "error" : undefined });
        try { h.recordCredits({ provider: target, units: 0, cost: 0, note: `site ${entry.status} · ${plan.targetName}`.slice(0, 160) }); } catch { /* the result still stands */ }
        return h.json(res, entry.status === "failed" ? 502 : 200, { ...entry, canRollBack: false });
      }
      if (req.method === "POST" && (s === "rollback-plan" || s === "rollback")) {
        const entry = Sites.readHistory(h).find((x) => x.id === String(body?.historyId || ""));
        if (!Sites.canRollBackTo(entry)) return h.json(res, 409, { error: "That deploy cannot be made live again (it is already live, or it was not a live deploy).", code: "not_rollbackable" });
        const t = Sites.TARGETS[entry.target], config = Sites.readConfig(h)[entry.target] || {};
        const plan = { historyId: entry.id, target: entry.target, targetName: t.name, url: entry.url || null, from: new Date(entry.ts).toLocaleString(), files: entry.count, summary: `Make the live site at ${t.name} (${entry.where || ""}) go back to the one you published on ${new Date(entry.ts).toLocaleString()} (${entry.count} file${entry.count === 1 ? "" : "s"}). Visitors see it right away.`, dryRun: !connected(h, entry.target) };
        if (s === "rollback-plan") return h.json(res, 200, plan);
        if (body?.confirmed !== true) return h.json(res, 400, { error: "Click to confirm the roll back. Nothing was changed.", code: "confirm_required" });
        phone(body, `Roll the live site back at ${t.name}`);
        if (plan.dryRun) return h.json(res, 409, { error: `${t.name} is not connected. Nothing was changed.`, code: "not_connected" });
        try {
          const r = await Sites.rollbackSite({ target: entry.target, token: h.getSecret(t.vault)?.key || "", config, deployId: entry.deployId });
          Sites.setLive(h, entry);
          const row = Sites.addHistory(h, { id: "site-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ts: Date.now(), target: entry.target, targetName: t.name, production: false, rollbackOf: entry.id, name: entry.name, count: entry.count, where: entry.where, status: "rolled-back", url: r.url || entry.url || null });
          h.emit("log", { text: `Website rolled back at ${t.name}` });
          return h.json(res, 200, { ...row, ok: true });
        } catch (e) { return fail(h, res, e); }
      }
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code || "error", approvalId: e.approvalId });
  }
  return false;
}
