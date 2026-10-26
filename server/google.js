// Built-in browser helper (Phase 27): Gmail, Google Drive, and Google Calendar through the person's own
// Google sign-in. OAuth 2 with PKCE (S256) and the least scopes that do the job: Gmail read-only and
// Drive read-only by default; sending mail (gmail.send) only when the person ticks it, and even then
// every single email waits for an explicit OK. Calendar events (list, create, update) use calendar.events
// only, and a create or update runs only when a route is clicked. The person registers their own OAuth
// client (Google Cloud console, Desktop app); its secret and the tokens live in the vault, never in a
// file, a log or a reply to the browser. A grant wider than what was asked for is refused, nothing kept.
// Grok Bot's calendar handoff is a separate route and is not changed here.
//
// One-click Sign in with Google (0.4.17) uses Everborn's own sign-in app (server/oauth-signin.js,
// server/oauth-clients.json) instead of one the person makes. Its first sign-in asks only for
// Calendar events, Drive files Meldmind makes or the person picks (drive.file), and sending email
// (gmail.send). Reading the inbox (gmail.readonly) is a separate, later "Read my inbox" sign-in.
// The person's own client stays under Advanced. `via` records which client a token came from,
// so a refresh uses the same one.
import crypto from "node:crypto";
import { shippedClient } from "./oauth-signin.js";
import { getSecret, setSecret } from "./vault.js";
import { HOSTED, doc, putDoc, ctx } from "./store.js";
import { emit } from "./events.js";
import { assertOutgoingOk } from "./compliance-guard.js";
import { recordSend } from "./send-log.js";
import { htmlToText } from "./receipts.js";
import { localFetch } from "./loopback-fetch.js";
import { activeExtra, listAccounts, markAccount, onRemoveLegacy } from "./mail-accounts.js";
import { assertServiceSlots } from "./service-limit.js";
import { rememberIdentity, forgetIdentity } from "./signed-in-email.js";

const VAULT_ID = "google-helper";
const DOC = "browser.google";
const env = (k, d) => (process.env[k] || d).replace(/\/$/, "");
const authUrl = () => `${env("CC_GOOGLE_AUTH_URL", "https://accounts.google.com")}/o/oauth2/v2/auth`;
const tokenUrl = () => `${env("CC_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com")}/token`;
const gmailApi = () => env("CC_GMAIL_API_URL", "https://gmail.googleapis.com");
const driveApi = () => env("CC_DRIVE_API_URL", "https://www.googleapis.com");
const calendarApi = () => env("CC_CALENDAR_API_URL", "https://www.googleapis.com/calendar/v3");

export const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  drive: "https://www.googleapis.com/auth/drive.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
  calendar: "https://www.googleapis.com/auth/calendar.events",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  compose: "https://www.googleapis.com/auth/gmail.compose",
};
export const SCOPE_LABEL = { gmail: "read Gmail", drive: "read Google Drive", send: "send email (asks you every time)", calendar: "Google Calendar events", driveFile: "Drive files Meldmind makes or you pick", compose: "Gmail drafts" };
// What each one-click step asks for. gmail.readonly and gmail.compose are restricted scopes at
// Google, so the first sign-in leaves them out. Compose is not asked for at all today: nothing
// in Meldmind writes Gmail drafts yet.
export const ONE_CLICK = { first: ["calendar", "driveFile", "send"], inbox: ["gmail"] };
const SCOPE_KEYS = Object.keys(SCOPES);
export const IDENTITY = ["openid", "email", "profile"];
const HARMLESS = new Set(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);
export const SETUP = "Google Cloud console: create an OAuth client of type Desktop app, enable the Gmail API, the Google Drive API, and the Google Calendar API, and paste its client ID and client secret here.";

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const gdoc = () => doc(DOC, () => ({ clientId: null, scopes: [], connectedAt: null, needsSignIn: false, via: null }));
const saveDoc = (d) => putDoc(DOC, d);
const secret = () => getSecret(VAULT_ID) || null;
const shipped = () => (HOSTED ? { clientId: "", clientSecret: null, ready: false } : shippedClient("google"));
// The person's own client (Advanced): the id saved in Settings, or for developers the id in
// CC_GOOGLE_CLIENT_ID with the secret saved in the vault, as before 0.4.17. The shipped id in
// server/oauth-clients.json is only used by one-click sign-in.
const envClientId = () => (!HOSTED ? String(process.env.CC_GOOGLE_CLIENT_ID || "").trim() : "");
const clientId = () => gdoc().clientId || envClientId() || null;
// The client a token request uses. "everborn" is the shipped sign-in app.
function clientFor(via) {
  if (via === "everborn") { const sh = shipped(); return { id: sh.clientId || null, secret: sh.clientSecret || null }; }
  return { id: clientId(), secret: secret()?.clientSecret || null };
}
export function oneClickReady() { return shipped().ready; }

