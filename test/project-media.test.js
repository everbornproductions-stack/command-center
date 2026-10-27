// Tests for Slice B3: Unified Project Media & Asset Reuse (flag_projectmedia).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { startServer, ROOT, tmpDir } from "./helpers.js";
import {
  FLAG_NAME,
  PRESET_TAGS,
  isProjectMediaEnabled,
  buildVersionStacks,
  computeSmartCollections,
} from "../server/project-media.js";

const EM = "\u2014";
const EN = "\u2013";

test("pure helpers: flag_projectmedia defaults to ON, version stacks and smart collections group items", () => {
  assert.equal(FLAG_NAME, "flag_projectmedia");
  assert.deepEqual(PRESET_TAGS, ["client-ready", "draft", "final", "reference"]);

  // Default is ON unless turned off in settings or env
  const prevEnv = process.env.CC_FLAG_PROJECTMEDIA;
  delete process.env.CC_FLAG_PROJECTMEDIA;
  try {
    assert.equal(isProjectMediaEnabled({}), true);
    assert.equal(isProjectMediaEnabled({ flag_projectmedia: false }), false);
    assert.equal(isProjectMediaEnabled({ flag_projectmedia: true }), true);
    process.env.CC_FLAG_PROJECTMEDIA = "1";
    assert.equal(isProjectMediaEnabled({}), true);
    assert.equal(isProjectMediaEnabled({ flag_projectmedia: false }), true);
    process.env.CC_FLAG_PROJECTMEDIA = "0";
    assert.equal(isProjectMediaEnabled({ flag_projectmedia: true }), false);
  } finally {
    if (prevEnv === undefined) delete process.env.CC_FLAG_PROJECTMEDIA;
    else process.env.CC_FLAG_PROJECTMEDIA = prevEnv;
  }

  // Version stack builder groups variations and edits under root
  const now = Date.now();
  const sampleItems = [
    { id: "job:root:0", name: "root.png", kind: "image", isUpload: false, provider: "openai-img", providerName: "GPT Image 1", prompt: "Neon skyline at dusk", createdAt: now - 5000, parentId: null },
    { id: "job:edit1:0", name: "edit1.png", kind: "image", isUpload: false, provider: "openai-img", providerName: "GPT Image 1", prompt: "Neon skyline at dusk", createdAt: now - 3000, parentId: "job:root:0" },
    { id: "job:edit2:0", name: "edit2.png", kind: "image", isUpload: false, provider: "flux", providerName: "Flux", prompt: "Neon skyline at dusk", createdAt: now - 1000, parentId: "job:edit1:0" },
    { id: "upload:u1", name: "brief.txt", kind: "upload", isUpload: true, provider: "upload", providerName: "Upload", prompt: "", createdAt: now - 10 * 86400000, parentId: null },
  ];

  const stacks = buildVersionStacks(sampleItems);
  assert.equal(stacks.length, 2);
  const rootStack = stacks.find((s) => s.id === "job:root:0");
  assert.ok(rootStack);
  assert.equal(rootStack.versionCount, 3);
  assert.equal(rootStack.versions.length, 2);
  assert.equal(rootStack.versions[0].id, "job:edit1:0");
  assert.equal(rootStack.versions[1].id, "job:edit2:0");
  assert.equal(rootStack.latestVersion.id, "job:edit2:0");

  // Smart collections group by type, date, AI, and prompt
  const smart = computeSmartCollections(sampleItems);
  assert.equal(smart.byType.image, 3);
  assert.equal(smart.byType.uploads, 1);
  assert.equal(smart.byDate.today, 3);
  assert.equal(smart.byDate.older, 1);
  assert.ok(smart.byAi.some((a) => a.id === "openai-img" && a.count === 2));
  assert.ok(smart.byPrompt.some((p) => p.key === "neon skyline at dusk" && p.count === 3));
});

