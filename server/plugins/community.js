// Community chat and the weekly AI News feed.
// Local documents are the copy on this computer. Supabase is updated when it can be reached.
// Email is an opt-in copy only. This plugin never sends mail.
import crypto from "node:crypto";
import { licenseState } from "../license.js";
import { readChangelog } from "./tour.js";
import * as Chat from "../community-chat.js";
import * as Votes from "../community-votes.js";
import * as News from "../ai-news.js";
import * as Cloud from "../community-cloud.js";
import * as Account from "../account-name.js";
import { signedInEmail } from "../signed-in-email.js";
import { flagOn } from "../flags.js";
import { cloudConfigured } from "../license.js";

export const id = "community";

const PROFILE = "community.profile";
const NAMES = "community.names";
const ROOM = "community.room";
const NEWS = "community.news";
const LIST = "newsletter.subscriber";

function licenceEmail() {
  try { return Chat.cleanEmail(licenseState().email); }
  catch { return ""; }
}
// Who the person is in chat: the email on a licence, or the verified Google or Microsoft sign-in.
// Chat is open to anyone signed in, not only paid plans.
function identityEmail() {
  return licenceEmail() || Chat.cleanEmail(signedInEmail());
}
function isOwner() {
  try { return licenseState().tier === "owner"; }
  catch { return false; }
}
function rawLicenceKey(h) {
  const row = h.doc("license", () => undefined);
  return typeof row?.key === "string" ? row.key : "";
}
const DEVICE = "community.device";
// A free person has no licence key. Their install gets one random device token, kept in this app's data
// folder only. The shared room knows the token by its hash and never learns the email.
function deviceToken(h) {
  const row = h.doc(DEVICE, () => null);
  if (row && typeof row.token === "string" && row.token.length >= 24) return row.token;
  const token = crypto.randomBytes(24).toString("base64url");
  h.putDoc(DEVICE, { token, createdAt: Date.now() });
  return token;
}
// When the shared room says it has no free-account door yet, say so before anyone types.
let freeBlockedUntil = 0;
const FREE_BLOCK_MS = 10 * 60 * 1000;
function sharingMode(h) {
  if (rawLicenceKey(h)) return { mode: "key", canShare: true, note: "" };
  if (!flagOn("freechat")) {
    return { mode: "local", canShare: false, note: "Sharing with everyone needs a License key right now. You can read the room. Anything you write stays on this computer." };
  }
  if (!cloudConfigured()) {
    return { mode: "local", canShare: false, note: "The shared room is not reachable from this computer, so you can read but not post. Anything you write stays on this computer." };
  }
  if (Date.now() < freeBlockedUntil) {
    return { mode: "local", canShare: false, note: "Posting from a free account is not switched on in the shared room yet. You can read everything. A License key lets you post now." };
  }
  return { mode: "device", canShare: true, note: "" };
}
function loadRoom(h) {
  return Chat.normalizeRoom(h.doc(ROOM, () => Chat.emptyRoom()));
}
function saveRoom(h, room) {
  h.putDoc(ROOM, room);
}
function loadNews(h) {
  const raw = h.doc(NEWS, () => News.emptyNews()) || News.emptyNews();
  return {
    draft: raw.draft || null,
    published: raw.published || null,
    seen: raw.seen || null,
    reactions: Array.isArray(raw.reactions) ? raw.reactions : [],
    comments: Array.isArray(raw.comments) ? raw.comments : [],
  };
}
function saveNews(h, news) {
  h.putDoc(NEWS, news);
}
function loadList(h) {
  const raw = h.doc(LIST, () => ({ optedIn: false, email: null, token: null, pending: false })) || {};
  return {
    optedIn: raw.optedIn === true,
    email: raw.email || null,
    token: raw.token || null,
    pending: raw.pending === true,
  };
}
function saveList(h, row) {
  h.putDoc(LIST, row);
}
function takenNames(h) {
  const doc = h.doc(NAMES, () => ({ names: {} })) || { names: {} };
  const names = {};
  for (const [rawKey, rawEmail] of Object.entries(doc.names || {})) {
    const key = String(rawKey).trim().toLowerCase();
    const email = Chat.cleanEmail(rawEmail);
    if (key && email) names[key] = email;
  }
  const room = loadRoom(h);
  for (const message of room.messages || []) {
    const key = String(message.displayName || message.username || "").trim().toLowerCase();
    const email = Chat.cleanEmail(message.email);
    if (!key || !email || names[key]) continue;
    names[key] = email;
  }
  const saved = h.doc(PROFILE, () => null) || {};
  const current = String(saved.username || saved.displayName || "").trim().toLowerCase();
  const email = Chat.cleanEmail(saved.email);
  if (current && email) names[current] = email;
  return names;
}
function actorOf() {
  const profile = Account.readProfile();
  const lic = identityEmail();
  const owner = isOwner();
  const username = profile.username || "";
  const changedAt = Number(profile.usernameChangedAt) || 0;
  const cooldownUntil = username && changedAt ? changedAt + Chat.USERNAME_COOLDOWN_MS : 0;
  if (!lic || !username) return { email: "", username, displayName: "", owner, cooldownUntil };
  return { email: lic, username, displayName: username, owner, cooldownUntil };
}
function needActor(h) {
  if (!identityEmail()) return { error: Chat.SIGN_IN_FIRST, status: 400 };
  const actor = actorOf(h);
  if (!actor.email || !actor.username) return { error: "Pick a username first.", status: 401 };
  return { actor };
}
function clientList(row, { token = false } = {}) {
  const out = { optedIn: row.optedIn === true, pending: row.pending === true };
  if (token && row.token) out.token = row.token;
  return out;
}
function saveUsername(h, rawName) {
  return Account.saveAccountUsername(rawName, { requireLicence: true, extraNames: takenNames(h) });
}

