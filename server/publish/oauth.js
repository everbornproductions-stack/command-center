// Integrations (Phase 7): user OAuth for the four publishing connectors. The person registers their own
// app with each service (Google Cloud, Meta for Developers, the HighLevel Marketplace, api.slack.com) and
// pastes its client ID and secret; "Connect" opens the service's sign-in, the page comes back with
// ?code=&state=pub-<connector>-..., and the code is swapped for a token here. Tokens and client secrets
// live in the vault (never in a file, a log or a reply to the browser). Least scopes only: a grant wider
// than what was asked for is refused and nothing is kept. Signing in posts nothing: every post is still
// a preview plus a click (server/plugins/publish.js).
//
// Every address can be pointed at a local mock with an env var (tests never reach a real service).
import crypto from "node:crypto";
import { getSecret, setSecret } from "../vault.js";
import { HOSTED, doc, putDoc, ctx } from "../store.js";
import { CFG } from "../hosted.js";
import { emit } from "../events.js";

const env = (k, d) => (process.env[k] || d).replace(/\/$/, "");
export const API = {
  google: () => env("CC_DRIVE_API_URL", "https://www.googleapis.com"),
  googleUpload: () => env("CC_DRIVE_UPLOAD_URL", env("CC_DRIVE_API_URL", "https://www.googleapis.com")),
  meta: () => env("CC_META_GRAPH_URL", "https://graph.facebook.com") + "/v21.0",
  ghl: () => env("CC_GHL_API_URL", "https://services.leadconnectorhq.com"),
  slack: () => env("CC_SLACK_API_URL", "https://slack.com/api"),
};

