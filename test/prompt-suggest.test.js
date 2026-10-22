// Prompt suggestions while typing (0.4.17). Chris typed "need a fun image for a fantasy dragon" and
// got the newest weekly prompts, and picking one replaced his words. Now: nothing until a few letters,
// ranked by the words and the intent, a direct action first, and the typed words are always kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { MIN_CHARS, SUGGEST_LIMIT, actionFor, detectIntent, rankSuggestions, subjectOf, suggestSource } from "../server/prompts/suggest.js";
import { suggestForOrders } from "../server/prompts/rank.js";
import { MAX_ROWS, OFF_KEY, applySuggestion, fillBlanks, makeBetter, rowsFor, setSuggestionsOff, shouldSuggest, sourceLabel, suggestionsOff, templateInputs, undoState, undoText } from "../web/prompt-suggest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASHES = /[\u2013\u2014]/;
const DRAGON = "need a fun image for a fantasy dragon";

// The weekly rows Chris saw, plus the real packs and templates shapes.
const UNRELATED = [
  { id: "w-week", title: "A week of posts", category: "creators", prompt: "Plan a week of posts for [creator] about [topic]. Drafts only.", fresh: true, popularity: 0.9 },
  { id: "w-ad", title: "Ad from the facts", category: "marketing and ads", prompt: "Write an ad for [offer] aimed at [customer]. Use only these facts: [facts].", fresh: true, popularity: 0.9 },
  { id: "w-review", title: "Annual review agenda", category: "HR and hiring", prompt: "Draft an annual review agenda for [person].", fresh: true, popularity: 0.9 },
];
const IMAGE_ROWS = [
  { id: "w-image", title: "Describe an image", category: "images and design", prompt: "Describe an image of [subject] for [use]. Say what must be in the frame.", fresh: false, popularity: 0.1 },
  { id: "w-banner", title: "Banner with room for text", category: "images and design", prompt: "Design a banner for [use] with room for text.", fresh: true, popularity: 0.5 },
];
const POOL = [
  ...UNRELATED,
  ...IMAGE_ROWS,
  ...JSON.parse(read("server", "prompts", "packs", "week-2026-w43.json")),
  ...JSON.parse(read("server", "prompts", "packs", "builders.json")),
];

test("an empty or very short box gets no suggestions at all", () => {
  assert.equal(MIN_CHARS, 3);
  for (const text of ["", "  ", "a", "hi", " i "]) {
    const r = rankSuggestions(text, POOL);
    assert.deepEqual(r.items, [], JSON.stringify(text));
    assert.equal(r.action, null);
    assert.equal(shouldSuggest(text), false);
  }
  assert.deepEqual(suggestForOrders("", POOL), [], "the popular list is no longer shown for an empty box");
  assert.equal(shouldSuggest("dragon"), true);
});

test("the dragon example leads with Make an image and shows only image prompts", () => {
  assert.equal(detectIntent(DRAGON), "image");
  assert.equal(subjectOf(DRAGON), "fantasy dragon");
  const r = rankSuggestions(DRAGON, POOL);
  assert.equal(r.intent, "image");
  assert.deepEqual(r.action, { intent: "image", view: "images", kind: null, label: "Make an image: fantasy dragon", text: DRAGON, subject: "fantasy dragon" });
  const titles = r.items.map((i) => i.title);
  assert.equal(titles[0], "Describe an image");
  for (const gone of ["A week of posts", "Ad from the facts", "Annual review agenda"]) assert.ok(!titles.includes(gone), gone);
  for (const t of titles) assert.ok(["Describe an image", "Banner with room for text"].includes(t), t);
});

test("relevance wins and New this week only breaks a tie; no match shows nothing", () => {
  const r = rankSuggestions("snap my receipt", POOL);
  assert.equal(r.items[0].id, "builder-acct-receipt");
  assert.deepEqual(rankSuggestions("dragon", POOL).items, [], "no prompt is about dragons, so none is shown");
  assert.deepEqual(rankSuggestions("zxqv blorb", POOL).items, []);
  const tie = rankSuggestions("describe an image", [
    { id: "old", title: "Describe an image", category: "images and design", prompt: "x", fresh: false, popularity: 0.9 },
    { id: "new", title: "Describe an image", category: "images and design", prompt: "y", fresh: true, popularity: 0.1 },
  ]);
  assert.equal(tie.items.length, 1, "the same title is listed once");
  assert.equal(tie.items[0].id, "new", "on a tie the newer one goes first");
  const email = rankSuggestions("write an email to my landlord about the leak", POOL);
  assert.equal(email.intent, "email");
  assert.equal(email.action, null, "email has no page of its own, so there is no direct action");
  assert.ok(email.items.some((i) => i.title === "Short email"));
  assert.ok(!email.items.some((i) => ["A week of posts", "Annual review agenda"].includes(i.title)));
});

