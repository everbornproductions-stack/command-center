// Checks shown before a person copies or sends text.
// Never-say phrases come from the project and the Business Profile.
// Credit repair rules apply when SCF mode is on. The server still masks
// SSNs and account numbers on the way out. This file only warns.

export const CREDIT_WORDS = [
  ["guarantee", /\bguarante(?:e|ed|es|ing)\b/i],
  ["promise", /\b(?:we promise|promise you|promised result)\b/i],
  ["score jump", /\b(?:will raise your(?: credit)? score|score will (?:jump|increase|go up)|raise your score by)\b/i],
];

export function riskyHits(text, { neverSay = "", scf = false } = {}) {
  const body = String(text || "");
  const hits = [];
  const seen = new Set();
  const add = (word, why) => {
    const key = String(word).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    hits.push({ word: String(word), why });
  };
  for (const phrase of String(neverSay || "").split(/[\n,;]+/)) {
    const p = phrase.trim();
    if (p.length < 2 || p.length > 80) continue;
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(body)) add(p, "On your never-say list.");
  }
  if (scf) {
    for (const [word, re] of CREDIT_WORDS) {
      if (re.test(body)) add(word, "Credit repair rules do not allow this.");
    }
  }
  return hits;
}

export function maskNotice(text = "") {
  const body = String(text || "");
  const found = [];
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(body) || /\b(?:ssn|social security(?: number)?)\b/i.test(body)) found.push("SSNs");
  if (/\b(?:account|acct|routing|card|iban)\b/i.test(body) && /\d[\d\-\s]{5,}/.test(body)) found.push("account numbers");
  if (!found.length) return "Before sending, SSNs and account numbers are masked.";
  return `Before sending, these will be masked: ${found.join(" and ")}.`;
}

// A share link built from this PC cannot be opened anywhere else.
export function localOnlyHost(host) {
  const h = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
