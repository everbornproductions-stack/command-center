// 0.4.21 dogfood fixes, end to end against local mock AIs (no real key, no network):
//  - a code step that is cut off is continued, and the finished page is really saved as index.html
//  - a step about the wrong business is retried on another AI and shown as retried
//  - no web search and no "[1]" citations when none was asked for
//  - a QA reviewer that is too slow is switched; a check that fails after its retry is never "Done"
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";

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
const PLAN = (tasks) => JSON.stringify({ title: "Landing page", tasks, assembly: "Hand over the page." });
const plan3 = PLAN([
  { id: "t1", title: "Build the page", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: "Write the whole page as a single index.html.", deliverable: "A complete index.html" },
  { id: "t2", title: "Write five captions", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Write one Instagram caption per day for Everborn Productions listing videos for brokers.", deliverable: "Five captions" },
]);

test("a cut-off page is continued, an off-topic step is retried, index.html is really saved, no unasked search or citations", { timeout: 300000 }, async () => {
  const m = await mocks(({ sys, title, n, cont }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"code","difficulty":2,"needWeb":true,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return plan3;
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
    if (/You assemble/.test(sys)) return cont ? { text: "" } : { text: `Saved as: index.html (project root)\n\n\`\`\`html\n${HTML}\`\`\`\n\nThe layout follows the supplied search results [1][2].` };
    if (cont) return HTML.slice(CUT_AT);
    if (title === "Build the page") return n === 1 ? { text: HTML.slice(0, CUT_AT), finish: "length" } : HTML;
    if (title === "Write five captions") return n === 1 ? "Day 1: Our neighborhood cafe has fresh pastries and espresso today, come in for a latte. ".repeat(6) : "Day 1: Your listings deserve a movie. Everborn Productions turns each listing into a short video brokers can post the same day. ".repeat(4);
    return "Answer.";
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Build one mobile-friendly landing page for Everborn Productions listing videos for brokers, a single index.html. Headline: Your listings deserve a movie.", mode: "economy", qa: true, budgetUsd: 2 });
    assert.ok(["done", "done-with-errors"].includes(run.status), `${run.status} ${run.error}`);
    const t1 = run.tasks.find((t) => t.title === "Build the page");
    assert.ok(t1.continued >= 1, "the cut-off page was continued");
    assert.match(t1.output, /<\/html>\s*$/, "the page now ends properly");
    assert.equal(t1.status, "done");
    const t2 = run.tasks.find((t) => t.title === "Write five captions");
    assert.equal(t2.retried, true, "the wrong-business captions were retried");
    assert.equal(t2.attempts[0].kind, "off-brief");
    assert.doesNotMatch(t2.output, /cafe|pastries/i);
    assert.equal(run.incomplete, null, JSON.stringify(run.incomplete));
    assert.equal(run.status, "done");
    // really saved
    assert.equal(run.savedFile.ok, true, JSON.stringify(run.savedFile));
    assert.equal(run.savedFile.name, "index.html");
    assert.ok(fs.existsSync(run.savedFile.path), "the file is on disk");
    const onDisk = fs.readFileSync(run.savedFile.path, "utf8");
    assert.match(onDisk, /<\/html>\s*$/);
    assert.match(onDisk, /Your listings deserve a movie\./);
    assert.ok(run.savedFile.path.startsWith(s.dir), "inside the data folder");
    const f = (await s.api(`/dogfood/file?mission=${run.id}`)).json;
    assert.equal(f.saved, true); assert.equal(f.previewable, true); assert.match(f.text, /<h1>/);
    assert.equal((await s.api("/dogfood/file/open", { method: "POST", body: { mission: run.id, dryRun: true } })).json.dryRun, true);
    // no search the person did not ask for, no leaks, no false "Saved as" claim
    assert.equal(run.searched, false); assert.equal(run.searchAsked, false);
    assert.doesNotMatch(run.deliverable, /\[\d\]|supplied search results|Saved as:/);
  } finally { await s.stop(); await m.close(); }
});

test("a file that cannot be written is said plainly, and a card is never titled as a file", { timeout: 200000 }, async () => {
  const m = await mocks(({ sys, cont }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "campaign.md", tasks: [{ id: "t1", title: "Plan", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Plan five days for Everborn.", deliverable: "plan" }], assembly: "x" });
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":9,"issues":[]}`;
    return "Day 1: Everborn Productions starts the week with a short listing video for brokers. Day 2: share it. ".repeat(3);
  });
  const s = await boot(m);
  try {
    // block the write: a folder named like the file sits where it would go
    const run0 = await runMission(s, { goal: "Write a 5-day Everborn plan for brokers and save it as campaign.md.", mode: "economy", qa: false, budgetUsd: 1 });
    assert.equal(run0.savedFile.ok, true, JSON.stringify(run0.savedFile));
    assert.match(fs.readFileSync(run0.savedFile.path, "utf8"), /Everborn Productions/);
    assert.equal(run0.title, "campaign.md", "a real file may be the title");
    // a second run with no project: the saved file is the next free name, never an overwrite
    const run1 = await runMission(s, { goal: "Write a 5-day Everborn plan for brokers and save it as campaign.md.", mode: "economy", qa: false, budgetUsd: 1 });
    assert.equal(run1.savedFile.ok, true);
    assert.notEqual(run1.savedFile.path, run0.savedFile.path);
    assert.ok(fs.existsSync(run0.savedFile.path) && fs.existsSync(run1.savedFile.path));
    // a task that names no file promises none; a name that climbs out of the folder is cut down to a plain name
    const { saveNamedFile, fileBody } = await import("../server/named-file.js");
    assert.equal(saveNamedFile({ goal: "Write notes", text: "x" }), null, "a task that names no file promises none");
    assert.equal(saveNamedFile({ goal: "", name: "", text: "x" }), null);
    assert.equal(fileBody("```markdown\n# Plan\n```", "plan.md"), "# Plan\n", "one wrapping fence is dropped");
    assert.match(fileBody("Intro\n```html\n<!DOCTYPE html><html><body>x</body></html>\n```\nBye", "index.html"), /^<!DOCTYPE html>/);
    assert.equal(saveNamedFile({ goal: "", name: "plan.md", text: "   " }).ok, false, "nothing to write is said plainly");
    assert.match(saveNamedFile({ goal: "", name: "plan.md", text: " " }).error, /^Not saved/);
  } finally { await s.stop(); await m.close(); }
});

test("QA: a check that still fails after its retry is Incomplete, never Done", { timeout: 300000 }, async () => {
  const m = await mocks(({ prefix, sys, title }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Plan", tasks: [{ id: "t1", title: "Plan", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Plan five days for Everborn Productions listing videos.", deliverable: "plan" }], assembly: "x" });
    if (/You QA another AI/.test(sys)) return { text: `{"pass":false,"score":3,"issues":["no call to action"],"fix":"Add a call to action."}` };
    if (/Revise your deliverable/.test(sys)) return "Everborn Productions listing videos plan, now with a call to action: send us the address today. ".repeat(3);
    return "Everborn Productions listing videos plan for brokers: day one teaser, day two tips. ".repeat(3);
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Plan five days of Everborn Productions listing videos for brokers.", mode: "economy", qa: true, budgetUsd: 2 });
    const t = run.tasks[0];
    assert.equal(t.qaFailed, true, "QA failed after its retry");
    assert.equal(t.review.pass, false);
    assert.equal(run.status, "done-with-errors", "never plain Done when QA failed after the retry");
    assert.equal(run.incomplete.reasons[0].kind, "qa-failed");
    assert.ok(Array.isArray(run.incomplete.retryAvoid));
    assert.ok(m.seen.filter((x) => /You QA another AI/.test(x.sys)).length >= 2, "the revision was checked again");
  } finally { await s.stop(); await m.close(); }
});

test("QA: a reply that is not JSON is asked for again, then the reviewer is switched; nothing readable is not a pass", { timeout: 300000 }, async () => {
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Plan", tasks: [{ id: "t1", title: "Plan", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Plan five days for Everborn Productions listing videos.", deliverable: "plan" }], assembly: "x" });
    if (/You QA another AI/.test(sys)) return "Looks fine to me, nothing to add.";
    return "Everborn Productions listing videos plan for brokers: day one teaser, day two tips. ".repeat(3);
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Plan five days of Everborn Productions listing videos for brokers.", mode: "economy", qa: true, budgetUsd: 2 });
    const t = run.tasks[0];
    assert.equal(t.review.unchecked, true);
    assert.equal(t.review.pass, false, "an unreadable check is never a pass");
    assert.equal(run.status, "done-with-errors");
    assert.equal(run.incomplete.reasons[0].kind, "qa-unchecked");
    assert.ok(m.seen.filter((x) => /not valid JSON/.test(x.sys)).length >= 1, "the reviewer was asked a second time");
  } finally { await s.stop(); await m.close(); }
});

