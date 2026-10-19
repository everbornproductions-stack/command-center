// ChatGPT and Claude history import (Phase 23). Reads the export zip each service emails you (ChatGPT:
// Settings > Data controls > Export data; Claude: Settings > Privacy > Export data) on this PC and files
// every conversation as a chat in the run history, under a project. Nothing is uploaded anywhere.
//   ChatGPT: conversations.json = [{ id, title, create_time, update_time, mapping: { node: { message, parent, children } }, current_node }]
//            the visible thread is current_node walked up through its parents (edited branches are dropped)
//   Claude:  conversations.json = [{ uuid, name, created_at, updated_at, chat_messages: [{ sender, text, content[], created_at, attachments[] }], project_uuid? }]
//            projects.json = [{ uuid, name }] (conversations that name a project go into a project of that name)
// An imported chat is a run of kind "imported" (title, dates, every message, a Markdown transcript as the
// deliverable so the normal run view shows it). Ids come from the source's own ids, so importing the same
// export twice adds nothing and a newer export only updates the chats that changed.
import crypto from "node:crypto";
import zlib from "node:zlib";
import { ctx, doc, putDoc } from "./store.js";

export const LIMITS = { zipBytes: 1024 * 1024 * 1024, entryBytes: 512 * 1024 * 1024, conversations: 50000, messageChars: 400000 };
export const SOURCES = { chatgpt: "ChatGPT", claude: "Claude" };
const bad = (msg, code = "bad_export") => Object.assign(new Error(msg), { status: 400, code });

// ---------- zip (central directory, stored and deflate, zip64 sizes and offsets) ----------
function zip64Extra(buf, start, len, need) {
  // need: which of usize, csize, offset were 0xFFFFFFFF, in that order
  for (let p = start; p + 4 <= start + len;) {
    const id = buf.readUInt16LE(p), size = buf.readUInt16LE(p + 2);
    if (id === 0x0001) {
      const out = {}; let q = p + 4;
      for (const k of need) { out[k] = Number(buf.readBigUInt64LE(q)); q += 8; }
      return out;
    }
    p += 4 + size;
  }
  return {};
}

export function zipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad("This file is not a zip file. Pick the export .zip you downloaded from ChatGPT or Claude.", "not_zip");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad(buf.readUInt32LE(0) === 0x04034b50 ? "This zip is cut off (the end of the file is missing). Download the export again." : "This file is not a zip file. Pick the export .zip you downloaded from ChatGPT or Claude.", buf.readUInt32LE(0) === 0x04034b50 ? "truncated_zip" : "not_zip");
  let count = buf.readUInt16LE(eocd + 10), cd = buf.readUInt32LE(eocd + 16);
  if ((count === 0xffff || cd === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z = Number(buf.readBigUInt64LE(eocd - 12));
    if (z + 56 <= buf.length && buf.readUInt32LE(z) === 0x06064b50) { count = Number(buf.readBigUInt64LE(z + 32)); cd = Number(buf.readBigUInt64LE(z + 48)); }
  }
  if (cd >= buf.length) throw bad("This zip is damaged (its table of contents points past the end of the file). Download the export again.", "broken_zip");
  const out = [];
  let p = cd;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad("This zip is damaged (its table of contents is broken). Download the export again.", "broken_zip");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), local = buf.readUInt32LE(p + 42);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const need = [usize === 0xffffffff && "usize", csize === 0xffffffff && "csize", local === 0xffffffff && "local"].filter(Boolean);
    if (need.length) { const z = zip64Extra(buf, p + 46 + nameLen, extraLen, need); usize = z.usize ?? usize; csize = z.csize ?? csize; local = z.local ?? local; }
    out.push({ name, method, csize, usize, local, encrypted: !!(flags & 1) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function readEntry(buf, e) {
  if (e.encrypted) throw bad("This zip is password protected. Use the export exactly as ChatGPT or Claude sent it.", "encrypted_zip");
  if (e.usize > LIMITS.entryBytes) throw bad(`${e.name} is larger than ${Math.round(LIMITS.entryBytes / 1048576)} MB, too big to import in one go.`, "too_big");
  if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw bad(`This zip is damaged (${e.name} cannot be found). Download the export again.`, "broken_zip");
  const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
  const data = buf.subarray(start, start + e.csize);
  if (data.length < e.csize) throw bad("This zip is cut off (the end of the file is missing). Download the export again.", "truncated_zip");
  try {
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: LIMITS.entryBytes });
  } catch { throw bad(`This zip is damaged (${e.name} does not unpack). Download the export again.`, "broken_zip"); }
  throw bad(`This zip uses a compression method the app cannot read (${e.method}). Re-download the export; do not re-zip it with another tool.`, "zip_method");
}

