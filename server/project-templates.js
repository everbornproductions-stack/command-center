// Custom project templates (slice B4, flag templates). A template is a saved starting point for
// Start a project: the project type, an idea, the answers, default plan steps, preferred AIs,
// media folder names and persona tags. It lives in doc("project.templates") in the user data
// folder, so the six built-in types and their example files stay untouched.
import { hasSecret, redact } from "./redact-text.js";
import { normalizeSteps, typeById } from "./walkthroughs.js";

export const TEMPLATE_DOC = "project.templates";
export const MAX_TEMPLATES = 50;

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const clipBlock = (v, n) => String(v ?? "").trim().slice(0, n);

export function loadTemplates(h) {
  const d = h.doc(TEMPLATE_DOC, () => ({ items: [] }));
  if (!Array.isArray(d.items)) d.items = [];
  return d;
}

function cleanList(raw, max, each) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  return [...new Set(list.map((x) => clip(x, each)).filter(Boolean))].slice(0, max);
}

// Turns loose input into a safe template body. Text that looks like a key is dropped.
export function cleanTemplate(input, base = {}) {
  const src = input || {};
  const type = typeById(src.type || base.type);
  if (!type) throw Object.assign(new Error("Pick a project type for this template."), { status: 400, code: "bad_type" });
  const name = clip(src.name ?? base.name, 60);
  if (name.length < 2) throw Object.assign(new Error("Give the template a name."), { status: 400, code: "bad_name" });
  const answers = {};
  const rawAnswers = src.answers ?? base.answers ?? {};
  for (const q of type.questions) {
    const v = clipBlock(rawAnswers?.[q.key], 2000);
    if (v) answers[q.key] = v;
  }
  const idea = clipBlock(src.idea ?? base.idea, 4000);
  const stepsRaw = src.steps ?? base.steps;
  const steps = Array.isArray(stepsRaw) && stepsRaw.length
    ? normalizeSteps(stepsRaw).map((s) => ({ id: s.id, title: s.title, capability: s.capability, difficulty: s.difficulty, instructions: s.instructions, deliverable: s.deliverable, deps: s.deps }))
    : [];
  const out = {
    name,
    type: type.id,
    note: clip(src.note ?? base.note, 300),
    idea,
    answers,
    steps,
    providers: cleanList(src.providers ?? base.providers, 6, 40),
    folders: cleanList(src.folders ?? base.folders, 12, 40),
    personas: cleanList(src.personas ?? base.personas, 6, 40),
  };
  const blob = [out.name, out.note, out.idea, ...Object.values(out.answers), ...out.steps.map((s) => s.instructions + " " + s.title)].join("\n");
  if (hasSecret(blob)) throw Object.assign(new Error("That text looks like a key or password. Take it out before saving a template."), { status: 400, code: "secret" });
  out.note = redact(out.note, 300);
  return out;
}

export function publicTemplate(t) {
  return {
    id: t.id, name: t.name, type: t.type, typeName: typeById(t.type)?.name || t.type, color: typeById(t.type)?.color || "#22d3ee",
    note: t.note || "", idea: t.idea || "", answers: t.answers || {}, steps: t.steps || [],
    providers: t.providers || [], folders: t.folders || [], personas: t.personas || [],
    custom: true, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

export function listTemplates(h) {
  return loadTemplates(h).items.map(publicTemplate);
}
export function findTemplate(h, id) {
  return loadTemplates(h).items.find((t) => t.id === id) || null;
}

export function createTemplate(h, input) {
  const d = loadTemplates(h);
  if (d.items.length >= MAX_TEMPLATES) throw Object.assign(new Error(`You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`), { status: 409, code: "limit" });
  const body = cleanTemplate(input);
  const now = Date.now();
  const t = { id: "tpl-" + now.toString(36) + Math.random().toString(36).slice(2, 6), ...body, createdAt: now, updatedAt: now };
  d.items.unshift(t);
  h.putDoc(TEMPLATE_DOC, d);
  return publicTemplate(t);
}

export function updateTemplate(h, id, input) {
  const d = loadTemplates(h);
  const i = d.items.findIndex((t) => t.id === id);
  if (i < 0) throw Object.assign(new Error("Template not found."), { status: 404, code: "not_found" });
  const body = cleanTemplate(input, d.items[i]);
  d.items[i] = { ...d.items[i], ...body, updatedAt: Date.now() };
  h.putDoc(TEMPLATE_DOC, d);
  return publicTemplate(d.items[i]);
}

export function deleteTemplate(h, id) {
  const d = loadTemplates(h);
  const i = d.items.findIndex((t) => t.id === id);
  if (i < 0) throw Object.assign(new Error("Template not found."), { status: 404, code: "not_found" });
  d.items.splice(i, 1);
  h.putDoc(TEMPLATE_DOC, d);
  return { ok: true, id };
}

// A template made from a project in progress. Output text and statuses are not copied.
export function templateFromWalk(w, name) {
  return {
    name: name || w.plan?.title || typeById(w.type)?.name || "My template",
    type: w.type, idea: w.idea || "", answers: w.answers || {},
    steps: (w.plan?.steps || []).map((s) => ({ id: s.id, title: s.title, capability: s.capability, difficulty: s.difficulty, instructions: s.instructions, deliverable: s.deliverable, deps: s.deps })),
    providers: [...new Set((w.plan?.steps || []).map((s) => s.provider).filter(Boolean))],
  };
}

// The fields a new project takes from a template.
export function applyTemplate(w, t) {
  w.templateId = t.id;
  w.templateName = t.name;
  w.idea = t.idea || "";
  w.answers = { ...(t.answers || {}) };
  if (t.steps?.length) w.templateSteps = t.steps;
  if (t.providers?.length) w.preferredProviders = t.providers;
  if (t.folders?.length) w.mediaFolders = t.folders;
  if (t.personas?.length) w.personas = t.personas;
  return w;
}
