// Pro prompt shelves: one category each, search across them, and custom moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TEMPLATES } from "../server/prompts/catalog.js";
import {
  SHELVES, OPEN_KEY, shelfFor, buildBoard, assignCustom, marketplacePacks,
  readOpen, writeOpen, renderBoard, boardControls, uiExperience, matchesQuery,
} from "../web/features/prompt-board.js";
import { startServer } from "./helpers.js";

const IDS = new Set(SHELVES.map((s) => s.id));
const EXPECT = {
  "spec-it-out": "build",
  "agent-team": "build",
  "build-it-right": "build",
  "reel-scripts": "creative",
  "reply-lead": "sales",
  "dm-booked-call": "sales",
  "win-back-lead": "sales",
  "pricing-tiers": "sales",
  "contrarian-hooks": "marketing",
  "contrarian-view-hooks": "marketing",
  "thought-leadership-outline": "marketing",
  "ad-funnel": "marketing",
  "coaching-sbi": "leadership",
  "job-scorecard": "leadership",
  "friday-coach": "leadership",
  "friday-checkin": "leadership",
  "delegation-handoff": "productivity",
  "personal-touch-handoff": "productivity",
  "weekly-time-audit": "productivity",
  "buy-back-time": "productivity",
  "vacation-test": "productivity",
  "prelaunch-risk-audit": "planning",
  "fix-sop": "planning",
  "chief-of-staff": "planning",
  "business-profile": "planning",
};

test("every template has one shelf and the named ones land where they belong", () => {
  assert.deepEqual(SHELVES.map((s) => s.label), [
    "Sales and Follow-up",
    "Marketing and Content",
    "Leadership and Team",
    "Productivity and Delegation",
    "Planning and Operations",
    "Build and Spec",
    "Creative",
    "Custom/My prompts",
    "Marketplace",
  ]);
  const seen = new Map();
  for (const t of TEMPLATES) {
    const shelf = shelfFor(t);
    assert.ok(IDS.has(shelf), `${t.id} -> ${shelf}`);
    assert.equal(seen.has(t.id), false, t.id);
    seen.set(t.id, shelf);
  }
  assert.equal(seen.size, TEMPLATES.length);
  for (const [id, shelf] of Object.entries(EXPECT)) assert.equal(shelfFor(TEMPLATES.find((t) => t.id === id)), shelf, id);
  const board = buildBoard({ templates: TEMPLATES });
  const placed = board.flatMap((g) => g.items.filter((item) => item.source === "pack"));
  assert.equal(placed.length, TEMPLATES.length);
  assert.equal(new Set(placed.map((item) => item.id)).size, TEMPLATES.length);
  assert.ok(board.some((g) => g.id === "custom" && g.items.length === 0));
  assert.ok(board.some((g) => g.id === "marketplace" && g.items.length === 0));
});

