// Phase 33 item 1. HighLevel contacts, invoices, and workflows.
// A write returns a preview. The HighLevel API is called only after confirmed: true.
import { planHighlevel, resolvePlan, runHighlevelPlan, ACTIONS } from "../highlevel-tools.js";
import { access } from "../feature-gate.js";
import * as OA from "../publish/oauth.js";

export const id = "highlevel";

function publicConnect() {
  const row = OA.view().find((c) => c.id === "ghlcrm") || null;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    connected: row.connected,
    account: row.account,
    clientId: row.clientId,
    clientSecretSaved: row.clientSecretSaved,
    needsSignIn: row.needsSignIn,
    scopeLabel: row.scopeLabel,
    setup: row.setup,
  };
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/highlevel/, "") || "/";
  if (req.method === "GET" && (p === "" || p === "/")) {
    const row = access("highlevelTools");
    return h.json(res, 200, {
      open: row.ok,
      connect: publicConnect(),
      actions: Object.entries(ACTIONS).map(([id, spec]) => ({ id, writes: !!spec.writes, description: spec.description })),
      note: "Reads can run. A send, a charge, or a change waits for your click.",
    });
  }
  if (req.method === "POST" && p === "/preview") {
    access("highlevelTools");
    const planned = planHighlevel(String(body?.action || ""), body || {});
    if (planned.writes) {
      return h.json(res, 200, { writes: true, planId: planned.planId, summary: planned.summary, needsClick: true, sent: false, warnings: planned.warnings || [] });
    }
    const done = await resolvePlan(planned);
    return h.json(res, 200, { writes: false, summary: done.summary, result: done.result, sent: false });
  }
  if (req.method === "POST" && p === "/run") {
    access("highlevelTools");
    const out = await runHighlevelPlan(body?.planId, body?.confirmed, body?.sendAnyway === true);
    return h.json(res, 200, out);
  }
  return false;
}