// vault: where the publishing channel reads its token (meta and ghl are the same ids a pasted token uses)
export const CONNECTORS = {
  google: {
    name: "Google Drive", vault: "drive-publish", pkce: true, sep: " ",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    scopeLabel: "create files in Drive (only files this app makes)",
    authUrl: () => `${env("CC_GOOGLE_AUTH_URL", "https://accounts.google.com")}/o/oauth2/v2/auth`,
    tokenUrl: () => `${env("CC_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com")}/token`,
    extraAuth: { access_type: "offline", prompt: "consent" },
    setup: "Google Cloud console: an OAuth client of type Desktop app with the Google Drive API enabled. The browser helper's client works too.",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
  },
  meta: {
    name: "Instagram (Meta)", vault: "meta", pkce: false, sep: ",",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"],
    scopeLabel: "publish to the Instagram professional account linked to your Facebook Page",
    authUrl: () => `${env("CC_META_AUTH_URL", "https://www.facebook.com")}/v21.0/dialog/oauth`,
    tokenUrl: () => `${API.meta()}/oauth/access_token`,
    setup: "Meta for Developers: create an app with Facebook Login, add this app's address as a valid OAuth redirect URI, and paste its App ID and App secret here. The Instagram account must be a professional account linked to a Facebook Page.",
    consoleUrl: "https://developers.facebook.com/apps/",
  },
  ghl: {
    name: "HighLevel", vault: "ghl", pkce: false, sep: " ",
    scopes: ["socialplanner/post.write", "socialplanner/account.readonly"],
    scopeLabel: "schedule social planner posts and list connected accounts",
    authUrl: () => `${env("CC_GHL_AUTH_URL", "https://marketplace.gohighlevel.com")}/oauth/chooselocation`,
    tokenUrl: () => `${API.ghl()}/oauth/token`,
    setup: "HighLevel Marketplace: create a private app (sub-account level) with the social planner post write and account read scopes, add this app's address as a redirect URL, and paste its client ID and secret here.",
    consoleUrl: "https://marketplace.gohighlevel.com/",
  },
  slack: {
    name: "Slack", vault: "slack", pkce: false, sep: ",",
    scopes: ["chat:write", "channels:read"],
    scopeLabel: "post messages as the app and list public channels",
    authUrl: () => `${env("CC_SLACK_AUTH_URL", "https://slack.com")}/oauth/v2/authorize`,
    tokenUrl: () => `${API.slack()}/oauth.v2.access`,
    setup: "api.slack.com/apps: create an app, add the bot scopes chat:write and channels:read, add this app's address as a redirect URL, and paste its client ID and secret here. Invite the app to a channel (/invite) before sending to it.",
    consoleUrl: "https://api.slack.com/apps",
  },
  ghlcrm: {
    name: "HighLevel contacts", vault: "ghl-crm", pkce: false, sep: " ",
    scopes: ["contacts.readonly", "contacts.write", "invoices.readonly", "invoices.write", "workflows.readonly", "conversations.write"],
    scopeLabel: "read and update contacts and invoices, and list workflows. A send, a charge, or a change still waits for your click",
    authUrl: () => `${env("CC_GHL_AUTH_URL", "https://marketplace.gohighlevel.com")}/oauth/chooselocation`,
    tokenUrl: () => `${API.ghl()}/oauth/token`,
    setup: "HighLevel Marketplace: the same private app can add contact, invoice, workflow, and conversation scopes. A send, an invoice, or a workflow still waits for a click in Meldmind.",
    consoleUrl: "https://marketplace.gohighlevel.com/",
  },
};
const HARMLESS = new Set(["openid", "email", "profile", "public_profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const known = (k) => { if (!CONNECTORS[k]) throw fail(400, "unknown connector"); return CONNECTORS[k]; };
const DOC = "publish.connect";
const cdoc = () => doc(DOC, () => ({}));
const entry = (k) => cdoc()[k] || { clientId: null, connectedAt: null, account: null, scopes: [], needsSignIn: false };
function saveEntry(k, e) { const d = { ...cdoc() }; d[k] = e; putDoc(DOC, d); }
// Desktop sign-in returns to this PC. The hub builds an https redirect from CC_HUB_URL and refuses anything else.
export function publishRedirect({ hosted = HOSTED, hubUrl, port } = {}) {
  if (!hosted) {
    const p = Number(port ?? process.env.PORT ?? process.env.CC_PORT ?? 4747);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw fail(500, "The desktop redirect port is not valid.");
    return `http://127.0.0.1:${p}/`;
  }
  const raw = String(hubUrl ?? CFG.hubUrl ?? "").trim();
  if (!raw) throw fail(500, "CC_HUB_URL is not set, so the hub cannot build the sign-in redirect.");
  let u;
  try { u = new URL(raw); } catch { throw fail(400, "CC_HUB_URL is not a valid address."); }
  if (u.protocol !== "https:") throw fail(400, "Hosted sign-in redirects must be https.");
  if (!u.host || u.username || u.password) throw fail(400, "CC_HUB_URL is not a valid https address.");
  return `https://${u.host}/`;
}
export function setupText(id, redirect) {
  const c = known(id);
  let url = redirect;
  if (!url) { try { url = publishRedirect(); } catch { url = ""; } }
  return `${c.setup}${url ? ` Add this exact redirect URL: ${url}` : ""}`;
}

const secret = (k) => getSecret(CONNECTORS[k].vault) || null;
// the client secret has its own vault entry, so a channel never mistakes it for a token
const clientVault = (k) => `${CONNECTORS[k].vault}-client`;
const ownClientSecret = (k) => getSecret(clientVault(k))?.key || null;

// The Google client may be the browser helper's (same person, same OAuth client): read, never written.
function client(k) {
  const own = entry(k).clientId, sec = ownClientSecret(k);
  const envId = !HOSTED ? process.env[`CC_${k.toUpperCase()}_CLIENT_ID`] || null : null;
  if (k === "google" && !own) {
    const hid = doc("browser.google", () => undefined)?.clientId || null;
    return { clientId: hid || envId, clientSecret: sec || getSecret("google-helper")?.clientSecret || null, shared: !!hid };
  }
  if (k === "ghlcrm" && !own) {
    const hid = entry("ghl").clientId || null;
    return { clientId: hid || envId, clientSecret: sec || ownClientSecret("ghl"), shared: !!hid };
  }
  return { clientId: own || envId, clientSecret: sec, shared: false };
}

export const connected = (k) => !!secret(k)?.oauth && !!secret(k)?.key && !entry(k).needsSignIn;

export function view() {
  let redirect = "";
  try { redirect = publishRedirect(); } catch { redirect = ""; }
  return Object.entries(CONNECTORS).map(([id, c]) => {
    const e = entry(id), cl = client(id), s = secret(id);
    return {
      id, name: c.name, scopeLabel: c.scopeLabel, setup: setupText(id, redirect), redirectUri: redirect || null, consoleUrl: c.consoleUrl,
      clientId: e.clientId || null, sharedClient: cl.shared, clientSecretSaved: !!cl.clientSecret,
      connected: connected(id), viaPaste: !!s?.key && !s?.oauth, account: e.account || null,
      connectedAt: e.connectedAt || null, needsSignIn: !!e.needsSignIn,
    };
  });
}

// Connection doctor (0.4.21): for every connector, what is signed in and which asked-for permissions are missing.
// "Reconnect" fixes a missing permission. HighLevel keeps two sign-ins (posts, and contacts/invoices), so a person
// with one and not the other is told which Builders need which.
export function doctor() {
  const rows = [];
  const byId = Object.fromEntries(view().map((v) => [v.id, v]));
  for (const [id, c] of Object.entries(CONNECTORS)) {
    const v = byId[id];
    const granted = new Set(entry(id).scopes || []);
    if (v.needsSignIn) { rows.push({ id, name: c.name, level: "fix", problem: `${c.name} needs you to sign in again.`, fix: "reconnect" }); continue; }
    if (!v.connected) continue;
    if (v.viaPaste) { rows.push({ id, name: c.name, level: "ok", problem: `${c.name} uses a pasted token, so Meldmind cannot list its permissions. It works as long as the token was made with the right ones.`, fix: "" }); continue; }
    const missing = c.scopes.filter((x) => !granted.has(x));
    if (missing.length) rows.push({ id, name: c.name, level: "fix", problem: `${c.name} is connected but is missing: ${missing.join(", ")}.`, missing, fix: "reconnect" });
    else rows.push({ id, name: c.name, level: "ok", problem: `${c.name} has every permission Meldmind asks for.`, fix: "" });
  }
  if (byId.ghl?.connected && !byId.ghlcrm?.connected) rows.push({ id: "ghlcrm", name: "HighLevel contacts", level: "tip", problem: "HighLevel posts are connected, but contacts, invoices and workflows are not. Builders for HighLevel texts and invoices need that second sign-in.", fix: "connect" });
  return rows;
}

export async function setClient(k, { clientId: id, clientSecret } = {}) {
  known(k);
  if (id !== undefined) {
    const v = String(id || "").trim();
    if (v && !/^[A-Za-z0-9._-]{4,200}$/.test(v)) throw fail(400, "That does not look like an OAuth client ID.");
    saveEntry(k, { ...entry(k), clientId: v || null });
  }
  if (clientSecret !== undefined) {
    const v = String(clientSecret || "").trim();
    if (v && (v.length > 400 || /\s/.test(v))) throw fail(400, "That does not look like a client secret.");
    await setSecret(clientVault(k), v ? { key: v } : null);
  }
  return view().find((x) => x.id === k);
}

const pending = new Map(); // state -> { k, verifier, redirectUri, user, at }
const userId = () => { try { return ctx().userId; } catch { return null; } };
const b64url = (b) => Buffer.from(b).toString("base64url");

export function start(k, { redirectUri, hosted = HOSTED } = {}) {
  const c = known(k);
  if (hosted && !/^https:\/\//i.test(String(redirectUri || ""))) throw fail(400, "Hosted sign-in redirects must be https.");
  if (!/^https?:\/\/[^\s]+$/.test(String(redirectUri || ""))) throw fail(400, "redirectUri required");
  const cl = client(k);
  if (!cl.clientId) throw fail(400, `Add the client ID first. ${setupText(k, redirectUri)}`, { code: "client_id" });
  for (const [s, p] of pending) if (Date.now() - p.at > 10 * 60 * 1000 || (p.user === userId() && p.k === k)) pending.delete(s);
  const state = `pub-${k}-` + b64url(crypto.randomBytes(24));
  const verifier = c.pkce ? b64url(crypto.randomBytes(48)) : null;
  pending.set(state, { k, verifier, redirectUri, user: userId(), at: Date.now() });
  const u = new URL(c.authUrl());
  u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", cl.clientId); u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", c.scopes.join(c.sep)); u.searchParams.set("state", state);
  if (verifier) { u.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest())); u.searchParams.set("code_challenge_method", "S256"); }
  for (const [a, b] of Object.entries(c.extraAuth || {})) u.searchParams.set(a, b);
  return { url: u.toString(), state, scopes: c.scopes };
}

