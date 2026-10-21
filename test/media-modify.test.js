// Picture and video uploads can start a media job. Plan first. Run is a second click.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { classifyFile, decodeUpload, MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "../server/box-files.js";
import { classifyAsk, editBlock, NO_EDIT, NO_TRIM, NO_VISION, routeMedia } from "../server/media-modify.js";
import { MAX_SOURCE_BYTES } from "../server/images.js";

const EM = "\u2014";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
const BLANK = {
  ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", XAI_API_KEY: "", GEMINI_API_KEY: "",
  PERPLEXITY_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "",
  FAL_KEY: "", REPLICATE_API_TOKEN: "", KLING_ACCESS_KEY: "", RUNWAY_API_KEY: "", ELEVENLABS_API_KEY: "",
  CC_STATUS_PAGES: "off",
};

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("the router picks a capable model, and size limits stay friendly", () => {
  assert.equal(classifyAsk("please trim this clip", "video"), "trim");
  assert.equal(classifyAsk("add a caption", "video"), "caption");
  assert.equal(classifyAsk("what is in this", "video"), "describe");
  assert.equal(classifyAsk("retouch the face", "image"), "edit");
  assert.equal(classifyAsk("another take please", "image"), "variation");
  assert.equal(classifyAsk("describe the picture", "image"), "describe");
  assert.equal(routeMedia({ media: "image", task: "edit", ready: { google: true, openai: true } }).provider, "openai");
  assert.equal(routeMedia({ media: "image", task: "edit", ready: { google: true, openai: true } }).kind, "image-edit");
  assert.equal(routeMedia({ media: "image", task: "variation", ready: { "demo-image": true } }).provider, "demo-image");
  assert.equal(routeMedia({ media: "image", task: "edit", ready: {} }).provider, null);
  assert.match(routeMedia({ media: "image", task: "edit", ready: {} }).message, /Nothing was sent/);
  assert.equal(routeMedia({ media: "video", task: "caption", ready: { openai: true, google: true } }).provider, "google");
  assert.equal(routeMedia({ media: "video", task: "describe", ready: { openai: true, google: true } }).kind, "vision");
  assert.equal(routeMedia({ media: "image", task: "describe", ready: { "demo-image": true } }).provider, "demo");
  assert.equal(routeMedia({ media: "video", task: "caption", ready: { "demo-image": true } }).provider, null);
  assert.match(routeMedia({ media: "video", task: "trim", ready: {}, trimmer: false }).message, /no video trimmer/);
  assert.match(NO_TRIM, /Nothing was changed/);
  assert.equal(routeMedia({ media: "video", task: "trim", ready: {}, trimmer: true }).provider, "local");
  assert.match(NO_EDIT, /OpenAI, Gemini, Replicate, or fal/);
  assert.match(NO_VISION, /Gemini or OpenAI/);
  assert.match(editBlock({ mime: "image/gif", buf: PNG }), /PNG, JPEG, or WebP/);
  assert.match(editBlock({ mime: "image/png", buf: { length: MAX_SOURCE_BYTES + 1 } }), /3\.5 MB/);
  assert.equal(editBlock({ mime: "image/png", buf: PNG }), "");

  const mp4 = Buffer.alloc(16);
  mp4.write("ftyp", 4);
  assert.equal(classifyFile("clip.mp4", mp4).kind, "video");
  assert.equal(classifyFile("clip.webm", WEBM).kind, "video");
  assert.equal(classifyFile("shot.png", PNG).kind, "image");
  assert.throws(() => classifyFile("clip.mp4", Buffer.from("0123456789abcdef")), /could not be read/);
  assert.throws(() => classifyFile("page.html", Buffer.from("<html></html>")), /not allowed/);

  const bigPic = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  PNG.copy(bigPic);
  assert.throws(() => decodeUpload({ name: "big.png", data: bigPic.toString("base64") }), /That picture is over 8 MB/);
  const bigDoc = Buffer.alloc(MAX_FILE_BYTES + 1, 0x41);
  assert.throws(() => decodeUpload({ name: "notes.txt", data: bigDoc.toString("base64") }), /That file is over 4 MB/);
  const bigVid = Buffer.alloc(MAX_VIDEO_BYTES + 1);
  WEBM.copy(bigVid);
  assert.throws(() => decodeUpload({ name: "clip.webm", data: bigVid.toString("base64") }), /That video is over 12 MB/);

  const files = ["server/media-modify.js", "server/plugins/media-modify.js", "web/features/media-modify.js", "web/features/orders-input.js", "web/features/everyday-news.js", "docs/help/idea-box.md", "docs/help/everyday-suggest.md", "docs/USER-GUIDE.md", "docs/roadmap.md"];
  for (const file of files) assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes(EM), false, file);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/idea-box.md"), "utf8"), /You see the plan, then click Run/);
  assert.match(fs.readFileSync(path.join(ROOT, "docs/help/everyday-suggest.md"), "utf8"), /Suggest a connection or idea from Settings\. You read the exact note, then click Send\. Chat is not included\./);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/tour.js"), "utf8"), /A picture or video can be retouched or described after you see the plan/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/tour.js"), "utf8"), /One chat box/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/features/tour.js"), "utf8"), /Marching orders/);
});