// conversations.json may sit at the root or one folder down (some unzip-and-rezip tools add a folder)
const base = (n) => n.replace(/\\/g, "/").split("/").pop();
function findEntry(entries, file) {
  const hits = entries.filter((e) => base(e.name) === file && e.name.replace(/\\/g, "/").split("/").length <= 2 && !e.name.startsWith("__MACOSX"));
  return hits.sort((a, b) => a.name.length - b.name.length)[0] || null;
}
function jsonEntry(buf, entries, file) {
  const e = findEntry(entries, file);
  if (!e) return undefined;
  const raw = readEntry(buf, e).toString("utf8").replace(/^﻿/, "");
  try { return JSON.parse(raw); } catch { throw bad(`${file} in this zip is not valid JSON. Download the export again.`, "bad_json"); }
}

// ---------- the two formats ----------
const clip = (s) => { const t = String(s ?? ""); return t.length > LIMITS.messageChars ? `${t.slice(0, LIMITS.messageChars)}\n\n[cut: the message was longer than ${LIMITS.messageChars} characters]` : t; };
const ms = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v > 1e12 ? Math.round(v) : Math.round(v * 1000); // ChatGPT uses seconds with fractions
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function chatgptPartText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (part.content_type === "image_asset_pointer") return "[image]";
  if (part.content_type === "audio_transcription") return part.text || "";
  if (/audio/.test(part.content_type || "")) return "[audio]";
  return "";
}
function chatgptText(msg) {
  const c = msg?.content || {};
  if (Array.isArray(c.parts)) return c.parts.map(chatgptPartText).filter((x) => x !== "").join("\n\n");
  if (typeof c.text === "string") return c.content_type === "code" ? "```\n" + c.text + "\n```" : c.text;
  if (typeof c.result === "string") return c.result;
  return "";
}

export function parseChatGPT(list) {
  const out = []; let skipped = 0;
  for (const conv of list) {
    if (!conv || typeof conv !== "object" || !conv.mapping || typeof conv.mapping !== "object") { skipped++; continue; }
    const map = conv.mapping;
    let node = conv.current_node && map[conv.current_node] ? conv.current_node : null;
    if (!node) {
      // no current_node: follow the first child from the root to the end
      node = Object.keys(map).find((k) => !map[k]?.parent) || null;
      for (let guard = 0; node && map[node]?.children?.length && guard < 100000; guard++) node = map[node].children[map[node].children.length - 1];
    }
    const chain = [];
    for (const seen = new Set(); node && map[node] && !seen.has(node); node = map[node].parent) { seen.add(node); chain.push(map[node]); }
    chain.reverse();
    const messages = [];
    for (const n of chain) {
      const m = n.message;
      const role = m?.author?.role;
      if (role !== "user" && role !== "assistant") continue;
      if (m.metadata?.is_visually_hidden_from_conversation) continue;
      const text = chatgptText(m).trim();
      if (!text) continue;
      messages.push({ role, text: clip(text), at: ms(m.create_time), ...(role === "assistant" && m.metadata?.model_slug ? { model: String(m.metadata.model_slug) } : {}) });
    }
    const id = String(conv.id || conv.conversation_id || "");
    if (!id) { skipped++; continue; }
    out.push({ externalId: id, title: String(conv.title || "").trim() || "Untitled chat", createdAt: ms(conv.create_time) || messages[0]?.at || null, updatedAt: ms(conv.update_time) || messages.at(-1)?.at || null, messages, projectName: null });
  }
  return { conversations: out, skipped };
}

