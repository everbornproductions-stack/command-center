// Phase 6: media actions (R2). The running server in a temp data dir with the demo AIs; Kling is a local mock
// on a random port (KLING_API_BASE), its "key" is made up. No real key or URL.
//  - demo mode: a mission that asks for a video gets a media step; it is a dry run (nothing spent, no ledger
//    line), shows the estimate, and saves a placeholder into the project's media folder
//  - keyed: Generate needs the current estimate, the spend cap refuses, the job calls Kling with a signed JWT,
//    polls, saves the file to the project, writes one ledger line; the file is served with the token only
//  - a mission's paid media step waits for the person's OK; approve makes it and the mission is updated;
//    decline spends nothing
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { startServer, freePort } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FINAL = ["done", "done-with-errors", "failed", "aborted"];

async function waitMission(s, pred, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const m = (await s.api("/missions")).json.find(pred); if (m && FINAL.includes(m.status)) return (await s.api(`/missions/${m.id}`)).json; await sleep(250); }
  throw new Error("mission did not finish");
}
async function waitJob(s, id, statuses, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const j = (await s.api("/media/jobs")).json.find((x) => x.id === id); if (j && statuses.includes(j.status)) return j; await sleep(150); }
  throw new Error(`media job ${id} did not reach ${statuses}`);
}
const ledger = async (s) => (await s.api("/state")).json.ledger.recent;

// a pretend Kling: text2video gives a task id, the first poll says processing, the next says succeed with a
// video address on this same mock; every request is recorded
const VIDEO = Buffer.from("not really an mp4, just bytes for the test");
async function mockKling() {
  const port = await freePort();
  const hits = [];
  const polls = new Map();
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    hits.push({ method: req.method, path: req.url, auth: req.headers.authorization || "", body: body ? JSON.parse(body) : null });
    const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.method === "POST" && req.url === "/v1/videos/text2video") return send({ code: 0, data: { task_id: `task-${hits.length}` } });
    const m = req.url.match(/^\/v1\/videos\/text2video\/(task-\d+)$/);
    if (m) {
      const n = (polls.get(m[1]) || 0) + 1; polls.set(m[1], n);
      return send({ code: 0, data: n < 2 ? { task_status: "processing" } : { task_status: "succeed", task_result: { videos: [{ url: `http://127.0.0.1:${port}/files/${m[1]}.mp4` }] } } });
    }
    if (req.url.startsWith("/files/")) { res.writeHead(200, { "content-type": "video/mp4" }); return res.end(VIDEO); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) };
}
function jwtOk(auth, ak, sk) {
  const [h, p, sig] = auth.replace(/^Bearer /, "").split(".");
  const want = crypto.createHmac("sha256", sk).update(`${h}.${p}`).digest("base64url");
  return sig === want && JSON.parse(Buffer.from(p, "base64url").toString()).iss === ak;
}