test("static checks: no em/en dashes and no dead buttons in Slice B3 files", () => {
  const files = [
    "server/project-media.js",
    "server/plugins/projectmedia.js",
    "web/features/projectmedia.js",
    "web/perf/registry.js",
    "web/app.js",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.equal(src.includes(EM), false, `${rel} contains em dash`);
    assert.equal(src.includes(EN), false, `${rel} contains en dash`);
  }

  const webSrc = fs.readFileSync(path.join(ROOT, "web/features/projectmedia.js"), "utf8");
  assert.match(webSrc, /mountProjectMedia/);
  assert.match(webSrc, /syncAssetTray/);
  assert.match(webSrc, /cc-asset-tray/);

  // the browser module must parse (a syntax error here would stop the page from loading it)
  const tmp = path.join(tmpDir("cc-pm-syntax-"), "projectmedia.mjs");
  fs.copyFileSync(path.join(ROOT, "web/features/projectmedia.js"), tmp);
  const chk = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  assert.equal(chk.status, 0, chk.stderr);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });

  // Verify every <button> in web/features/projectmedia.js has a data-* or wired id
  const tagRe = /<button\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(webSrc))) {
    const attrs = m[1];
    const hasHook = /\bid=["'][^"']+["']/.test(attrs) || /\bdata-[a-z-]+/.test(attrs) || /\btype=["']submit["']/.test(attrs);
    assert.ok(hasHook, `Unwired button in web/features/projectmedia.js: <button${attrs}>`);
  }
});

