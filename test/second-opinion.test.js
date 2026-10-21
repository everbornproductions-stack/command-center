// Phase 58. Two answers, plain differences, both kept. Demo spends nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findDisagreements } from "../server/second-opinion.js";
import { startServer, waitBudget } from "./helpers.js";

const MARK = "ZEBRAQUILL8841";

test("disagreements are plain words and a matching pair is not a disagreement", () => {
  const left = "The listing price should stay at the number already given by the seller.";
  const right = "Raise the asking price before the open house this weekend.";
  const diff = findDisagreements(left, right);
  assert.equal(diff.agree, false);
  assert.ok(diff.points.length >= 1);
  assert.match(diff.points[0].left, /listing price/);
  assert.match(diff.points[0].right, /asking price/);
  assert.equal(findDisagreements(left, left).agree, true);
  const src = fs.readFileSync(new URL("../server/second-opinion.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\u2014/);
  const app = fs.readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  assert.match(app, /data-m="opinion"/);
  assert.match(app, /\/opinion/);
});

test("demo second opinion keeps both answers and costs nothing", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const prompt = `Plan a one week launch for a bakery. Include three captions and a posting day. Marker ${MARK} is only for this test.`;
    const started = await s.api("/opinion", { method: "POST", body: { prompt } });
    assert.equal(started.status, 202, started.text);
    assert.ok(started.json.runId);
    const budget = waitBudget(40000);
    const t0 = Date.now();
    let full = null;
    while (Date.now() - t0 < budget && !full) {
      const list = await s.api("/missions");
      const row = list.json.find((m) => m.id === started.json.runId);
      if (row && ["done", "failed"].includes(row.status)) {
        full = await s.api(`/missions/${row.id}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert.ok(full?.json, "second opinion did not finish");
    assert.equal(full.json.kind, "opinion");
    assert.equal(full.json.status, "done");
    assert.equal(full.json.cost, 0);
    assert.equal(full.json.answers.length, 2);
    assert.ok(full.json.answers[0].text && full.json.answers[1].text);
    assert.ok(full.json.answers[0].provider !== full.json.answers[1].provider);
    assert.match(full.json.deliverable, /Where they differ/);
    assert.match(full.json.deliverable, new RegExp(full.json.answers[0].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const exp = await s.api("/brain/export");
    assert.equal(exp.status, 200);
    assert.equal(exp.text.includes(MARK), false, "the learning router does not keep the prompt");
    assert.equal(s.log.includes(MARK), false);
  } finally { await s.stop(); }
});
