// Knowledge libraries (Phase 18): the routes behind the Libraries tab, the Command widget and the Google Drive
// and Notion connections. The engine is server/libraries.js; text extraction server/library-extract.js; Drive
// and Notion server/library-sources.js.
//
// Adding content is two clicks: "stage" reads, chunks and estimates (free), "index" embeds and writes
// (spends, with the person's own key; every call in the ledger, refused at the spend cap).
import fs from "node:fs";
import path from "node:path";
import * as L from "../libraries.js";
import * as X from "../library-extract.js";
import * as SRC from "../library-sources.js";
import { demoActive } from "../mock.js";

export const id = "libraries";
const MAX_UPLOAD_FILES = 200;

function overview(h) {
  return {
    available: L.available(), hosted: !!h.HOSTED, demo: demoActive(),
    libraries: L.listLibraries(), embedders: L.available() ? L.embedderChoices() : [], attach: L.available() ? L.attachments() : { chat: {}, workspace: {}, agent: {} },
    sources: { google: SRC.sourceView("google"), notion: SRC.sourceView("notion") },
    limits: { topK: L.TOP_K, chunkChars: L.CHUNK_CHARS, maxFileMb: Math.round(X.MAX_FILE_BYTES / 1048576), uploadFiles: MAX_UPLOAD_FILES },
  };
}