// granted scopes as the short names gmail / drive / send / calendar.
// No accountId (and no added account chosen as the default) keeps the original single-account token.
export function granted(accountId) {
  const extra = activeExtra("google", accountId);
  if (extra) {
    const s = getSecret(extra.vaultId);
    if (!s?.access && !s?.refresh) return [];
    return Object.entries(SCOPES).filter(([, v]) => (extra.scopes || []).includes(v)).map(([k]) => k);
  }
  const s = secret(), d = gdoc();
  if (!s?.access && !s?.refresh) return [];
  return Object.entries(SCOPES).filter(([, v]) => (d.scopes || []).includes(v)).map(([k]) => k);
}
export function connected(accountId) {
  const extra = activeExtra("google", accountId);
  if (extra) return granted(accountId).length > 0 && !extra.needsSignIn;
  return granted().length > 0 && !gdoc().needsSignIn;
}
export const canSend = (accountId) => connected(accountId) && granted(accountId).includes("send");
export const canCalendar = (accountId) => connected(accountId) && granted(accountId).includes("calendar");

// The account a task picked. Null means "use the default when the job runs".
export function useAccount(accountId) {
  if (!accountId) return null;
  const a = listAccounts("google").find((x) => x.id === String(accountId));
  if (!a) throw fail(400, "That Google account is not in the list. Add it under Settings, then pick it on the task.");
  return { id: a.id, label: a.label };
}

export function view() {
  const d = gdoc(), s = secret();
  const accounts = listAccounts("google");
  const def = accounts.find((a) => a.isDefault);
  const sh = shipped();
  return { via: d.via || null, oneClick: { ready: sh.ready, first: ONE_CLICK.first.map((k) => ({ id: k, label: SCOPE_LABEL[k] })), inbox: ONE_CLICK.inbox.map((k) => ({ id: k, label: SCOPE_LABEL[k] })), inboxGranted: granted(def?.id).includes("gmail") }, clientId: d.clientId || null, clientIdFromEnv: !d.clientId && !!envClientId(), clientSecretSaved: !!s?.clientSecret, connected: connected(def?.id), scopes: granted(def?.id).map((k) => ({ id: k, label: SCOPE_LABEL[k] })), connectedAt: def?.connectedAt || d.connectedAt || null, needsSignIn: def ? !!def.needsSignIn : !!d.needsSignIn, accounts, setup: SETUP, consoleUrl: "https://console.cloud.google.com/apis/credentials" };
}

export async function setClient({ clientId: id, clientSecret } = {}) {
  const d = gdoc();
  if (id !== undefined) {
    const v = String(id || "").trim();
    if (v && !/^[A-Za-z0-9._-]{8,200}$/.test(v)) throw fail(400, "That does not look like an OAuth client ID.");
    d.clientId = v || null; saveDoc(d);
  }
  if (clientSecret !== undefined) {
    const v = String(clientSecret || "").trim();
    if (v && (v.length > 400 || /\s/.test(v))) throw fail(400, "That does not look like a client secret.");
    await setSecret(VAULT_ID, { ...(secret() || {}), key: "oauth", clientSecret: v || null });
  }
  return view();
}

