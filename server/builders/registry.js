// Shared builder registry. Workstream A registers websites and marketing.
// Workstream B plugs in by calling registerBuilder, or by dropping a module in
// server/builders/extras that exports register({ registerBuilder }).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BUILDER_STEPS = ["describe", "preview", "build", "test", "publish"];

const builders = new Map();

function bad(message) {
  return Object.assign(new Error(message), { status: 400, code: "bad_builder" });
}

export function registerBuilder(def) {
  if (!def || typeof def !== "object") throw bad("A builder needs a definition.");
  const id = String(def.id || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw bad("A builder id uses lowercase letters, numbers, and dashes.");
  if (!def.title || !def.summary) throw bad(`${id} needs a title and a summary.`);
  if (def.group !== "web" && def.group !== "marketing") throw bad(`${id} group must be web or marketing.`);
  if (!["free", "pro", "extreme"].includes(def.tier)) throw bad(`${id} tier must be free, pro, or extreme.`);
  const steps = def.steps || BUILDER_STEPS;
  if (steps.join(",") !== BUILDER_STEPS.join(",")) throw bad(`${id} must use Describe, Preview, Build, Test, and Publish.`);
  if (!def.detect || typeof def.detect !== "object") throw bad(`${id} needs a detect block.`);
  if (!Array.isArray(def.tools) || !def.tools.length) throw bad(`${id} needs at least one tool.`);
  const stored = { ...def, id, steps: [...BUILDER_STEPS] };
  builders.set(id, stored);
  return stored;
}

export function unregisterBuilder(id) {
  builders.delete(id);
}

export function clearBuilders() {
  builders.clear();
}

export function listBuilders() {
  return [...builders.values()];
}

export function getBuilder(id) {
  return builders.get(String(id || "")) || null;
}

export function includesPhrase(text, phrase) {
  const t = String(text || "").toLowerCase();
  const p = String(phrase || "").toLowerCase().trim();
  if (!p || !t) return false;
  if (p.includes(" ")) return t.includes(p);
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(t);
}

function projectBlob(project) {
  return `${project?.name || ""} ${project?.summary || ""} ${project?.categories || ""}`.toLowerCase();
}

export function matchBuilder(builder, signals = {}) {
  const detect = builder.detect || {};
  const connectors = signals.connectors instanceof Set
    ? signals.connectors
    : new Set((signals.connectors || []).map((c) => String(c).toLowerCase()));
  for (const name of detect.connectors || []) {
    if (connectors.has(String(name).toLowerCase())) return `${connectorLabel(name)} is connected`;
  }
  for (const project of signals.projects || []) {
    const kind = String(project?.kind || "").toLowerCase();
    if ((detect.projectKinds || []).some((k) => k === kind)) return `You have a ${kind} project`;
    const blob = projectBlob(project);
    for (const phrase of detect.projectWords || []) {
      if (includesPhrase(blob, phrase)) return `A project mentions ${phrase}`;
    }
  }
  const text = String(signals.text || "");
  for (const phrase of detect.words || []) {
    if (includesPhrase(text, phrase)) return `You mentioned ${phrase}`;
  }
  return null;
}

export function connectorLabel(id) {
  const names = {
    netlify: "Netlify",
    vercel: "Vercel",
    instagram: "Instagram",
    meta: "Instagram",
    tiktok: "TikTok",
    facebook: "Facebook",
    linkedin: "LinkedIn",
    x: "X",
    twitter: "X",
    youtube: "YouTube",
    highlevel: "HighLevel",
    ghl: "HighLevel",
    postiz: "Postiz",
    listmonk: "listmonk",
    mautic: "Mautic",
  };
  return names[String(id || "").toLowerCase()] || String(id || "A service");
}

export function publicBuilder(builder, reason = null) {
  return {
    id: builder.id,
    title: builder.title,
    group: builder.group,
    summary: builder.summary,
    tier: builder.tier,
    steps: builder.steps,
    tools: (builder.tools || []).map((tool) => ({
      name: tool.name,
      license: tool.license,
      how: tool.how,
    })),
    reason: reason || null,
    suggested: !!reason,
  };
}

export function suggestBuilders(signals = {}, defs = listBuilders()) {
  const out = [];
  for (const builder of defs) {
    const reason = matchBuilder(builder, signals);
    if (reason) out.push(publicBuilder(builder, reason));
  }
  return out;
}

// Workstream B: each file in the extras folder exports
//   export async function register({ registerBuilder }) {}
export async function loadBuilderExtras(dir, api = { registerBuilder }) {
  if (!dir || !fs.existsSync(dir)) return [];
  const loaded = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".js")).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    if (typeof mod.register === "function") await mod.register(api);
    loaded.push(file);
  }
  return loaded;
}
