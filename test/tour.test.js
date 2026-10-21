// Phase 1: onboarding tour. The sample run must only ever hit the demo AIs: refused with demo off,
// refused when real keys exist, a Single on Free, a Mission on Pro/owner. State persists per user.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./helpers.js";
import { sampleDecision, SAMPLE_GOAL, DEFAULTS, whatsNewFor, whatsNewSince, compareVersions, readChangelog } from "../server/plugins/tour.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("sampleDecision: demo off → refused; real keys → refused; otherwise mission when allowed, else single", () => {
  assert.equal(sampleDecision({ demo: false, realKeys: false, canMission: true }).code, "demo_off");
  assert.equal(sampleDecision({ demo: true, realKeys: true, canMission: true }).code, "real_keys");
  assert.equal(sampleDecision({ demo: false, realKeys: true, canMission: true }).code, "demo_off", "demo check comes first");
  assert.deepEqual(sampleDecision({ demo: true, realKeys: false, canMission: true }), { ok: true, kind: "mission" });
  assert.deepEqual(sampleDecision({ demo: true, realKeys: false, canMission: false }), { ok: true, kind: "single" });
  assert.equal(DEFAULTS.completed, false);
});

test("free copy: state, sample gating (demo off → 400; demo on → single, no mission created), complete / skip / reset persist", async () => {
  const s = await startServer();
  try {
    assert.equal((await s.api("/tour", { noToken: true })).status, 401);
    const g = await s.api("/tour");
    assert.equal(g.status, 200);
    assert.equal(g.json.completed, false); assert.equal(g.json.skippedAt, null); assert.equal(g.json.sampleRuns, 0);
    assert.equal(g.json.demo, false); assert.equal(g.json.realKeys, false); assert.equal(g.json.canMission, false);
    assert.equal(g.json.sample.goal, SAMPLE_GOAL);

    const off = await s.api("/tour/sample", { method: "POST" });
    assert.equal(off.status, 400); assert.equal(off.json.code, "demo_off");
    assert.equal((await s.api("/tour")).json.sampleRuns, 0, "a refused sample is not counted");

    const demo = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(demo.json.demo, true);
    assert.equal((await s.api("/tour")).json.demo, true);
    assert.equal((await s.api("/tour")).json.realKeys, false, "demo keys do not count as real keys");

    const single = await s.api("/tour/sample", { method: "POST" });
    assert.equal(single.status, 200); assert.equal(single.json.kind, "single"); assert.equal(single.json.prompt, SAMPLE_GOAL);
    assert.ok(!(await s.api("/missions")).json.some((m) => m.kind === "mission"), "no mission was started on the Free tier");
    assert.equal((await s.api("/tour")).json.sampleRuns, 1);
    // the browser then posts the prompt as a Single, which Free allows
    assert.equal((await s.api("/chat", { method: "POST", body: { prompt: single.json.prompt } })).status, 202);

    const done = await s.api("/tour/complete", { method: "POST" });
    assert.equal(done.status, 200); assert.equal(done.json.completed, true); assert.ok(done.json.completedAt > 0);
    const file = path.join(s.dir, "tour.state.json");
    assert.ok(fs.existsSync(file), "tour.state.json written in the temp data dir");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).completed, true);
    const skipped = await s.api("/tour/skip", { method: "POST" });
    assert.ok(skipped.json.skippedAt > 0); assert.equal(skipped.json.completed, true, "skip does not undo completion");
    const reset = await s.api("/tour/reset", { method: "POST" });
    assert.equal(reset.json.completed, false); assert.equal(reset.json.skippedAt, null); assert.equal(reset.json.sampleRuns, 0);
    assert.equal((await s.api("/tour/nothing", { method: "POST" })).status, 404);
    assert.ok((await s.api("/state")).json.plugins.includes("tour"));
  } finally { await s.stop(); }
});

test("owner copy: demo on → the sample starts a real demo mission (then aborted so the test stays short)", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/tour")).json.canMission, true);
    await s.api("/demo", { method: "POST", body: { on: true } });
    const r = await s.api("/tour/sample", { method: "POST" });
    assert.equal(r.status, 202); assert.equal(r.json.kind, "mission"); assert.equal(r.json.goal, SAMPLE_GOAL);
    let mission = null;
    for (let i = 0; i < 100 && !mission; i++) { mission = (await s.api("/missions")).json.find((m) => m.kind === "mission"); if (!mission) await sleep(100); }
    assert.ok(mission, "a mission appeared within 10 s");
    assert.ok(["scheduled", "planning", "running", "assembling", "done", "done-with-errors"].includes(mission.status), `status ${mission.status}`);
    assert.equal((await s.api("/tour")).json.sampleRuns, 1);
    await s.api(`/mission/${mission.id}/abort`, { method: "POST" });
  } finally { await s.stop(); }
});