function claudeText(m) {
  let text = "";
  if (Array.isArray(m.content) && m.content.length) {
    text = m.content.map((c) => (c?.type === "text" ? c.text || "" : c?.type === "tool_use" ? `[used a tool: ${c.name || "tool"}]` : "")).filter(Boolean).join("\n\n");
  }
  if (!text.trim()) text = String(m.text || "");
  const files = [...(m.attachments || []), ...(m.files || [])].map((a) => a?.file_name).filter(Boolean);
  if (files.length) text += `${text ? "\n\n" : ""}[attached: ${files.join(", ")}]`;
  return text;
}

export function parseClaude(list, projects = []) {
  const pname = new Map((Array.isArray(projects) ? projects : []).filter((p) => p?.uuid).map((p) => [p.uuid, String(p.name || "").trim()]));
  const out = []; let skipped = 0;
  for (const conv of list) {
    if (!conv || typeof conv !== "object" || !Array.isArray(conv.chat_messages) || !conv.uuid) { skipped++; continue; }
    const messages = [];
    for (const m of conv.chat_messages) {
      const role = m?.sender === "human" ? "user" : m?.sender === "assistant" ? "assistant" : null;
      if (!role) continue;
      const text = claudeText(m).trim();
      if (!text) continue;
      messages.push({ role, text: clip(text), at: ms(m.created_at) });
    }
    const proj = conv.project_uuid || conv.project?.uuid || null;
    out.push({ externalId: String(conv.uuid), title: String(conv.name || "").trim() || "Untitled chat", createdAt: ms(conv.created_at) || messages[0]?.at || null, updatedAt: ms(conv.updated_at) || messages.at(-1)?.at || null, messages, projectName: (proj && (pname.get(proj) || conv.project?.name)) || null });
  }
  return { conversations: out, skipped };
}

export function detect(list) {
  const sample = list.find((x) => x && typeof x === "object");
  if (!sample) return null;
  if ("mapping" in sample) return "chatgpt";
  if ("chat_messages" in sample) return "claude";
  return null;
}

// buffer (a zip, or a bare conversations.json) -> { source, conversations, skipped }
export function parseExport(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad("The file is empty.", "empty");
  if (buf.length > LIMITS.zipBytes) throw bad(`The file is larger than ${Math.round(LIMITS.zipBytes / 1048576)} MB.`, "too_big");
  let list, projects;
  const head = buf.subarray(0, 64).toString("utf8").replace(/^﻿/, "").trimStart();
  if (head.startsWith("[")) {
    try { list = JSON.parse(buf.toString("utf8").replace(/^﻿/, "")); } catch { throw bad("This file is not valid JSON. Pick the export .zip, or the conversations.json inside it.", "bad_json"); }
  } else {
    const entries = zipEntries(buf);
    list = jsonEntry(buf, entries, "conversations.json");
    if (list === undefined) throw bad("There is no conversations.json in this zip, so it is not a ChatGPT or Claude export. Pick the zip from the export email.", "no_conversations");
    projects = jsonEntry(buf, entries, "projects.json");
  }
  if (!Array.isArray(list)) throw bad("conversations.json does not hold a list of conversations. This does not look like a ChatGPT or Claude export.", "unknown_format");
  if (list.length > LIMITS.conversations) throw bad(`This export has ${list.length} conversations; the app imports up to ${LIMITS.conversations} at a time.`, "too_big");
  const source = detect(list);
  if (!source) {
    if (!list.length) return { source: null, conversations: [], skipped: 0 };
    throw bad("conversations.json is not in the ChatGPT or Claude format. Only those two exports can be imported.", "unknown_format");
  }
  const r = source === "chatgpt" ? parseChatGPT(list) : parseClaude(list, projects);
  return { source, ...r };
}

// ---------- filing the chats ----------
export const missionIdFor = (source, externalId) => "imp-" + crypto.createHash("sha256").update(`${source}:${externalId}`).digest("hex").slice(0, 20);
const roleLabel = (source, m) => (m.role === "user" ? "You" : `${SOURCES[source] || "AI"}${m.model ? ` (${m.model})` : ""}`);
export function transcript(source, c) {
  return c.messages.map((m) => `**${roleLabel(source, m)}**${m.at ? ` · ${new Date(m.at).toISOString().slice(0, 16).replace("T", " ")}` : ""}\n\n${m.text}`).join("\n\n---\n\n");
}

