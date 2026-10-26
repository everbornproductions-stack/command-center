// Roadmap feature 3: posting hooks. Preview first, post exactly what was previewed, dry run without
// credentials, every post in history + ledger, media jobs attach, the Drive channel copies only media
// job outputs. Runs the real server on a temp data dir; no keys, nothing leaves the machine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir } from "./helpers.js";
import { mediaFromJob, buildPayload } from "../server/plugins/publish.js";

test("mediaFromJob / buildPayload: outputs split into urls and files; dry-run and unfinished jobs refuse", () => {
  const jobs = [
    { id: "a", kind: "video", status: "done", outputs: ["C:\\x\\a.mp4", "https://cdn.example/a.mp4"] },
    { id: "b", kind: "image", status: "dry-run", outputs: [] },
    { id: "c", kind: "image", status: "processing", outputs: [] },
  ];
  assert.equal(mediaFromJob(jobs, null), null);
  assert.match(mediaFromJob(jobs, "zzz").error, /not found/);
  assert.match(mediaFromJob(jobs, "b").error, /dry run/);
  assert.match(mediaFromJob(jobs, "c").error, /not finished/);
  const a = mediaFromJob(jobs, "a");
  assert.deepEqual(a.urls, ["https://cdn.example/a.mp4"]); assert.deepEqual(a.files, ["C:\\x\\a.mp4"]);
  const ig = buildPayload({ channel: "instagram", text: "hi", files: ["C:\\secret.txt"] }, a);
  assert.equal(ig.mediaUrl, "https://cdn.example/a.mp4"); assert.equal(ig.mediaType, "video"); assert.deepEqual(ig.files, [], "browser-sent files are never used");
  const dr = buildPayload({ channel: "drive", title: "t", files: ["C:\\secret.txt"] }, a);
  assert.deepEqual(dr.files, ["C:\\x\\a.mp4"], "drive copies only the media job's local outputs");
  assert.equal(buildPayload({ channel: "instagram", text: "x".repeat(3000) }).text.length, 2200);
});

let s, folder, clip;
before(async () => {
  folder = tmpDir("cc-drive-");
  s = await startServer({
    seed: (dir) => {
      clip = path.join(dir, "projects", "unfiled", "media", "mj-test.mp4");
      fs.mkdirSync(path.dirname(clip), { recursive: true });
      fs.writeFileSync(clip, "fake-mp4");
      fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: [
        { id: "mj-test", provider: "kling", kind: "video", status: "done", outputs: [clip], params: { prompt: "test clip" }, projectId: null },
        { id: "mj-dry", provider: "kling", kind: "video", status: "dry-run", outputs: [], params: { prompt: "dry" } },
      ] }));
    },
  });
});
after(async () => { await s?.stop(); try { fs.rmSync(folder, { recursive: true, force: true }); } catch {} });

const ledger = () => { const f = path.join(s.dir, "ledger.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; };

test("post needs confirmed:true and a fresh preview; a preview is good for one post", async () => {
  assert.equal((await s.api("/publish/post", { method: "POST", body: { channel: "instagram", text: "x" } })).json.code, "confirm_required");
  const noPv = await s.api("/publish/post", { method: "POST", body: { channel: "instagram", confirmed: true, text: "x" } });
  assert.equal(noPv.status, 409); assert.equal(noPv.json.code, "preview_required");
  const bogus = await s.api("/publish/post", { method: "POST", body: { previewId: "pv-nope", confirmed: true } });
  assert.equal(bogus.status, 409);

  const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "instagram", title: "Caption", text: "Hello #sacramento" } });
  assert.equal(pv.status, 200); assert.ok(pv.json.previewId); assert.equal(pv.json.dryRun, true); assert.equal(pv.json.ready, false);
  assert.ok(pv.json.problems.some((p) => /public image or video/.test(p)));

  const wrong = await s.api("/publish/post", { method: "POST", body: { channel: "ghl", previewId: pv.json.previewId, confirmed: true } });
  assert.equal(wrong.status, 409); assert.equal(wrong.json.code, "preview_mismatch");

  // no credentials: the post is recorded as a dry run, with the PREVIEWED text, not what the body says now
  const post = await s.api("/publish/post", { method: "POST", body: { channel: "instagram", previewId: pv.json.previewId, confirmed: true, text: "SWAPPED AFTER PREVIEW" } });
  assert.equal(post.status, 200); assert.equal(post.json.status, "dry-run"); assert.equal(post.json.text, "Hello #sacramento");
  const again = await s.api("/publish/post", { method: "POST", body: { previewId: pv.json.previewId, confirmed: true } });
  assert.equal(again.status, 409, "one preview, one post");

  const hist = await s.api("/publish/history");
  assert.equal(hist.json[0].id, post.json.id); assert.equal(hist.json[0].status, "dry-run");
  const led = ledger().filter((e) => e.kind === "credits" && e.provider === "instagram");
  assert.equal(led.length, 1); assert.equal(led[0].cost, null); assert.match(led[0].note, /dry-run · Instagram/);
});

test("media jobs attach: dry-run job is a problem; a local file is a problem for Instagram", async () => {
  const dry = await s.api("/publish/preview", { method: "POST", body: { channel: "instagram", text: "x", mediaJobId: "mj-dry" } });
  assert.ok(dry.json.problems.some((p) => /dry run and has no output/.test(p)));
  const local = await s.api("/publish/preview", { method: "POST", body: { channel: "instagram", text: "x", mediaJobId: "mj-test" } });
  assert.equal(local.json.media.jobId, "mj-test"); assert.equal(local.json.media.kind, "video");
  assert.ok(local.json.problems.some((p) => /file on this PC/.test(p)));
});

test("Drive folder: copies the deliverable and only the media job's file; ledger note; past GHL time is a problem", async () => {
  const noFolder = await s.api("/publish/preview", { method: "POST", body: { channel: "drive", title: "Week plan", text: "body" } });
  assert.equal(noFolder.json.dryRun, true);
  assert.equal((await s.api("/publish/prefs", { method: "POST", body: { driveFolder: folder } })).status, 200);
  const ch = await s.api("/publish/channels");
  assert.equal(ch.json.find((c) => c.id === "drive").ready, true);

  const secret = path.join(s.dir, "settings.json");
  const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "drive", title: "Week plan", text: "the plan", mediaJobId: "mj-test", files: [secret] } });
  assert.equal(pv.json.ready, true); assert.deepEqual(pv.json.problems, []); assert.equal(pv.json.media.files, 1);
  const post = await s.api("/publish/post", { method: "POST", body: { channel: "drive", previewId: pv.json.previewId, confirmed: true } });
  assert.equal(post.status, 200); assert.equal(post.json.status, "posted");
  const outDir = path.join(folder, "Meldmind", "unfiled");
  const names = fs.readdirSync(outDir);
  assert.ok(names.some((n) => n.endsWith("Week plan.md")), names.join(","));
  assert.ok(names.includes("mj-test.mp4"));
  assert.ok(!names.includes("settings.json"), "a path sent by the browser is never copied");
  assert.equal(fs.readFileSync(path.join(outDir, "mj-test.mp4"), "utf8"), "fake-mp4");
  assert.ok(ledger().some((e) => e.kind === "credits" && e.provider === "drive" && /posted · Google Drive/.test(e.note)));

  const past = await s.api("/publish/preview", { method: "POST", body: { channel: "ghl", text: "x", accountIds: ["a1"], when: Date.now() - 60000 } });
  assert.ok(past.json.problems.some((p) => /in the past/.test(p)));
});
