// 0.4.21 Help finds the new answers (M26): results, text size, stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHelp, searchArticles } from "../server/help.js";
import { matchScreensForQuery } from "../web/help-rank.js";

const EM = /[—–]/;

test("screen jumps: results, text size and stop find the right screen", () => {
  assert.equal(matchScreensForQuery("where do my results go")[0].view, "mindmedia");
  assert.equal(matchScreensForQuery("make the text bigger")[0].label, "Settings > Text size");
  assert.equal(matchScreensForQuery("stop an answer")[0].view, "command");
  assert.ok(!matchScreensForQuery("gmail").some((t) => /Images/.test(t.label)));
});

test("articles: the three new ones exist, rank first for their question, and use no dashes", () => {
  const { articles } = loadHelp();
  for (const [q, id] of [["where are my results saved", "where-results-saved"], ["make the text bigger", "text-size"], ["stop an answer", "stop-an-answer"]]) {
    const a = articles.find((x) => x.id === id);
    assert.ok(a, id);
    assert.equal(EM.test(a.body + a.title + a.summary), false);
    const hits = searchArticles(articles, q);
    assert.equal(hits[0]?.id, id, `${q} -> ${hits.map((h) => h.id).slice(0, 3)}`);
  }
});
