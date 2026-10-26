import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chatRows, isInternalPrompt } from "../server/desk.js";
import { plainPaths } from "../server/projects.js";

test("internal planning prompts are not listed as chats", () => {
  assert.equal(isInternalPrompt("WALKTHROUGH_PLAN\nsteps"), true);
  assert.equal(isInternalPrompt("Write a post about tea"), false);
  const rows = chatRows([
    { id: "a", kind: "single", title: "WALKTHROUGH_PLAN", prompt: "WALKTHROUGH_PLAN x", status: "done" },
    { id: "b", kind: "single", title: "Write a post", prompt: "Write a post", status: "done" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["b"]);
});

test("raw file paths become plain words", () => {
  assert.equal(plainPaths("Open C:\\Users\\x\\AppData\\Local\\Temp\\a.txt now"), "Open a file on this computer now");
  assert.equal(plainPaths("See /tmp/abc/def.md please"), "See a file on this computer please");
  assert.equal(plainPaths("Ship it?"), "Ship it?");
});

test("the connect wizard does not reopen after welcome", () => {
  const src = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(src, /!S\.visitedConnect && !S\.settings\?\.onboarded && S\.connectSetup\?\.show/);
});
