// Community chat rules. Channels, sign-in, sharing, votes, and moderation.
// A message is kept only after these checks. Keys, private files, profanity, and spam are refused.
// Nothing here talks to the network.

import crypto from "node:crypto";

export const CHANNELS = [
  { id: "general", label: "General" },
  { id: "prompts", label: "Prompts" },
  { id: "builders", label: "Builders" },
  { id: "help", label: "Help" },
  { id: "show", label: "Show and tell" },
  { id: "news", label: "AI News", feed: true },
];

export const CHAT_IDS = new Set(["general", "prompts", "builders", "help", "show"]);
export const SHARE_KINDS = new Set(["prompt", "builder", "mission", "news"]);
export const SHARE_CHANNEL = { prompt: "prompts", builder: "builders", mission: "show", news: "general" };

export const BURST_MAX = 5;
export const BURST_MS = 8000;
export const HOUR_MAX = 40;
export const HOUR_MS = 60 * 60 * 1000;
export const USERNAME_COOLDOWN_MS = HOUR_MS;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

const NAME_LEFT = ["Bright", "Calm", "Kind", "Quick", "Sunny", "Gentle", "Brave", "Happy"];
const NAME_RIGHT = ["Otter", "Robin", "Maple", "Cedar", "River", "Pebble", "Willow", "Finch"];
const RESERVED_NAME = /meldmind|admin|everborn/i;

export const CONDUCT = [
  "Be kind and stay on the topic of the channel.",
  "Do not post keys, passwords, private files, or someone else's personal data.",
  "Do not spam, advertise, or repeat the same post.",
  "Use Report if a post breaks these rules. The owner can remove a post or mute someone.",
  "Nothing is posted until you click Send.",
];

const BANNED_SHARE_KEYS = new Set([
  "file", "files", "path", "paths", "filepath", "key", "keys", "secret", "secrets",
  "token", "tokens", "password", "attachment", "attachments", "content", "data", "vault",
]);

const SECRET = [
  /\bsk-[A-Za-z0-9_\-]{8,}\b/,
  /\bxai-[A-Za-z0-9]{8,}\b/,
  /\bgsk_[A-Za-z0-9]{8,}\b/,
  /\bAIza[0-9A-Za-z\-_]{10,}\b/,
  /\bAQ\.[A-Za-z0-9_\-]{8,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_\-]{12,}\.[A-Za-z0-9_\-]{12,}/,
  /(?:^|[^A-Za-z])[A-Za-z]:[\\/][^\s]{2,}/,
  /\/(?:home|Users|root)\/[^\s]+/,
  /~\/\.[A-Za-z0-9_\-]+/,
  /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*\S{6,}/i,
  /(^|\s)\.env\b|\bid_rsa\b|supabase-db-password/i,
];

const PROFANITY = /\b(fuck|f\*+ck|shit|s\*+it|bitch|asshole|bastard|cunt|dickhead)\b/i;

export function emptyRoom() {
  return { messages: [], reports: [], mutes: [], votes: [], recent: {} };
}

export function normalizeRoom(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    messages: Array.isArray(d.messages) ? d.messages : [],
    reports: Array.isArray(d.reports) ? d.reports : [],
    mutes: Array.isArray(d.mutes) ? d.mutes : [],
    votes: Array.isArray(d.votes) ? d.votes : [],
    recent: d.recent && typeof d.recent === "object" && !Array.isArray(d.recent) ? d.recent : {},
  };
}

