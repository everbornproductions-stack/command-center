// Remix 2. Fifteen abilities, tier gates, credits, and no download.
// Fixtures only. No network, no real token, and no copy of another app.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-remix2-");
process.env.CC_MODE = "";

const remix = await import("../server/remix.js");
const gate = await import("../server/feature-gate.js");
const abilities = await import("../server/remix-abilities.js");
const wfc = await import("../server/remix-wfc.js");
const build = await import("../server/remix-build.js");
const { planRemix, SCRATCH_NOTE } = remix;
const { remixAbilityGate, remixAbilityAllowed, REMIX_PART_TIER } = gate;
const {
  ABILITIES, PHASER_COMMAND, PHASER_NOTE, REUSE_COMMAND, clearArt, applyReuseReport,
  importDesign, voiceCommand, publishPlan, runTool, externalCommandAllowed, accessReport, smokeSource,
} = abilities;

const SECRET = "sk-remixTwoKey000000000001";
const TOKEN = "vrcl_testtoken_9393_secret";
const EM = /[\u2014\u2013]/;
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function sample(extra = {}) {
  return {
    source: "screenshots",
    start: "screenshot",
    looks: "A calm board with large round tiles.",
    plays: "Tap a tile. A full line clears.",
    works: "Levels speed up.",
    appType: "app",
    own: { name: "Luma Tiles", characters: "Luma", look: "Night blue", ideas: "A calm puzzle", art: "" },
    engineId: "scratch-page",
    packIds: [],
    ...extra,
  };
}

test("the fifteen abilities keep their tiers and licenses", () => {
  assert.equal(ABILITIES.length, 15);
  const ids = [];
  for (const row of ABILITIES) {
    if (row.parts) for (const part of row.parts) ids.push(part.id);
    else ids.push(row.id);
  }
  for (const id of ids) assert.ok(REMIX_PART_TIER[id], id);
  assert.equal(REMIX_PART_TIER["screenshot-ui"], "pro");
  assert.equal(REMIX_PART_TIER["recording-prototype"], "extreme");
  assert.equal(REMIX_PART_TIER["penpot-design"], "pro");
  assert.equal(REMIX_PART_TIER["godot-kenney"], "pro");
  assert.equal(REMIX_PART_TIER["phaser-create"], "pro");
  assert.equal(REMIX_PART_TIER["bevy-starter"], "extreme");
  assert.equal(REMIX_PART_TIER["cc0-art"], "pro");
  assert.equal(REMIX_PART_TIER["level-maker"], "extreme");
  assert.equal(REMIX_PART_TIER.voices, "extreme");
  assert.equal(REMIX_PART_TIER["smoke-test"], "pro");
  assert.equal(REMIX_PART_TIER["access-report"], "pro");
  assert.equal(REMIX_PART_TIER["publish-web"], "pro");
  assert.equal(REMIX_PART_TIER["publish-phone"], "extreme");
  assert.equal(REMIX_PART_TIER.installer, "extreme");
  assert.equal(REMIX_PART_TIER.multiplayer, "extreme");
  assert.equal(REMIX_PART_TIER["style-only"], "pro");
  assert.equal(REMIX_PART_TIER.blend, "extreme");
  assert.equal(REMIX_PART_TIER.forks, "pro");
  assert.equal(remixAbilityAllowed("free", "screenshot-ui"), false);
  assert.equal(remixAbilityAllowed("pro", "screenshot-ui"), true);
  assert.equal(remixAbilityAllowed("pro", "recording-prototype"), false);
  assert.equal(remixAbilityAllowed("studio", "publish-web"), true);
  assert.equal(remixAbilityAllowed("extreme", "recording-prototype"), true);
  assert.equal(remixAbilityAllowed("owner", "publish-phone"), true);
  assert.equal(remixAbilityGate({ tier: "pro", ability: "voices" }).code, "ability_tier");
  assert.equal(remixAbilityGate({ tier: "extreme", ability: "level-maker" }).ok, true);
});

