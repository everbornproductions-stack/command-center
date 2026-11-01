#!/usr/bin/env node
// Make next week's prompt pack: server/prompts/packs/week-YYYY-wNN.json.
//
//   node tools/new-week-pack.mjs --week 2026-W46 --in prompts.json
//   node tools/new-week-pack.mjs --next --in prompts.txt        (the week after the newest week pack)
//   add --check to validate only, --force to replace an existing pack file.
//
// Input is a list of prompts. JSON: [{ "title", "text", "category", "note"?, "industry"?, "source_name"?, "source_url"? }]
// ("prompt" works in place of "text"). Text: one prompt per line, "Title | category | text"; the category may be
// left empty ("Title | | text") and is then worked out from the words. Lines starting with # are skipped.
//
// The pack goes live on the Monday of its week. Until then it stays hidden, so it is fine to add it early.
// See docs/PROMPT-PACKS.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PACK_CATEGORIES, PACK_DIR, nearDuplicateTitle, normalizePackRow, safeSourceUrl } from "../server/prompts/packs.js";
import { inferCategory, weekRank } from "../server/prompts/whatsnew.js";

export const MIN_PROMPTS = 1;
export const MAX_PROMPTS = 30;
const DASH = /[‒–—―]/;
// Nothing in a pack may promise a result.
const PROMISE = /\b(guarantee[ds]?|guaranteed|100%|risk[- ]free|double your|triple your|overnight|go viral|instant results|get rich)\b/i;

export function weekFile(week, dir = PACK_DIR) {
  const m = String(week).match(/^(\d{4})-W(\d{2})$/);
  return path.join(dir, `week-${m[1]}-w${m[2]}.json`);
}

export function checkWeek(week) {
  const m = String(week || "").match(/^(\d{4})-W(\d{2})$/);
  if (!m) return "The week must look like 2026-W46.";
  const n = Number(m[2]);
  if (n < 1 || n > 53) return "The week number must be 1 to 53.";
  return "";
}

// The ISO week after the given one.
export function nextWeek(week) {
  const m = String(week).match(/^(\d{4})-W(\d{2})$/);
  const year = Number(m[1]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (Number(m[2]) - 1) * 7 + 7);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const y = thursday.getUTCFullYear();
  const w = Math.ceil(((thursday.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

export function newestWeekPack(dir = PACK_DIR) {
  const weeks = fs.existsSync(dir)
    ? fs.readdirSync(dir).map((f) => f.match(/^week-(\d{4})-w(\d{2})\.json$/)).filter(Boolean).map((m) => `${m[1]}-W${m[2]}`)
    : [];
  return weeks.sort((a, b) => weekRank(b) - weekRank(a))[0] || "";
}

export function parseInput(text, name = "input.json") {
  const raw = String(text || "").replace(/^﻿/, "");
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(raw)) {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.prompts) ? parsed.prompts : [parsed];
  }
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
    const [title = "", category = "", ...rest] = line.split("|").map((part) => part.trim());
    return { title, category, text: rest.join(" | ") };
  });
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "prompt";
}

