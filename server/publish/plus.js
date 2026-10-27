// Publish plus (slice C4, flag publish): caption and hashtag variations, a content calendar, and the
// approval check that every calendar send must pass. Nothing here posts, sends or schedules by itself.
// The calendar is a plan. A post leaves only through /api/publish/post after a preview and a click, and a
// calendar item must also have been approved by hand for the exact text, picture link, time and accounts.
import crypto from "node:crypto";

export const CAL = "publish.calendar";
export const CHANNELS = ["instagram", "ghl", "slack"];
export const LIMITS = {
  instagram: { name: "Instagram", max: 2200, tags: 30, goodTags: 8, times: ["Tue 11:00", "Wed 11:00", "Fri 10:00"] },
  ghl: { name: "HighLevel planner", max: 2200, tags: 30, goodTags: 8, times: ["Tue 09:00", "Thu 12:00", "Sat 10:00"] },
  slack: { name: "Slack", max: 3900, tags: 0, goodTags: 0, times: ["Mon 09:00", "Wed 14:00"] },
  x: { name: "X", max: 280, tags: 3, goodTags: 2, times: ["Mon 08:00", "Wed 12:00"] },
  linkedin: { name: "LinkedIn", max: 3000, tags: 5, goodTags: 3, times: ["Tue 08:00", "Thu 10:00"] },
  facebook: { name: "Facebook", max: 2000, tags: 5, goodTags: 3, times: ["Wed 13:00", "Fri 09:00"] },
  tiktok: { name: "TikTok", max: 2200, tags: 8, goodTags: 5, times: ["Tue 19:00", "Thu 20:00"] },
};
const STOP = new Set("the a an and or but of to in on at for with from by is are was were be been it its this that these those we you your our they their i my me as if so not no yes do does did have has had will would can could should just more most very than then them what when where who how why all any each into about over out up down off again also".split(" "));

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const sentences = (t) => clean(t).split(/(?<=[.!?])\s+/).filter(Boolean);
const stripTags = (t) => String(t || "").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

function cut(text, max) {
  const t = clean(text);
  if (t.length <= max) return t;
  const room = Math.max(1, max - 3);
  const head = t.slice(0, room);
  const at = head.lastIndexOf(" ");
  return (at > room * 0.6 ? head.slice(0, at) : head).replace(/[,;:\-\s]+$/, "") + "...";
}