async function libraryVote(h, room, actor, promptId) {
  const rows = room.votes.filter((item) => item.promptId === promptId && item.email !== actor.email);
  const mine = room.votes.find((item) => item.promptId === promptId && item.email === actor.email)?.vote || "";
  return Votes.saveLibraryVote(h, {
    promptId,
    mine,
    others: {
      up: rows.filter((item) => item.vote === "up").length,
      down: rows.filter((item) => item.vote === "down").length,
    },
  });
}

// Pulls the shared room into the local copy. Returns { online, at } so the page can say "Updated just now" or "Offline".
// Your own post comes back from the cloud with a different id when the send did not return one, so a local message
// with the same name, channel and words (sent within 15 minutes) adopts the cloud id instead of showing twice.
const SAME_POST_MS = 15 * 60 * 1000;
async function mergeRemote(h, channel) {
  let pulled;
  try { pulled = await Cloud.pullChannel(channel); }
  catch { return { online: false, at: 0 }; }
  if (!pulled || pulled.offline) return { online: false, at: 0 };
  const status = { online: true, at: Date.now() };
  let rows = Array.isArray(pulled.body) ? pulled.body : [];
  if (rows.length === 1 && Array.isArray(rows[0])) rows = rows[0];
  if (!rows.length) return status;
  const room = loadRoom(h);
  const have = new Set(room.messages.map((item) => item.id));
  let changed = false;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const id = String(row.id || "").slice(0, 80);
    const body = String(row.body || "").slice(0, 2000);
    if (!id || !body || have.has(id)) continue;
    if (Chat.findSecret(body) || Chat.findProfanity(body)) continue;
    const share = row.share && typeof row.share === "object" && !Array.isArray(row.share) ? row.share : null;
    if (share && Chat.findSecret(JSON.stringify(share))) continue;
    const created = Date.parse(row.createdAt);
    const createdAt = Number.isFinite(created) ? created : Date.now();
    const who = String(row.username || row.displayName || "Member").slice(0, 20);
    const twin = room.messages.find((m) => m.email && !m.deleted && m.channel === (Chat.CHAT_IDS.has(row.channel) ? row.channel : channel)
      && m.body === body && String(m.username || m.displayName).toLowerCase() === who.toLowerCase()
      && Math.abs((Number(m.createdAt) || 0) - createdAt) < SAME_POST_MS && !have.has(id) && !m.cloudSeen);
    if (twin) {
      have.delete(twin.id);
      twin.id = id;
      twin.cloudSeen = true;
      delete twin.unsent;
      delete twin.unsentReason;
      have.add(id);
      changed = true;
      continue;
    }
    room.messages.push({
      id,
      channel: Chat.CHAT_IDS.has(row.channel) ? row.channel : channel,
      email: "",
      displayName: who,
      username: who,
      body,
      kind: Chat.SHARE_KINDS.has(row.kind) ? row.kind : "text",
      share,
      createdAt,
      deleted: false,
    });
    have.add(id);
    changed = true;
  }
  if (changed) saveRoom(h, room);
  return status;
}

