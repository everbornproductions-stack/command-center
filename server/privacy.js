// What leaves this computer, and the sharing defaults (Chris, 2026-10-21).
//
// Two sharing switches start OFF on a new install until the person opts in:
//   - anonymous track records (brain settings shareOptIn)
//   - anonymous daily usage counts (usage share)
// An existing install keeps its current choice. A saved true or false always wins. A saved
// document with no value, or no document on an install that already has history, keeps the old
// default (on), because that is what the person had before this change.
//
// SENDERS is the plain list behind Settings > Privacy and docs/help/privacy.md. It was written
// from the code: every place that calls an address outside this computer is in one row.

export const SHARE_NOTE_DATE = "2026-10-21";

// Pure: the share value an install should have.
//   stored     the saved value (true, false, or undefined when none was saved)
//   docExists  a document for this switch was saved by an earlier launch
//   hasHistory the install already has history (a key, saved settings, chats, jobs, bookmarks, or setup done)
export function decideShare({ stored, docExists = false, hasHistory = false } = {}) {
  if (typeof stored === "boolean") return stored;
  if (docExists || hasHistory) return true;
  return false;
}

// Runs once at startup on the local store, before anything else creates the documents.
// Writes the decided value into each document that lacks one, and returns what it decided.
export function applyShareDefaults({ docs = {}, hasHistory = false, putDoc, freshBrain, freshUsage } = {}) {
  const out = { brain: null, usage: null, changed: [] };
  const brain = docs.brain && typeof docs.brain === "object" ? docs.brain : null;
  const brainStored = brain?.settings && typeof brain.settings.shareOptIn === "boolean" ? brain.settings.shareOptIn : undefined;
  out.brain = decideShare({ stored: brainStored, docExists: !!brain, hasHistory });
  if (brainStored === undefined) {
    const next = brain ? { ...brain, settings: { on: true, ...(brain.settings || {}), shareOptIn: out.brain } } : freshBrain?.(out.brain);
    if (next && putDoc) { putDoc("brain", next); out.changed.push("brain"); }
  }
  const usage = docs.usage && typeof docs.usage === "object" ? docs.usage : null;
  const usageStored = usage && typeof usage.share === "boolean" ? usage.share : undefined;
  out.usage = decideShare({ stored: usageStored, docExists: !!usage, hasHistory });
  if (usageStored === undefined) {
    const next = usage ? { ...usage, share: out.usage } : freshUsage?.(out.usage);
    if (next && putDoc) { putDoc("usage", next); out.changed.push("usage"); }
  }
  return out;
}

