// 0.4.28 (dogfood loan-calc): an AI app on this PC (Claude Code, Codex, Gemini CLI, Antigravity) that answers
// "You've hit your session limit · resets 2:30pm (America/Los_Angeles)" is out of its plan for now. That is a limit,
// not a broken step: the app rests until the reset time it gave (else a few hours) and the next best AI takes the job.
// Pure helpers, no disk, no network.

export const LIMIT_REST_MS = 3 * 60 * 60 * 1000; // no reset time given: rest a few hours
const MAX_REST_MS = 8 * 24 * 60 * 60 * 1000;
const MIN_REST_MS = 60 * 1000;

// The wording the apps use for a used-up plan, session, quota or rate limit.
export const LIMIT_RE = /\b(?:session|usage|weekly|daily|monthly|hourly|5-hour|five-hour|plan|message|token|request|rate|quota|model) limits?\b(?! (?:is|was) (?:fine|ok))|\bhit (?:your|the) (?:\w+ )?limit\b|\blimit (?:reached|exceeded|hit)\b|\breached (?:your|the) (?:\w+ ){0,2}(?:limit|quota|cap)\b|\bquota (?:exceeded|reached|exhausted|limit)\b|\bexceeded (?:your|the) (?:\w+ ){0,2}quota\b|\bexhausted (?:your|the) (?:\w+ ){0,2}(?:quota|capacity|credits|limit)\b|\bresource[_ ]exhausted\b|\bout of (?:credits|quota|usage)\b|\btoo many requests\b|\b429\b|\bupgrade (?:your|to a) (?:plan|higher plan|pro)\b|\bcredit balance is too low\b|\bno (?:capacity|quota) (?:left|remaining|available)\b/i;

// A short reply that IS the limit line (the app printed it as its answer): stricter, so an answer about rate limits is not read as one.
export const SHORT_LIMIT_RE = /\b(?:hit|reached) (?:your|the) (?:\w+ ){0,2}(?:limit|quota)\b|\b(?:session|usage|weekly|daily|5-hour|five-hour|plan) limit (?:reached|hit|exceeded)\b|\bquota exceeded\b|\bresource_exhausted\b|\blimit reached\|\d{10}|\bexhausted your (?:\w+ ){0,2}(?:quota|capacity)\b/i;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

// Wall-clock parts of `now` in a time zone (the local zone when tz is empty or unknown).
function wallParts(now, tz) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
    const p = Object.fromEntries(f.formatToParts(new Date(now)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
    return { y: p.year, mo: p.month - 1, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  } catch {
    if (tz) return wallParts(now, "");
    const d = new Date(now);
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
  }
}
const to24 = (h, ampm) => { const a = String(ampm || "").toLowerCase(); let n = Number(h) % 12; if (!a) return Number(h) % 24; return a.startsWith("p") ? n + 12 : n; };
const clamp = (ms) => Math.min(MAX_REST_MS, Math.max(MIN_REST_MS, ms));

/**
 * When the limit ends, from the app's own words, or null when it gave no time.
 * Handles "resets 2:30pm (America/Los_Angeles)", "resets at 4pm", "resets Oct 31, 9am", "resets in 3h 12m",
 * "try again in 2 days 3 hours", "try again at 4:05 PM", and Claude Code's older "limit reached|1793400000".
 */
export function resetAtFrom(text, now = Date.now()) {
  const s = String(text || "");
  const epoch = /limit reached\|(\d{10,13})\b/i.exec(s);
  if (epoch) { const n = Number(epoch[1]); const at = n < 1e12 ? n * 1000 : n; if (at > now) return now + clamp(at - now); }
  // a length of time: "in 3h 12m", "in 2 days 3 hours", "in 45 minutes"
  const dur = /\b(?:resets?|reset|again|available|back|retry|wait)\b[^.\n]{0,20}?\b(?:in|after)\s+((?:\d+(?:\.\d+)?\s*(?:d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)(?![a-z])[\s,]*(?:and\s+)?)+)/i.exec(s);
  if (dur) {
    let ms = 0;
    for (const m of dur[1].matchAll(/(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)(?![a-z])/gi)) {
      const n = Number(m[1]), u = m[2].toLowerCase();
      ms += n * (u.startsWith("d") ? 86400000 : u.startsWith("h") ? 3600000 : u.startsWith("s") ? 1000 : 60000);
    }
    if (ms > 0) return now + clamp(ms);
  }
  // a clock time, maybe with a date and a time zone
  const clock = /\b(?:resets?|reset|again|available|back)\b(?:\s+(?:at|on))?\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?(?:\s*\(([A-Za-z_]+\/[A-Za-z_\/+-]+|UTC|GMT)\))?/i.exec(s);
  if (clock && (clock[5] || clock[4] != null || clock[1])) {
    const tz = clock[6] || "";
    const w = wallParts(now, tz);
    const h = to24(clock[3], clock[5]);
    const mi = Number(clock[4] || 0);
    if (h > 23 || mi > 59) return null;
    const wallNow = Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s);
    let target;
    if (clock[1]) {
      const mo = MONTHS[clock[1].toLowerCase().slice(0, 3)];
      target = Date.UTC(w.y, mo, Number(clock[2]), h, mi, 0);
      if (target <= wallNow) target = Date.UTC(w.y + 1, mo, Number(clock[2]), h, mi, 0);
    } else {
      target = Date.UTC(w.y, w.mo, w.d, h, mi, 0);
      if (target <= wallNow) target += 86400000;
    }
    return now + clamp(target - wallNow);
  }
  return null;
}

/** The reset words as the app said them ("2:30pm (America/Los_Angeles)"), for a plain message, or "". */
export function resetWords(text) {
  const m = /\bresets?\s+((?:at|on|in|after)\s+)?([^.\n·|]{1,48})/i.exec(String(text || ""));
  if (!m) return "";
  return `${m[1] || ""}${m[2]}`.replace(/\s+/g, " ").trim().replace(/[,;:]+$/, "");
}

/**
 * Is this the app saying it is out of its plan for now? Returns { resetAt, words } or null.
 * `short` limits the check to a short reply (an app that printed the limit line as its "answer").
 */
export function cliLimit(text, { now = Date.now(), short = false } = {}) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (short && (s.length > 300 || !SHORT_LIMIT_RE.test(s))) return null;
  if (!LIMIT_RE.test(s)) return null;
  const at = resetAtFrom(s, now);
  return { resetAt: at, until: at || now + LIMIT_REST_MS, words: resetWords(s) };
}

/** "Claude Code is out of its own plan's quota right now. It resets at 2:30pm (America/Los_Angeles)." */
export function limitMessage(name, lim) {
  const base = `${name} is out of its own plan's quota right now.`;
  if (lim?.words) return `${base} It resets ${/^(at|on|in|after)\b/i.test(lim.words) ? "" : "at "}${lim.words}.`.replace(/\.\.$/, ".");
  if (lim?.resetAt) {
    let at = "";
    try { at = new Date(lim.resetAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }); } catch { at = ""; }
    if (at) return `${base} It comes back around ${at}.`;
  }
  return `${base} It rests for a few hours, and the next best AI takes the job.`;
}
