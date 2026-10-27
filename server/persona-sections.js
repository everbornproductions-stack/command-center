// Persona sections and peer review (slice C6, flag personasections). A person can share a project
// TEMPLATE to a persona section so people like them can leave a review. Privacy rules:
//  - Sharing is a choice made for each item. Nothing is saved for sending without a preview and a confirm.
//  - Only an allow-list of template fields can leave: the name, a short note, the project type, step
//    titles, the kind of AI work, how hard it is, and the persona tags. Ideas, answers, instructions,
//    results, folder names and file names never leave.
//  - Every kept text is scrubbed: keys, emails, web addresses, phone numbers, file names, paths, long numbers.
//  - The preview shows exactly the payload that is saved. The confirm carries its hash, and the payload
//    is rebuilt on the server and refused if it no longer matches the preview.
//  - Nothing leaves this PC from here. The shared item waits in a local outbox until the community server
//    is switched on (it needs legal sign-off first). An item can be withdrawn at any time.
import crypto from "node:crypto";
import { hasSecret, redact } from "./redact-text.js";

export const DOC = "persona.sections";
export const MAX_OUTBOX = 50;
export const MAX_CUSTOM = 8;

export const SECTIONS = [
  { id: "youtuber", name: "YouTuber" },
  { id: "marketer", name: "Marketer" },
  { id: "web-designer", name: "Web Designer" },
  { id: "photographer", name: "Photographer" },
  { id: "game-designer", name: "Game Designer" },
  { id: "automations", name: "Automations" },
  { id: "influencer", name: "Influencer" },
  { id: "real-estate", name: "Real Estate" },
  { id: "business-owner", name: "Business Owner" },
  { id: "ai-expert", name: "AI Expert" },
  { id: "for-fun", name: "For Fun" },
];

export const NEVER_SHARED = [
  "Your idea and your answers",
  "Step instructions and results",
  "File names, folder names and file contents",
  "Keys, passwords, emails, phone numbers and web addresses",
  "Your name, account and anything from your chats",
];

const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const flat = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const PROFANITY = /\b(fuck|shit|bitch|asshole|bastard|cunt|dickhead)\b/i;

// A text after the privacy scrub. changed lists what was taken out.
export function scrubText(input, max = 120) {
  let t = flat(input);
  const changed = [];
  const swap = (re, label) => {
    if (new RegExp(re.source, re.flags.replace("g", "")).test(t)) { changed.push(label); t = t.replace(re, "[removed]"); }
  };
  if (hasSecret(t)) { changed.push("key"); t = redact(t, 100000).replace(/\[hidden\]/g, "[removed]"); }
  swap(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "email");
  swap(/\b(?:https?:\/\/|www\.)\S+/gi, "web address");
  swap(/\b[A-Za-z0-9-]+\.(?:com|net|org|io|co|us|ai|app|dev|me|biz|info)\b(?:\/\S*)?/gi, "web address");
  swap(/(?:[A-Za-z]:\\|\\\\|~\/|\/(?:Users|home|var|etc|mnt|tmp)\/)\S*/g, "path");
  swap(/\b[\w-]+(?: [\w-]+)?\.(?:png|jpe?g|gif|webp|svg|mp4|mov|avi|mp3|wav|pdf|docx?|xlsx?|csv|pptx?|zip|txt|json|js|html?|psd|env|key|pem)\b/gi, "file name");
  swap(/\+?\d[\d\s().-]{8,}\d/g, "number");
  swap(/\b\d{6,}\b/g, "number");
  swap(/(^|\s)@[A-Za-z0-9_.]{2,}/g, "handle");
  t = t.replace(/(?:\[removed\]\s*){2,}/g, "[removed] ").trim();
  t = redact(t, max);
  return { text: t, changed: [...new Set(changed)] };
}

const CAPS = new Set(["text", "code", "image", "video", "audio", "research", "design", "data", "plan", "other"]);
const DIFF = new Set(["easy", "medium", "hard"]);
const slug = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

