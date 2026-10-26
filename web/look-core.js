// Look (0.4.19, flag_look): pure rules for the glass look. No page access here, so tests can run it.
// Graphics lookup, frame test, the choice (Auto / Full glass / Classic) and what to show for it.

export const LOOKS = ["auto", "glass", "classic"];
export const TIERS = ["good", "borderline", "weak"];
export const FPS_MIN = 40;
export const STUTTER_MS = 200;
export const TEST_MS = 1000;

export function normalizeChoice(v) {
  const s = String(v == null ? "auto" : v).trim().toLowerCase();
  return LOOKS.includes(s) ? s : "auto";
}

const SOFT = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|warp|mesa offscreen/i;
const DEDICATED = /geforce|rtx|gtx|quadro|radeon rx|radeon pro|rx \d{3,4}|arc a[5-7]\d{2}/i;
const INTEGRATED = /intel|uhd|iris|hd graphics|arc|vega|radeon graphics|apple m\d|adreno|mali|powervr/i;

// info: { renderer, accelerated, cores, memoryGb, width, height, dpr }
// Returns { tier, reasons }. Missing info is Borderline: the frame test then decides.
export function scoreGraphics(info) {
  const i = info && typeof info === "object" ? info : {};
  const renderer = String(i.renderer || "");
  const reasons = [];
  if (i.accelerated === false) return { tier: "weak", reasons: ["Graphics acceleration is off."] };
  if (renderer && SOFT.test(renderer)) return { tier: "weak", reasons: ["The screen is drawn by software, not a graphics chip."] };
  if (!renderer) return { tier: "borderline", reasons: ["Graphics details were not reported."] };
  let tier;
  if (DEDICATED.test(renderer) && !/intel/i.test(renderer)) tier = "good";
  else if (INTEGRATED.test(renderer)) { tier = "borderline"; reasons.push("The graphics are built into the processor."); }
  else tier = "good";
  const dpr = Number(i.dpr) || 1;
  const px = Number(i.width) * Number(i.height) * dpr * dpr;
  if (tier === "good" && px > 14e6 && Number(i.memoryGb) > 0 && Number(i.memoryGb) < 8) { tier = "borderline"; reasons.push("Large screen and little memory."); }
  if (tier === "borderline" && px > 12e6) reasons.push("The screen is very large.");
  if (tier === "good" && Number(i.cores) > 0 && Number(i.cores) <= 2) { tier = "borderline"; reasons.push("Few processor cores."); }
  return { tier, reasons };
}

// deltas: frame times in ms from a short requestAnimationFrame burst. The first frame is warm-up.
export function scoreFrames(deltas) {
  const d = (Array.isArray(deltas) ? deltas : []).map(Number).filter((n) => n > 0 && Number.isFinite(n)).slice(1);
  if (d.length < 5) return { fps: 0, stutter: false, ok: true, measured: false };
  const total = d.reduce((a, b) => a + b, 0);
  const fps = Math.round((d.length / total) * 1000);
  const stutter = d.some((n) => n > STUTTER_MS);
  return { fps, stutter, ok: fps >= FPS_MIN && !stutter, measured: true };
}

// The measurement wins over the card name: slow frames lower the tier by one step.
export function combineTier(lookupTier, frames) {
  const t = TIERS.includes(lookupTier) ? lookupTier : "borderline";
  if (!frames || !frames.measured || frames.ok) return t;
  if (t === "good") return "borderline";
  return "weak";
}

// choice: auto | glass | classic. env: { tier, reducedMotion, lowPower }.
// Returns { look: "glass"|"classic", ask: ""|"offer-classic"|"offer-glass", warn, still, blur }.
export function decideLook(choice, env = {}) {
  const c = normalizeChoice(choice);
  const tier = TIERS.includes(env.tier) ? env.tier : "borderline";
  const still = !!(env.reducedMotion || env.lowPower);
  const blur = !env.lowPower;
  let look = "glass", ask = "", warn = "";
  if (c === "classic") look = "classic";
  else if (c === "glass") { if (tier !== "good") warn = "Your graphics may run the new look slowly."; }
  else if (tier === "weak") { look = "classic"; ask = "offer-glass"; }
  else if (tier === "borderline") ask = "offer-classic";
  return { look, ask, warn, still, blur };
}

export const OFFERS = {
  "offer-classic": "Your graphics look a little slow for the new look. Use the classic look?",
  "offer-glass": "Try the new look",
};

// Safety net while running: entries are { start, duration } long frames (ms).
// Blocked time over a third of a 10 second window means the look is hurting.
export function stutterVerdict(entries, now, windowMs = 10000) {
  const from = now - windowMs;
  let blocked = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const s = Number(e.start), d = Number(e.duration);
    if (!(d > 0) || s + d < from) continue;
    blocked += Math.min(d, s + d - from);
  }
  return blocked > windowMs / 3;
}

// A saved check is reused until the computer or screen changes.
export function signature(info) {
  const i = info || {};
  return [i.renderer || "", i.width || 0, i.height || 0, i.dpr || 1, i.cores || 0].join("|");
}
