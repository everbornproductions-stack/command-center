// Expand a chat, council, or mission with a Pro prompt before the router sees it.
// A removed chip is left alone. Missing facts halt. The template id is logged, not the text.

import { doc } from "../store.js";
import { noteTemplate } from "../brain.js";
import { requirePro } from "../feature-gate.js";
import { getTemplate } from "./catalog.js";
import { normalizeProfile } from "./profile.js";
import { renderTemplate } from "./render.js";

export const PROFILE_KIND = "prompts.profile";

export function loadProfile() {
  return normalizeProfile(doc(PROFILE_KIND, () => ({})));
}

export function expandJob(body, field) {
  const pack = body?.promptPack;
  if (!pack || pack.removed || !pack.templateId) return body;
  const chosen = getTemplate(pack.templateId);
  if (chosen?.industry) requirePro("industryPacks");
  const profile = loadProfile();
  const result = renderTemplate(pack.templateId, pack.inputs || {}, profile, { extras: pack.extras || null });
  if (result.halted) {
    try { noteTemplate({ id: pack.templateId, action: "halted" }); } catch { /* learning router optional */ }
    const err = new Error(result.message);
    err.status = 409;
    err.code = "prompt_halt";
    err.missing = result.missing;
    err.questions = result.questions;
    throw err;
  }
  try { noteTemplate({ id: pack.templateId, action: "applied" }); } catch { /* learning router optional */ }
  const original = String(body[field] || "").trim();
  const parts = [result.prompt];
  if (original) parts.push(`USER ORDERS:\n${original}`);
  // Project memory rides in context. For a chat it is appended here so the model still sees it.
  // A mission keeps that memory in the context field, next to the template's system block.
  if (field === "prompt" && body.context) parts.push(String(body.context));
  const next = { ...body, [field]: parts.filter(Boolean).join("\n\n") };
  if (field === "prompt" && !next.system) next.system = result.system;
  if (field === "goal") next.context = [result.system, body.context || ""].filter(Boolean).join("\n\n");
  next.promptPackApplied = { id: result.id, name: result.name, industry: result.industry || null, scf: !!result.scf };
  return next;
}
