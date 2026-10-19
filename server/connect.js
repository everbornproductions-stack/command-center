// Connect a service by API key or by an MCP server (reuses the Phase 1 vault and the Phase 16
// MCP client). Chat models that sit in the council are not in this list: they need an API key,
// or an OpenRouter key. Tool and media services that offer both (Kling and the others below)
// store which connection is active. A job uses that one, and the other if it is also set up
// and the active one fails. Secrets stay in the vault. This module never logs a key or header.
import { PROVIDERS } from "./registry.js";
import { getSecret, hasSecret, maskedKey } from "./vault.js";
import { checkProvider } from "./health.js";
import { addServer, connectServer, executeTool, findServer, toolReadOnly } from "./mcp.js";
import { doc as readDoc, putDoc } from "./store.js";

export const CHOICE_DOC = "connect.choice";
export const COUNCIL_IDS = ["anthropic", "openai", "xai", "google"];
export const COUNCIL_NOTE = "Claude, ChatGPT, Grok and Gemini need an API key, or an OpenRouter key, to take part in the council. An MCP server does not take their place there. Tools such as Kling can use an API key or an MCP server.";
export const COUNCIL_CARD = "Council needs an API key, or an OpenRouter key. An MCP server does not take this model's place.";
export const DUAL_NOTE = "Use an API key or an MCP server. The active one runs the job. If both are set up and the active one fails, the other one runs it.";

// Tool-name hints per action. The linked server's real tool list wins; these are only a match order.
export const DUAL = {
  kling: { tools: { video: ["text_to_video", "image_to_video", "create_video", "generate_video", "kling_video", "text2video", "video"] } },
  elevenlabs: { tools: { voice: ["text_to_speech", "generate_speech", "tts", "elevenlabs_tts", "voice"] } },
  syncso: { tools: { video: ["lipsync", "sync", "generate", "video"] } },
  fal: { tools: { image: ["generate", "text_to_image", "create_image", "image"], video: ["text_to_video", "generate_video", "video", "generate"] } },
  replicate: { tools: { image: ["generate", "run", "text_to_image", "create_image", "image"] } },
};

const ARG_KEYS = new Set(["prompt", "text", "model", "kind", "duration", "aspect", "op", "n", "size", "quality", "negative", "mode"]);

const err = (status, message, code = "connect_invalid") => Object.assign(new Error(message), { status, code });

export const isDual = (id) => !!DUAL[id];
export const isCouncil = (id) => COUNCIL_IDS.includes(id);

function readChoices() {
  const d = readDoc(CHOICE_DOC, () => ({ choices: {} }));
  if (!d || typeof d !== "object") return { choices: {} };
  if (!d.choices || typeof d.choices !== "object") d.choices = {};
  return d;
}
function saveChoices(d) { putDoc(CHOICE_DOC, d); }

export function choiceOf(id) {
  const c = readChoices().choices[id];
  return { active: c?.active === "mcp" ? "mcp" : "key", serverId: c?.serverId || null };
}

export function mcpConfigured(id) {
  const sid = choiceOf(id).serverId;
  return !!(sid && findServer(sid));
}

// Which way to try. The active connection first, then the other, and only when that side is set up.
export function routeOrder({ active = "key", keyOn = false, mcpOn = false } = {}) {
  const pref = active === "mcp" ? "mcp" : "key";
  const other = pref === "mcp" ? "key" : "mcp";
  const on = { key: !!keyOn, mcp: !!mcpOn };
  const order = [];
  if (on[pref]) order.push(pref);
  if (on[other]) order.push(other);
  return order;
}

export function connectionOf(id) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const stored = choiceOf(id);
  const keyOn = hasSecret(id, p.keyEnv);
  const server = stored.serverId ? findServer(stored.serverId) : null;
  const mcpOn = !!server;
  const key = { configured: keyOn, masked: keyOn ? maskedKey(id, p.keyEnv) : null };
  const mcp = {
    configured: mcpOn,
    serverId: server?.id || null,
    name: server?.name || null,
    transport: server?.transport || null,
    url: server?.url || null,
    tools: (server?.lastTools || []).map((t) => t.name).slice(0, 40),
  };
  if (isCouncil(id)) {
    return { id, both: false, council: true, methods: ["key"], active: "key", note: COUNCIL_CARD, key, mcp: { configured: false, serverId: null, name: null, transport: null, url: null, tools: [] }, ready: keyOn, route: keyOn ? ["key"] : [] };
  }
  if (!isDual(id)) {
    const methods = p.api || p.keyEnv ? ["key"] : [];
    return { id, both: false, council: false, methods, active: "key", note: null, key, mcp: { configured: false, serverId: null, name: null, transport: null, url: null, tools: [] }, ready: keyOn, route: keyOn ? ["key"] : [] };
  }
  return {
    id, both: true, council: false, methods: ["key", "mcp"], active: stored.active, note: DUAL_NOTE,
    key, mcp, ready: keyOn || mcpOn,
    route: routeOrder({ active: stored.active, keyOn, mcpOn }),
  };
}

