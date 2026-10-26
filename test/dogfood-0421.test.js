// 0.4.21 dogfood fixes: media preflight, image fallback across image AIs, headline text on a picture, the ratings
// that carry a step id, and the plain routes behind the result card. Local mock AIs, no real key or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";
import * as O from "../server/overlay.js";
import * as PF from "../server/media-preflight.js";
import * as G from "../server/step-guard.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the headline compositor ----------
test("overlay: a headline is drawn onto a real PNG, the size stays, the pixels change only where the text goes", () => {
  const bg = O.gradientPng(1080, 1080);
  assert.ok(O.isPng(bg));
  const r = O.overlayPng(bg, "Your listings deserve a movie.", { position: "bottom" });
  assert.ok(O.isPng(r.png));
  assert.equal(r.w, 1080); assert.equal(r.h, 1080);
  assert.ok(r.lines.length >= 2 && r.lines.join(" ") === "Your listings deserve a movie.", r.lines.join("|"));
  const a = O.decodePng(bg), b = O.decodePng(r.png);
  const px = (img, x, y) => img.rgba.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4).join(",");
  assert.equal(px(a, 40, 20), px(b, 40, 20), "the top of the picture is untouched");
  let white = 0;
  for (let y = 600; y < 1080; y++) for (let x = 0; x < 1080; x++) { const i = (y * 1080 + x) * 4; if (b.rgba[i] > 240 && b.rgba[i + 1] > 240 && b.rgba[i + 2] > 240) white++; }
  assert.ok(white > 4000, `white letter pixels in the text block (${white})`);
  // top and center work too, and the long text shrinks to fit
  const top = O.overlayPng(bg, "A much longer headline that has to be wrapped over several lines to fit", { position: "top" });
  assert.ok(top.lines.length <= 4 && top.px < r.px);
  assert.ok(O.isPng(O.overlayPng(bg, "Centered", { position: "center", color: "#ffd166" }).png));
  assert.throws(() => O.overlayPng(bg, "   "), /headline/);
});

test("overlay: PNG read and write round-trip; other formats and interlaced PNGs are refused with a plain reason", () => {
  const img = { w: 3, h: 2, rgba: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0]) };
  const back = O.decodePng(O.encodePng(img));
  assert.equal(back.w, 3); assert.equal(back.h, 2); assert.deepEqual([...back.rgba], [...img.rgba]);
  assert.throws(() => O.decodePng(Buffer.from("not a png at all, just text")), /not a PNG/);
  assert.equal(O.isPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
  const inter = Buffer.from(O.encodePng(img)); inter[28] = 1; // the interlace byte in IHDR
  assert.throws(() => O.decodePng(inter), /interlaced/);
  assert.throws(() => O.dataUrlToPng("data:image/jpeg;base64,AAAA"), /PNG/);
  assert.ok(O.isPng(O.dataUrlToPng(`data:image/png;base64,${O.gradientPng(8, 8).toString("base64")}`)));
});

test("overlay: the headline a task asks for is found in the task text", () => {
  assert.equal(O.extractHeadline('One 1080x1080 Everborn Instagram image, headline "Your listings deserve a movie."'), "Your listings deserve a movie.");
  assert.equal(O.extractHeadline("Make a banner with the text “Open house Saturday” in big letters"), "Open house Saturday");
  assert.equal(O.extractHeadline("Headline: Move in this spring."), "Move in this spring");
  assert.equal(O.extractHeadline("A woman on a beach"), "");
});

// ---------- the running server ----------
async function imageMocks() {
  const behave = { openai: 429, google: "ok" };
  const seen = [];
  const PNG = O.gradientPng(64, 64);
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, prefix === "google" ? { models: [{ name: "models/gemini-3.8-flash" }] } : { data: [{ id: "mock" }] });
    seen.push({ prefix, path: url.pathname });
    if (behave[prefix] === 429) return send(429, { error: { message: "Rate limit reached for this model." } });
    if (prefix === "openai" && /images\/generations/.test(url.pathname)) return send(200, { data: [{ b64_json: PNG.toString("base64") }] });
    if (prefix === "google" && /:generateContent/.test(url.pathname)) return send(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] });
    return send(404, { error: "no route " + url.pathname });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, behave, seen, close: () => new Promise((r) => srv.close(r)) };
}

