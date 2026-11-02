import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { kindOf, practiceAnswer, practiceBody, tableFor } from "../server/demo-answers.js";
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
  assert.match(js, /Sample task/i);
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

// 0.4.37 (panel 0435 item 1): script prompts remain code after the run instruction is appended.
test("practice script prompts stay code and reach the saved answer path", () => {
  for (const [language, ext] of [["JavaScript", "js"], ["Python", "py"], ["PowerShell", "ps1"], ["Google Sheets", "gs"], ["SQL", "sql"], ["Bash", "sh"]]) {
    const style = F.popularStyle("script", null);
    const prompt = F.buildPrompt("script", style, `A ${language} script that renames photos`);
    assert.equal(kindOf(prompt), "code", language);
    assert.match(practiceBody(prompt, "nova-ultra"), /```/, language);
    assert.ok(F.fileFor("script", style, `A ${language} script that renames photos`).endsWith(`.${ext}`));
  }
});

// 0.4.37 (panel 0435 item 6): panel examples must keep their requested answer type and key words.
test("panel practice requests get matching kinds, topics, and counts", () => {
  const cases = [
    ["lines", "Explain photosynthesis in 3 short lines", /photosynthesis/i, 3],
    ["lines", "Write 3 lines about spring at my bakery", /spring|bakery/i, 3],
    ["titles", "Give me 5 stream titles for Kai", /Kai/i, 5],
    ["titles", "Give me 5 headlines for our spring sale", /spring sale/i, 5],
    ["email", "Write an insurance renewal email", /renewal|premium|coverage/i],
    ["email", "Write a follow-up text after our meeting", /follow|meeting|discussed/i],
    ["table", "Make a price list for my shop", /price/i],
    ["table", "Make a schedule CSV with Job, Address, Date, Hours", /Job/i],
    ["table", "Make a wedding guest-list.csv", /RSVP|Guest/i],
    ["website", "Build plumber.html for a plumber", /tel:|<form/i],
    ["sop", "Make an SOP checklist for after-hours calls", /after-hours calls/i],
    ["howto", "How do I make a video call to my grandson?", /make a video call to my grandson/i],
  ];
  for (const [kind, req, mustInclude, count] of cases) {
    assert.equal(kindOf(req), kind, req);
    const body = practiceBody(req, "nova-ultra");
    assert.match(body, mustInclude, req);
    if (count) assert.equal(body.split("\n").filter((line) => /^\d+\./.test(line)).length, count, req);
  }
  assert.match(tableFor("Make a schedule CSV with Job, Address, Date, Hours").table, /Job.*Address.*Date.*Hours/s);
});

// 0.4.37 (panel 0435 item 7): generated data and language samples must parse when runtimes are present.
test("practice JSON, Python, and PowerShell samples use their language syntax", (t) => {
  const block = (text) => text.match(/```(?:json|python|powershell)\n([\s\S]*?)\n```/)?.[1];
  const json = block(practiceBody("Make a JSON file of sample contacts", "nova-ultra"));
  assert.ok(json);
  assert.doesNotThrow(() => JSON.parse(json));
  const py = block(practiceBody("Write a Python script to rename photos", "nova-ultra"));
  assert.ok(py);
  const python = process.env.PYTHON || "python";
  const pyCheck = spawnSync(python, ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: py, encoding: "utf8" });
  if (["ENOENT", "EPERM"].includes(pyCheck.error?.code)) t.diagnostic("Python unavailable or child processes blocked; Python syntax check skipped.");
  else assert.equal(pyCheck.status, 0, pyCheck.stderr);
  const ps = block(practiceBody("Write a PowerShell script to copy sermon files", "nova-ultra"));
  assert.ok(ps);
  assert.doesNotMatch(ps, /^\s*\/\//m);
  assert.match(ps, /^param\(/);
  const shell = spawnSync("powershell.exe", ["-NoProfile", "-Command", "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$tokens, [ref]$errors) > $null; if ($errors.Count) { $errors | Out-String; exit 1 }"], { input: ps, encoding: "utf8" });
  if (["ENOENT", "EPERM"].includes(shell.error?.code)) t.diagnostic("Windows PowerShell unavailable or child processes blocked; parser check skipped.");
  else assert.equal(shell.status, 0, shell.stderr);
});

// 0.4.37 review: a guest list with its own columns gets people, not shop products; JSON has the number of records asked
test("0.4.37: a guest list names people, and a JSON sample has as many records as were asked for", () => {
  const guests = practiceBody("Make a CSV guest list for my wedding with name, email and RSVP. Save it as guests.csv", "atlas-pro");
  assert.match(guests, /\| Name \| Email \| RSVP \|/);
  assert.doesNotMatch(guests, /Classic tee|Coffee mug|Tote bag/, "no products in a guest list");
  for (const [ask, n] of [["Give me a JSON product catalog with 15 product records. Save it as catalog.json", 15], ["Give me a JSON list of products", 3]]) {
    const body = practiceBody(ask, "nova-lite").match(/```json\n([\s\S]*?)\n```/)?.[1];
    assert.ok(body, ask);
    assert.equal(JSON.parse(body).length, n, ask);
  }
});
