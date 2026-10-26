// Knowledge libraries (Phase 18): retrieval over the person's own files, folders, Google Drive and Notion.
//
//  - A library is chunked text plus one embedding per chunk, made with the embedding model the person
//    picked for that library (their own key). Stored locally: one SQLite file per library in the app data
//    folder (node:sqlite), an FTS5 table for keyword search and the vectors as float32 blobs. Vector search
//    is an exact cosine scan in memory (no native vector extension to ship); fine up to roughly 100,000
//    chunks per library. Deleting a library deletes its file.
//  - Hybrid search: keyword (FTS5, bm25) and vector (cosine) result lists merged by reciprocal rank fusion.
//    Either half can be asked for alone. When the embedder cannot be called (no key, spend cap, outage)
//    a question falls back to keyword search and says so.
//  - Libraries are attached to a chat (the Command orders of one project, or no project), a workspace
//    (while it is active) or an agent. Chat, council and mission then add the best excerpts to the prompt as
//    [L1], [L2] ...; the answer cites them and the UI turns them into source chips.
//  - Every embedding call is a ledger line (role "embed", tokens and cost, never text) and respects the
//    monthly spend caps (alerts plugin): a capped embedder is refused before any call. Adding content
//    shows an estimate first; the spend happens on the Index click.
//  - Hosted hub: not available yet (the index is a local file); the routes say so.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./paths.js";
import { HOSTED, doc, putDoc, ctx } from "./store.js";
import { PROVIDERS, geminiBase } from "./registry.js";
import { getSecret, hasSecret } from "./vault.js";
import { recordEmbedding } from "./ledger.js";
import { emit } from "./events.js";
import { demoActive } from "./mock.js";
import { demosHidden, realJobSkipsDemo } from "./demo-visibility.js";
import { networkCause, providerMessage } from "./health.js";
import { localFetch } from "./loopback-fetch.js";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { DatabaseSync = null; }
export const available = () => !HOSTED && !!DatabaseSync;

export const LIST = "libraries.list";     // { items: [library] }
export const ATTACH = "libraries.attach"; // { chat: { [projectId|"_"]: [libId] }, workspace: { [wsId]: [libId] }, agent: { [agentId]: [libId] } }
export const SCOPES = ["chat", "workspace", "agent"];
export const NO_PROJECT = "_";
export const TOP_K = 6, MAX_BLOCK_CHARS = 7000, CHUNK_CHARS = 1100, CHUNK_OVERLAP = 160;
const MAX_LIBRARIES = 50, BATCH = 48, BATCH_CHARS = 60000, STAGE_TTL = 30 * 60 * 1000, MAX_STAGE_CHARS = 20_000_000;

// List prices per 1M input tokens (checked 2026-10-19); the person can set their own when creating a library.
export const EMBEDDERS = {
  openai: [{ id: "text-embedding-3-small", name: "OpenAI text-embedding-3-small", per1M: 0.02 }, { id: "text-embedding-3-large", name: "OpenAI text-embedding-3-large", per1M: 0.13 }],
  google: [{ id: "gemini-embedding-001", name: "Gemini embedding 001", per1M: 0.15 }],
  mistral: [{ id: "mistral-embed", name: "Mistral Embed", per1M: 0.1 }],
  "demo-nova": [{ id: "nova-embed", name: "Nova Embed (demo)", per1M: 0.02 }],
};

const bad = (msg, status = 400, code) => Object.assign(new Error(msg), { status, code });
const gone = () => bad("Knowledge libraries live in the desktop app for now (the index is a file on your PC). Open Meldmind on your computer to use them.", 501, "hosted");
const need = () => { if (HOSTED) throw gone(); if (!DatabaseSync) throw bad("Knowledge libraries need a newer runtime (node:sqlite). Update Meldmind.", 501, "sqlite"); };
const capped = () => doc("alerts.state", () => undefined)?.stop || []; // read only; the alerts plugin owns it
const nameOf = (pid) => PROVIDERS[pid]?.name || pid;
const tokensOf = (chars) => Math.ceil(Number(chars || 0) / 4);
const userKey = () => { try { return ctx().userId || "local"; } catch { return "local"; } };

