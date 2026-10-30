// Step guard (0.4.21, dogfood fixes). Pure checks on what an AI sent back for one mission step.
//  - empty, refused, cut off, or about a different business than the task: a failure, never "done"
//  - truncated code: detected here, continued by the mission with a bigger output cap
//  - search leaks: "[1]" citations and "the supplied search results" are removed when search was not asked for
//  - the file name a task asks for ("save as index.html"), so the result can really be written to disk
// No network, no state. The only disk use is stat on a file path (onDisk, diskLine, diskCheck). Every function is safe to call with odd input.
import fs from "node:fs";
import path from "node:path";

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
// 0.4.21 (dogfood 13): a drawing job (quote card, banner, poster) or a page build searches only when the person says so.
// "latest", "online", "competitors" in the brief of a landing page are part of the page's words, not a search request.
const SEARCH_SAID = /\b(search(\s+the)?\s+(web|online|internet)|web search|search for|google|look\s*up|look it up|find online|browse|with sources|cite)\b/i;
const DRAW_OR_PAGE = /\b(?:build|make|create|design|write|draw|generate|produce|render)\b[^.\n]{0,60}?\b(?:landing\s*page|web\s*page|website|home\s*page|one[- ]page|single[- ]page|html\s*page|quote\s*card|text\s*card|social\s*card|banner|poster|flat\s*graphic|graphic|thumbnail)\b|\bindex\.html\b/i;
/** A pure drawing job or page build. */
export function isDrawingOrPageJob(goal) { return DRAW_OR_PAGE.test(String(goal || "")); }
/** Did the person ask for live information? Only then does a mission search the web on its own. */
export function wantsSearch(goal) { return isDrawingOrPageJob(goal) ? SEARCH_SAID.test(String(goal || "")) : SEARCH_ASK.test(String(goal || "")); }

