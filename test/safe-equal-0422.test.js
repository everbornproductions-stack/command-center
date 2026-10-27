// 0.4.22 (Aikido): token compares are timing safe, through one shared helper.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { safeEqual } from "../server/safe-equal.js";

const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

test("safeEqual: equal, different, different length, non-strings", () => {
  assert.equal(safeEqual("abc123", "abc123"), true);
  assert.equal(safeEqual("abc123", "abc124"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(null, "a"), false);
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual(123, "123"), false);
  assert.equal(safeEqual({}, {}), false);
});

test("community newsletter token, the local token and webhook tokens use safeEqual", () => {
  const community = src("server/plugins/community.js");
  assert.doesNotMatch(community, /token !== current\.token/);
  assert.match(community, /safeEqual\(String\(token\)/);
  assert.match(src("server/index.js"), /return safeEqual\(String\(presented/);
  assert.match(src("server/schedules.js"), /return safeEqual\(sha\(presented\)/);
});
