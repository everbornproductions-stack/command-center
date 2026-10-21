// Manual handoff (Phase 26 extension). A registry of chat pages and a two-click paste flow.
// Click 1 copies a short prompt and opens the provider's own page in the default browser.
// Click 2, Grab reply, is the only time the clipboard is read. Confirm then saves the reply.
//
// This module never requests a provider page, never reads a clipboard, never opens a window,
// and never reads Antigravity or Gemini CLI tokens, cookies, or consumer OAuth tokens.
// Decision 16 is unchanged: smart fallback still skips a troubled provider and picks the next model.
import { PROVIDERS } from "./registry.js";
import { hasSecret } from "./vault.js";
import { doc, putDoc, ctx } from "./store.js";
import { trouble } from "./fallback.js";
import { connectionOf } from "./connect.js";
import { recordCall } from "./ledger.js";
import { emit } from "./events.js";
import { missionSummary } from "./mission.js";
import { observe } from "./brain.js";
import { heuristicClassify } from "./router.js";
import { pasteBlock, reportBlock, reportStatus } from "./reportback.js";

export const DOC = "handoff.registry";
export const SIGNIN_DOC = "handoff.signin";
export const LABEL = "manual handoff";
export const PROMPT_MAX = 12000;
export const INSTRUCTIONS = "Paste the copied text into the chat, send it, then copy the reply. Come back here and click Grab reply. Nothing is read from that page.";
// Google's unpaid Gemini API and AI Studio terms: prompts and replies may be used to improve Google products.
export const GEMINI_DATA_NOTICE = "Gemini free tier: Google says unpaid Gemini API and Google AI Studio use may use what you submit and the replies to improve Google products, and human reviewers may read them. Do not paste sensitive, confidential, or personal information. Paid Gemini API use follows different terms. This is a manual handoff. Meldmind does not send the text for you.";
export const GEMINI_TERMS = "https://ai.google.dev/gemini-api/terms";

const err = (status, message, code = "handoff_invalid") => Object.assign(new Error(message), { status, code });
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };

// Key-shaped tokens are stripped from a prompt so a saved key is not pasted into another chat.
const SECRET_RE = /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-or-v1-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|xai-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/g;
export function stripSecrets(s) { return String(s || "").replace(SECRET_RE, "[redacted]"); }
function looksLikeSecret(s) { SECRET_RE.lastIndex = 0; return SECRET_RE.test(String(s || "")); }

export const BUILTIN_TARGETS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", provider: "openai", note: "", builtin: true },
  { id: "claude", name: "Claude", url: "https://claude.ai/", provider: "anthropic", note: "", builtin: true },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/", provider: "google", note: "", builtin: true },
  { id: "grok", name: "Grok", url: "https://grok.com/", provider: "xai", note: "", builtin: true },
  { id: "antigravity", name: "Google Antigravity", url: "https://antigravity.google/", provider: null, note: "", builtin: true },
];

export function validateUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 300 || /\s/.test(s)) throw err(400, "Enter an http or https address.");
  let u;
  try { u = new URL(s); } catch { throw err(400, "That address is not a valid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw err(400, "Only http and https addresses are allowed.");
  if (u.username || u.password) throw err(400, "The address must not include a username or password.");
  for (const k of [...u.searchParams.keys()]) {
    if (/key|token|secret|password|auth/i.test(k)) throw err(400, "The address must not carry a key or token.");
  }
  return u.toString();
}

function cleanName(raw) {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) throw err(400, "Give the target a name (60 characters or fewer).");
  if (/[\u0000-\u001f]/.test(name) || looksLikeSecret(name)) throw err(400, "The name must not contain a key or token.");
  return name;
}
function cleanNote(raw) {
  const note = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (looksLikeSecret(note)) throw err(400, "The note must not contain a key or token. A target stores a name, an address, and a note only.");
  return note;
}
function cleanProvider(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const id = String(raw);
  if (!PROVIDERS[id] || PROVIDERS[id].kind !== "text") throw err(400, "Unknown chat provider.");
  return id;
}

function registry() {
  const d = doc(DOC, () => ({ targets: BUILTIN_TARGETS.map((t) => ({ ...t })) }));
  if (!d || typeof d !== "object" || !Array.isArray(d.targets)) return { targets: BUILTIN_TARGETS.map((t) => ({ ...t })) };
  return d;
}
function saveRegistry(d) { putDoc(DOC, { targets: d.targets.map(publicStored) }); }

