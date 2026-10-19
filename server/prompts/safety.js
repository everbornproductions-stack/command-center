// Safety defaults for every Pro prompt.
// Made-up numbers, metrics, case studies and testimonials are marked [VERIFY].
// Credit-repair / SCF mode adds CROA and RESPA limits.
// Outbound messages stay drafts. SSNs, dates of birth and account numbers are
// removed before a prompt is built or anything is stored.

export const VERIFY = "[VERIFY]";
export const CROA = "[CROA]";
export const RESPA = "[RESPA REVIEW]";
export const REDACTED = "[REDACTED]";

export const SAFETY_TEXT = [
  "SAFETY (always):",
  "If a number, metric, case study or testimonial was not given by the user, mark it " + VERIFY + ". Do not invent results, prices, counts or quotes.",
  "Any email, text, post or outreach you write is a DRAFT ONLY. Do not send, post, schedule or charge anything.",
  "Never ask for, repeat, or store a client SSN, date of birth, or account number. If one appears, replace it with " + REDACTED + ".",
].join("\n");

export const SCF_TEXT = [
  "SCF / CREDIT-REPAIR MODE (CROA and RESPA):",
  "Do not promise results. Do not say a score will rise, jump, or reach a number.",
  "Do not guarantee approval, deletion, or a timeline.",
  "Mark any promised result, score jump, or guarantee with " + CROA + ".",
  "Referral rewards, referral fees and kickbacks must be marked " + RESPA + " for a human RESPA review.",
  "Describe process only. The person decides what is sent, and nothing is sent from here.",
].join("\n");

const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_LABELED = /\b(?:ssn|social security(?: number)?)\b[:\s#-]*\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/gi;
const DOB_LABELED = /\b(?:dob|d\.o\.b\.|date of birth|born on|birthday)\b[:\s]*\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}\b/gi;
const ACCOUNT_LABELED = /\b(?:account|acct|routing|card|iban)\s*(?:number|no\.?|#)?\s*[:#]?\s*[0-9][0-9\-\s]{5,22}\b/gi;

export function scrubText(value) {
  const kinds = [];
  let text = String(value ?? "");
  const hit = (re, kind) => {
    if (re.test(text)) kinds.push(kind);
    re.lastIndex = 0;
    text = text.replace(re, REDACTED);
  };
  hit(SSN_LABELED, "ssn");
  hit(SSN_DASHED, "ssn");
  hit(DOB_LABELED, "dob");
  hit(ACCOUNT_LABELED, "account");
  return { text, redacted: [...new Set(kinds)] };
}

export function scrubValue(value, found = []) {
  if (typeof value === "string") {
    const r = scrubText(value);
    found.push(...r.redacted);
    return r.text;
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, found));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v, found);
    return out;
  }
  return value;
}

export function scrub(value) {
  const found = [];
  const clean = scrubValue(value, found);
  return { value: clean, redacted: [...new Set(found)] };
}

function sourceHas(source, raw) {
  const n = String(raw).replace(/,/g, "");
  return source.includes(raw) || source.includes(n);
}

// Mark claims in a model answer that were not in the user's inputs.
function markSentence(sentence, source, scf) {
  const lead = sentence.match(/^\s*/)?.[0] || "";
  let s = sentence.trim();
  if (!s) return sentence;
  const numbers = [...s.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)].map((m) => m[0]);
  const unknownNumber = numbers.some((raw) => {
    const digits = raw.replace(/[^\d.]/g, "");
    return !sourceHas(source, raw.replace(/[$,]/g, "").trim()) && !(digits && sourceHas(source, digits));
  });
  if (unknownNumber && !s.includes(VERIFY)) s = `${s} ${VERIFY}`;
  if (/\b(?:case study|testimonial|client said|they said|we helped|success story)\b/i.test(s) && !s.includes(VERIFY)) {
    const quoted = s.replace(/\s+/g, " ").trim();
    if (!(quoted && source.toLowerCase().includes(quoted.toLowerCase().slice(0, 40)))) s = `${s} ${VERIFY}`;
  }
  if (scf && /\b(?:guarantee|guaranteed|we promise|promise you|will raise your(?: credit)? score|score will (?:jump|increase|go up)|raise your score by)\b/i.test(s) && !s.includes(CROA)) {
    s = `${CROA} ${s}`;
  }
  if (scf && /\b(?:referral fee|referral reward|referral bonus|kickback|pay(?:ing)? (?:you )?for (?:the )?referral)\b/i.test(s) && !s.includes(RESPA)) {
    s = `${RESPA} ${s}`;
  }
  return lead + s;
}

// Mark claims in a model answer that were not in the user's inputs.
export function annotateOutput(text, source = "", { scf = false } = {}) {
  const src = String(source || "");
  let out = String(text || "");
  out = out.split(/(\n+)/).map((part) => {
    if (/^\n+$/.test(part)) return part;
    return part.split(/(?<=[.?!])\s+/).map((sentence) => markSentence(sentence, src, scf)).join(" ");
  }).join("");
  if (/\b(subject:|dear |hi [A-Z]|email draft|text them|sms)\b/i.test(out) && !/DRAFT ONLY/i.test(out)) {
    out = `DRAFT ONLY. Nothing is sent until you send it yourself.\n\n${out}`;
  }
  return out;
}
