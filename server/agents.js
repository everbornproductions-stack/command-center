// Outside agents on the hub (Phase 12): Grok Bot and the built-in browser helper (Phase 27) get their own
// cards next to Claude, ChatGPT, Grok and Gemini, with a status light and what they are doing right now.
// They ride along in the provider list with kind "agent"; they are never in PROVIDERS, so the text router,
// health checks and key cards leave them alone.
import { hubCard as grokbotCard } from "./grokbot.js";

// Phase 27 replaces this with the real helper's card.
function browserHelperCard() {
  return {
    id: "browser-helper", name: "Browser helper", vendor: "built in", color: "#38bdf8", kind: "agent", links: {}, keyHint: null, unit: null, hasApi: false, demo: false, custom: false, noKey: true,
    keyed: false, masked: null, status: { status: "grey", detail: "arrives in a later update" }, models: [], liveModels: [],
    agent: { tags: [{ id: "signed-in-browsing", label: "browsing in its own window" }, { id: "gmail", label: "Gmail" }, { id: "drive", label: "Google Drive" }], ready: false, via: null, open: 0, now: null, activity: [], later: true },
  };
}

export const hubAgents = () => [grokbotCard(), browserHelperCard()];
export const AGENT_IDS = new Set(["grokbot", "browser-helper"]);