const LEAK_SENTENCE = /[^.!?\n]*\b(supplied|provided|given|above)\s+(search\s+)?(results|sources)\b[^.!?\n]*[.!?]?/gi;
/** Remove "[1]" / "[1][4]" / "[1, 4]" citations and sentences about "the supplied search results", leaving code blocks, inline code, and array indexers untouched. */
export function stripSearchLeaks(text) {
  const original = String(text ?? "");
  if (!original) return clean(original);

  // We need to protect:
  // 1. Fenced code blocks (``` ... ```)
  // 2. Indented code blocks (4+ spaces or a tab at line start after a blank line or start of text)
  // 3. Inline code (`...`)
  // 4. Bracket numbers directly attached to an identifier or closing bracket/paren with no space before it (like argv[2], a[0], row[1][2]).
  
  // Let's tokenize or placeholderize protected regions.
  const placeholders = [];
  function addPlaceholder(content) {
    const id = `__STEPGUARD_CODE_${placeholders.length}__`;
    placeholders.push({ id, content });
    return id;
  }

  // First pass: protect fenced code blocks
  let t = original.replace(/```[\s\S]*?```/g, (match) => addPlaceholder(match));

  // Second pass: protect inline code
  t = t.replace(/`[^`\n]*`/g, (match) => addPlaceholder(match));

  // Third pass: protect indented code blocks.
  // An indented code block is lines starting with 4+ spaces or a tab, following a blank line or start of text.
  // Let's process line by line or via regex.
  const lines = t.split("\n");
  let inIndentedBlock = false;
  const processedLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlank = line.trim() === "";
    const isIndented = /^(?: {4,}|\t)/.test(line);
    const prevBlank = i === 0 || lines[i - 1].trim() === "";

    if (isIndented && (prevBlank || inIndentedBlock)) {
      inIndentedBlock = true;
      processedLines.push(addPlaceholder(line));
    } else {
      if (isBlank) {
        inIndentedBlock = false;
      } else if (!isIndented) {
        inIndentedBlock = false;
      }
      processedLines.push(line);
    }
  }
  t = processedLines.join("\n");

  // Now clean prose outside protected areas:
  // 1. LEAK_SENTENCE
  t = t.replace(LEAK_SENTENCE, "");

  // 2. Citations: a marker after a space or sentence punctuation is a citation; a bracket number glued to a
  // word, ")" or "]" (argv[2], a[0], row[1][2]) is an index and stays.
  t = t.replace(/(\s?)((?:\[\s?\d{1,2}(?:\s?[,–-]\s?\d{1,2})*\s?\])+)/g, (m, ws, _marks, off, str) => (!ws && off > 0 && /[\w\])]/.test(str[off - 1]) ? m : ""));

  // 3. Double spaces and trailing whitespace outside code.
  t = t.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");

  // Restore placeholders
  for (const p of placeholders.reverse()) {
    // Escape special regex replacement characters like $ in p.content
    t = t.replace(p.id, () => p.content);
  }

  return t.trim() === clean(original).trim() ? clean(original) : t.trim();
}

// ---------- the real disk check (0.4.21, dogfood 14) ----------
// Every "saved" the app shows or QA reads comes from stat on the file, never from an AI's words.
/** { exists, bytes } for a path: a real file with at least one byte. */
export function onDisk(file) {
  try { const st = fs.statSync(file); return st.isFile() && st.size > 0 ? { exists: true, bytes: st.size } : { exists: false, bytes: 0 }; } catch { return { exists: false, bytes: 0 }; }
}
/** "quote-card.png: exists, 1234 bytes" or "quote-card.png: missing". */
export function diskLine(file, label) {
  const c = file ? onDisk(file) : { exists: false };
  return `${label || path.basename(String(file || "file"))}: ${c.exists ? `exists, ${c.bytes} bytes` : "missing"}`;
}
/** For a step that names files: the disk line for each, and which are missing. writes: [{ name, path }] the app wrote. */
export function diskCheck(wanted = [], writes = []) {
  const lines = [], missing = [];
  for (const n of wanted) {
    const w = (writes || []).find((x) => x && path.basename(String(x.name || x.path || "")).toLowerCase() === path.basename(n).toLowerCase());
    const line = diskLine(w?.path, n);
    lines.push(line);
    if (!w?.path || !onDisk(w.path).exists) missing.push(n);
  }
  return { lines, missing, ok: missing.length === 0 };
}

// ---------- removed APIs (0.4.21, dogfood 13) ----------
// A plan wrote Pillow code that called ImageDraw.textsize, which Pillow 10 removed. The code-writing instructions say not
// to, and a step whose code still calls it is flagged with a plain note.
export const NO_REMOVED_APIS_LINE = "Never use PIL ImageDraw.textsize or font.getsize: Pillow 10 removed them. Use draw.textbbox (or font.getbbox) to measure text.";
const TEXTSIZE = /\.\s*textsize\s*\(/;
/** Notes for code that calls an API that no longer exists. Empty when the text is clean. */
export function removedApiNotes(text) {
  const t = String(text || "");
  return TEXTSIZE.test(t) ? ["This code calls .textsize(, which Pillow 10 removed. Use textbbox to measure text."] : [];
}

// ---------- named files ----------
// 0.4.27 (dogfood batch 2): scripts (.ps1, .bat, .cmd, .sh, .sql) count too, every named file is found (not only the
// first), a full Windows path gives its file name, and "Node.js" is a product, not a file.
export const SAVABLE_EXT = ["html", "htm", "md", "markdown", "css", "js", "mjs", "cjs", "ts", "json", "txt", "csv", "py", "yml", "yaml", "xml", "svg", "ps1", "bat", "cmd", "sh", "sql"];
// Word and Excel files are made by server/office-files.js (when that module is there); they are named files too
export const OFFICE_EXT = ["xlsx", "xlsm", "docx"];
const EXT_ALT = [...SAVABLE_EXT, ...OFFICE_EXT].sort((a, b) => b.length - a.length).join("|");
const FILE_TOKEN = new RegExp(`(?<![\\w.-])([A-Za-z0-9][\\w.-]{0,80}\\.(?:${EXT_ALT}))(?![\\w-])`, "gi");
const SAVE_WORD = /\b(?:save|saved|saving|write|writes|export|name|named|call|called|put|store|output|as|into|to|file(?:name)?)\b[^.\n]{0,40}$/i;
const PRODUCT = /^(?:node|next|nuxt|vue|react|express|three|d3|chart|p5|socket|alpine|ember|backbone|jquery|angular|nest|deno|bun|electron|svelte|astro|remix|gatsby|meteor)\.(?:js|ts)$/i;
const notAFile = (n) => /^(?:www|e\.g|i\.e|etc)\./i.test(n) || /^(?:\d+\.)+\d+$/.test(n) || PRODUCT.test(n) || /\.\./.test(n);
/** Can this name be saved as a file (a text, code or script file)? Word and Excel files only with office: true. */
export function isSavableName(name, { office = false } = {}) {
  const e = fileExt(name);
  return SAVABLE_EXT.includes(e) || (office && OFFICE_EXT.includes(e));
}
/** Every file name a task asks for, in the order they appear: ["invoice_totals.py", "invoices.csv"]. */
export function namedFiles(goal) {
  const g = String(goal || "").replace(/https?:\/\/\S+/gi, " ").replace(/\b[\w.-]+@[\w-]+(?:\.[\w-]+)+\b/g, " ");
  const out = [];
  for (const m of g.matchAll(FILE_TOKEN)) {
    const name = m[1].replace(/\.+$/, "").replace(/\.markdown$/i, ".md");
    if (!fileExt(name) || notAFile(name) || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, saveWord: SAVE_WORD.test(g.slice(Math.max(0, m.index - 60), m.index)) });
    if (out.length >= 8) break;
  }
  return out.map((o) => o.name);
}
/** The file name a task asks for, or "". Looks for "save as index.html", "as campaign.md", "a single index.html". */
export function namedFile(goal) {
  const g = String(goal || "").replace(/https?:\/\/\S+/gi, " ");
  const names = namedFiles(g);
  if (!names.length) return "";
  // the first one that follows a save word ("save it as x"), else the first one named at all
  for (const m of g.matchAll(FILE_TOKEN)) {
    const n = m[1].replace(/\.+$/, "").replace(/\.markdown$/i, ".md");
    if (names.includes(n) && SAVE_WORD.test(g.slice(Math.max(0, m.index - 60), m.index))) return n;
  }
  return names[0];
}

// ---------- plan steps that only save a file (0.4.27, dogfood batch 2) ----------
// "Save CSV to the specified file path", "Save script to the Desktop path": no AI can write to the disk, QA then
// failed the step ("says it saved but nothing was saved") and almost every mission ended with errors. Meldmind
// saves every named file itself at the end, so such a step is never planned, and one that slips through is dropped.
export const NO_SAVE_STEP_LINE = `\nNever plan a step whose only job is to save, write, copy, move or export a file to the disk, a folder, a path or the Desktop: no AI can do that, and Meldmind saves every named file itself at the end. The step that makes a file outputs its full contents in a code block with the file name on the line just above it (for example **invoices.csv**). A step that runs the tests or runs a script is fine.`;
// 0.4.27: what a step that makes a named file is told, so the app finds the file's body in its answer
export const FILE_BLOCK_LINE = "Put each file's full contents in its own code block, with the file name alone on the line just above the block (for example **invoice_totals.py**). Do not say you saved or ran anything: Meldmind saves the files itself.";
const SAVE_VERB =/^\s*(?:(?:then|finally|lastly|and)\s+)?(?:save|saves|saving|copy|copies|store|persist)\b/i;
const WRITE_TO_DISK = /^\s*(?:(?:then|finally|lastly|and)\s+)?(?:write|writes|writing)\b[^.\n]*\b(?:to|into|in|at|on)\s+(?:the\s+|a\s+|your\s+|my\s+)?(?:disk|desktop|folder|directory|path|file\s*path|location|drive|[a-z]:\\)/i;
const SAVE_WHERE = new RegExp(`\\b(?:to|into|in|at|as|on|under)\\b[^.\\n]*(?:\\b(?:disk|desktop|folders?|director(?:y|ies)|paths?|file\\s*path|location|drive|files?|file\\s*names?)\\b|[a-z]:\\\\|\\.(?:${EXT_ALT})\\b)`, "i");
const OTHER_WORK = /\b(?:run|runs|execute|test|tests|build|create|generate|draft|design|fix|compute|calculate|convert|compile|review|check|validate|verify|write\s+(?:the\s+)?(?:code|script|content|copy|text)|format|summari[sz]e|analy[sz]e|zip|upload|send|email|post|publish)\b/i;
const OUTSIDE_PLACE = /\b(?:mind\s?-?media|library|google\s+drive|g\s?drive|drive\s+folder|dropbox|one\s?drive|icloud|github|git\b|repo|notion|gmail|email|sheets?|docs\b|website|server|s3|bucket|cloud)\b/i;
const MAKES_CONTENT = /\b(?:write|draft|compose|generate|come up with|brainstorm|list|create|make|add)\s+(?!(?:it|them|this|that|everything|(?:the|a|your|my)\s+(?:final\s+)?(?:file|files|script|csv|page|html|folder|folders|directory|path|result|output)|(?:any\s+)?(?:missing\s+)?(?:folders?|director(?:y|ies)|paths?))\b)/i;
const REFERS_EARLIER = /\b(?:from|of|in|by)\s+(?:step\s+)?t\d+\b|\bt\d+'s\b|\b(?:final|validated|verified|reviewed|corrected|approved|finished|previous|earlier|above)\b/i;
/** True for a plan step whose only job is to put a file on the disk. MindMedia, Drive and run steps are not. */
export function isSaveOnlyStep(t = {}) {
  if (!t || typeof t !== "object" || t.capability === "save" || t.capability === "media") return false;
  const title = String(t.title || "").trim();
  if (!title) return false;
  if (OUTSIDE_PLACE.test(`${title} ${t.instructions || ""}`)) return false;
  if (OTHER_WORK.test(title.replace(SAVE_VERB, ""))) return false;
  // it must have something earlier to save, and must not make new content itself ("write three ideas and save them as x.md")
  if (!(Array.isArray(t.deps) && t.deps.length)) return false;
  if (MAKES_CONTENT.test(String(t.instructions || "")) && !REFERS_EARLIER.test(String(t.instructions || ""))) return false;
  if (WRITE_TO_DISK.test(title)) return true;
  return SAVE_VERB.test(title) && SAVE_WHERE.test(title);
}
/**
 * Drop save-only steps from a plan. A step that waited on a dropped step waits on what the dropped step waited on.
 * Never empties a plan. Returns { plan, dropped: [titles] }.
 */
export function dropSaveOnlySteps(plan) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const drop = tasks.filter(isSaveOnlyStep);
  if (!drop.length || drop.length >= tasks.length) return { plan, dropped: [] };
  const gone = new Map(drop.map((t) => [t.id, Array.isArray(t.deps) ? t.deps : []]));
  const resolve = (d, seen = new Set()) => (gone.has(d) && !seen.has(d) ? (seen.add(d), gone.get(d).flatMap((x) => resolve(x, seen))) : [d]);
  const kept = tasks.filter((t) => !gone.has(t.id)).map((t) => ({ ...t, deps: [...new Set((Array.isArray(t.deps) ? t.deps : []).flatMap((d) => resolve(d)))].filter((d) => !gone.has(d) && d !== t.id) }));
  return { plan: { ...plan, tasks: kept }, dropped: drop.map((t) => t.title) };
}

// An AI may write "Saved as index.html (project root)" about a file it cannot write. Those lines are removed;
// the real result (path, or "not saved") is shown by the app from what was actually written.
export function stripSaveClaims(text) {
  return clean(text).replace(/^[ \t>*_#-]*(?:\*\*)?status:?\s*(?:\*\*)?\s*not saved\b[^\n]*\n?/gim, "").replace(/^[ \t>*_#-]*(?:saved as|file(?:s)? (?:has been |was |were )?(?:saved|written|created)|(?:i\s+)?(?:have\s+)?(?:saved|wrote|written|created) (?:the |your |it )?(?:file |image |png |svg )?(?:as|to|in|at)|saved to|saved in|saved at|output (?:file )?(?:saved|written)|save (?:it|this|the file) (?:to|in|as))\b[^\n]*\n?/gim, "").replace(/\n{3,}/g, "\n\n").trim();
}

// 0.4.21 (dogfood 08): a step must not run on an earlier step that failed or came back empty. Running it on
// "(missing)" made the last step redo the earlier work and bill it twice. Returns the earlier steps that are
// missing (title and id). A step still waiting on an agent or on a media OK is not missing: its result comes later.
export function missingInputs(t, tasks = [], outputs = {}) {
  const out = [];
  for (const d of (t && Array.isArray(t.deps) ? t.deps : [])) {
    const dep = (tasks || []).find((x) => x && x.id === d);
    if (!dep || dep.status === "waiting" || dep.media) continue;
    const text = outputs[d] ?? dep.output;
    if (dep.status === "failed" || !String(text || "").trim()) out.push({ id: dep.id, title: dep.title || dep.id });
  }
  return out;
}
export function inputMissingLine(missing = []) {
  const names = missing.map((m) => `"${m.title}"`).join(" and ");
  return `Input missing: ${names} did not come back, so this step was not run and nothing was charged for it. Press Try again to run ${missing.length > 1 ? "those steps" : "that step"} first.`;
}

// ---------- claims with no proof (0.4.21, dogfood 12) ----------
// QA passed steps that said "saved" and showed "test output" when nothing was written or run. A step's own words are
// compared with the tool records kept for it: a claim needs a record. Code inside fences is ignored (a test file
// that prints "All tests passed" is not a claim).
const NEGATED = /\b(?:not|never|nothing|no|n't|unable to|cannot|can't|couldn't)\b[^.\n]{0,30}\b(?:saved?|written|write|created?|run|ran)\b/i;
// the words of a step without its code blocks and without lines that say a file was NOT saved or a test was NOT run
function noFences(text) {
  const out = [];
  let fence = null;
  for (const line of clean(text).split("\n")) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) { fence = fence && f[1][0] === fence[0] ? null : fence || f[1]; continue; }
    if (!fence && !NEGATED.test(line)) out.push(line);
  }
  return out.join("\n");
}
const SAVE_CLAIM = /\b(?:saved|wrote|written|created)\b[^.\n]{0,40}\b(?:the file|a file|files?|[\w-]+\.(?:js|mjs|cjs|ts|py|json|html?|css|md|txt)|to disk|in place)\b|\bfile\s+(?:has been\s+|was\s+)?(?:saved|written|created)\b/i;
const RUN_CLAIM = /\btests?\s+(?:all\s+)?passed\b|\ball\s+(?:\d+\s+)?tests?\s+pass(?:ed)?\b|\b\d+\s*(?:of\s*\d+\s*)?tests?\s+pass(?:ed)?\b|^[ \t>*#_-]*test output\b[ \t*_]*:|^[ \t>*#_-]*test output[ \t*_]*$/im;
const isWrite = (r) => !!r && r.ok !== false && /write|save|create_file|edit|patch|put_file/i.test(String(r.tool || ""));
const isRun = (r) => !!r && r.ok !== false && /^(run|exec|shell|bash|run_command|run_tests?)$|^run[_-]/i.test(String(r.tool || ""));
/**
 * Does a step claim a save or a test run that no tool record backs up? records: the tool calls kept for this step
 * ({ tool: "write_file" | "run" ... }). Returns { ok, kind: "save" | "run" | "", reason }.
 */
export function claimCheck(text, records = []) {
  const prose = noFences(text);
  const list = Array.isArray(records) ? records : [];
  if (SAVE_CLAIM.test(prose) && !list.some(isWrite)) return { ok: false, kind: "save", reason: "Says it saved a file, but nothing was saved." };
  if (RUN_CLAIM.test(prose) && !list.some(isRun)) return { ok: false, kind: "run", reason: "Shows test output, but no tests were run." };
  return { ok: true, kind: "", reason: "" };
}