// Returns what really happened, so the page never says "Posted." for a message nobody else can see.
// delivered: the shared room took it. retry: worth trying again later (offline). reason: plain words.
async function syncPost(message, key, h) {
  let sent;
  if (key) {
    sent = await Cloud.pushPost({
      p_key: key,
      p_channel: message.channel,
      p_name: message.displayName,
      p_body: message.body,
      p_kind: message.kind,
      p_share: message.share || null,
    });
  } else {
    const mode = h ? sharingMode(h) : { mode: "local", note: "" };
    if (mode.mode !== "device") return { delivered: false, retry: false, reason: mode.note || "Saved on this computer only. Sharing with everyone needs a License key for now." };
    sent = await Cloud.pushFreePost({
      p_device: deviceToken(h),
      p_channel: message.channel,
      p_name: message.displayName,
      p_body: message.body,
      p_kind: message.kind,
      p_share: message.share || null,
    });
    if (sent.offline && sent.body && (sent.body.code === "PGRST202" || /could not find the function/i.test(String(sent.body.message || "")))) {
      freeBlockedUntil = Date.now() + FREE_BLOCK_MS;
      return { delivered: false, retry: false, reason: "Posting from a free account is not switched on in the shared room yet. It is saved here only. A License key lets you post now." };
    }
  }
  if (sent.offline) return { delivered: false, retry: true, reason: "Could not reach the community. It is saved here and will be sent when the connection is back." };
  if (sent.body?.ok === false) return { delivered: false, retry: false, reason: String(sent.body.message || "The community did not accept that message.").slice(0, 200) };
  return { delivered: true, retry: false, reason: "", cloudId: sent.body?.id ? String(sent.body.id).slice(0, 80) : "" };
}

// Messages that could not be sent are tried again on the next refresh, while the licence key is on file.
async function retryUnsent(h, actor) {
  const key = rawLicenceKey(h);
  if (!actor.email || (!key && sharingMode(h).mode !== "device")) return;
  const room = loadRoom(h);
  const waiting = room.messages.filter((m) => m.unsent === "retry" && m.email === actor.email && !m.deleted).slice(0, 5);
  if (!waiting.length) return;
  let changed = false;
  for (const m of waiting) {
    const r = await syncPost(m, key, h);
    if (r.delivered) { delete m.unsent; if (r.cloudId) m.id = r.cloudId; changed = true; }
    else if (!r.retry) { m.unsent = "rejected"; m.unsentReason = r.reason; changed = true; }
    else break;
  }
  if (changed) saveRoom(h, room);
}

function publicNews(news, actor) {
  const issue = news.published && news.published.status === "published" ? news.published : null;
  const withCounts = (item) => ({
    ...item,
    ...News.reactionCounts(news, issue?.id, item.id, actor?.email || ""),
    comments: News.publicComments(news, issue?.id, item.id, actor),
  });
  return {
    unread: News.isUnread(news),
    draft: actor?.owner ? news.draft : null,
    issue: issue ? {
      ...issue,
      sections: {
        ai: (issue.sections.ai || []).map(withCounts),
        meldmind: (issue.sections.meldmind || []).map(withCounts),
        prompts: (issue.sections.prompts || []).map(withCounts),
        highlights: (issue.sections.highlights || []).map(withCounts),
      },
    } : null,
  };
}

// One cloud pull for the news feed is shared by the chat page, the rail and the unread badge.
// A reload within NEWS_TTL_MS reuses it; the Community page's own refresh button asks for a fresh one.
const NEWS_TTL_MS = 5 * 60 * 1000;
let newsPulledAt = 0;
let newsPulling = null;
async function refreshNews(h, actor, { force = false } = {}) {
  let news = loadNews(h);
  const fresh = !force && Date.now() - newsPulledAt < NEWS_TTL_MS;
  let pulled = { offline: true, body: null };
  if (!fresh) {
    if (!newsPulling) newsPulling = Cloud.pullNews().finally(() => { newsPulling = null; });
    pulled = await newsPulling;
    if (!pulled.offline) newsPulledAt = Date.now();
  }
  const remote = !pulled.offline ? News.normalizeIssue(pulled.body?.issue || pulled.body) : null;
  if (remote && remote.status === "published") {
    news.published = remote;
    saveNews(h, news);
  }
  const out = publicNews(news, actor);
  if (!out.issue) out.shipped = shippedThisWeek();
  return out;
}

