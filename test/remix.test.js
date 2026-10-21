// Phase 96: Remix any app. License check, CREDITS, the Pro / Extreme gate, and the no-copy guard.
// Fixtures only. No download, no real game, and no real key. The secret below is a fake and must not be stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = tmpDir("cc-remix-");
process.env.CC_MODE = "";

const remix = await import("../server/remix.js");
const gate = await import("../server/feature-gate.js");
const { groupFor, menuModel } = await import("../web/nav.js");
const { simpleAllows } = await import("../web/mode.js");

const {
  SCRATCH_NOTE, CATALOG, checkLicense, creditsText, noCopyGuard, closeness, planRemix,
  recipients, publicRun, suggest, shareTotals,
} = remix;
const { REMIX_PRO_CAP, remixGate, countRemixMonth, assertRemix } = gate;

const SECRET = "sk-remixTestKey000000000001";
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const EM = "\u2014";

function sample(extra = {}) {
  const own = {
    name: "Luma Tiles",
    characters: "Luma the fox and Pip the moth",
    look: "Soft paper cutouts in night blue and gold",
    ideas: "A calm puzzle about lamps",
    art: "My fox sketch",
    ...(extra.own || {}),
  };
  return {
    source: "screenshots",
    looks: "Zorpblat shows a bright board with large round tiles.",
    plays: "Tap a tile to swap it. A full line clears.",
    works: `Levels speed up. A marker is ${SECRET}.`,
    appType: "game",
    originalName: "Zorpblat",
    originalCharacters: "Blob King",
    own,
    engineId: "godot",
    packIds: ["kenney-cc0"],
    pulls: [
      { name: "Stolen Sprites", license: "GPL-3.0", url: "https://example.com/sprites" },
      { name: "Paper Kit", license: "MIT", credit: "Paper Kit by Ada, MIT" },
    ],
    ...extra,
    own,
  };
}

test("license check allows free licenses and rejects missing, non-free, and mixed licenses", () => {
  for (const item of CATALOG) {
    const hit = checkLicense(item);
    assert.equal(hit.ok, true, item.id);
  }
  const mit = checkLicense({ name: "Godot Engine", license: "MIT", credit: "Godot Engine, MIT License. https://godotengine.org", url: "https://godotengine.org" });
  assert.equal(mit.ok, true);
  assert.equal(mit.creditRequired, true);
  assert.equal(mit.spdx, "MIT");
  assert.equal(checkLicense({ name: "Kenney", license: "CC0" }).creditRequired, false);
  assert.equal(checkLicense({ name: "Apache kit", license: "Apache 2.0" }).spdx, "Apache-2.0");
  assert.equal(checkLicense({ name: "Dual", license: "MIT OR Apache-2.0" }).ok, true);
  assert.equal(checkLicense({ name: "Public", license: "Unlicense" }).ok, true);
  assert.equal(checkLicense({ name: "Blank", license: "" }).reason, "license missing");
  assert.equal(checkLicense({ name: "Stolen Sprites", license: "GPL-3.0" }).reason, "not free to use");
  assert.equal(checkLicense({ name: "No commercial", license: "CC-BY-NC-4.0" }).reason, "not free to use");
  assert.equal(checkLicense({ name: "Mystery", license: "made-up" }).reason, "not free to use");
  assert.equal(checkLicense({ name: "Trap", license: "MIT OR GPL-3.0" }).ok, false);
  assert.equal(checkLicense({ name: "Closed", license: "Unlicensed" }).ok, false);
  const text = creditsText([
    mit,
    checkLicense(CATALOG.find((c) => c.id === "kenney-cc0")),
    checkLicense({ name: "Paper Kit", license: "MIT", credit: "Paper Kit by Ada, MIT" }),
    checkLicense({ name: "Stolen Sprites", license: "GPL-3.0" }),
  ]);
  assert.match(text, /Required credit: Godot Engine, MIT License\. https:\/\/godotengine\.org/);
  assert.match(text, /Paper Kit by Ada, MIT/);
  assert.match(text, /Kenney Game Assets/);
  assert.match(text, /Required credit: none/);
  assert.equal(text.includes("Stolen Sprites"), false);
  assert.match(text, /Remix rebuilds from scratch/);
});

