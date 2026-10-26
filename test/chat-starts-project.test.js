// Chat starts the project steps when someone asks it to make a website or another project.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { projectIntent } from "../web/project-intent.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("what counts as a project request", () => {
  const yes = {
    "Make me a one-page website for my dog-walking business": "website",
    "Can you build me a landing page for my product?": "website",
    "Build a mobile app for tracking runs": "app",
    "Write a business plan for my bakery": "business-plan",
    "Create a new marketing campaign for spring": "marketing",
    "I want a music video for my song": "music-video",
    "Make 4 reels for my guitar brand": "reels",
  };
  for (const [text, type] of Object.entries(yes)) assert.equal(projectIntent(text), type, text);
  for (const text of ["How do I make a website?", "What is a landing page", "make my website faster please", "Make the app login faster", "Explain what a business plan is", "hi", "x".repeat(700)]) {
    assert.equal(projectIntent(text), "", text);
  }
});

test("send wires the intent, with a way back to a plain chat", async () => {
  const app = read("web", "app.js");
  assert.match(app, /import \{ projectIntent \} from "\.\/project-intent\.js"/);
  assert.match(app, /startProject\.startFromChat\(kind, prompt\)/);
  const walk = read("web", "features", "walkthrough.js");
  assert.match(walk, /Answer in chat instead/);
  assert.match(walk, /Nothing is built or sent until you click/);
  assert.equal(/[–—]/.test(read("web", "project-intent.js") + walk), false);
  const s = await startServer();
  try {
    const w = (await s.api("/walkthrough", { method: "POST", body: { type: "website", experience: "simple" } })).json;
    const idea = await s.api(`/walkthrough/${w.id}/idea`, { method: "POST", body: { idea: "Make me a one-page website for my dog-walking business", experience: "simple" } });
    assert.equal(idea.status, 200);
    assert.equal(idea.json.stage, "questions", "the idea moves the project on to the questions");
  } finally { await s.stop(); }
});
