// QA checks for mission steps (0.4.27, dogfood 2026-10-30). "QA could not check this step" showed on most
// steps in Max savings: the reviewers picked were Claude Code and Antigravity (whole agent runs that blew the
// 60 second check limit), and Claude's short JSON reply was sometimes cut off and thrown away as unreadable.
// A long deliverable was also cut at 12000 characters, so the reviewer reported a finished page as truncated.
//  - pickReviewers: fast API models first (free ones first in Max savings), another AI before a sibling model,
//    a slow agent app only as the very last try.
//  - parseVerdict: reads a verdict from strict JSON, JSON inside prose, a cut-off JSON reply or plain words.
//  - qaExcerpt: the whole output when it fits; else its start and its end, with a note that the middle exists.
// An unchecked step is still never counted as passed (server/mission.js).
import { extractJson } from "./providers.js";
import { isSlowAgent } from "./router.js";
import { costTier } from "./free-first.js";

export const QA_MAX_TOKENS = 1000; // was 500: six issues and a fix in JSON did not always fit
export const QA_MAX_REVIEWERS = 3;
const CHEAP_MODES = new Set(["savings", "economy", "speed"]);

// rankFn is the mission's own ranking (dead and skipped AIs already left out).
export function pickReviewers(rankFn, { mode = "savings", taskProvider = null, taskModel = null, skip = [], max = QA_MAX_REVIEWERS } = {}) {
  let ranked = [];
  try { ranked = rankFn({ capability: "analysis", difficulty: 2, mode, exclude: taskModel ? [taskModel] : [], small: true, longOutput: false }) || []; } catch { ranked = []; }
  const usable = ranked.filter((m) => m && m.provider && !skip.includes(m.provider));
  const fast = usable.filter((m) => !isSlowAgent(m));
  const slow = usable.filter((m) => isSlowAgent(m));
  const free = (m) => costTier(m.provider, m.model) <= 1;
  const other = (m) => m.provider !== taskProvider;
  const groups = CHEAP_MODES.has(mode)
    ? [fast.filter((m) => other(m) && free(m)), fast.filter((m) => !other(m) && free(m)), fast.filter((m) => other(m) && !free(m)), fast.filter((m) => !other(m) && !free(m))]
    : [fast.filter(other), fast.filter((m) => !other(m))];
  const out = [];
  const seen = new Set();
  let sibling = false;
  for (const g of groups) {
    for (const m of g) {
      if (out.length >= max) break;
      if (m.provider === taskProvider) { if (sibling) continue; sibling = true; out.push(m); continue; }
      if (seen.has(m.provider)) continue;
      seen.add(m.provider);
      out.push(m);
    }
  }
  // a slow agent app is a last try only, and only when fewer than two fast reviewers are left
  if (out.length < 2) {
    const s = slow.find((m) => m.provider !== taskProvider) || slow[0];
    if (s && out.length < max) out.push(s);
  }
  return out;
}

// What the reviewer reads. A long deliverable keeps its start and its end; the reviewer is told the middle exists.
export const QA_TEXT_LIMIT = 24000;
export function qaExcerpt(text, limit = QA_TEXT_LIMIT) {
  const s = String(text ?? "");
  if (s.length <= limit) return s;
  const head = Math.floor(limit * 0.65);
  const tail = limit - head;
  const left = s.length - head - tail;
  return `${s.slice(0, head)}\n\n[... ${left} characters from the middle are left out of this excerpt only to keep the check short. They are in the real output. Do not report them as missing, and do not call the output cut off unless its END below stops early ...]\n\n${s.slice(-tail)}`;
}

const firstNumber = (v) => { const n = Number.parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const asBool = (v) => (v === true || v === false ? v : /^\s*(true|yes|pass(ed)?)\s*$/i.test(String(v ?? "")) ? true : /^\s*(false|no|fail(ed)?)\s*$/i.test(String(v ?? "")) ? false : undefined);
const verdictOf = (j) => {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  if (!("pass" in j) && !("score" in j)) return null;
  const out = {};
  const p = asBool(j.pass);
  if (p !== undefined) out.pass = p;
  const sc = firstNumber(j.score);
  if (sc != null) out.score = Math.max(0, Math.min(10, sc));
  if (Array.isArray(j.issues)) out.issues = j.issues.map((x) => String(x)).filter(Boolean);
  if (j.fix != null && j.fix !== "") out.fix = String(j.fix);
  return "pass" in out || "score" in out ? out : null;
};
// every balanced {...} in the text, outermost first, strings respected
function objectsIn(s) {
  const found = [];
  for (let i = 0; i < s.length && found.length < 20; i++) {
    if (s[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === "\"") inStr = false; continue; }
      if (c === "\"") inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { found.push(s.slice(i, j + 1)); i = j; break; }
    }
  }
  return found;
}
// A verdict { pass?, score?, issues?, fix? } from whatever the reviewer sent back, or null when there is none.
export function parseVerdict(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const strict = verdictOf(extractJson(s));
  if (strict) return strict;
  for (const chunk of objectsIn(s)) { try { const v = verdictOf(JSON.parse(chunk)); if (v) return v; } catch { /* next */ } }
  // a JSON reply cut off at the token limit, or keys without quotes
  const out = {};
  const pm = /["']?pass["']?\s*[:=]\s*["']?(true|false|yes|no)\b/i.exec(s);
  if (pm) out.pass = /^(true|yes)$/i.test(pm[1]);
  const sm = /["']?score["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i.exec(s);
  if (sm) out.score = Math.max(0, Math.min(10, Number(sm[1])));
  // plain words: "PASS", "Verdict: fail", "Score: 8/10"
  if (!("pass" in out)) {
    const wm = /^\s*(?:\**\s*)?(?:verdict|result)?\s*[:\-]?\s*\**\s*(pass(?:ed)?|fail(?:ed)?)\b/im.exec(s);
    if (wm) out.pass = /^pass/i.test(wm[1]);
  }
  if (!("score" in out)) {
    const xm = /\b(\d+(?:\.\d+)?)\s*(?:\/|out of|of)\s*10\b/i.exec(s);
    if (xm) out.score = Math.max(0, Math.min(10, Number(xm[1])));
  }
  if (!("pass" in out) && !("score" in out)) return null;
  const im = /["']?issues["']?\s*:\s*\[([\s\S]*?)(?:\]|$)/i.exec(s);
  if (im) out.issues = [...im[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => m[1].replace(/\\"/g, "\"")).filter(Boolean);
  const fm = /["']?fix["']?\s*:\s*"((?:\\.|[^"\\])*)/i.exec(s);
  if (fm && fm[1].trim()) out.fix = fm[1].replace(/\\"/g, "\"");
  return out;
}