// uploaded files: [{ name, text }] or [{ name, data: base64 }] (Word and PDF)
function uploadItems(files) {
  if (!Array.isArray(files) || !files.length) throw Object.assign(new Error("Pick at least one file."), { status: 400 });
  if (files.length > MAX_UPLOAD_FILES) throw Object.assign(new Error(`Up to ${MAX_UPLOAD_FILES} files at a time.`), { status: 400 });
  return files.map((f) => {
    const name = String(f?.name || "").replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 300) || "untitled.txt";
    if (!X.supported(name)) return { source: "file", ref: name, title: name, skipped: "file type not supported (text, Markdown, CSV, JSON, code, HTML, Word .docx and PDF are)" };
    const buf = typeof f.data === "string" ? Buffer.from(f.data, "base64") : Buffer.from(String(f.text ?? ""), "utf8");
    const r = X.extract(name, buf);
    return r.skipped ? { source: "file", ref: name, title: name, skipped: r.skipped } : { source: "file", ref: name, title: name, text: r.text };
  });
}
// a folder on this PC (desktop and local server only)
function folderItems(dir) {
  const root = path.resolve(String(dir || "").trim());
  if (!String(dir || "").trim()) throw Object.assign(new Error("Type the folder's path."), { status: 400 });
  let st; try { st = fs.statSync(root); } catch { throw Object.assign(new Error("That folder does not exist on this PC."), { status: 404 }); }
  if (!st.isDirectory()) throw Object.assign(new Error("That is a file, not a folder."), { status: 400 });
  const { files, skipped } = X.walkFolder(root);
  const items = skipped.map((s) => ({ source: "folder", ref: `${root}|${s.path}`, title: s.path, skipped: s.reason }));
  for (const f of files) {
    let buf = null; try { buf = fs.readFileSync(f.full); } catch (e) { items.push({ source: "folder", ref: f.full, title: f.rel, skipped: `cannot read: ${e.code || e.message}` }); continue; }
    const r = X.extract(f.rel, buf);
    items.push(r.skipped ? { source: "folder", ref: f.full, title: f.rel, skipped: r.skipped } : { source: "folder", ref: f.full, title: f.rel, text: r.text });
  }
  return items;
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/libraries/, "").replace(/\/$/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const m = req.method;
  try {
    if (m === "GET" && p === "/") return h.json(res, 200, overview(h));
    if (h.HOSTED) return h.json(res, 501, { error: "Knowledge libraries live in the desktop app for now (the index is a file on your PC). Open Command AI on your computer to use them.", code: "hosted" });

    // ---- Google Drive and Notion connections (read-only) ----
    if (seg[0] === "google" || seg[0] === "notion") {
      const k = seg[0];
      if (m === "GET" && !seg[1]) return h.json(res, 200, SRC.sourceView(k));
      if (m === "POST" && seg[1] === "client") return h.json(res, 200, await SRC.setClient(k, { clientId: body?.clientId, clientSecret: body?.clientSecret }));
      if (m === "POST" && seg[1] === "start") {
        const origin = String(body?.origin || "").replace(/\/$/, "");
        if (!/^https?:\/\/[^\s/]+$/.test(origin)) return h.json(res, 400, { error: "origin required" });
        return h.json(res, 200, SRC.start(k, { redirectUri: `${origin}/` }));
      }
      if (m === "POST" && seg[1] === "finish") return h.json(res, 200, await SRC.finish({ code: body?.code, state: body?.state }));
      if (m === "DELETE" && !seg[1]) return h.json(res, 200, await SRC.disconnect(k));
      if (m === "GET" && seg[1] === "files" && k === "google") return h.json(res, 200, { files: await SRC.driveList({ q: url.searchParams.get("q") || "", folder: url.searchParams.get("folder") || "" }) });
      if (m === "GET" && seg[1] === "pages" && k === "notion") return h.json(res, 200, { pages: await SRC.notionList({ q: url.searchParams.get("q") || "" }) });
      return false;
    }

    // ---- attachments: per chat (project), workspace or agent ----
    if (m === "GET" && p === "/attached") {
      const projectId = url.searchParams.get("projectId") || null, agentId = url.searchParams.get("agentId") || null;
      const ids = L.librariesFor({ projectId, agentId });
      const chat = new Set(L.attachments().chat[projectId || L.NO_PROJECT] || []);
      return h.json(res, 200, { ids, libraries: L.listLibraries().map((l) => ({ id: l.id, name: l.name, chunks: l.chunks, inUse: ids.includes(l.id), chat: chat.has(l.id), via: l.attached })) });
    }
    if (m === "POST" && p === "/attach") return h.json(res, 200, { attach: L.setAttached({ libraryId: body?.libraryId, scope: body?.scope, target: body?.target, on: !!body?.on }), libraries: L.listLibraries() });

    // ---- libraries ----
    if (m === "POST" && p === "/") return h.json(res, 200, L.createLibrary(body || {}));
    const lid = seg[0];
    if (!lid) return false;
    if (m === "GET" && seg.length === 1) { const l = L.getLibrary(lid); if (!l) return h.json(res, 404, { error: "No such library." }); return h.json(res, 200, { ...L.view(l), documents: L.docsOf(lid) }); }
    if (m === "POST" && seg.length === 1) return h.json(res, 200, L.renameLibrary(lid, body?.name));
    if (m === "DELETE" && seg.length === 1) { L.deleteLibrary(lid); return h.json(res, 200, { ok: true, libraries: L.listLibraries() }); }
    if (m === "DELETE" && seg[1] === "docs" && seg[2]) return h.json(res, 200, L.removeDoc(lid, seg[2]));
    if (m === "GET" && seg[1] === "search") {
      const r = await L.search(lid, url.searchParams.get("q") || "", { mode: url.searchParams.get("mode") || "hybrid", k: url.searchParams.get("k"), role: "embed-query" });
      return h.json(res, 200, r);
    }
    // read, chunk and estimate; nothing is spent here
    if (m === "POST" && seg[1] === "stage") {
      if (!L.getLibrary(lid)) return h.json(res, 404, { error: "No such library." });
      const kind = String(body?.kind || "");
      let items;
      if (kind === "files") items = uploadItems(body.files);
      else if (kind === "folder") items = folderItems(body.path);
      else if (kind === "drive") items = await SRC.driveItems(Array.isArray(body.ids) ? body.ids : []);
      else if (kind === "notion") items = await SRC.notionItems(Array.isArray(body.ids) ? body.ids : []);
      else return h.json(res, 400, { error: "kind must be files, folder, drive or notion" });
      return h.json(res, 200, L.stage(lid, items, { stageId: body.stageId }));
    }
    if (m === "DELETE" && seg[1] === "stage" && seg[2]) { L.dropStage(seg[2]); return h.json(res, 200, { ok: true }); }
    // the click that spends: embed and write
    if (m === "POST" && seg[1] === "index") {
      const { job } = L.index(lid, body?.stageId);
      return h.json(res, 202, { job, library: L.view(L.getLibrary(lid)) });
    }
  } catch (e) {
    return h.json(res, e.status || 500, { error: e.message, code: e.code });
  }
  return false;
}