const pending = new Map(); // state -> { verifier, redirectUri, scopes, user, at, accountId }
const userId = () => { try { return ctx().userId; } catch { return null; } };
const b64url = (b) => Buffer.from(b).toString("base64url");

export function start({ want = {}, redirectUri, accountId, keep = false, via = null } = {}) {
  const useVia = via === "everborn" ? "everborn" : null;
  const id = useVia ? (shipped().ready ? shipped().clientId : "") : clientId();
  if (!id && useVia) throw fail(400, "One-click Sign in with Google is coming soon. For now you can use your own Google sign-in app under Advanced.", { code: "coming_soon" });
  if (!id) throw fail(400, `Add your Google OAuth client ID first. ${SETUP}`, { code: "client_id" });
  if (useVia && accountId && accountId !== "google") throw fail(400, "One-click sign-in is for your main Google account. Add other accounts under Advanced.");
  if (!/^https?:\/\/[^\s]+$/.test(String(redirectUri || ""))) throw fail(400, "redirectUri required");
  let extraId = null;
  if (accountId && accountId !== "google") {
    const a = activeExtra("google", accountId);
    if (!a) throw fail(404, "That Google account is not in the list.");
    extraId = a.id;
  }
  const asked = new Set(SCOPE_KEYS.filter((k) => want[k]));
  if (keep) for (const k of granted(extraId)) asked.add(k);
  const keys = SCOPE_KEYS.filter((k) => asked.has(k));
  if (!keys.length) throw fail(400, "Pick at least one: read Gmail, read Google Drive, send email, or Google Calendar.");
  for (const [k, p] of pending) if (Date.now() - p.at > 10 * 60 * 1000 || p.user === userId()) pending.delete(k);
  const verifier = b64url(crypto.randomBytes(48));
  const state = "bh-" + b64url(crypto.randomBytes(24));
  const scopes = keys.map((k) => SCOPES[k]);
  pending.set(state, { verifier, redirectUri, scopes, user: userId(), at: Date.now(), accountId: extraId, via: useVia });
  // One-click also asks for the basic sign-in scopes (openid, email, profile), so Google shows
  // which account is signed in. They give no access to mail, files, or the calendar.
  const askScopes = useVia ? [...IDENTITY, ...scopes] : scopes;
  const u = new URL(authUrl());
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", id); u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", askScopes.join(" ")); u.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest()));
  u.searchParams.set("code_challenge_method", "S256"); u.searchParams.set("state", state);
  u.searchParams.set("access_type", "offline"); u.searchParams.set("prompt", "consent");
  if (keep) u.searchParams.set("include_granted_scopes", "true");
  return { url: u.toString(), state, scopes };
}

function netReason(e) {
  const code = e?.cause?.code || e?.code || "";
  if (e?.name === "TimeoutError") return "no answer in time";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "address not found";
  return "network error";
}

async function tokenRequest(form, via = gdoc().via) {
  const c = clientFor(via);
  const body = new URLSearchParams({ ...form, client_id: c.id || "", ...(c.secret ? { client_secret: c.secret } : {}) });
  let r;
  try { r = await localFetch(tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString(), signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw fail(502, `Could not reach Google sign-in: ${netReason(e)}`, { network: true }); }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j?.access_token) throw fail(r.status >= 500 ? 502 : 400, `Google sign-in failed${j?.error_description || j?.error ? `: ${String(j.error_description || j.error).slice(0, 160)}` : ` (HTTP ${r.status})`}`, { rejected: r.status === 400 || r.status === 401 });
  return j;
}

