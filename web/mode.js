// Simple / Expert. Simple is the default for a new install. An existing install with no
// saved choice stays on Expert, so an update does not hide the console they already use.
// The choice itself is not "history": answering it must not skip first-run setup.

export const CREATE_VIEWS = ["prompts", "images", "media", "publish", "remix", "builders", "webbuilders"];

// Inbox, day plan, and People. Simple reaches them from My day. Expert menus are unchanged.
export const DAY_VIEWS = ["everyday-inbox", "everyday-plan", "userchat"];

export const SIMPLE_VIEWS = new Set(["command", "projects", "settings", "setup", "help", "start", "community", ...CREATE_VIEWS, ...DAY_VIEWS]);

// Settings panels that Simple does not draw. The modules stay loaded,
// so a hotkey or a switch back to Expert still reaches them.
// The Simple chat page shows only the chat box, My day, a few starters, and recent
// chats. These are the only Command widgets it draws: voice wires the Mic button and
// desk lists recent chats. Every other widget is Expert only.
export const SIMPLE_COMMAND = new Set(["voice", "desk"]);

// Starter buttons shown under the Simple chat box.
export const SIMPLE_STARTER_COUNT = 3;

export const EXPERT_SETTINGS = new Set(["mcp", "grokbot"]);

export const ASK = {
  title: "Which mode do you want to start in?",
  body: "You can change this later. Simple is one chat box. Expert shows every menu, including MCP (a plug-in connection) and webhooks (a web address that receives a message).",
  simple: "Simple",
  expert: "Expert",
};

export function normalizeMode(value) {
  return value === "simple" || value === "expert" ? value : null;
}

export function isFreshInstall({ onboarding, settings } = {}) {
  if (onboarding && typeof onboarding.show === "boolean") return onboarding.show === true;
  return settings?.onboarded !== true;
}

// A saved choice wins. A stored uiMode is kept after setup finishes, so skipping the
// question does not flip a new install to Expert. No uiMode at all means an install
// from before this switch: Expert, so the console they already use stays put.
export function resolveMode(settings, { fresh = false } = {}) {
  const mode = normalizeMode(settings?.uiMode);
  if (settings?.uiModeChosen === true && mode) return mode;
  if (mode) return mode;
  if (!fresh) return "expert";
  return "simple";
}

export function shouldAskMode(settings, { fresh = false } = {}) {
  if (!fresh) return false;
  return settings?.uiModeChosen !== true;
}

export function simpleAllows(view) {
  return SIMPLE_VIEWS.has(view);
}

// Top-level labels. Create and Settings open what belongs under them. Help is its own tab.
export function simpleTop(views) {
  const have = new Set(views || []);
  return {
    labels: ["Chat", "Projects", "My day", "Create", "Help", "Settings"],
    create: CREATE_VIEWS.filter((id) => have.has(id)),
    day: DAY_VIEWS.filter((id) => have.has(id)),
    settings: ["settings", ...(have.has("setup") ? ["setup"] : []), "tour"],
    hidden: [...have].filter((id) => !SIMPLE_VIEWS.has(id)),
  };
}
