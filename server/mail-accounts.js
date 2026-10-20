// Multi-account email for Gmail, Google (browser helper) and Outlook.
//
// A setup wizard (built separately) calls this module. It does not draw that wizard.
//
//   listAccounts(provider?)          -> public rows, no tokens
//   addAccount({ provider, label })  -> a new labeled account (not connected yet)
//   removeAccount(id)                -> drops the account and its vault token
//   setDefaultAccount(id)            -> the account tasks use when none is picked
//   setAccountLabel(id, label)
//
// Tokens stay in the vault (server/vault.js), the same store as a single account.
// The original account for each provider keeps its existing vault id
// (google-helper, mail-gmail, mail-outlook). Each added account uses mail-acct-<id>.
// This file never logs a token, a code, a client secret, or a refresh token.
import crypto from "node:crypto";
import { doc, putDoc } from "./store.js";
import { getSecret, setSecret } from "./vault.js";
import { emit } from "./events.js";

export const PROVIDERS = ["google", "gmail", "outlook"];
const LEGACY_VAULT = { google: "google-helper", gmail: "mail-gmail", outlook: "mail-outlook" };
const DOC = "mail.accounts";
const MAX = 8;
const NAMES = { google: "Google", gmail: "Gmail", outlook: "Outlook" };

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const assertProvider = (provider) => { if (!LEGACY_VAULT[provider]) throw fail(400, "provider must be google, gmail or outlook"); };

function peek() {
  const d = doc(DOC);
  if (!d || typeof d !== "object") return null;
  return d;
}
function state() {
  const d = doc(DOC, () => ({ accounts: [], labels: {}, defaults: {} }));
  d.accounts ||= [];
  d.labels ||= {};
  d.defaults ||= {};
  return d;
}
const save = (d) => putDoc(DOC, d);

function cleanLabel(label) {
  const name = String(label ?? "").replace(/[ \t]+/g, " ").trim();
  if (!name || name.length > 40 || /[\r\n\u0000]/.test(name)) throw fail(400, "Give the account a label (one line, up to 40 characters).");
  return name;
}

// Live status of the original single-account connection. Does not create its doc.
function legacyLive(provider) {
  const sec = getSecret(LEGACY_VAULT[provider]) || null;
  if (provider === "google") {
    const d = doc("browser.google");
    const scopes = Array.isArray(d?.scopes) ? d.scopes : [];
    const hasToken = !!(sec?.access || sec?.refresh);
    return { hasToken, connected: hasToken && scopes.length > 0 && !d?.needsSignIn, needsSignIn: !!d?.needsSignIn, scopes, connectedAt: d?.connectedAt || null };
  }
  const row = doc("services.mail")?.[provider] || {};
  const scopes = provider === "gmail"
    ? ["https://www.googleapis.com/auth/gmail.readonly"]
    : ["https://graph.microsoft.com/Mail.Read", "offline_access"];
  const hasToken = !!sec?.access;
  return { hasToken, connected: hasToken && !row.needsSignIn, needsSignIn: !!row.needsSignIn, scopes: hasToken ? scopes : [], connectedAt: row.connectedAt || null };
}

function extraConnected(provider, row) {
  const sec = getSecret(row.vaultId) || null;
  const scopes = row.scopes || [];
  const has = provider === "google" ? (!!(sec?.access || sec?.refresh) && scopes.length > 0) : !!sec?.access;
  return has && !row.needsSignIn;
}

function rowsFor(provider) {
  assertProvider(provider);
  const d = state();
  const live = legacyLive(provider);
  const rows = [];
  if (live.hasToken || d.labels[provider]) {
    rows.push({
      id: provider, provider, label: d.labels[provider] || NAMES[provider], legacy: true,
      connected: live.connected, needsSignIn: live.needsSignIn, scopes: live.scopes, connectedAt: live.connectedAt,
    });
  }
  for (const a of d.accounts) {
    if (a.provider !== provider) continue;
    rows.push({
      id: a.id, provider, label: a.label, legacy: false,
      connected: extraConnected(provider, a), needsSignIn: !!a.needsSignIn,
      scopes: a.scopes || [], connectedAt: a.connectedAt || null, lastScan: a.lastScan || null,
    });
  }
  const want = d.defaults[provider];
  const chosen = rows.find((r) => r.id === want) || rows.find((r) => r.legacy) || rows[0];
  return rows.map((r) => ({ ...r, isDefault: !!chosen && r.id === chosen.id }));
}

