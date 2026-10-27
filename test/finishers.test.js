// Slice C5: category finishers (flag: finishers).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import { splitSections, joinSections, claimsOf, accountingTotals, accountingCsv, slidesFromOutline, slidesHtml, musicPlan, normalize, testProgram, testAutomation, gameProblems, KINDS } from "../server/finishers.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);

test("flag is on by default (0.4.21 restore), env forces it, other flags stay", () => {
  const was = process.env.CC_FLAG_FINISHERS;
  try {
    delete process.env.CC_FLAG_FINISHERS;
    assert.equal(flagOn("finishers"), true);
    assert.equal(flagView().finishers, true);
    assert.equal(flagView().finishrouter, true);
    assert.ok("projectbar" in flagView() && "nextactions" in flagView());
    process.env.CC_FLAG_FINISHERS = "1";
    assert.equal(flagView().finishers, true);
  } finally { if (was === undefined) delete process.env.CC_FLAG_FINISHERS; else process.env.CC_FLAG_FINISHERS = was; }
});

test("document sections split and join, claims are found", () => {
  const md = "Intro line\n\n# One\n\nText 1\n\n## Two\n\nSales grew 40% in 2025.\n";
  const s = splitSections(md);
  assert.deepEqual(s.map((x) => x.title), ["", "One", "Two"]);
  assert.match(joinSections(s), /## Two/);
  assert.equal(splitSections(joinSections(s)).length, 3);
  assert.deepEqual(claimsOf(md), ["Sales grew 40% in 2025."]);
  assert.equal(splitSections("```\n# not a heading\n```").length, 1);
});

test("accounting totals use whole cents and the csv guards formulas", () => {
  const data = normalize("accounting", { taxRate: 10, rows: [{ description: "=HYPERLINK(1)", qty: 3, price: 0.1 }, { description: "Work, \"big\"", qty: 2, price: 19.99 }] });
  const t = accountingTotals(data);
  assert.equal(t.rows[0].amount, 0.3);
  assert.equal(t.subtotal, 40.28);
  assert.equal(t.tax, 4.03);
  assert.equal(t.total, 44.31);
  const csv = accountingCsv(data);
  assert.match(csv, /'=HYPERLINK\(1\)/);
  assert.match(csv, /"Work, ""big"""/);
});

test("presentation outline, theme and safe html", () => {
  const s = slidesFromOutline("# Hello\n- one\n- two\n# Bye\nthanks");
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].bullets, ["one", "two"]);
  const d = normalize("presentation", { theme: "nope", slides: [{ title: "<script>x</script>", bullets: ["a"] }] });
  assert.equal(d.theme, "light");
  assert.equal(slidesHtml(d, "T").includes("<script>x"), false);
});

test("music plan makes cues and a mix command", () => {
  const d = normalize("music", { tracks: [{ name: "A", start: 2, length: 20, volume: 80, fadeIn: 1, fadeOut: 2 }, { name: "B" }] });
  const p = musicPlan(d);
  assert.equal(p.cues.length, 2);
  assert.match(p.ffmpeg, /amix=inputs=2/);
  assert.match(p.ffmpeg, /afade=t=out/);
});

test("program test reads code and never runs it", async () => {
  globalThis.__ran = false;
  const bad = await testProgram({ language: "javascript", code: "globalThis.__ran = true; function (" });
  assert.equal(bad.ok, false);
  const ok = await testProgram({ language: "javascript", code: "globalThis.__ran = true;" });
  assert.equal(ok.ok, true);
  assert.equal(globalThis.__ran, false, "compile only");
  assert.equal((await testProgram({ language: "javascript", code: "eval('1')" })).ok, false);
  assert.equal((await testProgram({ language: "javascript", code: "" })).ok, false);
});

test("automation test lists steps, flags outside reach, checks the repeat", async () => {
  const r = await testAutomation(normalize("automation", { steps: ["Summarize the news", "Email the team"], when: { type: "cron", cron: "0 9 * * 1-5" } }));
  assert.equal(r.ok, true);
  assert.equal(r.steps[1].wouldReachOut, true);
  assert.equal(r.steps[1].result, "listed only");
  const bad = await testAutomation(normalize("automation", { steps: ["a"], when: { type: "cron", cron: "bogus" } }));
  assert.equal(bad.ok, false);
  assert.equal((await testAutomation(normalize("automation", {}))).ok, false);
});

