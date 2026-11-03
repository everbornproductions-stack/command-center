// Copy and small helpers for Simple mode and first-run setup. No DOM.

export const MODE_STEP = {
  title: "Which mode do you want to start in?",
  note: "You can change this later.",
  simple: "Simple",
  expert: "Expert",
  simpleLine: "One chat box. Meldmind picks the AI.",
  expertLine: "Every menu, councils, missions, and settings, including MCP (a plug-in connection) and webhooks (a web address that receives a message).",
};

// The one welcome screen (0.4.17). It replaces the mode question, the text size page and
// the key page, so a new person meets one screen before the first answer.
export const WELCOME = {
  title: "Welcome to Meldmind",
  lead: "One screen, then chat. Every part is optional.",
  skip: "Skip setup",
  start: "Start chatting",
  lookTitle: "How it looks",
  textTitle: "Text size",
  aiTitle: "Connect your first AI",
  tryIt: "Try it now",
  tryLine: "Sample answers from pretend AIs. Nothing is spent. You can add your own AI account later.",
  keyLabel: "Or paste an OpenRouter key",
  // 0.4.37 (panel 0435 item 8): the first screen said "key" 20 times; plain words where they fit.
  keyLine: "One OpenRouter sign-up reaches Claude, ChatGPT, Gemini, Grok and more. What you paste is kept sealed on this computer.",
  getKey: "Sign up free",
  appsTitle: "Connect your apps",
  appsLine: "Optional. Gmail, Calendar, Drive, and Outlook. You can do this later in Settings.",
  privacyLine: "Helping Meldmind get smarter: anonymous results only, never your text.",
  privacyDetail: "Counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id. No prompts, answers, file names, emails, keys, or identifying ids.",
  qualitySwitch: "Share anonymous quality signals and usage counts",
  contentOptInLabel: "Share real prompts and answers for our own-AI program",
  contentOptInLine: "Optional explicit opt-in, never pre-checked. Source-tagged, closed-AI outputs excluded. Nothing collects prompts or answers without a clear yes.",
  privacyLink: "What leaves this computer",
};

export const TEXT_SIZES = [["default", "Default"], ["large", "Large"], ["xlarge", "Extra large"]];

export const RESTART_SETUP_LABEL = "Run the whole setup again";
export const RESTART_SETUP_LINE = "Start over: welcome screen, Find my AIs, then connections. Nothing you saved is changed without asking.";

// Full setup restart walks welcome -> scan (Find my AIs) -> connections (Get everything connected).
export function nextRestartPhase(currentPhase) {
  if (currentPhase === "welcome") return "scan";
  if (currentPhase === "scan") return "connections";
  return "";
}

// Which setup page to draw. A fresh install or full restart always starts at the welcome screen.
// Direct "Find my AIs" (requested = "scan") and an Expert setup that was left half done open
// their own step.
export function setupPhase({ fresh = false, requested = "", fullRestart = false, expertSetup = null } = {}) {
  if (fullRestart) return "welcome";
  if (requested) return requested;
  if (fresh) return "welcome";
  if (expertSetup && !expertSetup.done) return expertSetup.pendingScan ? "scan" : "expert";
  return "scan";
}

export const PLACEHOLDER = "Ask anything, or say what to make";
// 0.5.0 (Chris: chat like the Claude app): the box once a chat is going says "Reply to Meldmind..."
export const REPLY_PLACEHOLDER = "Reply to Meldmind...";

export const STARTERS = [
  { id: "customer", label: "Reply to a customer", text: "Help me reply to a customer. I will paste what they wrote." },
  { id: "email", label: "Fix my email", text: "Fix this email so it is clear and short. I will paste the draft." },
  { id: "post", label: "Write a post", text: "Write a short social post. I will say the topic." },
  { id: "plan", label: "Plan my week", text: "Help me plan this week. Ask what matters most." },
  { id: "explain", label: "Explain this", text: "Explain this in plain words. I will paste it." },
];