test("package.json version has a What's new entry, and a version with no bullets does not", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const changelog = readChangelog();
  const entry = whatsNewFor(pkg.version, changelog);
  assert.ok(entry, `docs/WHATS-NEW.json is missing bullets for ${pkg.version}`);
  assert.equal(entry.version, pkg.version);
  assert.ok(entry.title.length > 0);
  assert.ok(entry.bullets.length > 0);
  assert.doesNotMatch(JSON.stringify(entry), /\u2014/);
  assert.equal(whatsNewFor("9.9.9", changelog), null);
  assert.equal(whatsNewFor(pkg.version, { [pkg.version]: { title: "Empty", bullets: [] } }), null);
  assert.throws(() => readChangelog("[]"), /keyed by version/);
});

test("what's new is skipped on first install, shown after an upgrade, and a tour reset does not show it again", async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const fresh = await startServer();
  try {
    const g = await fresh.api("/tour");
    assert.equal(g.json.whatsNew, null);
    const file = path.join(fresh.dir, "whatsnew.state.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(doc.firstInstall, true);
    assert.equal(doc.installed, pkg.version);
  } finally { await fresh.stop(); }

  const s = await startServer({ seed: (dir) => fs.writeFileSync(path.join(dir, "whatsnew.state.json"), JSON.stringify({ seen: null, installed: "0.0.0", firstInstall: false })) });
  try {
    const g = await s.api("/tour");
    assert.equal(g.json.whatsNew.version, pkg.version);
    assert.equal(g.json.desktopPrompt?.title, "New: let Meldmind use your desktop");
    assert.ok(g.json.whatsNew.bullets.length > 0);
    const seen = await s.api("/tour/whats-new/seen", { method: "POST" });
    assert.equal(seen.status, 200);
    assert.equal(seen.json.whatsNew, null);
    const file = path.join(s.dir, "whatsnew.state.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.seen, pkg.version);
    assert.equal(saved.from, null, "a first launch has no earlier version to remember");
    const again = await s.api("/tour/whats-new");
    assert.equal(again.json.whatsNew.version, pkg.version);
    assert.deepEqual(again.json.whatsNew.versions.map((v) => v.version), [pkg.version]);
    assert.equal((await s.api("/tour")).json.whatsNew, null, "opening the note again does not mark it unseen");
    const reset = await s.api("/tour/reset", { method: "POST" });
    assert.equal(reset.json.completed, false);
    assert.equal(reset.json.whatsNew, null, "resetting the tour does not show What's new again");
    assert.equal((await s.api("/tour")).json.whatsNew, null);
  } finally { await s.stop(); }
});

test("what's new lists every version since the one that was installed, newest first", () => {
  const log = {
    "0.4.7": { title: "Seven", bullets: ["old"] },
    "0.4.8": { title: "Eight", bullets: ["a"] },
    "0.4.9": { title: "Nine", bullets: ["b"] },
    "0.4.10": { title: "Ten", bullets: ["c"] },
    "0.4.10.1": { title: "Gap", bullets: [] },
    "0.4.11": { title: "Eleven", bullets: ["d"] },
    "0.4.12": { title: "Twelve", bullets: ["e"] },
    "0.5.0": { title: "Later", bullets: ["nope"] },
  };
  const span = whatsNewSince("0.4.8", "0.4.12", log);
  assert.deepEqual(span.versions.map((v) => v.version), ["0.4.12", "0.4.11", "0.4.10", "0.4.9"]);
  assert.equal(span.version, "0.4.12");
  assert.deepEqual(span.bullets, ["e"]);
  assert.equal(span.from, "0.4.8");
  assert.equal(span.versions.some((v) => v.version === "0.4.8"), false);
  assert.deepEqual(whatsNewSince(null, "0.4.12", log).versions.map((v) => v.version), ["0.4.12"]);
  assert.equal(whatsNewSince("0.4.12", "0.4.12", log), null);
  assert.equal(compareVersions("0.4.10", "0.4.9"), 1);
  assert.equal(compareVersions("0.4.9", "0.4.10"), -1);
  assert.doesNotMatch(JSON.stringify(span), /\u2014/);
});

test("an update lists every bundled note since the installed version, and it can be opened again", async () => {
  const s = await startServer({
    seed: (dir) => fs.writeFileSync(path.join(dir, "whatsnew.state.json"), JSON.stringify({ seen: "0.4.5" })),
  });
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const notes = JSON.parse(fs.readFileSync(new URL("../docs/WHATS-NEW.json", import.meta.url), "utf8"));
  const span = Object.keys(notes)
    .filter((v) => compareVersions(v, "0.4.5") > 0 && compareVersions(v, pkg.version) <= 0 && (notes[v].bullets || []).length)
    .sort((a, b) => compareVersions(b, a));
  try {
    const g = await s.api("/tour");
    assert.ok(span.length >= 3);
    assert.deepEqual(g.json.whatsNew.versions.map((v) => v.version), span);
    assert.equal(g.json.whatsNew.version, pkg.version);
    assert.equal(g.json.whatsNew.from, "0.4.5");
    assert.ok(g.json.whatsNew.bullets.length > 0);
    assert.equal(g.json.whatsNew.versions.some((v) => v.version === "0.4.5" || v.version === "0.4.4"), false);
    assert.doesNotMatch(JSON.stringify(g.json.whatsNew), /\u2014/);
    const seen = await s.api("/tour/whats-new/seen", { method: "POST" });
    assert.equal(seen.json.whatsNew, null);
    const file = path.join(s.dir, "whatsnew.state.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.seen, pkg.version);
    assert.equal(saved.from, "0.4.5");
    const again = await s.api("/tour/whats-new");
    assert.deepEqual(again.json.whatsNew.versions.map((v) => v.version), span);
    assert.equal((await s.api("/tour")).json.whatsNew, null, "reopening does not mark the note unseen");
    const kept = await s.api("/tour/whats-new/seen", { method: "POST" });
    assert.equal(kept.json.whatsNew, null);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).from, "0.4.5", "closing it again keeps the same span");
    const reset = await s.api("/tour/reset", { method: "POST" });
    assert.equal(reset.json.whatsNew, null, "resetting the tour does not show the update notes again");
  } finally { await s.stop(); }
});

