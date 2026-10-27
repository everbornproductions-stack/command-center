// 0.4.21 dogfood 10 (publish one MindMedia post), against local mock AIs (no real key, no network, no outside account):
//  - "save it to my MindMedia" is a local Meldmind step: never handed to Grok Bot or a browsing agent
//  - the caption, the hashtags and (when there is one) the picture land as ONE MindMedia post (Draft), helper notes removed
//  - an image step with no key says plainly that no picture was made and how to fix it, and the post says so too
//  - Stop ends the run cleanly (aborted, server still answering, no crash), and the stopped run keeps its rating rows in the page
//  - the packaged app carries emails/welcome.html and welcome.txt
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget, ROOT } from "./helpers.js";
import { isLocalSaveStep, splitPost, stripHelperNotes } from "../server/mindmedia-step.js";
const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HTML = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Your listings deserve a movie.</title>\n<style>\nbody { margin: 0; font-family: sans-serif; background: #2b1d12; color: #fff }\n.hero { padding: 48px }\n.steps { display: grid; gap: 12px }\n</style></head>\n<body>\n<section class="hero"><h1>Your listings deserve a movie.</h1></section>\n<ol class="steps"><li>Send the address</li><li>We shoot it</li><li>You post it</li></ol>\n<form><label>Name <input name="name"></label></form>\n</body>\n</html>\n`;
const CUT_AT = HTML.indexOf(".steps { display") + 14;

async function mocks(script) {
  const seen = [];
  const counts = new Map();
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const prefix = url.pathname.split("/")[1];
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    const users = j.messages.filter((m) => m.role === "user").map((m) => m.content);
    const user = users.join("\n");
    const last = users[users.length - 1] || "";
    const title = (/TASK: (.*)/.exec(user) || [])[1] || "";
    const key = `${sys.slice(0, 20)}|${title}|${/CONTINUE FROM HERE/.test(last) ? "cont" : "first"}`; // per task, whichever AI answers
    const n = (counts.get(key) || 0) + 1; counts.set(key, n);
    seen.push({ prefix, sys, user, last, title, n });
    let out = script({ prefix, sys, user, last, title, n, cont: /CONTINUE FROM HERE/.test(last), counts });
    let finish = "stop";
    let delay = 0;
    if (out && typeof out === "object") { ({ text: out, finish = "stop", delay = 0 } = out); }
    if (delay) await sleep(delay);
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) };
}
async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", PERPLEXITY_API_KEY: "" } });
  for (const pid of ["xai", "groq", "mistral"]) assert.equal((await s.api("/keys", { method: "POST", body: { provider: pid, key: KEYS[pid] } })).json.status.status, "green", pid);
  await s.api("/fallback/settings", { method: "POST", body: { on: false } }).catch(() => {});
  return s;
}
async function runMission(s, body, ms = 90000) {
  const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
  const posted = await s.api("/mission", { method: "POST", body });
  assert.equal(posted.status, 202, posted.text);
  const t0 = Date.now();
  while (Date.now() - t0 < waitBudget(ms)) {
    const m = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status));
    if (m) return (await s.api(`/missions/${m.id}`)).json;
    await sleep(250);
  }
  throw new Error("mission did not finish\n" + s.log.slice(-600));
}
const PLAN = (tasks) => JSON.stringify({ title: "Everborn post", tasks, assembly: "Hand over the post." });
const POST_PLAN = PLAN([
  { id: "t1", title: "Write the caption", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write a caption under 150 words with a call to book a free 10-minute call and 5 hashtags.", deliverable: "caption and hashtags" },
  { id: "t2", title: "Make the square image", capability: "media", media: { kind: "image", prompt: "A warm square picture, headline: Your listings deserve a movie" }, difficulty: 1, needWeb: false, deps: [], instructions: "Make the square picture.", deliverable: "an image" },
  { id: "t3", title: "Save the post to my MindMedia library", capability: "agent", agent: "Grok Bot", needs: ["browse"], difficulty: 1, needWeb: false, deps: ["t1", "t2"], instructions: "In the user's signed-in MindMedia account, save the post to the MindMedia library only.", deliverable: "the saved post" },
]);
const CAPTION = "Your listings deserve a movie. \u{1F3AC}\nBook a free 10-minute call today: example.com/book\n\n#RealEstateMarketing #RealtorLife #MortgageBroker #ListingVideo #RealEstateAgent\n\nWord count: 20\nNo search results were cited.";

test("pure helpers: what counts as a local save step, helper notes and emoji removed, hashtags split out", () => {
  assert.equal(isLocalSaveStep({ title: "Save the post to my MindMedia library", instructions: "" }), true);
  assert.equal(isLocalSaveStep({ title: "Keep it", instructions: "Save the result in the user's signed-in MindMedia account" }), true);
  assert.equal(isLocalSaveStep({ capability: "save", title: "x" }), true);
  assert.equal(isLocalSaveStep({ title: "Write the caption", instructions: "Write a caption about the library of books" }), false);
  assert.equal(isLocalSaveStep({ title: "Post it to Instagram", instructions: "Publish to Instagram" }), false);
  const n = stripHelperNotes(CAPTION);
  assert.doesNotMatch(n, /Word count|search results/i);
  const p = splitPost(CAPTION);
  assert.equal(p.hashtags.length, 5);
  assert.equal(p.hashtags[0], "#RealEstateMarketing");
  assert.doesNotMatch(p.caption, /#|\u{1F3AC}|Word count|search results/u);
  assert.match(p.caption, /^Your listings deserve a movie\./);
  assert.match(p.caption, /example\.com\/book/);
  assert.match(splitPost("Fun \u{1F3AC} day", { keepEmoji: true }).caption, /\u{1F3AC}/u);
});

test("the packaged app carries emails/welcome.html and welcome.txt", () => {
  const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
  assert.match(yml.split(/\r?\n/).join("\n"), /^\s*-\s*emails\/\*\*\s*$/m, "electron-builder.yml must pack emails/**");
  assert.ok(fs.existsSync(path.join(ROOT, "emails", "welcome.html")));
  assert.ok(fs.existsSync(path.join(ROOT, "emails", "welcome.txt")));
});

test("a MindMedia save step stays local, makes ONE post item, says where, and a missing image key is said plainly", { timeout: 300000 }, async () => {
  const m = await mocks(({ sys, title }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return POST_PLAN;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
    if (/You assemble/.test(sys)) return "The post is saved.";
    if (title === "Write the caption") return CAPTION;
    return "Done.";
  });
  const s = await boot(m);
  try {
    const before = (await s.api("/mindmedia")).json.total || 0;
    const run = await runMission(s, { goal: "Make one MindMedia post for Everborn Productions: a square image with the text 'Your listings deserve a movie', a caption under 150 words with a call to book a free call, and 5 hashtags. Save it to my MindMedia library only.", qa: false });
    const save = run.tasks.find((t) => t.id === "t3");
    assert.ok(save, "the plan has the save step");
    assert.equal(save.save, true, "the save step is a local Meldmind step");
    assert.equal(save.agent, false, "it is never an agent step");
    assert.notEqual(save.provider, "grokbot");
    assert.equal(save.status, "done", `${save.status} ${save.error}`);
    assert.match(save.output, /Saved to MindMedia as one post \(Draft\)/);
    assert.match(save.output, /Saved in MindMedia/);
    // the picture step is honest about the missing key
    const img = run.tasks.find((t) => t.id === "t2");
    assert.ok(img.output && /key/i.test(img.output) || img.status === "failed", JSON.stringify({ s: img.status, o: img.output, e: img.error }));
    if (img.status !== "failed") assert.match(img.output, /No image was made|could not make|Add your .* key/i);
    // exactly one new item, and it holds the caption and the five hashtags
    const lib = (await s.api("/mindmedia")).json;
    assert.equal((lib.total || 0) - before, 1, "one post item, not an image plus a text item: " + JSON.stringify((lib.items || []).map((i) => [i.name, i.kind, i.status, !!i.post, i.source])));
    const posts = (lib.items || []).filter((i) => i.post);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].status, "Draft");
    assert.equal(posts[0].post.hashtags.length, 5);
    assert.match(posts[0].post.caption, /Book a free 10-minute call/);
    assert.doesNotMatch(posts[0].post.caption, /Word count|search results|\u{1F3AC}/u);
    assert.equal(posts[0].post.imageMissing, true, "no real picture was made without a key, and the post says so");
    // nothing went to an agent job
    const gb = (await s.api("/grokbot/jobs")).json;
    assert.ok(!Array.isArray(gb) || gb.length === 0, "no Grok Bot job was made for a local save");
  } finally { await s.stop(); await m.close(); }
});

