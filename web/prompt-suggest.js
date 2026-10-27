import { isLocked } from "./tier-lock.js";
// What happens to the chat box when a suggestion is picked (0.4.17). Pure: no DOM, so the tests
// can call it. The person's words are never thrown away: a prompt's blank ([topic], [subject]...)
// is filled from what they typed, or the prompt is added after their words. Undo puts back the
// exact text they had.

export const MIN_CHARS = 3;
export const MAX_ROWS = 6;
// Turned off with the X under the list, back on in Settings. Per viewer, on this computer.
export const OFF_KEY = "cc.ppSuggestOff";

export function shouldSuggest(text) {
  return String(text || "").trim().length >= MIN_CHARS;
}

export function suggestionsOff(storage) {
  try { return storage?.getItem(OFF_KEY) === "1"; } catch { return false; }
}

export function setSuggestionsOff(storage, off) {
  try { if (off) storage?.setItem(OFF_KEY, "1"); else storage?.removeItem(OFF_KEY); } catch { /* storage can be off */ }
}

const SOURCE_LABEL = { pro: "Pro", industry: "Industry", weekly: "Weekly", saved: "Saved" };

export function sourceLabel(item) {
  return SOURCE_LABEL[item?.source] || (item?.kind === "template" ? "Pro" : "Weekly");
}

// The rows to draw: the action first, then at most MAX_ROWS prompts.
export function rowsFor(data) {
  const rows = [];
  if (data?.action) rows.push({ type: "action", label: data.action.label });
  for (const item of (data?.items || []).slice(0, MAX_ROWS)) rows.push({ type: "item", label: item.title, tag: sourceLabel(item), item });
  return rows;
}

// 0.4.22 (panel row 9): a Pro or Industry prompt is not offered to a Free viewer, so the list never teases
// something that then hits a lock. The action row and the weekly prompts stay.
export function rowsForTier(data, tier) {
  return rowsFor(data).filter((r) => r.type !== "item" || !(["Pro", "Industry"].includes(r.tag) && isLocked("pro", tier)));
}

const SUBJECT_KEYS = ["idea", "topic", "subject", "goal", "product", "offer", "business", "task", "situation", "brief", "notes", "text"];

// A Pro prompt keeps the typed words by filling one of its own fields with them.
export function templateInputs(item, typed, subject = "") {
  const mine = String(typed || "").trim();
  const fields = Array.isArray(item?.inputs) ? item.inputs : [];
  if (!mine || !fields.length) return { inputs: {}, field: null };
  const pick = fields.find((f) => SUBJECT_KEYS.includes(String(f.key || "").toLowerCase()))
    || fields.find((f) => f.required)
    || fields[0];
  const short = ["idea", "topic", "subject", "product", "offer", "business"].includes(String(pick.key || "").toLowerCase());
  return { inputs: { [pick.key]: short && subject ? subject : mine }, field: pick };
}

// Blanks that stand for the thing being made. The first of these is filled first.
const SUBJECT_BLANKS = ["subject", "topic", "idea", "piece", "source", "goal", "product", "offer", "issue", "thing", "business", "property", "code", "clause", "policy", "role", "numbers", "week"];

const BLANK = /\[([^\]\n]{1,40})\]|\{([^}\n]{1,40})\}/g;

export function blanksOf(prompt) {
  return [...String(prompt || "").matchAll(BLANK)].map((m) => ({ token: m[0], name: (m[1] || m[2] || "").trim().toLowerCase() }));
}

// Fill one blank with the subject. Other blanks stay for the person to fill.
export function fillBlanks(prompt, subject) {
  const text = String(prompt || "");
  const value = String(subject || "").trim();
  const blanks = blanksOf(text);
  if (!blanks.length || !value) return { text, filled: false };
  const pick = blanks.find((b) => SUBJECT_BLANKS.includes(b.name)) || blanks[0];
  return { text: text.replace(pick.token, value), filled: true };
}

// The new box text. typed is kept: either its subject fills the prompt and the full words follow,
// or the prompt goes after the words.
export function applySuggestion(typed, item, subject = "") {
  const mine = String(typed || "").trim();
  const prompt = String(item?.prompt || item?.title || "").trim();
  if (!prompt) return mine;
  if (!mine) return prompt;
  const { text, filled } = fillBlanks(prompt, subject || mine);
  if (filled) return text.includes(mine) ? text : `${text}\n\nIn my words: ${mine}`;
  return `${mine}\n\n${prompt}`;
}

// Undo keeps the exact text from before the pick, spaces and all.
export function undoState(before, after) {
  return { before: String(before ?? ""), after: String(after ?? "") };
}

export function undoText(state) {
  return state ? state.before : "";
}

const BETTER = {
  image: (s) => `Make an image of ${s}.\nStyle: [for example painted fantasy art, photo, or cartoon].\nMood and light: [for example bright and fun].\nShape: square.\nLeave out: text, logos, and watermarks.`,
  video: (s) => `Make a short video about ${s}.\nLength: about 15 seconds.\nLook: [style and colours].\nFirst shot: [what we see first].\nEnd on: [the last line or picture].`,
  voice: (s) => `Record a voiceover about ${s}.\nVoice: [warm, calm, or upbeat].\nLength: about 30 seconds.\nRead this script: [paste or write it].`,
  post: (s) => `Write one social post about ${s}.\nWho it is for: [your audience].\nPlatform: [Instagram, Facebook, or LinkedIn].\nLength: 2 to 3 short sentences, then 3 hashtags.\nDraft only. Do not post.`,
  email: (s) => `Write a short email about ${s}.\nTo: [name].\nWhat I want them to do: [the ask].\nTone: friendly and clear.\nUnder 120 words. Draft only. Do not send.`,
  ad: (s) => `Write an ad for ${s}.\nWho it is for: [customer].\nUse only these facts: [facts].\nGive 2 versions: one short, one longer. No made-up results.`,
  website: (s) => `Plan a simple website for ${s}.\nPages: Home, About, Contact.\nWho it is for: [customer].\nMain button: [book, call, or buy].\nGive the headline and 3 short sections for Home.`,
  document: (s) => `Write a document about ${s}.\nWho will read it: [reader].\nSections: [list them].\nLength: about one page. Mark anything you are not sure about.`,
  code: (s) => `Help with this code: ${s}.\nLanguage: [language].\nWhat it should do: [goal].\nWhat happens now: [error or result].\nExplain the fix in plain words, then show the smallest change.`,
  research: (s) => `Research ${s}.\nGive 5 key points with sources.\nMark anything you cannot check.\nEnd with one plain-words summary line.`,
};

// "Make it better": a stronger prompt built from the person's own words, offline and free.
// The original words stay at the end, so nothing they typed is lost.
export function makeBetter(typed, intent = null, subject = "") {
  const mine = String(typed || "").trim();
  if (!mine) return "";
  const s = String(subject || "").trim() || mine;
  const build = BETTER[intent];
  const body = build
    ? build(s)
    : `Goal: ${s}.\nWho it is for: [audience].\nFormat: [short list, a few paragraphs, or a table].\nLength: short.\nUse plain words and mark anything you are not sure about.`;
  return `${body}\n\nIn my words: ${mine}`;
}
