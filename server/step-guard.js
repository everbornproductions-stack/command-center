// Step guard (0.4.21, dogfood fixes). Pure checks on what an AI sent back for one mission step.
//  - empty, refused, cut off, or about a different business than the task: a failure, never "done"
//  - truncated code: detected here, continued by the mission with a bigger output cap
//  - search leaks: "[1]" citations and "the supplied search results" are removed when search was not asked for
//  - the file name a task asks for ("save as index.html"), so the result can really be written to disk
// No network, no disk, no state. Every function is safe to call with odd input.

export const CODE_TOKEN_CAP = 8000; // output cap for a code or file step (was 2500)
export const WORK_TOKEN_CAP = 2500;
export const MAX_CONTINUES = 3;

const STOP_WORDS = new Set(("about above after again all also and any are because been before being between both but can could did does doing down during each few for from further had has have having her here him his how into its itself just more most must not now off once only other our out over own same she should some such than that the their them then there these they this those through too under until very was were what when where which while who whom why will with would you your write make create build need needs needed using use used please one two three four five six seven eight nine ten each every item items step steps task tasks output deliverable include includes including short long good great clear simple plain").split(/\s+/));

const clean = (s) => String(s ?? "").replace(/\r\n/g, "\n");

// ---------- empty / refused ----------
export function isEmptyOutput(text) {
  const t = clean(text).replace(/[\s​]+/g, " ").trim();
  if (!t) return true;
  if (t.length < 2) return true;
  return /^(null|undefined|\(?no (output|content|response)\)?|\.\.\.|-+)$/i.test(t);
}

const REFUSAL_RES = [
  /^\s*\[?\s*[\w .-]{0,40}declined this request/i,
  /\(safety refusal\)/i,
  /^\s*(i('| a)m sorry,? but i can('|no)t|i can('|no)t (help|assist|comply) with|i('| a)m (unable|not able) to (help|assist|comply|provide|do that)|sorry,? i can('|no)t|i won('|')t be able to (help|assist)|as an ai( language model)?,? i (can('|no)t|am unable))/i,
  /^\s*i (must|have to) (decline|refuse)/i,
];
export function isRefusal(text) {
  const t = clean(text).trim();
  if (!t) return false;
  // a long, useful answer that merely mentions an apology is not a refusal
  if (t.length > 1200 && !/declined this request|safety refusal/i.test(t.slice(0, 200))) return false;
  return REFUSAL_RES.some((re) => re.test(t.slice(0, 400)));
}
export function refusalReason(text) {
  const t = clean(text).replace(/\s+/g, " ").trim();
  const m = /\[?([^\]]{0,80}declined this request[^\]]{0,80})\]?/i.exec(t);
  return (m ? m[1] : t.slice(0, 160)).trim();
}

// ---------- truncated ----------
const CODE_EXT = new Set(["html", "htm", "css", "js", "mjs", "json", "xml", "svg", "ts", "py", "md", "txt", "csv", "yml", "yaml"]);
export function fileExt(name) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}
function countOf(text, re) { return (text.match(re) || []).length; }
function stripStrings(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, "");
}
/**
 * Does this look cut off? Returns { truncated, reason }.
 * stop: the provider's stop reason ("length" and "max_tokens" mean the token limit was hit).
 * ext: the file type the step makes, when known (html, css, js, json, md ...).
 */