test("a clear intent gives a direct action for video, voice, posts and websites", () => {
  assert.equal(actionFor("make a video about our bakery opening").view, "media");
  assert.equal(actionFor("make a video about our bakery opening").kind, "video");
  assert.equal(actionFor("record a voiceover for my ad").kind, "voice");
  assert.equal(actionFor("write an instagram post for my bakery").label, "Make a post: bakery");
  assert.equal(actionFor("build a website for my plumbing business").label, "Build a website: plumbing business");
  assert.equal(actionFor("explain this python bug"), null);
});

test("choosing a suggestion keeps the typed words, and Undo restores them exactly", () => {
  const typed = "  need a fun image for a fantasy dragon ";
  const item = IMAGE_ROWS[0];
  const next = applySuggestion(typed, item, "fantasy dragon");
  assert.match(next, /^Describe an image of fantasy dragon for \[use\]\./, "the blank is filled from the typed words");
  assert.ok(next.includes(typed.trim()), "the typed words are still there");
  const plain = applySuggestion("hello there friends", { prompt: "Keep it short." });
  assert.equal(plain, "hello there friends\n\nKeep it short.", "with no blank the prompt goes after the words");
  assert.ok(!applySuggestion("make a video about dragons", { prompt: "Write a [length] video script about [topic]." }, "dragons").includes("[topic]"), "topic is filled first");
  const state = undoState(typed, next);
  assert.equal(undoText(state), typed, "Undo puts back the exact text, spaces and all");
  assert.equal(fillBlanks("No blanks here.", "x").filled, false);
});

test("Make it better rewrites into a stronger prompt and keeps the words at the end", () => {
  const better = makeBetter(DRAGON, "image", "fantasy dragon");
  assert.match(better, /^Make an image of fantasy dragon\./);
  assert.ok(better.endsWith(`In my words: ${DRAGON}`));
  assert.ok(makeBetter("plan my week").includes("In my words: plan my week"));
  assert.equal(makeBetter(""), "");
  for (const intent of [null, "image", "video", "voice", "post", "email", "ad", "website", "document", "code", "research"]) {
    assert.doesNotMatch(makeBetter("something to make", intent, "something"), DASHES, String(intent));
  }
});

test("the same suggestions sit under the Simple chat box and the Expert orders box", () => {
  const ui = read("web", "features", "prompt-suggest.js");
  assert.match(read("web", "perf", "registry.js"), /\{ id: "prompt-suggest", shell: true \}/, "loads in both modes");
  assert.match(ui, /document\.getElementById\("orders"\)/);
  assert.match(ui, /shouldSuggest\(el\.value\)/);
  assert.match(ui, /e\.key === "Escape"/);
  assert.match(ui, /e\.key === "ArrowDown"/);
  assert.match(ui, /data-psg-undo/);
  assert.match(ui, /data-psg-better/);
  assert.match(ui, /CC\._imagePrefill = \{ op: "generate", prompt: text \}/);
  assert.match(ui, /Nothing runs until you click Generate/);
  assert.doesNotMatch(ui, DASHES);
  assert.match(read("web", "features", "images.js"), /window\.CC\._imagePrefill/);
  const prompts = read("web", "features", "prompts.js");
  assert.doesNotMatch(prompts, /loadPopular\(/, "the old popular list under the box is gone");
  assert.match(prompts, /if \(value\.length < 3 \|\| value === removedFor\) \{ clearPack\(\); return; \}/, "a removed chip does not come straight back for the same words");
  assert.match(prompts, /applySuggestion\(had,/, "Put in orders keeps what is already in the box");
});

test("the list is a listbox right under the box, with labeled rows, at most 6, and a persisted off switch", () => {
  const ui = read("web", "features", "prompt-suggest.js");
  assert.match(ui, /role="listbox"/);
  assert.match(ui, /role="option" id="psg-opt-\$\{i\}"/);
  assert.match(ui, /el\.setAttribute\("aria-activedescendant", list\[i\]\.id\)/);
  assert.match(ui, /el\.setAttribute\("aria-controls", LIST_ID\)/);
  assert.match(ui, /el\.setAttribute\("aria-expanded", String\(!!open\)\)/);
  assert.match(ui, /el\.insertAdjacentElement\("afterend", h\)/, "right under the box, above the hint and the Upload and Voice row");
  assert.match(ui, /e\.key === "Enter" && st\.active >= 0 && !e\.ctrlKey && !e\.metaKey/, "Ctrl+Enter is never taken, so it still sends");
  assert.match(ui, /data-psg-off/);
  assert.match(ui, /settings: \{ order: 15, render: renderSettings \}/);
  assert.match(ui, /Prompt suggestions while typing/);
  assert.equal(OFF_KEY, "cc.ppSuggestOff");
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  assert.equal(suggestionsOff(storage), false);
  setSuggestionsOff(storage, true);
  assert.equal(mem.get("cc.ppSuggestOff"), "1");
  assert.equal(suggestionsOff(storage), true);
  setSuggestionsOff(storage, false);
  assert.equal(suggestionsOff(storage), false);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(suggestionsOff(broken), false, "blocked storage never breaks the box");
  assert.doesNotThrow(() => setSuggestionsOff(broken, true));
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, title: `Prompt ${i}`, source: ["pro", "weekly", "industry", "saved"][i % 4] }));
  const rows = rowsFor({ action: { label: "Make an image: fantasy dragon" }, items });
  assert.equal(MAX_ROWS, 6);
  assert.equal(rows[0].type, "action");
  assert.equal(rows[0].label, "Make an image: fantasy dragon");
  assert.equal(rows.filter((r) => r.type === "item").length, 6);
  assert.deepEqual(rows.slice(1, 5).map((r) => r.tag), ["Pro", "Weekly", "Industry", "Saved"]);
  assert.equal(sourceLabel({ kind: "template" }), "Pro");
  assert.equal(SUGGEST_LIMIT, 6);
  assert.equal(suggestSource({ kind: "template", industry: "mortgage" }), "industry");
  assert.equal(suggestSource({ kind: "template" }), "pro");
  assert.equal(suggestSource({ kind: "weekly" }), "weekly");
  assert.equal(suggestSource({ kind: "builder" }), "weekly");
});

