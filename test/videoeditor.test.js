// Slice C3: video sound and subtitle editor (flag: videoeditor).
// The original video is never overwritten. ffmpeg is a stand-in script, so no real encoding runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";
import { flagOn, flagView } from "../server/flags.js";
import { cleanProject, buildPlan, parseSrt, toSrt, parseProbe, buildAss, totalLength } from "../server/video-editor.js";

const FAKE = path.join(ROOT, "test", "fixtures", "fake-ffmpeg-edit.mjs");
const ORIGINAL = Buffer.from("ORIGINAL-VIDEO-BYTES");
const DASH = String.fromCharCode(0x2014);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function seedFiles(dir) {
  const media = path.join(dir, "projects", "p1", "media");
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, "clip.mp4"), ORIGINAL);
  fs.writeFileSync(path.join(media, "voice.wav"), Buffer.alloc(64, 1));
  const jobs = [
    { id: "mj-v", kind: "video", provider: "kling", status: "done", projectId: "p1", params: { prompt: "A coffee bar at dawn" }, createdAt: Date.now(), outputs: [path.join(media, "clip.mp4")] },
    { id: "mj-a", kind: "voice", provider: "elevenlabs", status: "done", projectId: "p1", params: { text: "Welcome in" }, createdAt: Date.now() - 5, outputs: [path.join(media, "voice.wav")] },
  ];
  fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: jobs }));
}
async function until(s, jobId, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const j = (await s.api(`/videoeditor/jobs/${jobId}`)).json;
    if (j.state !== "running") return j;
    if (Date.now() > end) throw new Error("render never finished");
    await wait(150);
  }
}
const walk = (dir, out = []) => { for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); if (fs.statSync(f).isDirectory()) walk(f, out); else out.push(f); } return out; };

test("flag is on by default (0.4.21 restore), env turns it on, other flags stay", () => {
  const was = process.env.CC_FLAG_VIDEOEDITOR;
  try {
    delete process.env.CC_FLAG_VIDEOEDITOR;
    assert.equal(flagOn("videoeditor"), true);
    assert.equal(flagView().videoeditor, true);
    assert.equal(flagView().finishrouter, true);
    assert.equal("projectmedia" in flagView(), true);
    process.env.CC_FLAG_VIDEOEDITOR = "1";
    assert.equal(flagView().videoeditor, true);
  } finally { if (was === undefined) delete process.env.CC_FLAG_VIDEOEDITOR; else process.env.CC_FLAG_VIDEOEDITOR = was; }
});

test("project cleaning clamps times, drops empties and bad sources", () => {
  const p = cleanProject({
    name: "  ", source: { kind: "file", rel: "../../etc/passwd" },
    info: { duration: 10, width: 1280, height: 720, hasAudio: true },
    segments: [{ start: -4, end: 99 }, { start: 3, end: 3.01 }],
    subtitles: [{ start: 2, end: 1, text: "Hi" }, { start: 1, end: 2, text: "   " }],
    overlays: [{ start: 0, end: 2, text: "Title", x: 500, y: -5, size: 99, color: "red" }],
    sounds: [{ src: { kind: "file", rel: "../outside.wav" } }, { src: { kind: "job", jobId: "x", i: 0 }, volume: 900 }],
    transition: { kind: "spin", seconds: 99 }, audio: { volume: 500 },
  });
  assert.equal(p.name, "Untitled video");
  assert.equal(p.source, null, "a path outside the data folder is refused");
  assert.deepEqual(p.segments, [{ start: 0, end: 10 }]);
  assert.equal(p.subtitles.length, 1);
  assert.ok(p.subtitles[0].end > p.subtitles[0].start);
  assert.deepEqual([p.overlays[0].x, p.overlays[0].y, p.overlays[0].size, p.overlays[0].color], [100, 0, 20, "#ffffff"]);
  assert.equal(p.sounds.length, 1);
  assert.equal(p.sounds[0].volume, 200);
  assert.equal(p.transition.kind, "cut");
  assert.equal(p.transition.seconds, 3);
  assert.equal(p.audio.volume, 200);
});

