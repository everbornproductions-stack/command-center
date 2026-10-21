// Prompt votes, popularity, weekly packs, and the Builders category.
// Temp data dir only. No real key, no live Supabase, and data/ is not read.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { PACK_CATEGORIES, creditLine, dedupePrompts, mergePacks, nearDuplicateTitle, openPlan, readPackDir } from "../server/prompts/packs.js";
import { isoWeekStart, isNewThisWeek, popularityScore, rankPrompts, scoreLabel } from "../server/prompts/rank.js";
import { castVote, countsFor, emptyVotes, normalizeVotes, tallyVotes, upsertVoteRow } from "../server/prompts/votes.js";
import { NOTE, CATEGORIES, TEMPLATES } from "../server/prompts/catalog.js";

const EM = /\u2014|\u2013/;
const NOW = Date.UTC(2026, 9, 21);
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("a later vote replaces the earlier one, and each person has one row", () => {
  let state = castVote(emptyVotes(), "builder-acct-receipt", "up");
  state = castVote(state, "builder-acct-receipt", "down");
  assert.equal(state.mine["builder-acct-receipt"], "down");
  assert.equal(state.pending["builder-acct-receipt"], "down");
  state.synced["builder-acct-receipt"] = "down";
  delete state.pending["builder-acct-receipt"];
  state = castVote(state, "builder-acct-receipt", "clear");
  assert.equal(state.mine["builder-acct-receipt"], undefined);
  assert.equal(normalizeVotes(state).pending["builder-acct-receipt"], "clear");

  let rows = upsertVoteRow([], { userId: "a", promptId: "p", vote: "up" });
  rows = upsertVoteRow(rows, { userId: "a", promptId: "p", vote: "down" });
  rows = upsertVoteRow(rows, { userId: "b", promptId: "p", vote: "up" });
  assert.equal(rows.filter((row) => row.userId === "a").length, 1);
  assert.equal(rows.find((row) => row.userId === "a").vote, "down");
  assert.deepEqual(tallyVotes(rows), { p: { up: 1, down: 1 } });

  const counted = countsFor({
    mine: { p: "down" },
    community: { p: { up: 3, down: 1 } },
    synced: { p: "up" },
    pending: {},
  }, "p");
  assert.deepEqual({ up: counted.up, down: counted.down, mine: counted.mine }, { up: 2, down: 2, mine: "down" });
});

test("popularity keeps a loved prompt first, a new prompt visible, and one vote modest", () => {
  assert.equal(isoWeekStart("2026-W43").toISOString().slice(0, 10), "2026-10-19");
  assert.equal(isNewThisWeek("2026-W43", NOW), true);
  assert.equal(isNewThisWeek("2026-W43", Date.UTC(2026, 9, 26)), false);
  assert.equal(isNewThisWeek("2026-W40", NOW), false);
  assert.equal(scoreLabel(0, 0), "No votes yet");
  assert.ok(scoreLabel(1, 0).startsWith("Score "));
  assert.notEqual(scoreLabel(1, 0), "Score 100 (1 up, 0 down)");
  assert.ok(popularityScore(40, 4) > popularityScore(1, 0) + 0.04);
  assert.ok(popularityScore(0, 0) > popularityScore(0, 40));

  const ranked = rankPrompts([
    { id: "loved", title: "Loved", up: 40, down: 4 },
    { id: "fresh", title: "Fresh", up: 1, down: 0, added_week: "2026-W43" },
    { id: "zero", title: "Zero", up: 0, down: 0 },
    { id: "down", title: "Down", up: 0, down: 40 },
    { id: "old", title: "Old pack", up: 0, down: 0, added_week: "2026-W40" },
  ], NOW);
  assert.deepEqual(ranked.map((row) => row.id), ["loved", "fresh", "old", "zero", "down"]);
  assert.equal(ranked.find((row) => row.id === "fresh").fresh, true);
  assert.equal(ranked.find((row) => row.id === "old").fresh, false);
  assert.equal(ranked.find((row) => row.id === "zero").fresh, false);
});