test("picking a Pro prompt fills one of its fields from the typed words and leaves the box alone", () => {
  const reel = { id: "reel-scripts", kind: "template", inputs: [{ key: "idea", label: "The idea", required: true }, { key: "proof", label: "A real case", required: false }] };
  assert.deepEqual(templateInputs(reel, "make a reel about a fantasy dragon", "fantasy dragon").inputs, { idea: "fantasy dragon" });
  const other = { inputs: [{ key: "clientName", label: "Client", required: true }] };
  assert.deepEqual(templateInputs(other, "  follow up with Dana about the quote  ").inputs, { clientName: "follow up with Dana about the quote" });
  assert.deepEqual(templateInputs({ inputs: [] }, "x y z").inputs, {});
  const ui = read("web", "features", "prompt-suggest.js");
  const pickSrc = ui.slice(ui.indexOf("async function pick"), ui.indexOf("function better"));
  const template = pickSrc.slice(pickSrc.indexOf('item.kind === "template"'), pickSrc.indexOf("const next = applySuggestion"));
  assert.match(template, /templateInputs\(item, typed/);
  assert.doesNotMatch(template, /setBox\(/, "the typed words stay in the box exactly");
});

test("server: /prompts/suggest gives nothing for an empty box and image help for the dragon", async () => {
  const s = await startServer();
  try {
    const empty = await s.api("/prompts/suggest?text=");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json.items, []);
    assert.equal(empty.json.action, null);
    const r = await s.api(`/prompts/suggest?text=${encodeURIComponent(DRAGON)}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.intent, "image");
    assert.equal(r.json.action.label, "Make an image: fantasy dragon");
    assert.equal(r.json.subject, "fantasy dragon");
    const titles = r.json.items.map((i) => i.title);
    assert.ok(titles.includes("Describe an image"), titles.join(", "));
    for (const gone of ["A week of posts", "Ad from the facts", "Annual review agenda", "One social post", "Short email"]) assert.ok(!titles.includes(gone), gone);
    assert.ok(r.json.items.length <= 6);
    for (const item of r.json.items) assert.ok(["pro", "weekly", "industry", "saved"].includes(item.source), item.title);
    const pro = await s.api(`/prompts/suggest?text=${encodeURIComponent("help me reply to a lead who asked about pricing")}`);
    const reply = pro.json.items.find((i) => i.id === "reply-lead");
    assert.ok(reply, pro.json.items.map((i) => i.title).join(", "));
    assert.equal(reply.source, "pro");
    assert.ok(Array.isArray(reply.inputs) && reply.inputs.length > 0, "a Pro prompt row carries its fields so the typed words can fill one");
  } finally { await s.stop(); }
});
