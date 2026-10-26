// 0.4.21 dogfood fixes: the pure step checks. Cut-off code, empty and refused output, a step about the
// wrong business, search leaks, and the file name a task asks for. No server, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../server/step-guard.js";

test("empty output is a failure, a real answer is not", () => {
  for (const t of ["", "   ", null, undefined, "(no output)", "...", "-"]) assert.equal(G.isEmptyOutput(t), true, JSON.stringify(t));
  assert.equal(G.isEmptyOutput("A short but real answer."), false);
  assert.equal(G.judgeStep("", {}).kind, "empty");
});

test("a refusal is caught, including the one dogfood 03 got on a harmless task", () => {
  assert.equal(G.isRefusal("[Claude declined this request (safety refusal).]"), true);
  assert.equal(G.isRefusal("I'm sorry, but I can't help with that."), true);
  assert.equal(G.isRefusal("I cannot assist with this request."), true);
  assert.equal(G.isRefusal("Here is the plan. " + "Detail. ".repeat(300) + "Sorry for the length."), false);
  assert.equal(G.isRefusal("The page opens with a headline."), false);
  const v = G.judgeStep("[Claude declined this request (safety refusal).]", {});
  assert.equal(v.kind, "refusal");
  assert.match(v.reason, /declined this request/);
});