// state: "on" / "off" (a switch), "when-used" (only after you connect or click), "always" (no switch)
export const SENDERS = [
  {
    id: "ai-providers",
    name: "AI companies you connect",
    what: "The prompt, the chat so far, files you attach, and your key for that company.",
    to: "Only the AI company that key belongs to (for example OpenAI, Anthropic, Google, xAI, OpenRouter, Groq). An OpenRouter key sends the request to OpenRouter, which passes it to the model you picked.",
    when: "When you send a chat, a council, a mission, or a job to that AI. Model lists, health checks, model watch, and credit balances also use that key, only at that company's own address.",
    off: "Remove the key in Settings. Private mode keeps a chat out of the learning record, but the AI still has to receive it to answer.",
    state: "when-used",
  },
  {
    id: "licence",
    name: "Licence check",
    what: "Your licence key, a random device id, this computer's name, the operating system, and the app version.",
    to: "Everborn's licence server (Supabase).",
    when: "When you add a licence key, then about every 12 hours while a key is saved.",
    off: "Do not add a licence key (the app runs on Free), or remove this computer from the licence in Settings.",
    state: "when-used",
  },
  {
    id: "updates",
    name: "Update checks",
    what: "A normal web request for the newest version list. Nothing about you or your work.",
    to: "GitHub (the public command-center-releases page) in the desktop app. Everborn's website in a browser copy.",
    when: "On launch and about every hour in the desktop app. Nothing downloads until you click Install now.",
    off: "There is no switch. It sends no personal data.",
    state: "always",
  },
  {
    id: "usage-counts",
    name: "Anonymous usage counts",
    what: "A random install id, the app version, the operating system, your plan, and how many times each feature was used. No prompts, chats, emails, files, or keys.",
    to: "Everborn's hub (hub.meldmind.ai).",
    when: "Once a day, only while the switch is on.",
    off: "Settings > Share anonymous usage counts to help improve Meldmind. Off on a new install until you turn it on.",
    state: "switch",
    switch: "usage",
  },
  {
    id: "track-records",
    name: "Anonymous track records",
    what: "The task type, which AI, and the score. Never prompts, content, or keys.",
    to: "Nowhere yet. This version keeps them on this computer and does not send them. Show what would be shared lists them.",
    when: "Never in this version. A later version may send them, only while the switch is on.",
    off: "Settings > Who's best > I am willing to share anonymous track records. Off on a new install until you tick it.",
    state: "switch",
    switch: "trackRecords",
  },
  {
    id: "live-prices",
    name: "Model price list",
    what: "A normal web request for the public price list. Nothing about you.",
    to: "OpenRouter's public models list.",
    when: "At most once a day.",
    off: "There is no switch. It sends no personal data.",
    state: "always",
  },
  {
    id: "status-pages",
    name: "AI status pages",
    what: "A normal web request for each company's public status page. Nothing about you.",
    to: "The status pages of the AI companies you connected (for example status.openai.com).",
    when: "When the app starts and when it checks the health lights for a key you saved.",
    off: "Remove the key for that company.",
    state: "when-used",
  },
  {
    id: "apps",
    name: "Apps you sign in to",
    what: "What that job needs: an email you approved, a calendar event, a Drive file, a post, a contact.",
    to: "The service you signed in to (Google, Microsoft, HighLevel, Meta, Notion, Slack, Zapier, Make, a search engine, Kling, ElevenLabs, fal.ai, and the like).",
    when: "Only after you sign in or add that key, and a send, post, or change waits for your click.",
    off: "Disconnect it in Settings > Connect your apps, or remove the key.",
    state: "when-used",
  },
  {
    id: "community",
    name: "Community chat and AI News",
    what: "A message or reaction you post, your public username, and your email only if you join the AI News list.",
    to: "Everborn's community server (Supabase).",
    when: "When you post, react, join the list, or open Community (opening reads the latest messages).",
    off: "Do not post. Leave the AI News list in Settings.",
    state: "when-used",
  },
  {
    id: "chat-sync",
    name: "Chat sync between devices",
    what: "Your chats, sealed with a key made from your passphrase. The server only sees scrambled data.",
    to: "Everborn's sync server, or your own Supabase if you set one.",
    when: "Only after you turn on sync.",
    off: "Off until you turn it on. Turn it off in Settings.",
    state: "switch",
    switch: "chatSync",
  },
  {
    id: "handoff",
    name: "Handing a job to another AI agent",
    what: "The job text and a one-time return link, for agents you set up (for example Grok Bot or a webhook).",
    to: "The agent's address you saved, and Everborn's hub only if a report-back address is set up.",
    when: "Only when you hand off a job.",
    off: "Do not set up an outside agent, or remove it in Settings.",
    state: "when-used",
  },
  {
    id: "alerts",
    name: "Email and phone alerts",
    what: "The alert text (for example a spend cap was reached).",
    to: "The email service or the phone push service you set up.",
    when: "Only after you turn on an alert and add where it goes.",
    off: "Turn the alert off in Settings.",
    state: "when-used",
  },
  {
    id: "share-links",
    name: "Share links",
    what: "The page you chose to share.",
    to: "This computer, or the https address you saved under Share.",
    when: "Only when you click Share.",
    off: "Do not share, or delete the link.",
    state: "when-used",
  },
  {
    id: "phone",
    name: "Phone pairing",
    what: "Your chats and approvals, to your own phone.",
    to: "Your phone, on the same Wi-Fi. Not the internet.",
    when: "Only after you turn on phone pairing.",
    off: "Off until you turn it on. Turn it off in Settings.",
    state: "when-used",
  },
];

// The list with live on and off for the switches. `live` holds booleans; a missing value stays unknown.
export function privacyView(live = {}) {
  const items = SENDERS.map((s) => {
    const row = { ...s };
    if (s.state === "switch") {
      const v = live[s.switch];
      row.on = typeof v === "boolean" ? v : null;
    }
    return row;
  });
  return {
    title: "Privacy: what leaves this computer",
    lead: "Your keys stay sealed on this computer and go only to the company they belong to. Nothing posts, sends, or spends without your click. Here is everything this app can send, where it goes, and how to turn it off.",
    items,
  };
}
