// Plain-words helpers for the Finish drawer (0.4.21, M10 M17 M18): clean text to show and print, a title
// that never stops mid-word, and a check for code blocks. Pure functions, no page needed.

// Markdown marks out, words kept. Code stays as it is (only the fence lines go) so nothing is flattened.
export function plainMarkdown(text) {
  const out = [];
  let inCode = false;
  for (const raw of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) { out.push(raw); continue; }
    let l = raw.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^\s*>\s?/, "");
    l = l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1$2").replace(/`([^`]+)`/g, "$1");
    l = l.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1 ($2)");
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)) continue; // table rule row
    out.push(l.replace(/^\s*[-*+]\s+/, "- "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// A short title from the first real line. Skips a leading profile block and heading marks, keeps # in hashtags,
// and cuts at a word, never in the middle of one.
// A title is kept in the hub and used as a file name, so private numbers never go into it (panel bug 46).
// Dashed Social Security numbers, a number after a private label (SSN, account, card ...) and long digit runs
// (card numbers) become "[hidden]". Years, prices and small counts stay as they are.
export function hidePrivateInTitle(t) {
  return String(t ?? "")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[hidden]")
    // 0.4.23 (audit X13): the label rule keeps the space after the number, and a long digit run is hidden only
    // when it passes the card checksum (Luhn), so plain numbers such as "2026 2027 2028 2029" stay.
    .replace(/\b(ssn|social security(?: number)?|account(?: number)?|acct|routing(?: number)?|card(?: number)?)\b([:\s#-]*(?:is\s+)?)[\d](?:[\d-]|\s(?=\d))+/gi, (_m, label) => `${label} [hidden]`)
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (m) => (cardChecksum(m.replace(/[ -]/g, "")) ? "[hidden]" : m));
}
function cardChecksum(d) {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = d.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return d.length >= 13 && sum % 10 === 0;
}

export function titleFrom(text, max = 50) {
  const lines = plainMarkdown(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => !/^(about me|my profile|profile|context)\s*[:\-]?/i.test(l) && !/^(name|role|company|industry|tone)\s*:/i.test(l)) || lines[0] || "";
  const one = hidePrivateInTitle(line.replace(/\s+/g, " ").trim());
  if (!one) return "Finished work";
  if (one.length <= max) return one.replace(/[.:;,\s]+$/, "") || one;
  const cut = one.slice(0, max + 1);
  const sp = cut.lastIndexOf(" ");
  const body = (sp > max * 0.5 ? cut.slice(0, sp) : one.slice(0, max)).replace(/[.:;,\s]+$/, "");
  return body + "...";
}

export function hasCode(text) {
  return /(^|\n)\s*```[^\n]*\n[\s\S]*?\n\s*```/.test(String(text ?? ""));
}
