// Slice A3: next actions bar, Send to menu, and the Remix fixes (flag: nextactions).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import {
  NEXT_ACTIONS, SEND_TO, MENU_LABEL, cleanText, variationPrompts, commandVariationText, sendRows, resultLink, scopeLabel, statusLine, pushLog,
} from "../web/next-actions.js";
import { remixFolder, creditsRetry, freeStandIn } from "../server/next-actions.js";
import { planActions, PINNED } from "../web/answer-actions.js";

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DASH = String.fromCharCode(0x2014);
const remixBody = () => ({
  source: "screenshots",
  looks: "A bright board with large round tiles.",
  plays: "Tap a tile to swap it. A full line clears.",
  works: "Levels speed up.",
  appType: "game",
  originalName: "Zorpblat",
  originalCharacters: "Blob King",
  own: { name: "Luma Tiles", characters: "Luma the fox and Pip the moth", look: "Soft paper cutouts in night blue and gold", ideas: "A calm puzzle about lamps", art: "My fox sketch" },
  engineId: "godot",
  packIds: ["kenney-cc0"],
  pulls: [],
  confirm: true,
});

test("flag is on by default and env turns it off or on", () => {
  const was = process.env.CC_FLAG_NEXTACTIONS;
  try {
    delete process.env.CC_FLAG_NEXTACTIONS;
    assert.equal(flagOn("nextactions"), true);
    assert.equal(flagView().nextactions, true);
    process.env.CC_FLAG_NEXTACTIONS = "1";
    assert.equal(flagOn("nextactions"), true);
    assert.equal(flagView().nextactions, true);
    process.env.CC_FLAG_NEXTACTIONS = "0";
    assert.equal(flagOn("nextactions"), false);
  } finally { if (was === undefined) delete process.env.CC_FLAG_NEXTACTIONS; else process.env.CC_FLAG_NEXTACTIONS = was; }
});

test("the three buttons and the one Send to menu use plain words", () => {
  assert.deepEqual(NEXT_ACTIONS.map((a) => a.label), ["Make 3 variations", "Add to project", "Finish"]);
  assert.deepEqual(SEND_TO.map((r) => r.label), ["Project", "Remix", "Finish", "Copy prompt"]);
  assert.equal(MENU_LABEL, "Send to...");
  assert.deepEqual(sendRows("image").map((r) => r.id), ["project", "remix", "finish", "prompt"]);
  assert.equal(sendRows("remix").some((r) => r.id === "remix"), false, "Remix does not send to itself");
});