function publicStored(t) {
  return { id: String(t.id), name: String(t.name), url: String(t.url), note: String(t.note || ""), provider: t.provider || null, builtin: !!t.builtin };
}

export function viaLabel(name) { return `via ${name} web, manual`; }
export function isGeminiTarget(t) { return t?.id === "gemini" || t?.provider === "google" || /gemini/i.test(t?.name || ""); }

// A boolean flag only. A token string is ignored and never copied out. Nothing here reads a credential file.
export function officialSignIn(providerId) {
  if (!providerId) return false;
  const d = ctx().docs[SIGNIN_DOC];
  return d?.connected?.[providerId] === true;
}
export function keyOn(providerId) {
  if (!providerId || !PROVIDERS[providerId]) return false;
  try { return !!hasSecret(providerId, PROVIDERS[providerId].keyEnv); } catch { return false; }
}
export function mcpOn(providerId) {
  if (!providerId || !PROVIDERS[providerId]) return false;
  try { return !!connectionOf(providerId)?.mcp?.configured; } catch { return false; }
}
export function asideOf(providerId) {
  if (!providerId) return null;
  try {
    const t = trouble(providerId);
    return t ? { kind: t.kind, reason: t.reason } : null;
  } catch { return null; }
}

// Show Continue in when nothing can run the provider here, or when fallback has stood it aside.
export function suggestFromAccess(access) {
  if (access?.aside) return true;
  return !(access?.key || access?.mcp || access?.officialSignIn);
}
function accessOf(t) {
  const provider = t.provider || null;
  const aside = asideOf(provider);
  const access = { key: keyOn(provider), mcp: mcpOn(provider), officialSignIn: officialSignIn(provider), aside: aside ? { kind: aside.kind, reason: aside.reason } : null };
  return access;
}
function suggestReason(access) {
  if (access.aside) return `standing aside: ${access.aside.reason}`;
  if (!access.key && !access.mcp && !access.officialSignIn) return "no key, MCP, or official sign-in";
  return "";
}

export function listTargets() {
  return registry().targets.map((t) => {
    const access = accessOf(t);
    return { ...publicStored(t), access, suggest: suggestFromAccess(access), reason: suggestReason(access), gemini: isGeminiTarget(t) };
  });
}
export function findTarget(id) { return registry().targets.find((t) => t.id === id) || null; }

export function addTarget(input = {}) {
  const name = cleanName(input.name);
  const url = validateUrl(input.url);
  const note = cleanNote(input.note);
  const provider = cleanProvider(input.provider);
  const id = "h-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const d = registry();
  d.targets.push({ id, name, url, note, provider, builtin: false });
  saveRegistry(d);
  emit("log", { text: `Manual handoff target added: ${name}.` });
  return listTargets().find((t) => t.id === id);
}
export function updateTarget(id, input = {}) {
  const d = registry();
  const t = d.targets.find((x) => x.id === id);
  if (!t) throw err(404, "No handoff target with that id.");
  if (input.name !== undefined) t.name = cleanName(input.name);
  if (input.url !== undefined) t.url = validateUrl(input.url);
  if (input.note !== undefined) t.note = cleanNote(input.note);
  if (input.provider !== undefined && !t.builtin) t.provider = cleanProvider(input.provider);
  saveRegistry(d);
  emit("log", { text: `Manual handoff target updated: ${t.name}.` });
  return listTargets().find((x) => x.id === id);
}
export function removeTarget(id) {
  const d = registry();
  const t = d.targets.find((x) => x.id === id);
  if (!t) throw err(404, "No handoff target with that id.");
  d.targets = d.targets.filter((x) => x.id !== id);
  saveRegistry(d);
  emit("log", { text: `Manual handoff target removed: ${t.name}.` });
  return { id, removed: true };
}

export function handoffView() {
  const targets = listTargets();
  let report = { hub: false, waiting: [] };
  try { report = reportStatus(); } catch { report = { hub: false, waiting: [] }; }
  return { label: LABEL, instructions: INSTRUCTIONS, geminiNotice: GEMINI_DATA_NOTICE, geminiTerms: GEMINI_TERMS, maxChars: PROMPT_MAX, targets, report };
}