// 0.4.37 (Chris: "Why does simple mode not look like expert mode when you click on chat?"): the Chat page is one quiet
// column. The empty page says this and offers three small examples; a click only fills the box.
export const CHAT_EMPTY = {
  title: "Ask anything",
  line: "Questions, ideas, a quick draft. Your answer shows up right here.",
  chips: [
    { id: "insurance", label: "Explain my insurance options", text: "Explain my insurance options in plain words. I will say what I have now." },
    { id: "thanks", label: "Write a thank-you text", text: "Write a short thank-you text to a customer. I will say who it is for." },
    { id: "slow", label: "Ideas for a slow Tuesday", text: "Give me 5 ideas to bring customers in on a slow Tuesday." },
  ],
};

// 0.4.37: exactly four buttons under every answer. Everything else waits behind Make changes.
// 0.5.0 (Chris: chat like the Claude app): small icon buttons (Copy, Try again, Save as file, Give to an agent), each with
// a tooltip and a label for screen readers, then "Make changes" with its short list and All options.
export const ANSWER_BUTTONS = [
  { id: "copy", label: "Copy", icon: "copy" },
  { id: "again", label: "Try again", icon: "again" },
  { id: "save", label: "Save as file", icon: "save" },
  { id: "give", label: "Give to an agent", icon: "agent" },
  { id: "change", label: "Make changes" },
];

// 0.5.0: the greeting on a new chat, with the person's first name when Meldmind knows it.
export function chatGreeting(name) {
  const first = String(name || "").trim().split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, "").slice(0, 30);
  return first ? `What can I help with, ${first}?` : "What can I help with?";
}
// 0.5.0: the make shortcuts as one row of small chips under the box. Each starts the existing make path.
export const MAKE_CHIPS = [
  { id: "website", label: "Website", icon: "🌐", text: "Build a website for my " },
  { id: "image", label: "Image", icon: "🖼", text: "Make an image of " },
  { id: "video", label: "Video", icon: "🎬", text: "Make a 5 second video of " },
  { id: "campaign", label: "Campaign", icon: "📣", text: "Plan a marketing campaign for my " },
  { id: "spreadsheet", label: "Spreadsheet", icon: "📊", text: "Make a spreadsheet for " },
  { id: "document", label: "Document", icon: "📄", text: "Write a document about " },
  { id: "more", label: "More", icon: "⋯", text: "" },
];
export const CHAT_NOTE = "Meldmind picks the best AI. Free AIs go first. Ctrl+Enter sends.";