export function hashtagsFor(text, { limit = 8, have = [] } = {}) {
  const found = String(text || "").match(/#[\p{L}\p{N}_]+/gu) || [];
  const out = [];
  for (const t of [...found, ...have.map((x) => "#" + String(x).replace(/^#/, ""))]) if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  const counts = new Map();
  for (const w of stripTags(text).toLowerCase().match(/[\p{L}][\p{L}\p{N}]{3,}/gu) || []) if (!STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([w]) => w);
  for (const w of ranked) { if (out.length >= limit) break; const t = "#" + w; if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); }
  return out.slice(0, limit);
}

// Variations are made on this computer from the words given. No AI call, no cost, nothing is sent.
export function captionVariations({ text, platform = "instagram", tags = [] } = {}) {
  const lim = LIMITS[platform] || LIMITS.instagram;
  const base = stripTags(text);
  if (!base) return { platform, limit: lim.max, variations: [], note: "Write or paste a caption first." };
  const ss = sentences(base);
  const first = ss[0] || base, rest = ss.slice(1).join(" ");
  const topics = hashtagsFor(text, { limit: lim.goodTags, have: tags });
  const tagLine = (n) => topics.slice(0, Math.min(n, lim.tags)).join(" ");
  const make = (id, label, body, tagN) => {
    const t = tagLine(tagN);
    const room = lim.max - (t ? t.length + 2 : 0);
    const full = t ? `${cut(body, room)}\n\n${t}` : cut(body, lim.max);
    return { id, label, text: full, chars: full.length, tags: (full.match(/#[\p{L}\p{N}_]+/gu) || []).length, fits: full.length <= lim.max };
  };
  const q = /\?\s*$/.test(first) ? first : `${first.replace(/[.!]+$/, "")}?`;
  const out = [
    make("short", "Short and plain", first, Math.min(3, lim.goodTags)),
    make("full", "Full caption", base, lim.goodTags),
    make("hook", "Starts with a question", rest ? `${q} ${rest}` : q, Math.min(5, lim.goodTags)),
    make("action", "Ends with a call to action", `${base} Tell us what you think in the comments.`, Math.min(5, lim.goodTags)),
    make("clean", "No hashtags", base, 0),
  ];
  const seen = new Set();
  return { platform, platformName: lim.name, limit: lim.max, maxTags: lim.tags, times: lim.times, variations: out.filter((v) => { if (seen.has(v.text)) return false; seen.add(v.text); return true; }) };
}

// ---------- the exact thing that goes out, as a hash ----------
// Same fields and the same cleaning as buildPayload() in server/plugins/publish.js, so a hash made from a
// calendar item and a hash made from a stored preview match when the two describe the same post.
export function normalize(x) {
  const ch = x.channel;
  const when = ch === "ghl" && x.when ? Number(new Date(x.when)) || null : null;
  return {
    channel: ch,
    title: String(x.title || "Deliverable").slice(0, 120),
    text: String(x.text || "").slice(0, ch === "instagram" ? 2200 : ch === "slack" ? 3900 : 5000),
    mediaUrl: typeof x.mediaUrl === "string" && x.mediaUrl.trim() ? x.mediaUrl.trim() : null,
    when,
    accountIds: Array.isArray(x.accountIds) ? x.accountIds.map(String).slice(0, 20).sort() : [],
    channelId: typeof x.channelId === "string" && x.channelId.trim() ? x.channelId.trim().slice(0, 24) : null,
  };
}
export const hashOf = (x) => crypto.createHash("sha256").update(JSON.stringify(normalize(x))).digest("hex").slice(0, 24);

// ---------- calendar ----------
const box = (h) => h.doc(CAL, () => ({ items: [] }));
const save = (h, d) => { d.items = d.items.slice(0, 500); h.putDoc(CAL, d); };
const newId = () => "cal-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const FIELDS = ["channel", "title", "text", "mediaUrl", "when", "accountIds", "channelId", "channelName", "projectId", "note"];
const bad = (status, code, message) => Object.assign(new Error(message), { status, code });

export function view(item) {
  const hash = hashOf(item);
  return { ...item, hash, approved: !!(item.approval && item.approval.hash === hash), payload: normalize(item) };
}
export function listCalendar(h) { return box(h).items.map(view).sort((a, b) => (Number(a.when) || 9e15) - (Number(b.when) || 9e15)); }
function pickFields(body) {
  const o = {};
  for (const k of FIELDS) if (body[k] !== undefined) o[k] = body[k];
  if (o.when !== undefined) o.when = o.when ? Number(new Date(o.when)) || null : null;
  if (o.text !== undefined) o.text = String(o.text).slice(0, 5000);
  if (o.title !== undefined) o.title = String(o.title).slice(0, 120);
  if (o.channelName !== undefined) o.channelName = String(o.channelName || "").replace(/[^\w.-]/g, "").slice(0, 80);
  if (o.note !== undefined) o.note = String(o.note || "").slice(0, 300);
  return o;
}
export function addItem(h, body) {
  if (!CHANNELS.includes(body.channel)) throw bad(400, "channel", "Pick Instagram, HighLevel or Slack.");
  if (!clean(body.text)) throw bad(400, "empty", "Write the post first.");
  const d = box(h);
  const item = { id: newId(), status: "draft", approval: null, createdAt: Date.now(), ...pickFields(body) };
  d.items.unshift(item); save(h, d);
  return view(item);
}
export function updateItem(h, id, body) {
  const d = box(h), it = d.items.find((x) => x.id === id);
  if (!it) throw bad(404, "missing", "That item is not on the calendar.");
  if (it.status === "sent") throw bad(409, "sent", "That one already went out.");
  const f = pickFields(body);
  if (f.channel && !CHANNELS.includes(f.channel)) throw bad(400, "channel", "Pick Instagram, HighLevel or Slack.");
  Object.assign(it, f);
  if (it.approval && it.approval.hash !== hashOf(it)) { it.approval = null; if (it.status === "approved") it.status = "draft"; } // any edit takes the approval away
  save(h, d);
  return view(it);
}
export function removeItem(h, id) { const d = box(h), n = d.items.length; d.items = d.items.filter((x) => x.id !== id); save(h, d); return n !== d.items.length; }

// The person clicked Approve on a card that showed this exact hash. If the item changed since, refuse.
export function approveItem(h, id, { hash, confirmed }) {
  if (confirmed !== true) throw bad(400, "confirm_required", "Click Approve to allow this post.");
  const d = box(h), it = d.items.find((x) => x.id === id);
  if (!it) throw bad(404, "missing", "That item is not on the calendar.");
  if (it.status === "sent") throw bad(409, "sent", "That one already went out.");
  const now = hashOf(it);
  if (!hash || hash !== now) throw bad(409, "changed", "This post changed since you looked. Look again, then approve.");
  it.approval = { hash: now, at: Date.now() }; it.status = "approved";
  save(h, d);
  return view(it);
}
export function revokeItem(h, id) {
  const d = box(h), it = d.items.find((x) => x.id === id);
  if (!it) throw bad(404, "missing", "That item is not on the calendar.");
  it.approval = null; if (it.status === "approved") it.status = "draft";
  save(h, d); return view(it);
}

// Called by /api/publish/post when the body carries a calendarId: the stored preview payload must be the
// approved one, byte for byte.
export function checkCalendarApproval(h, calendarId, payload) {
  const it = box(h).items.find((x) => x.id === calendarId);
  if (!it) return { ok: false, status: 404, code: "missing", error: "That calendar item is gone. Nothing was sent." };
  if (it.status === "sent") return { ok: false, status: 409, code: "sent", error: "That one already went out. Nothing was sent." };
  if (!it.approval) return { ok: false, status: 409, code: "not_approved", error: "Approve this post on the calendar first. Nothing was sent." };
  if (it.approval.hash !== hashOf(it)) return { ok: false, status: 409, code: "changed", error: "This post changed after you approved it. Approve it again. Nothing was sent." };
  if (hashOf(payload) !== it.approval.hash) return { ok: false, status: 409, code: "mismatch", error: "The preview is not the approved post. Preview again from the calendar. Nothing was sent." };
  return { ok: true };
}
export function recordCalendarResult(h, calendarId, entry) {
  const d = box(h), it = d.items.find((x) => x.id === calendarId);
  if (!it) return;
  it.historyId = entry.id; it.lastTry = entry.ts;
  if (entry.status === "posted") it.status = "sent";
  else if (entry.status === "failed") { it.status = "failed"; it.error = String(entry.error || "").slice(0, 200); it.approval = null; }
  else it.status = "dry-run";
  save(h, d);
}