// Returns { rows, errors }. rows are ready to write; errors are plain sentences, one per problem.
export function buildWeekPack(items, week) {
  const errors = [];
  const weekError = checkWeek(week);
  if (weekError) return { rows: [], errors: [weekError] };
  const list = Array.isArray(items) ? items : [];
  if (list.length < MIN_PROMPTS) errors.push("Add at least one prompt.");
  if (list.length > MAX_PROMPTS) errors.push(`A pack holds at most ${MAX_PROMPTS} prompts. 10 to 15 is a good size.`);
  const [year, num] = week.split("-W");
  const rows = [];
  const ids = new Set();
  list.forEach((item, i) => {
    const where = `Prompt ${i + 1}${item?.title ? ` ("${String(item.title).trim()}")` : ""}`;
    if (!item || typeof item !== "object") { errors.push(`${where}: not a prompt.`); return; }
    const title = String(item.title || "").trim();
    const text = String(item.text ?? item.prompt ?? "").trim();
    const note = String(item.note ?? item.popularity_note ?? "").trim();
    const givenCat = String(item.category || "").trim();
    let category = "";
    if (givenCat) {
      category = PACK_CATEGORIES.find((c) => c.toLowerCase() === givenCat.toLowerCase()) || "";
      if (!category) errors.push(`${where}: "${givenCat}" is not a category. Use one of: ${PACK_CATEGORIES.join(", ")}. Or leave it empty to work it out from the words.`);
    } else {
      category = inferCategory({ title, prompt: text });
    }
    if (title.length < 3 || title.length > 80) errors.push(`${where}: the title needs 3 to 80 characters.`);
    if (text.length < 20 || text.length > 1500) errors.push(`${where}: the text needs 20 to 1500 characters.`);
    if (category !== "builders" && !/\[[^\]\n]{1,80}\]/.test(text)) errors.push(`${where}: the text needs at least one blank in square brackets, like [topic].`);
    for (const [label, value] of [["title", title], ["text", text], ["note", note]]) {
      if (DASH.test(value)) errors.push(`${where}: the ${label} has a long dash. Use a comma or a period.`);
      if (PROMISE.test(value)) errors.push(`${where}: the ${label} promises a result. Take that out.`);
    }
    if (item.source_url && !safeSourceUrl(item.source_url)) errors.push(`${where}: the source link must start with https://.`);
    if (rows.some((other) => nearDuplicateTitle(other.title, title))) errors.push(`${where}: the title repeats another prompt in this pack.`);
    let id = `week-${year}-w${num}-${slug(title)}`;
    for (let n = 2; ids.has(id); n++) id = `week-${year}-w${num}-${slug(title)}-${n}`;
    ids.add(id);
    const row = {
      id,
      title,
      category,
      industry: String(item.industry || "any").trim(),
      prompt: text,
      source_name: String(item.source_name || "Meldmind").trim(),
      source_url: safeSourceUrl(item.source_url),
      popularity_note: note,
      added_week: week,
    };
    if (category && !normalizePackRow(row)) errors.push(`${where}: the app would not load this prompt. Check the title, text and category.`);
    rows.push(row);
  });
  return { rows, errors };
}

export function parseArgs(argv) {
  const out = { week: "", input: "", next: false, check: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--week") out.week = String(argv[++i] || "").toUpperCase().replace(/^(\d{4})-?W?(\d{1,2})$/, (_, y, w) => `${y}-W${w.padStart(2, "0")}`);
    else if (a === "--in") out.input = String(argv[++i] || "");
    else if (a === "--next") out.next = true;
    else if (a === "--check") out.check = true;
    else if (a === "--force") out.force = true;
  }
  return out;
}

export function run(argv, { dir = PACK_DIR, log = console.log, fail = console.error } = {}) {
  const args = parseArgs(argv);
  if (!args.input) { fail("Pass --in <file> with the prompts, and --week 2026-W46 or --next."); return 2; }
  let week = args.week;
  if (!week && args.next) {
    const newest = newestWeekPack(dir);
    if (!newest) { fail("No week pack exists yet. Pass --week."); return 2; }
    week = nextWeek(newest);
  }
  if (!week) { fail("Pass --week 2026-W46 or --next."); return 2; }
  let items;
  try { items = parseInput(fs.readFileSync(args.input, "utf8"), args.input); }
  catch (e) { fail(`Could not read ${args.input}: ${e.message}`); return 2; }
  const { rows, errors } = buildWeekPack(items, week);
  if (errors.length) { fail(`The ${week} pack has ${errors.length} problem(s):\n- ${errors.join("\n- ")}`); return 1; }
  const file = weekFile(week, dir);
  if (args.check) { log(`OK: ${rows.length} prompts for ${week}. Nothing written.`); return 0; }
  if (fs.existsSync(file) && !args.force) { fail(`${path.basename(file)} already exists. Pass --force to replace it.`); return 1; }
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + "\n", "utf8");
  log(`Wrote ${rows.length} prompts to ${path.relative(process.cwd(), file) || file}. It goes live on the Monday of ${week}.`);
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  process.exitCode = run(process.argv.slice(2));
}
