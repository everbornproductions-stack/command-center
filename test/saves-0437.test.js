// 0.4.37 (dogfood 0434): regression checks for Office repairs, code continuation, and QA handoff.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { continuePrompt, joinContinuation, checkTruncation, jsonBody, validJson } from "../server/step-guard.js";
import { needsOfficeContentFix } from "../server/named-file.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Office save repair only triggers when an Office save lacks content and the answer contains code", () => {
  assert.equal(needsOfficeContentFix("Not saved: there was no table to put in the spreadsheet.", "```python\nmake_sheet()\n```", "invoice.xlsx"), true);
  assert.equal(needsOfficeContentFix("Not saved: there was no table to put in the spreadsheet.", "No content here.", "invoice.xlsx"), false);
  assert.equal(needsOfficeContentFix("Not saved: could not be read back.", "```python\nmake_sheet()\n```", "invoice.xlsx"), false);
  assert.equal(needsOfficeContentFix("Not saved: the answer was a script that would build the document, not the document itself.", "Run this with python-docx.", "aftercare.docx"), true, "a Word answer that was a generator script");
});

test("code carry-on asks for code only and joins within the open fence", () => {
  const start = "```json\n{\n  \"items\": [\n    { \"name\": \"A\" },";
  const prompt = continuePrompt(start, "json");
  assert.match(prompt, /code only/);
  assert.match(prompt, /Do not repeat any code, add prose, or open or close a code fence/);
  const joined = joinContinuation(start, "```json\n    { \"name\": \"B\" }\n  ]\n}\n```");
  assert.equal((joined.match(/```/g) || []).length, 2);
  assert.equal(checkTruncation(joined, { ext: "json" }).truncated, false);
  assert.doesNotThrow(() => JSON.parse(joined.match(/```json\n([\s\S]*?)\n```/)[1]));
});

test("an unreadable reviewer gets two attempts, then the QA loop moves to another reviewer", () => {
  const src = fs.readFileSync(path.join(root, "server", "mission.js"), "utf8");
  assert.match(src, /for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  assert.match(src, /for \(const rv of reviewers\)/);
  assert.match(src, /Trying the next reviewer, if one is ready\./);
});

test("the JSON check only runs on something that looks like JSON, and only a broken one gets the extra ask", () => {
  assert.equal(jsonBody("Here is your plan for the week. No JSON at all."), null, "prose: no check, no extra AI call");
  assert.equal(validJson(jsonBody("```json\n{\"a\": [1, 2]}\n```")), true);
  assert.equal(validJson(jsonBody("Intro line.\n```\n[{\"sku\": \"C-1\"}]\n```\nDone.")), true, "a bare fence counts");
  assert.equal(validJson(jsonBody("```json\n{\"items\": [{\"name\": \"A\"},")), false, "cut off: the one replacement ask runs");
  assert.equal(validJson(jsonBody("  {\"whole\": true}  ")), true, "an answer that is only JSON");
  const src = fs.readFileSync(path.join(root, "server", "mission.js"), "utf8");
  assert.equal((src.match(/const body = jsonBody\((?:cur|text)\);/g) || []).length, 2, "both the step and the final answer use it");
  assert.match(src, /The one correction came back empty\./, "an empty correction never wipes the step's answer");
});