function answerTexts(thread) {
  const a = thread?.answers;
  if (!a) return [];
  const list = Array.isArray(a) ? a : Object.values(a);
  return list.map((x) => (typeof x?.text === "string" ? x.text : "")).filter(Boolean);
}

export function threadTurns(thread) {
  if (!thread || typeof thread !== "object") return [];
  if (Array.isArray(thread.messages) && thread.messages.length) {
    return thread.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      text: typeof m.text === "string" ? m.text : typeof m.content === "string" ? m.content : "",
    })).filter((m) => m.text);
  }
  const turns = [];
  if (thread.prompt) turns.push({ role: "user", text: String(thread.prompt) });
  for (const text of answerTexts(thread)) turns.push({ role: "assistant", text });
  if (thread.verdict?.text) turns.push({ role: "assistant", text: String(thread.verdict.text) });
  for (const t of thread.tasks || []) if (t?.output) turns.push({ role: "assistant", text: String(t.output) });
  if (thread.deliverable && thread.kind !== "council") turns.push({ role: "assistant", text: String(thread.deliverable) });
  return turns.filter((t) => t.text);
}

export function buildHandoffPrompt({ targetName, summary, turns, draft, reportBlockText } = {}) {
  const name = clip(targetName || "the chat", 60) || "the chat";
  const recent = (Array.isArray(turns) ? turns : []).slice(-6).map((t) => ({
    role: t.role === "user" ? "You" : "Assistant",
    text: clip(stripSecrets(t.text), 900),
  })).filter((t) => t.text);
  const sum = clip(stripSecrets(summary || draft || recent.find((t) => t.role === "You")?.text || ""), 700);
  const lines = [
    `Manual handoff to ${name}.`,
    "Paste this into the chat, send it, then copy the whole reply.",
    "",
    "Summary:",
    sum || "(no summary yet)",
    "",
    "Recent turns:",
  ];
  if (!recent.length) lines.push("(none yet)");
  else for (const t of recent) lines.push(`${t.role}: ${t.text}`);
  const block = String(reportBlockText || pasteBlock()).trim();
  let text = `${lines.join("\n").trim()}\n\n${block}\n`;
  if (text.length > PROMPT_MAX) {
    const keep = `${block}\n`;
    const room = Math.max(0, PROMPT_MAX - keep.length - 16);
    text = `${text.slice(0, room).trimEnd()}\n[cut to fit]\n\n${keep}`;
  }
  const chars = text.length;
  return { text, chars, maxChars: PROMPT_MAX, bytes: Buffer.byteLength(text), pct: Math.min(100, Math.round((chars / PROMPT_MAX) * 100)) };
}

function summaryFrom(thread, draft, turns) {
  const first = turns.find((t) => t.role === "user")?.text || draft || thread?.prompt || thread?.title || "";
  const last = [...turns].reverse().find((t) => t.role === "assistant")?.text || "";
  const parts = [];
  if (first) parts.push(clip(first, 400));
  if (last) parts.push(`Last reply: ${clip(last, 280)}`);
  return parts.join("\n");
}

async function loadThread(id) {
  if (!id) return null;
  const clean = String(id).replace(/[^a-z0-9-]/gi, "");
  if (!clean) return null;
  const m = await ctx().store.getMission(clean);
  return m || null;
}

export async function buildForTarget({ targetId, threadId, draft } = {}) {
  const t = findTarget(targetId);
  if (!t) throw err(404, "No handoff target with that id.");
  const thread = threadId ? await loadThread(threadId) : null;
  if (threadId && !thread) throw err(404, "That thread was not found.");
  const turns = threadTurns(thread);
  const safeDraft = stripSecrets(String(draft || "").slice(0, 4000));
  const reported = await reportBlock({ kind: "copy", threadId: threadId || null, targetId: t.id });
  const built = buildHandoffPrompt({ targetName: t.name, summary: summaryFrom(thread, safeDraft, turns), turns, draft: safeDraft, reportBlockText: reported.block });
  return {
    targetId: t.id, name: t.name, url: t.url, label: LABEL, jobId: reported.jobId,
    prompt: built.text, chars: built.chars, maxChars: built.maxChars, bytes: built.bytes, pct: built.pct,
    instructions: INSTRUCTIONS, gemini: isGeminiTarget(t), geminiNotice: isGeminiTarget(t) ? GEMINI_DATA_NOTICE : null, geminiTerms: isGeminiTarget(t) ? GEMINI_TERMS : null,
    clipboard: "not read",
  };
}

