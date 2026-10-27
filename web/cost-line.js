// One cost line per answer (0.4.22, panel row 15). A free answer says "Free" and the AI that did it, never a dollar
// amount AND "Free" together. A paid answer keeps the amount and the reason. Pure: no page needed.
export function costLineText(costText, why) {
  const c = String(costText || "").trim(), w = String(why || "").trim();
  if (!c) return "";
  const free = /^\$0(?:\.0+)? \((?:free|this PC):/i.test(c) || /^free first\b/i.test(w);
  if (!free) return `Cost: ${c}${w ? `. ${w}` : ""}`;
  const m = c.match(/\((?:free: |this PC: )?(.+)\)\s*$/i);
  const ai = m ? m[1].trim() : "";
  return ai ? `Free (${ai})` : "Free";
}
