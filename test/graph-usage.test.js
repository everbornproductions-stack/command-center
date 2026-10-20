// Bubble size follows each AI's share of jobs in the last 30 days.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  USAGE_MIN, USAGE_MAX, WORKING_BOOST, usageScale, peakCount, isTiny, displayScale,
  eased, easeOutCubic, jobCounts, windowStart, usageFromSummary, ringPositions,
  layoutBubbles, circlesOverlap,
} from "../web/graph-usage.js";
import { tmpDir } from "./helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("size scale: busiest is 1.6x, unused is 0.6x, even field stays 1x", () => {
  assert.equal(usageScale(0, 0), 1);
  assert.equal(usageScale(4, 0), 1);
  assert.equal(usageScale(10, 10), USAGE_MAX);
  assert.equal(usageScale(0, 10), USAGE_MIN);
  assert.equal(usageScale(5, 10), 1.1);
  const counts = { openai: 9, anthropic: 1, google: 0 };
  const peak = peakCount(counts);
  assert.equal(usageScale(counts.openai, peak), 1.6);
  assert.ok(Math.abs(usageScale(counts.anthropic, peak) - (0.6 + (1 / 9))) < 1e-9);
  assert.equal(usageScale(counts.google, peak), 0.6);
  assert.equal(isTiny(0.6, peak), true);
  assert.equal(isTiny(1.6, peak), false);
  assert.equal(isTiny(1, 0), false, "no history yet, names stay visible");
  assert.equal(displayScale(1.6, true), 1.6 + WORKING_BOOST);
  assert.equal(displayScale(1.6, false), 1.6);
});

test("easing: reduced motion jumps, otherwise it eases out", () => {
  assert.equal(eased(2, 8, 0.2, true), 8);
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  const mid = easeOutCubic(0.5);
  assert.ok(mid > 0.5 && mid < 1, "ease-out is ahead of linear at the halfway mark");
  assert.equal(eased(0, 10, 0.5, false), 10 * mid);
  assert.equal(eased(4, 4, 0.3, false), 4);
});

test("job counts use the last 30 days and ignore older rows", () => {
  const now = Date.parse("2026-10-20T15:00:00Z");
  const start = windowStart(now);
  const day = 86400000;
  const counts = jobCounts([
    { ts: start, kind: "call", provider: "openai" },
    { ts: start - day, kind: "call", provider: "openai" },
    { ts: now - 2 * day, kind: "call", provider: "anthropic" },
    { ts: now - day, kind: "image", provider: "anthropic" },
    { ts: now, kind: "search", provider: "perplexity" },
    { ts: now, kind: "credits", provider: "kling" },
    { ts: now, kind: "note", provider: "openai" },
    { ts: now, kind: "call", provider: "" },
  ], now);
  assert.equal(counts.openai, 1, "the row before the window is left out");
  assert.equal(counts.anthropic, 2);
  assert.equal(counts.perplexity, 1);
  assert.equal(counts.kling, 1);
  assert.equal(counts[""], undefined);
});

test("crowded rings stay apart, including the hub", () => {
  const text = Array.from({ length: 8 }, (_, i) => ({ id: "t" + i, r: 22 * (1.6 + WORKING_BOOST), tail: 16 }));
  const media = Array.from({ length: 6 }, (_, i) => ({ id: "m" + i, r: 15 * (1.6 + WORKING_BOOST), tail: 16 }));
  const home = [
    ...ringPositions(text, { hx: 400, hy: 170, rx: 300, ry: 118, start: Math.PI * 1.08, end: Math.PI * 1.92 }),
    ...ringPositions(media, { hx: 400, hy: 170, rx: 330, ry: 140, start: Math.PI * 0.12, end: Math.PI * 0.88 }),
    { id: "hub", x: 400, y: 170, r: 36, pin: true },
  ];
  const placed = layoutBubbles(home, { width: 800, height: 340, pad: 8, margin: 8 });
  assert.equal(circlesOverlap(placed, 8), false);
  const hub = placed.find((n) => n.id === "hub");
  assert.equal(hub.x, 400);
  assert.equal(hub.y, 170);
  for (const n of placed) {
    if (n.pin) continue;
    assert.ok(n.x - n.r >= 8 - 0.3 && n.x + n.r <= 800 - 8 + 0.3, n.id + " fits across");
    assert.ok(n.y - n.r >= 8 - 0.3 && n.y + n.r + (n.tail || 0) <= 340 - 8 + 0.3, n.id + " fits down");
  }
  const ratios = placed.filter((n) => n.id.startsWith("t")).map((n) => n.r);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.01, "equal usage keeps equal size");
});

test("ledger summary stores a 30-day job count the graph can read", async () => {
  const dir = tmpDir("cc-graph-usage-");
  process.env.CC_DATA_DIR = dir;
  const store = await import("../server/store.js");
  store.setDefaultContext(store.newContext("local", new store.FileStore(dir)));
  const ledger = await import("../server/ledger.js");
  const now = Date.now();
  const day = 86400000;
  store.ctx().ledger.push(
    { ts: now - 40 * day, kind: "call", provider: "openai", cost: 1, inTok: 10, outTok: 4 },
    { ts: now - 2 * day, kind: "call", provider: "openai", cost: 0.2, inTok: 10, outTok: 4 },
    { ts: now - day, kind: "image", provider: "openai", cost: 0.04 },
    { ts: now - day, kind: "call", provider: "anthropic", cost: 0.1, inTok: 8, outTok: 2 },
  );
  const summary = ledger.summary();
  assert.equal(summary.byProvider.openai.calls, 2, "all-time calls still ignore the image row");
  assert.equal(summary.byProvider.openai.calls30, 2, "old call is outside the window; image counts");
  assert.equal(summary.byProvider.anthropic.calls30, 1);
  assert.equal(summary.byProvider.google.calls30, 0);
  const counts = usageFromSummary(summary);
  assert.equal(usageScale(counts.openai, peakCount(counts, ["openai", "anthropic", "google"])), 1.6);
  assert.equal(usageScale(counts.google, peakCount(counts, ["openai", "anthropic", "google"])), 0.6);

  const lv = await import("../server/liveview.js");
  const flow = lv.makeFlow(
    [{ id: "m1", providerIds: ["openai", "anthropic"], workers: [{ provider: "openai", active: true }], handoffs: [], links: [], cost: 0 }],
    { pulses: [] },
    { ledger: store.ctx().ledger },
  );
  const byId = Object.fromEntries(flow.nodes.map((n) => [n.id, n]));
  assert.ok(byId.openai.radius > byId.anthropic.radius, "the busier AI is the larger bubble");
  assert.equal(byId.openai.tiny, false);
  assert.equal(circlesOverlap(flow.nodes.map((n) => ({ x: n.x, y: n.y, r: n.radius || 18 })), 8), false);
});

test("graph and live map hide tiny names, ease size, and honor reduced motion", () => {
  const graph = read("web/graph.js");
  const live = read("web/features/liveview.js");
  const app = read("web/app.js");
  for (const src of [graph, live, read("web/graph-usage.js")]) assert.ok(!src.includes("\u2014"));
  assert.match(graph, /prefers-reduced-motion/);
  assert.match(graph, /node-name/);
  assert.match(graph, /setUsage/);
  assert.match(graph, /classList\.toggle\("tiny"/);
  assert.match(live, /lv-tiny/);
  assert.match(live, /aimNode/);
  assert.match(app, /refreshGraphUsage/);
  assert.match(app, /usageFromSummary/);
});
