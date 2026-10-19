// ChatGPT and Claude history import, optional encrypted sync (Phase 23): the routes behind the History tab.
// Import works on the desktop app only, so an export never leaves the PC; sync is off until the person sets a
// passphrase, and only sealed blobs reach Supabase (server/history-sync.js, web/sync-crypto.js).
//   GET  /api/history                     imports so far, sync status, limits
//   POST /api/history/preview             { path } | { name, data: base64 } | a raw zip body (content-type application/zip)
//                                         -> { token, source, conversations, messages, sample, ... } (nothing filed yet)
//   POST /api/history/import              { token, projectId: "new" | "<id>" | "" } -> files the chats
//   GET  /api/history/sync                sync status (+ the Supabase address and publishable key for a browser client)
//   POST /api/history/sync/setup          { passphrase, code?, remember? } start a new sync code, or join one
//   POST /api/history/sync/now            push and pull once
//   POST /api/history/sync/off            { deleteRemote? } turn off on this device (and empty the cloud copy)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as I from "../history-import.js";
import * as Y from "../history-sync.js";
import { cloud } from "../license.js";

export const id = "history";
const HOSTED_IMPORT = "Import runs on the desktop app, so your export never leaves your PC. Import there, then turn on sync to read the chats here.";
const HOSTED_SYNC = "On the hosted hub, sync runs in your browser: open the History tab and enter your sync code and passphrase.";
const UPLOAD_MAX = 512 * 1024 * 1024;
const PREVIEW_MS = 15 * 60 * 1000;
const err = (status, msg, code) => Object.assign(new Error(msg), { status, code });
const pending = new Map(); // token -> { parsed, user, until }

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0; let over = false;
    req.on("data", (c) => { if (over) return; n += c.length; if (n > limit) { over = true; reject(err(413, `The file is larger than ${Math.round(limit / 1048576)} MB. Pick it by its location on this PC instead.`, "too_big")); req.resume(); return; } parts.push(c); });
    req.on("end", () => { if (!over) resolve(Buffer.concat(parts)); });
    req.on("error", reject);
  });
}

function readPath(p, dataDir) {
  const f = String(p || "").trim().replace(/^"(.*)"$/, "$1");
  if (!f || !path.isAbsolute(f)) throw err(400, "Give the full location of the export file on this PC, for example C:\\Users\\you\\Downloads\\export.zip.", "bad_path");
  const rel = path.relative(path.resolve(dataDir), path.resolve(f));
  if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw err(400, "Files inside the app's own data folder cannot be imported.", "data_folder");
  let st;
  try { st = fs.statSync(f); } catch { throw err(404, "There is no file at that location.", "missing"); }
  if (!st.isFile()) throw err(400, "That location is a folder. Pick the export .zip file itself.", "bad_path");
  if (st.size > I.LIMITS.zipBytes) throw err(400, `The file is larger than ${Math.round(I.LIMITS.zipBytes / 1048576)} MB.`, "too_big");
  return fs.readFileSync(f);
}

function slugFor(h, name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "imported";
  const taken = new Set(h.listProjects().map((p) => p.id));
  let id = base; for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

function view(h) {
  return { batches: I.listBatches(), imported: I.importedCount(), sources: I.SOURCES, limits: { uploadMb: Math.round(UPLOAD_MAX / 1048576), fileMb: Math.round(I.LIMITS.zipBytes / 1048576) }, hosted: !!h.HOSTED, sync: syncView(h) };
}
function syncView(h) {
  if (h.HOSTED) { const c = cloud(); return { hosted: true, note: HOSTED_SYNC, supabase: c.url && c.anonKey ? { url: c.url, anonKey: c.anonKey } : null }; }
  return Y.status();
}

export function init(h) {
  if (h.HOSTED) return;
  const every = Math.max(1000, Number(process.env.CC_SYNC_EVERY_MS) || 10 * 60 * 1000);
  const c = h.ctx();
  setInterval(() => h.runAs(c, async () => {
    try { const s = Y.status(); if (s.enabled && s.keyOnDevice) { const r = await Y.syncNow(); if (r.result.pulled) h.emit("history.synced", { pulled: r.result.pulled }); } }
    catch (e) { console.error("[history sync]", e.message); }
  }), every).unref();
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/history/, "").replace(/\/$/, "") || "/";
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, view(h));
    if (m === "POST" && p === "/preview") {
      if (h.HOSTED) throw err(400, HOSTED_IMPORT, "hosted");
      let buf;
      const ct = req.headers["content-type"] || "";
      if (/^application\/(zip|x-zip-compressed|octet-stream)\b/i.test(ct)) buf = await readRaw(req, UPLOAD_MAX);
      else if (body?.path) buf = readPath(body.path, h.DATA_DIR);
      else if (typeof body?.data === "string") buf = Buffer.from(body.data, "base64");
      else throw err(400, "Pick the export .zip file first.", "no_file");
      const parsed = I.parseExport(buf);
      if (!parsed.conversations.length) throw err(400, "This export has no conversations in it.", "empty_export");
      const token = crypto.randomBytes(12).toString("hex");
      for (const [k, v] of pending) if (v.until < Date.now()) pending.delete(k);
      pending.set(token, { parsed, user: h.ctx().userId, until: Date.now() + PREVIEW_MS });
      return h.json(res, 200, { token, ...I.preview(parsed) });
    }
    if (m === "POST" && p === "/import") {
      if (h.HOSTED) throw err(400, HOSTED_IMPORT, "hosted");
      const pv = pending.get(String(body?.token || ""));
      if (!pv || pv.until < Date.now() || pv.user !== h.ctx().userId) throw err(410, "That preview has expired. Pick the file again.", "expired");
      let projectId = body?.projectId === undefined ? "new" : String(body.projectId || "");
      if (projectId && projectId !== "new" && !h.listProjects().some((x) => x.id === projectId)) throw err(400, "That project does not exist.", "no_project");
      const r = I.fileChats(pv.parsed, {
        projectId,
        findProject: (name) => h.listProjects().find((x) => x.name === name)?.id || null,
        makeProject: (name) => { h.guard("projects", { count: h.listProjects().length }); return h.saveProject({ id: slugFor(h, name), name, color: "#a78bfa", kind: "imported", summary: "Chats imported from an export file.", categories: [] }).id; },
      });
      pending.delete(String(body.token));
      h.emit("log", { text: `Imported ${r.added} chat${r.added === 1 ? "" : "s"} from ${I.SOURCES[r.source]}${r.updated ? `, updated ${r.updated}` : ""}${r.unchanged ? `, ${r.unchanged} already here` : ""}.` });
      h.emit("history.imported", { added: r.added, updated: r.updated });
      const { ids, ...out } = r;
      return h.json(res, 200, { ...out, imported: I.importedCount() });
    }
    if (p === "/sync" && m === "GET") return h.json(res, 200, syncView(h));
    if (p.startsWith("/sync/")) {
      if (h.HOSTED) throw err(400, HOSTED_SYNC, "hosted");
      if (m === "POST" && p === "/sync/setup") return h.json(res, 200, await Y.setup({ passphrase: body?.passphrase, code: body?.code || null, remember: body?.remember !== false }));
      if (m === "POST" && p === "/sync/now") { const r = await Y.syncNow(); if (r.result.pulled) h.emit("history.synced", { pulled: r.result.pulled }); return h.json(res, 200, r); }
      if (m === "POST" && p === "/sync/off") return h.json(res, 200, await Y.turnOff({ deleteRemote: !!body?.deleteRemote }));
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