test("variations: three different tries from the same words, none empty", () => {
  const list = variationPrompts("# A *cosy* bakery window at dawn, warm light");
  assert.equal(list.length, 3);
  assert.equal(new Set(list).size, 3);
  for (const p of list) { assert.match(p, /cosy bakery window at dawn/); assert.doesNotMatch(p, /[#*]/); }
  assert.deepEqual(variationPrompts("   "), []);
  assert.match(commandVariationText("Write a tagline"), /3 different versions[\s\S]*Write a tagline/);
  assert.equal(commandVariationText(""), "");
  assert.equal(cleanText("a".repeat(900)).length, 600);
});

test("result link, scope label, status line and log", () => {
  const link = resultLink({ kind: "image", ref: "img 1/../x", name: "A cat" });
  assert.equal(link.name, "A cat");
  assert.match(link.url, /^meldmind:image\/[\w.:-]+$/);
  assert.equal(resultLink({ kind: "bogus", ref: "" }).url, "meldmind:command");
  assert.equal(scopeLabel(1), "Scope: one item");
  assert.equal(scopeLabel(0), "Scope: one item");
  assert.equal(scopeLabel(3), "Scope: 3 items selected");
  assert.equal(statusLine({ status: "running", log: [{ text: "Step 1 started" }] }), "Working. Step 1 started");
  assert.equal(statusLine({ status: "failed" }), "Stopped");
  assert.equal(statusLine(null), "");
  let log = [];
  for (const l of ["a", "a", "b", "c", "d", "e", "f", "g"]) log = pushLog(log, l, 4);
  assert.deepEqual(log, ["d", "e", "f", "g"]);
});

test("remix folder only opens under projects/ and only for a remix id", () => {
  const dir = path.join(ROOT, "scratch-data");
  assert.equal(remixFolder(dir, "remix-abc123"), path.join(dir, "projects", "remix-abc123"));
  for (const bad of ["../x", "remix-../x", "remix-ABC", "remix-", "other-abc", "", null, "remix-a/b", "remix-a" + String.fromCharCode(92) + "b"]) assert.equal(remixFolder(dir, bad), null, String(bad));
  assert.equal(remixFolder("", "remix-abc"), null);
});

test("credits retry skips the provider that ran out and only retries on a credits error", () => {
  assert.deepEqual(creditsRetry(null), { retry: false, skip: [] });
  assert.deepEqual(creditsRetry({ status: "done", tasks: [] }), { retry: false, skip: [] });
  const out = creditsRetry({ status: "failed", tasks: [{ status: "failed", provider: "openai", error: "You exceeded your current quota, check billing" }, { status: "done", provider: "google" }] });
  assert.deepEqual(out, { retry: true, skip: ["openai"] });
  assert.equal(creditsRetry({ status: "failed", tasks: { a: { status: "failed", provider: "x", error: "Mission aborted" } } }).retry, false);
  assert.equal(creditsRetry({ status: "failed", tasks: [], error: "Payment required" }).retry, true);
});

test("free stand-in picks the first free tier with room, else none", () => {
  const tiers = { a: { name: "A free", models: ["m1"] }, b: { name: "B free", models: ["m2"] } };
  assert.deepEqual(freeStandIn(tiers, (p) => p === "b"), { provider: "b", model: "m2", name: "B free" });
  assert.equal(freeStandIn(tiers, () => false), null);
});

test("the bar stays put under the main buttons and is never swept under More", () => {
  assert.ok(PINNED.has("next-actions"));
  const plan = planActions(["prompts", "next-actions", "share"]);
  assert.deepEqual(plan.more, ["prompts", "share"]);
  const reg = read("web", "perf", "registry.js");
  assert.match(reg, /id: "next-actions", deliverable: true/);
});

test("source: no em dashes, text wraps inside its box, pages are wired to the flag", () => {
  for (const f of ["web/next-actions.js", "web/next-actions-ui.js", "web/features/next-actions.js", "server/next-actions.js", "server/plugins/nextactions.js"]) {
    assert.equal(read(...f.split("/")).includes(DASH), false, `${f} has an em dash`);
  }
  const ui = read("web", "next-actions-ui.js");
  assert.match(ui, /overflow-wrap: anywhere/);
  assert.match(ui, /min-width: 0/);
  assert.match(ui, /flags\?\.nextactions/);
  for (const f of ["images", "media", "remix"]) assert.match(read("web", "features", `${f}.js`), /next-actions-ui\.js/, f);
  const remix = read("web", "features", "remix.js");
  for (const need of ["Open saved location", "Add to Project", "remix-log", "scopeLabel", "_remixPrefill"]) assert.match(remix, new RegExp(need), need);
});

test("flag off: the new routes say so and Remix behaves as before", async () => {
  const s = await startServer({ env: { CC_FLAG_NEXTACTIONS: "0", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.nextactions, false);
    const v = await s.api("/nextactions/variations", { method: "POST", body: { text: "hello" } });
    assert.equal(v.status, 404);
    assert.equal(v.json.code, "flag_off");
    const run = await s.api("/remix/run", { method: "POST", body: remixBody() });
    assert.equal(run.status, 200, run.json?.error);
    assert.equal(run.json.scope, undefined);
    const open = await s.api("/remix/open-folder", { method: "POST", body: { projectId: run.json.projectId } });
    assert.equal(open.status, 404);
    assert.equal(open.json.code, "flag_off");
  } finally { await s.stop(); }
});

test("flag on: variations, add to project, open folder, add remix to a project", async () => {
  const s = await startServer({ env: { CC_FLAG_NEXTACTIONS: "1", CC_DEV_OWNER: "1" } });
  try {
    assert.equal((await s.api("/state")).json.flags.nextactions, true);
    const v = await s.api("/nextactions/variations", { method: "POST", body: { text: "A cosy bakery" } });
    assert.equal(v.status, 200);
    assert.equal(v.json.prompts.length, 3);
    assert.equal((await s.api("/nextactions/variations", { method: "POST", body: { text: " " } })).status, 400);

    const made = await s.api("/projects", { method: "POST", body: { name: "Bakery", color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [] }] } });
    const pid = made.json.id;
    const add = await s.api("/nextactions/add", { method: "POST", body: { projectId: pid, kind: "image", ref: "img-1", name: "Bakery photo" } });
    assert.equal(add.status, 200, add.json?.error);
    const proj = (await s.api("/state")).json.projects.find((p) => p.id === pid);
    const links = proj.categories.find((c) => c.id === "results")?.links || [];
    assert.equal(links.length, 1);
    assert.equal(links[0].name, "Bakery photo");
    assert.equal((await s.api("/nextactions/add", { method: "POST", body: { projectId: "nope", kind: "image" } })).status, 404);
    assert.equal((await s.api("/nextactions/add", { method: "POST", body: { projectId: pid, kind: "weird" } })).status, 400);

    const run = await s.api("/remix/run", { method: "POST", body: remixBody() });
    assert.equal(run.status, 200, run.json?.error);
    assert.equal(run.json.scope.items, 1);
    assert.equal(run.json.ai.started, false, "no AI and no free tier in the test server");
    assert.match(run.json.ai.reason, /free/i);
    const rid = run.json.projectId;
    const open = await s.api("/remix/open-folder", { method: "POST", body: { projectId: rid, dryRun: true } });
    assert.equal(open.status, 200, open.json?.error);
    assert.equal(open.json.folder, `projects/${rid}`);
    assert.equal((await s.api("/remix/open-folder", { method: "POST", body: { projectId: "../etc", dryRun: true } })).status, 404);
    assert.equal((await s.api("/remix/open-folder", { method: "POST", body: { projectId: "remix-doesnotexist", dryRun: true } })).status, 404);

    assert.equal((await s.api("/remix/add-to-project", { method: "POST", body: { projectId: rid, targetProjectId: "nope" } })).status, 404);
    const moved = await s.api("/remix/add-to-project", { method: "POST", body: { projectId: rid, targetProjectId: pid } });
    assert.equal(moved.status, 200, moved.json?.error);
    const after = (await s.api("/state")).json.projects.find((p) => p.id === rid);
    assert.equal(after.parentId, pid);
  } finally { await s.stop(); }
});
