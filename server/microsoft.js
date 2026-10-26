// One-click Sign in with Microsoft (0.4.17): Outlook through Everborn's own Microsoft sign-in app.
//
// Authority https://login.microsoftonline.com/common (any work or school tenant, and personal
// Microsoft accounts). The first sign-in asks for openid, profile, email, offline_access,
// User.Read, Mail.Send, and Calendars.ReadWrite. Reading mail is a separate, later "Read my inbox"
// sign-in: it uses the same mailbox connection as Subscriptions (server/services.js, Mail.Read).
// It is a public client with PKCE (S256) and a loopback redirect, so there is no client secret.
// Tokens live in the vault only. They are never logged and never sent to the browser.
import { getSecret, setSecret } from "./vault.js";
import { HOSTED, doc, putDoc, ctx } from "./store.js";
import { emit } from "./events.js";
import { shippedClient, pkcePair } from "./oauth-signin.js";
import crypto from "node:crypto";
import { rememberIdentity, forgetIdentity } from "./signed-in-email.js";

const VAULT_ID = "ms-signin";
const DOC = "signin.microsoft";
const env = (k, d) => (process.env[k] || d).replace(/\/$/, "");
const loginBase = () => env("CC_MS_LOGIN_URL", "https://login.microsoftonline.com");
export const authUrl = () => `${loginBase()}/common/oauth2/v2.0/authorize`;
export const tokenUrl = () => `${loginBase()}/common/oauth2/v2.0/token`;

