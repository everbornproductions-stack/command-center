// Built-in browser helper (Phase 27): Gmail and Google Drive through the person's own Google sign-in.
// OAuth 2 with PKCE (S256) and the least scopes that do the job: Gmail read-only and Drive read-only by
// default; sending mail (gmail.send) only when the person ticks it, and even then every single email
// waits for an explicit OK in the helper (server/browser.js). The person registers their own OAuth
// client (Google Cloud console, Desktop app); its secret and the tokens live in the vault, never in a
// file, a log or a reply to the browser. A grant wider than what was asked for is refused, nothing kept.
import crypto from "node:crypto";
import { getSecret, setSecret } from "./vault.js";
import { HOSTED, doc, putDoc, ctx } from "./store.js";
import { emit } from "./events.js";
import { htmlToText } from "./receipts.js";

const VAULT_ID = "google-helper";
const DOC = "browser.google";
const env = (k, d) => (process.env[k] || d).replace(/\/$/, "");
const authUrl = () => `${env("CC_GOOGLE_AUTH_URL", "https://accounts.google.com")}/o/oauth2/v2/auth`;
const tokenUrl = () => `${env("CC_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com")}/token`;
const gmailApi = () => env("CC_GMAIL_API_URL", "https://gmail.googleapis.com");
const driveApi = () => env("CC_DRIVE_API_URL", "https://www.googleapis.com");

export const SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  drive: "https://www.googleapis.com/auth/drive.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
};
export const SCOPE_LABEL = { gmail: "read Gmail", drive: "read Google Drive", send: "send email (asks you every time)" };
const HARMLESS = new Set(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);
export const SETUP = "Google Cloud console: create an OAuth client of type Desktop app, enable the Gmail API and the Google Drive API, and paste its client ID and client secret here.";

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const gdoc = () => doc(DOC, () => ({ clientId: null, scopes: [], connectedAt: null, needsSignIn: false }));
const saveDoc = (d) => putDoc(DOC, d);
const secret = () => getSecret(VAULT_ID) || null;
const clientId = () => gdoc().clientId || (!HOSTED ? process.env.CC_GOOGLE_CLIENT_ID || "" : "") || null;

// granted scopes as the short names gmail / drive / send
export function granted() {
  const s = secret(), d = gdoc();
  if (!s?.access && !s?.refresh) return [];
  return Object.entries(SCOPES).filter(([, v]) => (d.scopes || []).includes(v)).map(([k]) => k);
}
export const connected = () => granted().length > 0 && !gdoc().needsSignIn;
export const canSend = () => connected() && granted().includes("send");

export function view() {
  const d = gdoc(), s = secret();
  return { clientId: d.clientId || null, clientIdFromEnv: !d.clientId && !!clientId(), clientSecretSaved: !!s?.clientSecret, connected: connected(), scopes: granted().map((k) => ({ id: k, label: SCOPE_LABEL[k] })), connectedAt: d.connectedAt || null, needsSignIn: !!d.needsSignIn, setup: SETUP, consoleUrl: "https://console.cloud.google.com/apis/credentials" };
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

const pending = new Map(); // state -> { verifier, redirectUri, scopes, user, at }
const userId = () => { try { return ctx().userId; } catch { return null; } };
const b64url = (b) => Buffer.from(b).toString("base64url");

export function start({ want = {}, redirectUri } = {}) {
  const id = clientId();
  if (!id) throw fail(400, `Add your Google OAuth client ID first. ${SETUP}`, { code: "client_id" });
  if (!/^https?:\/\/[^\s]+$/.test(String(redirectUri || ""))) throw fail(400, "redirectUri required");
  const keys = ["gmail", "drive", "send"].filter((k) => want[k]);
  if (!keys.length) throw fail(400, "Pick at least one: read Gmail, read Google Drive or send email.");
  for (const [k, p] of pending) if (Date.now() - p.at > 10 * 60 * 1000 || p.user === userId()) pending.delete(k);
  const verifier = b64url(crypto.randomBytes(48));
  const state = "bh-" + b64url(crypto.randomBytes(24));
  const scopes = keys.map((k) => SCOPES[k]);
  pending.set(state, { verifier, redirectUri, scopes, user: userId(), at: Date.now() });
  const u = new URL(authUrl());
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", id); u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", scopes.join(" ")); u.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest()));
  u.searchParams.set("code_challenge_method", "S256"); u.searchParams.set("state", state);
  u.searchParams.set("access_type", "offline"); u.searchParams.set("prompt", "consent");
  return { url: u.toString(), state, scopes };
}

function netReason(e) {
  const code = e?.cause?.code || e?.code || "";
  if (e?.name === "TimeoutError") return "no answer in time";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "address not found";
  return "network error";
}

