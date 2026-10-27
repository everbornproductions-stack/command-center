// A built-in local "save to MindMedia" step for the mission planner (0.4.21, dogfood 10).
// MindMedia is the library on this computer. A step that says "save it to my MindMedia / my library" is never an
// agent step (Grok Bot or the browser helper would invent a signed-in account); it is done here, with no network.
// The caption, the hashtags and the picture are kept as ONE post item (Draft), and the answer says exactly where.
// Pure helpers plus one function that writes through project-media.js. Never prints a key, never touches data/ by hand.
import path from "node:path";
import { saveToMindMedia } from "./project-media.js";

const MM = /\bmind\s?-?media\b/i;
const LIB = /\b(my|the|our)\s+(media\s+)?library\b/i;
const SAVE = /\b(save|saves|saving|keep|store|file|add|put|publish|post)\b/i;
const OUTSIDE = /\b(instagram|facebook|linkedin|twitter|tiktok|youtube|pinterest|x\.com|threads|bluesky|mastodon)\b/i;

/** True when a planned step is "put this in MindMedia / my library". Never true for a step that posts to an outside site only. */
export function isLocalSaveStep(t = {}) {
  if (t.capability === "save" || t.capability === "mindmedia") return true;
  const text = `${t.title || ""} ${t.instructions || ""}`;
  if (!(MM.test(text) || LIB.test(text))) return false;
  if (!SAVE.test(text)) return false;
  // "post it to Instagram and also keep it in MindMedia" still has an outside step of its own; the planner makes that a separate step
  return !(OUTSIDE.test(text) && !/\bonly\b|\bnot\b|\bno outside\b/i.test(text) && !MM.test(t.title || ""));
}

/** Planner text: the one way to say "save to MindMedia". */
export const SAVE_LINE = `\nA step that only keeps the finished result in the user's MindMedia library on this computer (or "my library") gets capability "save" and no agent. It is done by Meldmind itself with no browser and no account, so never plan a signed-in MindMedia account. Put it after the steps that make the text and the picture (deps).`;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
const HELPER_LINE = /^\W*(?:\*\*)?\s*(?:word\s*count|character\s*count|characters?|words?)\s*(?:\*\*)?\s*[:=]\s*\d+.*$/gim;
const NOTE_LINE = /^[^\n]*\b(?:no search results were cited|no sources were (?:cited|used)|search results (?:were|was) not (?:used|cited))\b[^\n]*$/gim;

/** Helper notes the AI adds around a deliverable ("Word count: 70", "No search results were cited"). */
export function stripHelperNotes(text) {
  let t = String(text ?? "").replace(/\r\n/g, "\n");
  t = t.replace(HELPER_LINE, "").replace(NOTE_LINE, "");
  t = t.replace(/\(\s*(?:word\s*count|\d+\s*words?)\s*:?\s*\d*\s*\)/gi, "");
  return t.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** Split a writer's answer into the caption words and the hashtags (in the order they came). */
export function splitPost(text, { keepEmoji = false } = {}) {
  let t = stripHelperNotes(text);
  t = t.replace(/^\s*#{1,6}\s*(?:caption|post)\s*:?\s*$/gim, "").replace(/^\s*(?:\*\*)?(?:caption|post text)(?:\*\*)?\s*:\s*/gim, "");
  const tags = [];
  for (const m of t.matchAll(/(^|[\s(])#([A-Za-z][A-Za-z0-9_]{0,48})\b/g)) {
    const h = `#${m[2]}`;
    if (!tags.some((x) => x.toLowerCase() === h.toLowerCase())) tags.push(h);
  }
  let caption = t.replace(/(^|[\s(])#[A-Za-z][A-Za-z0-9_]{0,48}\b/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/^\s*[-*]\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!keepEmoji) caption = caption.replace(EMOJI, "").replace(/[ \t]+([.,!?;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  return { caption, hashtags: tags.slice(0, 30) };
}

/**
 * Save one post: the picture (when a real one exists), the caption and the hashtags, as ONE MindMedia item.
 * `image` is { name, path } of a real file made by an image step; a placeholder or a missing picture is left out and said so.
 * Returns { ok, text, saved, link, where } where `text` is the plain line the step shows (what was saved and where).
 */
export function savePost({ projectId, missionId = "", title = "", caption = "", hashtags = [], image = null, imageNote = "", source = "Meldmind mission" } = {}) {
  const name = String(title || "").replace(/\s+/g, " ").trim().slice(0, 100) || "Post";
  const cap = String(caption || "").trim();
  const tags = (hashtags || []).filter(Boolean);
  if (!cap && !image) return { ok: false, error: "Nothing to save yet: no caption and no picture came from the earlier steps.", text: "Not saved to MindMedia: no caption and no picture came from the earlier steps." };
  try {
    const out = saveToMindMedia({
      projectId, source, status: "Draft", name,
      post: { caption: cap, hashtags: tags, imageMissing: !image, note: imageNote || "" },
      files: image ? [{ name: image.name || path.basename(image.path), path: image.path, mime: image.mime }] : [],
      text: image ? undefined : [cap, tags.join(" ")].filter(Boolean).join("\n\n"),
      tags: tags.map((h) => h.replace(/^#/, "")),
      dedupeKey: missionId ? `post:${missionId}` : undefined,
    });
    const item = out.items?.[0];
    const parts = [image ? "picture" : null, cap ? "caption" : null, tags.length ? `${tags.length} hashtag${tags.length === 1 ? "" : "s"}` : null].filter(Boolean);
    const lines = [`Saved to MindMedia as one post (Draft): ${item?.name || name}. It holds the ${parts.join(", ")}.`, `${out.savedWhere} Open it from Create > MindMedia.`];
    if (!image) lines.push(imageNote || "No picture was made, so this post has the caption only.");
    return { ok: true, saved: item || null, link: out.link, where: out.where, text: lines.join(" ") };
  } catch (e) {
    return { ok: false, error: e.message, text: `Not saved to MindMedia: ${String(e.message || "unknown error").slice(0, 160)}` };
  }
}