test("Phaser stays an npx command, Piper and reuse stay separate programs, and levels are original", () => {
  assert.deepEqual(PHASER_COMMAND, ["npx", "@phaserjs/create-game@latest"]);
  assert.match(PHASER_NOTE, /unconfirmed/);
  assert.deepEqual(REUSE_COMMAND, ["reuse", "lint"]);
  const piper = voiceCommand("piper");
  assert.equal(piper.gpl, true);
  assert.equal(piper.external, true);
  assert.equal(piper.license, "GPL-3.0-or-later");
  assert.equal(piper.command[0], "piper");
  const coqui = voiceCommand("coqui");
  assert.equal(coqui.license, "MPL-2.0");
  assert.equal(coqui.external, true);
  const src = read("server", "remix-abilities.js") + read("server", "remix-wfc.js") + read("server", "remix-build.js");
  assert.equal(src.includes("from \"piper"), false);
  assert.equal(src.includes("require(\"reuse"), false);
  assert.doesNotMatch(src, /from ["']@phaserjs\/create-game["']/);
  assert.equal(wfc.WFC_LICENSE, "MIT");
  assert.doesNotMatch(read("server", "remix-wfc.js"), /bool\[\]\[\] wave|class Model/);
  const a = wfc.makeLevel({ seed: 4, width: 6, height: 6 });
  const b = wfc.makeLevel({ seed: 4, width: 6, height: 6 });
  assert.equal(a.ok, true);
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.rows.length, 6);
  assert.ok(a.rows[0].every((cell) => ["sky", "grass", "dirt", "water"].includes(cell)));
});

test("art clearance keeps CC0 Kenney and OpenGameArt files and rejects the rest", () => {
  const cleared = clearArt([
    { name: "sky.png", source: "kenney", license: "CC0" },
    { name: "tree.png", source: "opengameart", license: "CC0-1.0" },
    { name: "logo.png", source: "kenney", license: "CC-BY-4.0" },
    { name: "paid.png", source: "somewhere", license: "CC0" },
    { name: "../secrets.png", source: "kenney", license: "CC0" },
  ]);
  assert.deepEqual(cleared.kept.map((f) => f.name), ["sky.png", "tree.png"]);
  assert.equal(cleared.rejected.length, 3);
  const reused = applyReuseReport(cleared.kept, "sky.png CC0-1.0\ntree.png GPL-3.0-only\n");
  assert.deepEqual(reused.kept.map((f) => f.name), ["sky.png"]);
  assert.equal(reused.rejected[0].name, "tree.png");
  assert.equal(reused.reuseRan, true);
  const plan = planRemix(sample({
    artFiles: [
      { name: "sky.png", source: "kenney", license: "CC0" },
      { name: "logo.png", source: "kenney", license: "GPL-3.0" },
    ],
  }));
  assert.equal(plan.ok, true);
  assert.match(plan.creditsText, /sky\.png/);
  assert.equal(plan.creditsText.includes("logo.png"), false);
  assert.ok(plan.rejected.some((r) => r.name === "logo.png"));
  const bad = importDesign("<svg><script>alert(1)</script></svg>");
  assert.equal(bad.ok, false);
  const good = importDesign("<svg><rect width=\"10\" height=\"10\"/><text>Luma</text></svg>");
  assert.equal(good.ok, true);
  assert.equal(good.shapes >= 2, true);
});

test("publish waits for a click, and heavy tools are not launched", async () => {
  assert.equal(externalCommandAllowed(), false);
  const quiet = publishPlan({ target: "vercel", click: false, hasToken: true });
  assert.equal(quiet.sent, false);
  assert.equal(quiet.code, "confirm");
  const needs = publishPlan({ target: "itch", click: true, hasToken: false });
  assert.equal(needs.code, "token");
  const ready = publishPlan({ target: "computer", click: true, hasToken: false });
  assert.equal(ready.ok, true);
  assert.equal(ready.sent, false);
  let spawned = 0;
  const npx = await runTool("npx", ["@phaserjs/create-game@latest"], { live: true, spawnImpl: () => { spawned += 1; } });
  assert.equal(npx.started, false);
  assert.equal(spawned, 0);
  const web = await runTool("vercel", ["deploy"], {
    live: true,
    env: { VERCEL_TOKEN: TOKEN },
    spawnImpl: (bin, args, env) => {
      spawned += 1;
      assert.equal(bin, "vercel");
      assert.equal(args.includes(TOKEN), false);
      assert.equal(env.VERCEL_TOKEN, TOKEN);
    },
  });
  assert.equal(web.started, true);
  assert.equal(JSON.stringify(web).includes(TOKEN), false);
  assert.equal(spawned, 1);
  const page = build.freshPage({ projectName: "Luma Tiles", description: { looks: "A calm board", plays: "Tap", works: "Clear" }, start: "screenshot" });
  const report = accessReport(page);
  assert.equal(report.grade, "Ready");
  assert.equal(report.tools.find((t) => t.name === "pa11y").external, true);
  assert.equal(report.ranExternal, false);
  assert.match(smokeSource("Luma Tiles"), /playwright/);
  assert.equal(read("package.json").includes("\"playwright\""), false);
  assert.match(JSON.parse(read("package.json")).version, /^\d+\.\d+\.\d+$/);
});

test("a plan for a recording, a blend, and new levels stays inside the gates", () => {
  const shot = planRemix(sample());
  assert.equal(shot.ok, true);
  assert.ok(shot.abilityIds.includes("screenshot-ui"));
  assert.match(shot.creditsText, /not copied/);
  const recording = planRemix(sample({ start: "recording", plays: "Open the map. Tap a town. See the shop." }));
  assert.ok(recording.abilityIds.includes("recording-prototype"));
  const blend = planRemix(sample({
    blend: { name: "Harbor", looks: "Boats and lamps", ideas: "A quiet port" },
    levels: true,
    useBevy: true,
    multiplayer: true,
    installer: "tauri",
    voice: "piper",
    styleOnly: true,
    fork: true,
    usePhaser: true,
  }));
  assert.equal(blend.ok, true);
  assert.equal(blend.goal.includes(SECRET), false);
  assert.ok(blend.abilityIds.includes("blend"));
  assert.ok(blend.abilityIds.includes("level-maker"));
  assert.equal(blend.level.ok, true);
  assert.match(blend.creditsText, /isomorphic-git/);
  assert.match(blend.creditsText, /unconfirmed/);
  const files = build.projectFiles({ ...blend, abilityIds: [...blend.abilityIds, "smoke-test", "access-report"] });
  assert.match(files["index.html"], /Luma Tiles/);
  assert.match(files["smoke.spec.js"], /the page opens/);
  assert.ok(files["levels.json"]);
  assert.ok(files["tokens.json"]);
  assert.ok(files["bevy/src/main.rs"]);
  assert.ok(files["online/room.js"]);
  assert.match(files["phaser-command.txt"], /npx @phaserjs\/create-game@latest/);
  assert.equal(files["phaser-command.txt"].includes("node_modules"), false);
  const ui = read("web", "features", "remix.js");
  assert.match(ui, /What do you want to make\?/);
  assert.match(ui, /Choose a starting point/);
  assert.match(ui, /More options/);
  assert.match(ui, /Preview who receives this/);
  assert.match(ui, /Rebuild from scratch/);
  for (const name of ["web/features/remix.js", "server/remix.js", "server/plugins/remix.js", "server/feature-gate.js", "server/remix-abilities.js", "docs/help/remix.md"]) {
    const text = read(...name.split("/"));
    assert.equal(EM.test(text), false, name);
    assert.doesNotMatch(text, /\bfetch\s*\(/, name);
    // feature-gate.js says in comments that it never calls Square. No Square link or checkout in any of these.
    assert.doesNotMatch(text, name === "server/feature-gate.js" ? /square\.(com|link)|checkout/i : /square/i, name);
  }
});

function seedLicense(tier) {
  return (dir) => {
    fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
      key: "TEST-KEY", tier, status: "active", lastOkAt: Date.now(), checkedAt: Date.now(),
    }));
  };
}