test("tour steps cover the current app and What's new shows before the invite", () => {
  const src = fs.readFileSync(new URL("../web/features/tour.js", import.meta.url), "utf8");
  assert.match(src, /Try it/);
  assert.match(src, /Skip tour/);
  assert.match(src, /Take the tour again from Help/);
  assert.match(src, /tourSteps/);
  const missionsHelp = fs.readFileSync(new URL("../docs/help/missions-media.md", import.meta.url), "utf8");
  const pipeHelp = fs.readFileSync(new URL("../docs/help/pipelines.md", import.meta.url), "utf8");
  assert.match(missionsHelp, /## What a mission is/);
  assert.match(missionsHelp, /a planner splits the goal, specialists work in parallel, a different AI checks each piece, and an assembler compiles the result/);
  assert.match(pipeHelp, /A pipeline is a saved mission with the steps already chosen. Pick one, fill a few blanks, and run it. Nothing starts until you click Run/);
  assert.equal(missionsHelp.includes("\u2014") || pipeHelp.includes("\u2014"), false);
  assert.doesNotMatch(src, /\u2014/);
  assert.match(src, /whatsNew/);
  assert.match(src, /n\.versions/);
  assert.match(src, /openNews/);
  assert.match(src, /id="cc-news-open">What's new</);
  assert.match(src, /These notes are saved in the app, so they work offline/);
  const help = fs.readFileSync(new URL("../web/features/help.js", import.meta.url), "utf8");
  assert.match(help, /id="help-news">What's new</);
  assert.match(help, /openNews/);
  assert.match(src, /S\.view === "setup"\) \{ hideNews\(\)/, "first-run setup is not covered by What's new");
  const invite = src.slice(src.indexOf("function maybeInvite"), src.indexOf("function showNews"));
  const offer = invite.indexOf("showNews()");
  const create = invite.indexOf('className = "cc-tour-invite"');
  assert.ok(offer !== -1 && create !== -1 && offer < create, "What's new is offered before the tour invite");
  const yml = fs.readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
  assert.match(yml, /docs\/WHATS-NEW\.json/);
});
