// Fill-in strip for prompts that come with [blanks] (0.4.21). Pure helpers: find the blanks, fill them.
// Review tags that are ALL CAPS ([VERIFY], [ASK], [CROA]) are not blanks for the person to fill.
const RE = /\[([A-Za-z][^\]\n]{0,40})\]/g;

export function bracketFields(text) {
  const seen = [];
  for (const m of String(text ?? "").matchAll(RE)) {
    const name = m[1].trim();
    if (!/[a-z]/.test(name)) continue; // [ASK], [VERIFY], [CROA REVIEW]
    if (!seen.includes(name)) seen.push(name);
  }
  return seen.slice(0, 8);
}

export function fillBracket(text, name, value) {
  const v = String(value ?? "");
  if (!v.trim()) return String(text ?? "");
  const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text ?? "").replace(new RegExp(`\\[\\s*${esc}\\s*\\]`, "g"), () => v.trim());
}
