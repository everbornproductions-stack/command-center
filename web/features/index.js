// Feature plugin loader. Each feature is one module in this folder that calls CC.register(...)
// at import time. app.js exposes window.CC (state, api, render helpers) before importing this file.
//
// CC.register({
//   id: "pipelines",
//   tab:   { label: "Pipelines", order: 25, render(view) {...} },          // optional: a top-level tab
//   command: { order: 10, render(container) {...} },                          // optional: widget in the Command view, under the orders panel
//   deliverable: { order: 10, render(container, run) {...} },                 // optional: buttons/sections under the deliverable
//   settings: { order: 10, render(container) {...} },                         // optional: a panel in Settings
//   setup: { order: 10, render(container) {...} },                            // optional: a panel on the first-run Setup page (next to the AI bookmark folder)
//   onEvent(ev) {...},                                                        // optional: every WebSocket event
//   onState(state) {...},                                                     // optional: after each full state load / tick
// });
const FEATURES = ["themes", "brand", "tour", "keysetup", "search", "liveview", "mcp", "fallback", "brain", "grokbot", "browser", "bookmarks", "compare", "libraries", "agents", "schedules", "history", "pricing", "hotkey", "extension", "wskeys", "sso", "artifacts", "images", "services", "pipelines", "ratings", "memory", "receipt", "media", "publish", "reports", "alerts", "share", "voice", "workspaces"];

const registry = [];
window.CC.register = (f) => { if (!f?.id) return; const i = registry.findIndex((x) => x.id === f.id); if (i >= 0) registry[i] = f; else registry.push(f); };
window.CC.features = registry;
window.CC.byKind = (kind) => registry.filter((f) => f[kind]).sort((a, b) => (a[kind].order ?? 50) - (b[kind].order ?? 50));

for (const name of FEATURES) {
  try { await import(`/features/${name}.js`); } catch (e) { if (!/Failed to fetch|404|not found/i.test(String(e))) console.warn(`[features] ${name}:`, e); }
}
window.CC.ready = true;
window.dispatchEvent(new CustomEvent("cc:features-ready"));