test("Pro can build a screenshot and cannot use an Extreme choice", async () => {
  const pro = await startServer({ seed: seedLicense("pro") });
  try {
    const body = sample();
    const preview = await pro.api("/remix/preview", { method: "POST", body });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.abilityGate.ok, true);
    const run = await pro.api("/remix/run", { method: "POST", body: { ...body, confirm: true } });
    assert.equal(run.status, 200, run.json?.error || "");
    assert.equal(run.json.sent, undefined);
    assert.ok(run.json.abilityIds.includes("smoke-test"));
    const html = fs.readFileSync(path.join(pro.dir, "projects", run.json.projectId, "index.html"), "utf8");
    assert.equal(html.includes(SECRET), false);
    assert.match(html, /Luma Tiles/);
    const report = JSON.parse(fs.readFileSync(path.join(pro.dir, "projects", run.json.projectId, "access-report.json"), "utf8"));
    assert.equal(report.grade, "Ready");
    assert.equal(report.ranExternal, false);
    const extreme = await pro.api("/remix/run", { method: "POST", body: { ...sample({ start: "recording" }), confirm: true } });
    assert.equal(extreme.status, 402);
    assert.equal(extreme.json.code, "ability_tier");
    const phone = await pro.api("/remix/publish", { method: "POST", body: { confirm: true, target: "phone", token: TOKEN } });
    assert.equal(phone.status, 402);
    assert.equal(JSON.stringify(phone.json).includes(TOKEN), false);
    const levels = await pro.api("/remix/run", { method: "POST", body: { ...sample({ levels: true }), confirm: true } });
    assert.equal(levels.status, 402);
  } finally { await pro.stop(); }
});

