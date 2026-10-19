// "Save to Drive": two ways, picked in this order.
//  1. Google Drive connected (Settings > Publishing > Connect, scope drive.file only): the deliverable is
//     uploaded as a Markdown file, plus any media job files, into a "Command AI" folder this app creates.
//     drive.file means the app can only see and change files it made itself.
//  2. Otherwise (local mode): the deliverable is written into a folder you choose, typically your Google
//     Drive desktop-synced folder, so it syncs without OAuth.
import fs from "node:fs";
import path from "node:path";
import { API } from "./oauth.js";
export const id = "drive";
export const name = "Google Drive";
export const MAX_FILE = 200 * 1024 * 1024;
const FOLDER = "application/vnd.google-apps.folder";

const viaApi = (secret) => !!(secret?.key && secret?.oauth);
const folderOk = (prefs, hosted) => !hosted && !!prefs?.driveFolder && fs.existsSync(prefs.driveFolder);
export function ready(prefs, hosted, secret) { return viaApi(secret) || folderOk(prefs, hosted); }
const safe = (s) => String(s || "untitled").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "untitled";

export function preview({ title, files }, prefs, secret, hosted) {
  const problems = [];
  const extra = files?.length ? ` + ${files.length} file${files.length === 1 ? "" : "s"}` : "";
  if (viaApi(secret)) {
    for (const f of files || []) { try { if (fs.statSync(f).size > MAX_FILE) problems.push(`${path.basename(f)} is over 200 MB`); } catch { problems.push(`${path.basename(f)} is missing`); } }
    return { channel: id, summary: `Upload "${title}" as Markdown${extra} to your Google Drive, folder "Command AI"`, problems };
  }
  if (hosted) problems.push("Connect Google Drive in Settings > Publishing");
  else if (!prefs?.driveFolder) problems.push("Connect Google Drive, or choose a Drive-synced folder, in Settings > Publishing");
  else if (!fs.existsSync(prefs.driveFolder)) problems.push(`Folder not found: ${prefs.driveFolder}`);
  return { channel: id, summary: `Save "${title}" as Markdown${extra} into ${prefs?.driveFolder || "(no folder)"}`, problems };
}

const signIn = () => Object.assign(new Error("Google refused the Drive sign-in (401). Connect Google Drive again in Settings > Publishing."), { status: 409, code: "sign_in" });
async function driveFetch(url, opts, token) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(120000), redirect: "error" });
  if (r.status === 401) throw signIn();
  return r;
}
async function jsonOf(r, what) { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(`Drive ${what}: ${j.error?.message || `HTTP ${r.status}`}`), { status: r.status }); return j; }

async function makeFolder(token) {
  const r = await driveFetch(`${API.google()}/drive/v3/files?fields=id`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ name: "Command AI", mimeType: FOLDER }) }, token);
  return (await jsonOf(r, "folder")).id;
}

async function uploadText(token, folderId, filename, text) {
  const b = "cc" + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [folderId], mimeType: "text/markdown" })}\r\n--${b}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n--${b}--`;
  const r = await driveFetch(`${API.googleUpload()}/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${b}` }, body }, token);
  return jsonOf(r, "upload");
}

// Larger files (media job outputs) go up as a resumable upload: a session, then the bytes.
async function uploadFile(token, folderId, file) {
  const bytes = fs.readFileSync(file);
  const type = /\.mp4$/i.test(file) ? "video/mp4" : /\.png$/i.test(file) ? "image/png" : /\.jpe?g$/i.test(file) ? "image/jpeg" : /\.mp3$/i.test(file) ? "audio/mpeg" : /\.wav$/i.test(file) ? "audio/wav" : "application/octet-stream";
  const base = API.googleUpload();
  const r = await driveFetch(`${base}/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink`, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", "x-upload-content-type": type, "x-upload-content-length": String(bytes.length) }, body: JSON.stringify({ name: path.basename(file), parents: [folderId] }) }, token);
  if (!r.ok) await jsonOf(r, "upload");
  const loc = r.headers.get("location") || "";
  // the bytes only ever go back to Google's own upload address
  let u; try { u = new URL(loc); } catch { throw new Error("Drive upload: no upload address came back"); }
  if (u.origin !== new URL(base).origin) throw new Error("Drive upload: the upload address is not Google's; nothing was sent");
  const put = await driveFetch(u.toString(), { method: "PUT", headers: { "content-type": type }, body: bytes }, token);
  return jsonOf(put, "upload");
}

async function postApi({ title, text, files }, prefs, secret) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  let folderId = prefs?.driveFolderId || await makeFolder(secret.key);
  let doc;
  try { doc = await uploadText(secret.key, folderId, `${stamp} ${safe(title)}.md`, `# ${title}\n\n${text || ""}\n`); }
  catch (e) { if (e.status !== 404 || !prefs?.driveFolderId) throw e; folderId = await makeFolder(secret.key); doc = await uploadText(secret.key, folderId, `${stamp} ${safe(title)}.md`, `# ${title}\n\n${text || ""}\n`); }
  const copied = [];
  for (const f of files || []) { if (fs.existsSync(f)) { const up = await uploadFile(secret.key, folderId, f); copied.push(up.webViewLink || up.id); } }
  const link = /^https:\/\//.test(doc.webViewLink || "") ? doc.webViewLink : null;
  return { id: doc.id || null, url: link, copied, folderId, via: "api" };
}

function postFolder({ title, text, files, projectId }, prefs) {
  const dir = path.join(prefs.driveFolder, "Everborn Command", projectId ? safe(projectId) : "unfiled");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const f = path.join(dir, `${stamp} ${safe(title)}.md`);
  fs.writeFileSync(f, `# ${title}\n\n${text || ""}\n`);
  const copied = [];
  for (const src of files || []) { try { if (fs.existsSync(src)) { const dst = path.join(dir, path.basename(src)); fs.copyFileSync(src, dst); copied.push(dst); } } catch {} }
  return { id: f, url: f, copied, via: "folder" };
}

export async function post(pl, prefs, secret) { return viaApi(secret) ? postApi(pl, prefs, secret) : postFolder(pl, prefs); }
