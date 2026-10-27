// 0.4.22 panel clarity fixes: one cost line, sample (not practice) pictures, "Not finished yet", Auto team help.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { costLineText } from "../web/cost-line.js";
import { loadHelp, searchArticles } from "../server/help.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("one cost line: a free answer says Free once, a paid answer keeps the amount and the reason", () => {
  assert.equal(costLineText("$0 (free: Groq)", "Free first: a free AI did it, at no cost."), "Free (Groq)");
  assert.equal(costLineText("$0 (this PC: Ollama)", "Free first: this PC did it, at no cost."), "Free (Ollama)");
  assert.equal(costLineText("$0.0001 (Nova (demo))", "Free first: a free AI did it, at no cost."), "Free (Nova (demo))");
  assert.equal(costLineText("$0.04 (Claude)", "A paid AI took this step because no free AI was ready or strong enough."), "Cost: $0.04 (Claude). A paid AI took this step because no free AI was ready or strong enough.");
  assert.equal(costLineText("$0 (your plan: Claude Code)", "Your own plan did it, so there was no extra charge."), "Cost: $0 (your plan: Claude Code). Your own plan did it, so there was no extra charge.");
  assert.equal(costLineText("", "x"), "");
  for (const t of [costLineText("$0 (free: Groq)", "Free first: a free AI did it, at no cost."), costLineText("$0.04 (Claude)", "")]) assert.ok(!/free/i.test(t) || !/\$/.test(t), t);
  assert.match(read("web", "app.js"), /costLineText\(mm\.costText, mm\.why\)/, "the answer card uses it");
});

test("pictures say Sample, and the hub says Not finished yet; ids and keys stay", () => {
  const mk = read("web", "features", "make-chat.js");
  assert.match(mk, /Sample picture: free/);
  assert.match(mk, /Sample video: a still/);
  assert.match(mk, /Sample voice: a silent/);
  assert.doesNotMatch(mk, /Practice (picture|video|voice):/);
  const hub = read("web", "features", "mindmedia.js");
  assert.match(hub, /<h3>Not finished yet<\/h3>/);
  assert.match(read("server", "project-media.js"), /"needs-ending": \{ label: "Not finished yet"/);
  assert.match(read("server", "project-media.js"), /"needs-ending":/, "the smart view key is unchanged");
});

test("Help finds what Auto team means first", () => {
  const { articles } = loadHelp();
  const a = articles.find((x) => x.id === "auto-team");
  assert.ok(a, "the article exists");
  assert.equal(/[\u2014\u2013]/.test(a.body + a.title + a.summary), false);
  assert.equal(searchArticles(articles, "what does auto team mean")[0]?.id, "auto-team");
  assert.match(a.body, /picks the AIs for you/);
});