test("search matches across categories and expert sort and filter stay off in simple mode", () => {
  assert.equal(boardControls("simple").sort, false);
  assert.equal(boardControls("simple").filter, false);
  assert.equal(boardControls("expert").sort, true);
  assert.equal(boardControls("expert").filter, true);
  assert.equal(uiExperience({}), "simple");
  assert.equal(uiExperience({ uiMode: "expert" }), "expert");
  assert.equal(uiExperience({ dataUi: "expert" }), "expert");

  const hit = buildBoard({ templates: TEMPLATES, query: "  AuDiT " });
  const shelves = new Set(hit.filter((g) => g.items.length).map((g) => g.id));
  assert.ok(shelves.has("productivity"), [...shelves].join(","));
  assert.ok(shelves.has("planning"), [...shelves].join(","));
  assert.ok(hit.flatMap((g) => g.items).some((item) => item.id === "weekly-time-audit"));
  assert.ok(hit.flatMap((g) => g.items).some((item) => item.id === "prelaunch-risk-audit"));
  assert.equal(buildBoard({ templates: TEMPLATES, query: "zzzz-no-prompt" }).length, 0);
  assert.equal(matchesQuery({ name: "Spec it out", shelf: "build" }, "SPEC"), true);

  const simple = buildBoard({ templates: TEMPLATES, mode: "simple", filter: "creative", sort: "name" });
  assert.ok(simple.some((g) => g.id === "sales" && g.items.length));
  const sales = simple.find((g) => g.id === "sales").items.map((item) => item.name);
  const packOrder = TEMPLATES.filter((t) => shelfFor(t) === "sales").map((t) => t.name);
  assert.deepEqual(sales, packOrder);

  const expert = buildBoard({ templates: TEMPLATES, mode: "expert", filter: "creative", sort: "name" });
  assert.deepEqual(expert.map((g) => g.id), ["creative"]);
  assert.ok(expert[0].items.some((item) => item.id === "reel-scripts"));
  const named = buildBoard({ templates: TEMPLATES, mode: "expert", sort: "name" });
  for (const g of named) {
    const names = g.items.map((item) => item.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    assert.deepEqual(names, sorted, g.id);
  }
});

test("marketplace packs get their own shelf and only your prompts can move", () => {
  const packs = marketplacePacks({
    catalog: [
      { id: "demo-week-of-posts", kind: "pipeline", title: "Demo: week of posts" },
      { id: "pack-1", kind: "prompt", title: "Closer pack", promise: "Four follow-ups" },
    ],
    installed: [
      { listingId: "pack-1", kind: "prompt", title: "Closer pack" },
      { listingId: "pack-2", kind: "prompt", title: "Installed pack", promise: "A saved sequence" },
    ],
  });
  assert.deepEqual(packs.map((p) => p.id), ["pack-1", "pack-2"]);
  const board = buildBoard({ templates: [], marketplace: packs });
  assert.deepEqual(board.find((g) => g.id === "marketplace").items.map((item) => item.name), ["Closer pack", "Installed pack"]);

  assert.throws(() => assignCustom({ id: "spec-it-out", shelf: "sales", ownIds: ["pr-1"] }), (e) => e.status === 400);
  assert.throws(() => assignCustom({ id: "pr-1", shelf: "marketplace", ownIds: ["pr-1"] }), (e) => e.status === 400);
  const next = assignCustom({ id: "pr-1", shelf: "leadership", ownIds: ["pr-1"], current: {} });
  assert.equal(next["pr-1"], "leadership");
  const moved = buildBoard({
    templates: TEMPLATES,
    custom: [{ id: "pr-1", name: "Mine <b>", description: "A note", text: "Hello", shelf: next["pr-1"] }],
  });
  assert.ok(moved.find((g) => g.id === "leadership").items.some((item) => item.id === "pr-1" && item.movable));
  assert.equal(moved.find((g) => g.id === "custom").items.some((item) => item.id === "pr-1"), false);

  const html = renderBoard(moved.filter((g) => g.id === "leadership" || g.id === "sales"), { open: { sales: false, leadership: true } });
  assert.match(html, /data-shelf="leadership" open/);
  assert.doesNotMatch(html, /data-shelf="sales" open/);
  assert.match(html, /data-move="pr-1"/);
  assert.match(html, /Mine &lt;b&gt;/);
  assert.equal((html.match(/data-move=/g) || []).length, 1);
});

test("open and closed categories are remembered", () => {
  const mem = {
    v: null,
    getItem(key) { assert.equal(key, OPEN_KEY); return this.v; },
    setItem(key, value) { assert.equal(key, OPEN_KEY); this.v = value; },
  };
  let open = readOpen(mem, SHELVES.map((s) => s.id));
  assert.equal(open.sales, true);
  assert.equal(open.creative, true);
  open.sales = false;
  open.build = false;
  writeOpen(mem, open);
  open = readOpen(mem, SHELVES.map((s) => s.id));
  assert.equal(open.sales, false);
  assert.equal(open.build, false);
  assert.equal(open.marketing, true);
  const src = fs.readFileSync(new URL("../web/features/prompt-board.js", import.meta.url), "utf8")
    + fs.readFileSync(new URL("../web/features/prompts.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\u2014|\u2013/);
});

test("the prompts route returns a shelf for every template and moves only your own", async () => {
  const s = await startServer();
  try {
    const list = await s.api("/prompts");
    assert.equal(list.status, 200);
    assert.equal(list.json.templates.length, TEMPLATES.length);
    for (const t of list.json.templates) {
      assert.equal(t.shelf, shelfFor(TEMPLATES.find((row) => row.id === t.id)), t.id);
      assert.ok(IDS.has(t.shelf), t.id);
    }
    const blocked = await s.api("/prompts/shelf", { method: "POST", body: { id: "spec-it-out", shelf: "sales" } });
    assert.equal(blocked.status, 400);
    const saved = await s.api("/prompts/save", { method: "POST", body: { name: "My follow up", text: "Check in with {{name}}." } });
    assert.equal(saved.status, 200);
    const id = saved.json.prompt.id;
    const moved = await s.api("/prompts/shelf", { method: "POST", body: { id, shelf: "sales" } });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.shelf, "sales");
    const again = await s.api("/prompts");
    assert.equal(again.json.custom.find((p) => p.id === id).shelf, "sales");
    const bad = await s.api("/prompts/shelf", { method: "POST", body: { id, shelf: "marketplace" } });
    assert.equal(bad.status, 400);
    assert.equal((await s.api("/prompts")).json.custom.find((p) => p.id === id).shelf, "sales");
  } finally { await s.stop(); }
});
