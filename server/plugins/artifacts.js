// Artifacts side panel (Phase 20): the routes. The work lives in server/artifacts.js.
//   GET    /api/artifacts?projectId=&runId=          list (newest first, no content)
//   POST   /api/artifacts  { title, kind, content, projectId, runId, net }      create (version 1)
//   POST   /api/artifacts/extract  { text, projectId, runId }                  save the code blocks of an answer
//   POST   /api/artifacts/preview  { kind, content, net }                      sandbox page for unsaved text
//   GET    /api/artifacts/<id>                                                 one artifact with every version
//   POST   /api/artifacts/<id>/versions  { content, note, title, net }        edit: a new version, old ones kept
//   GET    /api/artifacts/<id>/frame?v=                                        { html, sandbox } for the iframe
//   GET    /api/artifacts/<id>/export?v=[&format=json]                         the file (attachment), or { filename, mime, body }
//   DELETE /api/artifacts/<id>
//   GET/POST /api/artifacts/settings  { pyodideUrl }                           where Python is loaded from
import { listArtifacts, getArtifact, pickVersion, createArtifact, addVersion, deleteArtifact, extractArtifacts, frameHtml, exportFile, PYODIDE_DEFAULT } from "../artifacts.js";
import { doc, putDoc } from "../store.js";
export const id = "artifacts";

export const SANDBOX = "allow-scripts"; // never allow-same-origin: the frame must not share the app's origin
const SETTINGS = "artifacts.settings";
const prefs = () => doc(SETTINGS, () => ({ pyodideUrl: PYODIDE_DEFAULT }));

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/artifacts/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  const q = (k) => url.searchParams.get(k);
  try {
    if (req.method === "GET" && p === "/settings") return h.json(res, 200, { ...prefs(), default: PYODIDE_DEFAULT });
    if (req.method === "POST" && p === "/settings") {
      const u = String(body?.pyodideUrl || "").trim() || PYODIDE_DEFAULT;
      frameHtml("python", "1", { pyodideUrl: u }); // checks the address (https only)
      return h.json(res, 200, putDoc(SETTINGS, { ...prefs(), pyodideUrl: u.replace(/\/?$/, "/") }));
    }
    if (req.method === "GET" && p === "/") return h.json(res, 200, { items: listArtifacts({ projectId: q("projectId"), runId: q("runId") }) });
    if (req.method === "POST" && p === "/") { const a = createArtifact(body || {}); h.emit("log", { text: `Artifact saved: ${a.title}.` }); return h.json(res, 200, a); }
    if (req.method === "POST" && p === "/extract") {
      const items = extractArtifacts(body || {});
      if (items.length) h.emit("log", { text: `${items.length} artifact${items.length === 1 ? "" : "s"} saved from the answer.` });
      return h.json(res, 200, { items });
    }
    if (req.method === "POST" && p === "/preview") return h.json(res, 200, { html: frameHtml(body?.kind, String(body?.content ?? ""), { net: !!body?.net, pyodideUrl: prefs().pyodideUrl }), sandbox: SANDBOX });
    if (!seg[0]) return false;
    if (req.method === "GET" && seg.length === 1) return h.json(res, 200, getArtifact(seg[0]));
    if (req.method === "DELETE" && seg.length === 1) return h.json(res, 200, deleteArtifact(seg[0]));
    if (req.method === "POST" && seg[1] === "versions") return h.json(res, 200, addVersion(seg[0], body || {}));
    if (req.method === "GET" && seg[1] === "frame") {
      const a = getArtifact(seg[0]), ver = pickVersion(a, q("v"));
      return h.json(res, 200, { id: a.id, kind: a.kind, v: ver.v, net: !!a.net, sandbox: SANDBOX, html: frameHtml(a.kind, ver.content, { net: a.net, pyodideUrl: prefs().pyodideUrl }) });
    }
    if (req.method === "GET" && seg[1] === "export") {
      const a = getArtifact(seg[0]), f = exportFile(a, pickVersion(a, q("v")));
      if (q("format") === "json") return h.json(res, 200, f); // the panel builds the download from this
      const b = Buffer.from(f.body, "utf8");
      // served as a download only, never rendered in the app's own origin
      res.writeHead(200, { "content-type": f.mime, "content-disposition": `attachment; filename="${f.filename}"`, "content-length": b.length, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" });
      return res.end(b);
    }
  } catch (e) { return h.json(res, e.status || 500, { error: e.message, code: e.code }); }
  return false;
}
