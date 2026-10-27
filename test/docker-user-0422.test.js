// 0.4.22 (Aikido): the hosted image runs as a non-root user, and CMD and HEALTHCHECK are still there.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";

const lines = fs.readFileSync(path.join(ROOT, "Dockerfile"), "utf8").replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());

test("Dockerfile switches to a non-root USER before CMD", () => {
  const user = lines.findIndex((l) => /^USER\s+/i.test(l));
  const cmd = lines.findIndex((l) => /^CMD\s+/i.test(l));
  assert.ok(user >= 0, "a USER line");
  assert.ok(cmd > user, "USER comes before CMD");
  const who = lines[user].split(/\s+/)[1];
  assert.notEqual(who, "root");
  assert.notEqual(who, "0");
});

test("Dockerfile keeps CMD, HEALTHCHECK and copies files owned by the app user", () => {
  assert.ok(lines.some((l) => l === 'CMD ["node", "server/index.js"]'));
  assert.ok(lines.some((l) => /^HEALTHCHECK\s/.test(l)));
  for (const l of lines.filter((x) => /^COPY\s/.test(x))) assert.match(l, /--chown=node:node/, l);
});
