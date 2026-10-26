// Chat history and reuse (0.4.21). Every chat, council and mission is already saved as data/missions/<id>.json
// the moment it starts, and again as it changes. This module is the plain-words view of that: a searchable,
// newest-first list with readable titles, "Do this again" and "Change and redo" bodies, quick picks for the
// start box, and a small search that Memories (or anything else) can call to recall past work.
// Per-person extras (pinned, hidden, renamed) live in one versioned document, "chathist", in the app data
// folder, so they survive a restart and an update. Nothing here sends, posts or spends by itself.
import { doc, putDoc } from "./store.js";
import { isInternalPrompt, repeatBody } from "./desk.js";

export const HISTORY_FORMAT = "meldmind-chat-history";
export const HISTORY_VERSION = 1;
export const KINDS = ["single", "council", "mission", "imported"];
const KIND_WORD = { single: "Chat", council: "Council", mission: "Mission", imported: "Imported" };

// ---- the versioned extras document ----
const strMap = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => typeof k === "string" && typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 120)]));
const idList = (a) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === "string" && x))].slice(0, 2000);
// An older, newer or damaged document never throws: unknown fields are kept, known ones are repaired.
export function normalizeDoc(d) {
  const src = d && typeof d === "object" ? d : {};
  return { ...src, format: HISTORY_FORMAT, version: Math.max(HISTORY_VERSION, Number(src.version) || 0), pinned: idList(src.pinned), hidden: idList(src.hidden), titles: strMap(src.titles) };
}
export function extras() {
  const raw = doc("chathist", () => normalizeDoc(null));
  const n = normalizeDoc(raw);
  if (raw.format !== n.format || !Array.isArray(raw.pinned) || !Array.isArray(raw.hidden) || raw.titles == null) putDoc("chathist", n);
  return n;
}
function change(fn) { const d = extras(); fn(d); putDoc("chathist", d); return d; }
export const pin = (id, on = true) => change((d) => { d.pinned = on ? idList([id, ...d.pinned]) : d.pinned.filter((x) => x !== id); });
export const hide = (id, on = true) => change((d) => { d.hidden = on ? idList([id, ...d.hidden]) : d.hidden.filter((x) => x !== id); });
export const rename = (id, title) => change((d) => { const t = String(title || "").trim().slice(0, 120); if (t) d.titles[id] = t; else delete d.titles[id]; });

// ---- plain titles ----
export function plainTitle(text, max = 64) {
  let t = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(please|pls|hey|hi|hello|can you|could you|would you|i want you to|i need you to|i need|i want)\b[,:\s]*/i, "").trim();
  if (!t) return "Untitled chat";
  t = t[0].toUpperCase() + t.slice(1);
  if (t.length <= max) return t.replace(/[.\s]+$/, "") || t;
  const cut = t.slice(0, max); const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,.;:\s]+$/, "") + "...";
}
const snippet = (text, max) => { const t = String(text || "").trim(); return t ? plainTitle(t, max) : ""; };
const promptOf = (m) => String(m.prompt || m.goal || "").trim();
export function titleOf(m, titles = {}) {
  if (titles[m.id]) return titles[m.id];
  if (m.kind === "imported") return String(m.title || "Imported chat").slice(0, 120);
  return plainTitle(m.title || promptOf(m));
}

const eligible = (m) => m && m.id && KINDS.includes(m.kind) && !isInternalPrompt(m.title) && !isInternalPrompt(m.prompt) && !isInternalPrompt(m.goal);
const answerOf = (m) => String(m.kind === "council" ? m.verdict?.text || m.deliverable || "" : m.deliverable || "");

// A compact row for the list. Search text is kept off the row (it is only used to match).
export function rowOf(m, ex) {
  const at = Number(m.finishedAt || m.startedAt || 0);
  return {
    id: m.id, kind: m.kind, kindWord: KIND_WORD[m.kind] || "Chat",
    title: titleOf(m, ex.titles), at, startedAt: Number(m.startedAt || 0),
    status: m.status || "", private: !!m.private, projectId: m.projectId || null,
    pinned: ex.pinned.includes(m.id), cost: Number(m.cost) || 0,
    preview: snippet(answerOf(m), 110),
    canRedo: !!promptOf(m) && m.kind !== "imported",
  };
}

