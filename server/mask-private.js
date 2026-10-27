// The one place that hides private numbers before anything is shown, kept or sent as a preview.
// Social Security numbers (dashed, or after "SSN"), card numbers and labeled account or routing numbers
// keep only their last four digits. Used by the Slack, HighLevel, Instagram and Gmail previews and by
// the publish history and the send log.
const SSN_LABELED = /\b(ssn|social security(?: number)?)\b([:\s#-]*(?:(?:is|was|:)[:\s#-]*)?)(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})\b/gi;
const SSN_DASHED = /\b\d{3}-\d{2}-(\d{4})\b/g;
const ACCOUNT_LABELED = /\b((?:bank |checking |savings )?(?:account|acct|routing|iban)\s*(?:number|no\.?|#)?\s*[:#]?\s*)([0-9][0-9\- ]{4,22}[0-9])\b/gi;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;

const luhn = (digits) => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
};

export function maskPrivate(s) {
  return String(s ?? "")
    .replace(SSN_LABELED, (_m, label, gap, _a, _b, last) => `${label}${gap}***-**-${last}`)
    .replace(SSN_DASHED, "***-**-$1")
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? `**** **** **** ${digits.slice(-4)}` : m;
    })
    .replace(ACCOUNT_LABELED, (m, label, num) => {
      const digits = num.replace(/\D/g, "");
      return digits.length >= 6 ? `${label}****${digits.slice(-4)}` : m;
    });
}

// Masks every string inside a value (a payload, a draft, a list of rows) and returns a copy.
export function maskDeep(v) {
  if (typeof v === "string") return maskPrivate(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
  return v;
}