// The added account a call should use, or null to keep the original single-account token.
// An explicit unknown id is an error. Omitting the id uses the default only when that default
// is an added account; otherwise the caller stays on the original vault id.
export function activeExtra(provider, accountId) {
  assertProvider(provider);
  const d = peek();
  if (!accountId) {
    const id = d?.defaults?.[provider];
    if (!id || id === provider) return null;
    return (d.accounts || []).find((x) => x.id === id && x.provider === provider) || null;
  }
  if (accountId === provider) return null;
  const a = (d?.accounts || []).find((x) => x.id === accountId && x.provider === provider);
  if (!a) throw fail(404, "That mail account is not in the list.");
  return a;
}

export function listAccounts(provider) {
  const providers = provider ? [provider] : PROVIDERS;
  if (provider) assertProvider(provider);
  return providers.flatMap((p) => rowsFor(p));
}

export function addAccount({ provider, label } = {}) {
  assertProvider(provider);
  const name = cleanLabel(label);
  const existing = rowsFor(provider);
  if (existing.length >= MAX) throw fail(400, `Eight ${NAMES[provider]} accounts is the limit.`);
  const d = state();
  const id = "ma_" + crypto.randomBytes(6).toString("base64url");
  d.accounts.push({ id, provider, label: name, vaultId: `mail-acct-${id}`, scopes: [], connectedAt: null, needsSignIn: false });
  if (!existing.some((a) => a.isDefault)) d.defaults[provider] = id;
  save(d);
  const article = provider === "outlook" ? "an" : "a";
  emit("log", { text: `Added ${article} ${NAMES[provider]} account labeled "${name}". Connect it to save a token in the vault.` });
  return rowsFor(provider).find((a) => a.id === id);
}

export function setAccountLabel(id, label) {
  const name = cleanLabel(label);
  const all = listAccounts();
  const a = all.find((x) => x.id === id);
  if (!a) throw fail(404, "No mail account with that id.");
  const d = state();
  if (a.legacy) d.labels[a.provider] = name;
  else {
    const row = d.accounts.find((x) => x.id === id);
    if (!row) throw fail(404, "No mail account with that id.");
    row.label = name;
  }
  save(d);
  emit("log", { text: `Renamed a ${NAMES[a.provider]} account to "${name}".` });
  return rowsFor(a.provider).find((x) => x.id === id);
}

export function setDefaultAccount(id) {
  const all = listAccounts();
  const a = all.find((x) => x.id === id);
  if (!a) throw fail(404, "No mail account with that id.");
  const d = state();
  d.defaults[a.provider] = id;
  save(d);
  emit("log", { text: `Default ${NAMES[a.provider]} account is now "${a.label}".` });
  return rowsFor(a.provider);
}

const removers = {};
// google.js and services.js register the original disconnect so the client secret stays in the vault.
export const onRemoveLegacy = (provider, fn) => { removers[provider] = fn; };

export async function removeAccount(id) {
  const all = listAccounts();
  const a = all.find((x) => x.id === id);
  if (!a) throw fail(404, "No mail account with that id.");
  const d = state();
  if (a.legacy) {
    if (removers[a.provider]) await removers[a.provider]();
    else {
      const cur = getSecret(LEGACY_VAULT[a.provider]);
      await setSecret(LEGACY_VAULT[a.provider], cur?.clientSecret ? { key: "oauth", clientSecret: cur.clientSecret } : null);
    }
    delete d.labels[a.provider];
  } else {
    const row = d.accounts.find((x) => x.id === id);
    if (row?.vaultId) await setSecret(row.vaultId, null);
    d.accounts = d.accounts.filter((x) => x.id !== id);
  }
  if (d.defaults[a.provider] === id) delete d.defaults[a.provider];
  save(d);
  emit("log", { text: `Removed the ${NAMES[a.provider]} account "${a.label}". Its token was removed from the vault.` });
  return rowsFor(a.provider);
}

// Connection bookkeeping for an added account. Never pass a token in `patch`.
export function markAccount(id, patch = {}) {
  const d = state();
  const row = d.accounts.find((x) => x.id === id);
  if (!row) throw fail(404, "That mail account is not in the list.");
  for (const k of ["scopes", "connectedAt", "needsSignIn", "lastScan", "lastScanAt"]) {
    if (patch[k] !== undefined) row[k] = patch[k];
  }
  save(d);
  return row;
}