export function setActive(id, mode) {
  const p = PROVIDERS[id];
  if (!p) throw err(400, "unknown provider");
  if (isCouncil(id)) throw err(400, COUNCIL_NOTE, "council_key");
  if (!isDual(id)) throw err(400, `${p.name} does not offer both an API key and an MCP server.`);
  if (mode !== "key" && mode !== "mcp") throw err(400, "Choose API key or MCP.");
  const d = readChoices();
  const prev = d.choices[id] || {};
  d.choices[id] = { active: mode, serverId: prev.serverId || null };
  saveChoices(d);
  return connectionOf(id);
}

export async function linkMcp(id, input = {}) {
  const p = PROVIDERS[id];
  if (!p) throw err(400, "unknown provider");
  if (isCouncil(id)) throw err(400, COUNCIL_NOTE, "council_key");
  if (!isDual(id)) throw err(400, `${p.name} does not offer an MCP connection.`);
  const prev = choiceOf(id);
  const row = await addServer({
    id: prev.serverId || undefined,
    name: String(input.name || `${p.name} MCP`).slice(0, 60),
    transport: input.transport || "http",
    url: input.url,
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    ...(input.headers !== undefined && String(input.headers).trim() ? { headers: input.headers } : {}),
    ...(input.env !== undefined && String(input.env).trim() ? { env: input.env } : {}),
  });
  const d = readChoices();
  d.choices[id] = { active: "mcp", serverId: row.id };
  saveChoices(d);
  let error = null;
  let tools = [];
  try {
    const sess = await connectServer(row.id, { refresh: true });
    tools = (sess.tools || []).map((t) => t.name);
  } catch (e) { error = scrubMessage(id, e.message); }
  return { ok: !error, error, tools, connection: connectionOf(id) };
}

export async function testConnection(id, mode) {
  const p = PROVIDERS[id];
  if (!p) throw err(400, "unknown provider");
  const conn = connectionOf(id);
  if ((mode === "mcp") && (conn.council || !conn.both)) throw err(400, conn.council ? COUNCIL_NOTE : `${p.name} connects with an API key.`, conn.council ? "council_key" : "connect_invalid");
  const m = mode === "mcp" ? "mcp" : mode === "key" ? "key" : conn.active;
  if (m === "mcp") {
    if (!conn.mcp.configured) return { ok: false, mode: "mcp", detail: "No MCP server connected." };
    try {
      const sess = await connectServer(conn.mcp.serverId, { refresh: true });
      const n = sess.tools?.length || 0;
      return { ok: true, mode: "mcp", detail: `Connected. ${n} tool${n === 1 ? "" : "s"}.`, tools: (sess.tools || []).map((t) => t.name).slice(0, 40) };
    } catch (e) { return { ok: false, mode: "mcp", detail: `Could not reach the MCP server: ${scrubMessage(id, e.message)}` }; }
  }
  if (!conn.key.configured) return { ok: false, mode: "key", detail: "No API key saved." };
  const status = await checkProvider(id);
  const ok = status?.status === "green" || status?.status === "amber";
  return { ok, mode: "key", detail: status?.detail || (ok ? "Key works" : "Key check failed"), status: status?.status || "grey" };
}

const norm = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function pickTool(tools, action, hints = []) {
  const list = (Array.isArray(tools) ? tools : []).filter((t) => t?.name);
  const wants = [];
  for (const h of [...hints, action]) {
    const s = norm(h);
    if (s && !wants.includes(s)) wants.push(s);
  }
  for (const w of wants) {
    const hit = list.find((t) => norm(t.name) === w);
    if (hit) return hit;
  }
  for (const w of wants) {
    if (w.length < 4) continue;
    const hit = list.find((t) => { const n = norm(t.name); return n.length >= 4 && (n.includes(w) || w.includes(n)); });
    if (hit) return hit;
  }
  if (list.length === 1) return list[0];
  return null;
}

