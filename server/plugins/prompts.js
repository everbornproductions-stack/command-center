// Pro prompts: the pack, the profile, intent match, and the buttons that create
// a saved prompt, a paused schedule, or a pipeline. Nothing is sent from here.
import { CATEGORIES, NOTE, TEMPLATES, getTemplate, listTemplates } from "../prompts/catalog.js";
import { SHELVES, assignCustom, shelfFor } from "../../web/features/prompt-board.js";
import { FIELDS, INTERVIEW, emptyProfile, normalizeProfile, globalBlock } from "../prompts/profile.js";
import { detectIntent } from "../prompts/intent.js";
import { renderTemplate } from "../prompts/render.js";
import { annotateOutput } from "../prompts/safety.js";
import { loadProfile, PROFILE_KIND } from "../prompts/apply.js";
import { KLING_PRESENT, VOICE_PRESENT, SCHEDULES_PRESENT, createTeam, createLeveragePipelines, createBriefPipeline, installSchedules, scheduledPlan } from "../prompts/actions.js";
import { featureOpen, requirePro } from "../feature-gate.js";
import { noteTemplate } from "../brain.js";
import { createPrompt, listPrompts } from "../custom-agents.js";
import { cheapest } from "../router.js";
import { completeFallback } from "../fallback.js";
import { subscriptionView } from "../subscriptions.js";

export const id = "prompts";
const SHELF_KIND = "prompts.customShelves";

function customShelfDoc(h) {
  const d = h.doc(SHELF_KIND, () => ({ custom: {} }));
  if (!d.custom || typeof d.custom !== "object") d.custom = {};
  return d;
}

function customRows(h) {
  const map = customShelfDoc(h).custom;
  const movable = new Set(SHELVES.map((s) => s.id).filter((id) => id !== "marketplace"));
  return listPrompts().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || "",
    text: p.text || "",
    shelf: movable.has(map[p.id]) ? map[p.id] : "custom",
  }));
}

function profileDoc(h) {
  return normalizeProfile(h.doc(PROFILE_KIND, () => emptyProfile()));
}

function subscriptionLines() {
  try {
    const rows = subscriptionView();
    if (!Array.isArray(rows) || !rows.length) return "";
    return rows.map((s) => `${s.name || "Service"}${s.plan ? ` (${s.plan})` : ""}${s.monthly != null ? `: $${s.monthly}/month` : ""}`).join("\n");
  } catch {
    return "";
  }
}

async function askModel(system, user) {
  const m = cheapest(60);
  if (!m) throw new Error("No model is available for classification.");
  const r = await completeFallback({
    provider: m.provider, model: m.model, maxTokens: 120, system,
    messages: [{ role: "user", content: user }],
  }, { role: "classify", small: true, cls: { capability: "fast", difficulty: 1 }, mode: "economy", tools: false });
  return r.text || "";
}

