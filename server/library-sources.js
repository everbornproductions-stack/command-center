// Knowledge libraries (Phase 18): Google Drive and Notion as sources, through the person's own OAuth sign-in,
// read-only.
//  - Google: OAuth 2 with PKCE (S256), scope drive.readonly and nothing else. A grant wider than that is
//    refused and nothing is kept. Its own tokens (vault "library-google"), separate from the browser helper's
//    Google sign-in; the OAuth client can be the same one (its client ID and secret are reused when this
//    one has none of its own). Only GET requests are ever made to Drive.
//  - Notion: a public integration's OAuth (owner=user). Notion has no scopes in the sign-in link; what an
//    integration may do is set where it is created, so the UI asks for "Read content" only. This adapter
//    can only call the read endpoints (POST /v1/search, GET pages and block children); anything else is
//    refused before a request is made.
//  - Client secrets and tokens live in the vault, never in a file, a log or a reply to the browser.
import crypto from "node:crypto";
import { getSecret, setSecret } from "./vault.js";
import { HOSTED, doc, putDoc, ctx } from "./store.js";
import { emit } from "./events.js";
import { extract } from "./library-extract.js";

const env = (k, d) => (process.env[k] || d).replace(/\/$/, "");
const googleAuthUrl = () => `${env("CC_GOOGLE_AUTH_URL", "https://accounts.google.com")}/o/oauth2/v2/auth`;
const googleTokenUrl = () => `${env("CC_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com")}/token`;
const driveApi = () => env("CC_DRIVE_API_URL", "https://www.googleapis.com");
const notionApi = () => env("CC_NOTION_API_URL", "https://api.notion.com");
const NOTION_VERSION = "2022-06-28";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const HARMLESS = new Set(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);
export const GOOGLE_SETUP = "Google Cloud console: an OAuth client of type Desktop app with the Google Drive API enabled. The browser helper's client works too.";
// Plain steps shown where Notion is set up (Settings > Library sources, and the Libraries tab). {address} is filled in by the page.
export const NOTION_STEPS = [
  "Open notion.so/profile/integrations and click New integration.",
  "Give it any name, pick Public, and fill in the website and privacy page Notion asks for (any pages of yours will do).",
  "Under what it can do, tick Read content only. Leave Update content and Insert content unticked.",
  "Under Redirect URIs, paste this address: {address}",
  "Save it, then copy the OAuth client ID and the OAuth client secret from that page and paste them into the two boxes below.",
  "Click Connect Notion, and in Notion's window choose the pages to share with Meldmind. Meldmind only reads them.",
];
export const NOTION_SETUP = "Create a Notion integration first, then paste its ID and secret here. The steps are under Notion in Settings > Library sources.";

const fail = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });
const b64url = (b) => Buffer.from(b).toString("base64url");
const userId = () => { try { return ctx().userId; } catch { return null; } };
function netReason(e) {
  const code = e?.cause?.code || e?.code || "";
  if (e?.name === "TimeoutError") return "no answer in time";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "address not found";
  return "network error";
}

const SRC = {
  google: { vault: "library-google", doc: "libraries.google", name: "Google Drive" },
  notion: { vault: "library-notion", doc: "libraries.notion", name: "Notion" },
};
const sdoc = (k) => doc(SRC[k].doc, () => ({ clientId: null, connectedAt: null, needsSignIn: false, scopes: [], workspace: null }));
const secret = (k) => getSecret(SRC[k].vault) || null;
// The Google client may be the browser helper's (same person, same OAuth client): read, never written.
const helperGoogle = () => ({ clientId: doc("browser.google", () => undefined)?.clientId || null, clientSecret: getSecret("google-helper")?.clientSecret || null });
function client(k) {
  const own = sdoc(k).clientId, sec = secret(k)?.clientSecret || null;
  if (k === "google") {
    if (own) return { clientId: own, clientSecret: sec, shared: false };
    const h = helperGoogle();
    const envId = !HOSTED ? process.env.CC_GOOGLE_CLIENT_ID || null : null;
    return { clientId: h.clientId || envId, clientSecret: sec || h.clientSecret, shared: !!(h.clientId || envId) };
  }
  return { clientId: own || (!HOSTED ? process.env.CC_NOTION_CLIENT_ID || null : null), clientSecret: sec, shared: false };
}
const hasToken = (k) => !!secret(k)?.access;
export const connected = (k) => hasToken(k) && !sdoc(k).needsSignIn;

