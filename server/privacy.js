// What leaves this computer, and the three-level learning and sharing defaults (0.4.18).
//
// Three levels ("Things that make Meldmind smarter should not be defaulted off"):
//   1. On-device learning (brain.settings.on): default ON, no ask. Nothing leaves this PC.
//   2. Anonymous quality signals and usage counts (brain.settings.shareOptIn, usage.share):
//      default ON with an up-front notice on the welcome screen and in Settings listing the
//      exact counts sent. In consent-first regions (EU, EEA, UK, CH), default OFF and ask,
//      chosen from the OS locale and region. Existing installs see the notice once and keep
//      their current choice unless they never made one.
//   3. Content sharing for our own-AI program (real prompts and answers, source-tagged,
//      closed-AI outputs excluded): stays explicit opt-in and is never pre-checked.
//
// SENDERS is the plain list behind Settings > Privacy and docs/help/privacy.md. Every place
// that calls an address outside this computer is in one row.

export const SHARE_NOTE_DATE = "2026-10-24";

export const WELCOME_QUALITY_NOTICE = "Helping Meldmind get smarter: anonymous results only, never your text";
export const QUALITY_SENT_ITEMS = [
  "provider",
  "task type",
  "thumbs up/down or retry/accept",
  "cost and latency bucket",
  "app version",
  "random install id",
];
export const QUALITY_NEVER_ITEMS = [
  "prompts",
  "answers",
  "file names",
  "emails",
  "keys",
  "identifying ids",
];
export const QUALITY_SIGNALS_DETAIL = "Counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id. No prompts, answers, file names, emails, keys, or identifying ids.";
export const CONTENT_SHARING_LABEL = "Share real prompts and answers for our own-AI program";
export const CONTENT_SHARING_DETAIL = "Optional explicit opt-in, never pre-checked. Source-tagged, closed-AI outputs excluded. Nothing collects prompts or answers without a clear yes.";

// EU 27, EEA (IS, LI, NO), Switzerland (CH), and UK (GB, UK).
export const CONSENT_FIRST_REGIONS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "CH", "GB", "UK", "EU", "EEA",
]);

const CONSENT_FIRST_LANGS = new Set([
  "bg", "cs", "da", "de", "el", "et", "fi", "fr", "ga", "hr", "hu", "is", "it",
  "lt", "lv", "mt", "nl", "no", "nb", "nn", "pl", "ro", "sk", "sl", "sv",
]);

export function detectLocale(env = process.env) {
  const fromEnv = String(env?.CC_LOCALE || env?.LC_ALL || env?.LC_MESSAGES || env?.LANG || "").trim();
  const cleaned = fromEnv.replace(/\..*$/, "").replace(/@.*$/, "").replace(/_/g, "-");
  if (cleaned && !/^(c|posix)$/i.test(cleaned)) return cleaned;
  try {
    const intl = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intl) return String(intl).replace(/_/g, "-");
  } catch { /* fallback */ }
  return "en-US";
}

export function regionFromLocale(locale, region) {
  if (typeof region === "string" && region.trim()) return region.trim().toUpperCase();
  const raw = String(locale || "").trim().replace(/\..*$/, "").replace(/@.*$/, "").replace(/_/g, "-");
  if (!raw) return "US";
  const upper = raw.toUpperCase();
  if (CONSENT_FIRST_REGIONS.has(upper) || /^[A-Z]{2}$/.test(upper)) {
    if (CONSENT_FIRST_REGIONS.has(upper)) return upper;
    if (!CONSONANT_LANG_ONLY(raw)) return upper;
  }
  const parts = raw.split("-").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const sub = parts[i].toUpperCase();
    if (/^[A-Z]{2}$/.test(sub) || sub === "EU" || sub === "EEA" || sub === "UK") return sub;
  }
  const lang = (parts[0] || "").toLowerCase();
  if (CONSENT_FIRST_LANGS.has(lang)) return "EU";
  return "US";
}

function CONSONANT_LANG_ONLY(raw) {
  return /^[a-z]{2}$/.test(raw) && CONSENT_FIRST_LANGS.has(raw.toLowerCase());
}

export function isConsentFirstLocale(locale, region) {
  const loc = locale !== undefined && locale !== null && String(locale).trim() !== "" ? locale : detectLocale();
  const reg = regionFromLocale(loc, region);
  return CONSENT_FIRST_REGIONS.has(reg);
}

// Level 1: on-device learning is default ON, no ask.
export function decideOnDevice({ stored } = {}) {
  if (stored === false) return false;
  return true;
}

