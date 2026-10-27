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
import { PACK_CATEGORIES, creditLine, mergePacks, openPlan, readPackDir } from "../prompts/packs.js";
import { rankPrompts } from "../prompts/rank.js";
import { SUGGEST_LIMIT, rankSuggestions, suggestSource } from "../prompts/suggest.js";
import { VOTE_KIND, castVote, countsFor, emptyVotes, markSynced, normalizeVotes } from "../prompts/votes.js";
import { fetchCloudPacks, fetchCloudTotals, pushCloudVote } from "../prompts/cloud.js";
import { cheapest } from "../router.js";
import { completeFallback } from "../fallback.js";
import { subscriptionView } from "../subscriptions.js";
import { promptdropOn } from "../flags.js";
import { buildDrop, stageFor, videoTips } from "../prompts/drop.js";

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
  const r = await completeFallback({ allowStandIn: true,
    provider: m.provider, model: m.model, maxTokens: 120, system,
    messages: [{ role: "user", content: user }],
  }, { role: "classify", small: true, cls: { capability: "fast", difficulty: 1 }, mode: "economy", tools: false });
  return r.text || "";
}

function logMatch(templateId, action) {
  try { noteTemplate({ id: templateId, action }); } catch { /* learning router optional */ }
}

function voteState(h) {
  return normalizeVotes(h.doc(VOTE_KIND, () => emptyVotes()));
}

function decorate(row, state, now) {
  const c = countsFor(state, row.id);
  const [ranked] = rankPrompts([{ ...row, up: c.up, down: c.down }], now);
  return {
    ...row,
    up: c.up,
    down: c.down,
    mine: c.mine,
    fresh: ranked.fresh,
    popularity: ranked.popularity,
    scoreLabel: ranked.scoreLabel,
    credit: creditLine(row),
  };
}

async function refreshCloud(state) {
  let next = normalizeVotes(state);
  const totals = await fetchCloudTotals();
  if (!totals.offline) {
    const community = {};
    for (const row of totals.rows) community[row.promptId] = { up: row.up, down: row.down };
    next = { ...next, community };
  }
  return { state: next, offline: totals.offline };
}