export function sectionList(state = {}) {
  const hidden = new Set(state.hidden || []);
  const base = SECTIONS.map((s) => ({ ...s, custom: false, status: "active", hidden: hidden.has(s.id) }));
  const extra = (state.custom || []).map((s) => ({ id: s.id, name: s.name, custom: true, status: s.status || "pending", hidden: hidden.has(s.id) }));
  return [...base, ...extra];
}
export function sectionById(state, id) {
  return sectionList(state).find((s) => s.id === id) || null;
}

export function hashOf(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

// The only thing that can leave the PC for one template and one section.
export function buildPayload(tpl, section) {
  const changed = [];
  const take = (v, max, label) => {
    const r = scrubText(v, max);
    for (const c of r.changed) changed.push(`${label}: ${c}`);
    return r.text;
  };
  const name = take(tpl?.name, 60, "Name");
  const note = take(tpl?.note, 200, "Note");
  const steps = (Array.isArray(tpl?.steps) ? tpl.steps : []).slice(0, 12).map((s, i) => ({
    title: take(s?.title, 80, `Step ${i + 1}`),
    kind: CAPS.has(String(s?.capability)) ? String(s.capability) : "other",
    level: DIFF.has(String(s?.difficulty)) ? String(s.difficulty) : "medium",
  })).filter((s) => s.title && s.title !== "[removed]");
  const personas = [...new Set((Array.isArray(tpl?.personas) ? tpl.personas : []).map(slug).filter(Boolean))].slice(0, 6);
  const payload = {
    kind: "persona-template",
    section: section.id,
    sectionName: section.name,
    name,
    type: slug(tpl?.type) || "other",
    note,
    steps,
    personas,
  };
  if (!payload.name || payload.name === "[removed]") throw err(400, "The template name has nothing safe to share. Give it a plain name first.", "empty_name");
  const blob = JSON.stringify(payload);
  if (hasSecret(blob)) throw err(400, "That template still looks like it holds a key. Take it out first.", "secret");
  if (PROFANITY.test(blob)) throw err(400, "Please clean up the wording before sharing.", "wording");
  return { payload, changed, hash: hashOf(payload) };
}

export function load(h) {
  const d = h.doc(DOC, () => ({ hidden: [], custom: [], targets: [], outbox: [], reviews: [] }));
  for (const k of ["hidden", "custom", "targets", "outbox", "reviews"]) if (!Array.isArray(d[k])) d[k] = [];
  return d;
}
const save = (h, d) => h.putDoc(DOC, d);

export function view(h, owner = false) {
  const d = load(h);
  const sections = sectionList(d);
  return {
    sections,
    targets: d.targets.filter((id) => sections.some((s) => s.id === id && s.status === "active" && !s.hidden)),
    outbox: d.outbox.map((o) => ({ id: o.id, at: o.at, status: o.status, section: o.payload.section, sectionName: o.payload.sectionName, name: o.payload.name })),
    reviews: d.reviews.slice(0, 30),
    owner: !!owner,
    never: NEVER_SHARED,
    note: "Nothing leaves this PC from here. Shared items wait in your outbox until the community server is switched on.",
  };
}

export function addSection(h, name, owner = false) {
  const d = load(h);
  const scrub = scrubText(name, 30);
  const nm = scrub.text;
  if (nm.length < 3 || scrub.changed.length || /\[removed\]/.test(nm)) throw err(400, "Use a plain name for the section, at least 3 letters.", "bad_name");
  if (PROFANITY.test(nm)) throw err(400, "Please pick a different name.", "bad_name");
  const id = "c-" + (slug(nm.toLowerCase().replace(/\s+/g, "-")) || "section");
  if (sectionList(d).some((s) => s.id === id || s.name.toLowerCase() === nm.toLowerCase())) throw err(409, "That section already exists.", "exists");
  if (d.custom.length >= MAX_CUSTOM) throw err(409, `You can add up to ${MAX_CUSTOM} sections.`, "limit");
  d.custom.push({ id, name: nm, status: owner ? "active" : "pending", at: Date.now() });
  save(h, d);
  return sectionById(d, id);
}
export function approveSection(h, id, owner) {
  if (!owner) throw err(403, "Only the owner can approve a new section.", "owner_only");
  const d = load(h);
  const s = d.custom.find((x) => x.id === id);
  if (!s) throw err(404, "Section not found.", "not_found");
  s.status = "active";
  save(h, d);
  return sectionById(d, id);
}
export function removeSection(h, id) {
  const d = load(h);
  const i = d.custom.findIndex((x) => x.id === id);
  if (i < 0) throw err(404, "Only sections you added can be removed. Hide the others.", "not_found");
  d.custom.splice(i, 1);
  d.hidden = d.hidden.filter((x) => x !== id);
  d.targets = d.targets.filter((x) => x !== id);
  save(h, d);
  return { ok: true, id };
}
export function setHidden(h, id, hidden) {
  const d = load(h);
  if (!sectionById(d, id)) throw err(404, "Section not found.", "not_found");
  d.hidden = d.hidden.filter((x) => x !== id);
  if (hidden) { d.hidden.push(id); d.targets = d.targets.filter((x) => x !== id); }
  save(h, d);
  return { ok: true, id, hidden: !!hidden };
}
export function setTargets(h, ids) {
  const d = load(h);
  const ok = (Array.isArray(ids) ? ids : []).map(String).filter((id) => { const s = sectionById(d, id); return s && s.status === "active" && !s.hidden; });
  d.targets = [...new Set(ok)];
  save(h, d);
  return { targets: d.targets };
}

// Step one: show exactly what would leave. Nothing is saved.
export function preview(h, tpl, sectionId) {
  const d = load(h);
  const s = sectionById(d, sectionId);
  if (!s || s.status !== "active" || s.hidden) throw err(400, "Pick a section that is open.", "bad_section");
  if (!tpl) throw err(404, "Template not found.", "not_found");
  const { payload, changed, hash } = buildPayload(tpl, s);
  return { payload, hash, cleaned: changed, never: NEVER_SHARED, section: { id: s.id, name: s.name } };
}

// Step two: the person confirmed this exact preview. The payload is rebuilt and must match the hash.
export function share(h, tpl, sectionId, hash, confirm) {
  if (confirm !== true) throw err(400, "Confirm the preview first. Nothing is shared without it.", "confirm_needed");
  const p = preview(h, tpl, sectionId);
  if (!hash || hash !== p.hash) throw err(409, "The template changed since the preview. Look at the preview again.", "changed");
  const d = load(h);
  if (d.outbox.length >= MAX_OUTBOX) throw err(409, `Your outbox holds ${MAX_OUTBOX} items. Withdraw some first.`, "limit");
  const item = { id: "ps-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), status: "waiting", payload: p.payload };
  d.outbox.unshift(item);
  save(h, d);
  return { ok: true, id: item.id, status: item.status, note: "Saved in your outbox on this PC. It is sent only when the community server is on." };
}
export function withdraw(h, id) {
  const d = load(h);
  const i = d.outbox.findIndex((o) => o.id === id);
  if (i < 0) throw err(404, "Not found.", "not_found");
  d.outbox.splice(i, 1);
  save(h, d);
  return { ok: true, id };
}

// A structured peer review of a shared template (used when the community server hands reviews back).
export function cleanReview(input) {
  const rating = Math.round(Number(input?.rating));
  if (!(rating >= 1 && rating <= 5)) throw err(400, "Rating is 1 to 5.", "bad_rating");
  const out = { rating };
  for (const [k, max] of [["liked", 300], ["fix", 300]]) out[k] = scrubText(input?.[k], max).text;
  if (PROFANITY.test(out.liked + " " + out.fix)) throw err(400, "Please keep reviews kind and clean.", "wording");
  if (!out.liked && !out.fix) throw err(400, "Say what worked or what to fix.", "empty");
  return out;
}
export function addReview(h, itemId, input) {
  const d = load(h);
  const o = d.outbox.find((x) => x.id === itemId);
  if (!o) throw err(404, "Not found.", "not_found");
  const r = { id: "rv-" + Date.now().toString(36), itemId, name: o.payload.name, at: Date.now(), ...cleanReview(input) };
  d.reviews.unshift(r);
  d.reviews = d.reviews.slice(0, 100);
  save(h, d);
  return r;
}
