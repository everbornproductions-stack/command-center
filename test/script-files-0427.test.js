// 0.4.27 (dogfood batch 2): Google Apps Script (.gs) counts as a named file, and a single unnamed code block
// fills a script file (.ps1, .sql, .gs) instead of the whole chat answer being saved as the script.
import test from "node:test";
import assert from "node:assert/strict";
import { namedFiles } from "../server/step-guard.js";
import { fileBody } from "../server/named-file.js";

test(".gs is found as a named file in a full Windows path", () => {
  assert.deepEqual(namedFiles(String.raw`Write a Google Apps Script. Save it as C:\Users\pat\Desktop\x\stale-leads.gs`), ["stale-leads.gs"]);
});

test("a single code block is the whole script, not the chat around it", () => {
  const answer = "Here is your script.\n\n```powershell\nparam([string]$Folder)\nGet-ChildItem $Folder\n```\n\nRun it with -Folder.";
  assert.equal(fileBody(answer, "rename-photos.ps1"), "param([string]$Folder)\nGet-ChildItem $Folder\n".trimEnd() + (fileBody(answer, "rename-photos.ps1").endsWith("\n") ? "\n" : ""));
  assert.ok(!fileBody(answer, "rename-photos.ps1").includes("Here is your script"));
  const sql = "Schema below.\n\n```sql\nCREATE TABLE members(id INTEGER PRIMARY KEY);\n```\n";
  assert.match(fileBody(sql, "gym.sql"), /^CREATE TABLE members/);
  const gs = "```javascript\nfunction onOpen() {}\n```";
  assert.match(fileBody(gs, "stale-leads.gs"), /^function onOpen/);
});