export function sourceView(k) {
  const d = sdoc(k), c = client(k);
  return { source: k, name: SRC[k].name, clientId: d.clientId || null, sharedClient: c.shared && !d.clientId, clientReady: !!c.clientId, clientSecretSaved: !!secret(k)?.clientSecret, connected: connected(k), needsSignIn: !!d.needsSignIn, connectedAt: d.connectedAt || null, workspace: d.workspace || null, scopes: k === "google" ? (d.scopes || []) : [], setup: k === "google" ? GOOGLE_SETUP : NOTION_SETUP, steps: k === "notion" ? NOTION_STEPS : [], readOnly: true };
}

export async function setClient(k, { clientId, clientSecret } = {}) {
  const d = sdoc(k);
  if (clientId !== undefined) {
    const v = String(clientId || "").trim();
    if (v && !/^[A-Za-z0-9._-]{8,200}$/.test(v)) throw fail(400, "That does not look like an OAuth client ID.");
    d.clientId = v || null; putDoc(SRC[k].doc, d);
  }
  if (clientSecret !== undefined) {
    const v = String(clientSecret || "").trim();
    if (v && (v.length > 400 || /\s/.test(v))) throw fail(400, "That does not look like a client secret.");
    await setSecret(SRC[k].vault, { ...(secret(k) || {}), key: "oauth", clientSecret: v || null });
  }
  return sourceView(k);
}

const pending = new Map(); // state -> { k, verifier, redirectUri, user, at }
export function start(k, { redirectUri } = {}) {
  const c = client(k);
  if (!c.clientId) throw fail(400, `Add the OAuth client ID first. ${k === "google" ? GOOGLE_SETUP : NOTION_SETUP}`, { code: "client_id" });
  if (!/^https?:\/\/[^\s]+$/.test(String(redirectUri || ""))) throw fail(400, "redirectUri required");
  for (const [s, p] of pending) if (Date.now() - p.at > 10 * 60 * 1000 || (p.user === userId() && p.k === k)) pending.delete(s);
  const state = `lib-${k === "google" ? "g" : "n"}-${b64url(crypto.randomBytes(24))}`;
  const verifier = b64url(crypto.randomBytes(48));
  pending.set(state, { k, verifier, redirectUri, user: userId(), at: Date.now() });
  if (k === "google") {
    const u = new URL(googleAuthUrl());
    u.searchParams.set("response_type", "code"); u.searchParams.set("client_id", c.clientId); u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("scope", DRIVE_SCOPE); u.searchParams.set("code_challenge", b64url(crypto.createHash("sha256").update(verifier).digest()));
    u.searchParams.set("code_challenge_method", "S256"); u.searchParams.set("state", state);
    u.searchParams.set("access_type", "offline"); u.searchParams.set("prompt", "consent");
    return { url: u.toString(), state, scopes: [DRIVE_SCOPE] };
  }
  const u = new URL(`${notionApi()}/v1/oauth/authorize`);
  u.searchParams.set("client_id", c.clientId); u.searchParams.set("response_type", "code"); u.searchParams.set("owner", "user");
  u.searchParams.set("redirect_uri", redirectUri); u.searchParams.set("state", state);
  return { url: u.toString(), state, scopes: [] };
}

async function postForm(url, form, headers = {}) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { accept: "application/json", ...headers }, body: form, signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw fail(502, `Could not reach the sign-in server: ${netReason(e)}`, { network: true }); }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j?.access_token) throw fail(r.status >= 500 ? 502 : 400, `Sign-in failed${j?.error_description || j?.error ? `: ${String(j.error_description || j.error).slice(0, 160)}` : ` (HTTP ${r.status})`}`, { rejected: r.status === 400 || r.status === 401 });
  return j;
}
const googleToken = (form) => { const c = client("google"); return postForm(googleTokenUrl(), new URLSearchParams({ ...form, client_id: c.clientId, ...(c.clientSecret ? { client_secret: c.clientSecret } : {}) }).toString(), { "content-type": "application/x-www-form-urlencoded" }); };
const notionToken = (body) => { const c = client("notion"); return postForm(`${notionApi()}/v1/oauth/token`, JSON.stringify(body), { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret || ""}`).toString("base64")}` }); };

