// MindMedia hub (0.4.20): saveToMindMedia, the cross-project list, filters, ending shelf, move, publish write-back.
// Real server on a temp data folder. No keys, no network: the publish checks use the practice (dry-run) path.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";

const EM = "—", EN = "–";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

test("source: helper, route and registry rows exist and have no dashes", () => {
  const helper = read("web", "features", "mindmedia-save.js");
  assert.match(helper, /window\.CC\.saveToMindMedia = /);
  assert.match(read("web", "perf", "registry.js"), /\{ id: "mindmedia-save", shell: true \}/);
  for (const t of [helper, read("server", "plugins", "mindmedia.js")]) assert.equal(t.includes(EM) || t.includes(EN), false);
});

test("saveToMindMedia: unfiled, project, text, files, filters, ending shelf, move, delete, publish dry run", async () => {
  const srv = await startServer({
    seed(dir) {
      fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects: [{ id: "alpha-proj", name: "Alpha Brand", color: "#22d3ee", categories: [] }] }));
      const site = path.join(dir, "projects", "alpha-proj", "site");
      fs.mkdirSync(site, { recursive: true });
      fs.writeFileSync(path.join(site, "index.html"), "<h1>Hi</h1>");
      fs.writeFileSync(path.join(dir, "secret.txt"), "do not file me");
    },
  });
  const post = (p, body) => srv.api(p, { method: "POST", body });
  try {
    // text, no project: lands in Unfiled as an item
    const t = await post("/mindmedia/save", { kind: "text", text: "# Spring sale\nTen percent off all week.", name: "Spring sale post", source: "Start a project", provenance: { prompt: "write a sale post", model: "demo", cost: 0.01 } });
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.equal(t.json.projectId, "unfiled");
    assert.match(t.json.savedWhere, /MindMedia, Unfiled/);
    assert.equal(t.json.items[0].kind, "text");
    assert.equal(t.json.items[0].status, "Draft");
    assert.equal(t.json.items[0].source, "Start a project");
    assert.equal(t.json.items[0].provenance.model, "demo");
    assert.equal(t.json.items[0].filePath, undefined, "no disk path leaks to the page");

    // image file into a project, base64
    const img = await post("/mindmedia/save", { files: [{ name: "hero.png", data: "data:image/png;base64," + PNG.toString("base64") }], projectId: "alpha-proj", source: "Images", status: "approved", tags: ["final"] });
    assert.equal(img.status, 200, JSON.stringify(img.json));
    assert.equal(img.json.items[0].kind, "image");
    assert.equal(img.json.items[0].status, "Approved");
    assert.equal(img.json.where, "Alpha Brand");

    // a builder's site folder is referenced in place
    const siteFile = path.join(srv.dir, "projects", "alpha-proj", "site", "index.html");
    const site = await post("/mindmedia/save", { kind: "site", files: [{ name: "index.html", path: siteFile }], projectId: "alpha-proj", source: "Web builder" });
    assert.equal(site.status, 200, JSON.stringify(site.json));
    assert.equal(site.json.items[0].kind, "site");

    // nothing outside projects/ can be filed, and empty saves are refused
    const bad = await post("/mindmedia/save", { files: [{ name: "x.txt", path: path.join(srv.dir, "secret.txt") }] });
    assert.equal(bad.status, 400);
    assert.equal((await post("/mindmedia/save", {})).status, 400);
    assert.equal((await post("/mindmedia/save", { text: "x", status: "nonsense" })).status, 200, "unknown status falls back to Draft");

    // dedupe: the same key updates instead of stacking
    const d1 = await post("/mindmedia/save", { text: "v1", name: "Plan", dedupeKey: "plan-1" });
    const d2 = await post("/mindmedia/save", { text: "v2", name: "Plan", dedupeKey: "plan-1" });
    assert.equal(d2.json.reused, true);
    assert.equal(d2.json.items[0].id, d1.json.items[0].id);

    // cross-project list with filters
    const all = (await srv.api("/mindmedia")).json;
    assert.ok(all.total >= 5);
    assert.deepEqual(all.statuses, ["Draft", "Review", "Approved", "Published"]);
    assert.ok(all.projects.some((p) => p.id === "unfiled") && all.projects.some((p) => p.id === "alpha-proj"));
    assert.equal((await srv.api("/mindmedia?project=alpha-proj")).json.items.every((i) => i.projectId === "alpha-proj"), true);
    assert.equal((await srv.api("/mindmedia?project=unfiled&type=text")).json.items.every((i) => i.kind === "text" && i.projectId === "unfiled"), true);
    const approved = (await srv.api("/mindmedia?status=Approved")).json.items;
    assert.equal(approved.length, 1);
    assert.equal(approved[0].kind, "image");
    assert.equal((await srv.api("/mindmedia?q=sale")).json.items.length, 1, "search reads the words inside text items");
    assert.equal((await srv.api("/mindmedia?source=Images")).json.items.length, 1);

    // text item reads back
    const one = (await srv.api(`/mindmedia/item?projectId=unfiled&assetId=${encodeURIComponent(t.json.items[0].id)}`)).json;
    assert.match(one.text, /Ten percent off/);

    // files stream through the existing file route, including Unfiled
    const fileRes = await srv.api(`/projectmedia/file?projectId=alpha-proj&assetId=${encodeURIComponent(img.json.items[0].id)}`);
    assert.equal(fileRes.status, 200);

    // the shelf: drafts nobody did anything with; Keep removes it, Discard removes the item
    const shelf = all.needsEnding;
    assert.ok(shelf.some((i) => i.id === t.json.items[0].id));
    assert.equal(shelf.some((i) => i.id === img.json.items[0].id), false, "Approved work is not nagged");
    await post("/mindmedia/ending", { projectId: "unfiled", assetId: t.json.items[0].id, action: "keep" });
    assert.equal((await srv.api("/mindmedia")).json.needsEnding.some((i) => i.id === t.json.items[0].id), false);
    assert.equal((await post("/mindmedia/ending", { projectId: "unfiled", assetId: t.json.items[0].id, action: "nope" })).status, 400);

    // rename, tags, status
    const meta = await post("/mindmedia/meta", { projectId: "unfiled", assetId: t.json.items[0].id, name: "Sale post v2", status: "review", tags: ["draft"] });
    assert.equal(meta.status, 200, JSON.stringify(meta.json));
    assert.equal((await post("/mindmedia/meta", { projectId: "unfiled", assetId: t.json.items[0].id, status: "weird" })).status, 400);

    // promote Unfiled to a project
    const mv = await post("/mindmedia/move", { projectId: "unfiled", assetId: t.json.items[0].id, targetProjectId: "alpha-proj" });
    assert.equal(mv.json.mode, "moved");
    assert.equal((await srv.api("/mindmedia?project=alpha-proj&type=text")).json.items.some((i) => i.name === "Sale post v2"), true);
    assert.equal((await srv.api("/mindmedia?project=unfiled&q=sale")).json.items.length, 0);

    // publish writes back: a practice run records the destination, never Published
    const pub = await post("/publish/preview", { channel: "instagram", text: "hello", mediaAssetId: img.json.items[0].id, mediaProjectId: "alpha-proj" });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    assert.equal(pub.json.dryRun, true);
    const posted = await post("/publish/post", { channel: "instagram", previewId: pub.json.previewId, confirmed: true });
    assert.equal(posted.json.status, "dry-run");
    const after = (await srv.api("/mindmedia?project=alpha-proj&type=image")).json.items[0];
    assert.equal(after.status, "Approved", "a practice run never marks Published");
    assert.equal(after.destinations.length, 1);
    assert.match(after.destinations[0].label, /practice, nothing sent/);

    // delete
    const del = await post("/mindmedia/delete", { items: [{ projectId: "alpha-proj", assetId: img.json.items[0].id }] });
    assert.equal(del.json.count, 1);
    assert.equal((await srv.api("/mindmedia?project=alpha-proj&type=image")).json.items.length, 0);
  } finally {
    await srv.stop();
  }
});