test("Stop ends a running mission cleanly and the server keeps answering", { timeout: 200000 }, async () => {
  const m = await mocks(({ sys, title }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return PLAN([{ id: "t1", title: "Write the caption", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write it.", deliverable: "caption" }]);
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
    return { text: "A slow answer.", delay: 12000 };
  });
  const s = await boot(m);
  try {
    const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
    assert.equal((await s.api("/mission", { method: "POST", body: { goal: "Write one caption for Everborn.", qa: false } })).status, 202);
    let id = null; const t0 = Date.now();
    while (!id && Date.now() - t0 < waitBudget(30000)) { id = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id))?.id; if (!id) await sleep(200); }
    assert.ok(id, "the mission started");
    await sleep(2500);
    const stop = await s.api(`/mission/${id}/abort`, { method: "POST", body: {} });
    assert.equal(stop.status, 200); assert.equal(stop.json.aborted, true);
    let run = null; const t1 = Date.now();
    while (Date.now() - t1 < waitBudget(30000)) { run = (await s.api(`/missions/${id}`)).json; if (run?.status === "aborted") break; await sleep(300); }
    assert.equal(run.status, "aborted", `${run.status} ${run.error}`);
    // still alive well after the Stop (the real app closed about 5 s later)
    await sleep(6000);
    const st = await s.api("/state");
    assert.equal(st.status, 200);
    assert.doesNotMatch(s.log, /unhandled|uncaught/i, s.log.slice(-500));
  } finally { await s.stop(); await m.close(); }
});

test("source: a stopped or errored run keeps its rating rows and an unfinished note; the save step is not rated as an AI", () => {
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
  const rat = read("web", "features", "ratings.js") + read("web", "features", "ratings-rows.js"); // 0.4.21 P: row rules moved to ratings-rows.js
  assert.match(rat, /rt-unfinished/);
  assert.match(rat, /Stopped before it finished\./);
  assert.match(rat, /if \(!t || t\.save\) continue;/);
  const app = read("web", "app.js").replace(/\r\n/g, "\n");
  assert.match(app, /a stopped or errored run keeps its rating rows/);
  const lo = read("web", "live-ops.js");
  assert.match(lo, /l\.kind === "mission" && \(l\.status === "aborted" \|\| l\.status === "failed"\)/);
});
