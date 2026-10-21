// Test with personas (0.4.14). The Meldmind persona panel (the 18 people Chris reviews every release
// with, docs: persona-feedback/PANEL.md) reads any output: a chat answer, a mission result, a draft, a
// post, a page, or a design brief. Each picked persona reacts in their own words and suggests fixes.
// Apply (one fix) or Apply all makes a revised output. Reactions are simulated by an AI and say so.
//
//  - The smart default picks the personas who fit the output type, plus anyone whose field the text
//    touches (mortgage wording brings Ray, credit repair brings Tasha, and so on). The person can pick
//    their own instead.
//  - One model call reads the output for the whole panel (cheaper than one call per persona), one call
//    applies fixes. Both go through smart fallback and the ledger like every other call.
//  - Nothing is sent or posted. The revised text comes back to the screen.

export const PANEL = [
  { id: "dana", name: "Dana", who: "48, owns a two-location bakery, not technical", cares: "weekly social posts and review replies that sound like a real local business" },
  { id: "marcus", name: "Marcus", who: "39, solo insurance agent", cares: "compliance, accurate claims, and keeping client data private" },
  { id: "priya", name: "Priya", who: "31, full-stack developer", cares: "technical accuracy, control, and code that actually runs" },
  { id: "jordan", name: "Jordan", who: "44, owns a 6-person marketing agency with 12 clients", cares: "client-ready work, clear next steps, and saving his team time" },
  { id: "leo", name: "Leo", who: "20, college student on a tight budget", cares: "short, useful answers and no hidden costs" },
  { id: "sofia", name: "Sofia", who: "35, freelance designer on a Mac", cares: "visual quality, layout, and good taste" },
  { id: "helen", name: "Helen", who: "56, family-law attorney, privacy first", cares: "confidentiality, careful wording, and nothing that could be taken the wrong way" },
  { id: "ray", name: "Ray", who: "52, real estate and mortgage broker", cares: "fair-housing and RESPA-safe wording" },
  { id: "tasha", name: "Tasha", who: "41, runs a credit repair business", cares: "CROA-safe claims: no promises of results or score changes" },
  { id: "kai", name: "Kai", who: "27, tech YouTuber with 180k subscribers", cares: "hooks, titles, thumbnails, and whether people keep watching" },
  { id: "walt", name: "Walt", who: "71, retired machinist, not technical, small text is hard", cares: "big clear words and short steps he can follow" },
  { id: "nadia", name: "Nadia", who: "38, ops manager at a 20-person HVAC company", cares: "clear steps, owners, dates, and something she can hand to her boss" },
  { id: "elena", name: "Elena", who: "33, freelance brand designer with 8 clients", cares: "polished, on-brand deliverables she would show a client" },
  { id: "derek", name: "Derek", who: "29, B2B field sales rep who lives on his phone", cares: "short messages that get replies and read well on a phone" },
  { id: "carla", name: "Carla", who: "52, runs a home cleaning business and has used ChatGPT about five times", cares: "plain words with no jargon, and no surprise costs" },
  { id: "jaylen", name: "Jaylen", who: "24, gamer and modder who streams, not a coder", cares: "speed, fun, and anything that feels slow, confusing, or cringe" },
  { id: "priya-n", name: "Priya Natarajan", who: "31, indie app developer", cares: "code quality, licenses, and whether this saves a real developer time" },
  { id: "dorothy", name: "Dorothy", who: "74, retired, has barely used technology", cares: "plain words, big clear steps, and whether she could follow it without help" },
];
const BY_ID = new Map(PANEL.map((p) => [p.id, p]));
export const personaById = (id) => BY_ID.get(String(id || "")) || null;

// Output types and the plain label the screen shows ("a post", "a page").
export const KINDS = {
  chat: { label: "an answer", panel: ["dorothy", "carla", "helen"] },
  mission: { label: "a mission result", panel: ["nadia", "jordan", "dorothy"] },
  report: { label: "a report", panel: ["nadia", "marcus", "dorothy"] },
  draft: { label: "a draft", panel: ["helen", "derek", "carla"] },
  email: { label: "an email", panel: ["derek", "helen", "dana"] },
  post: { label: "a post", panel: ["dana", "kai", "jordan"] },
  page: { label: "a page", panel: ["dorothy", "carla", "elena"] },
  design: { label: "a design", panel: ["elena", "sofia", "kai"] },
  script: { label: "a script", panel: ["kai", "jaylen", "dana"] },
  code: { label: "code", panel: ["priya", "priya-n", "jaylen"] },
};
export const MAX_PERSONAS = 6;
export const MAX_TEXT = 20000;

// Fields the text touches bring the persona who knows them.
const TOPICS = [
  [/\b(mortgage|real estate|realtor|listing|home ?buyer|escrow|respa|fair housing)\b/i, "ray"],
  [/\b(credit repair|credit score|dispute letter|croa|credit report)\b/i, "tasha"],
  [/\b(insurance|policy ?holder|premium|carrier|coverage|claim)\b/i, "marcus"],
  [/\b(attorney|lawyer|legal|contract|custody|divorce|confidential)\b/i, "helen"],
  [/\b(youtube|tiktok|reels?|shorts|thumbnail|subscribers)\b/i, "kai"],
  [/\b(hvac|technician|dispatch|sop|work order)\b/i, "nadia"],
];

