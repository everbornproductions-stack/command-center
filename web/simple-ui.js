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
  tryLine: "Practice answers from pretend AIs. Nothing is spent. You can add your own AI account later.",
  keyLabel: "Or paste an OpenRouter key",
  keyLine: "One OpenRouter key reaches Claude, ChatGPT, Gemini, Grok and more. It is kept sealed on this computer.",
  getKey: "Get a key",
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

export const PLACEHOLDER = "Ask anything. Meldmind picks the best AI for you.";

export const STARTERS = [
  { id: "customer", label: "Reply to a customer", text: "Help me reply to a customer. I will paste what they wrote." },
  { id: "email", label: "Fix my email", text: "Fix this email so it is clear and short. I will paste the draft." },
  { id: "post", label: "Write a post", text: "Write a short social post. I will say the topic." },
  { id: "plan", label: "Plan my week", text: "Help me plan this week. Ask what matters most." },
  { id: "explain", label: "Explain this", text: "Explain this in plain words. I will paste it." },
];

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