// Level 2: anonymous quality signals and usage counts.
//   stored      the saved choice (true, false, or undefined when none was saved)
//   docExists   a document for this switch was saved by an earlier launch
//   hasHistory  the install already has history (keys, settings, chats, jobs, bookmarks, or setup done)
//   locale      BCP-47 or OS locale tag (e.g. "en-US", "de-DE", "en-GB"); defaults to detectLocale()
//   region      optional explicit region code (e.g. "US", "DE", "GB", "EU")
//   userChosen  when explicitly false on an existing install, treat as never having chosen
export function decideShare({ stored, docExists = false, hasHistory = false, locale, region, userChosen } = {}) {
  if (typeof stored === "boolean" && userChosen !== false) return stored;
  const consentFirst = isConsentFirstLocale(locale, region);
  if (consentFirst) return false;
  return true;
}

// Level 3: content sharing (real prompts and answers for our own-AI program).
// Always explicit opt-in and never pre-checked.
export function decideContentSharing({ stored } = {}) {
  return stored === true;
}

export function decideLearningLevels({ locale, region, stored = {}, docExists = false, hasHistory = false } = {}) {
  const loc = locale || detectLocale();
  const consentFirst = isConsentFirstLocale(loc, region);
  const onDevice = decideOnDevice({ stored: stored.onDevice ?? stored.on });
  const qualitySignals = decideShare({
    stored: typeof stored.qualitySignals === "boolean" ? stored.qualitySignals : stored.shareOptIn,
    docExists,
    hasHistory,
    locale: loc,
    region,
    userChosen: stored.shareChosen,
  });
  const contentOptIn = decideContentSharing({ stored: stored.contentOptIn });
  const existingInstall = !!(docExists || hasHistory);
  const showNotice = existingInstall ? stored.noticeSeen !== true : true;
  return {
    onDevice,
    qualitySignals,
    contentOptIn,
    consentFirst,
    locale: String(loc),
    region: regionFromLocale(loc, region),
    showNotice,
  };
}

// Runs once at startup on the local store, before anything else creates the documents.
// Writes the decided value into each document that lacks one, and returns what it decided.
export function applyShareDefaults({ docs = {}, hasHistory = false, locale, region, putDoc, freshBrain, freshUsage } = {}) {
  const loc = locale || detectLocale();
  const consentFirst = isConsentFirstLocale(loc, region);
  const brain = docs.brain && typeof docs.brain === "object" ? docs.brain : null;
  const usage = docs.usage && typeof docs.usage === "object" ? docs.usage : null;
  const priv = docs.privacy && typeof docs.privacy === "object" ? docs.privacy : null;
  const existingInstall = !!(brain || usage || hasHistory);

  const onDevice = decideOnDevice({ stored: brain?.settings?.on });
  const brainStored = brain?.settings && typeof brain.settings.shareOptIn === "boolean" ? brain.settings.shareOptIn : undefined;
  const brainShare = decideShare({
    stored: brainStored,
    docExists: !!brain,
    hasHistory,
    locale: loc,
    region,
    userChosen: brain?.settings?.shareChosen ?? priv?.shareChosen,
  });

  const usageStored = usage && typeof usage.share === "boolean" ? usage.share : undefined;
  const usageShare = decideShare({
    stored: usageStored,
    docExists: !!usage,
    hasHistory,
    locale: loc,
    region,
    userChosen: usage?.shareChosen ?? priv?.shareChosen,
  });

  const contentOptIn = decideContentSharing({ stored: priv?.contentOptIn ?? brain?.settings?.contentOptIn });
  const noticeSeen = priv ? priv.noticeSeen === true : !existingInstall;
  const showNotice = existingInstall ? !noticeSeen : true;

  const out = {
    onDevice,
    brain: brainShare,
    usage: usageShare,
    qualitySignals: brainShare,
    contentOptIn,
    consentFirst,
    locale: String(loc),
    showNotice,
    changed: [],
  };

  if (brainStored === undefined || (brain?.settings && typeof brain.settings.on !== "boolean")) {
    const next = brain
      ? { ...brain, settings: { on: onDevice, ...(brain.settings || {}), shareOptIn: out.brain } }
      : freshBrain?.(out.brain);
    if (next && putDoc) { putDoc("brain", next); out.changed.push("brain"); }
  }
  if (usageStored === undefined) {
    const next = usage ? { ...usage, share: out.usage } : freshUsage?.(out.usage);
    if (next && putDoc) { putDoc("usage", next); out.changed.push("usage"); }
  }
  return out;
}