export async function finish({ code, state } = {}) {
  const p = pending.get(String(state || ""));
  if (!p) throw fail(400, "This sign-in link is stale or was not started here. Start again from Settings > Integrations > Browser helper.", { code: "state" });
  if (HOSTED && p.user !== userId()) throw fail(403, "This sign-in belongs to another account.");
  pending.delete(state);
  if (!code) throw fail(400, "No code came back from the sign-in.");
  const tok = await tokenRequest({ grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri, code_verifier: p.verifier }, p.via);
  const got = String(tok.scope || p.scopes.join(" ")).split(/\s+/).filter(Boolean);
  const extra = got.filter((x) => !p.scopes.includes(x) && !HARMLESS.has(x));
  if (extra.length) throw fail(400, "The sign-in granted more than the helper asked for (for example full Gmail or Drive access). Nothing was saved; check the OAuth client's scopes.", { code: "scope" });
  const scopes = got.filter((x) => Object.values(SCOPES).includes(x));
  const expiresAt = tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null;
  const slots = [];
  if (scopes.includes(SCOPES.gmail) || scopes.includes(SCOPES.send) || scopes.includes(SCOPES.compose)) slots.push("gmail");
  if (scopes.includes(SCOPES.drive) || scopes.includes(SCOPES.driveFile)) slots.push("drive");
  if (scopes.includes(SCOPES.calendar)) slots.push("calendar");
  await assertServiceSlots(slots);
  if (p.accountId) {
    const a = activeExtra("google", p.accountId);
    if (!a) throw fail(404, "That Google account is not in the list. Nothing was saved.");
    await setSecret(a.vaultId, { key: "oauth", access: tok.access_token, refresh: tok.refresh_token || null, expiresAt });
    markAccount(a.id, { scopes, connectedAt: Date.now(), needsSignIn: false });
    const names = Object.entries(SCOPES).filter(([, v]) => scopes.includes(v)).map(([k]) => SCOPE_LABEL[k]);
    emit("log", { text: `Google account "${a.label}" connected for the browser helper (${names.join(", ")}). The token is in the vault.` });
    return view();
  }
  const cur = secret() || {};
  if (rememberIdentity("google", tok.id_token)) { try { await (await import("./license.js")).startEmailSession("google", tok.id_token); } catch { /* no proof: the key still works */ } }
  await setSecret(VAULT_ID, { key: "oauth", clientSecret: cur.clientSecret || null, access: tok.access_token, refresh: tok.refresh_token || null, expiresAt });
  const d = gdoc(); d.scopes = scopes; d.connectedAt = Date.now(); d.needsSignIn = false; d.via = p.via || null; saveDoc(d);
  emit("log", { text: `Google connected for the browser helper (${granted().map((k) => SCOPE_LABEL[k]).join(", ")}). The token is in the vault.` });
  return view();
}

export async function disconnect() {
  forgetIdentity("google");
  import("./licence-session.js").then((m) => m.clearSession()).catch(() => {});
  const cur = secret();
  await setSecret(VAULT_ID, cur?.clientSecret ? { key: "oauth", clientSecret: cur.clientSecret } : null);
  const d = gdoc(); d.scopes = []; d.connectedAt = null; d.needsSignIn = false; d.via = null; saveDoc(d);
  emit("log", { text: "Google disconnected from the browser helper; its tokens were removed from the vault." });
  return view();
}