test("game items check for duplicates", () => {
  assert.equal(gameProblems(normalize("game", { items: [{ name: "Orc" }, { name: "orc" }] })).length, 1);
  assert.equal(gameProblems(normalize("game", { items: [{ name: "Orc", type: "bogus", hp: -5 }] })).length, 0);
  assert.equal(normalize("game", { items: [{ name: "Orc", hp: -5 }] }).items[0].hp, 0);
});

test("no em dashes in the new files, and text is cleaned", () => {
  for (const f of [["server", "finishers.js"], ["server", "plugins", "finishers.js"], ["web", "features", "finishers.js"], ["test", "finishers.test.js"]]) assert.equal(read(...f).includes(DASH), false, f.join("/"));
  assert.equal(normalize("music", { notes: "a " + DASH + " b" }).notes.includes(DASH), false);
  assert.equal(KINDS.length, 7);
});

test("web feature is registered lazily for the publish view and every button is wired", () => {
  assert.match(read("web", "perf", "registry.js"), /id: "finishers", views: \["publish"\]/);
  assert.match(read("web", "features", "publish.js"), /mountFinishers/);
  const web = read("web", "features", "finishers.js");
  for (const m of web.matchAll(/data-act="([a-z]+)"/g)) if (m[1] !== "claim") assert.match(web, new RegExp(`\\b${m[1]}:`), `no handler for ${m[1]}`);
  assert.match(web, /overflow-wrap:anywhere/);
});

test("flag off: every route says so", async () => {
  const s = await startServer({ env: { CC_FLAG_FINISHERS: "0", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.finishers, false);
    const r = await s.api("/finishers/items");
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "flag_off");
  } finally { await s.stop(); }
});

