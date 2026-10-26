// Guided builders. Describe, preview the AIs, build, test, then publish.
// A builder is listed only when detect() says the need is here.
// Every send, post, or charge waits for Publish. Preview, Build, and Test do not post.

import { detect, get } from "../builders/registry.js";
import { loadBuilders, formFor } from "../builders/catalog.js";
import {
  STEPS, TAX_LINE, LEGAL_LINE, DOCUSEAL_NOTE, NINJA_NOTE, OCR_NOTE, INVOICE_READ_NOTE, WHISPER_NOTE,
  cleanInput, fingerprint, makeDraft, requiredChecks, missingChecks, needsRemote, quietHoursOk, aiRecipients,
} from "../builders/drafts.js";
import { builderGate } from "../feature-gate.js";
import { checkOutgoing } from "../compliance-guard.js";
import { readReceipt, readInvoiceText, readWhisper, readPipeline, publishExternal } from "../builders/adapters.js";

export const id = "builders";
const KIND = "builders.jobs";

const SECRET_FIELDS = new Set(["key", "token", "secret", "authorization", "password", "apiKey", "access", "refresh"]);

function tierOf(h) {
  try { return h.licenseState().tier || "free"; } catch { return "free"; }
}
function secret(h, name) {
  try { return h.getSecret(name) || null; } catch { return null; }
}
function connections(h) {
  const ghl = secret(h, "ghl");
  const qb = secret(h, "quickbooks");
  const xero = secret(h, "xero");
  return {
    highlevel: !!(ghl?.key && ghl?.locationId),
    quickbooks: !!(qb?.key && qb?.realmId),
    xero: !!(xero?.key && xero?.tenantId),
    chatwoot: !!secret(h, "chatwoot")?.key,
    cal: !!secret(h, "cal")?.key,
    docuseal: !!secret(h, "docuseal")?.key,
    invoiceninja: !!secret(h, "invoiceninja")?.key,
  };
}
function contextFor(h, text) {
  return { text: String(text || ""), connected: connections(h) };
}
function jobsOf(h) {
  const d = h.doc(KIND, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}
function saveJobs(h, doc) {
  doc.items = doc.items.slice(0, 200);
  h.putDoc(KIND, doc);
}
function newId() {
  return "bj" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELDS.has(k)) continue;
    out[k] = stripSecrets(v);
  }
  return out;
}
function publicJob(job) {
  if (!job) return null;
  return stripSecrets({
    id: job.id, builderId: job.builderId, step: job.step, draft: job.draft || null,
    test: job.test || null, posted: !!job.posted, approved: !!job.approved, ts: job.ts,
  });
}
function modelsOf(h) {
  try { return (h.rank({ capability: "writing", difficulty: 1, mode: "economy", estIn: 400, estOut: 250, small: true }) || []).slice(0, 3); }
  catch { return []; }
}
function gateFor(h, builder) {
  return builderGate({ tier: tierOf(h), need: builder?.tier || "free" });
}
function secretFor(h, builderId) {
  if (builderId.startsWith("hl-")) return secret(h, "ghl");
  if (builderId === "acct-qbo") return secret(h, "quickbooks");
  if (builderId === "acct-xero") return secret(h, "xero");
  if (builderId === "acct-invoice-make") return secret(h, "invoiceninja");
  if (builderId === "biz-chat") return secret(h, "chatwoot");
  if (builderId === "biz-booking") return secret(h, "cal");
  if (builderId === "biz-contract") return secret(h, "docuseal");
  return null;
}
function isConnected(builderId, s) {
  if (!s?.key) return false;
  if (builderId.startsWith("hl-")) return !!s.locationId;
  if (builderId === "acct-qbo") return !!s.realmId;
  if (builderId === "acct-xero") return !!s.tenantId;
  return true;
}
function serviceLine(builder) {
  return { name: builder.title, receives: builder.publishNote || "Nothing is called until you click Publish." };
}

const CONNECT = {
  highlevel: { vault: "ghl", fields: ["locationId"] },
  quickbooks: { vault: "quickbooks", fields: ["realmId"] },
  xero: { vault: "xero", fields: ["tenantId"] },
  chatwoot: { vault: "chatwoot", fields: ["url", "accountId"] },
  cal: { vault: "cal", fields: [] },
  docuseal: { vault: "docuseal", fields: ["url"] },
  invoiceninja: { vault: "invoiceninja", fields: ["url"] },
};