async function tokenRequest(form) {
  const s = secret();
  const body = new URLSearchParams({ ...form, client_id: clientId(), ...(s?.clientSecret ? { client_secret: s.clientSecret } : {}) });
  let r;
  try { r = await fetch(tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString(), signal: AbortSignal.timeout(12000) }); }
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
  const tok = await tokenRequest({ grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri, code_verifier: p.verifier });
  const got = String(tok.scope || p.scopes.join(" ")).split(/\s+/).filter(Boolean);
  const extra = got.filter((x) => !p.scopes.includes(x) && !HARMLESS.has(x));
  if (extra.length) throw fail(400, "The sign-in granted more than the helper asked for (for example full Gmail or Drive access). Nothing was saved; check the OAuth client's scopes.", { code: "scope" });
  const cur = secret() || {};
  await setSecret(VAULT_ID, { key: "oauth", clientSecret: cur.clientSecret || null, access: tok.access_token, refresh: tok.refresh_token || null, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
  const d = gdoc(); d.scopes = got.filter((x) => Object.values(SCOPES).includes(x)); d.connectedAt = Date.now(); d.needsSignIn = false; saveDoc(d);
  emit("log", { text: `Google connected for the browser helper (${granted().map((k) => SCOPE_LABEL[k]).join(", ")}). The token is in the vault.` });
  return view();
}

export async function disconnect() {
  const cur = secret();
  await setSecret(VAULT_ID, cur?.clientSecret ? { key: "oauth", clientSecret: cur.clientSecret } : null);
  const d = gdoc(); d.scopes = []; d.connectedAt = null; d.needsSignIn = false; saveDoc(d);
  emit("log", { text: "Google disconnected from the browser helper; its tokens were removed from the vault." });
  return view();
}

function markSignIn() { const d = gdoc(); d.needsSignIn = true; saveDoc(d); }
async function accessToken() {
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
async function call(url, { method = "GET", body, raw = false } = {}) {
  const token = await accessToken();
  let r;
  try { r = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: raw ? "*/*" : "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: "error" }); }
  catch (e) { throw fail(502, `Could not reach Google: ${netReason(e)}`, { network: true }); }
  if (r.status === 401) { markSignIn(); throw fail(409, "Google refused the sign-in (401). Connect it again.", { code: "sign_in" }); }
  if (r.status === 403) throw fail(403, "Google said no (403): the sign-in does not allow this.");
  if (!r.ok) throw fail(502, `Google answered HTTP ${r.status}.`);
  return raw ? (await r.text()) : r.json();
}

const need = (k) => { if (!granted().includes(k)) throw fail(403, `The Google sign-in does not include "${SCOPE_LABEL[k]}". Connect again with it ticked.`, { code: "scope" }); };
const header = (payload, name) => (payload?.headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
const dec = (s) => Buffer.from(String(s || ""), "base64url").toString("utf8");
function bodyText(payload) {
  let plain = "", html = "";
  const walk = (p) => { if (!p) return; if (p.mimeType === "text/plain" && p.body?.data && !plain) plain = dec(p.body.data); else if (p.mimeType === "text/html" && p.body?.data && !html) html = dec(p.body.data); for (const c of p.parts || []) walk(c); };
  walk(payload);
  return (plain || htmlToText(html)).trim();
}

// ---------- the helper's Google actions ----------
export async function gmailSearch(query, max = 8) {
  need("gmail");
  const base = gmailApi();
  const list = await call(`${base}/gmail/v1/users/me/messages?${new URLSearchParams({ q: String(query || "").slice(0, 300), maxResults: String(Math.min(10, Math.max(1, max))) })}`);
  const out = [];
  for (const m of (list.messages || []).slice(0, 10)) {
    const full = await call(`${base}/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?${new URLSearchParams([["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "Subject"], ["metadataHeaders", "Date"]])}`);
    out.push({ id: m.id, from: header(full.payload, "From"), subject: header(full.payload, "Subject"), date: header(full.payload, "Date"), snippet: String(full.snippet || "").slice(0, 200), link: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.id)}` });
  }
  return out;
}
export async function gmailRead(id) {
  need("gmail");
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(id || ""))) throw fail(400, "That is not a Gmail message id.");
  const full = await call(`${gmailApi()}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
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
export async function gmailSend(mail) {
  need("send");
  const m = checkMail(mail);
  const mime = [`To: ${m.to.join(", ")}`, `Subject: ${encHeader(m.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", m.body].join("\r\n");
  const r = await call(`${gmailApi()}/gmail/v1/users/me/messages/send`, { method: "POST", body: { raw: Buffer.from(mime, "utf8").toString("base64url") } });
  return { id: r.id || null, to: m.to, subject: m.subject };
}

export async function driveSearch(query, max = 8) {
  need("drive");
  const q = String(query || "").replace(/['\\]/g, " ").trim().slice(0, 200);
  const params = new URLSearchParams({ q: `(name contains '${q}' or fullText contains '${q}') and trashed = false`, pageSize: String(Math.min(10, Math.max(1, max))), fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
  const r = await call(`${driveApi()}/drive/v3/files?${params}`);
  return (r.files || []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modified: f.modifiedTime || null, link: f.webViewLink || null }));
}
const EXPORT = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" };
export async function driveRead(id) {
  need("drive");
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(String(id || ""))) throw fail(400, "That is not a Drive file id.");
  const base = `${driveApi()}/drive/v3/files/${encodeURIComponent(id)}`;
  const meta = await call(`${base}?${new URLSearchParams({ fields: "id,name,mimeType,modifiedTime,webViewLink,size" })}`);
  let text = "";
  if (EXPORT[meta.mimeType]) text = await call(`${base}/export?${new URLSearchParams({ mimeType: EXPORT[meta.mimeType] })}`, { raw: true });
  else if (/^text\/|json|csv|xml/.test(meta.mimeType || "") && Number(meta.size || 0) < 2_000_000) text = await call(`${base}?alt=media`, { raw: true });
  else text = "(the helper can only read Google Docs, Sheets, Slides and text files; this one was not opened)";
  return { id, name: meta.name, mimeType: meta.mimeType, modified: meta.modifiedTime || null, link: meta.webViewLink || null, text: String(text).slice(0, 8000) };
}