export function checkTruncation(text, { stop = null, ext = "", capability = "" } = {}) {
  const t = clean(text);
  const trimmed = t.trimEnd();
  if (!trimmed) return { truncated: false, reason: "" };
  const s = String(stop || "").toLowerCase();
  if (s === "length" || s === "max_tokens" || s === "max_output_tokens") return { truncated: true, reason: "The AI hit its output limit and stopped mid-answer." };
  // a code fence that never closes
  const fences = countOf(t, /^\s*(```|~~~)/gm);
  if (fences % 2 === 1) return { truncated: true, reason: "A code block was never closed." };
  // html: must end the document
  const lower = t.toLowerCase();
  const isHtml = ext === "html" || ext === "htm" || /<!doctype html|<html[\s>]/.test(lower);
  if (isHtml) {
    if (/<html[\s>]/.test(lower) && !/<\/html\s*>/.test(lower)) return { truncated: true, reason: "The page stops before </html>." };
    for (const tag of ["style", "script", "body", "head"]) {
      const open = countOf(lower, new RegExp(`<${tag}[\\s>]`, "g")), close = countOf(lower, new RegExp(`</${tag}\\s*>`, "g"));
      if (open > close) return { truncated: true, reason: `A <${tag}> section is never closed.` };
    }
  }
  // an open tag at the very end
  if (/<[a-z][^<>]*$/i.test(trimmed) && (isHtml || CODE_EXT.has(ext))) return { truncated: true, reason: "The last tag is cut off." };
  // braces in css, js, json and code
  // braces only count for a named code file: guessing at "code" in general would cut a finished answer short
  if (["css", "js", "mjs", "ts", "json"].includes(ext)) {
    let body = t;
    // only look inside code blocks when the answer is a mix of prose and code
    const blocks = [...t.matchAll(/```[^\n]*\n([\s\S]*?)(?:```|$)/g)].map((m) => m[1]);
    if (blocks.length) body = blocks.join("\n");
    const code = stripStrings(body);
    const open = countOf(code, /\{/g), close = countOf(code, /\}/g);
    if (open - close >= 1 && (ext !== "" || blocks.length || /[;{}]\s*$/.test(code.trim()) || open - close >= 2)) return { truncated: true, reason: "A { block is never closed." };
    const po = countOf(code, /\(/g), pc = countOf(code, /\)/g);
    if (po - pc >= 2) return { truncated: true, reason: "A ( group is never closed." };
  }
  if (ext === "json" || /^\s*[{[]/.test(trimmed) && ext === "") {
    if (ext === "json") { try { JSON.parse(trimmed); } catch { return { truncated: true, reason: "The JSON is cut off." }; } }
  }
  // ends in the middle of a statement or a word (code only: prose can end any way)
  if (CODE_EXT.has(ext) && !["md", "txt", "csv"].includes(ext)) {
    const last = trimmed.split("\n").pop().trim();
    if (/[,=(+\-*/&|:]$/.test(last) && !/^\s*(\/\/|#|\*)/.test(last)) return { truncated: true, reason: "The last line stops mid-statement." };
  }
  return { truncated: false, reason: "" };
}

// the last good chunk to hand back to the AI so it can carry on
export function continuePrompt(text, ext = "") {
  const tail = clean(text).slice(-1200);
  return `Your answer was cut off. Carry on from exactly where it stopped. Output ONLY the missing rest${ext ? ` of the ${ext} file` : ""}, starting with the very next character after this ending, with no repeats, no explanation and no new code fence unless you are inside one:\n\n--- END OF WHAT YOU WROTE ---\n${tail}\n--- CONTINUE FROM HERE ---`;
}
// glue a continuation onto the text: drop an overlap the AI repeated
export function joinContinuation(base, extra) {
  let a = clean(base), b = clean(extra);
  b = b.replace(/^\s*```[a-z0-9]*\n/i, (m) => (a.split("```").length % 2 === 0 ? "" : m)); // a fence reopened inside an open fence
  const max = Math.min(a.length, b.length, 400);
  for (let n = max; n >= 20; n--) { if (a.endsWith(b.slice(0, n))) { b = b.slice(n); break; } }
  return a + b;
}

// ---------- on brief ----------
function words(text) {
  return (clean(text).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).filter((w) => !STOP_WORDS.has(w));
}
function properNouns(text) {
  const out = new Set();
  for (const m of clean(text).matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-zA-Z0-9&'-]{2,}(?:\s+[A-Z][a-zA-Z0-9&'-]{2,})*)/gm)) {
    for (const part of m[1].split(/\s+/)) if (!STOP_WORDS.has(part.toLowerCase()) && part.length >= 3) out.add(part.toLowerCase());
  }
  return out;
}
const WRONG_BUSINESS = [
  ["cafe", /\b(caf[eé]|coffee shop|barista|pastr(?:y|ies)|espresso|latte)\b/i],
  ["restaurant", /\b(restaurant|menu special|our chef|diners?)\b/i],
  ["gym", /\b(gym|fitness studio|workout class|personal trainer)\b/i],
  ["salon", /\b(hair salon|nail salon|barber ?shop|spa day)\b/i],
  ["bakery", /\b(bakery|sourdough|cupcakes?)\b/i],
];
/**
 * Is this output about the job it was asked for? Returns { onBrief, reason }.
 * It compares the output with the goal, the step's title and instructions. It only fails an output that is
 * clearly about something else: the brand or topic words are missing AND another kind of business is named
 * that the task never mentioned, or almost none of the task's words appear at all.
 */
