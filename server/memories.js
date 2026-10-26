// Memories (0.4.21): what Meldmind remembers about you and your projects, across chats.
// Local only: one document "memories" in the app data folder (hosted: the person's own user_docs row).
// Three buckets, like Jack Roberts' levels: About me (global), This project, Knowledge.
// Each memory: id, text, bucket, projectId, importance 1 to 5 (5 = starred, kept), source, createdAt.
// Saved automatically when a message states something lasting, or on "remember that ..." / "forget ...".
// Recalled before each task and added to the prompt of every AI the job is split across (see
// project-memory.js withMemory / contextFor, which call recallBlock).
// Never stored: passwords, API keys or tokens, SSNs, card numbers, bank account numbers.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { listProjects } from "./projects.js";

export const KIND = "memories";
export const VEC_KIND = "memories.vec";
export const BUCKETS = ["about-me", "project", "knowledge"];
export const BUCKET_LABELS = { "about-me": "About me", project: "This project", knowledge: "Knowledge" };
// the header the recalled block starts with; a prompt that already carries it is not given a second copy
export const MARKER = "WHAT I REMEMBER";
export const MAX_TEXT = 300;
export const MAX_ITEMS = 500;
export const REFUSAL = "I will not remember passwords or account numbers.";
export const NEEDS_KEY = "Needs a key";

const data = () => doc(KIND, () => ({ enabled: true, smarter: false, items: [] }));
const save = () => putDoc(KIND, data());
const STOP = new Set("a an and are as at be but by for from has have i if in into is it its me my of on or our so than that the their them then there these they this to up was we were what when which who will with you your about can do does did how not just like make need please write".split(" "));

// ---------- secrets: never stored ----------
const SECRET_WORDS = /\b(?:passwords?|passcodes?|passwd|pwd|pin\s*(?:code|number)|api[\s_-]?keys?|access[\s_-]?tokens?|auth(?:orization)?[\s_-]?tokens?|bearer\s+\S|secret[\s_-]?keys?|client[\s_-]?secret|private[\s_-]?keys?|seed\s+phrase|recovery\s+phrase|ssn|social\s+security|routing\s+number|account\s+number|acct\s*(?:no|number|#)|card\s+number|credit\s+card|debit\s+card|cvv|cvc|security\s+code|iban)\b/i;
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{10,}/, /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/, /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{12,}/, /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b\d{3}-\d{2}-\d{4}\b/,
];
function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
export function looksSecret(text) {
  const t = String(text || "");
  if (SECRET_WORDS.test(t)) return true;
  if (SECRET_SHAPES.some((re) => re.test(t))) return true;
  for (const m of t.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) return true; }
  if (/\b(?:account|acct|routing)\b[^.\n]{0,25}\b\d{6,}\b/i.test(t)) return true;
  // a long mixed letters-and-digits string with no spaces looks like a key
  for (const m of t.matchAll(/\b[A-Za-z0-9_-]{32,}\b/g)) if (/[A-Za-z]/.test(m[0]) && /\d/.test(m[0])) return true;
  return false;
}

// ---------- words ----------
const stem = (w) => w.replace(/(?:ing|ed|es|s)$/i, "");
export function tokens(text) {
  return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [])]
    .filter((w) => w.length > 2 && !STOP.has(w)).map(stem).filter((w) => w.length > 1);
}
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function overlap(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
const clip = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
const known = (pid) => !!pid && listProjects().some((p) => p.id === pid);

// ---------- store ----------
export function isOn() { return data().enabled !== false; }
export function setOn(on) { const d = data(); d.enabled = !!on; save(); return d.enabled; }
export function list({ bucket, projectId } = {}) {
  let items = data().items;
  if (bucket) items = items.filter((m) => m.bucket === bucket);
  if (projectId !== undefined && projectId !== null) items = items.filter((m) => m.projectId === projectId);
  return items.map((m) => ({ ...m })).sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);
}
export const get = (id) => data().items.find((m) => m.id === id) || null;

