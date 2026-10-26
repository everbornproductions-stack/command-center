// Settings > Privacy: what leaves this computer and the three learning levels.
// The list is server/privacy.js; this adds the live on or off for the switches,
// the three learning levels, and which AI companies have a key.
import { privacyView, detectLocale, isConsentFirstLocale } from "../privacy.js";
import { publicState as usageState, setShare as setUsageShare } from "../usage.js";
import { brainSettings, saveBrainSettings } from "../brain.js";
import { status as syncStatus } from "../history-sync.js";

export const id = "privacy";

function privacyDoc(h) {
  try {
    return h.doc("privacy", () => ({ contentOptIn: false, noticeSeen: false }));
  } catch {
    return { contentOptIn: false, noticeSeen: false };
  }
}

function live(h) {
  const out = {};
  const loc = detectLocale();
  out.locale = loc;
  out.consentFirst = isConsentFirstLocale(loc);
  try { out.usage = usageState().share === true; } catch { /* unknown */ }
  try {
    const bs = brainSettings();
    out.onDevice = bs.on !== false;
    out.trackRecords = bs.shareOptIn === true;
  } catch { /* unknown */ }
  try { out.chatSync = !!syncStatus().enabled; } catch { /* unknown */ }
  const pd = privacyDoc(h);
  out.contentOptIn = pd.contentOptIn === true;
  out.showNotice = pd.noticeSeen !== true;
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
    const view = privacyView(live(h));
    view.connected = connected(h);
    return h.json(res, 200, view);
  }
  if (req.method === "POST" && (url.pathname === "/api/privacy" || url.pathname === "/api/privacy/")) {
    const b = body || {};
    const pd = { ...privacyDoc(h) };
    if (typeof b.onDevice === "boolean") {
      saveBrainSettings({ on: b.onDevice });
    }
    if (typeof b.qualitySignals === "boolean") {
      saveBrainSettings({ shareOptIn: b.qualitySignals });
      try { setUsageShare(b.qualitySignals); } catch { /* ignore */ }
      pd.shareChosen = true;
      pd.noticeSeen = true;
    }
    if (typeof b.contentOptIn === "boolean") {
      pd.contentOptIn = b.contentOptIn === true;
    }
    if (typeof b.noticeSeen === "boolean") {
      pd.noticeSeen = b.noticeSeen;
    }
    try { h.putDoc("privacy", pd); } catch { /* ignore */ }
    const view = privacyView(live(h));
    view.connected = connected(h);
    return h.json(res, 200, view);
  }
  return false;
}