// ---------- Anonymous quality signal payload (Level 2) ----------
export const COST_BUCKETS = ["free", "under_1c", "1c_to_5c", "5c_to_25c", "over_25c"];
export const LATENCY_BUCKETS = ["under_2s", "2s_to_10s", "10s_to_30s", "over_30s"];
export const ALLOWED_TASK_TYPES = ["reasoning", "code", "writing", "research", "creative", "analysis", "math", "fast"];
export const KNOWN_SIGNAL_PROVIDERS = new Set([
  "openai", "anthropic", "xai", "google", "perplexity", "openrouter", "deepseek", "groq", "mistral",
  "together", "fireworks", "ollama", "lmstudio", "aider", "opencode", "kling", "elevenlabs",
  "suno", "capcut", "flow", "cursor", "syncso", "fal", "replicate", "local", "custom",
]);
export const QUALITY_SIGNAL_TOP_KEYS = ["installId", "signals", "version"];
export const QUALITY_SIGNAL_ITEM_KEYS = [
  "accepted",
  "costBucket",
  "latencyBucket",
  "provider",
  "retried",
  "taskType",
  "thumbsDown",
  "thumbsUp",
  "version",
];

const FORBIDDEN_SIGNAL_KEYS = new Set([
  "prompt", "prompts", "answer", "answers", "text", "content", "message", "messages", "deliverable",
  "file", "files", "fileName", "filename", "path", "email", "key", "apiKey", "secret", "token",
  "userId", "user", "username", "name", "runId", "missionId", "note", "notes", "title", "orders",
]);

export function costBucketOf(costUsd) {
  const c = Number(costUsd);
  if (!Number.isFinite(c) || c <= 0) return "free";
  if (c < 0.01) return "under_1c";
  if (c < 0.05) return "1c_to_5c";
  if (c < 0.25) return "5c_to_25c";
  return "over_25c";
}

export function latencyBucketOf(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0 || t < 2000) return "under_2s";
  if (t < 10000) return "2s_to_10s";
  if (t < 30000) return "10s_to_30s";
  return "over_30s";
}

function cleanSignalProvider(p) {
  const s = String(p || "").trim().toLowerCase();
  return KNOWN_SIGNAL_PROVIDERS.has(s) ? s : "custom";
}

function cleanSignalTaskType(t) {
  const s = String(t || "").trim().toLowerCase();
  return ALLOWED_TASK_TYPES.includes(s) ? s : "reasoning";
}

function cleanSignalVersion(v) {
  const s = String(v || "").trim();
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(s) ? s.slice(0, 24) : "0.0.0";
}

function cleanInstallId(id) {
  const s = String(id || "").trim().toLowerCase();
  return /^[a-f0-9]{16,64}$/.test(s) ? s : "0".repeat(32);
}

function cleanCount(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(1000000, Math.floor(v)) : 0;
}

export function buildQualitySignal(raw = {}, defaultVersion = "0.0.0") {
  const ms = raw?.ms != null ? Number(raw.ms) : (raw?.avgSec != null ? Number(raw.avgSec) * 1000 : null);
  return {
    provider: cleanSignalProvider(raw?.provider),
    taskType: cleanSignalTaskType(raw?.taskType ?? raw?.capability),
    thumbsUp: cleanCount(raw?.thumbsUp ?? raw?.up),
    thumbsDown: cleanCount(raw?.thumbsDown ?? raw?.down),
    accepted: cleanCount(raw?.accepted ?? raw?.ok),
    retried: cleanCount(raw?.retried ?? raw?.fail),
    costBucket: COST_BUCKETS.includes(raw?.costBucket) ? raw.costBucket : costBucketOf(raw?.cost ?? raw?.costPerJob),
    latencyBucket: LATENCY_BUCKETS.includes(raw?.latencyBucket) ? raw.latencyBucket : latencyBucketOf(ms),
    version: cleanSignalVersion(raw?.version ?? defaultVersion),
  };
}

export function buildQualitySignalPayload({ installId, version = "0.0.0", signals = [] } = {}) {
  const ver = cleanSignalVersion(version);
  const rows = Array.isArray(signals) ? signals.map((s) => buildQualitySignal(s, ver)) : [];
  return {
    installId: cleanInstallId(installId),
    version: ver,
    signals: rows,
  };
}

