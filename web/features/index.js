// Feature plugin loader. Each feature is one module in this folder that calls CC.register(...)
// at import time. app.js exposes window.CC (state, api, render helpers) before importing this file.
//
// Which module loads, and when, is web/perf/registry.js. Shell modules load now.
// Everything else waits until its page is open. Light mode does not load the
// extra Command panels. Open pull requests add a row to the registry.
// They do not add a static import here.
//
// CC.register({
//   id: "pipelines",
//   tab:   { label: "Pipelines", order: 25, render(view) {...} },          // optional: a top-level tab
//   command: { order: 10, render(container) {...} },                          // optional: widget in the Command view, under the orders panel
//   deliverable: { order: 10, render(container, run) {...} },                 // optional: buttons/sections under the deliverable
//   settings: { order: 10, render(container) {...} },                         // optional: a panel in Settings
//   credits: { order: 10, render(container) {...} },                          // optional: a panel at the top of the Credits tab
//   setup: { order: 10, render(container) {...} },                            // optional: a panel on the first-run Setup page (next to the AI bookmark folder)
//   onEvent(ev) {...},                                                        // optional: every WebSocket event
//   onState(state) {...},                                                     // optional: after each full state load / tick
// });
import { FEATURES, idsFor, shellIds } from "/perf/registry.js";

const registry = [];
const loaded = new Set();
const loading = new Map();

window.CC.register = (f) => { if (!f?.id) return; const i = registry.findIndex((x) => x.id === f.id); if (i >= 0) registry[i] = f; else registry.push(f); };
window.CC.features = registry;
window.CC.byKind = (kind) => registry.filter((f) => f[kind]).sort((a, b) => (a[kind].order ?? 50) - (b[kind].order ?? 50));

function fileOf(id) {
  return FEATURES.find((f) => f.id === id)?.file || id;
}

function loadOne(id) {
  if (loaded.has(id)) return Promise.resolve();
  if (loading.has(id)) return loading.get(id);
  const job = import(`/features/${fileOf(id)}.js`).then(() => {
    loaded.add(id);
  }).catch((e) => {
    if (!/Failed to fetch|404|not found/i.test(String(e))) console.warn(`[features] ${id}:`, e);
  }).finally(() => {
    loading.delete(id);
  });
  loading.set(id, job);
  return job;
}

// A mail or publishing sign-in returns to this page with ?code=. Those
// modules have to run once so the connection can finish.
function oauthBootIds() {
  try {
    const q = new URLSearchParams(location.search);
    const state = q.get("state") || "";
    if (!q.get("code")) return [];
    const ids = [];
    if (state.startsWith("mail-")) ids.push("services");
    if (/^pub-(google|meta|ghl|slack)-/.test(state)) ids.push("publish");
    return ids;
  } catch {
    return [];
  }
}

window.CC.viewReady = (view, opts = {}) => {
  if (view === "command" && !window.CC.S?.settingsLoaded) return true;
  return idsFor(view, opts).every((id) => loaded.has(id));
};

window.CC.ensureView = async (view, opts = {}) => {
  if (view === "command" && !window.CC.S?.settingsLoaded) return;
  const ids = idsFor(view, opts);
  await Promise.all(ids.map(loadOne));
  try { window.CC.api?.("/perf/open", { method: "POST", body: { view } }); } catch { /* the page still opens */ }
};

for (const id of shellIds()) await loadOne(id);
for (const id of oauthBootIds()) await loadOne(id);

window.CC.ready = true;
window.dispatchEvent(new CustomEvent("cc:features-ready"));
