// Fill a Pro prompt from inputs and the Business Profile.
// Required facts that are still empty halt the run. Nothing is invented.

import { getTemplate } from "./catalog.js";
import { emptyProfile, globalBlock } from "./profile.js";
import { SAFETY_TEXT, SCF_TEXT, scrub } from "./safety.js";

const TOKEN = /\{\{\s*([A-Za-z][\w]*)\s*\}\}/g;

function fieldValue(field, inputs, profile) {
  const raw = inputs && inputs[field.key];
  if (raw != null && String(raw).trim() !== "") return String(raw).trim();
  if (field.profile && profile && String(profile[field.profile] || "").trim()) return String(profile[field.profile]).trim();
  if (field.link && profile?.links && String(profile.links[field.link] || "").trim()) return String(profile.links[field.link]).trim();
  return "";
}

function applyTokens(text, values) {
  return String(text || "").replace(TOKEN, (_, key) => (values[key] != null && values[key] !== "" ? values[key] : "(not given)"));
}

export function renderTemplate(id, inputs = {}, profile = emptyProfile(), { extras = null, unattended = false } = {}) {
  const template = typeof id === "string" ? getTemplate(id) : id;
  if (!template) {
    const err = new Error("That Pro prompt does not exist.");
    err.status = 404;
    err.code = "prompt_missing";
    throw err;
  }
  const { value: cleanInputs, redacted } = scrub(inputs || {});
  const p = { ...emptyProfile(), ...(profile || {}) };
  const values = {};
  const missing = [];
  for (const field of template.inputs || []) {
    const v = fieldValue(field, cleanInputs, p);
    if (field.required !== false && !v) missing.push({ key: field.key, label: field.label, question: `What should I use for ${field.label}?` });
    else if (v) values[field.key] = v;
  }
  if (missing.length && !unattended) {
    return {
      halted: true,
      id: template.id,
      name: template.name,
      missing,
      questions: missing.map((m) => m.question),
      message: `I need a few facts before I can run ${template.name}. I will not invent them.`,
      redacted,
    };
  }
  const scf = !!(template.scf || p.scf);
  const blocks = [
    globalBlock(p),
    scf ? SCF_TEXT : "",
    `ROLE: ${applyTokens(template.role, values)}`,
    `CONTEXT: ${applyTokens(template.context, values)}`,
    `COMMAND: ${applyTokens(template.command, values)}`,
    `FORMAT: ${applyTokens(template.format, values)}`,
    `OUTPUT: ${template.output}`,
    SAFETY_TEXT,
    "If a required fact above says (not given) or is listed under MISSING, stop and ask for it. Do not invent it.",
  ];
  if (missing.length) blocks.push(`MISSING (ask, do not invent):\n${missing.map((m) => `- ${m.question}`).join("\n")}`);
  if (extras?.subscriptions) blocks.push(`SUBSCRIPTIONS ON FILE (names and prices only):\n${extras.subscriptions}`);
  if (template.links?.length) blocks.push(`RELATED PROMPTS: ${template.links.join(", ")}. Use them when the command says to.`);
  const system = blocks.filter(Boolean).join("\n\n");
  const userLines = Object.entries(values).map(([k, v]) => `${k}: ${v}`);
  const prompt = `${system}\n\nINPUTS:\n${userLines.join("\n") || "(none)"}`;
  return {
    halted: false,
    id: template.id,
    name: template.name,
    category: template.category,
    system,
    prompt,
    values,
    missing,
    redacted,
    scf,
    output: template.output,
  };
}