export function checkOnBrief(text, { goal = "", title = "", instructions = "", deliverable = "", context = "" } = {}) {
  const out = clean(text);
  if (out.trim().length < 120) return { onBrief: true, reason: "" };
  const brief = [goal, title, instructions, deliverable, context].join("\n");
  const outLower = out.toLowerCase();
  const briefLower = brief.toLowerCase();
  // 1. a kind of business the task never named
  for (const [name, re] of WRONG_BUSINESS) {
    if (re.test(out) && !re.test(brief)) {
      const hits = (out.match(new RegExp(re.source, "gi")) || []).length;
      const names = [...properNouns(goal), ...properNouns(title)].filter((n) => !["instagram", "facebook", "linkedin", "tiktok", "youtube", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(n));
      const mentionsBrand = names.some((n) => outLower.includes(n));
      if (hits >= 2 && !mentionsBrand) return { onBrief: false, reason: `This is about a ${name}, but the task is about something else.` };
    }
  }
  // 2. very little overlap with the task's own words
  const want = [...new Set(words([goal, title, instructions].join(" ")))];
  if (want.length >= 6) {
    const have = new Set(words(out));
    const hit = want.filter((w) => have.has(w) || have.has(w.replace(/s$/, "")) || have.has(`${w}s`)).length;
    const ratio = hit / want.length;
    const nouns = [...properNouns(goal)].filter((n) => !["instagram", "facebook", "linkedin", "tiktok", "youtube"].includes(n));
    const brandHit = nouns.length ? nouns.some((n) => outLower.includes(n)) : true;
    if (ratio < 0.12 && !brandHit && out.length > 300) return { onBrief: false, reason: "The answer does not mention anything from the task." };
  }
  return { onBrief: true, reason: "" };
}

// ---------- all of it ----------
/** One verdict for a step's output. kind: ok | empty | refusal | truncated | off-brief */
export function judgeStep(text, { goal, title, instructions, deliverable, context, stop, ext, capability } = {}) {
  if (isEmptyOutput(text)) return { ok: false, kind: "empty", reason: "The AI sent back nothing." };
  if (isRefusal(text)) return { ok: false, kind: "refusal", reason: `The AI refused: ${refusalReason(text)}` };
  const tr = checkTruncation(text, { stop, ext, capability });
  if (tr.truncated) return { ok: false, kind: "truncated", reason: tr.reason };
  const br = checkOnBrief(text, { goal, title, instructions, deliverable, context });
  if (!br.onBrief) return { ok: false, kind: "off-brief", reason: br.reason };
  return { ok: true, kind: "ok", reason: "" };
}

// ---------- search leaks ----------
const SEARCH_ASK = /\b(search|google|look\s*up|look it up|find online|on the web|web search|online|browse|latest|current(ly)?|news|trending|today'?s|this week|right now|up[- ]to[- ]date|competitors?|market research|statistics|stats|price of|how much (does|is)|who (is|are) the (best|top)|cite|sources?|with links?)\b/i;
/** Did the person ask for live information? Only then does a mission search the web on its own. */
export function wantsSearch(goal) { return SEARCH_ASK.test(String(goal || "")); }

const LEAK_SENTENCE = /[^.!?\n]*\b(supplied|provided|given|above)\s+(search\s+)?(results|sources)\b[^.!?\n]*[.!?]?/gi;
/** Remove "[1]" / "[1][4]" / "[1, 4]" citations and sentences about "the supplied search results". */
export function stripSearchLeaks(text) {
  let t = clean(text);
  t = t.replace(LEAK_SENTENCE, "");
  t = t.replace(/(?:\s?\[\s?\d{1,2}(?:\s?[,–-]\s?\d{1,2})*\s?\])+/g, "");
  t = t.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");
  return t.trim() === clean(text).trim() ? clean(text) : t;
}

// ---------- named files ----------
const NAMED_RE = /\b(?:save|saved|write|export|name|call|put|store|output|as|into|to|file(?:name)?|named)\b[^.\n]{0,40}?\b([A-Za-z0-9][\w-]{0,60}\.(?:html?|md|markdown|css|js|mjs|json|txt|csv|py|ya?ml|xml|svg))\b/i;
const ANY_FILE_RE = /\b([A-Za-z0-9][\w-]{0,60}\.(?:html?|md|markdown|css|js|mjs|json|txt|csv|py|ya?ml|xml|svg))\b/i;
/** The file name a task asks for, or "". Looks for "save as index.html", "as campaign.md", "a single index.html". */
export function namedFile(goal) {
  const g = String(goal || "");
  const m = NAMED_RE.exec(g) || ANY_FILE_RE.exec(g);
  if (!m) return "";
  const name = m[1].replace(/\.markdown$/i, ".md");
  return /^(?:www|e\.g|i\.e)\./i.test(name) ? "" : name;
}

// An AI may write "Saved as index.html (project root)" about a file it cannot write. Those lines are removed;
// the real result (path, or "not saved") is shown by the app from what was actually written.
export function stripSaveClaims(text) {
  return clean(text).replace(/^[ \t>*_#-]*(?:saved as|file saved|saved to|saved in|save (?:it|this|the file) (?:to|in|as))\b[^\n]*\n?/gim, "").replace(/\n{3,}/g, "\n\n").trim();
}
