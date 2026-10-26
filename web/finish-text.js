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
export function titleFrom(text, max = 50) {
  const lines = plainMarkdown(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => !/^(about me|my profile|profile|context)\s*[:\-]?/i.test(l) && !/^(name|role|company|industry|tone)\s*:/i.test(l)) || lines[0] || "";
  const one = line.replace(/\s+/g, " ").trim();
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