// 0.5.0 (panel 0438 item 3: "11 unrelated asks gave 2 History rows"): does a message typed after an answer go on in the
// same chat? Yes when it is short, points back ("it", "that", "shorter", "again"...) or shares a topic word with an
// earlier question in the chat; no when it is a new subject, which then starts a new chat (a new History row).
const BACK_WORDS = /\b(it|its|that|this|these|those|them|they|their|again|shorter|longer|simpler|shorten|lengthen|expand|more|less|instead|also|another|same|above|previous|earlier|rewrite|redo|reword|rephrase|change|edit|fix|add|remove|delete|drop|continue|translate|why|formal|casual|warmer|friendlier|tone|version|answer|reply)\b/i;
const STOP_WORDS = new Set(["with", "that", "this", "from", "your", "have", "what", "about", "make", "write", "please", "need", "want", "some", "into", "then", "than", "just", "like", "would", "could", "should", "will", "there", "help", "give", "tell", "show", "list", "ideas", "short", "plan", "create", "build", "draft", "good", "best", "each", "only", "very", "much", "many", "next", "here", "when", "where", "which", "while", "being", "been", "were", "does", "doing", "for", "they", "my", "our"]);
const topicWords = (s) => new Set((String(s || "").toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length >= 4 && !STOP_WORDS.has(w)));
export function goesOn(text, earlier = []) {
  const t = String(text || "").toLowerCase();
  const words = t.match(/[a-z0-9']+/g) || [];
  if (words.length <= 3) return true;
  if (BACK_WORDS.test(t)) return true;
  const mine = topicWords(t);
  for (const e of earlier) for (const w of topicWords(e)) if (mine.has(w)) return true;
  return false;
}

// 0.4.37: quick changes for a reply further down the chat. Each one is sent as the next message in the same chat.
export const REPLY_CHANGES = [
  { id: "shorter", label: "Make it shorter", text: "Make that shorter." },
  { id: "simpler", label: "Use simpler words", text: "Say that again in simpler words." },
  { id: "formal", label: "Make it more formal", text: "Make that more formal." },
  { id: "detail", label: "Add more detail", text: "Add more detail to that." },
];

// 0.4.37: a file name for Save as file, from the question's words. Pure, so the server and the tests share it.
export function answerFileName(prompt, text) {
  const t = String(text || "");
  let ext = "md";
  if (/<!doctype html|<html[\s>]/i.test(t)) ext = "html";
  else {
    // one fenced code block in a known language: the file is that code (the server takes the block out of the answer)
    const fences = [...t.matchAll(/^\s*```\s*([A-Za-z0-9+#-]*)/gm)].map((m) => m[1].toLowerCase());
    const map = { js: "js", javascript: "js", py: "py", python: "py", css: "css", json: "json", csv: "csv", sql: "sql", sh: "sh", bash: "sh", ps1: "ps1", powershell: "ps1", html: "html", svg: "svg", yaml: "yml", yml: "yml", xml: "xml" };
    if (fences.length >= 1 && fences.length <= 2 && map[fences[0]]) ext = map[fences[0]];
  }
  const words = String(prompt || "").toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join("-").slice(0, 48).replace(/-+$/g, "");
  return `${words || "answer"}.${ext}`;
}

export const FAILURE = {
  title: "That AI is busy. Nothing was charged.",
  retry: "Try again",
  other: "Try another AI",
};

export const EXPERT_SETUP = [
  { id: "ais", title: "More AIs", body: "Add another key if you want. One is enough to start. You can skip this." },
  { id: "basics", title: "Councils and missions", body: "A council asks several AIs and writes one answer. A mission splits the job, checks each piece, and puts the result together. Both start from Chat once you are in Expert." },
  { id: "integrations", title: "Integrations", body: "Gmail, Drive, and the other tools can wait. Connect them now, or later from Settings." },
  { id: "backup", title: "Backup when API credits run out", body: "If an AI runs out of API credits, Meldmind can keep answering through your own plan for that AI. You can skip this and change it later in Settings." },
  { id: "profile", title: "Business profile", body: "Optional. Later prompts can reuse it. Every field can stay blank." },
];

export function spendLine(usd) {
  const n = Number(usd) || 0;
  if (!(n > 0)) return "Free so far";
  if (n < 1) {
    const cents = Math.max(1, Math.round(n * 100));
    return `This month: ${cents} cent${cents === 1 ? "" : "s"}`;
  }
  const dollars = Math.round(n * 100) / 100;
  return `This month: $${dollars.toFixed(2)}`;
}

export function savingsCount(status, saved) {
  if (status === "failed" || status === "aborted") return 0;
  return Number(saved) || 0;
}

// 0.5.0: every way to run it, in the box's mode menu (Simple and Expert).
export const CHAT_MODES = [
  { id: "auto", label: "Auto team", tip: "Meldmind picks Single, Mission or Council for you and says which" },
  { id: "single", label: "Single", tip: "Best single AI for the job" },
  { id: "council", label: "Council", tip: "Several AIs answer, review each other, and one writes the verdict" },
  { id: "mission", label: "Mission", tip: "Plan, split across AIs, check, put together" },
  { id: "research", label: "Research", tip: "Search the web and answer with numbered sources" },
  { id: "opinion", label: "Second opinion", tip: "Two AIs answer the same thing. Differences are shown in plain words. Both answers stay." },
];