export function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validEmail(value) {
  const email = cleanEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function fail(status, error) {
  return { ok: false, status, error };
}

export function findSecret(text) {
  const value = String(text || "");
  return SECRET.some((re) => re.test(value));
}

export function findProfanity(text) {
  return PROFANITY.test(String(text || ""));
}

export function checkUsername(value) {
  const username = String(value || "").trim();
  if (!USERNAME_RE.test(username)) return fail(400, "Use 3 to 20 characters: letters, numbers, and underscore.");
  const words = username.replace(/_/g, " ");
  if (RESERVED_NAME.test(username) || findProfanity(words) || findSecret(username)) {
    return fail(400, "That username is not allowed. Pick another.");
  }
  return { ok: true, username };
}

function nameTaken(taken, username) {
  const key = String(username || "").toLowerCase();
  if (!taken || !key) return false;
  if (typeof taken === "function") return !!taken(key);
  if (taken instanceof Set) return taken.has(key);
  return Object.prototype.hasOwnProperty.call(taken, key);
}

export function suggestUsername(taken, now = Date.now()) {
  const seed = Math.abs(Number(now) || 0);
  for (let i = 0; i < 80; i++) {
    const left = NAME_LEFT[(seed + i) % NAME_LEFT.length];
    const right = NAME_RIGHT[(seed + i * 3) % NAME_RIGHT.length];
    const candidate = i < NAME_LEFT.length ? `${left}_${right}` : `${left}_${right}${(seed + i) % 90 + 10}`;
    if (!USERNAME_RE.test(candidate) || nameTaken(taken, candidate)) continue;
    if (checkUsername(candidate).ok) return candidate;
  }
  return `Kind_Robin${(seed % 90) + 10}`;
}

export function claimUsername({ username, email, names, current = "", changedAt = 0, now = Date.now() } = {}) {
  const lic = cleanEmail(email);
  if (!lic || !validEmail(lic)) return fail(400, "Add a licence first. Community chat uses the email on your licence.");
  const checked = checkUsername(username);
  if (!checked.ok) return checked;
  const key = checked.username.toLowerCase();
  const map = {};
  if (names && typeof names === "object" && !(names instanceof Set)) {
    for (const [rawKey, rawEmail] of Object.entries(names)) map[String(rawKey).toLowerCase()] = cleanEmail(rawEmail);
  }
  const holder = map[key];
  if (holder && holder !== lic) return fail(409, "That username is taken. Pick another.");
  const currentKey = String(current || "").trim().toLowerCase();
  if (currentKey && currentKey === key) {
    const until = changedAt ? Number(changedAt) + USERNAME_COOLDOWN_MS : 0;
    return { ok: true, username: checked.username, same: true, cooldownUntil: until };
  }
  if (currentKey && changedAt && now - Number(changedAt) < USERNAME_COOLDOWN_MS) {
    const until = Number(changedAt) + USERNAME_COOLDOWN_MS;
    return { ok: false, status: 429, error: "Wait 1 hour before you change your username again.", cooldownUntil: until };
  }
  return { ok: true, username: checked.username, same: false, cooldownUntil: now + USERNAME_COOLDOWN_MS };
}

function newId() {
  return `c-${crypto.randomBytes(6).toString("hex")}`;
}

export function cleanShare(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "That share is not valid.");
  for (const key of Object.keys(raw)) {
    if (!BANNED_SHARE_KEYS.has(key)) continue;
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
      return fail(400, "Private files and keys are not shared. Remove them and try again.");
    }
  }
  const kind = String(raw.kind || "");
  if (!SHARE_KINDS.has(kind)) return fail(400, "Share a prompt, a builder, or a mission.");
  const id = String(raw.id || "").trim().slice(0, 80);
  const title = String(raw.title || "").trim().slice(0, 120);
  const text = String(raw.text || "").trim().slice(0, 2000);
  const sourceUrl = String(raw.sourceUrl || "").trim().slice(0, 300);
  if (!id || !title) return fail(400, "That share needs a title.");
  if (findSecret(`${title}\n${text}\n${sourceUrl}`)) return fail(400, "That message looks like a key or a private file. It was not sent.");
  if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) return fail(400, "A source link must start with https.");
  return { ok: true, share: { kind, id, title, text, sourceUrl: sourceUrl || "" } };
}

export function shareBody(share) {
  const lines = [`${share.title}`];
  if (share.text) lines.push(share.text);
  if (share.sourceUrl) lines.push(share.sourceUrl);
  return lines.join("\n").slice(0, 2000);
}

