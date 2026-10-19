// Keyword intent match for Pro prompts. No embeddings.
// A strong phrase can auto-apply. A weaker hit is only a suggestion.
// The caller may pass an LLM ask() when the heuristic is unsure.

const AUTO = 4;
const SUGGEST = 2;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scoreTemplate(template, text) {
  const hay = String(text || "");
  const low = hay.toLowerCase();
  let score = 0;
  const hits = [];
  const name = String(template.name || "").toLowerCase();
  if (name && name.length > 4 && low.includes(name)) { score += 6; hits.push(template.name); }
  for (const phrase of template.phrases || []) {
    const p = String(phrase || "").toLowerCase().trim();
    if (p && low.includes(p)) { score += 4; hits.push(phrase); }
  }
  for (const word of template.words || []) {
    const w = String(word || "").trim();
    if (!w) continue;
    if (new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(hay)) { score += 1; hits.push(word); }
  }
  return { id: template.id, name: template.name, category: template.category, score, hits };
}

export function heuristicMatch(text, templates) {
  const ranked = (templates || []).map((t) => scoreTemplate(t, text)).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const second = ranked[1]?.score || 0;
  if (!best) return { id: null, name: null, score: 0, confidence: 0, autoApply: false, suggest: false, source: "heuristic", alternatives: [] };
  const autoApply = best.score >= AUTO && best.score >= second + 2;
  const suggest = !autoApply && best.score >= SUGGEST;
  const confidence = Math.min(0.95, best.score / (best.score + second + 1));
  return {
    id: best.id, name: best.name, category: best.category, score: best.score, confidence: +confidence.toFixed(2),
    autoApply, suggest, source: "heuristic", hits: best.hits, alternatives: ranked.slice(1, 4).map((r) => ({ id: r.id, name: r.name, score: r.score })),
  };
}

function parsePick(raw, templates) {
  if (!raw) return null;
  const text = String(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j;
  try { j = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const id = String(j.id || j.template || "").trim();
  if (!id || id === "none") return null;
  const hit = (templates || []).find((t) => t.id === id);
  if (!hit) return null;
  return hit;
}

// ask(system, user) -> text. Used only when the heuristic is not confident.
export async function detectIntent(text, templates, { ask } = {}) {
  const h = heuristicMatch(text, templates);
  if (h.autoApply || h.suggest || !ask) return h;
  const brief = (templates || []).map((t) => `${t.id}: ${t.name}. ${t.description}`).join("\n");
  try {
    const raw = await ask(
      `Pick the one Pro prompt template that fits the user's task. Reply with JSON only: {"id":"<template id or none>","why":"<=12 words"}. Do not invent an id.`,
      `${String(text || "").slice(0, 2000)}\n\nTEMPLATES:\n${brief}`,
    );
    const hit = parsePick(raw, templates);
    if (!hit) return { ...h, fallback: "none" };
    return {
      id: hit.id, name: hit.name, category: hit.category, score: h.score, confidence: 0.7,
      autoApply: true, suggest: false, source: "router", hits: [], alternatives: h.alternatives || [],
    };
  } catch {
    return { ...h, fallback: "unavailable" };
  }
}
