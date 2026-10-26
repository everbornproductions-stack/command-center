// Does a chat message ask to make a website or another project? Then chat starts the project steps
// (idea, questions, plan, build, review) instead of answering with one general reply.
// Pure text rules, no network. The type ids match server/walkthroughs.js.

const VERB = "(?:make|build|create|design|put together|set up|launch|start|develop|draft|write|plan)";
const ASK = new RegExp(`^\\s*(?:please\\s+)?(?:(?:can|could|would) you\\s+(?:please\\s+)?|help me\\s+|i (?:need|want|would like) (?:you )?to\\s+|i(?:'d| would) like (?:you )?to\\s+|let'?s\\s+|i want\\s+|i need\\s+)?(?:${VERB}\\b|a\\s|an\\s)`, "i");
const QUESTION = /^\s*(?:how (?:do|can|does|should)|what(?:'s| is| are)|why|explain|should i|is it|are there|which|tell me about)\b/i;
const NOUNS = [
  ["music-video", /\b(?:music video|lyric video)\b/i],
  ["reels", /\b(?:reels?|tiktoks?|short[- ]form videos?)\b/i],
  ["business-plan", /\bbusiness plan\b/i],
  ["marketing", /\bmarketing (?:plan|campaign|strategy)\b/i],
  ["website", /\b(?:web ?site|web ?page|landing page|online store|portfolio site)\b/i],
  ["app", /\b(?:mobile app|web app|an app|a app|software|an application)\b/i],
];
// "a", "an", "me a", "us a", "my new": the person wants something new, not a change to what exists.
const NEW_THING = /\b(?:a|an|new|me a|us a|my new|our new|one|\d+|two|three|four|five|six)\s+(?:[\w-]+\s+){0,4}?(?:web ?site|web ?page|landing page|online store|portfolio site|mobile app|web app|app|software|application|business plan|marketing (?:plan|campaign|strategy)|music video|lyric video|reels?|tiktoks?)\b/i;

export function projectIntent(text) {
  const t = String(text || "").trim();
  if (t.length < 12 || t.length > 600) return "";
  if (QUESTION.test(t)) return "";
  if (!ASK.test(t)) return "";
  if (!NEW_THING.test(t)) return "";
  for (const [id, re] of NOUNS) if (re.test(t)) return id;
  return "";
}
