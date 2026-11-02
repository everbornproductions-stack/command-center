// 0.4.38: fixes from the 0.4.37 persona panel (meldmind-panel-0437\FIXES-0439.md items 1, 3, 7 and 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeIntent } from "../web/make-intent.js";
import { userTextOf } from "../server/mock.js";
import { requestOf, practiceAnswer, practiceBody } from "../server/demo-answers.js";

const ROOT = path.join(import.meta.dirname, "..");

test("item 1: a request for code about photos is not made into a picture; real picture requests still are", () => {
  for (const q of ["A Node.js script that renames every photo in a folder", "Write a Python script to resize photos", "An app that sorts my photos", "A PowerShell script that copies my photos to a backup"]) assert.equal(makeIntent(q), null, q);
  for (const q of ["Make a picture of a cupcake", "A woman on a beach at sunset", "Make a logo for my app", "Make a photo of my bakery storefront at night"]) assert.equal(makeIntent(q)?.kind, "image", q);
  assert.equal(makeIntent("Make a 5 second video of waves rolling in")?.kind, "video");
});

test("item 3: in a chat that goes on, the practice AI answers the newest message, not the first one again", () => {
  const messages = [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Write a welcome line for my sourdough bakery." },
    { role: "assistant", content: "Welcome to our bakery!" },
    { role: "user", content: "Now write three Instagram captions for our cinnamon rolls." },
  ];
  const text = userTextOf(messages);
  assert.equal(requestOf(text), "Now write three Instagram captions for our cinnamon rolls.");
  assert.match(text, /sourdough bakery/, "the earlier message is still there for context");
  const first = practiceAnswer(userTextOf(messages.slice(0, 2)), "atlas-pro");
  assert.notEqual(practiceAnswer(text, "atlas-pro"), first, "the follow-up gets its own answer");
  assert.equal(userTextOf([{ role: "user", content: "One question." }]), "One question.");
  assert.equal(userTextOf([]), "");
});

test("item 7: the sidebar History list refreshes when a run finishes", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "features", "layout.js"), "utf8");
  assert.match(src, /if \(st\.wasBusy && !isBusy\) setTimeout\(\(\) => loadRecent\(true\), 600\);/);
});

test("item 8: a practice subject is cut at a word, never mid-word", () => {
  const body = practiceBody("Write a short open house flyer for 12 Oak St, 3 bed 2 bath, Saturday 1 to 4 for the neighborhood next week please", "atlas-pro");
  assert.doesNotMatch(body, /Saturday 1 t\b/);
});