function findSpam(body, recentBodies) {
  const urls = body.match(/https?:\/\//gi) || [];
  if (urls.length > 3) return "That looks like spam. It was not sent.";
  const chars = body.replace(/\s/g, "");
  if (chars.length > 24) {
    const counts = new Map();
    for (const ch of chars) counts.set(ch, (counts.get(ch) || 0) + 1);
    const top = Math.max(...counts.values());
    if (top / chars.length > 0.8) return "That looks like spam. It was not sent.";
  }
  const copies = recentBodies.filter((item) => item === body).length;
  if (copies >= 2) return "That message was already sent. It was not sent again.";
  return "";
}

export function muteUntil(room, email, now) {
  const row = (room.mutes || []).find((item) => item.email === email);
  if (!row || Number(row.until) <= now) return 0;
  return Number(row.until);
}

export function postMessage(room, actor, input, now = Date.now()) {
  const next = normalizeRoom(room);
  if (!actor?.email || !validEmail(actor.email)) return fail(401, "Pick a username first.");
  const username = String(actor.username || actor.displayName || "").trim();
  if (!username) return fail(401, "Pick a username first.");
  const until = muteUntil(next, actor.email, now);
  if (until) return fail(403, `You are muted until ${new Date(until).toLocaleString()}.`);
  let share = null;
  if (input?.share) {
    const cleaned = cleanShare(input.share);
    if (!cleaned.ok) return cleaned;
    share = cleaned.share;
  }
  const requested = String(input?.channel || "").trim();
  const channel = CHAT_IDS.has(requested) ? requested : (share ? SHARE_CHANNEL[share.kind] : "general");
  if (!CHAT_IDS.has(channel)) return fail(400, "Pick a channel first.");
  let body = String(input?.body || "").trim();
  if (!body && share) body = shareBody(share);
  if (!body) return fail(400, "Write a message first.");
  if (body.length > 2000) return fail(400, "That message is too long.");
  if (findSecret(body) || (share && findSecret(JSON.stringify(share)))) return fail(400, "That message looks like a key or a private file. It was not sent.");
  if (findProfanity(body)) return fail(400, "That message breaks the code of conduct. It was not sent.");
  const recentBodies = next.messages
    .filter((item) => item.email === actor.email && !item.deleted && now - item.createdAt < HOUR_MS)
    .map((item) => item.body);
  const spam = findSpam(body, recentBodies);
  if (spam) return fail(400, spam);
  const times = (Array.isArray(next.recent[actor.email]) ? next.recent[actor.email] : []).filter((t) => now - t < HOUR_MS);
  if (times.filter((t) => now - t < BURST_MS).length >= BURST_MAX) return fail(429, "Slow down a moment, then try again.");
  if (times.length >= HOUR_MAX) return fail(429, "You have sent enough for this hour. Try again later.");
  const message = {
    id: newId(),
    channel,
    email: actor.email,
    displayName: username,
    username,
    body,
    kind: share?.kind || "text",
    share,
    createdAt: now,
    deleted: false,
  };
  next.messages.push(message);
  next.recent[actor.email] = [...times, now];
  if (next.messages.length > 400) next.messages = next.messages.slice(-400);
  return { ok: true, message, room: next };
}

export function promptCounts(room, promptId, email = "") {
  const rows = normalizeRoom(room).votes.filter((item) => item.promptId === promptId);
  const mine = rows.find((item) => item.email === email)?.vote || null;
  return {
    up: rows.filter((item) => item.vote === "up").length,
    down: rows.filter((item) => item.vote === "down").length,
    mine,
  };
}

export function castPromptVote(room, actor, messageId, vote, now = Date.now()) {
  const next = normalizeRoom(room);
  if (!actor?.email) return fail(401, "Pick a username first.");
  const message = next.messages.find((item) => item.id === messageId && !item.deleted);
  if (!message) return fail(404, "That message is gone.");
  if (message.share?.kind !== "prompt" && message.kind !== "prompt") return fail(400, "Only a shared prompt can be voted on.");
  const choice = vote === "clear" ? "" : vote;
  if (choice !== "" && choice !== "up" && choice !== "down") return fail(400, "Choose thumbs up or thumbs down.");
  const promptId = String(message.share?.id || message.id).slice(0, 80);
  next.votes = next.votes.filter((item) => !(item.email === actor.email && item.promptId === promptId));
  if (choice) next.votes.push({ email: actor.email, promptId, messageId, vote: choice, at: now });
  return { ok: true, promptId, counts: promptCounts(next, promptId, actor.email), room: next };
}

export function publicMessage(message, room, actor) {
  const counts = message.share?.kind === "prompt" || message.kind === "prompt"
    ? promptCounts(room, message.share?.id || message.id, actor?.email || "")
    : { up: 0, down: 0, mine: null };
  const row = {
    id: message.id,
    channel: message.channel,
    displayName: message.displayName,
    username: message.username || message.displayName,
    body: message.body,
    kind: message.kind,
    share: message.share || null,
    createdAt: message.createdAt,
    mine: message.email === actor?.email,
    up: counts.up,
    down: counts.down,
    voted: counts.mine,
  };
  return row;
}

export function listMessages(room, channel, actor) {
  const next = normalizeRoom(room);
  return next.messages
    .filter((item) => item.channel === channel && !item.deleted)
    .slice(-100)
    .map((item) => publicMessage(item, next, actor));
}

export function deleteMessage(room, actor, id, now = Date.now()) {
  const next = normalizeRoom(room);
  const message = next.messages.find((item) => item.id === id && !item.deleted);
  if (!message) return fail(404, "That message is gone.");
  if (message.email !== actor?.email && !actor?.owner) return fail(403, "Only the owner can remove someone else's message.");
  message.deleted = true;
  message.deletedAt = now;
  message.body = "";
  message.share = null;
  return { ok: true, room: next };
}

export function reportMessage(room, actor, id, reason, now = Date.now()) {
  const next = normalizeRoom(room);
  if (!actor?.email) return fail(401, "Pick a username first.");
  const message = next.messages.find((item) => item.id === id && !item.deleted);
  if (!message) return fail(404, "That message is gone.");
  const why = String(reason || "").trim();
  if (why.length < 3 || why.length > 300) return fail(400, "Say why you are reporting it, in a short note.");
  if (findSecret(why) || findProfanity(why)) return fail(400, "That note cannot be saved.");
  if (next.reports.some((item) => item.messageId === id && item.email === actor.email)) return fail(409, "You already reported that message.");
  next.reports.push({ id: newId(), messageId: id, email: actor.email, reason: why, at: now });
  return { ok: true, room: next };
}

export function mutePerson(room, actor, username, minutes, now = Date.now(), names = {}) {
  const next = normalizeRoom(room);
  if (!actor?.owner) return fail(403, "Only the owner can mute someone.");
  const checked = checkUsername(username);
  if (!checked.ok) return fail(400, "Enter the username to mute.");
  const key = checked.username.toLowerCase();
  let target = "";
  if (names && typeof names === "object") target = cleanEmail(names[key]);
  if (!target) {
    const hit = next.messages.find((item) => String(item.displayName || item.username || "").trim().toLowerCase() === key && item.email);
    target = cleanEmail(hit?.email);
  }
  if (!target || !validEmail(target)) return fail(404, "No one is using that username.");
  const mins = Math.round(Number(minutes));
  if (!Number.isFinite(mins) || mins < 1 || mins > 60 * 24 * 30) return fail(400, "Pick how many minutes, up to 30 days.");
  const until = now + mins * 60 * 1000;
  next.mutes = next.mutes.filter((item) => item.email !== target);
  next.mutes.push({ email: target, until });
  return { ok: true, until, room: next };
}

export function topPromptRows(room) {
  const next = normalizeRoom(room);
  const byId = new Map();
  for (const message of next.messages) {
    if (message.deleted) continue;
    if (message.share?.kind !== "prompt" && message.kind !== "prompt") continue;
    const id = String(message.share?.id || message.id);
    byId.set(id, {
      id,
      title: message.share?.title || message.body.slice(0, 80),
      text: message.share?.text || "",
    });
  }
  return [...byId.values()].map((row) => {
    const counts = promptCounts(next, row.id);
    return { ...row, up: counts.up, down: counts.down };
  });
}

export function highlightRows(room) {
  const next = normalizeRoom(room);
  const show = next.messages.filter((item) => !item.deleted && item.channel === "show");
  const pool = show.length ? show : next.messages.filter((item) => !item.deleted && item.channel === "general");
  return pool.slice(-5).reverse().map((item) => ({
    id: item.id,
    title: item.share?.title || item.displayName || "Community",
    channel: item.channel,
    excerpt: String(item.body || "").replace(/\s+/g, " ").slice(0, 180),
  })).filter((item) => item.excerpt && !findSecret(item.excerpt));
}