function netReason(e) {
  const code = e?.cause?.code || e?.code || "";
  if (e?.name === "TimeoutError") return "no answer in time";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "address not found";
  return "network error";
}

// One JSON request to a connector's own API (token swaps, account lookups). Never follows redirects.
export async function request(name, url, { method = "GET", form, json, headers = {}, token } = {}) {
  let r;
  const h = { accept: "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let body;
  if (form) { h["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  else if (json) { h["content-type"] = "application/json; charset=utf-8"; body = JSON.stringify(json); }
  try { r = await fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(20000), redirect: "error" }); }
  catch (e) { throw fail(502, `Could not reach ${name}: ${netReason(e)}`, { network: true }); }
  let j = null; try { j = await r.json(); } catch {}
  return { r, j: j || {} };
}

async function tokenSwap(k, form) {
  const c = CONNECTORS[k], cl = client(k);
  const base = { client_id: cl.clientId, ...(cl.clientSecret ? { client_secret: cl.clientSecret } : {}) };
  // Meta takes the swap as a GET with query parameters; the others take a form POST
  const { r, j } = k === "meta"
    ? await request(c.name, `${c.tokenUrl()}?${new URLSearchParams({ ...base, ...form })}`)
    : await request(c.name, c.tokenUrl(), { method: "POST", form: { ...base, ...form } });
  const err = j.error_description || j.error?.message || (typeof j.error === "string" ? j.error : null) || j.message;
  if (!r.ok || !j.access_token || j.ok === false) throw fail(r.status >= 500 ? 502 : 400, `${c.name} sign-in failed${err ? `: ${String(err).slice(0, 160)}` : ` (HTTP ${r.status})`}`, { rejected: r.status === 400 || r.status === 401 || j.ok === false });
  return j;
}

const expires = (tok) => (tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null);

// After the code swap: what each service needs on top of the token (Meta: a Page token and the IG id).
async function settle(k, tok, p) {
  if (k === "meta") {
    const c = CONNECTORS.meta, cl = client("meta");
    // long-lived user token, then the Page token (does not expire) for the Page with an Instagram account
    const ll = await request(c.name, `${c.tokenUrl()}?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: cl.clientId, client_secret: cl.clientSecret || "", fb_exchange_token: tok.access_token })}`);
    const user = ll.r.ok && ll.j.access_token ? ll.j.access_token : tok.access_token;
    const pages = await request(c.name, `${API.meta()}/me/accounts?${new URLSearchParams({ fields: "name,access_token,instagram_business_account{id,username}", access_token: user })}`);
    if (!pages.r.ok) throw fail(400, `Meta did not list your Facebook Pages${pages.j.error?.message ? `: ${String(pages.j.error.message).slice(0, 160)}` : ""}`);
    const page = (pages.j.data || []).find((x) => x.instagram_business_account?.id && x.access_token);
    if (!page) throw fail(400, "None of your Facebook Pages has an Instagram professional account linked. Link one in Instagram settings, then connect again.", { code: "no_ig" });
    const ig = page.instagram_business_account;
    return { secret: { key: page.access_token, igUserId: String(ig.id) }, account: `${ig.username ? "@" + ig.username : "Instagram " + ig.id} via ${page.name}` };
  }
  if (k === "ghl" || k === "ghlcrm") {
    if (!tok.locationId) throw fail(400, "HighLevel did not say which sub-account was picked. Install the app on one sub-account (location), then connect again.", { code: "no_location" });
    return { secret: { key: tok.access_token, refresh: tok.refresh_token || null, expiresAt: expires(tok), locationId: String(tok.locationId) }, account: `location ${tok.locationId}` };
  }
  if (k === "slack") return { secret: { key: tok.access_token, team: tok.team?.name || null }, account: tok.team?.name ? `workspace ${tok.team.name}` : "Slack workspace" };
  return { secret: { key: tok.access_token, refresh: tok.refresh_token || null, expiresAt: expires(tok) }, account: "Google Drive" };
}

export async function finish({ code, state } = {}) {
  const p = pending.get(String(state || ""));
  if (!p) throw fail(400, "This sign-in link is stale or was not started here. Start again from Settings > Publishing.", { code: "state" });
  if (HOSTED && p.user !== userId()) throw fail(403, "This sign-in belongs to another account.");
  pending.delete(state);
  if (!code) throw fail(400, "No code came back from the sign-in.");
  const k = p.k, c = CONNECTORS[k];
  const tok = await tokenSwap(k, { grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri, ...(p.verifier ? { code_verifier: p.verifier } : {}), ...(k === "ghl" || k === "ghlcrm" ? { user_type: "Location" } : {}) });
  const got = String(tok.scope || "").split(/[\s,]+/).filter(Boolean);
  const extra = got.filter((x) => !c.scopes.includes(x) && !HARMLESS.has(x));
  if (extra.length) throw fail(400, `The sign-in granted more than this app asked for (${extra.slice(0, 3).join(", ")}). Nothing was saved; check the app's scopes at ${c.name}.`, { code: "scope" });
  const out = await settle(k, tok, p);
  const { assertServiceSlots } = await import("../service-limit.js");
  const catalog = { ghl: "ghl", ghlcrm: "ghl", meta: "instagram", slack: "slack", google: "publish-google" };
  await assertServiceSlots([catalog[k] || k]);
  await setSecret(c.vault, { ...out.secret, oauth: true });
  saveEntry(k, { ...entry(k), connectedAt: Date.now(), account: out.account, scopes: got.length ? got : c.scopes, needsSignIn: false });
  emit("log", { text: `${c.name} connected for publishing (${out.account}). The token is in the vault; nothing posts without your click.` });
  return view().find((x) => x.id === k);
}

export async function disconnect(k) {
  const c = known(k);
  await setSecret(c.vault, null);
  saveEntry(k, { ...entry(k), connectedAt: null, account: null, scopes: [], needsSignIn: false });
  emit("log", { text: `${c.name} disconnected from publishing; its token was removed from the vault.` });
  return view().find((x) => x.id === k);
}

// The secret a channel posts with. OAuth tokens that expire (Google, HighLevel) are refreshed first; a
// pasted token is returned as it is. A refused refresh marks the connector "connect again".
export async function fresh(k) {
  const c = known(k), s = secret(k);
  if (!s?.key || !s.oauth || !s.expiresAt || s.expiresAt - Date.now() > 60000) return s;
  if (!s.refresh) { saveEntry(k, { ...entry(k), needsSignIn: true }); throw fail(409, `The ${c.name} sign-in expired. Connect it again in Settings > Publishing.`, { code: "sign_in" }); }
  try {
    const tok = await tokenSwap(k, { grant_type: "refresh_token", refresh_token: s.refresh, ...(k === "ghl" || k === "ghlcrm" ? { user_type: "Location" } : {}) });
    const next = { ...s, key: tok.access_token, refresh: tok.refresh_token || s.refresh, expiresAt: expires(tok) };
    await setSecret(c.vault, next);
    return next;
  } catch (e) {
    if (e.network) throw e;
    saveEntry(k, { ...entry(k), needsSignIn: true });
    throw fail(409, `The ${c.name} sign-in expired (${e.message}). Connect it again in Settings > Publishing.`, { code: "sign_in" });
  }
}