test("the no-copy guard blocks decompile, extract, and copy, and allows a visible description", () => {
  assert.equal(noCopyGuard("decompile the game and copy the code").ok, false);
  assert.equal(noCopyGuard("extract the assets from the apk").ok, false);
  assert.equal(noCopyGuard("please unpack the ipa").ok, false);
  assert.equal(noCopyGuard("run apktool on the build").ok, false);
  assert.equal(noCopyGuard({ looks: "A bright board", image: "abc" }).ok, false);
  assert.equal(noCopyGuard("data:image/png;base64,AAAA").ok, false);
  assert.equal(noCopyGuard("do not decompile anything").ok, true);
  assert.equal(noCopyGuard("A bright board with tiles. Tap a tile. The board fills.").ok, true);
  const blocked = planRemix(sample({ looks: "decompile the game and extract the assets" }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "no_copy");
  assert.equal(blocked.error, SCRATCH_NOTE);
});

test("a plan rebuilds from the person's own words and drops anything that fails the license check", () => {
  const plan = planRemix(sample({
    source: "desktop",
    url: "https://store.example/app",
    looks: "See https://store.example/app on a bright board. Zorpblat shows large round tiles.",
  }));
  assert.equal(plan.ok, true);
  assert.equal(plan.description.filesRead, false);
  assert.equal(plan.description.addressSent, false);
  assert.match(plan.description.observed, /visible on screen/);
  assert.equal(plan.goal.includes("store.example"), false);
  assert.equal(plan.goal.includes("Zorpblat"), false);
  assert.equal(plan.goal.includes(SECRET), false);
  assert.match(plan.goal, /\[key hidden\]/);
  assert.match(plan.goal, /Luma the fox/);
  assert.match(plan.goal, /Godot Engine \(MIT\)/);
  assert.equal(plan.creditsText.includes("Stolen Sprites"), false);
  assert.match(plan.creditsText, /Paper Kit by Ada, MIT/);
  assert.ok(plan.rejected.some((r) => r.name === "Stolen Sprites" && r.reason === "not free to use"));
  assert.equal(plan.closeness.close, false);
  const learned = planRemix(sample({ engineId: "", packIds: [] }), { learned: { engineId: "phaser" } });
  assert.equal(learned.engineId, "phaser");
  assert.equal(planRemix(sample({ engineId: "bogus" })).code, "engine");
  assert.equal(planRemix(sample({ own: { name: "" } })).code, "name");
  assert.equal(planRemix(sample({ looks: "", plays: "", works: "" })).code, "describe");
  const mod = planRemix(sample({ modId: "minecraft" }));
  assert.match(mod.goal, /Minecraft's own data packs/);
  const near = closeness({ originalName: "Zorpblat", originalCharacters: "Blob King", originalLook: "glowing cylinder maze", own: { name: "Zorpblat", characters: "Blob King", look: "glowing cylinder tunnel" } });
  assert.equal(near.close, true);
  assert.equal(near.warnings.length, 3);
});

test("gates: Free is blocked, Pro is capped, Extreme and Owner are not", () => {
  assert.equal(REMIX_PRO_CAP, 8);
  const now = Date.UTC(2026, 9, 18, 12);
  assert.equal(countRemixMonth([{ ts: now }, { ts: Date.UTC(2026, 8, 2, 12) }], now), 1);
  assert.equal(remixGate({ tier: "free", used: 0 }).ok, false);
  assert.equal(remixGate({ tier: "free", used: 0 }).code, "pro_required");
  assert.equal(remixGate({ tier: "pro", used: 0 }).ok, true);
  assert.equal(remixGate({ tier: "pro", used: 0 }).remaining, 8);
  assert.equal(remixGate({ tier: "pro", used: 7 }).remaining, 1);
  assert.equal(remixGate({ tier: "pro", used: 8 }).code, "remix_cap");
  assert.equal(remixGate({ tier: "studio", used: 8 }).ok, false);
  assert.equal(remixGate({ tier: "extreme", used: 100 }).ok, true);
  assert.equal(remixGate({ tier: "extreme", used: 100 }).unlimited, true);
  assert.equal(remixGate({ tier: "owner", used: 100 }).unlimited, true);
  assert.equal(remixGate({ tier: "enterprise", used: 0 }).ok, false);
  assert.throws(() => assertRemix({ tier: "free", used: 0 }), (e) => e.status === 402 && e.code === "pro_required");
});

test("learning keeps ratings and drops the original name, characters, prompt, and keys", () => {
  const rows = [
    { id: "a", ts: 1, appType: "game", engineId: "godot", sourceKind: "url", rating: "down", fix: true, provider: "demo-nova", model: "nova-lite", characters: "Blob King", originalName: "Zorpblat", prompt: "copy the code", url: "https://secret.example/a", key: SECRET },
    { id: "b", ts: 2, appType: "game", engineId: "phaser", sourceKind: "screenshots", rating: "up", fix: false, provider: "demo-atlas", model: "atlas-pro" },
  ];
  const hint = suggest(rows, "game");
  assert.equal(hint.engineId, "phaser");
  assert.equal(hint.provider, "demo-atlas");
  const share = shareTotals(rows, { optedIn: true });
  const blob = JSON.stringify(share);
  assert.equal(share.sent, false);
  assert.equal(blob.includes("Blob King"), false);
  assert.equal(blob.includes("Zorpblat"), false);
  assert.equal(blob.includes("secret.example"), false);
  assert.equal(blob.includes(SECRET), false);
  assert.equal(blob.includes("copy the code"), false);
  const cleaned = publicRun(rows[0]);
  assert.equal(JSON.stringify(cleaned).includes("Zorpblat"), false);
  assert.equal(cleaned.model, "nova-lite");
  assert.equal(publicRun({ model: SECRET, engineId: "godot", id: "c", appType: "game" }).model, "");
  const who = recipients({ models: [{ provider: "demo-nova", providerName: "Nova (demo)", model: "nova-lite", name: "Nova Lite" }], source: "desktop" });
  assert.equal(who.ran, false);
  assert.equal(who.services[0].id, "this-computer");
  assert.ok(who.withheld.some((line) => /not opened/.test(line)));
  assert.equal(who.ais[0].provider, "demo-nova");
});

test("Remix is in Create, the scratch note is visible, and the page does not fetch or mention Square", () => {
  assert.equal(groupFor("remix"), "create");
  assert.equal(simpleAllows("remix"), true);
  const create = menuModel(["prompts", "remix"], "narrow").find((g) => g.id === "create");
  assert.ok(create.items.some((item) => item.view === "remix" && item.label === "Remix"));
  const ui = read("web", "features", "remix.js");
  const server = read("server", "remix.js");
  const plugin = read("server", "plugins", "remix.js");
  const featureGate = read("server", "feature-gate.js");
  assert.ok(ui.includes(SCRATCH_NOTE));
  assert.ok(server.includes(SCRATCH_NOTE));
  assert.ok(ui.includes("Preview who receives this"));
  assert.ok(ui.includes("Rebuild from scratch"));
  assert.match(read("web", "features", "index.js"), /"remix"/);
  for (const [name, text] of [["ui", ui], ["server", server], ["plugin", plugin], ["gate", featureGate], ["help", read("docs", "help", "remix.md")]]) {
    assert.equal(text.includes(EM), false, name);
    assert.doesNotMatch(text, /\bfetch\s*\(/, name);
    assert.doesNotMatch(text, /square/i, name);
  }
  assert.match(read("docs", "help", "remix.md"), /CREDITS/);
  assert.match(read("docs", "BUILD-PLAN.md"), /server\/feature-gate\.js/);
});

function seedLicense(tier, runs) {
  return (dir) => {
    fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({
      key: "TEST-KEY", tier, status: "active", lastOkAt: Date.now(), checkedAt: Date.now(),
    }));
    if (!runs) return;
    const items = Array.from({ length: runs }, (_, i) => ({
      id: "rx" + i, ts: Date.now(), appType: "game", sourceKind: "screenshots", engineId: "godot", rating: null, fix: false,
    }));
    fs.writeFileSync(path.join(dir, "remix.runs.json"), JSON.stringify({ items }));
  };
}

test("a free copy can preview and cannot run, even if the body claims Extreme", async () => {
  const s = await startServer();
  try {
    const st = await s.api("/state");
    assert.equal(st.json.license.tier, "free");
    const before = st.json.projects.length;
    const view = await s.api("/remix");
    assert.equal(view.json.gate.ok, false);
    assert.equal(view.json.gate.code, "pro_required");
    assert.equal(view.json.scratchNote, SCRATCH_NOTE);
    const preview = await s.api("/remix/preview", { method: "POST", body: sample() });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.ran, false);
    assert.equal(preview.json.recipients.ran, false);
    const run = await s.api("/remix/run", { method: "POST", body: { ...sample(), confirm: true, tier: "extreme" } });
    assert.equal(run.status, 402);
    assert.equal(run.json.code, "pro_required");
    assert.equal((await s.api("/state")).json.projects.length, before);
  } finally { await s.stop(); }
});

test("Pro stops at the monthly cap, and Extreme does not", async () => {
  const pro = await startServer({ seed: seedLicense("pro", REMIX_PRO_CAP) });
  try {
    assert.equal((await pro.api("/state")).json.license.tier, "pro");
    const before = (await pro.api("/state")).json.projects.length;
    const blocked = await pro.api("/remix/run", { method: "POST", body: { ...sample(), confirm: true } });
    assert.equal(blocked.status, 402);
    assert.equal(blocked.json.code, "remix_cap");
    assert.match(blocked.json.error, /8 of 8/);
    assert.equal((await pro.api("/state")).json.projects.length, before);
  } finally { await pro.stop(); }

  const extreme = await startServer({ seed: seedLicense("extreme", REMIX_PRO_CAP) });
  try {
    assert.equal((await extreme.api("/state")).json.license.tier, "extreme");
    const run = await extreme.api("/remix/run", { method: "POST", body: { ...sample(), confirm: true } });
    assert.equal(run.status, 200, run.json?.error || run.text);
    assert.equal(run.json.ran, true);
    assert.equal(run.json.gate.unlimited, true);
    assert.equal(run.json.ai.started, false);
  } finally { await extreme.stop(); }
});

test("an owner rebuild writes CREDITS, scrubs the original, and does not fetch the address", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.license.tier, "owner");
    const before = (await s.api("/state")).json.projects.length;
    const address = `${s.stub.url}/not-the-app`;
    const body = sample({
      url: address,
      looks: `See ${address} on a bright board. Zorpblat shows large round tiles.`,
    });
    const copied = await s.api("/remix/run", { method: "POST", body: { ...body, looks: "decompile the game and extract the assets", confirm: true } });
    assert.equal(copied.status, 400);
    assert.equal(copied.json.code, "no_copy");
    const quiet = await s.api("/remix/run", { method: "POST", body });
    assert.equal(quiet.status, 400);
    assert.equal(quiet.json.code, "confirm");
    const close = sample({ own: { name: "Zorpblat", characters: "Blob King", look: "glowing cylinder maze", ideas: "same", art: "" } });
    const warned = await s.api("/remix/run", { method: "POST", body: { ...close, confirm: true } });
    assert.equal(warned.status, 409);
    assert.equal(warned.json.code, "too_close");
    assert.equal((await s.api("/state")).json.projects.length, before);

    const preview = await s.api("/remix/preview", { method: "POST", body });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.ran, false);
    assert.equal(preview.json.goal.includes("Zorpblat"), false);
    assert.equal(preview.json.goal.includes(SECRET), false);
    assert.equal(preview.json.goal.includes("not-the-app"), false);
    const run = await s.api("/remix/run", { method: "POST", body: { ...body, confirm: true } });
    assert.equal(run.status, 200, run.json?.error || "");
    assert.equal(run.json.projectName, "Luma Tiles");
    assert.equal(run.json.ai.started, false);
    assert.match(run.json.creditsText, /Required credit: Godot Engine, MIT License/);
    assert.equal(run.json.creditsText.includes("Stolen Sprites"), false);
    assert.equal(run.json.goal.includes(SECRET), false);
    const projects = (await s.api("/state")).json.projects;
    assert.equal(projects.length, before + 1);
    const project = projects.find((p) => p.id === run.json.projectId);
    assert.equal(project.name, "Luma Tiles");
    assert.match(project.summary, /Luma the fox/);
    assert.equal(project.summary.includes("Zorpblat"), false);
    assert.equal(project.summary.includes(SECRET), false);
    assert.equal(project.summary.includes("not-the-app"), false);
    const credits = fs.readFileSync(path.join(s.dir, "projects", run.json.projectId, "CREDITS.md"), "utf8");
    assert.match(credits, /Required credit: Godot Engine, MIT License\. https:\/\/godotengine\.org/);
    assert.match(credits, /Paper Kit by Ada, MIT/);
    assert.equal(credits.includes("Stolen Sprites"), false);
    const listed = await s.api(`/remix/credits/${run.json.projectId}`);
    assert.equal(listed.status, 200);
    assert.match(listed.json.creditsText, /Godot Engine, MIT License/);
    const saved = fs.readFileSync(path.join(s.dir, "remix.runs.json"), "utf8");
    assert.equal(saved.includes("Zorpblat"), false);
    assert.equal(saved.includes("Luma the fox"), false);
    assert.equal(saved.includes(SECRET), false);
    assert.equal(saved.includes("not-the-app"), false);
    assert.equal(s.stub.hits.some((hit) => String(hit.path).includes("not-the-app")), false);
    const rated = await s.api("/remix/rate", { method: "POST", body: { id: run.json.run.id, up: true, fix: false, originalName: "Zorpblat", note: SECRET } });
    assert.equal(rated.status, 200);
    assert.equal(rated.json.suggestion.engineId, "godot");
    assert.equal(rated.json.share.sent, false);
    const again = fs.readFileSync(path.join(s.dir, "remix.runs.json"), "utf8");
    assert.equal(again.includes("Zorpblat"), false);
    assert.equal(again.includes(SECRET), false);
  } finally { await s.stop(); }
});