test("with no connected model, plan does not spend or save a result", async () => {
  let s;
  try {
    s = await startServer({ env: { ...BLANK, CC_FFMPEG_BIN: "off" } });
    assert.ok((await s.api("/state")).json.plugins.includes("media-modify"));
    const png = PNG.toString("base64");
    const shot = await s.api("/orders-box/files", { method: "POST", body: { name: "shot.png", data: png } });
    assert.equal(shot.status, 200, shot.text);
    assert.equal(shot.json.kind, "image");
    assert.equal(shot.json.sends, false);
    const before = (await s.api("/images")).json.items.length;
    const edit = await s.api("/media-modify/plan", { method: "POST", body: { fileId: shot.json.id, where: "orders", ask: "Retouch this picture" } });
    assert.equal(edit.status, 200, edit.text);
    assert.equal(edit.json.provider, null);
    assert.match(edit.json.message, /Nothing was sent/);
    assert.equal(edit.json.sends, false);
    assert.equal((await s.api("/images")).json.items.length, before);
    const webm = await s.api("/orders-box/files", { method: "POST", body: { name: "clip.webm", data: WEBM.toString("base64") } });
    assert.equal(webm.status, 200, webm.text);
    assert.equal(webm.json.kind, "video");
    const seen = await s.api("/media-modify/plan", { method: "POST", body: { fileId: webm.json.id, where: "orders", ask: "Describe this video" } });
    assert.match(seen.json.message, /Nothing was sent/);
    const trim = await s.api("/media-modify/plan", { method: "POST", body: { fileId: webm.json.id, where: "orders", ask: "Trim this video shorter" } });
    assert.match(trim.json.message, /no video trimmer/);
    const ran = await s.api("/media-modify/run", { method: "POST", body: { confirm: true, estimate: 0, fileId: webm.json.id, where: "orders", ask: "Trim this video shorter" } });
    assert.equal(ran.status, 400);
    assert.match(ran.json.error, /Nothing was changed/);
    const bad = await s.api("/orders-box/files", { method: "POST", body: { name: "nope.mp4", data: Buffer.from("0123456789abcdef").toString("base64") } });
    assert.equal(bad.status, 400);
    assert.equal((await s.api("/everyday-news")).json.ideas.length, 0);
    assert.equal(walk(s.dir).some((f) => f.includes(`${path.sep}media-modify${path.sep}`)), false);
  } finally { if (s) await s.stop(); }
});

