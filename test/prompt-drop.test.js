// The Prompts dropdown and the video prompt pack (0.4.19, flag_promptdrop). Off by default.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { promptdropOn } from "../server/flags.js";
import { PACK_DIR, normalizePackRow, readPackDir } from "../server/prompts/packs.js";
import { GROUP_ORDER, REALISM_CHECKLIST, VIDEO_TOOLS, buildDrop, stageFor, videoTips } from "../server/prompts/drop.js";
import { DROP_BOXES, RECENT_MAX, mergeGroups, pickInto, pushRecent, readRecent, tipsFor } from "../web/prompt-drop.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DASHES = /[–—]/;
const PACK = JSON.parse(fs.readFileSync(path.join(PACK_DIR, "video-pack.json"), "utf8"));

function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test("flag is off unless CC_FLAG_PROMPTDROP is 1", () => {
  assert.equal(promptdropOn({}), false);
  assert.equal(promptdropOn({ CC_FLAG_PROMPTDROP: "0" }), false);
  assert.equal(promptdropOn({ CC_FLAG_PROMPTDROP: "1" }), true);
});

test("video pack: 50 original rows, valid, no dashes, no source links", () => {
  assert.equal(PACK.length, 50);
  const ids = new Set();
  for (const row of PACK) {
    assert.ok(!ids.has(row.id), row.id);
    ids.add(row.id);
    assert.ok(normalizePackRow(row), `valid: ${row.id}`);
    assert.equal(row.source_name, "Meldmind original");
    assert.equal(row.source_url, "");
    assert.equal(row.flag, "promptdrop");
    assert.doesNotMatch(JSON.stringify(row), DASHES, row.id);
  }
});

test("pack rows are hidden while the flag is off and listed when it is on", () => {
  const was = process.env.CC_FLAG_PROMPTDROP;
  try {
    delete process.env.CC_FLAG_PROMPTDROP;
    assert.equal(readPackDir().filter((r) => r.group === "video").length, 0);
    process.env.CC_FLAG_PROMPTDROP = "1";
    const on = readPackDir().filter((r) => r.group === "video");
    assert.equal(on.length, 50);
    assert.ok(on.every((r) => r.tips !== undefined && r.realism !== undefined));
  } finally {
    if (was === undefined) delete process.env.CC_FLAG_PROMPTDROP; else process.env.CC_FLAG_PROMPTDROP = was;
  }
});

test("buildDrop groups by box and keeps order", () => {
  const weekly = [
    ...PACK.map((r) => ({ ...r })),
    { id: "w1", title: "Describe an image", category: "images and design", prompt: "Describe [subject].", source_name: "A guide", source_url: "https://example.com/g" },
    { id: "w2", title: "Short email", category: "email", prompt: "Write [x].", source_name: "B", source_url: "https://example.com/b" },
  ];
  const saved = [{ id: "s1", title: "Mine", prompt: "My prompt" }];
  const img = buildDrop({ stage: "im-prompt", weekly, saved });
  assert.deepEqual(img.groups.map((g) => g.id), ["saved", "stage"]);
  assert.ok(img.groups[1].items.some((i) => i.id === "w1"));
  const media = buildDrop({ stage: "md-prompt", weekly, saved });
  assert.ok(media.groups.some((g) => g.id === "video" && g.items.length === 50));
  const orders = buildDrop({ stage: "orders", weekly, saved });
  const order = orders.groups.map((g) => GROUP_ORDER.indexOf(g.id));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(stageFor("nope"), "orders");
  assert.ok(DROP_BOXES.every((id) => stageFor(id) === id));
});

test("video tips: tools, realism checklist, plain original words", () => {
  const t = videoTips();
  assert.ok(t.tools.length >= 4 && t.checklist.length >= 8);
  assert.ok(VIDEO_TOOLS.every((x) => x.tips.length >= 2));
  assert.ok(REALISM_CHECKLIST.some((c) => /mouth/i.test(c)));
  assert.doesNotMatch(JSON.stringify(t), DASHES);
  assert.equal(tipsFor(t, "veo").tool.id, "veo");
  assert.equal(tipsFor(t, "zzz").tool.id, t.tools[0].id);
});

test("picking never overwrites typed words and Undo restores them", () => {
  const item = { id: "x", title: "T", prompt: "Make a clip of [subject]." };
  const typed = "a bakery at dawn";
  const { next, undo } = pickInto(typed, item, "");
  assert.ok(next.includes("a bakery at dawn"));
  assert.equal(undo.before, typed);
  assert.equal(pickInto("", item).next, item.prompt);
});

test("recent list keeps newest first, no repeats, at most six", () => {
  const s = memory();
  for (let i = 0; i < 9; i++) pushRecent(s, { id: `r${i}`, title: `R${i}`, prompt: `p${i}` });
  pushRecent(s, { id: "r5", title: "R5", prompt: "p5" });
  const list = readRecent(s);
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0].id, "r5");
  assert.equal(new Set(list.map((r) => r.id)).size, list.length);
  const merged = mergeGroups([{ id: "video", label: "x", items: [{ id: "v" }] }, { id: "saved", label: "x", items: [{ id: "s" }] }], list);
  assert.deepEqual(merged.map((g) => g.id), ["recent", "saved", "video"]);
  assert.deepEqual(merged.map((g) => g.label), ["Recent", "Saved", "Video"]);
});

test("server: routes answer flag_off by default and groups when the flag is on", async () => {
  const off = await startServer();
  try {
    const a = await off.api("/prompts/drop?stage=orders");
    assert.equal(a.status, 404);
    assert.equal(a.json.code, "flag_off");
    assert.equal((await off.api("/prompts/video-tips")).status, 404);
    const list = await off.api("/prompts");
    assert.ok(!list.json.weekly.some((r) => r.group === "video"));
  } finally { await off.stop(); }
  const on = await startServer({ env: { CC_FLAG_PROMPTDROP: "1" } });
  try {
    const m = await on.api("/prompts/drop?stage=md-prompt");
    assert.equal(m.status, 200);
    const video = m.json.groups.find((g) => g.id === "video");
    assert.ok(video && video.items.length > 0);
    const i = await on.api("/prompts/drop?stage=im-prompt");
    assert.ok(!i.json.groups.some((g) => g.id === "video"));
    const t = await on.api("/prompts/video-tips");
    assert.ok(t.json.tools.length && t.json.checklist.length);
    assert.equal((await on.api("/prompts/suggest?text=")).json.items.length, 0, "typeahead rule unchanged");
  } finally { await on.stop(); }
});

test("web wiring: registry row, no dashes in new files", () => {
  const reg = fs.readFileSync(path.join(ROOT, "web", "perf", "registry.js"), "utf8");
  assert.match(reg, /id: "prompt-drop"/);
  for (const f of ["web/prompt-drop.js", "web/features/prompt-drop.js", "server/prompts/drop.js", "server/flags.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), DASHES, f);
  }
  void os;
});
