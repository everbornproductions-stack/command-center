// flag_livebubble: Live view Free AI bubble, credit badges and Clear idle projects (0.4.19 slice A4).
// Kept tiny and import-free so the plugin can ask before loading anything heavy.
// Default is OFF. The 0.4.19 build turns it on with CC_FLAG_LIVEBUBBLE=1, or flip DEFAULT_ON after review.
export const DEFAULT_ON = false;
export function liveBubbleOn(env = process.env) {
  const v = env.CC_FLAG_LIVEBUBBLE;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return DEFAULT_ON;
}
