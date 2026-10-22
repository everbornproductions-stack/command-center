// Settings > Privacy: what leaves this computer. Read only. The list is server/privacy.js;
// this adds the live on or off for the switches and which AI companies have a key.
// Nothing here sends anything anywhere.
import { privacyView } from "../privacy.js";
import { publicState as usageState } from "../usage.js";
import { brainSettings } from "../brain.js";
import { status as syncStatus } from "../history-sync.js";

export const id = "privacy";

function live() {
  const out = {};
  try { out.usage = usageState().share === true; } catch { /* unknown */ }
  try { out.trackRecords = brainSettings().shareOptIn === true; } catch { /* unknown */ }
  try { out.chatSync = !!syncStatus().enabled; } catch { /* unknown */ }
  return out;
}

function connected(h) {
  const names = [];
  for (const p of Object.values(h.PROVIDERS || {})) {
    if (!p || p.demo || !p.id) continue;
    try { if (h.hasSecret(p.id)) names.push(p.name || p.id); } catch { /* skip */ }
  }
  return names;
}

export async function routes(req, res, url, body, h) {
  if (req.method === "GET" && (url.pathname === "/api/privacy" || url.pathname === "/api/privacy/")) {
    const view = privacyView(live());
    view.connected = connected(h);
    return h.json(res, 200, view);
  }
  return false;
}