export function sanitizeArgs(args) {
  const out = {};
  if (!args || typeof args !== "object") return out;
  for (const [k, v] of Object.entries(args)) {
    if (!ARG_KEYS.has(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 4000);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function scrubMessage(providerId, message) {
  let s = String(message || "failed").replace(/\s+/g, " ").slice(0, 400);
  const sec = getSecret(providerId);
  for (const v of [sec?.key, sec?.secret]) {
    if (v && String(v).length >= 6) s = s.split(String(v)).join("redacted");
  }
  const sid = choiceOf(providerId).serverId;
  const mcp = sid ? getSecret(`mcp-${sid}`) : null;
  for (const bag of [mcp?.headers, mcp?.env]) {
    for (const v of Object.values(bag || {})) if (v && String(v).length >= 6) s = s.split(String(v)).join("redacted");
  }
  if (mcp?.oauth?.access) s = s.split(String(mcp.oauth.access)).join("redacted");
  return s;
}

export async function callProviderMcp(providerId, action, args) {
  const p = PROVIDERS[providerId];
  const conn = connectionOf(providerId);
  if (!conn?.mcp?.configured) throw new Error(`No MCP server is connected for ${p?.name || providerId}.`);
  const s = findServer(conn.mcp.serverId);
  const sess = await connectServer(s.id);
  const tools = sess.tools?.length ? sess.tools : (s.lastTools || []);
  const hints = DUAL[providerId]?.tools?.[action] || [];
  const tool = pickTool(tools, action, hints);
  if (!tool) {
    const names = tools.map((t) => t.name).slice(0, 12).join(", ");
    throw new Error(`${p.name} MCP server has no tool for this job${names ? ` (it has ${names})` : ""}.`);
  }
  const entry = { server: s, tool, readOnly: toolReadOnly(s, tool), needsApproval: false };
  // The Generate or Test click is the person's OK. Phase 16 still asks when a chat model calls a tool on its own.
  const r = await executeTool(entry, sanitizeArgs(args), { manual: true, provider: providerId });
  if (r.denied) throw new Error("The tool call was declined.");
  if (r.isError) throw new Error(scrubMessage(providerId, r.text || "MCP tool failed"));
  return r;
}

function pushUrl(urls, u) {
  if (typeof u !== "string") return;
  const s = u.trim();
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) urls.push(s);
}

function urlsFromJson(j, urls) {
  if (!j || typeof j !== "object") return null;
  pushUrl(urls, j.url);
  pushUrl(urls, j.video_url);
  pushUrl(urls, j.audio_url);
  if (j.video && typeof j.video === "object") pushUrl(urls, j.video.url);
  for (const u of [].concat(j.urls || [], j.images || [], j.videos || [])) {
    if (typeof u === "string") pushUrl(urls, u);
    else if (u && typeof u === "object") pushUrl(urls, u.url);
  }
  const b64 = typeof j.b64 === "string" ? j.b64 : typeof j.base64 === "string" ? j.base64 : null;
  if (b64) return { b64, mime: typeof j.mime === "string" ? j.mime : "application/octet-stream", ext: typeof j.ext === "string" ? j.ext : "bin" };
  return null;
}

// A tool result becomes files the media and image paths already know how to save.
export function filesFromTool(raw) {
  const urls = [];
  const text = String(raw?.text || "");
  let json = raw?.structured && typeof raw.structured === "object" ? raw.structured : null;
  if (!json) {
    const t = text.trim();
    if (t.startsWith("{") || t.startsWith("[")) { try { json = JSON.parse(t); } catch { json = null; } }
  }
  const embedded = Array.isArray(json) ? null : urlsFromJson(json, urls);
  if (embedded?.b64) {
    return { done: true, bytes: Buffer.from(embedded.b64, "base64"), mime: embedded.mime, ext: embedded.ext, urls: [] };
  }
  const data = text.match(/data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/i);
  if (data) {
    const [head, b64] = data[0].split(",");
    const mime = head.slice(5).split(";")[0];
    const ext = /png/.test(mime) ? "png" : /jpe?g/.test(mime) ? "jpg" : /webp/.test(mime) ? "webp" : /mpeg|mp3/.test(mime) ? "mp3" : /mp4/.test(mime) ? "mp4" : "bin";
    return { done: true, bytes: Buffer.from(b64.replace(/\s/g, ""), "base64"), mime, ext, urls: [] };
  }
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) urls.push(m[0].replace(/[),.;]+$/, ""));
  const uniq = [...new Set(urls)];
  if (!uniq.length) throw new Error("The MCP tool did not return a file or a link.");
  return { done: true, urls: uniq };
}

// Run a service job through the active connection, then the other if both are set up.
// `api` is the existing provider adapter. `mcp` turns a tool result into that adapter's shape.
export async function runService(providerId, action, { args = {}, api, mcp } = {}) {
  if (typeof api !== "function") throw err(500, "missing API adapter", "connect_invalid");
  if (!isDual(providerId)) return { via: "key", fallback: false, result: await api() };
  const conn = connectionOf(providerId);
  const order = conn?.route || [];
  if (!order.length) {
    const e = new Error("not configured");
    e.code = "not_configured";
    throw e;
  }
  const errors = [];
  for (let i = 0; i < order.length; i++) {
    const via = order[i];
    try {
      let result;
      if (via === "key") result = await api();
      else {
        const raw = await callProviderMcp(providerId, action, args);
        result = await Promise.resolve((mcp || filesFromTool)(raw));
      }
      return { via, fallback: i > 0, result };
    } catch (e) {
      errors.push({ via, message: scrubMessage(providerId, e.message) });
      if (i === order.length - 1) {
        if (errors.length === 1) throw e;
        const wrapped = new Error(errors.map((x) => `${x.via === "key" ? "API key" : "MCP"}: ${x.message}`).join(" "));
        wrapped.code = "connect_failed";
        wrapped.attempts = errors;
        throw wrapped;
      }
    }
  }
}
