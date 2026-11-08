// 0.5.2 (0.5.0 panel item 2): the new-subject guess was wrong about 1 time in 3. These are the panel's own script and
// pairs (meldmind-panel-050 harness pC.mjs C2b) plus held-out lines written after the rule, so it is not tuned to one list.
import test from "node:test";
import assert from "node:assert/strict";
import { goesOn } from "../web/simple-ui.js";

const SCRIPT = [
  ["Write a short thank-you note for a customer who bought a birthday cake", "new"],
  ["Make it warmer and mention our loyalty card", "same"],
  ["Now write an Instagram caption for our new sourdough loaf", "new"],
  ["Shorter please", "same"],
  ["Plan a staff schedule for Saturday with 4 people from 7 to 3", "new"],
  ["Give everyone a 30 minute lunch break", "same"],
  ["Write a reply to a 2-star review that says the bread was stale", "new"],
  ["Can you sound less defensive and offer a free loaf?", "same"],
  ["Write a LinkedIn post about this month's sales contest", "new"],
  ["What should I charge for a dozen cupcakes?", "new"],
  ["And for two dozen?", "same"],
  ["Write 10 YouTube titles for my Minecraft build video", "new"],
  ["Number 3 but funnier", "same"],
  ["Give me a packing list for a weekend camping trip", "new"],
  ["We have a toddler with us", "same"],
];
const PAIRS = [
  ["Write a thank-you note for a cake order", "Write a cover letter that highlights my sales experience", "new"],
  ["Write a thank-you note for a cake order", "Plan my son's birthday party and make it a dinosaur theme", "new"],
  ["Write a thank-you note for a cake order", "Add our phone number at the end", "same"],
  ["Write a thank-you note for a cake order", "Put a P.S. about Valentine's preorders", "same"],
  ["Write a thank-you note for a cake order", "Sign it from Dana and the team", "same"],
  ["Write a thank-you note for a cake order", "What are the best Instagram hashtags for a bakery this week?", "new"],
  ["Write a listing for 12 Oak St, 3 bed 2 bath", "Mention the new roof and the big backyard", "same"],
  ["Write a listing for 12 Oak St, 3 bed 2 bath", "Write a text to my client that the inspection is Tuesday", "new"],
  ["Write a listing for 12 Oak St, 3 bed 2 bath", "Now one for 44 Pine Ave, 2 bed 1 bath", "same"],
  ["Give me 10 YouTube titles for my Minecraft video", "Make number 4 longer", "same"],
  ["Give me 10 YouTube titles for my Minecraft video", "Write a script for a 30 second TikTok about my new mod", "new"],
  ["Make a spreadsheet of my monthly bills", "Add a column for the due date", "same"],
  ["Make a spreadsheet of my monthly bills", "Help me write a letter to my landlord about the broken heater", "new"],
  ["Plan a weekly meal plan for a family of four", "No fish, my daughter is allergic", "same"],
  ["Plan a weekly meal plan for a family of four", "Draft an email to the school about early pickup on Friday", "new"],
  ["Write a Python script that renames my photos by date", "It says permission denied on line 12", "same"],
  ["Write a Python script that renames my photos by date", "What is a good laptop for video editing under $1000?", "new"],
  ["Write an SOP for opening the shop in the morning", "Also one for closing", "same"],
  ["Write an SOP for opening the shop in the morning", "Write a job ad for a part-time cashier", "new"],
  ["Summarize this contract clause for my client", "Is that enforceable in California?", "same"],
];
// written after the rule, not used to tune it
const HELD_OUT = [
  ["Write a welcome email for new gym members", "Make it sound more excited", "same"],
  ["Write a welcome email for new gym members", "Write a flyer for our yoga class on Sunday", "new"],
  ["Plan a road trip from Sacramento to Portland", "We want to stop in Redding for lunch", "same"],
  ["Plan a road trip from Sacramento to Portland", "How do I reset my router?", "new"],
  ["Make a budget for my coffee shop", "Can you add a line for rent?", "same"],
  ["Make a budget for my coffee shop", "Write a poem about my grandmother's garden", "new"],
  ["Explain how compound interest works", "Why does it grow faster later?", "same"],
  ["Write a cover letter for a sales job", "Write another one for a manager job", "same"],
];

test("unit 0.5.2: the panel's script and pairs, all 34 lines right", () => {
  let right = 0; const wrong = [];
  let earlier = [SCRIPT[0][0]];
  for (const [text, meant] of SCRIPT.slice(1)) {
    const got = goesOn(text, earlier) ? "same" : "new";
    if (got === meant) right++; else wrong.push(`${text} (meant ${meant})`);
    if (got === "same") earlier.push(text); else earlier = [text];
  }
  for (const [a, b, meant] of PAIRS) {
    const got = goesOn(b, [a]) ? "same" : "new";
    if (got === meant) right++; else wrong.push(`${b} (meant ${meant})`);
  }
  assert.ok(right >= 34, `right ${right} of 34; wrong: ${wrong.join(" | ")}`);
});

test("unit 0.5.2: held-out lines the rule was not tuned on", () => {
  const wrong = HELD_OUT.filter(([a, b, meant]) => (goesOn(b, [a]) ? "same" : "new") !== meant).map(([, b, meant]) => `${b} (meant ${meant})`);
  assert.ok(wrong.length <= 1, `wrong: ${wrong.join(" | ")}`);
});

test("unit 0.5.2: very short messages always go on", () => {
  assert.equal(goesOn("Shorter please", ["Write a poem"]), true);
  assert.equal(goesOn("make it rhyme", ["Write a poem"]), true);
});