// A good guess at the output type when the caller did not say.
export function guessKind(text) {
  const t = String(text || "");
  if (/```|\bfunction\s*\(|=>|\bconst\s+\w+\s*=|<\/?(div|script|style)\b/i.test(t) && !/<html|<body/i.test(t)) return "code";
  if (/<html|<body|^#\s.*\n[\s\S]*\b(home page|landing page|hero|call to action|cta)\b/im.test(t)) return "page";
  if (/^subject:/im.test(t)) return "email";
  if (/\b(hook|b-roll|on-screen text|voiceover)\b/i.test(t)) return "script";
  if (/\b(aspect ratio|image prompt|thumbnail|layout:|color palette|hex)\b/i.test(t)) return "design";
  if (/#\w+/.test(t) && t.length < 1500) return "post";
  return "chat";
}
export const normalizeKind = (kind, text) => (KINDS[kind] ? kind : guessKind(text));

// The smart default: the panel for this kind, then topic experts, at most 4.
export function smartPick(kind, text = "") {
  const k = normalizeKind(kind, text);
  const out = [...KINDS[k].panel];
  for (const [re, id] of TOPICS) if (re.test(String(text || "").slice(0, MAX_TEXT)) && !out.includes(id)) out.push(id);
  return out.slice(0, 4);
}

// The people for this test: the person's own picks (known ids only), else the smart default.
export function pickPanel({ kind, text, personas } = {}) {
  const own = Array.isArray(personas) ? [...new Set(personas.map(String))].filter((id) => BY_ID.has(id)).slice(0, MAX_PERSONAS) : [];
  return own.length ? { ids: own, smart: false } : { ids: smartPick(kind, text), smart: true };
}

export function panelView() {
  return {
    personas: PANEL.map((p) => ({ id: p.id, name: p.name, who: p.who, cares: p.cares })),
    kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, panel: v.panel }])),
    max: MAX_PERSONAS,
    note: "Persona reactions are simulated by an AI.",
  };
}

// ---------- prompts ----------
export function testSystem(ids, kind) {
  const people = ids.map((id) => BY_ID.get(id)).map((p) => `- ${p.id}: ${p.name}, ${p.who}. Cares about ${p.cares}.`).join("\n");
  return `Meldmind persona test: you play a review panel of real-sounding people reading ${KINDS[kind]?.label || "an output"} made by an AI for a small business owner.
The panel:
${people}

For each persona, react the way they would, in their own voice (1 to 3 sentences), give a score from 1 (would not use it) to 5 (would use it as is), and suggest up to 3 specific fixes. A fix says exactly what to change in the output, so another AI can apply it. Do not invent facts about the business. Plain words, no em-dashes.
Reply as JSON only:
{"reactions":[{"id":"<persona id>","reaction":"...","score":4,"fixes":[{"fix":"...","why":"..."}]}]}
JSON only.`;
}
export const FIX_SYSTEM = `Meldmind persona fixes: revise the output below by applying only the listed fixes. Keep everything else the same: the facts, the format, the length unless a fix says otherwise, and any [bracket] blanks. Do not add facts. Return only the revised output, with no preamble and no notes.`;

export function fixPrompt(text, fixes) {
  return `FIXES TO APPLY:\n${fixes.map((f, i) => `${i + 1}. ${f.fix}${f.by ? ` (from ${f.by})` : ""}`).join("\n")}\n\nOUTPUT TO REVISE:\n${text}`;
}

// ---------- parsing ----------
const clip = (s, n) => String(s ?? "").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, n);
function jsonFrom(text) {
  const t = String(text || "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
// Reactions in panel order; a persona the model skipped says so instead of vanishing.
export function parseReactions(text, ids) {
  const data = jsonFrom(text);
  const rows = Array.isArray(data?.reactions) ? data.reactions : [];
  return ids.map((id) => {
    const p = BY_ID.get(id);
    const r = rows.find((x) => String(x?.id || "").toLowerCase() === id) || rows.find((x) => String(x?.name || x?.id || "").toLowerCase() === p.name.toLowerCase());
    if (!r) return { id, name: p.name, who: p.who, reaction: "", score: null, fixes: [], missing: true };
    const score = Math.round(Number(r.score));
    const fixes = (Array.isArray(r.fixes) ? r.fixes : []).map((f) => (typeof f === "string" ? { fix: f } : f)).map((f, i) => ({ id: `${id}-${i + 1}`, fix: clip(f?.fix, 400), why: clip(f?.why, 300), by: p.name })).filter((f) => f.fix).slice(0, 3);
    return { id, name: p.name, who: p.who, reaction: clip(r.reaction, 600), score: score >= 1 && score <= 5 ? score : null, fixes };
  });
}
// Fixes to apply, cleaned (the client sends back the ones the person clicked).
export function cleanFixes(list) {
  return (Array.isArray(list) ? list : []).map((f) => (typeof f === "string" ? { fix: f } : f)).map((f) => ({ fix: clip(f?.fix, 400), by: clip(f?.by, 60) })).filter((f) => f.fix).slice(0, 20);
}
// The revised text without a code fence or a "Here is" line the model may wrap it in.
export function cleanRevision(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1];
  return t.replace(/^(here is|here's) (the )?revised[^\n]*\n+/i, "").trim();
}