test("the same id and a near title are kept once, and an unrelated title stays", () => {
  assert.equal(nearDuplicateTitle("Weekly status note", "Weekly status notes"), true);
  assert.equal(nearDuplicateTitle("Invoice checklist", "Vacation packing list"), false);
  const rows = dedupePrompts([
    { id: "same", title: "Old title", category: "writing", prompt: "Rewrite [piece] plainly.", source_name: "A", source_url: "https://example.com/a", added_week: "2026-W40" },
    { id: "same", title: "New title", category: "writing", prompt: "Rewrite [piece] plainly now.", source_name: "B", source_url: "https://example.com/b", added_week: "2026-W43" },
    { id: "near-old", title: "Weekly status note", category: "productivity", prompt: "From [week], list one first step.", source_name: "A", source_url: "https://example.com/a", added_week: "2026-W40" },
    { id: "near-new", title: "Weekly status notes", category: "productivity", prompt: "From [week], list the first step.", source_name: "B", source_url: "https://example.com/b", added_week: "2026-W43" },
    { id: "invoice", title: "Invoice checklist", category: "finance and accounting", prompt: "List [invoice] as who, number, and total.", source_name: "A", source_url: "https://example.com/a", added_week: "2026-W43" },
    { id: "vacation", title: "Vacation packing list", category: "personal life", prompt: "Pack [trip] for [days] days.", source_name: "A", source_url: "https://example.com/a", added_week: "2026-W43" },
  ]);
  assert.equal(rows.find((row) => row.id === "same").title, "New title");
  assert.equal(rows.some((row) => row.id === "near-old"), false);
  assert.equal(rows.some((row) => row.id === "near-new"), true);
  assert.equal(rows.some((row) => row.id === "invoice"), true);
  assert.equal(rows.some((row) => row.id === "vacation"), true);
  const cloudOnly = mergePacks([], [{
    id: "cloud-only", title: "Cloud only pack", category: "writing", prompt: "Write [topic] plainly.",
    source_name: "Example", source_url: "https://example.com/docs", added_week: "2026-W43",
  }]);
  assert.equal(cloudOnly[0].id, "cloud-only");
  assert.equal(openPlan(cloudOnly[0], { features: [] }).kind, "chat");
});