test("an owner click stores a token, writes credits, and does not post or download", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const before = s.stub.hits.length;
    const body = sample({
      artFiles: [{ name: "sky.png", source: "kenney", license: "CC0" }],
      fork: true,
    });
    const quiet = await s.api("/remix/publish", { method: "POST", body: { target: "vercel" } });
    assert.equal(quiet.status, 400);
    assert.equal(quiet.json.code, "confirm");
    assert.equal(quiet.json.sent, false);
    const run = await s.api("/remix/run", { method: "POST", body: { ...body, confirm: true } });
    assert.equal(run.status, 200, run.json?.error || "");
    assert.equal(run.json.version?.ok, true);
    assert.equal(run.json.version.sent, false);
    const credits = fs.readFileSync(path.join(s.dir, "projects", run.json.projectId, "CREDITS.md"), "utf8");
    assert.match(credits, /sky\.png/);
    assert.match(credits, /isomorphic-git/);
    assert.equal(credits.includes(TOKEN), false);
    const tested = await s.api("/remix/test", { method: "POST", body: { confirm: true, projectId: run.json.projectId } });
    assert.equal(tested.status, 200);
    assert.equal(tested.json.ranExternal, false);
    assert.equal(tested.json.report.grade, "Ready");
    const media = await s.api("/remix/media", { method: "POST", body: { files: [{ name: "sky.png", source: "kenney", license: "CC0" }] } });
    assert.equal(media.json.code, "media_approval");
    assert.equal(media.json.downloaded, false);
    const approved = await s.api("/remix/media", { method: "POST", body: { confirm: true, files: [{ name: "sky.png", source: "kenney", license: "CC0" }, { name: "badge.png", source: "kenney", license: "CC-BY" }] } });
    assert.equal(approved.json.downloaded, false);
    assert.deepEqual(approved.json.kept.map((f) => f.name), ["sky.png"]);
    assert.equal(approved.json.rejected.some((f) => f.name === "badge.png"), true);
    const voice = await s.api("/remix/voice", { method: "POST", body: { confirm: true, kind: "piper" } });
    assert.equal(voice.status, 200);
    assert.equal(voice.json.started, false);
    assert.equal(voice.json.gpl, true);
    const posted = await s.api("/remix/publish", { method: "POST", body: { confirm: true, target: "vercel", token: TOKEN, projectId: run.json.projectId } });
    assert.equal(posted.status, 200, posted.json?.error || "");
    assert.equal(posted.json.sent, false);
    assert.equal(posted.json.started, false);
    const blob = JSON.stringify(posted.json) + s.log;
    assert.equal(blob.includes(TOKEN), false);
    assert.equal(fs.readFileSync(path.join(s.dir, "vault.bin"), "utf8").includes(TOKEN), false);
    const again = await s.api("/remix/publish", { method: "POST", body: { confirm: true, target: "computer" } });
    assert.equal(again.json.sent, false);
    assert.match(again.json.message, /computer/);
    assert.equal(s.stub.hits.length, before);
  } finally { await s.stop(); }
});
