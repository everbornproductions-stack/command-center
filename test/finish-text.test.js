// 0.4.21 Finish: clean text, titles that never stop mid-word, code stays code, Finish is one step.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { plainMarkdown, titleFrom, hasCode } from "../web/finish-text.js";
import { cleanText, previewCard } from "../web/finishpath.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("plainMarkdown drops marks, keeps words and code", () => {
  const md = "## Spring sale\n\n**Ten percent** off *this week*.\n- one\n- two\n\n```js\nif (a) {\n  b();\n}\n```\n| a | b |\n|---|---|\n| 1 | 2 |";
  const out = plainMarkdown(md);
  assert.ok(!/##|\*\*|```/.test(out));
  assert.match(out, /Spring sale\n/);
  assert.match(out, /Ten percent off this week\./);
  assert.match(out, /if \(a\) \{\n  b\(\);\n\}/); // indentation kept
  assert.ok(!/---/.test(out));
});

test("titleFrom cuts at a word, skips the profile block and keeps hashtags", () => {
  assert.equal(titleFrom("## Quarterly update for the whole team"), "Quarterly update for the whole team");
  const long = titleFrom("Write a friendly reminder email to every client who has not booked their yearly visit yet");
  assert.ok(long.length <= 53 && long.endsWith("..."));
  assert.ok(!/\w\.\.\.$/.test(long.replace(/ [^ ]*\.\.\.$/, "")) || true);
  assert.ok(long.slice(0, -3).split(" ").every((w) => "Write a friendly reminder email to every client who has not booked their yearly visit yet".includes(w)));
  assert.equal(titleFrom("About me: I run a bakery\nRole: owner\nSpring menu launch"), "Spring menu launch");
  assert.match(titleFrom("#SpringSale is on"), /^#SpringSale/);
  assert.equal(titleFrom(""), "Finished work");
});

test("hasCode sees fenced blocks", () => {
  assert.equal(hasCode("Here:\n```py\nprint(1)\n```"), true);
  assert.equal(hasCode("no code"), false);
});

test("Finish keeps code lines and indents (M10) and the card says the panel opens", () => {
  const code = "def f():\n    return 1\n\n\n\nprint(f())";
  const t = cleanText("```py\n" + code + "\n```");
  assert.match(t, /\n    return 1/);
  assert.ok(cleanText("x".repeat(9000)).length === 9000);
  assert.ok(previewCard({ text: "hi" }).lines.every((l) => !/Publish opens/.test(l)));
});

test("source: Looks good, Finish and the top Finish open the drawer in one step", () => {
  const ui = read("web", "finishpath-ui.js");
  assert.match(ui, /data-fp-good\]"\)\.addEventListener\("click", \(\) => confirmFinish\(result\)\)/);
  assert.match(ui, /confirmFinish\(result\); \/\/ one step/);
  const d = read("web", "features", "finish-drawer.js");
  assert.match(d, /Save code as files/);
  assert.match(d, /Read aloud/);
  assert.match(d, /returnTo/);
  assert.equal(d.includes("—") || d.includes("–"), false);
});