test("demo retouch, a sample description, and a local trim stay on this computer", async () => {
  const ffmpeg = path.join(ROOT, "test", "fixtures", "fake-ffmpeg.mjs");
  let s;
  try {
    s = await startServer({ env: { ...BLANK, CC_FFMPEG_BIN: ffmpeg } });
    const webm = await s.api("/orders-box/files", { method: "POST", body: { name: "clip.webm", data: WEBM.toString("base64") } });
    assert.equal(webm.status, 200, webm.text);
    const planned = await s.api("/media-modify/plan", { method: "POST", body: { fileId: webm.json.id, where: "orders", ask: "Trim this video shorter" } });
    assert.equal(planned.status, 200, planned.text);
    assert.equal(planned.json.provider, "local");
    assert.equal(planned.json.usd, 0);
    assert.equal(planned.json.sends, false);
    const early = await s.api("/media-modify/run", { method: "POST", body: { confirm: false, estimate: 0, fileId: webm.json.id, where: "orders", ask: "Trim this video shorter" } });
    assert.equal(early.status, 400);
    assert.match(early.json.error, /separate click/);
    const trimmed = await s.api("/media-modify/run", { method: "POST", body: { confirm: true, estimate: planned.json.usd, fileId: webm.json.id, where: "orders", ask: "Trim this video shorter" } });
    assert.equal(trimmed.status, 200, trimmed.text);
    assert.equal(trimmed.json.sends, false);
    const out = walk(s.dir).find((f) => f.includes("media-modify") && path.basename(f).startsWith("out"));
    assert.ok(out);
    assert.equal(fs.readFileSync(out).equals(WEBM), true);
    const source = walk(s.dir).find((f) => f.endsWith(`${webm.json.id}.bin`));
    assert.equal(fs.readFileSync(source).equals(WEBM), true);
    const got = await s.api(`/media-modify/file/${trimmed.json.job.id}`);
    assert.match(String(got.headers["content-disposition"]), /attachment/);
    assert.equal(got.headers["x-content-type-options"], "nosniff");
    assert.equal((await s.api("/everyday-news")).json.ideas.length, 0);

    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
    const png = PNG.toString("base64");
    const shot = await s.api("/everyday-news/suggestions/files", { method: "POST", body: { name: "shot.png", data: png } });
    assert.equal(shot.status, 200, shot.text);
    assert.equal(shot.json.kind, "image");
    const gallery = (await s.api("/images")).json.items.length;
    const edit = await s.api("/media-modify/plan", { method: "POST", body: { fileId: shot.json.id, where: "idea", ask: "Retouch this picture" } });
    assert.equal(edit.status, 200, edit.text);
    assert.equal(edit.json.provider, "demo-image");
    assert.equal(edit.json.usd, 0);
    assert.match(edit.json.message, /Demo, nothing spent/);
    assert.equal((await s.api("/images")).json.items.length, gallery);
    const refused = await s.api("/media-modify/run", { method: "POST", body: { fileId: shot.json.id, where: "idea", ask: "Retouch this picture", estimate: 0 } });
    assert.equal(refused.status, 400);
    const made = await s.api("/media-modify/run", { method: "POST", body: { confirm: true, estimate: edit.json.usd, fileId: shot.json.id, where: "idea", ask: "Retouch this picture" } });
    assert.equal(made.status, 200, made.text);
    assert.equal(made.json.job.demo, true);
    assert.equal(made.json.sends, false);
    assert.equal((await s.api("/images")).json.items.length, gallery + 1);
    const preview = await s.api(`/images/${made.json.job.galleryId}/file`);
    assert.match(preview.text, /<svg/);
    assert.match(preview.text, /Demo/);
    const download = await s.api(`/media-modify/file/${made.json.job.id}`);
    assert.match(String(download.headers["content-disposition"]), /attachment/);
    assert.equal(download.headers["x-content-type-options"], "nosniff");
    assert.match(download.text, /<svg/);
    const saved = await s.api("/media-modify/save", { method: "POST", body: { jobId: made.json.job.id, projectId: "my-project" } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.sends, false);
    assert.match(saved.json.message, /Nothing was posted/);
    assert.ok(walk(s.dir).some((f) => f.includes(`${path.sep}my-project${path.sep}media${path.sep}`)));

    const described = await s.api("/media-modify/plan", { method: "POST", body: { fileId: shot.json.id, where: "idea", ask: "Describe this picture" } });
    assert.equal(described.json.provider, "demo");
    assert.equal(described.json.usd, 0);
    const sample = await s.api("/media-modify/run", { method: "POST", body: { confirm: true, estimate: 0, fileId: shot.json.id, where: "idea", ask: "Describe this picture" } });
    assert.equal(sample.status, 200, sample.text);
    assert.equal(sample.json.job.sample, true);
    assert.equal(sample.json.job.usd, 0);
    assert.match(sample.json.job.text, /shot\.png/);
    assert.match(sample.json.job.text, /Nothing was spent/);
    assert.equal((await s.api("/everyday-news")).json.ideas.length, 0);
    assert.equal(JSON.stringify(sample.json).includes(png), false);

    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(8)]);
    const moving = await s.api("/orders-box/files", { method: "POST", body: { name: "loop.gif", data: gif.toString("base64") } });
    assert.equal(moving.status, 200, moving.text);
    const gifRun = await s.api("/media-modify/run", { method: "POST", body: { confirm: true, estimate: 0, fileId: moving.json.id, where: "orders", ask: "Retouch this picture" } });
    assert.equal(gifRun.status, 400);
    assert.match(gifRun.json.error, /too big to retouch|PNG, JPEG, or WebP/);
    assert.equal((await s.api("/images")).json.items.length, gallery + 1);
  } finally { if (s) await s.stop(); }
});