// The page calls these in order. continueClick writes and opens. grabClick is the only read.
export async function continueClick({ prompt, writeClipboard, openUrl }) {
  if (typeof writeClipboard !== "function" || typeof openUrl !== "function") throw err(400, "Continue in needs a clipboard write and an opener.");
  await writeClipboard(String(prompt ?? ""));
  await openUrl();
  return { copied: true, opened: true, clipboardReads: 0, instructions: INSTRUCTIONS };
}
export async function grabClick({ readClipboard }) {
  if (typeof readClipboard !== "function") throw err(400, "Grab reply needs a clipboard read.");
  const text = await readClipboard();
  return { preview: String(text ?? ""), clipboardReads: 1 };
}

export async function saveManualReply({ targetId, threadId, text, draft, confirm }) {
  if (confirm !== true) throw err(400, "Confirm the preview first. The clipboard is only read when you click Grab reply.", "confirm");
  const t = findTarget(targetId);
  if (!t) throw err(404, "No handoff target with that id.");
  const body = String(text ?? "").trim();
  if (!body) throw err(400, "The reply is empty.");
  if (body.length > 200000) throw err(400, "That reply is too long to save.");
  const label = viaLabel(t.name);
  const now = Date.now();
  let m = threadId ? await loadThread(threadId) : null;
  if (threadId && !m) throw err(404, "That thread was not found.");
  if (!m) {
    const prompt = stripSecrets(String(draft || "").slice(0, 8000));
    m = {
      id: "s-" + now.toString(36), kind: "single", title: (prompt || `Manual handoff: ${t.name}`).slice(0, 90),
      prompt, projectId: null, status: "done", startedAt: now, provider: t.provider || "manual", model: t.name,
      cost: 0, tasks: [], sources: [], messages: [], deliverable: "",
    };
  }
  m.messages = Array.isArray(m.messages) ? m.messages.slice() : [];
  if (!m.messages.length && m.prompt) m.messages.push({ role: "user", text: String(m.prompt).slice(0, 8000), at: m.startedAt || now });
  if (m.deliverable && !m.messages.some((x) => x.role !== "user")) m.messages.push({ role: "assistant", text: String(m.deliverable).slice(0, 20000), at: m.finishedAt || now });
  m.messages.push({ role: "assistant", text: body, at: now, manual: true, tag: label, target: t.name });
  const block = `**${label}**\n\n${body}`;
  m.deliverable = m.deliverable ? `${m.deliverable}\n\n---\n\n${block}` : block;
  m.handoff = { last: { targetId: t.id, name: t.name, label, at: now, manual: true } };
  m.manual = true;
  if (m.status !== "running") m.status = m.status || "done";
  m.finishedAt = m.finishedAt || now;
  const title = m.title || String(m.prompt || label).slice(0, 90);
  ctx().store.saveMission(m, missionSummary({ ...m, title }));
  const entry = recordCall({
    provider: t.provider && PROVIDERS[t.provider] ? t.provider : "manual",
    model: t.name,
    usage: { input: 0, output: 0, cost: 0, manual: true, handoff: t.name },
    missionId: m.id,
    role: "manual-handoff",
  });
  emit("log", { text: `Manual handoff saved (${label}).`, missionId: m.id });
  // The reply is a finished job. Record the target and the task type. The reply text is not stored.
  const cls = heuristicClassify(String(m.prompt || draft || "").slice(0, 4000));
  observe({
    provider: t.provider && PROVIDERS[t.provider] ? t.provider : "manual",
    model: t.name,
    capability: cls.capability,
    difficulty: cls.difficulty,
    runId: m.id,
    ok: true,
    cost: 0,
  });
  emit("mission.update", { mission: { ...m, title, tasks: m.tasks || [] } });
  return { threadId: m.id, label, manual: true, ledger: { cost: entry.cost, manual: entry.manual === true, usage: entry.usage, handoff: entry.handoff, model: entry.model, role: entry.role, missionId: entry.missionId } };
}