test("dogfood 03: a page cut off mid-CSS is truncated; a whole page is not", () => {
  const cut = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<style>\nbody { margin: 0; font-family: sans-serif }\n.hero { background: #3b2a1a; padding: 40px;\n.grid { display: grid; gap: 12px`;
  assert.equal(G.checkTruncation(cut, { ext: "html" }).truncated, true);
  const whole = `<!DOCTYPE html>\n<html lang="en">\n<head><style>body { margin: 0 }</style></head>\n<body><h1>Your listings deserve a movie.</h1></body>\n</html>\n`;
  assert.equal(G.checkTruncation(whole, { ext: "html" }).truncated, false);
  const midTag = `<html><body><ol class="grid grid-3"`;
  assert.equal(G.checkTruncation(midTag, { ext: "html" }).truncated, true);
  assert.equal(G.judgeStep(cut, { ext: "html", capability: "code" }).kind, "truncated");
});

test("the provider's own stop reason counts, and an unclosed code fence or brace", () => {
  assert.equal(G.checkTruncation("Some text that looks fine.", { stop: "length" }).truncated, true);
  assert.equal(G.checkTruncation("Some text that looks fine.", { stop: "max_tokens" }).truncated, true);
  assert.equal(G.checkTruncation("Some text that looks fine.", { stop: "stop" }).truncated, false);
  assert.equal(G.checkTruncation("Here:\n```js\nfunction a() {\n  return 1;\n", {}).truncated, true);
  assert.equal(G.checkTruncation("```js\nfunction a() {\n  if (x) {\n    return 1;\n  }\n", { capability: "code" }).truncated, true, "an unclosed fence");
  assert.equal(G.checkTruncation("function a() {\n  if (x) {\n    return 1;\n  }\n", { ext: "js" }).truncated, true, "a named js file with an open brace");
  assert.equal(G.checkTruncation("Use the regex /a{2,/ to match.", { capability: "code" }).truncated, false, "a brace in a sentence is not a cut-off");
  assert.equal(G.isEmptyOutput("None"), false); assert.equal(G.isEmptyOutput("OK"), false);
  assert.equal(G.checkTruncation("```js\nfunction a() { return 1; }\n```\nDone.", { capability: "code" }).truncated, false);
  assert.equal(G.checkTruncation('{"a": [1, 2', { ext: "json" }).truncated, true);
  assert.equal(G.checkTruncation('{"a": [1, 2]}', { ext: "json" }).truncated, false);
  // plain prose may end any way
  assert.equal(G.checkTruncation("Five posts for the week, one for each day", { capability: "writing" }).truncated, false);
});

test("a continuation is glued on without the repeated overlap", () => {
  const base = "<ul>\n<li>One</li>\n<li>Two</li>\n<li>Three is the third item in this";
  const extra = "<li>Three is the third item in this list</li>\n</ul>";
  const joined = G.joinContinuation(base, extra);
  assert.equal(joined, "<ul>\n<li>One</li>\n<li>Two</li>\n<li>Three is the third item in this list</li>\n</ul>");
  assert.match(G.continuePrompt(base, "html"), /CONTINUE FROM HERE/);
});

test("dogfood 04: a captions step about a neighborhood cafe fails the on-brief check", () => {
  const goal = "Make a 5-day Instagram campaign for Everborn Productions, aimed at mortgage brokers and real estate agents, and save it as campaign.md.";
  const cafe = "Day 1: Our neighborhood cafe is serving fresh pastries and espresso. Come in for a latte and a croissant, the barista has a new coffee special all week. " + "Day 2: Cozy mornings at the cafe with warm coffee and pastries. ".repeat(4);
  const v = G.judgeStep(cafe, { goal, title: "Write five captions", instructions: "Write one caption per day" });
  assert.equal(v.ok, false);
  assert.equal(v.kind, "off-brief");
  const good = "Day 1: Your listings deserve a movie. Everborn Productions turns a listing into a short video that brokers can post the same day. Send us the address and we handle the rest. " + "Day 2: Agents who show up on video get remembered. ".repeat(4);
  assert.equal(G.judgeStep(good, { goal, title: "Write five captions", instructions: "Write one caption per day" }).ok, true);
});

test("a task that is really about a cafe may write about a cafe", () => {
  const goal = "Write Instagram captions for Maple Street Cafe.";
  const text = "Fresh pastries and espresso every morning at Maple Street Cafe. " .repeat(5);
  assert.equal(G.checkOnBrief(text, { goal, title: "Captions" }).onBrief, true);
});

test("short outputs are never failed for being off brief", () => {
  assert.equal(G.checkOnBrief("Mon 8:00 AM", { goal: "Everborn schedule" }).onBrief, true);
});

test("search leaks: citations and 'supplied search results' are removed", () => {
  const raw = "Post at 8:00 AM [1][4] when brokers check email. The schedule follows the supplied search results [2]. Friday works well [3, 5].";
  const out = G.stripSearchLeaks(raw);
  assert.ok(!/\[\d/.test(out), out);
  assert.ok(!/supplied search results/i.test(out), out);
  assert.match(out, /Post at 8:00 AM/);
  assert.match(out, /Friday works well/);
  assert.equal(G.stripSearchLeaks("Nothing to clean here."), "Nothing to clean here.");
  // a list index in code is left alone
  assert.equal(G.stripSearchLeaks("Use items[i] and [x] boxes."), "Use items[i] and [x] boxes.");
});

test("web search runs only when the person asked for live information", () => {
  assert.equal(G.wantsSearch("Make a landing page for listing videos, single index.html"), false);
  assert.equal(G.wantsSearch("Write a 5-day Instagram campaign plan for brokers and save it as campaign.md"), false);
  assert.equal(G.wantsSearch("What is the latest news on mortgage rates?"), true);
  assert.equal(G.wantsSearch("Search the web for competitors of Everborn"), true);
});

test("the file name a task asks for", () => {
  assert.equal(G.namedFile("Build one mobile-friendly landing page, a single index.html, warm cinematic"), "index.html");
  assert.equal(G.namedFile("Write the plan. Save it to the project as campaign.md."), "campaign.md");
  assert.equal(G.namedFile("Save as notes.markdown"), "notes.md");
  assert.equal(G.namedFile("A woman on a beach"), "");
  assert.equal(G.namedFile("Visit www.example.com for more"), "");
  assert.equal(G.fileExt("index.html"), "html");
});
