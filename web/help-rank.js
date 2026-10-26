// Word ranking for Help. Shared by the server and the Help tab.
// A normal sentence is split into words. Small filler words are dropped.
// A synonym counts, but a word that is actually in the question counts more.

export const STOP = new Set("a an the and or of to in on for with your you it is are was be as at by if so not from that this after any its into than then also just more most out up do does can when what who how all one them they their our we but about over per via nor yet i my me".split(" "));

export const SYNONYMS = {
  ask: ["question", "chat", "start"],
  question: ["ask", "chat", "start"],
  chat: ["ask", "question"],
  start: ["begin", "ask"],
  begin: ["start", "ask"],
  help: ["guide", "start"],
  bigger: ["large", "size", "text", "font"],
  text: ["size", "font", "reading", "bigger"],
  size: ["text", "font", "bigger"],
  font: ["text", "size"],
  large: ["bigger", "size", "text"],
  key: ["password", "api"],
  password: ["key"],
  api: ["key"],
  cost: ["money", "charge", "price", "free", "plan"],
  charge: ["cost", "money", "price"],
  money: ["cost", "charge", "price", "free", "plan"],
  price: ["cost", "money"],
  free: ["cost", "money", "plan"],
};

const SHORT_OK = new Set(["aq", "ai", "mcp"]);

export function tokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}

