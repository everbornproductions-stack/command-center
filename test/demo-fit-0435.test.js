import test from "node:test";
import assert from "node:assert/strict";
import { kindOf, practiceAnswer } from "../server/demo-answers.js";
import { makeIntent } from "../web/make-intent.js";
import * as F from "../web/mac/data/flow.js";

test("practice answers follow the request and keep the requested shape", () => {
  const cases = [
    ["review", "Reply to a review for my bakery", /review/i],
    ["email", "Write an insurance renewal letter for my shop", /renewal|insurance/i],
    ["legal", "Write a note to opposing counsel about the hearing", /opposing counsel|hearing/i],
    ["credit", "Write a credit repair update for my client", /credit repair|credit update/i],
    ["listing", "Write an open house flyer for my Oak Street home", /open house|Oak Street/i],
    ["sop", "Make an SOP checklist for after-hours calls", /SOP|checklist|after-hours/i],
    ["howto", "How do I change the oil in my lawn mower? Short steps please.", /lawn mower/i],
    ["website", "Build a website for my bakery called Sunny Crumb", /Sunny Crumb/i],
    ["code", "A Node.js script that renames every photo in a folder", /renames every photo/i],
    ["titles", "Give me 10 YouTube title ideas for a video on budget keyboards", /budget keyboards/i],
    ["post", "Write social posts for my yoga studio", /yoga studio/i],
  ];
  for (const [expected, ask, words] of cases) {
    assert.equal(kindOf(ask), expected, ask);
    assert.match(practiceAnswer(ask, "nova-ultra"), words, ask);
  }
  const three = practiceAnswer("Give me 3 lines about my bakery", "nova-ultra").split("\n").filter((l) => /^\d+\./.test(l));
  assert.equal(three.length, 3);
  const ten = practiceAnswer(cases.find((c) => c[0] === "titles")[1], "nova-ultra").split("\n").filter((l) => /^\d+\./.test(l));
  assert.equal(ten.length, 10);
  const html = practiceAnswer("Build a website for my bakery called Sunny Crumb", "nova-ultra");
  assert.match(html, /<html[\s>]/i);
  assert.match(html, /Sunny Crumb/);
  const js = practiceAnswer(cases.find((c) => c[0] === "code")[1], "nova-ultra");
  assert.match(js, /```js[\s\S]*renames every photo/i);
  assert.match(js, /Practice answer/i);
  for (const ask of cases.map((x) => x[1])) assert.match(practiceAnswer(ask, "sage-mini"), /Sample answer: add a key for real answers/);
});

test("video words do not trigger video generation, but a video request still does", () => {
  assert.notEqual(makeIntent("Give me 10 YouTube title ideas for a video on the best budget mechanical keyboards under $50")?.kind, "video");
  assert.equal(makeIntent("make a short video of my bakery")?.kind, "video");
});

test("script filenames follow language words while retaining the safe JavaScript prompt wording", () => {
  const cases = [
    ["Node.js script renames photos", "js"], ["PowerShell script renames photos", "ps1"],
    ["Google Sheets script marks rows", "gs"], ["SQLite query searches photos", "sql"],
    ["HTML web page for photos", "html"], ["Python script renames photos", "py"],
  ];
  for (const [words, ext] of cases) {
    const style = F.popularStyle("script", null);
    assert.equal(F.extFor("script", style, words), ext, words);
    assert.ok(F.fileFor("script", style, words).endsWith(`.${ext}`), words);
  }
  const ask = "A Node.js script that renames every photo in a folder to its date taken, with a dry-run flag";
  const goal = F.buildPrompt("script", F.popularStyle("script", null), ask);
  assert.match(goal, /Save it as [^ ]+\.js$/);
  assert.doesNotMatch(goal, /node-js/i);
  assert.match(goal, /JavaScript program for Node/);
  assert.equal(F.extFor("script", F.popularStyle("script", null), "Bash shell script"), "sh");
});