export const SCOPES = {
  send: "Mail.Send",
  calendar: "Calendars.ReadWrite",
};
// Sign-in basics: who is signed in, and a sign-in that lasts. No mail or calendar access.
export const IDENTITY = ["openid", "profile", "email", "offline_access", "User.Read"];
export const SCOPE_LABEL = { send: "send email (asks you every time)", calendar: "Outlook calendar events" };
export const FIRST = ["send", "calendar"];
// Scopes Microsoft may add to a token on its own, or that another Meldmind step asked for.
const HARMLESS = new Set(["openid", "profile", "email", "offline_access", "User.Read", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.Read", "Mail.Read"]);

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const mdoc = () => doc(DOC, () => ({ scopes: [], connectedAt: null, needsSignIn: false }));
const save = (d) => putDoc(DOC, d);
const shipped = () => (HOSTED ? { clientId: "", ready: false } : shippedClient("microsoft"));
const userId = () => { try { return ctx().userId; } catch { return null; } };
const short = (s) => String(s || "").replace(/^https:\/\/graph\.microsoft\.com\//, "");

export function oneClickReady() { return shipped().ready; }

export function granted() {
  const s = getSecret(VAULT_ID);
  if (!s?.access && !s?.refresh) return [];
  const have = new Set((mdoc().scopes || []).map(short));
  return Object.entries(SCOPES).filter(([, v]) => have.has(short(v))).map(([k]) => k);
}
export function connected() { return granted().length > 0 && !mdoc().needsSignIn; }

export function view() {
  const d = mdoc();
  return {
    oneClick: { ready: shipped().ready, first: FIRST.map((k) => ({ id: k, label: SCOPE_LABEL[k] })) },
    connected: connected(),
    scopes: granted().map((k) => ({ id: k, label: SCOPE_LABEL[k] })),
    connectedAt: d.connectedAt || null,
    needsSignIn: !!d.needsSignIn,
  };
}

const pending = new Map(); // state -> { verifier, redirectUri, scopes, user, at }

export function start({ redirectUri } = {}) {
  const id = shipped().clientId;
  if (!id) throw fail(400, "One-click Sign in with Microsoft is coming soon. For now you can use your own Microsoft sign-in app under Advanced.", { code: "coming_soon" });
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/[^\s]*$/.test(String(redirectUri || ""))) throw fail(400, "A loopback redirect is required.");
  for (const [k, p] of pending) if (Date.now() - p.at > 10 * 60 * 1000 || p.user === userId()) pending.delete(k);
  const { verifier, challenge } = pkcePair();
  const state = "ms-" + crypto.randomBytes(24).toString("base64url");
  const scopes = [...IDENTITY, ...FIRST.map((k) => SCOPES[k])];
  pending.set(state, { verifier, redirectUri, scopes, user: userId(), at: Date.now() });
  const u = new URL(authUrl());
  u.searchParams.set("client_id", id); u.searchParams.set("response_type", "code"); u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_mode", "query"); u.searchParams.set("scope", scopes.join(" "));
  u.searchParams.set("code_challenge", challenge); u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state); u.searchParams.set("prompt", "select_account");
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
  const body = new URLSearchParams({ ...form, client_id: shipped().clientId });
  let r;
  try { r = await fetch(tokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString(), signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw fail(502, `Could not reach Microsoft sign-in: ${netReason(e)}`, { network: true }); }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j?.access_token) throw fail(r.status >= 500 ? 502 : 400, `Microsoft sign-in failed${j?.error_description || j?.error ? `: ${String(j.error_description || j.error).slice(0, 160)}` : ` (HTTP ${r.status})`}`, { rejected: r.status === 400 || r.status === 401 });
  return j;
}

export async function finish({ code, state } = {}) {
  const p = pending.get(String(state || ""));
  if (!p) throw fail(400, "This sign-in link is stale or was not started here. Start again.", { code: "state" });
  pending.delete(state);
  if (!code) throw fail(400, "No code came back from the sign-in.");
  const tok = await tokenRequest({ grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri, code_verifier: p.verifier, scope: p.scopes.join(" ") });
  const got = String(tok.scope || p.scopes.join(" ")).split(/\s+/).filter(Boolean);
  const asked = new Set(p.scopes.map(short));
  const extra = got.filter((x) => !asked.has(short(x)) && !HARMLESS.has(x) && !HARMLESS.has(short(x)));
  if (extra.length) throw fail(400, "The sign-in granted more than Meldmind asked for. Nothing was saved.", { code: "scope" });
  const { assertServiceSlots } = await import("./service-limit.js");
  await assertServiceSlots(["outlook"]);
  if (rememberIdentity("microsoft", tok.id_token)) { try { await (await import("./license.js")).startEmailSession("microsoft", tok.id_token); } catch { /* no proof: the key still works */ } }
  await setSecret(VAULT_ID, { key: "oauth", access: tok.access_token, refresh: tok.refresh_token || null, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
  const d = mdoc(); d.scopes = got.map(short); d.connectedAt = Date.now(); d.needsSignIn = false; save(d);
  emit("log", { text: `Microsoft connected (${granted().map((k) => SCOPE_LABEL[k]).join(", ")}). The token is in the vault.` });
  return view();
}

// For features that send mail or add calendar events through Outlook. Each send still waits for a click.
export async function accessToken() {
  const s = getSecret(VAULT_ID);
  if (!s?.access) throw fail(400, "Microsoft is not connected. Use Sign in with Microsoft in Settings.", { code: "not_connected" });
  if (s.expiresAt && s.expiresAt - Date.now() < 60000) {
    const d = mdoc();
    if (!s.refresh) { d.needsSignIn = true; save(d); throw fail(409, "The Microsoft sign-in expired. Sign in again.", { code: "sign_in" }); }
    try {
      const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh, scope: [...(d.scopes || []).map((x) => (x.includes(".") && !x.startsWith("http") ? `https://graph.microsoft.com/${x}` : x))].join(" ") });
      await setSecret(VAULT_ID, { key: "oauth", access: tok.access_token, refresh: tok.refresh_token || s.refresh, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
      return tok.access_token;
    } catch (e) { if (e.network) throw e; d.needsSignIn = true; save(d); throw fail(409, `The Microsoft sign-in expired (${e.message}). Sign in again.`, { code: "sign_in" }); }
  }
  return s.access;
}

export async function disconnect() {
  forgetIdentity("microsoft");
  import("./licence-session.js").then((m) => m.clearSession()).catch(() => {});
  await setSecret(VAULT_ID, null);
  save({ scopes: [], connectedAt: null, needsSignIn: false });
  emit("log", { text: "Microsoft disconnected. Its tokens were removed from the vault." });
  return view();
}

// Send one plain-text email from the signed-in Outlook (Graph sendMail). Only called after a click, or by an alert
// the person turned on. A hard compliance block never goes out.
export const canSend = () => connected() && granted().includes("send");
export async function outlookSend({ to, subject, body } = {}, fetchImpl = fetch) {
  if (!canSend()) throw fail(400, "Outlook cannot send yet. Sign in with Microsoft in Settings and allow send email.", { code: "not_connected" });
  const list = String(to || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!list.length || list.length > 10 || !list.every((x) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(x))) throw fail(400, "The email needs one to ten plain addresses in To.");
  const subj = String(subject || "").trim();
  if (/[\r\n]/.test(subj) || subj.length > 300) throw fail(400, "The subject must be one line.");
  const text = String(body || "");
  if (!text.trim() || text.length > 20000) throw fail(400, "The email needs a body (up to 20,000 characters).");
  const { assertOutgoingOk } = await import("./compliance-guard.js");
  assertOutgoingOk({ text: `${subj}\n${text}`, channel: "email" });
  const token = await accessToken();
  const r = await fetchImpl(`${env("CC_MS_GRAPH_URL", "https://graph.microsoft.com")}/v1.0/me/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { subject: subj, body: { contentType: "Text", content: text }, toRecipients: list.map((a) => ({ emailAddress: { address: a } })) }, saveToSentItems: true }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw fail(502, `Outlook said no (${r.status}).`);
  const { recordSend } = await import("./send-log.js");
  recordSend({ channel: "email", kind: "outlook", to: list.join(", "), title: subj, text });
  return { to: list, subject: subj };
}
