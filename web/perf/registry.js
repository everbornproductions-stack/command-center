// Feature, builder, and add-on registry.
//
// Open pull requests adopt this file. Do not add a static import in
// web/features/index.js, electron/main.cjs, or server/index.js.
//
// A page or builder:
//   { id: "remix", views: ["remix"], kind: "builder" }
//   id is the file name under web/features, without .js.
//   The loader imports it only when one of views is open.
//   Omit home, deliverable, and listen. Those load with Command,
//   and Light mode skips them.
//
// A heavy server module:
//   add { id, file, views } to SERVER_DEMAND.
//   server/plugins/index.js imports that file on the first request,
//   or when the view opens. It is not imported at startup.
//
// A background check:
//   scheduler.register({ id, everyMs, lightEveryMs, pause: true, run }).
//   Do not call setInterval. pause: true waits while the app is idle
//   or on battery. Light mode uses lightEveryMs.
//
// A heavy tool (OCR, Whisper, a browser, a template pack):
//   add a row to ADDONS. Do not add an npm dependency and do not
//   require() it from the main process. The Add-ons panel shows the
//   size and downloads only after a click.

export const FEATURES = [
  { id: "sign-in-tip", shell: true },
  { id: "themes", shell: true },
  { id: "brand", shell: true },
  { id: "tour", shell: true },
  { id: "help", shell: true },
  { id: "keysetup", shell: true },
  { id: "connect-setup", shell: true },
  { id: "updates", shell: true },
  { id: "hotkey", shell: true },
  { id: "access", shell: true },
  { id: "personas", shell: true },
  { id: "answer-wait", shell: true },
  { id: "app-signin", shell: true },
  { id: "privacy", shell: true },
  { id: "prompt-suggest", shell: true },
  { id: "look", shell: true },
  { id: "news-rail", shell: true },

  { id: "next-actions", deliverable: true },
  { id: "finish-router", views: ["publish"] },
  { id: "finishpath", deliverable: true },
  { id: "momentum", deliverable: true },
  { id: "photo-editor", views: ["images"] },
  { id: "video-editor", views: ["media"] },
  { id: "publish-plus", views: ["publish"] },
  { id: "prompt-drop", views: ["images", "media", "remix", "builders", "webbuilders"], home: true },
  { id: "search", home: true, deliverable: true, settings: true },
  { id: "liveview", views: ["liveview"], home: true, deliverable: true },
  { id: "mcp", home: true, deliverable: true, settings: true },
  { id: "fallback", home: true, deliverable: true, settings: true },
  { id: "handoff", home: true, deliverable: true, settings: true, listen: true },
  { id: "phoneweb", home: true, settings: true, listen: true },
  { id: "getdone", home: true, settings: true, listen: true },
  { id: "brain", views: ["brain"] },
  { id: "grokbot", home: true, deliverable: true, settings: true, listen: true },
  { id: "browser", home: true, deliverable: true, settings: true, listen: true },
  { id: "bookmarks", settings: true, setup: true },
  { id: "compare", views: ["compare"] },
  { id: "projectfiles", home: true, listen: true },
  { id: "libraries", views: ["libraries"], home: true, deliverable: true, settings: true },
  { id: "agents", views: ["agents"], home: true, listen: true },
  { id: "schedules", views: ["schedules"], listen: true },
  { id: "history", views: ["history"] },
  { id: "pricing", settings: true },
  { id: "extension", home: true, settings: true, listen: true },
  { id: "wskeys", settings: true },
  { id: "sso", settings: true },
  { id: "artifacts", views: ["artifacts"], deliverable: true, settings: true },
  { id: "images", views: ["images"], home: true, deliverable: true, settings: true },
  { id: "services", views: ["subscriptions"], listen: true },
  { id: "pipelines", views: ["pipelines"], home: true },
  { id: "prompts", views: ["prompts"], home: true, deliverable: true, setup: true, settings: true },
  { id: "marketplace", views: ["marketplace"] },
  { id: "growth", home: true, settings: true, listen: true },
  { id: "ratings", deliverable: true, settings: true },
  { id: "memory", home: true, settings: true },
  { id: "receipt", home: true, deliverable: true, credits: true, settings: true },
  { id: "media", views: ["media"], deliverable: true, settings: true },
  { id: "publish", views: ["publish"], deliverable: true, settings: true, listen: true },
  { id: "reports", views: ["reports"] },
  { id: "alerts", home: true, settings: true },
  { id: "share", deliverable: true, settings: true },
  { id: "voice", home: true, settings: true },
  { id: "workspaces", views: ["workspaces"] },
  { id: "walkthrough", views: ["start"], home: true },
  { id: "performance", views: ["settings"], settings: true },

  // Pages added by the integration train. Each file loads when its view opens.
  // home, deliverable, and listen load with Command, and Light mode skips them.
  { id: "a11y", settings: true, deliverable: true },
  { id: "byo", settings: true },
  { id: "antigravity", settings: true },
  { id: "graduate", home: true },
  { id: "calendar", settings: true },
  { id: "actions", home: true },
  { id: "apps", home: true, settings: true, setup: true },
  { id: "desktop-doors", settings: true },
  { id: "refocus", views: ["refocus"] },
  { id: "devices", settings: true },
  { id: "background", home: true, listen: true },
  { id: "remix", views: ["remix"], kind: "builder" },
  { id: "builders", views: ["builders"], kind: "builder", home: true },
  { id: "webbuilders", views: ["webbuilders"], kind: "builder", home: true },
  { id: "export", deliverable: true },
  { id: "together", views: ["together"] },
  { id: "everyday-inbox", views: ["everyday-inbox"] },
  { id: "everyday-plan", views: ["everyday-plan"] },
  { id: "orders-input", home: true },
  { id: "everyday-news", settings: true },
  { id: "everyday-work", views: ["everyday-work"] },
  { id: "desk", home: true, deliverable: true, credits: true, settings: true },
  { id: "hosted-runs", settings: true },
  { id: "smarter-control", home: true, settings: true },
  { id: "modelwatch", settings: true },
  { id: "userchat", views: ["userchat"] },
  { id: "community", views: ["community"], settings: true, deliverable: true, listen: true },
  { id: "industries", views: ["prompts"] },
  { id: "teamrecipes", views: ["workspaces"] },
  { id: "highlevel", settings: true },
  { id: "own-supabase", settings: true },
  { id: "usage", settings: true },
  { id: "projectmedia", views: ["projects", "images", "media", "remix", "publish", "builders", "webbuilders"], home: true, settings: true },
];