function knownIds(h) {
  const ids = new Set(listTemplates().map((t) => t.id));
  for (const row of readPackDir()) ids.add(row.id);
  for (const row of listPrompts()) ids.add(row.id);
  return ids;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/prompts/, "") || "/";
  const method = req.method;

  if (method === "GET" && (p === "" || p === "/")) {
    const industryOpen = featureOpen("industryPacks").ok;
    const now = Date.now();
    let state = voteState(h);
    const cloudVotes = await refreshCloud(state);
    state = cloudVotes.state;
    const packs = await fetchCloudPacks();
    const weekly = mergePacks(readPackDir(), packs.rows).map((row) => decorate(row, state, now));
    if (!packs.offline || !cloudVotes.offline) h.putDoc(VOTE_KIND, state);
    return h.json(res, 200, {
      note: NOTE,
      categories: CATEGORIES,
      packCategories: PACK_CATEGORIES,
      industryOpen,
      templates: listTemplates().map((t) => decorate({ ...t, title: t.name, shelf: shelfFor(t), locked: !!(t.industry && !industryOpen) }, state, now)),
      weekly: rankPrompts(weekly, now),
      shelves: SHELVES,
      custom: customRows(h).map((row) => decorate({ ...row, title: row.name }, state, now)),
      interview: INTERVIEW,
      fields: FIELDS,
      integrations: { kling: KLING_PRESENT, voice: VOICE_PRESENT, schedules: SCHEDULES_PRESENT, pipelines: true, agents: true },
      schedules: scheduledPlan(),
      offline: packs.offline && cloudVotes.offline,
    });
  }
  if (method === "GET" && p === "/suggest") {
    const now = Date.now();
    const state = voteState(h);
    const packs = await fetchCloudPacks();
    const weekly = mergePacks(readPackDir(), packs.rows);
    const pool = [
      ...weekly.map((row) => ({ ...row, kind: row.feature ? "builder" : "weekly" })),
      ...listTemplates().map((t) => ({ id: t.id, title: t.name, name: t.name, category: t.category, description: t.description || "", prompt: t.description || t.name, kind: "template", industry: t.industry || null, inputs: (t.inputs || []).map((f) => ({ key: f.key, label: f.label, required: f.required !== false })) })),
      ...customRows(h).map((row) => ({ id: row.id, title: row.name, name: row.name, prompt: row.text || row.name, description: row.description || "", kind: "custom" })),
    ].map((row) => decorate(row, state, now));
    // Nothing until a few letters are typed, then only prompts that match the words or the intent.
    // There is no popular or top-N fallback: no match means an empty list.
    const found = rankSuggestions(url.searchParams.get("text") || "", rankPrompts(pool, now), { limit: SUGGEST_LIMIT });
    const items = found.items.map((row) => ({
      source: suggestSource(row),
      inputs: row.kind === "template" ? row.inputs || [] : undefined,
      id: row.id,
      title: row.title || row.name,
      prompt: row.prompt || "",
      category: row.category || "",
      kind: row.kind || "weekly",
      builder: row.builder || "",
      feature: row.feature || "",
      scoreLabel: row.scoreLabel,
      fresh: !!row.fresh,
      credit: row.credit || "",
      source_name: row.source_name || "",
      source_url: row.source_url || "",
      relevance: row.relevance,
    }));
    return h.json(res, 200, { items, intent: found.intent, subject: found.subject, action: found.action });
  }
  // The Prompts dropdown and the video tips (flag_promptdrop). Off: 404 flag_off, nothing else changes.
  if (method === "GET" && (p === "/drop" || p === "/video-tips")) {
    if (!promptdropOn()) return h.json(res, 404, { error: "The Prompts dropdown is turned off on this install.", code: "flag_off" });
    if (p === "/video-tips") return h.json(res, 200, videoTips());
    const now = Date.now();
    const state = voteState(h);
    const packs = await fetchCloudPacks();
    const weekly = rankPrompts(mergePacks(readPackDir(), packs.rows).map((row) => decorate(row, state, now)), now);
    const saved = customRows(h).map((row) => ({ id: row.id, title: row.name, prompt: row.text || row.name }));
    return h.json(res, 200, buildDrop({ stage: stageFor(url.searchParams.get("stage")), weekly, saved }));
  }
  if (method === "POST" && p === "/vote") {
    const id = String(body?.id || "").trim();
    const packs = await fetchCloudPacks();
    const allowed = knownIds(h);
    for (const row of packs.rows || []) {
      const cleanId = String(row?.id || "").trim();
      if (cleanId) allowed.add(cleanId);
    }
    if (!allowed.has(id)) return h.json(res, 404, { error: "That prompt is not in the list." });
    let state;
    try { state = castVote(voteState(h), id, body?.vote); }
    catch (e) { return h.json(res, e.status || 400, { error: e.message }); }
    h.putDoc(VOTE_KIND, state);
    const pushed = await pushCloudVote(id, state.mine[id] || "clear");
    if (!pushed.offline) state = markSynced(state, id);
    h.putDoc(VOTE_KIND, state);
    const c = countsFor(state, id);
    const [ranked] = rankPrompts([{ id, up: c.up, down: c.down }], Date.now());
    return h.json(res, 200, { id, vote: c.mine, up: c.up, down: c.down, scoreLabel: ranked.scoreLabel, offline: pushed.offline });
  }
  if (method === "POST" && p === "/open") {
    const id = String(body?.id || "");
    const packs = await fetchCloudPacks();
    const rows = mergePacks(readPackDir(), packs.rows);
    const row = rows.find((item) => item.id === id);
    if (!row) return h.json(res, 404, { error: "That prompt is not in the list." });
    const features = Array.isArray(body?.features) ? body.features.map((f) => String(f)) : [];
    return h.json(res, 200, { plan: openPlan(row, { features }) });
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