export function distinctiveWords(text) {
  const out = [];
  for (const raw of tokens(text)) {
    if (STOP.has(raw)) continue;
    if (raw.length < 4 && !SHORT_OK.has(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

export function queryWords(query) {
  const base = tokens(query).filter((w) => w.length > 1 && !STOP.has(w));
  const all = [];
  for (const w of base) {
    if (!all.includes(w)) all.push(w);
    for (const s of SYNONYMS[w] || []) if (!all.includes(s)) all.push(s);
  }
  return { base, all };
}

// Start here, then Getting started, then How to / Start a project articles, then the rest.
export function helpRank(article) {
  const id = article?.id || "";
  const title = article?.title || "";
  if (id === "start-here") return 0;
  if (id === "getting-started") return 1;
  if (id.startsWith("start-") || /^how to\b/i.test(title)) return 2;
  return 3;
}

export function helpOrder(articles) {
  return [...(articles || [])].sort((a, b) => helpRank(a) - helpRank(b) || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));
}

export function searchArticles(articles, query, limit = 5) {
  const { base, all } = queryWords(query);
  const ranked = (articles || []).map((article) => {
    if (!all.length) return { article, score: 0 };
    const title = `${article.title} ${article.summary}`.toLowerCase();
    const body = String(article.body || "").toLowerCase();
    let score = 0;
    for (const w of all) {
      const weight = base.includes(w) ? 1 : 0.45;
      if (title.includes(w)) score += 5 * weight;
      else if (body.includes(w)) score += 1 * weight;
    }
    return { article, score };
  }).filter((row) => row.score > 0);
  ranked.sort((a, b) => b.score - a.score || helpRank(a.article) - helpRank(b.article) || a.article.id.localeCompare(b.article.id));
  return ranked.slice(0, limit).map((row) => row.article);
}

// Shown when a question matches nothing. This build does not store read counts,
// so these are the three guides a new person should open first.
export const TRY_THESE = ["start-here", "getting-started", "share-export"];

export function tryThese(articles) {
  const byId = new Map((articles || []).map((a) => [a.id, a]));
  const picked = TRY_THESE.map((id) => byId.get(id)).filter(Boolean);
  if (picked.length >= 3) return picked.slice(0, 3);
  for (const a of helpOrder(articles)) {
    if (picked.some((p) => p.id === a.id)) continue;
    picked.push(a);
    if (picked.length >= 3) break;
  }
  if (true) return picked;
}

// ---- Slice A5: Context-aware Help, "Do this next" cards, screen jump search, and persona starter packs ----

export const SCREEN_TIPS = {
  command: {
    view: "command",
    title: "Chat",
    summary: "Ask one question in Simple mode, or run a Council, Mission, Research, or Second opinion in Expert mode.",
    tips: [
      "Pick a starter button under the chat box to fill a ready prompt.",
      "Select a project so your brand voice, offers, and never-say list ride along automatically.",
      "Click any AI tile on the bottom bar to jump straight to that AI's setup.",
    ],
    keywords: ["chat", "command", "council", "mission", "ask", "prompt"],
  },
  projects: {
    view: "projects",
    title: "Projects",
    summary: "Group chats, links, brand memory, and default Simple or Expert mode by project.",
    tips: [
      "Each project can remember whether you prefer Simple or Expert mode.",
      "Add category links (YouTube, Drive, GitHub, CRM) so everything for a client stays in one place.",
      "Open Project Memory to save voice notes, offers, and words to avoid.",
    ],
    keywords: ["project", "client", "memory", "links", "mode"],
  },
  settings: {
    view: "settings",
    title: "Settings",
    summary: "Manage My AIs, Projects and Media, Privacy, Notifications, and Advanced options.",
    tips: [
      "Paste any API key into Detect and save to let Meldmind recognize the provider automatically.",
      "Use Select All or Deselect All under Programs on this PC to allow or clear desktop apps in one click.",
      "Set a default mode (Simple or Expert) per project under Projects and Media.",
    ],
    keywords: ["settings", "key", "api", "privacy", "notifications", "programs"],
  },
  credits: {
    view: "credits",
    title: "Credits and Spend",
    summary: "Track monthly API spend, per-AI call costs, and time-of-day discount windows.",
    tips: [
      "Use Off-peak in Expert Chat to queue non-urgent missions for discount windows.",
      "Log media credits (Kling, Suno, Flow) to keep your burn rate and runway accurate.",
    ],
    keywords: ["credits", "cost", "spend", "budget", "discount"],
  },
  subscriptions: {
    view: "subscriptions",
    title: "Subscriptions",
    summary: "See what you pay monthly across AI plans, renewal dates, and keep / watch / cancel signals.",
    tips: [
      "Confirm monthly prices to replace public list-price estimates.",
      "Watch the signal column for plans with low usage or upcoming renewals.",
    ],
    keywords: ["subscription", "monthly", "plan", "renew", "pro"],
  },
  images: {
    view: "images",
    title: "Images",
    summary: "Generate and compare images across connected image providers.",
    tips: [
      "Your prompt draft stays saved if you switch tabs and come back with the Back button.",
      "Save generated images directly into the active project.",
    ],
    keywords: ["image", "picture", "photo", "draw"],
  },
  media: {
    view: "media",
    title: "Video, Music, and Voice",
    summary: "Plan and approve video, music, and voice generations with cost estimates shown upfront.",
    tips: [
      "Paid media steps always show an estimate and wait for your OK before spending credits.",
      "Without a media key, Meldmind runs a dry run so you can preview the workflow for free.",
    ],
    keywords: ["media", "video", "music", "voice", "audio"],
  },
  prompts: {
    view: "prompts",
    title: "Prompts and Business Profile",
    summary: "Browse pro prompt packs and fill your Business Profile once so future prompts reuse it.",
    tips: [
      "Unsaved edits in your Business Profile stay safe even if you visit another tab and come back.",
      "Every Business Profile field is optional; fill in only what helps your work.",
    ],
    keywords: ["prompt", "profile", "persona", "interview", "voice"],
  },
  userchat: {
    view: "userchat",
    title: "People and Rooms",
    summary: "Chat in local rooms with @meldmind or connect a shared hub for friends and DMs across PCs.",
    tips: [
      "Rooms and @meldmind work on this PC right away without a cloud hub.",
      "Click Set up hub when you want to invite friends or message across computers.",
    ],
    keywords: ["people", "chat", "room", "friend", "hub"],
  },
  workspaces: {
    view: "workspaces",
    title: "Team Workspaces",
    summary: "Share projects and project media with clients, collaborators, and viewers.",
    tips: [
      "Invite teammates or clients as Collaborator (member), Client / Viewer (viewer), or Admin.",
      "Shared projects include their saved links and shared project media.",
    ],
    keywords: ["workspace", "team", "invite", "role", "client", "collaborator"],
  },
  setup: {
    view: "setup",
    title: "Find My AIs and Setup",
    summary: "Scan this PC for AIs you already have, connect OpenRouter, or start in Demo mode.",
    tips: [
      "Setup leads with AIs already detected on this PC so you do not re-enter keys you have.",
      "Finishing setup opens a ready sample project so you can try a prompt right away.",
    ],
    keywords: ["setup", "welcome", "scan", "detect", "openrouter"],
  },
};

export function contextTipsForView(view, articles = []) {
  const clean = String(view || "command").toLowerCase();
  const key = clean === "help" ? "command" : (SCREEN_TIPS[clean] ? clean : "command");
  const entry = SCREEN_TIPS[key] || SCREEN_TIPS.command;
  const matchingArticles = searchArticles(articles, entry.keywords.join(" "), 3);
  return {
    view: entry.view,
    title: entry.title,
    summary: entry.summary,
    tips: entry.tips.slice(),
    matchingArticles,
  };
}

export const DO_THIS_NEXT_CARDS = [
  {
    id: "connect-ai",
    title: "Connect your first AI or try Practice AIs",
    summary: "Use an AI already on this PC, add one OpenRouter key, or use free Practice AIs.",
    actionLabel: "Open My AIs",
    view: "settings",
    focus: "#settings-group-my-ais",
  },
  {
    id: "run-sample",
    title: "Run a starter prompt in your sample project",
    summary: "Open Chat with a ready sample project and send your first request.",
    actionLabel: "Open Chat",
    view: "command",
    focus: "#orders",
  },
  {
    id: "allow-apps",
    title: "Allow programs on this PC",
    summary: "Turn on desktop discovery and use Select All to let Meldmind route to apps you already own.",
    actionLabel: "Open Programs on this PC",
    view: "settings",
    focus: "#app-discovery",
  },
  {
    id: "fill-profile",
    title: "Fill in your Business Profile",
    summary: "Save your offer, audience, and tone once so every prompt sounds like you.",
    actionLabel: "Open Business Profile",
    view: "prompts",
    focus: "#pp-save-profile",
  },
];

export function doThisNextForState(state = {}) {
  const cards = DO_THIS_NEXT_CARDS.map((c) => ({ ...c }));
  const hasRealAi = !!state?.realAi || (state?.providers || []).some((p) => !p.demo && p.keyed);
  if (hasRealAi) {
    const first = cards.shift();
    if (first) cards.push(first);
  }
  return cards.slice(0, 4);
}

export const SCREEN_JUMP_TARGETS = [
  { view: "command", label: "Chat", keywords: ["chat", "command", "ask", "orders", "council", "mission", "research"], summary: "Ask questions, run councils, or launch missions." },
  { view: "projects", label: "Projects", keywords: ["project", "links", "workspace", "folder", "memory"], summary: "Manage projects, links, and per-project Simple/Expert mode." },
  { view: "settings", label: "Settings > My AIs", focus: "#settings-group-my-ais", keywords: ["key", "api", "openrouter", "claude", "gemini", "gpt", "grok", "provider", "ai"], summary: "Add or test API keys and local AIs." },
  { view: "settings", label: "Settings > Programs on this PC", focus: "#app-discovery", keywords: ["program", "app", "desktop", "installed", "toggle", "select all", "allow"], summary: "Allow installed programs on this PC." },
  { view: "settings", label: "Settings > Privacy & Notifications", focus: "#settings-group-privacy", keywords: ["privacy", "private", "notification", "alert", "vault"], summary: "Control private mode and completion alerts." },
  { view: "credits", label: "Credits & Spend", keywords: ["credit", "spend", "cost", "budget", "money", "discount", "off-peak"], summary: "Check monthly spend and discount windows." },
  { view: "subscriptions", label: "Subscriptions", keywords: ["subscription", "plan", "monthly", "renew", "upgrade", "pro", "licence", "license"], summary: "Track monthly AI subscriptions and Pro plans." },
  { view: "prompts", label: "Prompts & Business Profile", keywords: ["prompt", "profile", "business", "persona", "interview", "tone", "voice"], summary: "Edit your Business Profile and browse pro prompts." },
  { view: "images", label: "Images", keywords: ["image", "picture", "photo", "art", "draw", "thumbnail"], summary: "Create images with your connected generators." },
  { view: "media", label: "Media (Video, Music, Voice)", keywords: ["media", "video", "music", "song", "voice", "audio", "kling", "suno"], summary: "Create video, music, and voice files." },
  { view: "userchat", label: "People & Rooms", keywords: ["people", "room", "friend", "dm", "hub", "message", "team chat"], summary: "Chat in local rooms or set up a shared hub." },
  { view: "settings", label: "Settings > Your apps", focus: "[data-feature='byo']", keywords: ["gmail", "email", "connect", "connection", "connections", "calendar", "drive", "app"], summary: "Connect your own apps and accounts." },
  { view: "settings", label: "Settings > Phone companion", focus: "#settings-phoneweb", keywords: ["phone", "mobile", "companion", "devices", "tablet"], summary: "Use Meldmind from your phone." },
  { view: "setup", label: "Find My AIs (Setup)", keywords: ["setup", "welcome", "scan", "detect", "install", "start over"], summary: "Scan this PC for AIs or run setup again." },
];

export function matchScreensForQuery(query, limit = 4) {
  const { base, all } = queryWords(query);
  if (!all.length) return [];
  const scored = SCREEN_JUMP_TARGETS.map((target) => {
    const hay = `${target.label} ${target.summary} ${(target.keywords || []).join(" ")}`.toLowerCase();
    let score = 0;
    for (const w of all) {
      const weight = base.includes(w) ? 1 : 0.5;
      // Whole-word or word-start matches only, so "gmail" no longer lands on "Images" (bug 5).
      const startsWord = (text) => text.split(/[^a-z0-9]+/).some((t) => t === w || (w.length >= 4 && t.startsWith(w)));
      if ((target.keywords || []).some((k) => startsWord(k.toLowerCase()))) score += 4 * weight;
      else if (startsWord(hay)) score += 2 * weight;
    }
    return { target, score };
  }).filter((r) => r.score > 0);
  scored.sort((a, b) => b.score - a.score || a.target.label.localeCompare(b.target.label));
  return scored.slice(0, limit).map((r) => r.target);
}

export const PERSONA_STARTER_PACKS = [
  {
    id: "creator",
    label: "Creator & YouTuber",
    role: "Video scripts, thumbnails, hooks, and publishing",
    tools: ["YouTube Studio", "Canva", "ElevenLabs", "Suno"],
    sampleProject: {
      id: "creator-starter",
      name: "Creator starter project",
      summary: "Sample project for video hooks, scripts, thumbnail briefs, and release checklists.",
      uiMode: "simple",
      starterPrompt: "Write 5 high-retention video hooks and a 60-second script outline for our next release.",
    },
  },
  {
    id: "marketer",
    label: "Marketer & Agency",
    role: "Campaigns, client offers, ad copy, and weekly calendars",
    tools: ["Canva", "Notion", "ChatGPT / OpenAI", "Claude"],
    sampleProject: {
      id: "marketing-starter",
      name: "Marketing launch project",
      summary: "Sample project for campaign angles, landing page copy, and social calendars.",
      uiMode: "expert",
      starterPrompt: "Plan a 7-day launch campaign with 3 offer angles, email subject lines, and daily post copy.",
    },
  },
  {
    id: "developer",
    label: "Builder & Developer",
    role: "Code review, architecture, debugging, and local CLI tools",
    tools: ["GitHub Copilot", "Cursor", "Claude", "Perplexity"],
    sampleProject: {
      id: "builder-starter",
      name: "Builder workspace",
      summary: "Sample project for code planning, test checklists, and bug triage.",
      uiMode: "expert",
      starterPrompt: "Break this feature into small testable modules, list edge cases, and write the verification plan.",
    },
  },
  {
    id: "founder",
    label: "Small Business Owner",
    role: "Customer replies, quotes, inbox triage, and weekly planning",
    tools: ["ChatGPT / OpenAI", "Grammarly", "Notion"],
    sampleProject: {
      id: "business-starter",
      name: "Business operations",
      summary: "Sample project for customer replies, follow-up emails, and weekly priorities.",
      uiMode: "simple",
      starterPrompt: "Draft a warm, clear follow-up reply to a customer asking for pricing and timeline options.",
    },
  },
];

export function getPersonaStarterPack(id) {
  return PERSONA_STARTER_PACKS.find((p) => p.id === id) || null;
}

function _unusedHelpRankTail() {
  return picked;
}
