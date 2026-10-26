// No raw JavaScript error ever reaches the person (0.4.21). A message that is already plain (a provider refusal,
// "No AI is available to plan") passes through. Anything that looks like a program error ("Cannot read properties
// of undefined", a stack line, "x is not a function", a JSON parse error) is logged for support and replaced.
const RAW = /\b(?:TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError|AssertionError)\b|Cannot (?:read|set|destructure) propert|\bis not a (?:function|constructor)\b|\bis not (?:defined|iterable)\b|undefined \(reading|Unexpected (?:token|end of JSON|identifier)|in JSON at position|\bat [\w.<>$ ]+ \([^)]*:\d+:\d+\)|\bat (?:file|node):|node:internal|\bERR_[A-Z_]{3,}\b|\b(?:ENOENT|EACCES|EPERM)\b|\[object Object\]|\bNaN\b/;

export const PLAIN_FALLBACK = "Something went wrong inside Meldmind while doing this, not with your request. Nothing was sent. Press Try again. If it keeps happening, open Help and tell support what you were doing.";

export const looksRaw = (text) => RAW.test(String(text ?? ""));

// Accepts an Error or a string and always returns a plain sentence.
export function plainMessage(e, { fallback = PLAIN_FALLBACK } = {}) {
  const msg = String(e?.message ?? e ?? "").trim();
  if (!msg) return fallback;
  const jsName = e && typeof e === "object" && /^(?:Type|Reference|Range|Syntax|Eval|URI)Error$/.test(String(e.name || ""));
  if (jsName || looksRaw(msg)) {
    try { console.error("[plain-error] hidden from the person:", msg.slice(0, 300)); } catch { /* logging must never throw */ }
    return fallback;
  }
  return msg;
}