test("media: a demo mission's media step is a dry run with a placeholder saved to the project", { timeout: 180000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const pid = (await s.api("/projects", { method: "POST", body: { name: "Spring Sale" } })).json.id;
    const prov = (await s.api("/media/providers")).json;
    assert.ok(prov.every((p) => p.keyed === false), "no media key in demo mode");
    const est = (await s.api("/media/estimate", { method: "POST", body: { provider: "kling", kind: "video", params: { prompt: "x", duration: 5 } } })).json;
    assert.equal(est.dryRun, true); assert.ok(est.usd > 0, "the estimate is shown even for a dry run");
    assert.equal((await s.api("/media/estimate", { method: "POST", body: { provider: "elevenlabs", kind: "video", params: { prompt: "x" } } })).status, 400, "a provider that does not make that kind");

    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "Make a short video for the spring sale", projectId: pid, qa: false } })).status, 202);
    const m = await waitMission(s, (x) => x.kind === "mission" && x.projectId === pid);
    // 0.4.21: a mission that only made a placeholder is never a plain "done": it carries a loud banner
    assert.equal(m.status, "done-with-errors", m.error);
    assert.equal(m.banner?.kind, "dry-run");
    assert.match(m.banner.text, /placeholder, nothing was generated/);
    assert.match(m.banner.text, /Video needs a video AI key/);
    const t = m.tasks.find((x) => x.capability === "media");
    assert.ok(t, "the plan has a media step");
    assert.equal(t.status, "done");
    assert.equal(t.media.kind, "video"); assert.equal(t.media.provider, "kling"); assert.equal(t.media.status, "dry-run"); assert.equal(t.media.dryRun, true);
    assert.equal(t.cost, 0, "a dry run costs nothing");
    assert.ok(t.media.files.length === 1 && /-dry-run\.svg$/.test(t.media.files[0].name));
    assert.ok(!JSON.stringify(t.media).includes(s.dir), "the page never gets the file's place on disk");
    assert.match(m.deliverable, /## Make the video\n\nDry run, nothing spent: no Kling AI key is saved\. Estimate for the real video: about \$/);
    const jobs = (await s.api(`/media/jobs?missionId=${m.id}`)).json;
    assert.equal(jobs.length, 1);
    const file = path.join(s.dir, "projects", pid, "media", t.media.files[0].name);
    assert.ok(fs.existsSync(file), "the placeholder is in the project's media folder");
    assert.match(fs.readFileSync(file, "utf8"), /^<svg[\s\S]*video dry run/);
    assert.ok(!(await ledger(s)).some((e) => e.kind === "credits"), "no ledger line for a dry run");
    // served with the session token only, as a sandboxed file
    assert.equal((await s.api(`/media/file?id=${jobs[0].id}&i=0`, { noToken: true })).status, 401);
    const f = await s.api(`/media/file?id=${jobs[0].id}&i=0`);
    assert.equal(f.status, 200); assert.equal(f.headers["content-type"], "image/svg+xml"); assert.equal(f.headers["x-content-type-options"], "nosniff"); assert.match(f.headers["content-security-policy"], /sandbox/);
    assert.equal((await s.api(`/media/file?id=nope&i=0`)).status, 404);
    assert.equal((await s.api("/media/open", { method: "POST", body: { path: "C:\\Windows\\System32" } })).status, 400, "show in folder takes a job's own file only");

    // a voice-over from the Media tab: a dry run saves a second of silence
    const v = await s.api("/media/generate", { method: "POST", body: { provider: "elevenlabs", kind: "voice", params: { text: "Spring is here." }, projectId: pid } });
    assert.equal(v.status, 202, v.text);
    const vj = await waitJob(s, v.json.id, ["dry-run"]);
    const wav = fs.readFileSync(path.join(s.dir, "projects", pid, "media", vj.files[0].name));
    assert.equal(wav.subarray(0, 4).toString(), "RIFF"); assert.equal(wav.subarray(8, 12).toString(), "WAVE");
    assert.equal((await s.api("/media/generate", { method: "POST", body: { provider: "elevenlabs", kind: "voice", params: { text: "" } } })).status, 400, "words required");
  } finally { await s.stop(); }
});

