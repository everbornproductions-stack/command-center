// "Type it, get the finished thing" (0.4.21): does a chat message ask Meldmind to MAKE a picture, a video
// or a voice? Pure text rules, no network. The server (server/make-it.js) and the page both use it.
//
//   makeIntent("a woman on a beach")            -> { kind: "image", subject: "a woman on a beach" }
//   makeIntent("make a 5 second video of waves") -> { kind: "video", subject: "waves", seconds: 5 }
//   makeIntent("read this out loud: Hello")      -> { kind: "audio", subject: "Hello" }
//   followupIntent("make it sunset")             -> { type: "change", change: "make it sunset" }
//   followupIntent("another one")                -> { type: "another" }
// Websites, apps and games stay with web/project-intent.js (projects), which this file does not replace.

const VERBS = "(?:make|create|generate|draw|paint|design|render|produce|give|get|show|sketch|illustrate|film|animate|shoot)";
const LEAD = new RegExp(`^\\s*(?:please\\s+)?(?:(?:can|could|would|will) you\\s+(?:please\\s+)?|help me\\s+|i (?:need|want|would like|'d like)\\s+(?:you\\s+to\\s+|to\\s+)?|i(?:'d| would) like\\s+(?:you\\s+to\\s+|to\\s+)?|let'?s\\s+|i want\\s+|i need\\s+)?`, "i");
const QUESTION = /^\s*(?:how (?:do|can|does|should|to)|what(?:'s| is| are| does)|why|explain|should i|is it|are there|which|tell me|who|when|where|do you|does|can you tell|list|summari[sz]e|translate|write|compare)\b/i;

const IMAGE_NOUN = "(?:image|images|picture|pictures|photo|photos|photograph|logo|illustration|drawing|portrait|wallpaper|poster|painting|icon|sketch|artwork|banner|thumbnail|avatar|mockup|render|cartoon)";
const VIDEO_NOUN = "(?:video|clip|animation|footage|reel|gif|short film|timelapse|time-lapse)";
const AUDIO_NOUN = "(?:voiceover|voice-over|voice|narration|speech|audio|read[- ]?aloud|spoken)";
const MUSIC_NOUN = "(?:song|songs|music|jingle|beat|melody|soundtrack|track)";

const RE_IMAGE = new RegExp(`\\b${IMAGE_NOUN}\\b`, "i");
const RE_VIDEO = new RegExp(`\\b${VIDEO_NOUN}\\b`, "i");
const RE_AUDIO = new RegExp(`\\b${AUDIO_NOUN}\\b`, "i");
const RE_MUSIC = new RegExp(`\\b${MUSIC_NOUN}\\b`, "i");
const RE_VERB_START = new RegExp(`^${VERBS}\\b`, "i");
const RE_READ = /^\s*(?:please\s+)?(?:read|say|speak|narrate|voice)\b(?:\s+(?:this|that|the following|it))?(?:\s+(?:out loud|aloud|out))?\s*[:,-]?\s*(.+)$/is;

// a bare scene: "a woman on a beach", "an old barn at sunset, film photo"
const SCENE_CUE = /\b(?:on|in|at|under|over|by|near|with|beside|against|through|above|behind|during|holding|wearing|standing|sitting|walking|running|flying|riding|looking|surrounded|floating|resting|sleeping|dancing|playing|of)\b|,/i;
const SCENE_DENY = /\b(?:recipe|email|letter|essay|poem|story|joke|plan|plans|summary|list|spreadsheet|report|resume|cv|script|speech|code|function|invoice|contract|schedule|budget|reply|response|answer|question|difference|reason|way to|tip|tips|idea|ideas|name|names|slogan|tagline|caption|post|posts|tweet|bio|pitch|proposal|checklist|template|article|blog|newsletter|website|web ?site|app|game|business|company|startup|course|lesson|lessons|workout|meal|diet|strategy|review|analysis|sheet|cheatsheet|cheat sheet|guide|notes|flashcard|flashcards|quiz|outline|worksheet|study|week|month|calendar|series)\b/i;

function words(t) { return String(t).trim().split(/\s+/).filter(Boolean); }
function clean(t) { return String(t).replace(/\s+/g, " ").replace(/^[\s,.:;?!-]+|[\s,.:;?!-]+$/g, "").slice(0, 600); }

// "5 second", "10-sec", "30s", "a minute" -> seconds (video)
function seconds(t) {
  const m = String(t).match(/\b(\d{1,3})\s*[- ]?(?:seconds?|secs?|s)\b/i);
  if (m) return Math.min(20, Math.max(1, Number(m[1])));
  if (/\ba minute\b|\b1\s*[- ]?minute\b/i.test(t)) return 20;
  return 0;
}

export function makeIntent(text) {
  const t = String(text || "").trim();
  if (t.length < 3 || t.length > 600) return null;
  const rest = t.replace(LEAD, "");

  // read this aloud: voice from the words that follow (exact words, nothing rewritten)
  const rd = t.match(RE_READ);
  if (rd && /\b(?:out loud|aloud|in a (?:warm|calm|deep|friendly|female|male)|as audio|as a voice|voice ?over)\b/i.test(t.slice(0, 80)) && clean(rd[1]).length > 2) {
    return { kind: "audio", subject: clean(rd[1].replace(/^(?:out loud|aloud)\s*[:,-]?\s*/i, "")), exact: true };
  }
  if (QUESTION.test(t)) return null;
  const hasVerb = RE_VERB_START.test(rest) || LEAD.test(t) && t.replace(LEAD, "") !== t;

  // a video or a clip, with or without a verb: "a 5 second video of waves"
  if (RE_VIDEO.test(t) && (hasVerb || /^(?:an?|the|\d)/i.test(rest)) && !/\b(?:music video|lyric video|reels?)\b/i.test(t)) {
    const s = seconds(t);
    const sub = clean(t.replace(LEAD, "").replace(new RegExp(`^${VERBS}\\s+(?:me\\s+|us\\s+)?`, "i"), "").replace(/\b\d{1,3}\s*[- ]?(?:seconds?|secs?|s)\b[- ]?(?:long)?/i, "").replace(new RegExp(`^(?:an?|the)?\\s*(?:short\\s+)?${VIDEO_NOUN}\\s*(?:of|about|showing|with|where)?\\s*`, "i"), ""));
    return { kind: "video", subject: sub || clean(t), seconds: s || 5 };
  }
  // a voice
  if (RE_AUDIO.test(t) && hasVerb) {
    const sub = clean(t.replace(LEAD, "").replace(new RegExp(`^${VERBS}\\s+(?:me\\s+|us\\s+)?(?:an?\\s+|the\\s+)?${AUDIO_NOUN}\\s*(?:of|for|saying|that says|reading|about)?\\s*[:,-]?\\s*`, "i"), ""));
    return { kind: "audio", subject: sub || clean(t), exact: false };
  }
  // songs and music: not available yet, said plainly
  if (RE_MUSIC.test(t) && hasVerb && /\b(?:make|create|generate|compose|write|produce)\b/i.test(t) && !/\b(?:lyrics|marketing|plan|music video|lyric video)\b/i.test(t)) {
    return { kind: "music", subject: clean(t) };
  }
  // a picture: a noun, with a make verb or an a/an start
  if (RE_IMAGE.test(t) && (hasVerb || /^(?:an?|the|some)\b/i.test(rest))) {
    const sub = clean(t.replace(LEAD, "").replace(new RegExp(`^${VERBS}\\s+(?:me\\s+|us\\s+)?`, "i"), "").replace(new RegExp(`^(?:an?|the|some)?\\s*(?:\\w+\\s+){0,2}?${IMAGE_NOUN}\\s*(?:of|showing|with|about|that shows|depicting)?\\s*`, "i"), (m) => (/\bof\b|showing|with|about|shows|depicting/i.test(m) ? "" : m)));
    return { kind: "image", subject: sub && sub.length > 2 ? sub : clean(t) };
  }
  // draw / paint / sketch something: "draw a fox in the snow"
  if (/^(?:draw|paint|sketch|illustrate)\b/i.test(rest)) return { kind: "image", subject: clean(rest.replace(/^(?:draw|paint|sketch|illustrate)\s+(?:me\s+)?/i, "")) };
  // "make me a ..." with a visual scene and no project noun
  if (RE_VERB_START.test(rest) && /^(?:make|create|generate|show|give|get)\s+(?:me\s+|us\s+)?(?:an?|the)\s/i.test(rest) && words(rest).length <= 14 && SCENE_CUE.test(rest) && !SCENE_DENY.test(rest) && !/\b(?:with|about)\s+\w+\s+\w+\s+(?:and|or)\b/i.test(rest)) {
    return { kind: "image", subject: clean(rest.replace(new RegExp(`^${VERBS}\\s+(?:me\\s+|us\\s+)?`, "i"), "")) };
  }
  // a bare scene, no verb: "a woman on a beach"
  if (/^(?:an?)\s+\S+/i.test(t) && !/[?]/.test(t) && words(t).length >= 3 && words(t).length <= 16 && SCENE_CUE.test(t) && !SCENE_DENY.test(t) && !/^(?:an?\s+)?(?:good|great|nice|better|best|bit|few|lot|little|way|reason|question|problem|friend|client|customer|call|meeting)\b/i.test(t)) {
    return { kind: "image", subject: clean(t), bare: true };
  }
  return null;
}

const ANOTHER = /^\s*(?:ok(?:ay)?[, ]+|and\s+|now\s+)?(?:another(?: one| take| version| try)?|again|one more|make (?:another|one more)|try again|a different (?:one|take|version)|more like (?:this|that)|give me (?:another|a different|one more)|new version|redo(?: it)?)\s*[.!]?\s*$/i;
const CHANGE = /^\s*(?:ok(?:ay)?[, ]+|and\s+|now\s+|can you\s+|could you\s+|please\s+)*(?:make (?:it|this|that|the [\w' -]{1,30}?|them|him|her)\b|turn (?:it|this|that)\b|change\b|add\b|remove\b|put\b|use\b|give (?:it|him|her|them)\b|zoom\b|crop\b|swap\b|replace\b|set it\b|try (?:it )?(?:in|with|as)\b|but\b|with\b|without\b|more\b|less\b|bigger\b|smaller\b|brighter\b|darker\b|warmer\b|colder\b|sunset\b|sunrise\b|at night\b|in black and white\b|in the (?:snow|rain|dark|style)\b)/i;

export function followupIntent(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 160) return null;
  if (ANOTHER.test(t)) return { type: "another" };
  if (CHANGE.test(t) && !QUESTION.test(t) && !/\?\s*$/.test(t)) return { type: "change", change: clean(t.replace(/^(?:ok(?:ay)?[, ]+|and\s+|now\s+|can you\s+|could you\s+|please\s+)+/i, "")) };
  return null;
}

// One-line price wording, shared by the page and the tests.
export function priceLine(usd, practice = false) {
  const n = Number(usd) || 0;
  if (practice || n <= 0) return "Free practice run. Making it now.";
  if (n < 0.01) return "Less than 1 cent. Making it now.";
  if (n < 1) { const c = Math.max(1, Math.round(n * 100)); return `About ${c} cent${c === 1 ? "" : "s"}. Making it now.`; }
  return `About $${n.toFixed(2)}. Making it now.`;
}

// A short, readable name for MindMedia from what the person asked for: "A woman on a beach".
export function nameFromPrompt(text, fallback = "Made in chat") {
  let t = String(text || "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  if (!t) return fallback;
  const w = t.split(" ").slice(0, 7).join(" ");
  const out = (w.length > 48 ? w.slice(0, 48).replace(/\s+\S*$/, "") : w).replace(/[\\/:*?"<>|]+/g, " ").trim();
  return out ? out[0].toUpperCase() + out.slice(1) : fallback;
}
