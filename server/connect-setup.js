// Get everything connected. A checklist of integrations, shown on a fresh install
// after the existing AI setup (browser history, key import, bookmarks). It does not
// replace that setup, and it does not walk the council AIs through key detection again.
// Keys are never stored here. Connect reuses the vault, OAuth, and MCP flows.

import { PROVIDERS } from "./registry.js";
import { accessFor } from "./provider-access.js";
import { isDual } from "./connect.js";
import * as Google from "./google.js";
import * as OA from "./publish/oauth.js";
import { sourceView } from "./library-sources.js";
import { readiness } from "./grokbot.js";
import { listAccounts } from "./mail-accounts.js";
import { mailView } from "./services.js";
import { doc, putDoc } from "./store.js";

export const DOC_KIND = "connectsetup.state";
export const VERSION = 1;
export const STATUSES = ["Connected", "Not connected", "Handoff"];

// These are the guided AI-key steps. Listing them again would duplicate first-run key detection.
const AI_KEY_IDS = new Set(["anthropic", "openai", "xai", "google", "perplexity", "openrouter", "deepseek", "groq", "mistral"]);

const LEAD = ["gmail", "drive", "calendar", "ghl", "capcut", "kling", "elevenlabs", "suno", "flow", "cursor"];

export function blankRecord() {
  return { version: VERSION, opened: false, legacy: false, completedAt: null, dismissedAt: null, skipped: [] };
}

function cleanId(id) {
  const s = String(id || "").trim();
  return /^[a-z0-9-]{1,40}$/.test(s) ? s : "";
}

export function normalizeRecord(raw) {
  const base = blankRecord();
  if (!raw || typeof raw !== "object") return base;
  const skipped = [];
  for (const id of Array.isArray(raw.skipped) ? raw.skipped : []) {
    const s = cleanId(id);
    if (s && !skipped.includes(s)) skipped.push(s);
  }
  return {
    version: VERSION,
    opened: raw.opened === true,
    legacy: raw.legacy === true,
    completedAt: Number(raw.completedAt) || null,
    dismissedAt: Number(raw.dismissedAt) || null,
    skipped,
  };
}

export function isFirstRun(onboarding, settings) {
  return !(onboarding && onboarding.completed === true) && settings?.onboarded !== true;
}

// Auto-open only on a fresh install, or when this checklist was opened and not finished.
// An install that already finished AI setup before this checklist existed stays quiet (legacy).
export function offerShow(record, { firstRun = false } = {}) {
  const rec = normalizeRecord(record);
  if (rec.completedAt || rec.dismissedAt) return false;
  if (rec.legacy && !rec.opened) return false;
  if (rec.opened) return true;
  return !!firstRun;
}

export function statusOf({ auth, connected, handoff } = {}) {
  if (handoff || auth === "handoff") return "Handoff";
  if (connected) return "Connected";
  return "Not connected";
}

