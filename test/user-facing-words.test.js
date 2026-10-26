// N14 / I11: user-facing text spells "License" (US) and keeps jargon out of Simple copy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["vendor", "node_modules"].includes(f.name)) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else if (/\.(js|html|md)$/.test(f.name)) out.push(p);
  }
  return out;
}
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

test("no 'licence' in user-facing strings (identifiers, reason codes and file ids are exempt)", () => {
  const bad = [];
  for (const dir of ["web", "server", "docs/help"]) {
    for (const f of walk(path.join(root, dir))) {
      read(f).split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line) || /import[ (]/.test(line) || /keywords:/.test(line) || /id: "licence"/.test(line)) return;
        const m = line.replace(/(no_|^|[^A-Za-z_-])licence_[a-z_$]+/gi, "$1").replace(/licence-session/g, "");
        if (/(?<![A-Za-z_-])[Ll]icence(?![A-Za-z_-])/.test(m)) bad.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(bad, []);
});

test("Simple copy has no developer jargon (Expert-only areas may use it)", () => {
  const banned = /\b(AI Movement|Stacked steps|MCP|webhooks?)\b/;
  for (const f of ["web/features/tour.js", "web/features/walkthrough.js", "web/copy-guard.js", "web/council-offer.js"]) {
    const src = read(path.join(root, f));
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      assert.doesNotMatch(line, banned, `${f}:${i + 1}`);
    });
  }
  const simple = read(path.join(root, "web", "simple-ui.js")).split("\n").filter((l) => !/expertLine/.test(l)).join("\n");
  assert.doesNotMatch(simple.replace(/\/\/.*$/gm, ""), banned);
});