// missions: full mission objects (store.listMissions(m => m)). Newest first, pinned on top.
export function listRows(missions, { q = "", limit = 60, projectId = "", includeHidden = false } = {}) {
  const ex = extras();
  const needle = String(q || "").trim().toLowerCase();
  const rows = [];
  for (const m of missions || []) {
    if (!eligible(m)) continue;
    if (!includeHidden && ex.hidden.includes(m.id)) continue;
    if (projectId && m.projectId !== projectId) continue;
    const row = rowOf(m, ex);
    if (needle) {
      const hay = `${row.title}\n${promptOf(m)}\n${answerOf(m).slice(0, 4000)}`.toLowerCase();
      if (!needle.split(/\s+/).every((w) => hay.includes(w))) continue;
    }
    rows.push(row);
  }
  rows.sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at));
  return rows.slice(0, Math.max(1, Math.min(500, Number(limit) || 60)));
}

// ---- reuse ----
// "Do this again" sends the same request. "Change and redo" sends it with the person's change added.
export function redoSpec(run, change) {
  const spec = repeatBody(run);
  if (spec.error) return spec;
  const note = String(change || "").trim().slice(0, 2000);
  if (note) {
    const key = spec.kind === "mission" ? "goal" : "prompt";
    spec.body[key] = `${spec.body[key]}\n\nChange this time: ${note}`;
    spec.changed = true;
  }
  return spec;
}

// ---- quick picks for the start box ----
// recent: the last distinct things asked. saved: the person's saved prompts. Picking one only fills the box.
export function quickPicks(missions, saved = [], { recentLimit = 6 } = {}) {
  const ex = extras();
  const seen = new Set(); const recent = [];
  for (const m of [...(missions || [])].filter(eligible).sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))) {
    if (m.kind === "imported" || m.private || ex.hidden.includes(m.id)) continue;
    const p = promptOf(m); const key = p.toLowerCase().replace(/\s+/g, " ");
    if (!p || p.length > 4000 || seen.has(key)) continue;
    seen.add(key); recent.push({ id: m.id, label: plainTitle(p, 48), text: p, kind: m.kind });
    if (recent.length >= recentLimit) break;
  }
  const savedRows = (saved || []).slice(0, 8).map((s) => ({ id: s.id, label: String(s.name || s.title || "Saved prompt").slice(0, 48), text: String(s.prompt || s.text || s.body || "").slice(0, 4000) })).filter((s) => s.text);
  return { recent, saved: savedRows };
}

// ---- the hook for Memories ----
// recallPast("sourdough bakery brand", missions) -> short plain snippets of earlier work. Private chats and imports
// are left out. K-mem's store can call this, or the route GET /api/chathist/recall; it works without Memories.
const STOP = new Set("the a an and or of to for in on with is are was be this that it my our your i you we me do make write give from about into".split(" "));
export function recallPast(query, missions, { limit = 5 } = {}) {
  const words = [...new Set(String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
  if (!words.length) return [];
  const ex = extras();
  const out = [];
  for (const m of missions || []) {
    if (!eligible(m) || m.private || ex.hidden.includes(m.id) || m.status === "failed") continue;
    const p = promptOf(m); const a = answerOf(m);
    const hay = `${p}\n${a.slice(0, 3000)}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    if (!hits) continue;
    const score = hits / words.length + (Number(m.startedAt || 0) / 1e15);
    out.push({ id: m.id, kind: m.kind, title: titleOf(m, ex.titles), at: Number(m.startedAt || 0), asked: p.slice(0, 240), answer: a.replace(/\s+/g, " ").trim().slice(0, 240), score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, limit).map(({ score, ...r }) => r);
}
export function recallText(query, missions, opts) {
  const hits = recallPast(query, missions, opts);
  return hits.length ? "Earlier work that may help:\n" + hits.map((h) => `- ${h.title}${h.answer ? `: ${h.answer}` : ""}`).join("\n") : "";
}

// Past work plus saved Memories in one block. Memories (server/memories.js, build K) is optional: when that file is
// not in this build, or is off, only the past-work part is returned. Nothing here writes a memory.
export async function recallAll(query, missions, { projectId = null, limit = 5 } = {}) {
  const past = recallText(query, missions, { limit });
  let memories = "";
  try {
    const M = await import("./memories.js");
    if (M.isOn?.() !== false) memories = String(M.recallBlock?.(query, projectId) || "");
  } catch { /* no Memories in this build */ }
  return { memories, past, text: [memories, past].filter(Boolean).join("\n\n") };
}