// Public mail rows only. Tokens stay in the vault behind /api/mail-accounts.
function publicMail(a) {
  if (!a || typeof a !== "object") return null;
  const id = String(a.id || "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
  return {
    id,
    label: String(a.label || "").replace(/[\r\n]/g, " ").trim().slice(0, 40),
    connected: !!a.connected && !a.needsSignIn,
    isDefault: !!a.isDefault,
  };
}

function mailRows(deps, provider) {
  try { return (deps.mailAccounts?.(provider) || []).map(publicMail).filter(Boolean); }
  catch { return []; }
}

function row(item) {
  const status = STATUSES.includes(item.status) ? item.status : "Not connected";
  const out = {
    id: item.id,
    name: item.name,
    blurb: item.blurb || "",
    detail: item.detail || "",
    status,
    flow: item.flow,
    skipped: false,
  };
  if (item.mail) {
    out.mail = { provider: item.mail.provider };
    out.accounts = Array.isArray(item.accounts) ? item.accounts : [];
  }
  return out;
}

function providerRows(deps) {
  const out = [];
  for (const p of Object.values(deps.providers || {})) {
    if (!p || p.demo || p.kind === "text" || AI_KEY_IDS.has(p.id)) continue;
    let access = null;
    try { access = deps.access(p); } catch { access = null; }
    const auth = access?.auth || p.auth || "key";
    const dual = !!deps.dual?.(p.id);
    let flow;
    let detail;
    if (auth === "handoff" || auth === "local") {
      flow = { type: "open", provider: p.id };
      detail = p.authNote || (auth === "handoff" ? "Opens the service in your browser. No API key." : "This is an app on this PC.");
    } else if (auth === "mcp" || auth === "oauth") {
      flow = { type: "mcp", provider: p.id };
      detail = "MCP sign-in. Connect uses the existing MCP flow.";
    } else if (dual || p.api) {
      flow = { type: "keysetup", provider: p.id };
      detail = dual ? "API key or MCP. Connect opens the guided setup. The key stays in the vault." : "API key. Connect opens the guided setup. The key stays in the vault.";
    } else {
      flow = { type: "settings", focus: `#prov-${p.id}` };
      detail = "API key. Connect opens its card in Settings. The key stays in the vault.";
    }
    out.push(row({
      id: p.id,
      name: p.name,
      blurb: auth === "handoff" ? (p.authNote || `${p.name} opens in the browser.`) : (auth === "local" ? (p.authNote || `${p.name} is an app on this PC.`) : `${p.name}.`),
      detail,
      status: statusOf({ auth, connected: !!access?.connected }),
      flow,
    }));
  }
  return out;
}

function integrationRows(deps) {
  const g = deps.google() || {};
  const scopes = new Set((g.scopes || []).map((s) => s.id || s));
  const googleClient = !!(g.clientId || g.clientIdFromEnv) && !!g.clientSecretSaved;
  const googleOn = !!g.connected;
  const pubs = deps.publish() || [];
  const pub = (id) => pubs.find((x) => x.id === id) || {};
  const pubOn = (id) => !!(pub(id).connected || pub(id).viaPaste);
  const pubClient = (id) => !!(pub(id).clientId || pub(id).sharedClient) && !!pub(id).clientSecretSaved;
  const lib = (k) => deps.library(k) || {};
  const gb = deps.grokbot() || {};
  const gbReady = !!gb.ready;
  let outlook = {};
  try { outlook = deps.outlook?.() || {}; } catch { outlook = {}; }
  const outlookClient = !!(outlook.clientId || outlook.clientIdFromEnv) && !!outlook.clientSecretSaved;
  const googleMail = mailRows(deps, "google");
  const outlookMail = mailRows(deps, "outlook");

  return [
    row({
      id: "gmail", name: "Gmail",
      blurb: "Read mail with your Google sign-in. Add another account with a label.",
      detail: "Uses the browser helper Google sign-in. The client secret stays in the vault.",
      status: statusOf({ connected: (googleOn && scopes.has("gmail")) || googleMail.some((a) => a.connected) }),
      flow: { type: "browser-google", want: { gmail: true }, clientReady: googleClient, focus: "[data-feature='browser']" },
      mail: { provider: "google" },
      accounts: googleMail,
    }),
    row({
      id: "drive", name: "Google Drive",
      blurb: "Read Google Drive with your Google sign-in.",
      detail: "Uses the browser helper Google sign-in. The client secret stays in the vault.",
      status: statusOf({ connected: googleOn && scopes.has("drive") }),
      flow: { type: "browser-google", want: { drive: true }, clientReady: googleClient, focus: "[data-feature='browser']" },
    }),
    row({
      id: "calendar", name: "Google Calendar",
      blurb: "List, create, and update events with your Google sign-in. Grok Bot can still take calendar work.",
      detail: "Uses the browser helper Google sign-in. The client secret stays in the vault. Grok Bot's calendar handoff is unchanged.",
      status: statusOf({ connected: googleOn && scopes.has("calendar") }),
      flow: { type: "browser-google", want: { calendar: true }, keep: true, clientReady: googleClient, focus: "[data-feature='browser']" },
    }),
    row({
      id: "ghl", name: "HighLevel",
      blurb: "Schedule posts in HighLevel.",
      detail: "OAuth, or a private integration token, in Publishing. The token stays in the vault.",
      status: statusOf({ connected: pubOn("ghl") }),
      flow: { type: "publish", connector: "ghl", clientReady: pubClient("ghl"), focus: "[data-feature='publish']" },
    }),
    row({
      id: "instagram", name: "Instagram",
      blurb: "Publish to Instagram.",
      detail: "OAuth, or a Page token, in Publishing. The token stays in the vault.",
      status: statusOf({ connected: pubOn("meta") }),
      flow: { type: "publish", connector: "meta", clientReady: pubClient("meta"), focus: "[data-feature='publish']" },
    }),
    row({
      id: "slack", name: "Slack",
      blurb: "Send a finished deliverable to Slack.",
      detail: "OAuth, or a bot token, in Publishing. The token stays in the vault.",
      status: statusOf({ connected: pubOn("slack") }),
      flow: { type: "publish", connector: "slack", clientReady: pubClient("slack"), focus: "[data-feature='publish']" },
    }),
    row({
      id: "publish-google", name: "Google Drive publishing",
      blurb: "Save files this app makes into Google Drive.",
      detail: "Publishing OAuth. A wider Drive grant is not used. The token stays in the vault.",
      status: statusOf({ connected: pubOn("google") }),
      flow: { type: "publish", connector: "google", clientReady: pubClient("google"), focus: "[data-feature='publish']" },
    }),
    row({
      id: "library-google", name: "Google Drive libraries",
      blurb: "Read Drive files into a library.",
      detail: "Library OAuth, read only. The token stays in the vault.",
      status: statusOf({ connected: !!lib("google").connected }),
      flow: { type: "library", source: "google", clientReady: !!lib("google").clientReady, focus: "[data-feature='libraries']" },
    }),
    row({
      id: "notion", name: "Notion",
      blurb: "Read Notion pages into a library.",
      detail: "Notion OAuth, read only. The token stays in the vault.",
      status: statusOf({ connected: !!lib("notion").connected }),
      flow: { type: "library", source: "notion", clientReady: !!lib("notion").clientReady, focus: "[data-feature='libraries']" },
    }),
    row({
      id: "grokbot", name: "Grok Bot",
      blurb: "Hand signed-in work to your own Grok Bot.",
      detail: "Webhook and sender key. They stay in the vault, and the fields stay in Expert.",
      status: statusOf({ handoff: gbReady }),
      flow: { type: "settings", focus: "[data-feature='grokbot']", expertOnly: true },
    }),
    row({
      id: "extension", name: "Browser extension",
      blurb: "Send the page you are on into Meldmind.",
      detail: "Pair a browser from Settings. The pairing code is shown once and is not kept here.",
      status: statusOf({ connected: !!deps.extensionPaired() }),
      flow: { type: "settings", focus: "[data-feature='extension']" },
    }),
    row({
      id: "outlook", name: "Outlook",
      blurb: "Read Outlook mail for receipts.",
      detail: "The same mailbox sign-in as Subscriptions. The token stays in the vault.",
      status: statusOf({ connected: outlookMail.some((a) => a.connected) || (!!outlook.connected && !outlook.needsSignIn) }),
      flow: { type: "mail", provider: "outlook", clientReady: outlookClient, focusView: "subscriptions" },
      mail: { provider: "outlook" },
      accounts: outlookMail,
    }),
  ];
}

export function buildCatalog(deps = liveDeps()) {
  const items = [...integrationRows(deps), ...providerRows(deps)];
  const rank = (id) => {
    const i = LEAD.indexOf(id);
    return i === -1 ? 100 : i;
  };
  return items.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

function liveDeps() {
  return {
    providers: PROVIDERS,
    access: accessFor,
    dual: isDual,
    google: () => { try { return Google.view(); } catch { return {}; } },
    publish: () => { try { return OA.view(); } catch { return []; } },
    library: (k) => { try { return sourceView(k); } catch { return {}; } },
    grokbot: () => { try { return readiness(); } catch { return { ready: false }; } },
    extensionPaired: () => {
      try {
        const list = doc("extension.pairings", () => undefined)?.list;
        return Array.isArray(list) && list.length > 0;
      } catch { return false; }
    },
    mailAccounts: (provider) => { try { return listAccounts(provider); } catch { return []; } },
    outlook: () => {
      try {
        const v = mailView()?.outlook || {};
        return { connected: !!v.connected, needsSignIn: !!v.needsSignIn, accounts: v.accounts, clientId: v.clientId, clientIdFromEnv: v.clientIdFromEnv, clientSecretSaved: !!v.hasClientSecret };
      } catch { return {}; }
    },
  };
}

function readStored() {
  return doc(DOC_KIND, () => undefined);
}

function ensureRecord() {
  const stored = readStored();
  const firstRun = isFirstRun(doc("onboarding", () => undefined), doc("settings", () => undefined) || {});
  if (!stored) {
    if (!firstRun) {
      const rec = { ...blankRecord(), legacy: true };
      putDoc(DOC_KIND, rec);
      return { rec, firstRun: false };
    }
    return { rec: blankRecord(), firstRun: true };
  }
  return { rec: normalizeRecord(stored), firstRun };
}

function viewFrom(rec, firstRun) {
  let items = [];
  try {
    items = buildCatalog().map((it) => ({ ...it, skipped: rec.skipped.includes(it.id) }));
  } catch { items = []; }
  return {
    show: offerShow(rec, { firstRun }),
    opened: rec.opened === true,
    completed: !!rec.completedAt,
    dismissed: !!rec.dismissedAt,
    items,
  };
}

export function connectSetupPublic() {
  const { rec, firstRun } = ensureRecord();
  return viewFrom(rec, firstRun);
}

function save(rec) {
  const next = normalizeRecord(rec);
  putDoc(DOC_KIND, next);
  return next;
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "connectsetup" });

export function beginSetup() {
  const { rec, firstRun } = ensureRecord();
  const next = save({ ...rec, opened: true, legacy: false });
  return viewFrom(next, firstRun);
}

export function dismissSetup() {
  const { rec, firstRun } = ensureRecord();
  const next = save({ ...rec, opened: true, legacy: false, dismissedAt: Date.now() });
  return viewFrom(next, firstRun);
}

export function completeSetup() {
  const { rec, firstRun } = ensureRecord();
  const next = save({ ...rec, opened: true, legacy: false, completedAt: Date.now(), dismissedAt: null });
  return viewFrom(next, firstRun);
}

export function resetSetup() {
  const { firstRun } = ensureRecord();
  const next = save({ ...blankRecord(), opened: true, legacy: false });
  return viewFrom(next, firstRun);
}

export function skipSetup(id) {
  const sid = cleanId(id);
  const { rec, firstRun } = ensureRecord();
  const known = new Set(buildCatalog().map((it) => it.id));
  if (!sid || !known.has(sid)) throw bad("Unknown integration.");
  const skipped = rec.skipped.includes(sid) ? rec.skipped : [...rec.skipped, sid];
  const next = save({ ...rec, opened: true, legacy: false, skipped });
  return viewFrom(next, firstRun);
}
