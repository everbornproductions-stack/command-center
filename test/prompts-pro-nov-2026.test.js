// Nov 2026 Pro prompts: five approved prompts in server/prompts/packs/pro-2026-11.json.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PACK_DIR, PACK_CATEGORIES, normalizePackRow, readPackDir, mergePacks } from "../server/prompts/packs.js";
import { pickWhatsNew, fileIntoShelves } from "../server/prompts/whatsnew.js";

const FILE = path.join(PACK_DIR, "pro-2026-11.json");
const RAW = JSON.parse(fs.readFileSync(FILE, "utf8"));
const WANT = {
  "pro-2026-11-past-due-reminder": ["amount", "due date", "pay link", "late-fee terms"],
  "pro-2026-11-ask-for-a-review": ["review link", "client name"],
  "pro-2026-11-referral-partner-pitch": ["what they get", "what i get"],
  "pro-2026-11-life-insurance-needs-check": ["final expense", "not a quote or advice"],
  "pro-2026-11-local-weekend-roundup": ["caption", "carousel"],
};
const W44 = Date.UTC(2026, 10, 1, 12); // Sunday, 2026-W44

test("the pack has the five approved prompts, all valid", () => {
  assert.deepEqual(RAW.map((r) => r.id).sort(), Object.keys(WANT).sort());
  for (const row of RAW) {
    assert.ok(normalizePackRow(row), row.id);
    assert.ok(PACK_CATEGORIES.includes(row.category), row.id);
    assert.match(row.prompt, /\[[^\]\n]{1,80}\]/, `${row.id} has a blank`);
    assert.equal(row.source_url, "");
    assert.equal(row.added_week, "2026-W44");
  }
});

test("each prompt has the fields it was approved with", () => {
  for (const row of RAW) {
    const text = row.prompt.toLowerCase();
    for (const word of WANT[row.id]) assert.ok(text.includes(word), `${row.id} mentions "${word}"`);
  }
});

test("plain words: no long dashes, no promises, nothing is sent or posted", () => {
  for (const row of RAW) {
    const all = [row.title, row.prompt, row.popularity_note].join(" ");
    assert.ok(!/[‒–—―]/.test(all), `${row.id} has a long dash`);
    assert.ok(!/\b(guarantee[ds]?|risk[- ]free|go viral|overnight|instant results)\b/i.test(all), row.id);
    assert.match(row.prompt, /Draft only/, row.id);
  }
});

test("the insurance prompt names no carrier or rate and carries the compliance note", () => {
  const row = RAW.find((r) => r.id === "pro-2026-11-life-insurance-needs-check");
  assert.equal(row.category, "insurance");
  assert.match(row.prompt, /Do not name any carrier, rate, or price/);
  assert.match(row.prompt, /general education, not a quote or advice/);
  assert.match(row.prompt, /licensed agent/);
});

test("the review prompt does not pay for reviews", () => {
  const row = RAW.find((r) => r.id === "pro-2026-11-ask-for-a-review");
  assert.match(row.prompt, /Do not offer a gift or discount in return/);
});

test("the app loads all five, shows them in What's new, and files them in categories", () => {
  const loaded = readPackDir();
  for (const id of Object.keys(WANT)) assert.ok(loaded.some((r) => r.id === id), `${id} loads`);
  const rows = mergePacks(loaded, []);
  for (const id of Object.keys(WANT)) assert.ok(rows.some((r) => r.id === id), `${id} survives dedupe`);
  const news = pickWhatsNew(rows, W44);
  for (const id of Object.keys(WANT)) assert.ok(news.rows.some((r) => r.id === id), `${id} in What's new`);
  const filed = fileIntoShelves(rows, [], W44);
  for (const id of Object.keys(WANT)) assert.ok(filed.find((r) => r.id === id)?.shelf, `${id} has a shelf`);
});