test("media: estimate first, spend caps, Kling job saved to the project and in the ledger, a mission step waits for your OK", { timeout: 240000 }, async () => {
  const k = await mockKling();
  const s = await startServer({ env: { CC_DEV_OWNER: "1", KLING_API_BASE: k.url, CC_MEDIA_POLL_MS: "150" } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const pid = (await s.api("/projects", { method: "POST", body: { name: "Kling Test" } })).json.id;
    assert.equal((await s.api("/media/keys", { method: "POST", body: { provider: "kling", key: "ak-test-made-up", secret: "sk-test-made-up" } })).status, 200);
    const body = { provider: "kling", kind: "video", params: { prompt: "A neon city at night", duration: 5 }, projectId: pid };
    const est = (await s.api("/media/estimate", { method: "POST", body })).json;
    assert.equal(est.keyed, true); assert.equal(est.dryRun, false);
    assert.equal(est.usd, 0.35, "5 s at the turbo rate");

    // no estimate, or an older lower one: refused before any call
    const no = await s.api("/media/generate", { method: "POST", body });
    assert.equal(no.status, 409); assert.equal(no.json.code, "estimate_first"); assert.equal(no.json.estimate.usd, 0.35);
    assert.equal((await s.api("/media/generate", { method: "POST", body: { ...body, estimate: 0.1 } })).status, 409);
    // the spend cap: over it, nothing is called
    await s.api("/alerts/caps", { method: "POST", body: { caps: { kling: 0.2 } } });
    const capped = await s.api("/media/generate", { method: "POST", body: { ...body, estimate: est.usd } });
    assert.equal(capped.status, 402, capped.text); assert.equal(capped.json.code, "capped");
    assert.equal(k.hits.length, 0, "Kling was never called");
    await s.api("/alerts/caps", { method: "POST", body: { caps: {} } });

    // the click with the estimate: Kling is called with a signed token, polled, the file saved
    const g = await s.api("/media/generate", { method: "POST", body: { ...body, estimate: est.usd } });
    assert.equal(g.status, 202, g.text);
    const done = await waitJob(s, g.json.id, ["done", "failed"]);
    assert.equal(done.status, "done", done.error);
    const post = k.hits.find((h) => h.method === "POST");
    assert.ok(jwtOk(post.auth, "ak-test-made-up", "sk-test-made-up"), "HS256 JWT signed with the secret key");
    assert.equal(post.body.prompt, "A neon city at night"); assert.equal(post.body.duration, "5");
    assert.ok(k.hits.filter((h) => /text2video\/task-/.test(h.path)).length >= 2, "polled until done");
    assert.equal(done.taskId, "task-1", "the provider's task id is kept for the live view's Kling link");
    const saved = path.join(s.dir, "projects", pid, "media", done.files[0].name);
    assert.deepEqual(fs.readFileSync(saved), VIDEO, "the video is in the project's media folder");
    const lines = (await ledger(s)).filter((e) => e.kind === "credits");
    assert.equal(lines.length, 1); assert.equal(lines[0].provider, "kling"); assert.equal(lines[0].cost, 0.35); assert.equal(lines[0].project, pid);
    assert.ok(!JSON.stringify(lines).includes("neon"), "no prompt text in the ledger");
    assert.ok(!JSON.stringify((await s.api("/media/jobs")).json).includes("sk-test-made-up"), "the key never reaches the page");

    // a mission's media step with a key: it waits for the OK; nothing is spent until then
    const before = k.hits.length;
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "Make a video for the launch", projectId: pid, qa: false } })).status, 202);
    const m = await waitMission(s, (x) => x.kind === "mission" && x.projectId === pid);
    assert.equal(m.status, "done", m.error);
    const t = m.tasks.find((x) => x.capability === "media");
    assert.equal(t.status, "waiting"); assert.equal(t.media.status, "awaiting_ok"); assert.equal(t.media.dryRun, false);
    assert.match(m.deliverable, /\*\*Media waiting for your OK:\*\* "Make the video" \(Kling AI video, about \$0\.35\)/);
    assert.equal(k.hits.length, before, "no call before the OK");
    assert.equal((await s.api(`/media/jobs/${t.media.jobId}/approve`, { method: "POST", body: {} })).status, 409, "approve carries the estimate");
    const ok = await s.api(`/media/jobs/${t.media.jobId}/approve`, { method: "POST", body: { estimate: t.media.usd } });
    assert.equal(ok.status, 202, ok.text);
    await waitJob(s, t.media.jobId, ["done"]);
    let m2;
    for (let i = 0; i < 60; i++) { m2 = (await s.api(`/missions/${m.id}`)).json; if (m2.tasks.find((x) => x.id === t.id).status === "done") break; await sleep(150); }
    const t2 = m2.tasks.find((x) => x.id === t.id);
    assert.equal(t2.status, "done"); assert.equal(t2.late, true); assert.equal(t2.cost, 0.35);
    assert.match(m2.deliverable, /## Make the video\n\nKling AI made the video \(about \$0\.35\)\. Saved to the project:/);
    assert.ok(m2.cost >= 0.35, "the media cost is on the mission");
    assert.equal((await s.api(`/media/jobs/${t.media.jobId}/approve`, { method: "POST", body: { estimate: 1 } })).status, 409, "approved once");

    // decline: nothing made, nothing spent
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "Make a clip about the new menu", projectId: pid, qa: false } })).status, 202);
    const m3 = await waitMission(s, (x) => x.kind === "mission" && x.projectId === pid && x.id !== m.id);
    const t3 = m3.tasks.find((x) => x.capability === "media");
    const callsBefore = k.hits.length, ledgerBefore = (await ledger(s)).filter((e) => e.kind === "credits").length;
    assert.equal((await s.api(`/media/jobs/${t3.media.jobId}/decline`, { method: "POST", body: {} })).status, 200);
    let m4;
    for (let i = 0; i < 60; i++) { m4 = (await s.api(`/missions/${m3.id}`)).json; if (m4.tasks.find((x) => x.id === t3.id).status !== "waiting") break; await sleep(150); }
    assert.match(m4.tasks.find((x) => x.id === t3.id).media.status, /declined/);
    assert.match(m4.deliverable, /Not made: you said no to the Kling AI video\. Nothing was spent\./);
    assert.equal(k.hits.length, callsBefore); assert.equal((await ledger(s)).filter((e) => e.kind === "credits").length, ledgerBefore);
  } finally { await s.stop(); await k.close(); }
});