test("server: preflight says what is missing; an image the first image AI cannot make is made by the next one; the headline lands in MindMedia; routes are token-gated", { timeout: 240000 }, async () => {
  const m = await imageMocks();
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_MEDIA_POLL_MS: "100", CC_BASE_URL_OPENAI: `${m.base}/openai/v1`, CC_BASE_URL_GOOGLE: `${m.base}/google/v1beta/openai`, OPENAI_API_KEY: "", GEMINI_API_KEY: "", XAI_API_KEY: "", ANTHROPIC_API_KEY: "", GROQ_API_KEY: "", FAL_KEY: "", REPLICATE_API_TOKEN: "" } });
  try {
    assert.equal((await s.api("/dogfood/preflight?goal=x", { noToken: true })).status, 401, "session token required");
    // nothing keyed: image is blocked, plain words, placeholder named as such
    const none = (await s.api(`/dogfood/preflight?goal=${encodeURIComponent("Make one image for Instagram")}`)).json;
    assert.deepEqual(none.kinds, ["image"]); assert.equal(none.blocked, true);
    assert.match(none.banner, /Image needs an image AI key/); assert.match(none.banner, /placeholder, not a real image/);
    assert.doesNotMatch(none.banner, /—/);
    // a task that only asks for words needs no media AI
    assert.deepEqual((await s.api(`/dogfood/preflight?goal=${encodeURIComponent("Write a video script for brokers")}`)).json.kinds, []);

    // keys for two image AIs
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "openai", key: "sk-proj-fakefakefakefakefake" } })).json.status.status, "green");
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "google", key: "AIzaFAKEfakeFAKEfakeFAKEfake0123456789" } })).json.status.status, "green");
    const ok = (await s.api(`/dogfood/preflight?goal=${encodeURIComponent("Make one image for Instagram")}`)).json;
    assert.equal(ok.blocked, false); assert.equal(ok.items[0].provider, "openai");
    assert.match(ok.items[0].message, /OpenAI GPT-Image will make it\. If it fails, Google Gemini steps in/);

    const pid = (await s.api("/projects", { method: "POST", body: { name: "Beach" } })).json.id;
    const body = { provider: "openai", kind: "image", params: { prompt: "A woman on a beach at sunset" }, projectId: pid };
    const est = (await s.api("/media/estimate", { method: "POST", body })).json;
    assert.equal(est.dryRun, false, "OpenAI is a real image maker here");
    const g = await s.api("/media/generate", { method: "POST", body: { ...body, estimate: est.usd } });
    assert.equal(g.status, 202, g.text);
    let job;
    for (let i = 0; i < 100; i++) { job = (await s.api("/media/jobs")).json.find((x) => x.id === g.json.id); if (job && ["done", "failed"].includes(job.status)) break; await sleep(150); }
    assert.equal(job.status, "done", job.error);
    assert.equal(job.provider, "google", "Gemini stood in when OpenAI was rate limited");
    assert.match(job.note, /OpenAI GPT-Image could not make the image .*Google Gemini stood in/);
    assert.deepEqual(m.seen.map((x) => x.prefix), ["openai", "google"]);
    assert.equal(job.files.length, 1);

    // the headline: a real PNG in the project's media folder, listed with the job and in MindMedia
    assert.equal((await s.api("/dogfood/overlay", { method: "POST", body: { jobId: job.id, text: "" } })).status, 400);
    const ov = await s.api("/dogfood/overlay", { method: "POST", body: { jobId: job.id, text: "Your listings deserve a movie.", position: "bottom" } });
    assert.equal(ov.status, 200, ov.text);
    assert.equal(ov.json.ok, true); assert.equal(ov.json.w, 64);
    assert.ok(O.isPng(fs.readFileSync(ov.json.path)));
    assert.ok(ov.json.path.startsWith(path.join(s.dir, "projects", pid, "media")), "saved in the project's media folder");
    const after = (await s.api("/media/jobs")).json.find((x) => x.id === job.id);
    assert.equal(after.files.length, 2, "the headline picture is kept with the job");
    const hub = (await s.api(`/mindmedia?project=${pid}`)).json;
    assert.ok(JSON.stringify(hub).includes(ov.json.name), "it shows in MindMedia");
    // a picture the page drew itself (JPEG sources) is saved through the same door
    const drawn = await s.api("/dogfood/overlay/save", { method: "POST", body: { dataUrl: `data:image/png;base64,${O.gradientPng(16, 16).toString("base64")}`, projectId: pid, name: "from canvas" } });
    assert.equal(drawn.status, 200); assert.ok(O.isPng(fs.readFileSync(drawn.json.path)));
    assert.equal((await s.api("/dogfood/overlay/save", { method: "POST", body: { dataUrl: "data:image/png;base64,AAAA", projectId: pid } })).status, 400, "not a PNG");
    // a JPEG source asks the page to draw it
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
    const jdir = path.join(s.dir, "projects", pid, "media"); fs.writeFileSync(path.join(jdir, "x.jpg"), jpg);
    assert.equal(O.isPng(jpg), false);
  } finally { await s.stop(); await m.close(); }
});