// ---------- embedders the person can use ----------
export function embedderChoices() {
  const out = [];
  const stop = capped();
  for (const [pid, models] of Object.entries(EMBEDDERS)) {
    const p = PROVIDERS[pid];
    if (!p) continue;
    if (p.demo && (!demoActive() || demosHidden())) continue;
    const keyed = hasSecret(p.id, p.keyEnv);
    for (const m of models) out.push({ provider: pid, providerName: p.name, model: m.id, name: m.name, per1M: m.per1M, keyed, capped: stop.includes(pid), demo: !!p.demo, custom: false });
  }
  // custom OpenAI-compatible providers (Ollama, LM Studio, Together ...): the person types the model name
  for (const p of Object.values(PROVIDERS)) if (p.custom && p.api !== "anthropic") out.push({ provider: p.id, providerName: p.name, model: null, name: `${p.name}: type the embedding model`, per1M: 0, keyed: !!p.noKey || hasSecret(p.id, p.keyEnv), capped: stop.includes(p.id), demo: false, custom: true });
  return out;
}

// ---------- the library list (a per-user document) and the index files ----------
const listDoc = () => doc(LIST, () => ({ items: [] }));
const attachDoc = () => { const d = doc(ATTACH, () => ({ chat: {}, workspace: {}, agent: {} })); for (const s of SCOPES) d[s] ||= {}; return d; };
export const libDir = () => path.join(DATA_DIR, "libraries");
export const dbFile = (id) => path.join(libDir(), `${id}.sqlite`);
const validId = (id) => /^lib-[a-f0-9]{12}$/.test(String(id || ""));
export const getLibrary = (id) => listDoc().items.find((x) => x.id === id) || null;
function mustLib(id) { need(); const l = validId(id) && getLibrary(id); if (!l) throw bad("No such library.", 404); return l; }

const dbs = new Map(); // id -> DatabaseSync
function open(id) {
  if (dbs.has(id)) return dbs.get(id);
  fs.mkdirSync(libDir(), { recursive: true });
  const db = new DatabaseSync(dbFile(id));
  db.exec(`PRAGMA journal_mode = DELETE;
    CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, source TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL, url TEXT, hash TEXT NOT NULL, chars INTEGER NOT NULL, chunks INTEGER NOT NULL, added_at INTEGER NOT NULL, UNIQUE(source, ref));
    CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL, vec BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, title, tokenize = 'porter unicode61');`);
  dbs.set(id, db);
  return db;
}
function closeDb(id) { const db = dbs.get(id); if (db) { try { db.close(); } catch {} dbs.delete(id); } vecCache.delete(id); }

function stats(id) {
  if (!fs.existsSync(dbFile(id))) return { docs: 0, chunks: 0, chars: 0 };
  const r = open(id).prepare("SELECT COUNT(*) AS docs, COALESCE(SUM(chunks),0) AS chunks, COALESCE(SUM(chars),0) AS chars FROM docs").get();
  return { docs: Number(r.docs), chunks: Number(r.chunks), chars: Number(r.chars) };
}
const jobs = new Map(); // libId -> { status, done, total, ... } while indexing
export function view(l) {
  const s = stats(l.id);
  const where = [];
  const a = attachDoc();
  for (const scope of SCOPES) for (const [target, ids] of Object.entries(a[scope])) if (ids.includes(l.id)) where.push({ scope, target });
  return { id: l.id, name: l.name, embed: { ...l.embed, providerName: nameOf(l.embed.provider) }, dims: l.dims || null, createdAt: l.createdAt, updatedAt: l.updatedAt, ...s, attached: where, job: jobs.get(l.id) || null, file: path.basename(dbFile(l.id)) };
}
export function listLibraries() { if (!available()) return []; return listDoc().items.map(view); }
export function docsOf(id) {
  mustLib(id);
  if (!fs.existsSync(dbFile(id))) return [];
  return open(id).prepare("SELECT id, source, ref, title, url, chars, chunks, added_at AS addedAt FROM docs ORDER BY added_at DESC, id DESC LIMIT 2000").all().map((r) => ({ ...r, id: Number(r.id), chars: Number(r.chars), chunks: Number(r.chunks), addedAt: Number(r.addedAt) }));
}