test("each guided builder and Remix has a votable Meldmind prompt", () => {
  const need = [
    "writing", "email", "marketing and ads", "social media", "sales", "coding",
    "research and summaries", "business planning", "studying and learning", "images and design",
    "video", "productivity", "customer support", "finance and accounting",
    "legal and contracts (informational)", "HR and hiring", "real estate", "mortgage", "insurance",
    "credit repair", "creators", "personal life", "builders",
  ];
  for (const name of need) assert.ok(PACK_CATEGORIES.includes(name), name);
  const rows = readPackDir();
  const builders = rows.filter((row) => row.category === "builders");
  const byBuilder = Object.fromEntries(builders.map((row) => [row.builder, row]));
  for (const id of ["hl-lead", "hl-campaign", "hl-workflows", "hl-pipeline", "hl-funnel", "acct-receipt", "acct-qbo", "acct-xero", "acct-invoice-read", "acct-invoice-make", "biz-chat", "biz-booking", "biz-notes", "biz-contract", "biz-review", "remix"]) {
    assert.ok(byBuilder[id], id);
    assert.equal(byBuilder[id].source_name, "Meldmind");
    assert.equal(creditLine(byBuilder[id]), "Inspired by Meldmind");
    assert.match(byBuilder[id].source_url, /^https:\/\//);
  }
  assert.equal(byBuilder["acct-receipt"].title, "Receipt Snap");
  assert.equal(byBuilder["acct-receipt"].prompt, "Snap my receipt and log it");
  assert.equal(byBuilder["biz-review"].title, "Review Responder");
  assert.equal(byBuilder.remix.feature, "remix");
  assert.equal(byBuilder["acct-qbo"].feature, "builders");
  assert.equal(openPlan(byBuilder["acct-receipt"], { features: [] }).kind, "chat");
  const opened = openPlan(byBuilder["acct-receipt"], { features: ["builders"] });
  assert.equal(opened.kind, "builder");
  assert.equal(opened.id, "acct-receipt");
  assert.equal(opened.storageKey, "cc.builderText");
  assert.equal(opened.openKey, "cc.builderOpen");
  assert.equal(opened.text, "Snap my receipt and log it");
  const remix = openPlan(byBuilder.remix, { features: ["remix"] });
  assert.equal(remix.kind, "remix");
  assert.equal(remix.storageKey, "cc.remixIdea");
  assert.equal(openPlan(byBuilder.remix, { features: ["builders"] }).kind, "chat");
  const categories = new Set(rows.map((row) => row.category));
  for (const name of need) assert.ok(categories.has(name), name);
});

test("votes stay local when the hub is offline, and Use this fills chat until the builder is installed", async () => {
  const s = await startServer();
  try {
    const listed = await s.api("/prompts");
    assert.equal(listed.status, 200);
    assert.equal(listed.json.note, NOTE);
    assert.equal(listed.json.categories.length, CATEGORIES.length);
    assert.equal(listed.json.templates.length, TEMPLATES.length);
    assert.ok(listed.json.packCategories.includes("builders"));
    assert.ok(listed.json.weekly.length >= 16);
    const receipt = listed.json.weekly.find((row) => row.id === "builder-acct-receipt");
    assert.equal(receipt.prompt, "Snap my receipt and log it");
    assert.equal(receipt.credit, "Inspired by Meldmind");
    assert.equal(receipt.scoreLabel, "No votes yet");
    const productivity = listed.json.weekly.find((row) => row.id === "week-2026-w43-productivity");
    assert.equal(productivity.fresh, isNewThisWeek("2026-W40", Date.now()));

    const suggest = await s.api("/prompts/suggest?text=" + encodeURIComponent("snap my receipt"));
    assert.equal(suggest.status, 200);
    assert.equal(suggest.json.items[0].id, "builder-acct-receipt");
    assert.equal(suggest.json.items[0].kind, "builder");

    const up = await s.api("/prompts/vote", { method: "POST", body: { id: "builder-acct-receipt", vote: "up" } });
    assert.equal(up.status, 200);
    assert.equal(up.json.vote, "up");
    assert.equal(up.json.offline, true);
    const down = await s.api("/prompts/vote", { method: "POST", body: { id: "builder-acct-receipt", vote: "down" } });
    assert.equal(down.json.vote, "down");
    assert.equal(down.json.up, 0);
    assert.equal(down.json.down, 1);
    const missing = await s.api("/prompts/vote", { method: "POST", body: { id: "not-a-prompt", vote: "up" } });
    assert.equal(missing.status, 404);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "prompts.votes.json"), "utf8"));
    assert.equal(saved.mine["builder-acct-receipt"], "down");

    const again = await s.api("/prompts");
    assert.equal(again.json.weekly.find((row) => row.id === "builder-acct-receipt").mine, "down");

    const chat = await s.api("/prompts/open", { method: "POST", body: { id: "builder-acct-receipt", features: [] } });
    assert.equal(chat.json.plan.kind, "chat");
    assert.equal(chat.json.plan.text, "Snap my receipt and log it");
    const builder = await s.api("/prompts/open", { method: "POST", body: { id: "builder-acct-receipt", features: ["builders"] } });
    assert.equal(builder.json.plan.kind, "builder");
    assert.equal(builder.json.plan.storageKey, "cc.builderText");
    const remix = await s.api("/prompts/open", { method: "POST", body: { id: "builder-remix", features: ["remix"] } });
    assert.equal(remix.json.plan.kind, "remix");
    const absent = await s.api("/prompts/open", { method: "POST", body: { id: "no-such-pack", features: ["builders"] } });
    assert.equal(absent.status, 404);

    const help = await s.api("/help");
    assert.ok(help.json.canDo.some((line) => line.includes("Snap my receipt and log it")));
    assert.ok(help.json.canDo.some((line) => line.includes("Review Responder")));
  } finally {
    await s.stop();
  }
});

test("the vote table turns on row level security, and the new words have no dash", () => {
  const sql = read("supabase", "prompt-packs.sql");
  assert.match(sql, /primary key \(user_id, prompt_id\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /prompt_packs_read/);
  const open = read("server", "plugins", "prompts.js");
  const handler = open.slice(open.indexOf('p === "/open"'), open.indexOf('p === "/profile"'));
  assert.match(handler, /fetchCloudPacks/);
  assert.match(handler, /mergePacks/);
  const files = [
    "server/prompts/packs.js",
    "server/prompts/rank.js",
    "server/prompts/votes.js",
    "server/prompts/packs/builders.json",
    "server/prompts/packs/week-2026-w43.json",
    "web/features/prompts.js",
    "web/features/prompt-board.js",
    "web/features/tour.js",
    "docs/help/prompts.md",
    "docs/help/what-can-meldmind-do.md",
    "docs/help/getting-started.md",
    "docs/help/handoff.md",
    "docs/help/replay-the-tour.md",
  ];
  for (const file of files) assert.doesNotMatch(read(...file.split("/")), EM, file);
  assert.match(read("docs", "help", "catalog.json"), /"lastUpdatedVersion": "\d+\.\d+\.\d+"/);
});