const state = () => doc("history.imports", () => ({ chats: {}, batches: [] }));
export const listBatches = () => state().batches.slice().reverse();
export const importedCount = () => Object.keys(state().chats).length;

// target: { projectId } puts every chat there; { projectId: "new" } makes one project per source (and one per
// Claude project); null/"" files them without a project. makeProject(name) -> project id or throws (tier limit).
export function fileChats(parsed, { projectId = "new", makeProject, findProject, now = Date.now() } = {}) {
  const st = state();
  const counts = { added: 0, updated: 0, unchanged: 0, empty: 0 };
  const projectNotes = [];
  const projCache = new Map();
  const projectFor = (name) => {
    if (projectId !== "new") return projectId || null;
    const label = name ? `${name} (from ${SOURCES[parsed.source]})` : `Imported from ${SOURCES[parsed.source]}`;
    if (projCache.has(label)) return projCache.get(label);
    let id = findProject?.(label) || null;
    if (!id) {
      try { id = makeProject(label); }
      catch (e) { if (!projectNotes.length) projectNotes.push(`${e.message} The chats were imported without a project; move them later or upgrade.`); id = null; }
    }
    projCache.set(label, id);
    return id;
  };
  const ids = [];
  for (const c of parsed.conversations) {
    if (!c.messages.length) { counts.empty++; continue; }
    const id = missionIdFor(parsed.source, c.externalId);
    const prev = st.chats[id];
    if (prev && (prev.updatedAt || 0) >= (c.updatedAt || 0) && prev.messages === c.messages.length) { counts.unchanged++; continue; }
    const pid = prev?.projectId !== undefined && projectId === "new" ? prev.projectId : projectFor(c.projectName);
    const m = {
      id, kind: "imported", source: parsed.source, provider: `${SOURCES[parsed.source]} export`, model: c.messages.find((x) => x.model)?.model || null,
      title: c.title.slice(0, 200), prompt: c.messages.find((x) => x.role === "user")?.text.slice(0, 2000) || c.title,
      projectId: pid, status: "done", startedAt: c.createdAt || now, finishedAt: c.updatedAt || c.createdAt || now, updatedAt: c.updatedAt || c.createdAt || now,
      cost: 0, messages: c.messages, deliverable: transcript(parsed.source, c), tasks: [],
      imported: { from: parsed.source, externalId: c.externalId, at: now },
    };
    ctx().store.saveMission(m, { id, kind: m.kind, title: m.title, projectId: pid, status: m.status, startedAt: m.startedAt, finishedAt: m.finishedAt, cost: 0, tasks: 0, providers: [m.provider], source: m.source });
    st.chats[id] = { source: parsed.source, updatedAt: m.updatedAt, messages: c.messages.length, projectId: pid };
    counts[prev ? "updated" : "added"]++;
    ids.push(id);
  }
  const batch = { id: "ib-" + now.toString(36), at: now, source: parsed.source, total: parsed.conversations.length, skipped: parsed.skipped || 0, ...counts, notes: projectNotes };
  st.batches.push(batch);
  if (st.batches.length > 50) st.batches.splice(0, st.batches.length - 50);
  putDoc("history.imports", st);
  return { ...batch, ids };
}

export function preview(parsed) {
  const msgs = parsed.conversations.reduce((a, c) => a + c.messages.length, 0);
  const dates = parsed.conversations.map((c) => c.createdAt).filter(Boolean);
  const st = state();
  const known = parsed.conversations.filter((c) => st.chats[missionIdFor(parsed.source, c.externalId)]).length;
  return {
    source: parsed.source, sourceName: SOURCES[parsed.source] || null, conversations: parsed.conversations.length, messages: msgs, skipped: parsed.skipped || 0, alreadyImported: known,
    from: dates.length ? Math.min(...dates) : null, to: dates.length ? Math.max(...dates) : null,
    projects: [...new Set(parsed.conversations.map((c) => c.projectName).filter(Boolean))],
    sample: parsed.conversations.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8).map((c) => ({ title: c.title, messages: c.messages.length, at: c.updatedAt || c.createdAt })),
  };
}