export function createLibrary({ name, provider, model, per1M } = {}) {
  need();
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw bad("Give the library a name.");
  const p = PROVIDERS[String(provider || "")];
  if (!p) throw bad("Pick the embedding model for this library.");
  let m = (EMBEDDERS[p.id] || []).find((x) => x.id === model);
  if (!m) {
    if (!(p.custom && p.api !== "anthropic")) throw bad(`${p.name} has no embedding model ${model || "(none)"} here.`);
    const id = String(model || "").trim();
    if (!/^[\w.:/@+-]{1,120}$/.test(id)) throw bad("Type the embedding model name (for example nomic-embed-text).");
    m = { id, name: id, per1M: 0 };
  }
  if (realJobSkipsDemo(p)) throw bad("The demo embedder stays off while a real AI is connected. Pick your own embedding key.");
  if (p.demo && !demoActive()) throw bad("The demo embedder is only there in demo mode.");
  const price = per1M === undefined || per1M === null || per1M === "" ? m.per1M : Number(per1M);
  if (!(price >= 0) || price > 1000) throw bad("The price per 1M tokens must be a number from 0 up.");
  const d = listDoc();
  if (d.items.length >= MAX_LIBRARIES) throw bad(`You have ${MAX_LIBRARIES} libraries. Delete one first.`, 409);
  if (d.items.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw bad("A library with that name exists already.", 409);
  const lib = { id: "lib-" + crypto.randomBytes(6).toString("hex"), name, embed: { provider: p.id, model: m.id, per1M: +price }, dims: null, createdAt: Date.now(), updatedAt: Date.now() };
  d.items = [lib, ...d.items];
  putDoc(LIST, d);
  open(lib.id);
  emit("library.update", { id: lib.id, action: "created" });
  emit("log", { text: `Library "${name}" created (embeddings: ${m.name || m.id} through ${p.name}).` });
  return view(lib);
}
export function renameLibrary(id, name) {
  const l = mustLib(id);
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) throw bad("Give the library a name.");
  const d = listDoc();
  if (d.items.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw bad("A library with that name exists already.", 409);
  l.name = name; l.updatedAt = Date.now(); putDoc(LIST, d);
  emit("library.update", { id, action: "renamed" });
  return view(l);
}
// Removes the library, its index file and every attachment. Nothing else is touched.
export function deleteLibrary(id) {
  mustLib(id);
  if (jobs.get(id)?.status === "indexing") throw bad("Wait until the indexing has finished (or stop it), then delete.", 409);
  closeDb(id);
  for (const f of [dbFile(id), `${dbFile(id)}-journal`, `${dbFile(id)}-wal`, `${dbFile(id)}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  const d = listDoc(); const lib = d.items.find((x) => x.id === id);
  d.items = d.items.filter((x) => x.id !== id); putDoc(LIST, d);
  const a = attachDoc();
  for (const s of SCOPES) for (const k of Object.keys(a[s])) { a[s][k] = a[s][k].filter((x) => x !== id); if (!a[s][k].length) delete a[s][k]; }
  putDoc(ATTACH, a);
  for (const [k, st] of stages) if (st.libId === id) stages.delete(k);
  emit("library.update", { id, action: "deleted" });
  emit("log", { text: `Library "${lib?.name || id}" deleted with its index.` });
  return true;
}
export function removeDoc(id, docId) {
  mustLib(id);
  const db = open(id);
  const r = db.prepare("SELECT id, title FROM docs WHERE id = ?").get(Number(docId));
  if (!r) throw bad("No such document in this library.", 404);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = ?)").run(r.id);
    db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(r.id);
    db.prepare("DELETE FROM docs WHERE id = ?").run(r.id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  vecCache.delete(id);
  emit("library.update", { id, action: "doc-removed" });
  return { ok: true, removed: r.title };
}

// ---------- attachments ----------
export function setAttached({ libraryId, scope, target, on } = {}) {
  mustLib(libraryId);
  if (!SCOPES.includes(scope)) throw bad("scope must be chat, workspace or agent");
  target = scope === "chat" ? String(target || NO_PROJECT) : String(target || "");
  if (!/^[\w.:-]{1,80}$/.test(target)) throw bad(scope === "chat" ? "Unknown project." : `Pick the ${scope}.`);
  const a = attachDoc();
  const cur = new Set(a[scope][target] || []);
  if (on) cur.add(libraryId); else cur.delete(libraryId);
  if (cur.size) a[scope][target] = [...cur]; else delete a[scope][target];
  putDoc(ATTACH, a);
  emit("library.update", { id: libraryId, action: "attach" });
  return attachDoc();
}
export const attachments = () => attachDoc();
const activeWorkspace = () => doc("workspaces.active", () => undefined)?.id || null; // read only; the workspaces plugin owns it
// Which libraries apply to a run: the explicit list from the request, else the chat's (project) plus the
// active workspace's plus the agent's. Only libraries that still exist.
export function librariesFor({ projectId = null, agentId = null, explicit } = {}) {
  if (!available()) return [];
  const exists = (id) => !!getLibrary(id);
  if (Array.isArray(explicit)) return [...new Set(explicit.map(String))].filter(exists);
  const a = attachDoc();
  const ws = activeWorkspace();
  const ids = [...(a.chat[projectId || NO_PROJECT] || []), ...(ws ? a.workspace[ws] || [] : []), ...(agentId ? a.agent[agentId] || [] : [])];
  return [...new Set(ids)].filter(exists);
}

// ---------- chunking ----------
export function chunkText(text, { size = CHUNK_CHARS, overlap = CHUNK_OVERLAP } = {}) {
  const t = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  for (const p of paras) {
    if (p.length <= size) { pieces.push(p); continue; }
    // a long paragraph: cut at sentence ends, else hard
    const sentences = p.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) || [p];
    let cur = "";
    for (const s of sentences) {
      if (s.length > size) { if (cur) { pieces.push(cur.trim()); cur = ""; } for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size).trim()); continue; }
      if ((cur + s).length > size) { pieces.push(cur.trim()); cur = ""; }
      cur += s;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  const chunks = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur);
      const tail = cur.slice(-overlap);
      const cut = tail.search(/[\s.]/);
      cur = (cut >= 0 ? tail.slice(cut + 1) : "").trim();
      cur = cur ? `${cur}\n\n${p}` : p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.filter((c) => c.replace(/\s/g, "").length >= 2);
}

// ---------- embeddings: the person's own key, the ledger, the caps ----------
export class EmbedError extends Error { constructor(provider, status, message, extra = {}) { super(message); this.provider = provider; this.status = status; Object.assign(this, extra); } }
function checkEmbedder(embed) {
  const p = PROVIDERS[embed.provider];
  if (!p) throw new EmbedError(embed.provider, 400, `The embedding provider ${embed.provider} is not set up any more.`, { unavailable: true });
  if (realJobSkipsDemo(p)) throw new EmbedError(p.id, 400, "The demo embedder stays off while a real AI is connected. Make this library with your own embedding key.", { unavailable: true });
  if (p.demo && !demoActive()) throw new EmbedError(p.id, 400, "The demo embedder is only there in demo mode. Turn demo mode on, or make a library with your own embedding key.", { unavailable: true });
  if (capped().includes(p.id)) throw new EmbedError(p.id, 402, `${p.name} has reached its monthly spend cap, so no embedding call was made. Raise the cap in Settings > Spend caps or wait for the month to roll over.`, { capped: true });
  const sec = getSecret(p.id, p.keyEnv);
  if (!sec?.key && !p.noKey) throw new EmbedError(p.id, 401, `${p.name}: no API key saved. Add it in Settings.`, { unavailable: true });
  return { p, sec };
}
const unit = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); };
// texts → unit vectors. One HTTP call per batch, each one a ledger line.
async function embedGemini(p, sec, embed, texts, { missionId = null, role = "embed" } = {}) {
  const t0 = Date.now();
  const model = String(embed.model || "").replace(/^models\//, "");
  const body = { requests: texts.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] } })) };
  let res;
  try {
    res = await localFetch(`${geminiBase(p)}/models/${encodeURIComponent(model)}:batchEmbedContents`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": sec.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
  } catch (e) { throw new EmbedError(p.id, 0, `Could not reach ${p.name}: ${networkCause(e)}`, { network: true }); }
  const txt = await res.text().catch(() => "");
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!res.ok) {
    const msg = providerMessage(j, txt);
    if (res.status === 401 || res.status === 403) throw new EmbedError(p.id, res.status, `Key rejected (${res.status})${msg ? `: ${msg}` : ""}`, { rejected: true });
    if (res.status === 402 || res.status === 429) throw new EmbedError(p.id, res.status, `${p.name}: ${res.status === 429 ? "rate limited or out of quota" : "out of credits"}${msg ? ` (${msg})` : ""}`);
    throw new EmbedError(p.id, res.status, `${p.name}: HTTP ${res.status}${msg ? ` ${msg}` : ""}`);
  }
  const rows = Array.isArray(j?.embeddings) ? j.embeddings : [];
  if (rows.length !== texts.length || !rows.every((r) => Array.isArray(r.values) && r.values.length)) throw new EmbedError(p.id, 502, `${p.name} sent back ${rows.length} embeddings for ${texts.length} texts.`);
  const tokens = tokensOf(texts.reduce((a, t) => a + t.length, 0));
  const cost = (tokens / 1e6) * Number(embed.per1M || 0);
  const entry = recordEmbedding({ provider: p.id, model: embed.model, tokens, cost, estimated: true, missionId, role, ms: Date.now() - t0, inputs: texts.length });
  return { vectors: rows.map((r) => unit(r.values)), tokens, cost: entry.cost };
}
export async function embed(embed, texts, { missionId = null, role = "embed" } = {}) {
  const { p, sec } = checkEmbedder(embed);
  if (p.id === "google" || p.api === "gemini") return embedGemini(p, sec, embed, texts, { missionId, role });
  const t0 = Date.now();
  const headers = { "content-type": "application/json", ...(sec?.key && !p.noKey ? { authorization: `Bearer ${sec.key}` } : {}), ...(p.custom ? sec?.headers || {} : {}) };
  let res;
  try { res = await localFetch(`${p.baseUrl}/embeddings`, { method: "POST", headers, body: JSON.stringify({ model: embed.model, input: texts }), signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new EmbedError(p.id, 0, `Could not reach ${p.name}: ${networkCause(e)}`, { network: true }); }
  const txt = await res.text().catch(() => "");
  let j = null; try { j = JSON.parse(txt); } catch {}
  if (!res.ok) {
    const msg = providerMessage(j, txt);
    if (res.status === 401 || res.status === 403) throw new EmbedError(p.id, res.status, `Key rejected (${res.status})${msg ? `: ${msg}` : ""}`, { rejected: true });
    if (res.status === 402 || res.status === 429) throw new EmbedError(p.id, res.status, `${p.name}: ${res.status === 429 ? "rate limited or out of quota" : "out of credits"}${msg ? ` (${msg})` : ""}`);
    throw new EmbedError(p.id, res.status, `${p.name}: HTTP ${res.status}${msg ? ` ${msg}` : ""}`);
  }
  const rows = Array.isArray(j?.data) ? [...j.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
  if (rows.length !== texts.length || !rows.every((r) => Array.isArray(r.embedding) && r.embedding.length)) throw new EmbedError(p.id, 502, `${p.name} sent back ${rows.length} embeddings for ${texts.length} texts.`);
  const reported = Number(j?.usage?.prompt_tokens ?? j?.usage?.total_tokens);
  const tokens = reported > 0 ? reported : tokensOf(texts.reduce((a, t) => a + t.length, 0));
  const cost = (tokens / 1e6) * Number(embed.per1M || 0);
  const entry = recordEmbedding({ provider: p.id, model: embed.model, tokens, cost, estimated: !(reported > 0), missionId, role, ms: Date.now() - t0, inputs: texts.length });
  return { vectors: rows.map((r) => unit(r.embedding)), tokens, cost: entry.cost };
}

// ---------- adding content: stage (read, chunk, estimate; free) then index (embed; spends) ----------
const stages = new Map(); // stageId -> { user, libId, at, items: [{ source, ref, title, url, text, hash, chunks }], skipped: [] }
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
function sweepStages() { for (const [k, s] of stages) if (Date.now() - s.at > STAGE_TTL) stages.delete(k); }
// items: [{ source: "file"|"folder"|"drive"|"notion", ref, title, url?, text } | { ..., skipped }]
export function stage(libId, items, { stageId } = {}) {
  const l = mustLib(libId);
  sweepStages();
  let st = stageId ? stages.get(String(stageId)) : null;
  if (stageId && (!st || st.user !== userKey() || st.libId !== libId)) throw bad("That list has expired. Add the files again.", 410);
  if (!st) { st = { id: "st-" + crypto.randomBytes(8).toString("hex"), user: userKey(), libId, at: Date.now(), items: [], skipped: [] }; stages.set(st.id, st); }
  st.at = Date.now();
  const db = fs.existsSync(dbFile(libId)) ? open(libId) : null;
  for (const it of items || []) {
    const ref = String(it.ref || it.title || "").slice(0, 500), title = String(it.title || ref).slice(0, 300);
    if (it.skipped) { st.skipped.push({ title, reason: it.skipped }); continue; }
    const text = String(it.text || "");
    const hash = sha(text);
    const prev = db?.prepare("SELECT hash FROM docs WHERE source = ? AND ref = ?").get(it.source, ref);
    if (prev?.hash === hash) { st.skipped.push({ title, reason: "already in the library, unchanged" }); continue; }
    const chunks = chunkText(text);
    if (!chunks.length) { st.skipped.push({ title, reason: "no text inside" }); continue; }
    st.items = st.items.filter((x) => !(x.source === it.source && x.ref === ref));
    st.items.push({ source: it.source, ref, title, url: it.url && /^https:\/\//.test(it.url) ? String(it.url).slice(0, 500) : null, text, hash, chunks, replaces: !!prev });
  }
  const chars = st.items.reduce((a, x) => a + x.chunks.reduce((b, c) => b + c.length, 0), 0);
  if (chars > MAX_STAGE_CHARS) { stages.delete(st.id); throw bad(`That is too much text for one go (${Math.round(chars / 1e6)} million characters). Add it in parts.`, 413); }
  return stageView(st, l);
}
function stageView(st, l) {
  const chunks = st.items.reduce((a, x) => a + x.chunks.length, 0);
  const chars = st.items.reduce((a, x) => a + x.chunks.reduce((b, c) => b + c.length, 0), 0);
  const tokens = tokensOf(chars);
  const p = PROVIDERS[l.embed.provider];
  return {
    stageId: st.id, libraryId: l.id,
    files: st.items.map((x) => ({ title: x.title, ref: x.ref, source: x.source, chars: x.text.length, chunks: x.chunks.length, replaces: x.replaces })),
    skipped: st.skipped,
    estimate: { files: st.items.length, chunks, tokens, cost: +((tokens / 1e6) * l.embed.per1M).toFixed(9), provider: l.embed.provider, providerName: p?.name || l.embed.provider, model: l.embed.model, per1M: l.embed.per1M, calls: Math.ceil(chunks / BATCH), capped: capped().includes(l.embed.provider), keyed: !!p && (!!p.noKey || hasSecret(p.id, p.keyEnv)) },
  };
}
export function dropStage(stageId) { stages.delete(String(stageId)); }

// Embeds and writes a staged list. Returns the job at once; `done` resolves when it has finished.
export function index(libId, stageId) {
  const l = mustLib(libId);
  const st = stages.get(String(stageId || ""));
  if (!st || st.user !== userKey() || st.libId !== libId) throw bad("That list has expired. Add the files again.", 410);
  if (!st.items.length) throw bad("Nothing new to index in that list.");
  if (jobs.get(libId)?.status === "indexing") throw bad("This library is indexing already.", 409);
  checkEmbedder(l.embed); // refused before any call: no key, spend cap reached, demo off
  stages.delete(st.id);
  const total = st.items.reduce((a, x) => a + x.chunks.length, 0);
  const job = { status: "indexing", files: st.items.length, total, done: 0, filesDone: 0, cost: 0, tokens: 0, calls: 0, startedAt: Date.now(), finishedAt: null, error: null };
  jobs.set(libId, job);
  const runId = "lx-" + Date.now().toString(36);
  emit("library.update", { id: libId, action: "indexing", job });
  const done = (async () => {
    const db = open(libId);
    try {
      for (const it of st.items) {
        const vecs = [];
        for (let i = 0; i < it.chunks.length;) {
          const batch = []; let chars = 0;
          while (i < it.chunks.length && batch.length < BATCH && (chars + it.chunks[i].length <= BATCH_CHARS || !batch.length)) { chars += it.chunks[i].length; batch.push(it.chunks[i++]); }
          const r = await embed(l.embed, batch, { missionId: runId, role: "embed" });
          if (!l.dims) { l.dims = r.vectors[0].length; putDoc(LIST, listDoc()); }
          if (r.vectors.some((v) => v.length !== l.dims)) throw new EmbedError(l.embed.provider, 502, `The embedder returned ${r.vectors[0].length} numbers per text; this library uses ${l.dims}.`);
          vecs.push(...r.vectors);
          job.done += batch.length; job.cost = +(job.cost + r.cost).toFixed(9); job.tokens += r.tokens; job.calls++;
          emit("library.update", { id: libId, action: "progress", job });
        }
        // one transaction per document: a replaced document's old chunks go, the new ones come in
        db.exec("BEGIN");
        try {
          const prev = db.prepare("SELECT id FROM docs WHERE source = ? AND ref = ?").get(it.source, it.ref);
          if (prev) {
            db.prepare("DELETE FROM fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = ?)").run(prev.id);
            db.prepare("DELETE FROM chunks WHERE doc_id = ?").run(prev.id);
            db.prepare("DELETE FROM docs WHERE id = ?").run(prev.id);
          }
          const d = db.prepare("INSERT INTO docs (source, ref, title, url, hash, chars, chunks, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(it.source, it.ref, it.title, it.url, it.hash, it.text.length, it.chunks.length, Date.now());
          const insC = db.prepare("INSERT INTO chunks (doc_id, ord, text, vec) VALUES (?, ?, ?, ?)");
          const insF = db.prepare("INSERT INTO fts (rowid, text, title) VALUES (?, ?, ?)");
          it.chunks.forEach((c, k) => { const r = insC.run(d.lastInsertRowid, k, c, Buffer.from(vecs[k].buffer, vecs[k].byteOffset, vecs[k].byteLength)); insF.run(r.lastInsertRowid, c, it.title); });
          db.exec("COMMIT");
        } catch (e) { db.exec("ROLLBACK"); throw e; }
        job.filesDone++;
        vecCache.delete(libId);
      }
      job.status = "done";
    } catch (e) {
      job.status = e.capped ? "stopped" : "failed";
      job.error = `${e.message}${job.filesDone ? ` (${job.filesDone} of ${job.files} files were indexed before this and are kept)` : ""}`;
      emit("log", { text: `Library "${l.name}": indexing ${job.status}. ${job.error}`, level: "error" });
    }
    job.finishedAt = Date.now();
    l.updatedAt = Date.now(); putDoc(LIST, listDoc());
    vecCache.delete(libId);
    emit("library.update", { id: libId, action: "indexed", job });
    if (job.status === "done") emit("log", { text: `Library "${l.name}": ${job.files} file${job.files === 1 ? "" : "s"} indexed (${job.total} chunks, ${job.calls} embedding call${job.calls === 1 ? "" : "s"}, $${job.cost.toFixed(5)}).` });
    setTimeout(() => { if (jobs.get(libId) === job) jobs.delete(libId); }, 10 * 60 * 1000).unref?.();
    return job;
  })();
  return { job, done };
}

// ---------- search ----------
const STOP = new Set("a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to too was we were what when where which who why will with would you your about after all also any been before being both each few more most other over same should some such only own very just".split(" "));
export const terms = (q) => [...new Set((String(q || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_'-]*/gu) || []).map((t) => t.replace(/'s$/, "")).filter((t) => t.length > 1 && !STOP.has(t)))].slice(0, 24);
function keyword(libId, q, k) {
  const ts = terms(q);
  if (!ts.length) return [];
  const match = ts.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
  try { return open(libId).prepare("SELECT rowid AS id, bm25(fts) AS s FROM fts WHERE fts MATCH ? ORDER BY s LIMIT ?").all(match, k).map((r) => ({ id: Number(r.id), score: -Number(r.s) })); }
  catch { return []; }
}
const vecCache = new Map(); // libId -> { ids: number[], vecs: Float32Array, dims }
function vectors(libId) {
  if (vecCache.has(libId)) return vecCache.get(libId);
  const rows = open(libId).prepare("SELECT id, vec FROM chunks").all();
  const dims = rows.length ? rows[0].vec.byteLength / 4 : 0;
  const vecs = new Float32Array(rows.length * dims), ids = new Array(rows.length);
  rows.forEach((r, i) => { ids[i] = Number(r.id); vecs.set(new Float32Array(Uint8Array.from(r.vec).buffer), i * dims); }); // copied: a blob need not be 4-byte aligned
  const c = { ids, vecs, dims };
  vecCache.set(libId, c);
  return c;
}
function nearest(libId, qv, k) {
  const { ids, vecs, dims } = vectors(libId);
  if (!ids.length || qv.length !== dims) return [];
  const scored = new Array(ids.length);
  for (let i = 0; i < ids.length; i++) { let s = 0; const o = i * dims; for (let d = 0; d < dims; d++) s += vecs[o + d] * qv[d]; scored[i] = { id: ids[i], score: s }; }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
const RRF = 60;
function chunkRows(libId, ids) {
  if (!ids.length) return new Map();
  const rows = open(libId).prepare(`SELECT c.id, c.ord, c.text, d.id AS docId, d.title, d.ref, d.url, d.source FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE c.id IN (${ids.map(() => "?").join(",")})`).all(...ids);
  return new Map(rows.map((r) => [Number(r.id), { chunkId: Number(r.id), ord: Number(r.ord), text: r.text, docId: Number(r.docId), title: r.title, ref: r.ref, url: r.url || null, source: r.source }]));
}
// mode: "hybrid" (default), "keyword" or "vector". Returns { results, mode, note, cost }.
export async function search(libId, q, { mode = "hybrid", k = TOP_K, missionId = null, role = "embed-query" } = {}) {
  const l = mustLib(libId);
  q = String(q || "").trim().slice(0, 2000);
  if (!q) throw bad("Type a question or some words to look for.");
  if (!["hybrid", "keyword", "vector"].includes(mode)) throw bad("mode must be hybrid, keyword or vector");
  k = Math.min(20, Math.max(1, Math.round(Number(k) || TOP_K)));
  if (!stats(libId).chunks) return { results: [], mode, note: "This library is empty: add files first.", cost: 0 };
  let note = null, cost = 0, kw = [], vec = [];
  if (mode !== "vector") kw = keyword(libId, q, k * 3);
  if (mode !== "keyword") {
    try { const r = await embed(l.embed, [q], { missionId, role }); cost = r.cost; vec = nearest(libId, r.vectors[0], k * 3); }
    catch (e) {
      if (mode === "vector") throw bad(e.message, e.status === 402 ? 402 : 400);
      note = `Keyword search only: ${e.message}`; mode = "keyword";
    }
  }
  const fused = new Map();
  const add = (list, key) => list.forEach((r, i) => { const f = fused.get(r.id) || { id: r.id, score: 0 }; f.score += 1 / (RRF + i + 1); f[key] = { rank: i + 1, score: +r.score.toFixed(4) }; fused.set(r.id, f); });
  add(kw, "keyword"); add(vec, "vector");
  const top = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
  const rows = chunkRows(libId, top.map((x) => x.id));
  return { results: top.map((x) => ({ ...rows.get(x.id), libraryId: l.id, libraryName: l.name, score: +x.score.toFixed(5), keyword: x.keyword || null, vector: x.vector || null })).filter((r) => r.chunkId), mode, note, cost };
}

// ---------- what chat, council and mission call ----------
export const queryFor = (prompt) => String(prompt || "").split(/\n\s*(?:PROJECT MEMORY for |WHAT I REMEMBER)/)[0].replace(/\s+/g, " ").trim().slice(0, 1000);
export function libraryBlock(sources) {
  if (!sources?.length) return "";
  const lines = sources.map((s) => `[${s.n}] ${s.title} (library: ${s.libraryName})\n${s.text}`);
  return `LIBRARY EXCERPTS (from the person's own knowledge libraries, most relevant first). Use them where they answer the question and cite each fact taken from them with its tag in square brackets, like [L1] or [L2], right after the sentence it supports. Only cite these tags; never invent one. If the excerpts do not cover the question, say so and answer from general knowledge.\n\n${lines.join("\n\n")}`;
}
// Returns null when no library applies; else { sources, block, prompt, cost, notes }. Never throws: a run
// goes on without the libraries when something fails, and the feed says why.
export async function augment({ prompt, projectId = null, agentId = null, explicit, missionId = null }) {
  let ids;
  try { ids = librariesFor({ projectId, agentId, explicit }); } catch { return null; }
  if (!ids.length) return null;
  const q = queryFor(prompt);
  if (!q) return null;
  const hits = [], notes = [];
  let cost = 0;
  for (const id of ids) {
    const l = getLibrary(id);
    if (jobs.get(id)?.status === "indexing" && !stats(id).chunks) { notes.push(`"${l.name}" is still indexing`); continue; }
    try {
      const r = await search(id, q, { mode: "hybrid", k: TOP_K, missionId, role: "embed-query" });
      cost += r.cost;
      if (r.note) notes.push(`"${l.name}": ${r.note}`);
      hits.push(...r.results);
    } catch (e) { notes.push(`"${l.name}": ${e.message}`); }
  }
  for (const n of notes) emit("log", { text: `Libraries: ${n}`, level: "error", missionId });
  hits.sort((a, b) => b.score - a.score);
  const sources = [];
  let used = 0;
  for (const h of hits) {
    if (sources.length >= TOP_K) break;
    if (used + h.text.length > MAX_BLOCK_CHARS && sources.length) break;
    used += h.text.length;
    sources.push({ n: `L${sources.length + 1}`, libraryId: h.libraryId, libraryName: h.libraryName, docId: h.docId, chunkId: h.chunkId, title: h.title, ref: h.ref, url: h.url, source: h.source, text: h.text, snippet: h.text.slice(0, 600) });
  }
  if (!sources.length) { emit("log", { text: `Libraries: nothing in ${ids.map((id) => `"${getLibrary(id).name}"`).join(", ")} matched this question.`, missionId }); return { sources: [], block: "", prompt, cost, notes }; }
  emit("log", { text: `Libraries: ${sources.length} excerpt${sources.length === 1 ? "" : "s"} from ${[...new Set(sources.map((s) => s.libraryName))].map((n) => `"${n}"`).join(", ")} added to the prompt (cited as [L1], [L2] ...).`, missionId });
  const block = libraryBlock(sources);
  return { sources, block, prompt: `${prompt}\n\n${block}`, cost, notes };
}
// What the deliverable keeps: no full text beyond the snippet.
export const publicSources = (sources) => (sources || []).map(({ text, ...s }) => s);
