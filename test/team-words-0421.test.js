import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTeamText, whoLine } from "../web/team-words.js";

test("People empty state names Extreme only on a lower plan, and says who you are to your team", () => {
  assert.match(emptyTeamText("free"), /part of Extreme/);
  assert.match(emptyTeamText("pro"), /part of Extreme/);
  assert.doesNotMatch(emptyTeamText("extreme"), /part of Extreme/);
  assert.match(emptyTeamText("owner"), /Together/);
  assert.match(whoLine("you"), /Sign in with Google or Microsoft/);
  assert.equal(whoLine("sam@example.com"), "Your team sees you as sam@example.com.");
});
