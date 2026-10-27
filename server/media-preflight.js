// Media preflight (0.4.21, dogfood 02): before anything is sent, say plainly whether the image, video or voice AI a job
// needs can really make it. "Image needs a fal.ai key. Add it or use another image AI." Never a quiet placeholder.
import * as MEDIA from "./media-jobs.js";
import { status as switchStatus } from "./media-switch.js";
import { IMAGE_PROVIDERS, readyImageProviders, imageProviderInfo } from "./images.js";
import { isFlatGraphic, localDrawNote, cantMakeImageLine, canRenderPng } from "./local-draw.js";

const IMAGE_ASK = /\b(image|images|picture|pictures|photo|photos|logo|illustration|poster|banner|thumbnail|mockup|graphic|artwork|1080x1080|instagram (post|image)|social (post|image))\b/i;
const VIDEO_ASK = /\b(video|videos|reel|reels|clip|clips|animation|animated)\b/i;
const VOICE_ASK = /\b(voice[- ]?over|voiceover|narration|narrate|text[- ]to[- ]speech|spoken audio|audio version)\b/i;
const NOUNS = "videos?|reels?|clips?|images?|pictures?|photos?|posters?|banners?|logos?|thumbnails?|graphics?";
// "a video script", "captions for the reel", "a landing page for listing videos" ask for words or pages, not the file
const WORDS_AFTER = new RegExp(`\\b(${NOUNS})\\s+(script|brief|plan|caption|idea|prompt|storyboard|outline|schedule|concept|page|gallery|section)s?\\b`, "gi");
const WORDS_BEFORE = new RegExp(`\\b(for|about|with|on|from|featuring|showing)\\s+(the |a |an |my |our |your |each |every |their )?(\\w+\\s+){0,2}(${NOUNS})\\b`, "gi");
const VERB_ASK = new RegExp(`\\b(make|create|generate|produce|render|design|draw|animate|shoot|build|need|want)\\b[^.\\n]{0,40}?\\b(${NOUNS})\\b`, "i");
const BARE_ASK = new RegExp(`\\b(one|a|an|the|\\d+)\\s+(\\d+x\\d+\\s+)?([\\w-]+\\s+){0,3}(${NOUNS})\\b`, "i");

// a quote card or a PNG is a picture even though "card" is not in the noun list ("business card" and "credit card" stay out)
const CARD_ASK = /\b(make|create|design|generate|draw|produce|render|need|want)\b[^.\n]{0,60}?\b(quote\s*cards?|text\s*cards?|social\s*cards?|png|jpe?g)\b/i;
export function neededMedia(goal) {
  const g = String(goal || "").replace(WORDS_AFTER, " ").replace(WORDS_BEFORE, " ");
  const kinds = [];
  const asks = (re) => VERB_ASK.test(g) && re.test(g.match(VERB_ASK)[0]) || (BARE_ASK.test(g) && re.test(g.match(BARE_ASK)[0]));
  if (CARD_ASK.test(g) && !kinds.includes("image")) kinds.push("image");
  if (asks(/images?|pictures?|photos?|posters?|banners?|logos?|thumbnails?|graphics?/i)) kinds.push("image");
  if (asks(/videos?|reels?|clips?/i)) kinds.push("video");
  if (VOICE_ASK.test(g)) kinds.push("voice");
  return [...new Set(kinds)];
}

const LABEL = { image: "Image", video: "Video", voice: "Voice-over" };
const AIS_TEXT = { image: "an image AI key (OpenAI, Google Gemini, xAI, Replicate or fal.ai)", video: "a video AI key (Kling, fal.ai or Runway)", voice: "an ElevenLabs key" };

/** One kind: can it be made now, by whom, and what to say if not. Uses M's media switch (server/media-switch.js), the
 * one list of picture/video/voice makers across both media stacks, so the preflight and the step agree. */
