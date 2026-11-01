// 0.4.35 (dogfood menu-docx on 0.4.32): an Italian restaurant menu with espresso, latte and pastries was thrown away as
// "about a cafe". Places that serve food are one family; a cafe answer to a gym task is still caught.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOnBrief } from "../server/step-guard.js";

const MENU = "STARTERS\nBruschetta with tomato and basil, 9 dollars\nCalamari fritti, 12\n\nPASTA\nSpaghetti carbonara, 18\n\nDESSERTS\nTiramisu with espresso, 9\nCannoli pastries, 8\n\nDRINKS\nEspresso 3, Latte 4, Italian soda 4\n\nGluten-free pasta is available on request.";

test("a restaurant menu that lists coffee and pastries is on the brief", () => {
  assert.equal(checkOnBrief(MENU, { goal: "Make a restaurant menu as a Word document for a small Italian place", title: "Draft menu items" }).onBrief, true);
  assert.equal(checkOnBrief(MENU, { goal: "Write the lunch menu for our pizza place", title: "Menu" }).onBrief, true);
});

test("a cafe answer to a gym task is still caught", () => {
  const cafe = "Our barista team serves the best latte and espresso in town. Visit our coffee shop for pastries and a fresh latte every morning, with espresso drinks all day.";
  const r = checkOnBrief(cafe, { goal: "Write a welcome post for our gym and fitness classes", title: "Gym welcome post" });
  assert.equal(r.onBrief, false);
  assert.match(r.reason, /about a cafe/);
});