// "No issue yet" still shows something useful: the newest notes of what Meldmind shipped, from the app's own change list.
function shippedThisWeek() {
  try {
    const data = readChangelog();
    const key = Object.keys(data).filter((k) => /^\d+(\.\d+)*$/.test(k))
      .sort((x, y) => { const a = x.split(".").map(Number), b = y.split(".").map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (b[i] || 0) - (a[i] || 0); if (d) return d; } return 0; })[0];
    const row = key ? data[key] : null;
    const bullets = Array.isArray(row?.bullets) ? row.bullets.map((t) => String(t).slice(0, 220)).slice(0, 5) : [];
    return bullets.length ? { version: key, title: String(row.title || "What's new in Meldmind").slice(0, 80), bullets } : null;
  } catch { return null; }
}

function reply(h, res, result) {
  const payload = { error: result.error };
  if (result.cooldownUntil) payload.cooldownUntil = result.cooldownUntil;
  return h.json(res, result.status || 400, payload);
}

export async function routes(req, res, url, body, h) {
  const p = url.pathname.replace(/^\/api\/community/, "") || "/";
  const method = req.method;
  const actor = actorOf(h);

  if (method === "GET" && (p === "" || p === "/")) {
    const requested = url.searchParams.get("channel") || "general";
    const channel = Chat.CHAT_IDS.has(requested) ? requested : "general";
    const lite = url.searchParams.get("lite") === "1";
    await retryUnsent(h, actor);
    const link = await mergeRemote(h, channel);
    const room = loadRoom(h);
    const news = lite ? null : await refreshNews(h, actor);
    const list = loadList(h);
    return h.json(res, 200, {
      sync: { online: link.online, at: link.at, ...sharingMode(h) },
      channels: Chat.CHANNELS,
      conduct: Chat.CONDUCT,
      joined: !!actor.email,
      owner: actor.owner,
      needsLicence: !identityEmail(),
      needsSignIn: !identityEmail(),
      username: actor.username || Account.usernameOf(),
      profile: (actor.username || Account.usernameOf()) ? { username: actor.username || Account.usernameOf(), displayName: actor.username || Account.usernameOf() } : null,
      suggestion: actor.username ? "" : Chat.suggestUsername(takenNames(h)),
      cooldownUntil: actor.cooldownUntil || 0,
      channel,
      messages: actor.email ? Chat.listMessages(room, channel, actor) : [],
      reports: actor.owner ? room.reports.map((item) => ({ id: item.id, messageId: item.messageId, reason: item.reason, at: item.at })) : [],
      news: news || undefined,
      newsletter: clientList(list),
      limits: { burst: Chat.BURST_MAX, burstMs: Chat.BURST_MS },
    });
  }

  if (method === "POST" && (p === "/join" || p === "/username")) {
    const saved = await saveUsername(h, body?.username || body?.displayName);
    if (!saved.ok) return reply(h, res, saved);
    return h.json(res, 200, { ok: true, username: saved.username, cooldownUntil: saved.cooldownUntil || 0 });
  }

  if (method === "POST" && (p === "/messages" || p === "/share")) {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const input = p === "/share"
      ? { channel: body?.channel, share: body }
      : { channel: body?.channel, body: body?.body, share: body?.share };
    const posted = Chat.postMessage(loadRoom(h), who.actor, input);
    if (!posted.ok) return reply(h, res, posted);
    const sync = await syncPost(posted.message, rawLicenceKey(h), h);
    if (sync.delivered && sync.cloudId) posted.message.id = sync.cloudId; // same id as the shared copy, so a refresh never shows it twice
    if (!sync.delivered) {
      posted.message.unsent = sync.retry ? "retry" : "local";
      if (sync.reason) posted.message.unsentReason = sync.reason;
    }
    saveRoom(h, posted.room);
    return h.json(res, 200, { ok: true, delivered: sync.delivered, note: sync.delivered ? "" : sync.reason, message: Chat.publicMessage(posted.message, posted.room, who.actor) });
  }

  const parts = p.split("/").filter(Boolean);
  if (parts[0] === "messages" && parts[1] && method === "POST" && parts[2] === "report") {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const reported = Chat.reportMessage(loadRoom(h), who.actor, decodeURIComponent(parts[1]), body?.reason);
    if (!reported.ok) return reply(h, res, reported);
    saveRoom(h, reported.room);
    return h.json(res, 200, { ok: true });
  }
  if (parts[0] === "messages" && parts[1] && method === "POST" && parts[2] === "vote") {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const voted = Chat.castPromptVote(loadRoom(h), who.actor, decodeURIComponent(parts[1]), body?.vote);
    if (!voted.ok) return reply(h, res, voted);
    saveRoom(h, voted.room);
    const library = await libraryVote(h, voted.room, who.actor, voted.promptId);
    return h.json(res, 200, { ok: true, promptId: voted.promptId, ...library });
  }
  if (parts[0] === "messages" && parts[1] && method === "DELETE") {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const removed = Chat.deleteMessage(loadRoom(h), who.actor, decodeURIComponent(parts[1]));
    if (!removed.ok) return reply(h, res, removed);
    saveRoom(h, removed.room);
    return h.json(res, 200, { ok: true });
  }
  if (method === "POST" && p === "/mute") {
    const muted = Chat.mutePerson(loadRoom(h), actor, body?.username || body?.displayName, body?.minutes, Date.now(), takenNames(h));
    if (!muted.ok) return reply(h, res, muted);
    saveRoom(h, muted.room);
    return h.json(res, 200, { ok: true, until: muted.until });
  }

  if (method === "GET" && p === "/news") return h.json(res, 200, await refreshNews(h, actor, { force: url.searchParams.get("fresh") === "1" }));

  // Unread chat per channel for the Community menu badge. The page sends what it last saw as since=general:<ms>,help:<ms>.
  if (method === "GET" && p === "/unread") {
    const since = {};
    for (const part of String(url.searchParams.get("since") || "").split(",")) {
      const [id, at] = part.split(":");
      if (Chat.CHAT_IDS.has(id) && Number(at) > 0) since[id] = Number(at);
    }
    if (!actor.email) return h.json(res, 200, { channels: {}, total: 0, news: false });
    const link = await Promise.all([...Chat.CHAT_IDS].map((id) => mergeRemote(h, id)));
    const room = loadRoom(h);
    const channels = {};
    let total = 0;
    for (const id of Chat.CHAT_IDS) {
      const from = since[id];
      const n = from ? room.messages.filter((m) => m.channel === id && !m.deleted && !m.email && Number(m.createdAt) > from).length : 0;
      channels[id] = n;
      total += n;
    }
    const news = await refreshNews(h, actor);
    return h.json(res, 200, { channels, total, news: !!news.unread, online: link.some((l) => l.online), now: Date.now() });
  }

  if (method === "POST" && p === "/news/draft") {
    if (!actor.owner) return h.json(res, 403, { error: "Only the owner can build a draft." });
    let whatsNew = {};
    try { whatsNew = readChangelog(); } catch { whatsNew = {}; }
    const room = loadRoom(h);
    const ranked = await Votes.rankPromptRows(Chat.topPromptRows(room));
    const issue = News.buildIssue({
      week: body?.week,
      sources: Array.isArray(body?.sources) ? body.sources : [],
      whatsNew,
      prompts: ranked,
      highlights: Chat.highlightRows(room),
    });
    const news = loadNews(h);
    news.draft = issue;
    saveNews(h, news);
    const key = rawLicenceKey(h);
    const pushed = await Cloud.pushDraft(issue, key);
    return h.json(res, 200, { ok: true, draft: issue, synced: !pushed.offline && pushed.body?.ok !== false });
  }

  if (method === "POST" && p === "/news/publish") {
    if (!actor.owner) return h.json(res, 403, { error: "Only the owner can publish AI News." });
    const news = loadNews(h);
    if (!news.draft || (body?.id && news.draft.id !== body.id)) return h.json(res, 404, { error: "There is no draft to publish." });
    const published = { ...news.draft, status: "published", publishedAt: new Date().toISOString() };
    news.published = published;
    news.draft = null;
    saveNews(h, news);
    const key = rawLicenceKey(h);
    const pushed = await Cloud.pushNews(published, key);
    const synced = !pushed.offline && pushed.body?.ok !== false;
    return h.json(res, 200, { ok: true, issue: published, synced, unread: News.isUnread(news) });
  }

  if (method === "POST" && p === "/news/seen") {
    const news = loadNews(h);
    if (!news.published || news.published.id !== body?.id) return h.json(res, 404, { error: "That issue is not published." });
    news.seen = news.published.id;
    saveNews(h, news);
    return h.json(res, 200, { ok: true, unread: false });
  }

  if (method === "POST" && p === "/news/react") {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const reacted = News.reactToItem(loadNews(h), who.actor, { issueId: body?.issueId, itemId: body?.itemId, reaction: body?.reaction });
    if (!reacted.ok) return reply(h, res, reacted);
    saveNews(h, reacted.news);
    const key = rawLicenceKey(h);
    if (key) {
      await Cloud.pushReaction({
        p_key: key,
        p_issue: body?.issueId,
        p_item: body?.itemId,
        p_reaction: body?.reaction === "clear" ? "" : body?.reaction,
      });
    }
    return h.json(res, 200, { ok: true, ...reacted.counts });
  }

  if (method === "POST" && p === "/news/comment") {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const commented = News.addComment(loadNews(h), who.actor, { issueId: body?.issueId, itemId: body?.itemId, body: body?.body });
    if (!commented.ok) return reply(h, res, commented);
    saveNews(h, commented.news);
    return h.json(res, 200, { ok: true, comment: commented.comment });
  }

  if (method === "POST" && p === "/news/share") {
    const who = needActor(h);
    if (who.error) return h.json(res, who.status, { error: who.error });
    const news = loadNews(h);
    const item = News.findIssueItem(news.published, body?.itemId);
    if (!news.published || news.published.id !== body?.issueId || !item) return h.json(res, 404, { error: "That item is not in the published issue." });
    const posted = Chat.postMessage(loadRoom(h), who.actor, {
      channel: body?.channel || "general",
      share: {
        kind: "news",
        id: item.id,
        title: item.title,
        text: item.summary || item.excerpt || "",
        sourceUrl: item.sourceUrl || "",
      },
    });
    if (!posted.ok) return reply(h, res, posted);
    const sync = await syncPost(posted.message, rawLicenceKey(h), h);
    if (sync.delivered && sync.cloudId) posted.message.id = sync.cloudId; // same id as the shared copy, so a refresh never shows it twice
    if (!sync.delivered) {
      posted.message.unsent = sync.retry ? "retry" : "local";
      if (sync.reason) posted.message.unsentReason = sync.reason;
    }
    saveRoom(h, posted.room);
    return h.json(res, 200, { ok: true, delivered: sync.delivered, note: sync.delivered ? "" : sync.reason, message: Chat.publicMessage(posted.message, posted.room, who.actor) });
  }

  if (method === "GET" && p === "/newsletter") return h.json(res, 200, clientList(loadList(h), { token: true }));

  if (method === "POST" && p === "/newsletter") {
    const optedIn = body?.optedIn === true;
    const current = loadList(h);
    const email = licenceEmail() || null;
    const token = current.token || crypto.randomBytes(18).toString("base64url");
    const row = { optedIn, email, token, pending: optedIn && !email, updatedAt: Date.now() };
    saveList(h, row);
    let synced = false;
    const key = rawLicenceKey(h);
    if (email && key) {
      const pushed = await Cloud.pushNewsletter({ p_key: key, p_email: email, p_opted_in: optedIn, p_token: token });
      synced = !pushed.offline && pushed.body?.ok !== false;
    }
    return h.json(res, 200, {
      optedIn: row.optedIn,
      pending: row.pending,
      synced,
      note: row.pending
        ? "Saved on this computer. It will use the email on your licence once that email is on file. Nothing is sent."
        : (optedIn ? "You are on the list. Nothing is sent from this app." : "You are off the list."),
    });
  }

  if (method === "POST" && p === "/newsletter/unsubscribe") {
    const token = String(body?.token || "");
    const current = loadList(h);
    if (!token || token !== current.token) return h.json(res, 200, { ok: true, optedIn: current.optedIn });
    const row = { ...current, optedIn: false, pending: false, updatedAt: Date.now() };
    saveList(h, row);
    await Cloud.pushUnsubscribe(token);
    return h.json(res, 200, { ok: true, optedIn: false });
  }

  if (method === "POST" && p === "/newsletter/preview") {
    const news = loadNews(h);
    const issue = news.published;
    // 200 with a plain note, not a 404: "no issue yet" is a normal state, not an error.
    if (!issue) return h.json(res, 200, { ok: true, sent: false, empty: true, note: "There is no published issue yet, so there is no email copy to write. A new one is published each week.", html: "", text: "" });
    const list = loadList(h);
    const token = list.token || "preview";
    const mail = News.renderEmail(issue, { unsubscribeUrl: `${News.UNSUBSCRIBE_BASE}?token=${encodeURIComponent(token)}` });
    return h.json(res, 200, { ok: true, sent: false, html: mail.html, text: mail.text });
  }

  return false;
}