export function mediaStatus(kind, goal = "") {
  if (!MEDIA.KINDS.includes(kind)) return null;
  let st;
  try { st = switchStatus(kind); } catch { return oldStatus(kind); }
  // 0.4.21 (dogfood 13): no image AI. A flat graphic is drawn here; anything else gets an honest "I can't make this" with what to add.
  if (kind === "image" && !st.ok && !st.missing?.length) {
    if (isFlatGraphic(goal)) return { ...st, ok: true, local: true, pngHere: canRenderPng(), provider: "local-draw", providerName: "Meldmind drawing", usd: 0, ready: [], alternatives: [], message: localDrawNote() };
    return { ...st, message: cantMakeImageLine(st.message) };
  }
  if (!st.ok && !/placeholder/.test(st.message || "")) st = { ...st, message: `${st.message} Until then you only get a placeholder, not a real ${kind}.` };
  return st;
}
function oldStatus(kind) {
  if (!MEDIA.KINDS.includes(kind)) return null;
  const order = MEDIA.ORDER[kind] || [];
  const ready = [];
  const missing = [];
  for (const pid of order) {
    const a = MEDIA.adapter(pid);
    if (!a?.kinds.includes(kind)) continue;
    const row = { id: pid, name: a.name };
    if (kind === "image" && IMAGE_PROVIDERS[pid]) Object.assign(row, { usd: imageProviderInfo(pid).usd });
    if (MEDIA.ready(pid)) {
      let capped = false;
      try { capped = MEDIA.estimate({ provider: pid, kind, params: { prompt: "x" } }).capped; } catch { /* leave it listed */ }
      if (!capped) { ready.push(row); continue; }
      row.capped = true;
    }
    missing.push(row);
  }
  const first = order.map((id) => MEDIA.adapter(id)).find((a) => a?.kinds.includes(kind));
  const label = LABEL[kind];
  if (ready.length) {
    const main = ready[0];
    const alt = ready.slice(1).map((r) => r.name);
    return { kind, label, ok: true, provider: main.id, providerName: main.name, usd: main.usd ?? null, ready, missing, alternatives: alt,
      message: `${label}: ${main.name} will make it${alt.length ? `. If it fails, ${alt.join(" or ")} steps in` : ""}.` };
  }
  const named = missing.filter((m) => !m.capped).map((m) => m.name);
  const cappedOnes = missing.filter((m) => m.capped).map((m) => m.name);
  const message = cappedOnes.length
    ? `${label} is blocked: ${cappedOnes.join(" and ")} reached its spending cap. Raise the cap in Settings > Spend caps or add another ${kind} AI key.`
    : `${label} needs ${AIS_TEXT[kind]}. Add one in Settings, or use another ${kind} AI. Until then you only get a placeholder, not a real ${kind}.`;
  return { kind, label, ok: false, provider: null, providerName: first?.name || null, ready, missing, alternatives: [], options: named, message };
}

/** For a goal: which media it needs, whether each can be made, and one banner line if any cannot. */
export function preflight(goal, { kinds } = {}) {
  const wanted = (kinds && kinds.length ? kinds : neededMedia(goal)).filter((k) => MEDIA.KINDS.includes(k));
  const items = wanted.map((k) => mediaStatus(k, goal)).filter(Boolean);
  const blocked = items.filter((i) => !i.ok);
  return { kinds: wanted, items, blocked: blocked.length > 0, lines: items.map((i) => i.message), banner: blocked.length ? blocked.map((b) => b.message).join(" ") : "" };
}

// the loud line on a finished job whose media step was only a placeholder
export function dryRunBanner(tasks = []) {
  const dry = tasks.filter((t) => t.media && (t.media.dryRun || t.media.status === "dry-run"));
  if (!dry.length) return null;
  const kinds = [...new Set(dry.map((t) => t.media.kind))];
  const names = kinds.map((k) => LABEL[k].toLowerCase());
  const why = kinds.map((k) => mediaStatus(k)?.message).filter(Boolean).join(" ");
  return { kind: "dry-run", level: "warn", kinds, steps: dry.map((t) => t.id), text: `No real ${names.join(" or ")} was made. What you see is a placeholder, nothing was generated and nothing was spent. ${why}`.trim() };
}

export { readyImageProviders };