test("server integration: flag gating, unified index, version stacks, filters, tags, bulk actions, Send to..., and cross-project links", async () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const now = Date.now();
  const ids = { base: "img-base", vari: "img-vari", vid: "mj-vid", voice: "mj-voice", free: "img-free" };
  const srv = await startServer({
    seed(dir) {
      const mediaDir = path.join(dir, "projects", "alpha-proj", "media");
      const filesDir = path.join(dir, "projects", "alpha-proj", "files");
      fs.mkdirSync(mediaDir, { recursive: true });
      fs.mkdirSync(filesDir, { recursive: true });
      fs.mkdirSync(path.join(dir, "projects", "unfiled", "media"), { recursive: true });
      const put = (folder, name, buf) => { const f = path.join(folder, name); fs.writeFileSync(f, buf); return f; };
      const jobs = [
        { id: ids.free, source: "images", kind: "image", provider: "openai", op: "generate", status: "done", projectId: null, params: { prompt: "Standalone hero banner" }, createdAt: now - 100, outputs: [put(path.join(dir, "projects", "unfiled", "media"), ids.free + ".png", PNG)], mimes: ["image/png"] },
        { id: ids.voice, kind: "voice", provider: "elevenlabs", status: "dry-run", projectId: "alpha-proj", params: { text: "Welcome to Alpha Coffee Roasters." }, createdAt: now - 200, outputs: [put(mediaDir, ids.voice + "-dry-run.wav", Buffer.alloc(64, 1))] },
        { id: ids.vid, kind: "video", provider: "kling", status: "dry-run", projectId: "alpha-proj", params: { prompt: "Slow pan across coffee bar steam" }, createdAt: now - 300, outputs: [put(mediaDir, ids.vid + "-dry-run.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))] },
        { id: ids.vari, source: "images", kind: "image", provider: "openai", op: "variation", status: "done", projectId: "alpha-proj", params: { prompt: "Golden espresso cup with latte art", from: { imageId: ids.base, index: 0 } }, createdAt: now - 400, outputs: [put(mediaDir, ids.vari + ".png", PNG)], mimes: ["image/png"] },
        { id: ids.base, source: "images", kind: "image", provider: "openai", op: "generate", status: "done", projectId: "alpha-proj", params: { prompt: "Golden espresso cup on marble counter" }, createdAt: now - 500, outputs: [put(mediaDir, ids.base + ".png", PNG)], mimes: ["image/png"] },
      ];
      fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: jobs }));
      fs.writeFileSync(path.join(dir, "projects.json"), JSON.stringify({ projects: [
        { id: "alpha-proj", name: "Alpha Brand", color: "#22d3ee", categories: [] },
        { id: "beta-proj", name: "Beta Launch", color: "#a855f7", categories: [] },
      ] }));
      put(filesDir, "copy-notes.md", Buffer.from("# Alpha launch copy"));
    },
  });
  try {
    // flag is ON by default; turned off it is off in the state and on the routes
    const flagInit = await srv.api("/projectmedia/flag");
    assert.equal(flagInit.status, 200);
    assert.equal(flagInit.json.enabled, true);
    assert.equal((await srv.api("/state")).json.projectMedia, true);
    assert.equal((await srv.api("/projectmedia/flag", { method: "POST", body: { on: false } })).json.enabled, false);
    assert.equal((await srv.api("/state")).json.projectMedia, false);
    const blocked = await srv.api("/projectmedia/alpha-proj");
    assert.equal(blocked.status, 404);
    assert.equal(blocked.json.code, "flag_off");

    const flagOn = await srv.api("/projectmedia/flag", { method: "POST", body: { on: true } });
    assert.equal(flagOn.status, 200);
    assert.equal(flagOn.json.enabled, true);
    assert.equal((await srv.api("/state")).json.projectMedia, true);

    const baseImgId = ids.base;
    const varImg = { json: { id: ids.vari } };
    const unassignedImg = { json: { id: ids.free } };

    // a direct upload
    const uploadRes = await srv.api("/projectmedia/alpha-proj/upload", {
      method: "POST",
      body: { files: [{ name: "brand-guide.png", mime: "image/png", data: PNG.toString("base64"), prompt: "Brand guide reference sheet", tags: ["reference", "client-ready"] }] },
    });
    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.json.count, 1);
    const uploadedAssetId = uploadRes.json.added[0].id;

    // 5. Query unified index for alpha-proj
    const listRes = await srv.api("/projectmedia/alpha-proj");
    assert.equal(listRes.status, 200);
    // 2 images (base + variation) + 1 video + 1 voice + 1 direct upload + 1 project file = 6
    assert.equal(listRes.json.total, 6);
    // Stacks: variation is grouped under base image, so 5 root stacks
    assert.equal(listRes.json.stacks.length, 5);

    const imgStack = listRes.json.stacks.find((s) => s.id === `job:${baseImgId}:0`);
    assert.ok(imgStack, "base image stack exists");
    assert.equal(imgStack.versionCount, 2);
    assert.equal(imgStack.versions[0].id, `job:${varImg.json.id}:0`);

    // 6. Test filters (Images, Video, Audio, Uploads), sorting, and search
    const onlyVideo = await srv.api("/projectmedia/alpha-proj?type=video");
    assert.equal(onlyVideo.json.filteredTotal, 1);
    assert.equal(onlyVideo.json.items[0].kind, "video");

    const onlyAudio = await srv.api("/projectmedia/alpha-proj?type=audio");
    assert.equal(onlyAudio.json.filteredTotal, 1);
    assert.equal(onlyAudio.json.items[0].kind, "audio");

    const onlyUploads = await srv.api("/projectmedia/alpha-proj?type=uploads");
    assert.equal(onlyUploads.json.filteredTotal, 2); // brand-guide.png + copy-notes.md

    const sortedByName = await srv.api("/projectmedia/alpha-proj?sort=name-asc&flat=1");
    const names = sortedByName.json.items.map((i) => i.name);
    const expectedSorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, expectedSorted);

    // Search by prompt text, tag, and AI provider
    const searchPrompt = await srv.api("/projectmedia/alpha-proj?q=espresso&flat=1");
    assert.equal(searchPrompt.json.filteredTotal, 2);

    const searchTag = await srv.api("/projectmedia/alpha-proj?tag=client-ready&flat=1");
    assert.equal(searchTag.json.filteredTotal, 1);
    assert.equal(searchTag.json.items[0].id, uploadedAssetId);

    const searchAi = await srv.api("/projectmedia/alpha-proj?q=kling&flat=1");
    assert.equal(searchAi.json.filteredTotal, 1);
    assert.equal(searchAi.json.items[0].provider, "kling");

    // 7. Test Add from last generation into Beta project (creates a link when job belongs to Alpha)
    //    Also test unassigned generation attached in-place
    const fromLastRes = await srv.api("/projectmedia/beta-proj/from-last", {
      method: "POST",
      body: { jobId: unassignedImg.json.id },
    });
    assert.equal(fromLastRes.status, 200);
    assert.equal(fromLastRes.json.mode, "assigned");
    assert.equal(fromLastRes.json.asset.id, `job:${unassignedImg.json.id}:0`);

    // 8. Test bulk actions (tag, collection, usage, export)
    const bulkTag = await srv.api("/projectmedia/alpha-proj/bulk", {
      method: "POST",
      body: {
        assetIds: [`job:${baseImgId}:0`, uploadedAssetId],
        action: "tag",
        tag: "final",
      },
    });
    assert.equal(bulkTag.status, 200);

    const bulkCol = await srv.api("/projectmedia/alpha-proj/bulk", {
      method: "POST",
      body: {
        assetIds: [`job:${baseImgId}:0`, uploadedAssetId],
        action: "collection",
        collection: "Hero Selects",
      },
    });
    assert.equal(bulkCol.status, 200);

    const colFiltered = await srv.api("/projectmedia/alpha-proj?collection=Hero%20Selects&flat=1");
    assert.equal(colFiltered.json.filteredTotal, 2);

    const bulkExport = await srv.api("/projectmedia/alpha-proj/bulk", {
      method: "POST",
      body: {
        assetIds: [`job:${baseImgId}:0`, uploadedAssetId],
        action: "export",
      },
    });
    assert.equal(bulkExport.status, 200);
    assert.equal(bulkExport.json.items.length, 2);

    // 9. Test Send to... (Send to Remix, Send to Finish, Copy prompt, Usage badges)
    const sendRemix = await srv.api("/projectmedia/alpha-proj/send", {
      method: "POST",
      body: { assetId: `job:${baseImgId}:0`, target: "remix" },
    });
    assert.equal(sendRemix.status, 200);
    assert.equal(sendRemix.json.target, "remix");

    const sendFinish = await srv.api("/projectmedia/alpha-proj/send", {
      method: "POST",
      body: { assetId: `job:${baseImgId}:0`, target: "finish" },
    });
    assert.equal(sendFinish.status, 200);
    assert.equal(sendFinish.json.target, "finish");

    const sendPosted = await srv.api("/projectmedia/alpha-proj/send", {
      method: "POST",
      body: { assetId: `job:${baseImgId}:0`, target: "posted" },
    });
    assert.equal(sendPosted.status, 200);
    const usageKinds = sendPosted.json.assets[0].usage.map((u) => u.kind);
    assert.ok(usageKinds.includes("remix"));
    assert.ok(usageKinds.includes("finish"));
    assert.ok(usageKinds.includes("posted"));

    const copyPrompt = await srv.api("/projectmedia/alpha-proj/send", {
      method: "POST",
      body: { assetId: `job:${baseImgId}:0`, target: "copy-prompt" },
    });
    assert.equal(copyPrompt.status, 200);
    assert.match(copyPrompt.json.prompt, /Golden espresso cup/);

    // 10. Test Cross-Project Asset Links (links, NOT copies!)
    const betaDirBefore = path.join(srv.dir, "projects", "beta-proj", "media");
    const betaFilesBefore = fs.existsSync(betaDirBefore) ? fs.readdirSync(betaDirBefore) : [];

    const linkRes = await srv.api("/projectmedia/alpha-proj/send", {
      method: "POST",
      body: {
        assetId: `job:${baseImgId}:0`,
        target: "project",
        targetProjectId: "beta-proj",
      },
    });
    assert.equal(linkRes.status, 200);
    assert.equal(linkRes.json.linkedCount, 1);
    const linkedAsset = linkRes.json.assets[0];
    assert.equal(linkedAsset.isLink, true);
    assert.equal(linkedAsset.linkedFrom.projectId, "alpha-proj");
    assert.equal(linkedAsset.linkedFrom.projectName, "Alpha Brand");
    assert.equal(linkedAsset.linkedFrom.assetId, `job:${baseImgId}:0`);

    // Verify zero files were copied into beta-proj's media directory on disk
    const betaFilesAfter = fs.existsSync(betaDirBefore) ? fs.readdirSync(betaDirBefore) : [];
    assert.deepEqual(betaFilesAfter, betaFilesBefore, "Cross-project link must not copy files on disk");

    // Verify Beta project lists the linked asset and can stream its bytes via /api/projectmedia/file
    const betaList = await srv.api("/projectmedia/beta-proj");
    assert.equal(betaList.status, 200);
    assert.ok(betaList.json.items.some((a) => a.id === linkedAsset.id && a.linkedFrom?.projectId === "alpha-proj"));

    const fileRes = await srv.raw({ path: `/api${linkedAsset.fileUrl}`, headers: { "x-cc-token": srv.token } });
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers["x-content-type-options"], "nosniff");
    assert.equal(fileRes.headers["content-type"], "image/png");
    assert.equal((await srv.raw({ path: `/api${linkedAsset.fileUrl}` })).status, 401, "files need the session token");

    // an unlinked project cannot read the file through a made-up asset id
    assert.equal((await srv.api("/projectmedia/file?projectId=beta-proj&assetId=job:img-vari:0")).status, 404);

    // unstack on purpose sticks even for an automatic version
    await srv.api("/projectmedia/alpha-proj/meta", { method: "POST", body: { assetId: `job:${ids.vari}:0`, parentId: null } });
    const afterUnstack = await srv.api("/projectmedia/alpha-proj");
    assert.ok(afterUnstack.json.stacks.some((s) => s.id === `job:${ids.vari}:0`), "unstacked version is its own stack");

    // removing from a project hides it and never deletes the file on disk
    const rm = await srv.api("/projectmedia/alpha-proj/bulk", { method: "POST", body: { assetIds: [uploadedAssetId], action: "delete" } });
    assert.equal(rm.status, 200);
    assert.ok(fs.readdirSync(path.join(srv.dir, "projects", "alpha-proj", "media")).some((n) => n.endsWith("brand-guide.png")), "file stays on disk");
  } finally {
    await srv.stop();
  }
});