function logMatch(templateId, action) {
  try { noteTemplate({ id: templateId, action }); } catch { /* learning router optional */ }
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/prompts/, "") || "/";
  const method = req.method;

  if (method === "GET" && (p === "" || p === "/")) {
    const industryOpen = featureOpen("industryPacks").ok;
    return h.json(res, 200, {
      note: NOTE,
      categories: CATEGORIES,
      industryOpen,
      templates: listTemplates().map((t) => ({ ...t, shelf: shelfFor(t), locked: !!(t.industry && !industryOpen) })),
      shelves: SHELVES,
      custom: customRows(h),
      interview: INTERVIEW,
      fields: FIELDS,
      integrations: { kling: KLING_PRESENT, voice: VOICE_PRESENT, schedules: SCHEDULES_PRESENT, pipelines: true, agents: true },
      schedules: scheduledPlan(),
    });
  }
  if (method === "GET" && p === "/profile") return h.json(res, 200, { profile: profileDoc(h), global: globalBlock(profileDoc(h)), interview: INTERVIEW, fields: FIELDS });
  if (method === "POST" && p === "/profile") {
    const next = normalizeProfile(body || {}, profileDoc(h));
    h.putDoc(PROFILE_KIND, next);
    return h.json(res, 200, { profile: next, redacted: body?.redacted || [] });
  }
  if (method === "GET" && p === "/schedules") return h.json(res, 200, { items: scheduledPlan(), schedules: SCHEDULES_PRESENT });
  if (method === "POST" && p === "/schedules") {
    try { h.guard("scheduler"); }
    catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
    return h.json(res, 200, installSchedules(profileDoc(h)));
  }
  if (method === "POST" && p === "/detect") {
    const text = String(body?.text || "").slice(0, 4000);
    if (!text.trim()) return h.json(res, 400, { error: "Type what you want first." });
    const visible = featureOpen("industryPacks").ok ? TEMPLATES : TEMPLATES.filter((t) => !t.industry);
    const match = await detectIntent(text, visible, { ask: body?.llm === false ? null : (system, user) => askModel(system, user) });
    if (match?.id) logMatch(match.id, match.autoApply ? "suggested" : "suggested");
    return h.json(res, 200, { match });
  }
  if (method === "POST" && p === "/render") {
    const tpl = getTemplate(body?.id);
    if (!tpl) return h.json(res, 404, { error: "That Pro prompt does not exist." });
    if (tpl.industry) {
      try { requirePro("industryPacks"); }
      catch (e) { return h.json(res, e.status || 402, { error: e.message, code: e.code }); }
    }
    const extras = tpl.usesSubscriptions ? { subscriptions: subscriptionLines() } : null;
    let result;
    try { result = renderTemplate(tpl, body?.inputs || {}, profileDoc(h), { extras, unattended: !!body?.unattended }); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message, code: e.code }); }
    if (result.halted) {
      logMatch(tpl.id, "halted");
      return h.json(res, 409, { error: result.message, code: "prompt_halt", missing: result.missing, questions: result.questions, id: result.id, name: result.name });
    }
    if (body?.saveProfile && body.inputs) {
      const patch = {};
      for (const field of tpl.inputs || []) if (field.profile && body.inputs[field.key] != null) patch[field.profile] = body.inputs[field.key];
      if (Object.keys(patch).length) h.putDoc(PROFILE_KIND, normalizeProfile(patch, profileDoc(h)));
    }
    return h.json(res, 200, result);
  }
  if (method === "POST" && p === "/annotate") {
    return h.json(res, 200, { text: annotateOutput(body?.text || "", body?.source || "", { scf: !!body?.scf }) });
  }
  if (method === "POST" && p === "/shelf") {
    const id = String(body?.id || "");
    const shelf = String(body?.shelf || "");
    try {
      const next = assignCustom({ id, shelf, ownIds: listPrompts().map((p) => p.id), current: customShelfDoc(h).custom });
      h.putDoc(SHELF_KIND, { custom: next });
      return h.json(res, 200, { id, shelf: next[id] });
    } catch (e) {
      return h.json(res, e.status || 400, { error: e.message });
    }
  }
  if (method === "POST" && p === "/save") {
    const name = String(body?.name || "Saved prompt").slice(0, 60);
    const text = String(body?.text || "").slice(0, 20000);
    if (!text.trim()) return h.json(res, 400, { error: "There is no prompt to save yet." });
    const saved = createPrompt({ name, description: "Saved from a chat result", text });
    return h.json(res, 200, { prompt: saved });
  }
  if (method === "GET" && p === "/saved") {
    const items = listPrompts().filter((row) => row.description === "Saved from a chat result");
    return h.json(res, 200, { items });
  }
  if (method === "POST" && p === "/team") return h.json(res, 200, createTeam(h));
  if (method === "POST" && p === "/pipelines") {
    const which = body?.id || "ai-leverage";
    if (which === "brain-dump-brief") return h.json(res, 200, { pipelines: [createBriefPipeline(h, body?.inputs || {}, profileDoc(h))] });
    return h.json(res, 200, { pipelines: createLeveragePipelines(h) });
  }
  if (method === "POST" && p === "/links") {
    const key = String(body?.key || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    if (!key) return h.json(res, 400, { error: "Name the link." });
    const next = normalizeProfile({ links: { [key]: String(body?.text || "") } }, profileDoc(h));
    h.putDoc(PROFILE_KIND, next);
    return h.json(res, 200, { profile: next });
  }
  if (method === "POST" && p === "/dismiss") {
    if (body?.id) logMatch(body.id, "removed");
    return h.json(res, 200, { ok: true });
  }
  return false;
}