// Adds a memory. Returns { ok, memory, duplicate } or { ok:false, refused, message }.
export function add({ text, bucket, projectId = null, importance, source = "settings" } = {}) {
  const clean = clip(text);
  if (!clean) return { ok: false, error: "Write what to remember." };
  if (looksSecret(clean)) return { ok: false, refused: true, message: REFUSAL };
  const b = BUCKETS.includes(bucket) ? bucket : (projectId ? "project" : "about-me");
  const pid = b === "project" ? (projectId || null) : null;
  if (b === "project" && !pid) return { ok: false, error: "Pick a project for a This project memory." };
  const d = data();
  const same = d.items.find((m) => m.bucket === b && m.projectId === pid && (norm(m.text) === norm(clean) || overlap(m.text, clean) >= 0.85 && overlap(clean, m.text) >= 0.85));
  if (same) {
    if (importance) same.importance = Math.max(same.importance, Math.min(5, Math.max(1, +importance || 1)));
    save();
    return { ok: true, memory: { ...same }, duplicate: true };
  }
  const imp = Math.min(5, Math.max(1, Math.round(+importance || 3)));
  const memory = { id: "m-" + crypto.randomBytes(5).toString("hex"), text: clean, bucket: b, projectId: pid, importance: imp, source: String(source).slice(0, 40), createdAt: Date.now() };
  d.items.push(memory);
  if (d.items.length > MAX_ITEMS) {
    // drop the oldest least important memory that is not starred
    const victim = d.items.filter((m) => m.importance < 5).sort((a, b2) => a.importance - b2.importance || a.createdAt - b2.createdAt)[0];
    if (victim) d.items = d.items.filter((m) => m.id !== victim.id);
  }
  save();
  return { ok: true, memory: { ...memory } };
}

export function update(id, patch = {}) {
  const m = get(id);
  if (!m) return { ok: false, status: 404, error: "That memory is gone." };
  if (typeof patch.text === "string") {
    const clean = clip(patch.text);
    if (!clean) return { ok: false, status: 400, error: "Write what to remember." };
    if (looksSecret(clean)) return { ok: false, status: 400, refused: true, message: REFUSAL, error: REFUSAL };
    m.text = clean;
  }
  if (BUCKETS.includes(patch.bucket)) {
    m.bucket = patch.bucket;
    if (patch.bucket !== "project") m.projectId = null;
  }
  if (m.bucket === "project" && patch.projectId !== undefined && known(patch.projectId)) m.projectId = patch.projectId;
  if (m.bucket === "project" && !m.projectId) return { ok: false, status: 400, error: "Pick a project for a This project memory." };
  if (patch.importance !== undefined) m.importance = Math.min(5, Math.max(1, Math.round(+patch.importance || 3)));
  if (patch.starred === true) m.importance = 5;
  if (patch.starred === false && m.importance === 5) m.importance = 3;
  save();
  dropVec(id);
  return { ok: true, memory: { ...m } };
}

export function remove(id) {
  const d = data();
  const n = d.items.length;
  d.items = d.items.filter((m) => m.id !== id);
  if (d.items.length === n) return false;
  save(); dropVec(id);
  return true;
}
export function clearAll() { const d = data(); const n = d.items.length; d.items = []; save(); putDoc(VEC_KIND, {}); return n; }