function markSignIn(accountId) {
  const extra = accountId ? activeExtra("google", accountId) : null;
  if (extra) { markAccount(extra.id, { needsSignIn: true }); return; }
  const d = gdoc(); d.needsSignIn = true; saveDoc(d);
}
async function accessToken(accountId) {
  const extra = activeExtra("google", accountId);
  if (extra) {
    const s = getSecret(extra.vaultId) || null;
    if (!s?.access) throw fail(400, `Google account "${extra.label}" is not connected. Connect it in Settings > Integrations > Browser helper.`, { code: "not_connected" });
    if (s.expiresAt && s.expiresAt - Date.now() < 60000) {
      if (!s.refresh) { markAccount(extra.id, { needsSignIn: true }); throw fail(409, `The Google sign-in for "${extra.label}" expired. Connect it again.`, { code: "sign_in" }); }
      try {
        const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh }, null);
        await setSecret(extra.vaultId, { key: "oauth", access: tok.access_token, refresh: tok.refresh_token || s.refresh, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
        return tok.access_token;
      } catch (e) { if (e.network) throw e; markAccount(extra.id, { needsSignIn: true }); throw fail(409, `The Google sign-in for "${extra.label}" expired (${e.message}). Connect it again.`, { code: "sign_in" }); }
    }
    return s.access;
  }
  const s = secret();
  if (!s?.access) throw fail(400, "Google is not connected to the browser helper. Connect it in Settings > Integrations > Browser helper.", { code: "not_connected" });
  if (s.expiresAt && s.expiresAt - Date.now() < 60000) {
    if (!s.refresh) { markSignIn(); throw fail(409, "The Google sign-in expired. Connect it again.", { code: "sign_in" }); }
    try {
      const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh });
      await setSecret(VAULT_ID, { ...s, access: tok.access_token, refresh: tok.refresh_token || s.refresh, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
      return tok.access_token;
    } catch (e) { if (e.network) throw e; markSignIn(); throw fail(409, `The Google sign-in expired (${e.message}). Connect it again.`, { code: "sign_in" }); }
  }
  return s.access;
}