// Server plugins that stay out of startup. file is the name in server/plugins.
// views is which page should ask for the plugin. The first /api/<id> request
// loads it even if the page forgot to ask.
export const SERVER_DEMAND = [
  { id: "perf", file: "perf.js", views: ["settings"] },
  { id: "takeover", file: "takeover.js", views: ["schedules"] },
  { id: "videoeditor", file: "videoeditor.js", views: ["media"] },
  { id: "publishplus", file: "publishplus.js", views: ["publish"] },
  { id: "projectmedia", file: "projectmedia.js", views: ["projects", "images", "media", "remix", "publish", "builders", "webbuilders"] },
  { id: "photoeditor", file: "photoeditor.js", views: ["images"] },
];

// Sizes are the download size shown before a click. These tools are not in
// the installer. bytes is decimal (150000000 is about 150 MB).
export const ADDONS = [
  { id: "ocr", name: "OCR", bytes: 45000000, summary: "Reads words from a picture on this PC.", cloud: "A connected vision model can read the picture instead." },
  { id: "whisper", name: "Whisper", bytes: 150000000, summary: "Turns speech into text on this PC.", cloud: "A connected speech model can transcribe instead." },
  { id: "whisperx", name: "WhisperX", bytes: 500000000, summary: "Timed transcripts on this PC.", cloud: "A connected speech model can transcribe instead." },
  { id: "piper", name: "Piper", bytes: 64000000, summary: "Speaks text on this PC.", cloud: "A connected voice model can speak instead." },
  { id: "godot", name: "Godot templates", bytes: 400000000, summary: "Export templates for a Godot game.", cloud: "A connected coding model can draft the game without the templates." },
  { id: "bevy", name: "Bevy templates", bytes: 80000000, summary: "Starter files for a Bevy game.", cloud: "A connected coding model can draft the game without the templates." },
  { id: "lighthouse", name: "Lighthouse", bytes: 80000000, summary: "Checks a page for speed and access on this PC.", cloud: "A connected model can review the page instead." },
  { id: "playwright", name: "Playwright browsers", bytes: 380000000, summary: "Browser binaries for a local page check.", cloud: "A connected model can review the page instead." },
  { id: "postiz", name: "Postiz", bytes: 250000000, summary: "Local Postiz for scheduling posts.", cloud: "Use a connected account. Nothing posts without a click." },
  { id: "chatwoot", name: "Chatwoot", bytes: 300000000, summary: "Local Chatwoot inbox.", cloud: "A connected inbox can answer instead." },
  { id: "docuseal", name: "DocuSeal", bytes: 200000000, summary: "Local DocuSeal for signing.", cloud: "A connected signing service can prepare the draft instead." },
];

export function featureById(id) {
  return FEATURES.find((f) => f.id === id) || null;
}

export function shellIds() {
  return FEATURES.filter((f) => f.shell).map((f) => f.id);
}

// Modules to import for this view. Shell modules are already loaded.
// Light mode loads a module only when its own page, Settings, Setup, or Credits is open.
export function idsFor(view, { light = false } = {}) {
  const name = String(view || "");
  const out = [];
  const add = (f) => {
    if (!f || f.shell || out.includes(f.id)) return;
    out.push(f.id);
  };
  for (const f of FEATURES) {
    if ((f.views || []).includes(name)) add(f);
  }
  if (name === "settings") for (const f of FEATURES) if (f.settings) add(f);
  // welcome: a section on the first-run welcome screen (the reserved slot #su-backup-slot).
  if (name === "setup") for (const f of FEATURES) if (f.setup || f.welcome) add(f);
  if (name === "credits") for (const f of FEATURES) if (f.credits) add(f);
  if (name === "command" && !light) {
    for (const f of FEATURES) if (f.home || f.deliverable || f.listen) add(f);
  }
  return out;
}

export function demandForView(view) {
  const name = String(view || "");
  return SERVER_DEMAND.filter((row) => (row.views || []).includes(name));
}

export function addonById(id) {
  return ADDONS.find((a) => a.id === id) || null;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1000000000) {
    const s = (n / 1000000000).toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s} GB`;
  }
  if (n >= 1000000) return `${Math.round(n / 1000000)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${Math.round(n)} B`;
}