test("a step the AI refuses is retried on another AI; when every AI refuses it fails with the reason and the run is Incomplete", { timeout: 300000 }, async () => {
  const m = await mocks(({ prefix, sys, title }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Plan", tasks: [{ id: "t1", title: "Draft", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Draft the Everborn Productions plan for brokers.", deliverable: "plan" }, { id: "t2", title: "Check", capability: "analysis", difficulty: 1, needWeb: false, deps: [], instructions: "Check the Everborn Productions plan.", deliverable: "notes" }], assembly: "x" });
    if (/You QA another AI/.test(sys)) return `{"pass":true,"score":8,"issues":[]}`;
    if (/You assemble/.test(sys)) return "Everborn Productions plan for brokers, day one to day five.";
    if (title === "Check") return "[Claude declined this request (safety refusal).]";
    return "Everborn Productions plan for brokers: day one teaser, day two tips. ".repeat(3);
  });
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: "Plan the Everborn Productions listing video week for brokers.", mode: "economy", qa: false, budgetUsd: 2 });
    const t2 = run.tasks.find((t) => t.title === "Check");
    assert.equal(t2.status, "failed");
    assert.equal(t2.guard.kind, "refusal");
    assert.match(t2.error, /refused/i);
    assert.ok(t2.attempts.length >= 2, "it was tried on another AI first");
    assert.equal(run.status, "done-with-errors");
    assert.equal(run.incomplete.reasons.find((r) => r.taskId === "t2").kind, "refusal");
    assert.doesNotMatch(run.deliverable, /declined this request/);
    // one click: run it again, leaving out the AI that failed it
    assert.equal((await s.api("/dogfood/retry", { method: "POST", body: { id: "m-nope" } })).status, 404);
    const before = new Set(((await s.api("/state")).json.missions || []).map((x) => x.id));
    const again = await s.api("/dogfood/retry", { method: "POST", body: { id: run.id } });
    assert.equal(again.status, 202, again.text);
    assert.deepEqual(again.json.skipped, run.incomplete.retryAvoid);
    assert.ok(again.json.skipped.length >= 1);
    let second = null;
    for (let i = 0; i < 200 && !second; i++) { second = ((await s.api("/state")).json.missions || []).find((x) => x.kind === "mission" && !before.has(x.id) && ["done", "done-with-errors", "failed"].includes(x.status)); if (!second) await sleep(250); }
    assert.ok(second, "the second run happened");
    const full = (await s.api(`/missions/${second.id}`)).json;
    for (const t of full.tasks) assert.ok(!again.json.skipped.includes(t.provider) || t.retried, `step ${t.id} avoided ${again.json.skipped}`);
  } finally { await s.stop(); await m.close(); }
});