test("plan: parts, fades, sound mix, subtitles and text go into one filter graph", () => {
  const p = cleanProject({
    info: { duration: 20, width: 1280, height: 720, hasAudio: true },
    segments: [{ start: 0, end: 5 }, { start: 10, end: 14 }],
    transition: { kind: "black", seconds: 0.5 }, fadeIn: 1, fadeOut: 1, audio: { volume: 80, muted: false },
    sounds: [{ src: { kind: "job", jobId: "a", i: 0 }, start: 2, volume: 50, fadeIn: 1, fadeOut: 1, length: 3 }],
    subtitles: [{ start: 1, end: 3, text: "Hello there" }], overlays: [{ start: 0, end: 4, text: "Big title", x: 50, y: 10, size: 6, color: "#ff0000" }],
  });
  assert.equal(totalLength(p), 9);
  const plan = buildPlan(p, { source: "C:\\data\\clip.mp4", soundFiles: ["C:\\data\\voice.wav"] });
  assert.equal(plan.total, 9);
  assert.equal(plan.args[plan.args.indexOf("-i") + 1], "C:\\data\\clip.mp4");
  assert.equal(plan.args.filter((a) => a === "-i").length, 2);
  for (const bit of ["trim=start=0:end=5", "trim=start=10:end=14", "fade=t=out", "fade=t=in", "color=black", "concat=n=2:v=1:a=0", "concat=n=2:v=0:a=1", "volume=0.8", "adelay=2000|2000", "amix=inputs=2", "alimiter", "ass=subs.ass"]) assert.ok(plan.filter.includes(bit), bit);
  assert.ok(plan.args.includes("-movflags"));
  assert.ok(plan.ass.includes("Hello there") && plan.ass.includes("Big title") && plan.ass.includes("&H0000FF&"));
  assert.ok(plan.ass.includes("WrapStyle: 0"), "long text wraps inside the picture");
  const small = buildPlan(p, { source: "a.mp4", soundFiles: ["b.wav"], preview: true, from: 2, length: 99 });
  assert.ok(small.filter.includes("scale=-2:360"));
  assert.deepEqual(small.args.slice(-4), ["-ss", "2", "-t", "7"]);
});

test("plan: a video with no sound still gets a sound line, and a muted original is silent", () => {
  const p = cleanProject({ info: { duration: 6, width: 640, height: 360, hasAudio: false }, segments: [{ start: 0, end: 6 }], audio: { muted: true } });
  const plan = buildPlan(p, { source: "a.mp4" });
  assert.ok(plan.filter.includes("anullsrc"));
  assert.ok(!plan.filter.includes("[0:a]"));
  assert.equal(plan.ass, "");
  const q = cleanProject({ info: { duration: 6, hasAudio: true }, audio: { muted: true } });
  assert.ok(buildPlan(q, { source: "a.mp4" }).filter.includes("volume=0["));
});

test("subtitle text is safe in ASS and SRT round-trips", () => {
  const ass = buildAss({ subtitles: [{ start: 0, end: 2, text: "A {bold} line\nSecond \\ line" }], overlays: [] }, 1280, 720);
  assert.ok(!ass.includes("{bold}") && ass.includes("\\N"));
  const rows = parseSrt("1\n00:00:01,500 --> 00:00:03,250\nHello\nthere\n\n2\n00:01:00,000 --> 00:01:02,000\nBye\n");
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].start, rows[0].end, rows[1].start], [1.5, 3.25, 60]);
  assert.equal(rows[0].text, "Hello\nthere");
  assert.equal(parseSrt(toSrt(rows)).length, 2);
  assert.equal(parseSrt("nonsense").length, 0);
});

test("probe reads length, size and sound from ffmpeg text", () => {
  const r = parseProbe("Duration: 00:01:02.50, start\n Stream #0:0: Video: h264, yuv420p, 1920x1080, 25 fps\n Stream #0:1: Audio: aac");
  assert.deepEqual(r, { duration: 62.5, width: 1920, height: 1080, hasVideo: true, hasAudio: true });
});

test("server: off means 404, state carries the flag", async () => {
  const s = await startServer({ env: { CC_FLAG_VIDEOEDITOR: "0", CC_FFMPEG_BIN: FAKE } });
  try {
    const r = await s.api("/videoeditor/projects");
    assert.equal(r.status, 404);
    assert.equal(r.json.code, "flag_off");
    assert.equal((await s.api("/state")).json.flags.videoeditor, false);
  } finally { await s.stop(); }
});

