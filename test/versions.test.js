// 0.4.21 Melius ideas: versions of a result, the cost line before a run, Show steps. Mock/demo only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { changePartPrompt, tryAgainPrompt } from "../server/versions.js";
import { lineFor } from "../server/precost.js";
import { versionTabs, stepRows, costLineHtml } from "../web/features/versions-core.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("unit: change prompt quotes the old result and refuses an empty change", () => {
  const p = changePartPrompt({ prompt: "Write a tagline", text: "Old line", change: "make it shorter" });
  assert.match(p, /Write a tagline/); assert.match(p, /Old line/); assert.match(p, /Change only this part.*make it shorter/);
  assert.throws(() => changePartPrompt({ prompt: "x", text: "y", change: "  " }), /Say what to change/);
  assert.equal(tryAgainPrompt("  hi "), "hi");
});

test("unit: cost line says Free or a rough price, tabs and steps read plainly", () => {
  assert.equal(lineFor(null).line, "");
  assert.equal(lineFor({ provider: "groq", free: true, estCost: 0 }).free, true);
  assert.match(lineFor({ provider: "groq", free: true, estCost: 0 }).line, /^Free: /);
  assert.match(lineFor({ provider: "anthropic", estCost: 0.0234 }).line, /^About \$0\.02 on /);
  assert.match(lineFor({ provider: "anthropic", estCost: 0.001 }).line, /less than 1 cent/);
  assert.deepEqual(versionTabs([{ n: 1 }, { n: 2 }], 2).map((t) => [t.label, t.on]), [["Version 1", false], ["Version 2", true]]);
  const rows = stepRows({ mission: { tasks: [{ title: "Draft", status: "done", provider: "groq" }, { title: "Review", status: "failed" }] } });
  assert.equal(rows[0].line, "1. Draft, done, by groq"); assert.match(rows[1].line, /did not finish/);
  assert.equal(costLineHtml({ line: "" }), "");
  for (const f of ["server/versions.js", "server/precost.js", "web/features/versions.js", "web/features/versions-core.js"]) assert.doesNotMatch(read(...f.split("/")), /[–—]/, f);
});

test("server: versions are kept in order, never overwritten, and found by run id", { timeout: 60000 }, async () => {
  const s = await startServer();
  try {
    const a = await s.api("/versions", { method: "POST", body: { key: "r-1", runId: "r-1", prompt: "Tagline", text: "First" } });
    assert.equal(a.status, 200); assert.equal(a.json.version.n, 1);
    const b = await s.api("/versions", { method: "POST", body: { key: "r-1", runId: "r-2", prompt: "Tagline", text: "Second", how: "again" } });
    assert.equal(b.json.version.n, 2); assert.equal(b.json.version.how, "again");
    const dup = await s.api("/versions", { method: "POST", body: { key: "r-1", runId: "r-2", text: "Second" } });
    assert.equal(dup.json.added, false); assert.equal(dup.json.count, 2);
    const list = (await s.api("/versions?key=r-1")).json;
    assert.deepEqual(list.versions.map((v) => v.text), ["First", "Second"]);
    const byRun = (await s.api("/versions?run=r-2")).json;
    assert.equal(byRun.key, "r-1"); assert.equal(byRun.versions.length, 2);
    assert.equal((await s.api("/versions?key=nope")).json.versions.length, 0);
    assert.equal((await s.api("/versions", { method: "POST", body: { key: "r-9", runId: "r-9", text: "  " } })).status, 400);
    const ch = await s.api("/versions/change-prompt", { method: "POST", body: { prompt: "P", text: "T", change: "shorter" } });
    assert.match(ch.json.prompt, /shorter/);
    assert.equal((await s.api("/versions/change-prompt", { method: "POST", body: { prompt: "P", text: "T", change: "" } })).status, 400);
    const pc = await s.api("/precost", { method: "POST", body: { prompt: "Write a short tagline for a bakery" } });
    assert.equal(pc.status, 200); assert.equal(typeof pc.json.line, "string");
    assert.equal((await s.api("/precost", { method: "POST", body: { prompt: "" } })).json.line, "");
  } finally { await s.stop(); }
});

test("wiring: the feature is a shell module and sends only through the Send button", () => {
  assert.match(read("web", "perf", "registry.js"), /id: "versions", shell: true/);
  const f = read("web", "features", "versions.js");
  assert.match(f, /go\.click\(\)/); assert.match(f, /Try again/); assert.match(f, /Change this part/); assert.match(f, /Show steps/);
  assert.doesNotMatch(f, /api\("\/(chat|mission|council)"/, "no second send path");
});