// One call to a Google API. A 401 means "sign in again" (409 to our caller, never 401).
async function call(url, { method = "GET", body, raw = false } = {}, accountId) {
  const token = await accessToken(accountId);
  let r;
  try { r = await localFetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: raw ? "*/*" : "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: "error" }); }
  catch (e) { throw fail(502, `Could not reach Google: ${netReason(e)}`, { network: true }); }
  if (r.status === 401) { markSignIn(accountId); throw fail(409, "Google refused the sign-in (401). Connect it again.", { code: "sign_in" }); }
  if (r.status === 403) throw fail(403, "Google said no (403): the sign-in does not allow this.");
  if (!r.ok) throw fail(502, `Google answered HTTP ${r.status}.`);
  return raw ? (await r.text()) : r.json();
}

const ALSO = { drive: ["driveFile"], send: ["compose"] };
const need = (k, accountId) => { const g = granted(accountId); if (!g.includes(k) && !(ALSO[k] || []).some((x) => g.includes(x))) throw fail(403, `The Google sign-in does not include "${SCOPE_LABEL[k]}". Connect again with it ticked.`, { code: "scope" }); };
const header = (payload, name) => (payload?.headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
const dec = (s) => Buffer.from(String(s || ""), "base64url").toString("utf8");
function bodyText(payload) {
  let plain = "", html = "";
  const walk = (p) => { if (!p) return; if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = dec(p.body.data); else if (p.mimeType === "text/html" && p.body?.data && !html) html = dec(p.body.data); for (const c of p.parts || []) walk(c); };
  walk(payload);
  return (plain || htmlToText(html)).trim();
}

// ---------- the helper's Google actions ----------
export async function gmailSearch(query, max = 8, accountId) {
  need("gmail", accountId);
  const base = gmailApi();
  const list = await call(`${base}/gmail/v1/users/me/messages?${new URLSearchParams({ q: String(query || "").slice(0, 300), maxResults: String(Math.min(10, Math.max(1, max))) })}`, {}, accountId);
  const out = [];
  for (const m of (list.messages || []).slice(0, 10)) {
    const full = await call(`${base}/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?${new URLSearchParams([["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "Subject"], ["metadataHeaders", "Date"]])}`, {}, accountId);
    out.push({ id: m.id, from: header(full.payload, "From"), subject: header(full.payload, "Subject"), date: header(full.payload, "Date"), snippet: String(full.snippet || "").slice(0, 200), link: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.id)}` });
  }
  return out;
}
export async function gmailRead(id, accountId) {
  need("gmail", accountId);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(id || ""))) throw fail(400, "That is not a Gmail message id.");
  const full = await call(`${gmailApi()}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {}, accountId);
  return { id, from: header(full.payload, "From"), to: header(full.payload, "To"), subject: header(full.payload, "Subject"), date: header(full.payload, "Date"), text: bodyText(full.payload).slice(0, 8000), link: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}` };
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
export function checkMail({ to, subject, body } = {}) {
  const list = String(to || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!list.length || list.length > 10 || !list.every((x) => EMAIL.test(x))) throw fail(400, "The email needs one to ten plain addresses in To.");
  const subj = String(subject || "").trim();
  if (/[\r\n]/.test(subj) || subj.length > 300) throw fail(400, "The subject must be one line.");
  const text = String(body || "");
  if (!text.trim() || text.length > 20000) throw fail(400, "The email needs a body (up to 20,000 characters).");
  return { to: list, subject: subj, body: text };
}
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
// Only ever called after the person said OK to exactly this email.
export async function gmailSend(mail, accountId) {
  need("send", accountId);
  const m = checkMail(mail);
  assertOutgoingOk({ text: `${m.subject}\n${m.body}`, channel: "email" }); // a hard compliance block never goes out, even after a click
  const mime = [`To: ${m.to.join(", ")}`, `Subject: ${encHeader(m.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", m.body].join("\r\n");
  const r = await call(`${gmailApi()}/gmail/v1/users/me/messages/send`, { method: "POST", body: { raw: Buffer.from(mime, "utf8").toString("base64url") } }, accountId);
  recordSend({ channel: "email", kind: "gmail", to: m.to.join(", "), title: m.subject, text: m.body });
  return { id: r.id || null, to: m.to, subject: m.subject };
}

export async function driveSearch(query, max = 8, accountId) {
  need("drive", accountId);
  const q = String(query || "").replace(/['\\]/g, " ").trim().slice(0, 200);
  const params = new URLSearchParams({ q: `(name contains '${q}' or fullText contains '${q}') and trashed = false`, pageSize: String(Math.min(10, Math.max(1, max))), fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
  const r = await call(`${driveApi()}/drive/v3/files?${params}`, {}, accountId);
  return (r.files || []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modified: f.modifiedTime || null, link: f.webViewLink || null }));
}
const EXPORT = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };
export async function driveRead(id, accountId) {
  need("drive", accountId);
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(String(id || ""))) throw fail(400, "That is not a Drive file id.");
  const base = `${driveApi()}/drive/v3/files/${encodeURIComponent(id)}`;
  const meta = await call(`${base}?${new URLSearchParams({ fields: "id,name,mimeType,modifiedTime,webViewLink,size" })}`, {}, accountId);
  let text = "";
  if (EXPORT[meta.mimeType]) text = await call(`${base}/export?${new URLSearchParams({ mimeType: EXPORT[meta.mimeType] })}`, { raw: true }, accountId);
  else if (/^text\/|json|csv|xml/.test(meta.mimeType || "") && Number(meta.size || 0) < 2_000_000) text = await call(`${base}?alt=media`, { raw: true }, accountId);
  else text = "(the helper can only read Google Docs, Sheets, Slides and text files; this one was not opened)";
  return { id, name: meta.name, mimeType: meta.mimeType, modified: meta.modifiedTime || null, link: meta.webViewLink || null, text: String(text).slice(0, 8000) };
}

// ---------- Google Calendar (list, create, update; never delete) ----------
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;

function parseWhen(value) {
  const s = String(value || "").trim();
  if (!s || s.length > 40) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function whenBody(date) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return { dateTime: date.toISOString(), timeZone };
}

export function publicEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const link = typeof raw.htmlLink === "string" && raw.htmlLink.startsWith("https://") ? raw.htmlLink : "";
  return {
    id: String(raw.id || ""),
    summary: String(raw.summary || "").slice(0, 200),
    description: String(raw.description || "").slice(0, 500),
    location: String(raw.location || "").slice(0, 300),
    start: raw.start?.dateTime || raw.start?.date || "",
    end: raw.end?.dateTime || raw.end?.date || "",
    link,
    status: String(raw.status || ""),
  };
}

// Validates a create body, or a partial update when `partial` is set. Nothing is sent from here.
export function checkEvent(raw, { partial = false } = {}) {
  const summary = String(raw?.summary || "").replace(/[\r\n]/g, " ").trim();
  if (summary.length > 200) throw fail(400, "The event title must be 200 characters or fewer.");
  if (!partial && !summary) throw fail(400, "The event needs a title.");
  const description = String(raw?.description || "");
  if (description.length > 8000) throw fail(400, "The event description must be 8,000 characters or fewer.");
  const location = String(raw?.location || "").replace(/[\r\n]/g, " ").trim();
  if (location.length > 300) throw fail(400, "The event location must be 300 characters or fewer.");
  const start = raw?.start ? parseWhen(raw.start) : null;
  const end = raw?.end ? parseWhen(raw.end) : null;
  if (!partial && (!start || !end)) throw fail(400, "The event needs a start and an end.");
  if ((raw?.start && !start) || (raw?.end && !end)) throw fail(400, "The event times have to be real dates.");
  if (start && end && end.getTime() <= start.getTime()) throw fail(400, "The event has to end after it starts.");
  if (start && end && end.getTime() - start.getTime() > 7 * 24 * 3600 * 1000) throw fail(400, "The event has to be shorter than 7 days.");
  const body = {};
  if (summary) body.summary = summary;
  if (description) body.description = description;
  if (location) body.location = location;
  if (start) body.start = whenBody(start);
  if (end) body.end = whenBody(end);
  if (partial && !Object.keys(body).length) throw fail(400, "Nothing to update.");
  return body;
}

export function calendarStatus() {
  const v = view();
  return {
    connected: canCalendar(),
    canSend: canSend(),
    scopes: v.scopes,
    clientReady: (!!(v.clientId || v.clientIdFromEnv) && !!v.clientSecretSaved) || !!v.oneClick?.ready,
    oneClick: !!v.oneClick?.ready,
    needsSignIn: !!v.needsSignIn,
  };
}

export async function listEvents({ q = "", timeMin = "", timeMax = "", max = 10, accountId } = {}) {
  need("calendar", accountId);
  const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(Math.min(20, Math.max(1, Number(max) || 10))) });
  const query = String(q || "").replace(/['\\]/g, " ").trim().slice(0, 200);
  if (query) params.set("q", query);
  const start = timeMin ? parseWhen(timeMin) : null;
  const end = timeMax ? parseWhen(timeMax) : null;
  if (timeMin && !start) throw fail(400, "timeMin is not a real date.");
  if (timeMax && !end) throw fail(400, "timeMax is not a real date.");
  if (start) params.set("timeMin", start.toISOString());
  if (end) params.set("timeMax", end.toISOString());
  const r = await call(`${calendarApi()}/calendars/primary/events?${params}`, {}, accountId);
  return (r.items || []).map(publicEvent).filter(Boolean);
}

export async function createEvent(raw, accountId) {
  need("calendar", accountId);
  const body = checkEvent(raw);
  const r = await call(`${calendarApi()}/calendars/primary/events`, { method: "POST", body }, accountId);
  emit("log", { text: "Google Calendar event created after a click." });
  return publicEvent(r);
}

export async function updateEvent(id, raw, accountId) {
  need("calendar", accountId);
  const eventId = String(id || "");
  if (!EVENT_ID.test(eventId)) throw fail(400, "That is not a Calendar event id.");
  const body = checkEvent(raw, { partial: true });
  const r = await call(`${calendarApi()}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body }, accountId);
  emit("log", { text: "Google Calendar event updated after a click." });
  return publicEvent(r);
}

onRemoveLegacy("google", () => disconnect());