test("server: edit, preview, export. The original is never touched", async () => {
  const log = path.join(ROOT, `.ve-log-${process.pid}.txt`);
  const s = await startServer({ seed: seedFiles, env: { CC_FLAG_VIDEOEDITOR: "1", CC_FFMPEG_BIN: FAKE, FAKE_FFMPEG_LOG: log } });
  try {
    assert.equal((await s.api("/state")).json.flags.videoeditor, true);
    assert.equal((await s.api("/state")).json.flags.finishrouter, true);
    const st = (await s.api("/videoeditor/status")).json;
    assert.equal(st.ffmpeg, true);
    assert.equal(st.transitions.length, 3);
    const src = (await s.api("/videoeditor/sources")).json.items;
    assert.ok(src.some((x) => x.jobId === "mj-v" && x.kind === "video"));
    assert.ok(src.some((x) => x.jobId === "mj-a" && x.kind === "sound"));

    const bad = await s.api("/videoeditor/projects", { method: "POST", body: { source: { kind: "file", rel: "../../Windows/system.ini" } } });
    assert.equal(bad.status, 400);
    const none = await s.api("/videoeditor/projects", { method: "POST", body: {} });
    assert.equal(none.status, 400);

    const made = await s.api("/videoeditor/projects", { method: "POST", body: { source: { kind: "job", jobId: "mj-v", i: 0 } } });
    assert.equal(made.status, 200, made.text);
    const p = made.json;
    assert.equal(p.info.duration, 10);
    assert.equal(p.info.width, 1280);
    assert.equal(p.projectId, "p1");
    assert.equal(p.length, 10);

    const put = await s.api(`/videoeditor/projects/${p.id}`, { method: "PUT", body: {
      name: "Coffee ad", segments: [{ start: 1, end: 6 }], transition: { kind: "black", seconds: 0.4 }, fadeOut: 1,
      sounds: [{ label: "Voice", src: { kind: "job", jobId: "mj-a", i: 0 }, start: 1, volume: 70, fadeOut: 1 }],
      subtitles: [{ start: 0.5, end: 2.5, text: "Fresh coffee, every morning" }],
      overlays: [{ start: 0, end: 3, text: "OPEN DAILY", x: 50, y: 10, size: 6, color: "#ffee00" }],
    } });
    assert.equal(put.status, 200, put.text);
    assert.equal(put.json.length, 5);
    assert.equal(put.json.sounds.length, 1);
    assert.deepEqual(put.json.source, p.source, "the source cannot be swapped by an edit");

    const srt = await s.api(`/videoeditor/projects/${p.id}/srt`);
    assert.match(srt.text, /00:00:00,500 --> 00:00:02,500/);
    const imp = await s.api(`/videoeditor/projects/${p.id}/srt`, { method: "POST", body: { text: "1\n00:00:03,000 --> 00:00:04,000\nSecond line\n", mode: "append" } });
    assert.equal(imp.json.subtitles.length, 2);
    assert.equal((await s.api(`/videoeditor/projects/${p.id}/srt`, { method: "POST", body: { text: "garbage" } })).status, 400);

    const prev = await s.api(`/videoeditor/projects/${p.id}/preview`, { method: "POST", body: { from: 0, length: 5 } });
    assert.equal(prev.status, 200, prev.text);
    const pj = await until(s, prev.json.id);
    assert.equal(pj.state, "done", pj.error);
    const play = await s.raw({ path: `/api/videoeditor/projects/${p.id}/preview.mp4`, headers: { "x-cc-token": s.token, range: "bytes=0-3" } });
    assert.equal(play.status, 206);
    assert.equal(play.text, "FAKE");

    const exp = await s.api(`/videoeditor/projects/${p.id}/export`, { method: "POST", body: {} });
    assert.equal(exp.status, 200, exp.text);
    const ej = await until(s, exp.json.id);
    assert.equal(ej.state, "done", ej.error);
    assert.match(ej.output, /^projects\/p1\/media\/Coffee-ad-edited-\d+\.mp4$/);
    assert.equal(fs.readFileSync(path.join(s.dir, ...ej.output.split("/"))).toString(), "FAKE-MP4");
    const orig = path.join(s.dir, "projects", "p1", "media", "clip.mp4");
    assert.equal(fs.readFileSync(orig).equals(ORIGINAL), true, "original untouched");
    assert.equal(walk(s.dir).some((f) => f.endsWith(".part.mp4")), false, "no half-written files left");

    const again = await s.api(`/videoeditor/projects/${p.id}/export`, { method: "POST", body: {} });
    const aj = await until(s, again.json.id);
    assert.notEqual(aj.output, ej.output, "a second export is a new file");
    assert.equal((await s.api(`/videoeditor/projects/${p.id}`)).json.exports.length, 2);

    const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = lines.at(-1);
    assert.ok(last.args.includes("-filter_complex"));
    assert.ok(last.args.some((a) => /ass=subs\.ass/.test(a)) && last.args.some((a) => /amix=inputs=2/.test(a)));
    assert.ok(last.ass.includes("Fresh coffee") && last.ass.includes("OPEN DAILY") && last.ass.includes("Second line"));
    assert.ok(!last.args.slice(0, -1).includes(last.args.at(-1)), "output differs from every input");

    const del = await s.api(`/videoeditor/projects/${p.id}`, { method: "DELETE" });
    assert.equal(del.json.ok, true);
    assert.equal(fs.readFileSync(orig).equals(ORIGINAL), true, "delete keeps the original");
    assert.equal(walk(s.dir).some((f) => f.includes("Coffee-ad-edited")), true, "delete keeps exports");
  } finally { await s.stop(); fs.rmSync(log, { force: true }); }
});