export function init() {
  loadBuilders();
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/builders/, "") || "/";

  if (req.method === "GET" && (p === "/" || p === "")) {
    const text = url.searchParams.get("text") || "";
    const ctx = contextFor(h, text);
    const found = detect(ctx);
    const forms = {};
    for (const b of found) forms[b.id] = { ...formFor(b.id), publishNote: b.publishNote || "", tier: b.tier, checks: requiredChecks(b.id, { text }) };
    return h.json(res, 200, {
      steps: STEPS,
      builders: found,
      forms,
      connections: ctx.connected,
      notes: { tax: TAX_LINE, docuseal: DOCUSEAL_NOTE, ninja: NINJA_NOTE, ocr: OCR_NOTE, invoice: INVOICE_READ_NOTE, whisper: WHISPER_NOTE },
    });
  }

  if (req.method === "POST" && p === "/detect") {
    const found = detect(contextFor(h, body?.text));
    return h.json(res, 200, { builders: found });
  }

  if (req.method === "POST" && p === "/connect") {
    const spec = CONNECT[String(body?.service || "")];
    const token = String(body?.token || "").trim();
    if (!spec) return h.json(res, 400, { error: "Pick a service to connect.", code: "service" });
    if (!token) return h.json(res, 400, { error: "Paste the token. Nothing was saved.", code: "token" });
    const value = { key: token };
    for (const field of spec.fields) {
      const v = String(body?.[field] || "").trim();
      if (v) value[field] = v.slice(0, 300);
    }
    if (spec.vault === "ghl" && !value.locationId) return h.json(res, 400, { error: "Add the location id. Nothing was saved.", code: "location" });
    if (spec.vault === "quickbooks" && !value.realmId) return h.json(res, 400, { error: "Add the company id. Nothing was saved.", code: "realm" });
    if (spec.vault === "xero" && !value.tenantId) return h.json(res, 400, { error: "Add the organisation id. Nothing was saved.", code: "tenant" });
    try { await h.setSecret(spec.vault, value); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code || "vault" }); }
    try { h.emit("log", { text: "A builder connection was saved." }); } catch { /* bus optional */ }
    return h.json(res, 200, { service: body.service, connected: true });
  }

  const parts = p.split("/").filter(Boolean);
  const builderId = parts[0] || "";
  const action = parts[1] || "";
  if (!/^[a-z0-9-]+$/.test(builderId)) return false;
  const builder = get(builderId);
  if (!builder) return h.json(res, 404, { error: "That builder is not available.", code: "missing" });
  if (req.method !== "POST" || !["preview", "build", "test", "publish"].includes(action)) return false;

  const { input, redacted } = cleanInput(body || {});
  const gate = gateFor(h, builder);

  if (action === "preview") {
    const draft = makeDraft(builderId, input);
    if (draft.legalBlocked) return h.json(res, 400, { error: LEGAL_LINE, code: "legal", posted: false });
    const job = {
      id: newId(), builderId, step: "preview", hash: fingerprint(input), input, draft, test: null,
      posted: false, approved: false, sentTo: [], ts: Date.now(),
    };
    const doc = jobsOf(h);
    doc.items.unshift(job);
    saveJobs(h, doc);
    return h.json(res, 200, {
      ran: false, posted: false, steps: STEPS, gate, job: publicJob(job), draft,
      checks: requiredChecks(builderId, input), redacted,
      recipients: aiRecipients(modelsOf(h)),
      service: serviceLine(builder),
      publishNote: builder.publishNote || "",
    });
  }

  const doc = jobsOf(h);
  const job = doc.items.find((row) => row.id === String(body?.jobId || ""));
  if (!job || job.builderId !== builderId) return h.json(res, 404, { error: "Preview this first. Nothing was sent.", code: "preview_required" });
  if (job.hash !== fingerprint(input)) return h.json(res, 409, { error: "Preview this again before you continue. Nothing was sent.", code: "preview_mismatch" });

  if (action === "build") {
    if (!gate.ok) return h.json(res, gate.status, { error: gate.message, code: gate.code, gate, posted: false });
    if (job.step === "published") return h.json(res, 409, { error: "This one is already published.", code: "done" });
    const draft = makeDraft(builderId, input);
    if (draft.legalBlocked) return h.json(res, 400, { error: LEGAL_LINE, code: "legal", posted: false });
    job.draft = draft;
    job.step = "built";
    job.test = null;
    job.posted = false;
    job.approved = false;
    saveJobs(h, doc);
    let ai = { started: false, reason: "The draft is ready on this computer. No AI was asked." };
    if (input.useAi === true && typeof h.runMission === "function") {
      try {
        const pending = h.runMission({
          goal: `Rewrite this builder draft in plain words. Do not send, post, or charge anything.\n\n${JSON.stringify(stripSecrets(draft)).slice(0, 2000)}`,
          context: "The person asked for a rewrite. Keep facts they gave. Do not invent numbers.",
          mode: "economy", budgetUsd: 0.25, maxTasks: 2, qa: false, search: false, tools: false,
        });
        ai = { started: true, reason: "The AIs are rewriting the draft. Nothing is sent." };
        if (pending && typeof pending.catch === "function") pending.catch(() => {});
      } catch { ai = { started: false, reason: "The rewrite did not start. The draft on this computer is unchanged." }; }
    }
    return h.json(res, 200, { ran: false, posted: false, gate, job: publicJob(job), draft, ai, checks: requiredChecks(builderId, input) });
  }

  if (action === "test") {
    if (job.step !== "built" && job.step !== "tested") return h.json(res, 409, { error: "Build this first. Nothing was sent.", code: "build_required" });
    let extra = { sent: false, posted: false };
    try {
      if (builderId === "acct-receipt") extra = await readReceipt({ engine: input.engine, text: input.text });
      else if (builderId === "acct-invoice-read") extra = await readInvoiceText(input.text);
      else if (builderId === "biz-notes") extra = await readWhisper(input.text);
      else if (builderId === "hl-pipeline") {
        const s = secretFor(h, builderId);
        if (isConnected(builderId, s)) extra = await readPipeline(s);
      }
    } catch (e) {
      return h.json(res, e.status || 502, { error: e.message || "The reader did not answer. Nothing was sent.", code: e.code || "service", posted: false });
    }
    job.draft = { ...job.draft, ...stripSecrets(extra), posted: false };
    job.test = { ok: true, posted: false, at: Date.now() };
    job.step = "tested";
    saveJobs(h, doc);
    return h.json(res, 200, { ran: true, posted: false, job: publicJob(job), test: job.test, draft: job.draft });
  }

  if (job.step === "published") return h.json(res, 409, { error: "This one is already published. Nothing else was sent.", code: "done", posted: false });
  if (body?.confirm !== true) return h.json(res, 400, { error: "Click Publish to finish. Nothing was sent.", code: "confirm", posted: false });
  if (job.step !== "tested") return h.json(res, 409, { error: "Test this first. Nothing was sent.", code: "test_required", posted: false });
  if (!gate.ok) return h.json(res, gate.status, { error: gate.message, code: gate.code, gate, posted: false });
  const missed = missingChecks(builderId, input, body?.checks);
  if (missed.length) return h.json(res, 400, { error: "Tick every box for this send. Nothing was sent.", code: "checks", missing: missed.map((c) => c.id), posted: false });
  if (builderId === "hl-campaign") {
    if (!input.recipients.length) return h.json(res, 400, { error: "Add at least one person. Nothing was sent.", code: "recipients", posted: false });
    if (!quietHoursOk(input.sendTime) || body?.checks?.quiet !== true) {
      return h.json(res, 409, { error: "That time is during quiet hours, from 9:00 pm to 8:00 am. Pick a time from 8:00 am until 9:00 pm. Nothing was sent.", code: "quiet_hours", posted: false });
    }
  }
  if (builderId === "hl-campaign") {
    const g = checkOutgoing({ text: input.text, channel: input.channel, consent: body?.checks?.tcpa === true, sendTime: input.sendTime });
    if (!g.ok) return h.json(res, 422, { error: `Not sent. ${g.blocked[0].plain} ${g.blocked[0].why}`, code: "compliance_block", warnings: g.warnings, posted: false });
    if (g.needsAck && body?.sendAnyway !== true) return h.json(res, 409, { error: "Review the warnings first. Press Fix it, or Send anyway if you are sure. Nothing was sent.", code: "compliance_review", warnings: g.warnings, posted: false });
  }
  if (builderId === "biz-contract" && (!input.templateId || !input.email)) {
    return h.json(res, 400, { error: "Add your template number and the email. Nothing was sent.", code: "template", posted: false });
  }
  if (job.draft?.taxBlocked && needsRemote(builderId, job.draft)) {
    return h.json(res, 409, { error: TAX_LINE, code: "tax", posted: false });
  }
  const remote = needsRemote(builderId, job.draft);
  const stored = secretFor(h, builderId);
  if (remote && !isConnected(builderId, stored)) {
    return h.json(res, 409, { error: "Connect this service first. Nothing was sent.", code: "not_connected", posted: false });
  }
  let result = { posted: false, reason: "Saved on this computer. Nothing was sent." };
  if (remote) {
    try {
      result = await publishExternal({ id: builderId, draft: job.draft, secret: stored, sentTo: job.sentTo || [] });
    } catch (e) {
      if (Array.isArray(e.sentTo)) job.sentTo = e.sentTo;
      saveJobs(h, doc);
      return h.json(res, e.status || 502, { error: e.message || "The service did not answer. Nothing else was sent.", code: e.code || "service", posted: false });
    }
    if (result.needsUrl) return h.json(res, 409, { error: result.reason, code: "address", posted: false });
    if (Array.isArray(result.sentTo)) job.sentTo = result.sentTo;
  }
  job.step = "published";
  job.posted = !!result.posted;
  job.approved = true;
  job.resultReason = result.reason;
  saveJobs(h, doc);
  try { h.emit("log", { text: result.posted ? "A builder posted after approval." : "A builder was saved. Nothing was sent." }); } catch { /* bus optional */ }
  return h.json(res, 200, { ran: true, posted: !!result.posted, reason: result.reason, job: publicJob(job), gate });
}