// ---------- remember / forget by chat or voice ----------
const FIRST = /\b(?:i|i'm|i've|i'd|i'll|me|my|mine|myself)\b/i;
const TEAM = /\b(?:we|we're|our|ours|us|this project|the project|my client|our client|the client|brand|campaign|website|store|shop)\b/i;
function pickBucket(text, projectId) {
  if (FIRST.test(text) && !/\b(?:my|our) (?:brand|client|website|store|shop|campaign|customers?|audience|product)\b/i.test(text)) return "about-me";
  if (projectId && (TEAM.test(text) || !FIRST.test(text))) return "project";
  if (FIRST.test(text)) return "about-me";
  return "knowledge";
}

// remember(text): "remember that X", "remember: X" or plain X. The function the voice worker calls.
export function remember(text, { projectId = null, source = "chat", bucket, importance } = {}) {
  if (!isOn()) return { ok: false, off: true, message: "Memory is off. Turn it on in Settings > Memories." };
  let t = String(text || "").trim().replace(/^(?:please\s+)?(?:hey meld,?\s*)?(?:remember|don'?t forget|keep in mind|make a note)(?:\s+that)?[:,]?\s+/i, "").replace(/^note that\s+/i, "");
  t = t.replace(/[.!\s]+$/, "");
  const pid = known(projectId) ? projectId : null;
  const r = add({ text: t, bucket: bucket || pickBucket(t, pid), projectId: pid, importance: importance || 4, source });
  return r;
}

// forget(text): "forget that X", "forget about X", "forget X". Removes the memories that match best.
export function forget(text) {
  const t = String(text || "").trim().replace(/^(?:please\s+)?(?:hey meld,?\s*)?(?:forget|delete|remove)(?:\s+(?:that|about|the fact that|what i said about))?[:,]?\s+/i, "").replace(/[.!\s]+$/, "");
  if (!t) return { ok: false, error: "Say what to forget.", removed: [] };
  const d = data();
  const scored = d.items.map((m) => ({ m, s: Math.max(overlap(m.text, t), overlap(t, m.text) * 0.9) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
  if (!scored.length) return { ok: true, removed: [], message: "I did not find that in my memory." };
  const top = scored[0].s;
  const hits = scored.filter((x) => x.s >= Math.max(0.5, top - 0.15)).slice(0, 5).map((x) => x.m);
  for (const m of hits) remove(m.id);
  return { ok: true, removed: hits.map((m) => ({ ...m })) };
}

// ---------- auto-detect lasting statements ----------
const QUESTION = /^(?:who|what|when|where|why|how|which|can|could|would|should|do|does|did|is|are|am|will|may)\b/i;
const RULES = [
  { re: /^(?:please\s+)?(?:hey meld,?\s*)?(?:remember|don'?t forget|keep in mind)\b/i, importance: 4, explicit: true },
  { re: /^(?:from now on|going forward)[, ]/i, importance: 4 },
  { re: /\b(?:my|our)\s+(?:business|company|brand|agency|shop|store|firm|team|website|site|product|app|name|job|role|title|audience|customers?|clients?|niche|industry|voice|tone|style|goals?|mission|favorite [a-z]+|email signature)\s+(?:is|are|was|were|called|named)\b/i, importance: 3 },
  { re: /\bmy name is\b|\bcall me\b|\bi (?:live|work|am based|am located)\s+(?:in|at|for|near)\b|\bi work as\b/i, importance: 3 },
  { re: /\bi\s+(?:always|never|usually|prefer|really prefer|don'?t like|do not like|can'?t stand|hate)\b|\bi(?:'d| would) (?:rather|prefer)\b|\bi want (?:you|it|everything) to (?:always|never)\b/i, importance: 3 },
  { re: /^(?:please\s+)?(?:always|never)\s+\w+/i, importance: 4 },
  { re: /\bi(?:'m| am)\s+(?:a|an|the)\s+[a-z][a-z -]{2,40}?\s+(?:in|at|for|based|from|who|with)\b|\bi(?:'m| am)\s+(?:a|an|the)\s+(?:owner|founder|realtor|agent|broker|teacher|nurse|developer|designer|photographer|lawyer|accountant|coach|consultant|marketer|freelancer|student|writer|contractor|baker|chef|trainer)\b/i, importance: 3 },
];
const SKIP_ROLE = /\bi(?:'m| am)\s+(?:a|an|the)\s+(?:bit|little|lot|big fan|huge|beginner|newbie|new to|fan)\b/i;

function sentences(text) {
  return String(text || "").split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Looks at one message. Saves what it finds. Returns { saved:[memory], refused:bool, forgotten:[memory], duplicate:[memory] }.
export function autoRemember(prompt, { projectId = null, source = "chat" } = {}) {
  const out = { saved: [], duplicate: [], forgotten: [], refused: false, message: "" };
  if (!isOn()) return out;
  const text = String(prompt || "").slice(0, 4000);
  for (const s of sentences(text).slice(0, 12)) {
    if (/^(?:please\s+)?(?:hey meld,?\s*)?forget\b/i.test(s)) {
      const r = forget(s);
      out.forgotten.push(...(r.removed || []));
      continue;
    }
    if (/\?\s*$/.test(s) || (QUESTION.test(s) && !/^(?:please\s+)?remember/i.test(s))) continue;
    const rule = RULES.find((r) => r.re.test(s));
    // "my password is ..." or "remember my card number": say plainly that it is not kept
    if (!rule && looksSecret(s) && /\b(?:my|our|remember|keep|save|store)\b/i.test(s) && /\b(?:is|are|=|:)\b|remember|keep|save|store/i.test(s)) { out.refused = true; out.message = REFUSAL; continue; }
    if (!rule || SKIP_ROLE.test(s)) continue;
    if (s.length < 8) continue;
    if (looksSecret(s)) { out.refused = true; out.message = REFUSAL; continue; }
    if (out.saved.length + out.duplicate.length >= 3) break;
    const pid = known(projectId) ? projectId : null;
    const body = s.replace(/[.!\s]+$/, "");
    const res = rule.explicit ? remember(s, { projectId: pid, source }) : add({ text: body, bucket: pickBucket(body, pid), projectId: pid, importance: rule.importance, source });
    if (res.refused) { out.refused = true; out.message = REFUSAL; }
    else if (res.ok && res.duplicate) out.duplicate.push(res.memory);
    else if (res.ok) out.saved.push(res.memory);
  }
  return out;
}

// ---------- recall ----------
let cacheRank = new Map(); // query key -> { at, scores: Map(id -> cosine) } from "Smarter recall"
const cosKey = (q, pid) => crypto.createHash("sha1").update(`${pid || ""}|${q}`).digest("hex").slice(0, 16);

function candidates(projectId) {
  return data().items.filter((m) => m.bucket === "about-me" || m.bucket === "knowledge" || (m.bucket === "project" && projectId && m.projectId === projectId));
}

export function recall({ query = "", projectId = null, limit = 8 } = {}) {
  if (!isOn()) return [];
  const cand = candidates(projectId);
  if (!cand.length) return [];
  const smart = cacheRank.get(cosKey(query, projectId))?.scores;
  const now = Date.now();
  const scored = cand.map((m) => {
    const ov = overlap(m.text, query);
    const ageDays = (now - m.createdAt) / 86400000;
    const recency = Math.max(0, 1 - ageDays / 90);
    let s = m.importance * 2 + ov * 4 + recency + (m.bucket === "project" ? 1 : m.bucket === "about-me" ? 0.5 : 0);
    if (smart?.has(m.id)) s += Math.max(0, smart.get(m.id)) * 6;
    return { m, s, ov };
  });
  // few memories: all of them ride along. Many: starred ones, keyword matches and the most important.
  let pool = scored;
  if (scored.length > limit) pool = scored.filter((x) => x.m.importance >= 5 || x.ov > 0 || x.m.importance >= 4 || (smart?.get(x.m.id) || 0) > 0.3);
  return pool.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m);
}

export function recallBlock(query, projectId, { limit = 8 } = {}) {
  const items = recall({ query, projectId, limit });
  if (!items.length) return "";
  const proj = listProjects().find((p) => p.id === projectId);
  const sect = (b, title) => {
    const rows = items.filter((m) => m.bucket === b).map((m) => `- ${m.text}`);
    return rows.length ? `${title}:\n${rows.join("\n")}` : "";
  };
  const parts = [sect("about-me", "About the user"), sect("project", `This project${proj ? ` (${proj.name})` : ""}`), sect("knowledge", "Knowledge")].filter(Boolean);
  return `${MARKER} (saved by the user; use it quietly, follow it over generic defaults, do not repeat it back unless asked):\n${parts.join("\n\n")}`.slice(0, 2400);
}
export const hasBlock = (text) => String(text || "").includes(MARKER);

// ---------- Smarter recall (optional, needs an OpenAI or Gemini key) ----------
let embedderHook = null; // tests set { available(), embed(texts) } so no network is touched
export function setEmbedderHook(h) { embedderHook = h; cacheRank = new Map(); }
async function realEmbedder() {
  const L = await import("./libraries.js");
  const e = L.embedderChoices().filter((x) => x.keyed && !x.capped && !x.custom && !x.demo && ["openai", "google"].includes(x.provider)).sort((a, b) => a.per1M - b.per1M)[0];
  return e ? { available: true, embed: async (texts) => (await L.embed(e, texts, { role: "memory-recall" })).vectors } : { available: false };
}
export async function embedderState() {
  if (embedderHook) return { available: !!embedderHook.available(), embed: embedderHook.embed };
  try { return await realEmbedder(); } catch { return { available: false }; }
}
export async function smarterState() {
  const e = await embedderState();
  const on = data().smarter === true && e.available;
  return { on, available: e.available, label: "Smarter recall (uses your OpenAI or Gemini key)", note: e.available ? "" : NEEDS_KEY };
}
export async function setSmarter(on) {
  const e = await embedderState();
  if (on && !e.available) return { ok: false, error: NEEDS_KEY };
  const d = data(); d.smarter = !!on; save();
  return { ok: true, on: d.smarter };
}
const vecDoc = () => doc(VEC_KIND, () => ({}));
function dropVec(id) { const v = vecDoc(); if (v[id]) { delete v[id]; putDoc(VEC_KIND, v); } }
const cosine = (a, b) => { let s = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]; return s; };

// Called (awaited) by the run routes before the prompt is built, so the sync recall can use the ranking.
export async function warm(query, projectId) {
  try {
    if (!isOn() || data().smarter !== true || !String(query || "").trim()) return false;
    const e = await embedderState();
    if (!e.available) return false;
    const cand = candidates(projectId);
    if (!cand.length) return false;
    const vecs = vecDoc();
    const missing = cand.filter((m) => !vecs[m.id]);
    const texts = [String(query).slice(0, 1000), ...missing.map((m) => m.text)];
    const out = await e.embed(texts);
    missing.forEach((m, i) => { vecs[m.id] = out[i + 1]; });
    if (missing.length) putDoc(VEC_KIND, vecs);
    const scores = new Map(cand.map((m) => [m.id, vecs[m.id] ? cosine(out[0], vecs[m.id]) : 0]));
    cacheRank.set(cosKey(query, projectId), { at: Date.now(), scores });
    if (cacheRank.size > 50) cacheRank.delete(cacheRank.keys().next().value);
    return true;
  } catch { return false; }
}

// ---------- the list the Settings screen shows ----------
export function overview(projectId = null) {
  const d = data();
  return { enabled: d.enabled !== false, buckets: BUCKET_LABELS, items: list(), count: d.items.length, projectId };
}