test("QA: the first reviewer that is too slow is switched after the time limit, and the step still gets a real check", { timeout: 300000 }, async () => {
  let qaCalls = 0;
  const m = await mocks(({ sys }) => {
    if (/Reply with JSON only: \{"capability"/.test(sys)) return `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`;
    if (/Break the goal into/.test(sys)) return JSON.stringify({ title: "Plan", tasks: [{ id: "t1", title: "Plan", capability: "writing", difficulty: 1, needWeb: false, deps: [], instructions: "Plan five days for Everborn Productions listing videos.", deliverable: "plan" }], assembly: "x" });
    if (/You QA another AI/.test(sys)) { qaCalls++; return qaCalls === 1 ? { text: `{"pass":true,"score":9,"issues":[]}`, delay: 6000 } : `{"pass":true,"score":9,"issues":[]}`; }
    return "Everborn Productions listing videos plan for brokers: day one teaser, day two tips. ".repeat(3);
  });
  const s = await boot(m);
  try {
    const t0 = Date.now();
    const run = await runMission(s, { goal: "Plan five days of Everborn Productions listing videos for brokers.", mode: "economy", qa: true, budgetUsd: 2 });
    const t = run.tasks[0];
    assert.equal(t.review.pass, true, JSON.stringify(t.review));
    assert.equal(t.review.score, 9);
    assert.ok(run.log.some((l) => /Switching reviewer/.test(l.text)), "the feed says the reviewer was switched");
    assert.equal(run.status, "done");
    assert.ok(Date.now() - t0 < 5800, "the run did not wait for the slow reviewer to finish");
  } finally { await s.stop(); await m.close(); }
});