export async function finish({ code, state } = {}) {
  const p = pending.get(String(state || ""));
  if (!p) throw fail(400, "This sign-in link is stale or was not started here. Start again from the Libraries tab.", { code: "state" });
  if (HOSTED && p.user !== userId()) throw fail(403, "This sign-in belongs to another account.");
  pending.delete(state);
  if (!code) throw fail(400, "No code came back from the sign-in.");
  const k = p.k, cur = secret(k) || {};
  const { assertServiceSlots } = await import("./service-limit.js");
  await assertServiceSlots([k === "google" ? "library-google" : "notion"]);
  if (k === "google") {
    const tok = await googleToken({ grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri, code_verifier: p.verifier });
    const got = String(tok.scope || DRIVE_SCOPE).split(/\s+/).filter(Boolean);
    if (got.some((x) => x !== DRIVE_SCOPE && !HARMLESS.has(x))) throw fail(400, "The sign-in granted more than read-only Drive access (for example full Drive or Gmail). Nothing was saved; libraries only ever ask for drive.readonly.", { code: "scope" });
    if (!got.includes(DRIVE_SCOPE)) throw fail(400, "The sign-in did not allow reading Google Drive. Nothing was saved.", { code: "scope" });
    await setSecret(SRC.google.vault, { key: "oauth", clientSecret: cur.clientSecret || null, access: tok.access_token, refresh: tok.refresh_token || null, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
    const d = sdoc("google"); d.scopes = [DRIVE_SCOPE]; d.connectedAt = Date.now(); d.needsSignIn = false; putDoc(SRC.google.doc, d);
  } else {
    const tok = await notionToken({ grant_type: "authorization_code", code: String(code), redirect_uri: p.redirectUri });
    await setSecret(SRC.notion.vault, { key: "oauth", clientSecret: cur.clientSecret || null, access: tok.access_token, refresh: tok.refresh_token || null, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
    const d = sdoc("notion"); d.connectedAt = Date.now(); d.needsSignIn = false; d.workspace = String(tok.workspace_name || "").slice(0, 120) || null; putDoc(SRC.notion.doc, d);
  }
  emit("log", { text: `${SRC[k].name} connected to knowledge libraries (read-only). The token is in the vault.` });
  return sourceView(k);
}
export async function disconnect(k) {
  const cur = secret(k);
  await setSecret(SRC[k].vault, cur?.clientSecret ? { key: "oauth", clientSecret: cur.clientSecret } : null);
  const d = sdoc(k); d.connectedAt = null; d.needsSignIn = false; d.scopes = []; d.workspace = null; putDoc(SRC[k].doc, d);
  emit("log", { text: `${SRC[k].name} disconnected from knowledge libraries; its tokens were removed from the vault.` });
  return sourceView(k);
}

const markSignIn = (k) => { const d = sdoc(k); d.needsSignIn = true; putDoc(SRC[k].doc, d); };
async function accessToken(k) {
  const s = secret(k);
  if (!s?.access) throw fail(400, `${SRC[k].name} is not connected. Connect it in the Libraries tab.`, { code: "not_connected" });
  if (s.expiresAt && s.expiresAt - Date.now() < 60000) {
    if (!s.refresh) { markSignIn(k); throw fail(409, `The ${SRC[k].name} sign-in expired. Connect it again.`, { code: "sign_in" }); }
    try {
      const tok = k === "google" ? await googleToken({ grant_type: "refresh_token", refresh_token: s.refresh }) : await notionToken({ grant_type: "refresh_token", refresh_token: s.refresh });
      await setSecret(SRC[k].vault, { ...s, access: tok.access_token, refresh: tok.refresh_token || s.refresh, expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null });
      return tok.access_token;
    } catch (e) { if (e.network) throw e; markSignIn(k); throw fail(409, `The ${SRC[k].name} sign-in expired (${e.message}). Connect it again.`, { code: "sign_in" }); }
  }
  return s.access;
}

// ---------- Google Drive: GET only ----------
async function drive(pathq, { raw = false } = {}) {
  const token = await accessToken("google");
  let r;
  try { r = await fetch(`${driveApi()}${pathq}`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: raw ? "*/*" : "application/json" }, signal: AbortSignal.timeout(30000), redirect: "error" }); }
  catch (e) { throw fail(502, `Could not reach Google Drive: ${netReason(e)}`, { network: true }); }
  if (r.status === 401) { markSignIn("google"); throw fail(409, "Google refused the sign-in (401). Connect Google Drive again.", { code: "sign_in" }); }
  if (r.status === 403) throw fail(403, "Google said no (403): the sign-in does not allow reading this.");
  if (!r.ok) throw fail(502, `Google Drive answered HTTP ${r.status}.`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}
const FOLDER = "application/vnd.google-apps.folder";
const EXPORT = { "application/vnd.google-apps.document": ["text/plain", ".txt"], "application/vnd.google-apps.spreadsheet": ["text/csv", ".csv"], "application/vnd.google-apps.presentation": ["text/plain", ".txt"] };
const DRIVE_TYPES = { "application/pdf": ".pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "text/html": ".html", "text/csv": ".csv", "text/markdown": ".md", "application/json": ".json" };
const driveExt = (f) => EXPORT[f.mimeType]?.[1] || DRIVE_TYPES[f.mimeType] || (/^text\//.test(f.mimeType || "") ? ".txt" : null);
const fileRow = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, folder: f.mimeType === FOLDER, readable: f.mimeType === FOLDER || !!driveExt(f), modified: f.modifiedTime || null, link: f.webViewLink || null, size: f.size ? Number(f.size) : null });
// Lists a folder (default: My Drive's top level) or searches by name / text.
export async function driveList({ q = "", folder = "" } = {}) {
  const parts = ["trashed = false"];
  const term = String(q || "").replace(/['\\]/g, " ").trim().slice(0, 200);
  if (term) parts.push(`(name contains '${term}' or fullText contains '${term}')`);
  else parts.push(`'${/^[A-Za-z0-9_-]{6,128}$/.test(String(folder)) ? folder : "root"}' in parents`);
  const params = new URLSearchParams({ q: parts.join(" and "), pageSize: "100", orderBy: term ? "modifiedTime desc" : "folder,name", fields: "files(id,name,mimeType,modifiedTime,webViewLink,size)" });
  const r = await drive(`/drive/v3/files?${params}`);
  return (r.files || []).map(fileRow);
}
// Reads files (and the files inside picked folders, one level of subfolders deep at most 3) as library items.
export async function driveItems(ids, { maxFiles = 200 } = {}) {
  const out = [];
  const seen = new Set();
  const visit = async (id, depth) => {
    if (out.length >= maxFiles || seen.has(id)) return;
    seen.add(id);
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(String(id))) { out.push({ source: "drive", ref: String(id).slice(0, 80), title: String(id).slice(0, 80), skipped: "not a Drive file id" }); return; }
    const f = await drive(`/drive/v3/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "id,name,mimeType,modifiedTime,webViewLink,size" })}`);
    if (f.mimeType === FOLDER) {
      if (depth > 3) return;
      const kids = await drive(`/drive/v3/files?${new URLSearchParams({ q: `'${f.id}' in parents and trashed = false`, pageSize: "200", fields: "files(id,name,mimeType)" })}`);
      for (const k of kids.files || []) await visit(k.id, depth + 1);
      return;
    }
    const ext = driveExt(f);
    const base = { source: "drive", ref: f.id, title: f.name, url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
    if (!ext) { out.push({ ...base, skipped: "file type not supported" }); return; }
    if (f.size && Number(f.size) > 20 * 1024 * 1024) { out.push({ ...base, skipped: "larger than 20 MB" }); return; }
    const buf = EXPORT[f.mimeType] ? await drive(`/drive/v3/files/${encodeURIComponent(f.id)}/export?${new URLSearchParams({ mimeType: EXPORT[f.mimeType][0] })}`, { raw: true }) : await drive(`/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`, { raw: true });
    const r = extract(`${f.name}${ext && !f.name.toLowerCase().endsWith(ext) ? ext : ""}`, buf);
    out.push(r.skipped ? { ...base, skipped: r.skipped } : { ...base, text: r.text });
  };
  for (const id of (ids || []).slice(0, 200)) await visit(String(id), 0);
  return out;
}

// ---------- Notion: read endpoints only ----------
const NOTION_READ = [["POST", /^\/v1\/search$/], ["GET", /^\/v1\/pages\/[\w-]+$/], ["GET", /^\/v1\/blocks\/[\w-]+\/children$/]];
export const notionAllowed = (method, p) => NOTION_READ.some(([m, re]) => m === method && re.test(p));
async function notion(method, p, { query, body } = {}) {
  if (!notionAllowed(method, p)) throw fail(500, `Refused: ${method} ${p} is not a read-only Notion call.`); // never reached by design
  const token = await accessToken("notion");
  let r;
  try { r = await fetch(`${notionApi()}${p}${query ? `?${new URLSearchParams(query)}` : ""}`, { method, headers: { authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: "error" }); }
  catch (e) { throw fail(502, `Could not reach Notion: ${netReason(e)}`, { network: true }); }
  if (r.status === 401) { markSignIn("notion"); throw fail(409, "Notion refused the sign-in (401). Connect Notion again.", { code: "sign_in" }); }
  if (r.status === 403 || r.status === 404) throw fail(403, "Notion said no: share the page with the integration first (Notion page menu > Connections).");
  if (r.status === 429) throw fail(429, "Notion is rate limiting; try again in a minute.");
  if (!r.ok) throw fail(502, `Notion answered HTTP ${r.status}.`);
  return r.json();
}
const plain = (rich) => (rich || []).map((t) => t.plain_text || "").join("");
function pageTitle(pg) {
  for (const v of Object.values(pg?.properties || {})) if (v?.type === "title") return plain(v.title) || "Untitled";
  return "Untitled";
}
export async function notionList({ q = "" } = {}) {
  const r = await notion("POST", "/v1/search", { body: { query: String(q || "").slice(0, 200), filter: { property: "object", value: "page" }, page_size: 50 } });
  return (r.results || []).map((pg) => ({ id: pg.id, name: pageTitle(pg), url: pg.url || null, modified: pg.last_edited_time || null }));
}
const BLOCK_TEXT = (b) => { const v = b[b.type]; if (!v) return ""; const t = plain(v.rich_text || v.text || v.caption); if (b.type?.startsWith("heading")) return `\n${t}\n`; if (b.type === "bulleted_list_item" || b.type === "numbered_list_item" || b.type === "to_do") return `- ${t}`; if (b.type === "code") return `\n${t}\n`; if (b.type === "child_page") return v.title ? `(${v.title})` : ""; return t; };
async function blocksText(id, depth, budget) {
  const lines = [];
  let cursor;
  do {
    if (budget.calls-- <= 0) break;
    const r = await notion("GET", `/v1/blocks/${id}/children`, { query: { page_size: "100", ...(cursor ? { start_cursor: cursor } : {}) } });
    for (const b of r.results || []) {
      const t = BLOCK_TEXT(b);
      if (t.trim()) lines.push(t);
      if (b.has_children && depth < 3 && b.type !== "child_page") lines.push(await blocksText(b.id, depth + 1, budget));
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return lines.join("\n");
}
export async function notionItems(ids) {
  const out = [];
  for (const id of (ids || []).slice(0, 100)) {
    if (!/^[\w-]{8,64}$/.test(String(id))) { out.push({ source: "notion", ref: String(id).slice(0, 80), title: String(id).slice(0, 80), skipped: "not a Notion page id" }); continue; }
    const pg = await notion("GET", `/v1/pages/${id}`);
    const text = (await blocksText(id, 0, { calls: 60 })).replace(/\n{3,}/g, "\n\n").trim();
    const base = { source: "notion", ref: pg.id || id, title: pageTitle(pg), url: pg.url || null };
    out.push(text ? { ...base, text } : { ...base, skipped: "the page has no text" });
  }
  return out;
}