test("server: a second render waits, cancel stops the process and leaves no file", async () => {
  const s = await startServer({ seed: seedFiles, env: { CC_FLAG_VIDEOEDITOR: "1", CC_FFMPEG_BIN: FAKE, FAKE_FFMPEG_SLOW: "8000" } });
  try {
    const p = (await s.api("/videoeditor/projects", { method: "POST", body: { source: { kind: "job", jobId: "mj-v", i: 0 } } })).json;
    const a = await s.api(`/videoeditor/projects/${p.id}/export`, { method: "POST", body: {} });
    assert.equal(a.status, 200);
    const b = await s.api(`/videoeditor/projects/${p.id}/preview`, { method: "POST", body: {} });
    assert.equal(b.status, 409);
    assert.equal(b.json.code, "busy");
    await wait(600);
    const c = await s.api(`/videoeditor/jobs/${a.json.id}/cancel`, { method: "POST", body: {} });
    assert.equal(c.status, 200);
    const j = await until(s, a.json.id, 8000);
    assert.equal(j.state, "cancelled");
    assert.equal(walk(s.dir).some((f) => /edited|\.part\./.test(path.basename(f))), false);
    const ok = await s.api(`/videoeditor/projects/${p.id}/preview`, { method: "POST", body: {} });
    assert.equal(ok.status, 200, "free again after a cancel");
    await s.api(`/videoeditor/jobs/${ok.json.id}/cancel`, { method: "POST", body: {} });
    await until(s, ok.json.id, 8000);
  } finally { await s.stop(); }
});

test("server: no ffmpeg means plain words, and uploads stay inside the data folder", async () => {
  const s = await startServer({ seed: seedFiles, env: { CC_FLAG_VIDEOEDITOR: "1", CC_FFMPEG_BIN: "off" } });
  try {
    assert.equal((await s.api("/videoeditor/status")).json.ffmpeg, false);
    const p = (await s.api("/videoeditor/projects", { method: "POST", body: { source: { kind: "job", jobId: "mj-v", i: 0 }, duration: 8 } })).json;
    assert.equal(p.length, 8, "edits can still be planned");
    const r = await s.api(`/videoeditor/projects/${p.id}/export`, { method: "POST", body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "no_ffmpeg");
    assert.match(r.json.error, /nothing was changed/i);
    const up = await s.api("/videoeditor/upload", { method: "POST", body: { name: "../../evil.mp3", kind: "sound", data: Buffer.from("abc").toString("base64") } });
    assert.equal(up.status, 200, up.text);
    assert.ok(up.json.src.rel.startsWith("video-editor/uploads/"));
    assert.equal((await s.api("/videoeditor/upload", { method: "POST", body: { name: "x.exe", kind: "sound", data: "YWJj" } })).status, 400);
    assert.equal((await s.api("/videoeditor/upload", { method: "POST", body: { name: "x.mp3", kind: "sound", data: "" } })).status, 400);
  } finally { await s.stop(); }
});

test("wiring: registry rows, the Media page hook, no em dashes, no unwired buttons", () => {
  const reg = read("web", "perf", "registry.js");
  assert.match(reg, /id: "video-editor", views: \["media"\]/);
  assert.match(reg, /id: "videoeditor", file: "videoeditor\.js"/);
  assert.match(read("web", "features", "media.js"), /S\.flags\?\.videoeditor/);
  for (const rel of ["server/video-editor.js", "server/plugins/videoeditor.js", "web/features/video-editor.js", "test/videoeditor.test.js", "test/fixtures/fake-ffmpeg-edit.mjs"]) {
    assert.equal(read(...rel.split("/")).includes(DASH), false, rel);
  }
  const ui = read("web", "features", "video-editor.js");
  for (const m of ui.matchAll(/<button([^>]*)>/g)) assert.ok(/\bid=|data-[a-z]+/.test(m[1]), `Unwired button: ${m[1]}`);
});
