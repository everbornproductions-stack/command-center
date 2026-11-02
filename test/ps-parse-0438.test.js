// 0.4.38 (dogfood 0436 batch-rename): PowerShell scripts are read by PowerShell's own parser (never run), so a script that
// does not parse fails the step's check instead of being saved as done.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { psParse, psParseLine } from "../server/ps-parse.js";
import { checkSavedScripts } from "../server/saved-file-checks.js";

const win = process.platform === "win32" ? false : "PowerShell's parser is checked on Windows only";

// the shape of the real rename-photos.ps1 from the 0.4.36 batch: a call with an empty argument
const BROKEN = "param([string]$Folder = '.')\nGet-ChildItem $Folder -Filter *.jpg | ForEach-Object {\n  $new = [System.IO.Path]::Combine($_.DirectoryName, )\n  Rename-Item $_.FullName $new\n}";
const GOOD = "param([string]$Folder = '.')\nGet-ChildItem $Folder -Filter *.jpg | ForEach-Object {\n  $new = Join-Path $_.DirectoryName ('photo-' + $_.Name)\n  Rename-Item $_.FullName $new -WhatIf\n}\n# a comment with an emoji 🐾 and café";

test("a broken script fails with its line and message; a good one parses; nothing is run", { skip: win }, async () => {
  const bad = await psParse(BROKEN);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].line, 3);
  assert.match(bad.errors[0].message, /^Missing (?:argument in parameter list|expression after)/);
  assert.match(psParseLine("rename-photos.ps1", bad.errors), /^rename-photos\.ps1 has a PowerShell syntax error on line 3: Missing .+\. Fix it so the whole script parses\.$/);
  assert.deepEqual(await psParse(GOOD), { ok: true });
  // a script that would make a file if it ran: parsing it makes nothing
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-psparse-"));
  const marker = path.join(dir, "ran.txt");
  try {
    assert.deepEqual(await psParse(`Set-Content -Path '${marker}' -Value 'ran'`), { ok: true });
    assert.equal(fs.existsSync(marker), false, "the script was parsed, not run");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("off Windows, or when PowerShell cannot start, nothing is checked and nothing fails", async () => {
  assert.deepEqual(await psParse(BROKEN, { platform: "linux" }), { ok: true, skipped: true });
  assert.deepEqual(await psParse(BROKEN, { platform: "win32", exe: "no-such-powershell-0438.exe" }), { ok: true, skipped: true });
});

test("a .ps1 saved at the end of a Mission gets the parse check too", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-pssave-"));
  try {
    const p = path.join(dir, "rename-photos.ps1"); fs.writeFileSync(p, BROKEN);
    const parse = async () => ({ ok: false, errors: [{ line: 3, message: "Missing argument in parameter list." }] });
    const r = await checkSavedScripts([{ ok: true, name: "rename-photos.ps1", path: p }], { goal: "a PowerShell script", parse });
    assert.equal(r.length, 1);
    assert.equal(r[0].ok, false);
    assert.equal(r[0].issue, "Saved, but it has a PowerShell syntax error on line 3: Missing argument in parameter list.");
    const good = await checkSavedScripts([{ ok: true, name: "rename-photos.ps1", path: p }], { goal: "x", parse: async () => ({ ok: true }) });
    assert.equal(good[0].ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the Mission runs the parser after the known-trap check and waits for it before the step's check", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "server", "mission.js"), "utf8");
  assert.match(src, /if \(\/\\\.ps1\$\/i\.test\(j\.name\) && !t\.psIssue\) \{/);
  assert.match(src, /sqlChecks\.push\(psParse\(j\.code\)/);
});