test("flag on: documents, accounting approval, automation gates, programs", async () => {
  const s = await startServer({ env: { CC_FLAG_FINISHERS: "1", CC_DEV_OWNER: "1" } });
  const api = (p, o) => s.api("/finishers" + p, o);
  try {
    assert.equal((await s.api("/state")).json.flags.finishers, true);
    assert.equal((await api("/kinds")).json.kinds.length, 7);
    assert.equal((await api("/items", { method: "POST", body: { kind: "nope" } })).status, 400);

    // document
    const d = (await api("/items", { method: "POST", body: { kind: "document", title: "Plan", seed: "# A\n\nOne\n\n# B\n\nTwo 2025" } })).json;
    assert.equal(d.data.sections.length, 2);
    const e = (await api(`/items/${d.id}/section`, { method: "POST", body: { index: 1, text: "Changed " + DASH } })).json;
    assert.equal(e.data.sections[1].text.includes(DASH), false);
    assert.equal(e.data.sections[0].text, "One");
    const md = (await api(`/items/${d.id}/export`, { method: "POST", body: { format: "md" } })).json;
    assert.equal(md.filename, "plan.md");
    assert.match(Buffer.from(md.base64, "base64").toString(), /Changed/);
    const docx = await api(`/items/${d.id}/export`, { method: "POST", body: { format: "docx" } });
    assert.equal(docx.status, 200);
    assert.equal(Buffer.from(docx.json.base64, "base64").subarray(0, 2).toString(), "PK");

    // accounting: export needs an approval for the current edit
    const a = (await api("/items", { method: "POST", body: { kind: "accounting", title: "Inv" } })).json;
    const put = (await api(`/items/${a.id}`, { method: "PUT", body: { data: { taxRate: 5, rows: [{ description: "Work", qty: 2, price: 10 }] } } })).json;
    assert.equal(put.totals.total, 21);
    assert.equal((await api(`/items/${a.id}/export`, { method: "POST", body: { format: "csv" } })).status, 409);
    assert.equal((await api(`/items/${a.id}/approve`, { method: "POST", body: {} })).json.code, "confirm", "approval needs the click");
    assert.equal((await api(`/items/${a.id}/approve`, { method: "POST", body: { confirmed: true } })).json.approved, true);
    const csv = await api(`/items/${a.id}/export`, { method: "POST", body: { format: "csv" } });
    assert.equal(csv.status, 200);
    assert.match(Buffer.from(csv.json.base64, "base64").toString(), /Total,21\.00/);
    const edit = (await api(`/items/${a.id}`, { method: "PUT", body: { data: { rows: [{ description: "Work", qty: 3, price: 10 }] } } })).json;
    assert.equal(edit.approved, false, "an edit takes the approval away");
    assert.equal((await api(`/items/${a.id}/export`, { method: "POST", body: { format: "csv" } })).status, 409);

    // automation: test, approve, confirm, then activate
    const z = (await api("/items", { method: "POST", body: { kind: "automation", title: "Morning", seed: "Summarize the news" } })).json;
    assert.equal((await api(`/items/${z.id}/activate`, { method: "POST", body: { confirmed: true } })).json.code, "cron");
    await api(`/items/${z.id}/schedule`, { method: "POST", body: { cron: "0 9 * * 1-5" } });
    assert.equal((await api(`/items/${z.id}/activate`, { method: "POST", body: { confirmed: true } })).json.code, "test");
    const t = (await api(`/items/${z.id}/test`, { method: "POST", body: {} })).json;
    assert.equal(t.testOk, true);
    assert.equal((await api(`/items/${z.id}/activate`, { method: "POST", body: { confirmed: true } })).json.code, "approval");
    await api(`/items/${z.id}/approve`, { method: "POST", body: { confirmed: true } });
    assert.equal((await api(`/items/${z.id}/activate`, { method: "POST", body: {} })).json.code, "confirm");
    const before = (await s.api("/schedules")).json;
    assert.equal((before.items).length, 0, "nothing scheduled yet");
    const on = (await api(`/items/${z.id}/activate`, { method: "POST", body: { confirmed: true } })).json;
    assert.ok(on.activeScheduleId);
    const sch = (await s.api("/schedules")).json;
    assert.equal((sch.items).filter((x) => x.name === "Morning" && x.enabled).length, 1);
    assert.equal((await api(`/items/${z.id}`, { method: "DELETE" })).status, 409, "turn it off first");
    assert.equal((await api(`/items/${z.id}/deactivate`, { method: "POST", body: {} })).json.activeScheduleId, null);
    assert.equal((await api(`/items/${z.id}`, { method: "DELETE" })).status, 200);

    // program: approve only after a passing test
    const p = (await api("/items", { method: "POST", body: { kind: "program", seed: "const a = 1;" } })).json;
    assert.equal((await api(`/items/${p.id}/approve`, { method: "POST", body: { confirmed: true } })).json.code, "test");
    assert.equal((await api(`/items/${p.id}/test`, { method: "POST", body: {} })).json.testOk, true);
    assert.equal((await api(`/items/${p.id}/approve`, { method: "POST", body: { confirmed: true } })).json.approved, true);
    const key = "sk-" + "a".repeat(30);
    const k = (await api(`/items/${p.id}`, { method: "PUT", body: { data: { language: "javascript", code: `const k = "${key}";` } } })).json;
    assert.equal(k.data.code.includes(key), false, "keys are hidden");

    // presentation and game
    const pr = (await api("/items", { method: "POST", body: { kind: "presentation", seed: "# One\n- a\n# Two\n- b" } })).json;
    assert.equal(pr.data.slides.length, 2);
    const html = (await api(`/items/${pr.id}/export`, { method: "POST", body: { format: "html" } })).json;
    assert.match(Buffer.from(html.base64, "base64").toString(), /<section class="s">/);
    const g = (await api("/items", { method: "POST", body: { kind: "game" } })).json;
    await api(`/items/${g.id}`, { method: "PUT", body: { data: { items: [{ name: "Orc" }, { name: "orc" }] } } });
    assert.equal((await api(`/items/${g.id}/approve`, { method: "POST", body: { confirmed: true } })).status, 409);
    assert.equal((await api("/items")).json.items.length, 5);
  } finally { await s.stop(); }
});