export function validateQualitySignalPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Payload must be an object." };
  }
  for (const k of Object.keys(payload)) {
    if (FORBIDDEN_SIGNAL_KEYS.has(k) || !QUALITY_SIGNAL_TOP_KEYS.includes(k)) {
      return { ok: false, error: `Disallowed top-level key: ${k}` };
    }
  }
  if (!/^[a-f0-9]{16,64}$/.test(String(payload.installId || ""))) {
    return { ok: false, error: "Invalid installId." };
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(String(payload.version || ""))) {
    return { ok: false, error: "Invalid version." };
  }
  if (!Array.isArray(payload.signals)) {
    return { ok: false, error: "signals must be an array." };
  }
  for (const item of payload.signals) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each signal must be an object." };
    }
    for (const k of Object.keys(item)) {
      if (FORBIDDEN_SIGNAL_KEYS.has(k) || !QUALITY_SIGNAL_ITEM_KEYS.includes(k)) {
        return { ok: false, error: `Disallowed signal key: ${k}` };
      }
    }
    if (!KNOWN_SIGNAL_PROVIDERS.has(String(item.provider || ""))) {
      return { ok: false, error: `Disallowed provider: ${item.provider}` };
    }
    if (!ALLOWED_TASK_TYPES.includes(String(item.taskType || ""))) {
      return { ok: false, error: `Disallowed taskType: ${item.taskType}` };
    }
    if (!COST_BUCKETS.includes(String(item.costBucket || ""))) {
      return { ok: false, error: `Disallowed costBucket: ${item.costBucket}` };
    }
    if (!LATENCY_BUCKETS.includes(String(item.latencyBucket || ""))) {
      return { ok: false, error: `Disallowed latencyBucket: ${item.latencyBucket}` };
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(String(item.version || ""))) {
      return { ok: false, error: `Disallowed signal version: ${item.version}` };
    }
    for (const cKey of ["thumbsUp", "thumbsDown", "accepted", "retried"]) {
      const v = item[cKey];
      if (!Number.isInteger(v) || v < 0) {
        return { ok: false, error: `Invalid count for ${cKey}` };
      }
    }
  }
  return { ok: true, value: payload };
}

// state: "switch" (a switch), "when-used" (only after you connect or click), "always" (no switch)
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
    name: "License check",
    what: "Your license key, a random device id, this computer's name, the operating system, and the app version.",
    to: "Everborn's license server (Supabase).",
    when: "When you add a license key, then about every 12 hours while a key is saved.",
    off: "Do not add a license key (the app runs on Free), or remove this computer from the license in Settings.",
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
    what: "A random install id, the app version, the operating system, your plan, and how many times each feature was used. No prompts, answers, file names, emails, keys, or identifying ids.",
    to: "Everborn's hub (hub.meldmind.ai).",
    when: "Once a day, only while the switch is on.",
    off: "Welcome screen or Settings > Share anonymous usage counts to help improve Meldmind. On by default with an up-front notice, and off until you opt in in consent-first regions such as the EU and the UK.",
    state: "switch",
    switch: "usage",
  },
  {
    id: "track-records",
    name: "Anonymous quality signals and track records",
    what: QUALITY_SIGNALS_DETAIL,
    to: "Everborn's hub (hub.meldmind.ai). Show what would be shared lists exactly what goes.",
    when: "Once a day, only while the switch is on and there is something to send.",
    off: "Welcome screen or Settings > Privacy > Helping Meldmind get smarter (or Settings > Who's best > I am willing to share anonymous track records). On by default with an up-front notice, and off until you opt in in consent-first regions such as the EU and the UK.",
    state: "switch",
    switch: "trackRecords",
  },
  {
    id: "content-sharing",
    name: "Content sharing for our own-AI program",
    what: "Real prompts and answers you explicitly choose to share for our own-AI program, source-tagged, with closed-AI outputs excluded.",
    to: "Everborn's own-AI training program, only after your explicit opt-in.",
    when: "Never unless you explicitly tick the opt-in box. Never pre-checked.",
    off: "Welcome screen or Settings > Privacy > Share real prompts and answers for our own-AI program. Off by default everywhere and never pre-checked.",
    state: "switch",
    switch: "contentOptIn",
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
    qualityNotice: WELCOME_QUALITY_NOTICE,
    qualityDetail: QUALITY_SIGNALS_DETAIL,
    qualitySentItems: QUALITY_SENT_ITEMS,
    qualityNeverItems: QUALITY_NEVER_ITEMS,
    contentSharingLabel: CONTENT_SHARING_LABEL,
    contentSharingDetail: CONTENT_SHARING_DETAIL,
    levels: {
      onDevice: typeof live.onDevice === "boolean" ? live.onDevice : true,
      qualitySignals: typeof live.trackRecords === "boolean" ? live.trackRecords : (typeof live.usage === "boolean" ? live.usage : null),
      contentOptIn: live.contentOptIn === true,
      consentFirst: !!live.consentFirst,
      locale: live.locale || detectLocale(),
      showNotice: !!live.showNotice,
    },
    items,
  };
}