// ---------- ratings that carry the step, and the whole-result thumb ----------
test("server: every step can be rated on its own, an image step is stored as media/image, and the whole result has its own thumb", { timeout: 120000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const mid = "m-test-ratings";
    const post = (b) => s.api("/ratings", { method: "POST", body: { missionId: mid, kind: "mission", ...b } });
    assert.equal((await post({ provider: "anthropic", model: "claude-a", capability: "code", stepId: "t1", up: true })).status, 200);
    assert.equal((await post({ provider: "anthropic", model: "claude-a", capability: "analysis", stepId: "t2", up: false, note: "QA missed it" })).status, 200, "the same model on two steps keeps two ratings");
    assert.equal((await post({ provider: "openai", model: "gpt-image-1", capability: "media", stepKind: "media/image", stepId: "t3", up: false })).status, 200);
    const items = (await s.api(`/ratings/mission/${mid}`)).json;
    assert.equal(items.length, 3);
    const byStep = Object.fromEntries(items.map((x) => [x.stepId, x]));
    assert.equal(byStep.t1.capability, "code"); assert.equal(byStep.t1.up, true);
    assert.equal(byStep.t2.capability, "analysis"); assert.equal(byStep.t2.up, false);
    assert.equal(byStep.t3.capability, "media"); assert.equal(byStep.t3.stepKind, "media/image", "an image step is not writing or code");
    // a changed mind on one step replaces only that step's thumb
    await post({ provider: "anthropic", model: "claude-a", capability: "code", stepId: "t1", up: false });
    const again = (await s.api(`/ratings/mission/${mid}`)).json;
    assert.equal(again.length, 3); assert.equal(again.find((x) => x.stepId === "t1").up, false);
    // the whole result: no model needed, one per run, with a reason and the wrong step
    const bad = await post({ scope: "result", up: false, reason: "wrong step", wrongStep: "t3" });
    assert.equal(bad.status, 200); assert.equal(bad.json.scope, "result"); assert.equal(bad.json.wrongStep, "t3");
    await post({ scope: "result", up: true });
    const res = (await s.api(`/ratings/mission/${mid}`)).json.filter((x) => x.scope === "result");
    assert.equal(res.length, 1); assert.equal(res[0].up, true);
    assert.equal((await s.api("/ratings", { method: "POST", body: { missionId: mid, up: true } })).status, 400, "a step thumb still needs a model");
    const sum = (await s.api("/ratings/summary")).json;
    assert.ok(sum.byModel["gpt-image-1"].byCap.media, "media is its own task type in the summary");
    assert.equal(sum.byModel.undefined, undefined, "a whole-result thumb is not a model");
  } finally { await s.stop(); }
});

// ---------- pure preflight ----------
test("preflight: which media a task needs is read from plain words", () => {
  assert.deepEqual(PF.neededMedia("Make one 1080x1080 Instagram image with a headline"), ["image"]);
  assert.deepEqual(PF.neededMedia("Create a short video for the spring sale"), ["video"]);
  assert.deepEqual(PF.neededMedia("Write a 5-day campaign plan and save it as campaign.md"), []);
  assert.deepEqual(PF.neededMedia("Build a landing page for listing videos, a single index.html"), []);
  assert.deepEqual(PF.neededMedia("Write a video script for brokers"), []);
  assert.ok(G.namedFile("save as campaign.md"));
});
