// 0.4.21 dogfood 14: never print "File saved: <path>" unless Meldmind itself wrote the file and it exists on disk.
// The Everborn "Book a listing video" page came back as full HTML with an AI-written "File saved" line and no file.
// Local mock AIs and temp folders only: no real key, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, waitBudget } from "./helpers.js";
import { claimCheck, stripSaveClaims } from "../server/step-guard.js";

const KEYS = { xai: "xai-fakefakefakefakefake", groq: "gsk_fakefakefakefakefake", mistral: "fakemistralkeyfakemistralkey0000" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fs0421q-")));
const rm = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } };
const PAGE = "pages/book-a-listing-video.html";
const HTML = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Book a listing video</title></head>\n<body>\n<h1>Book a listing video</h1>\n<p>Everborn Productions films your listing in one visit.</p>\n<form><label>Address <input name="address"></label><button>Book</button></form>\n</body>\n</html>\n`;
const CLAIM = `File saved: ${PAGE}`;
const GOAL = `Build the Everborn "Book a listing video" page as one HTML file and save it as ${PAGE}.`;
const PLAN = JSON.stringify({ title: "Book a listing video page", assembly: "Hand over the page.", tasks: [
  { id: "t1", title: "Build the booking page", capability: "code", difficulty: 2, needWeb: false, deps: [], instructions: `Write the whole page as one HTML file saved as ${PAGE}.`, deliverable: `The complete ${PAGE}` },
] });

async function mocks(stepText) {
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(j)); };
    if (/\/models$/.test(url.pathname)) return send(200, { data: [{ id: "mock" }] });
    if (!/\/chat\/completions$/.test(url.pathname)) return send(404, { error: "no route" });
    const j = JSON.parse(body);
    const sys = j.messages.find((m) => m.role === "system")?.content || "";
    let out;
    if (/Reply with JSON only: \{"capability"/.test(sys)) out = `{"capability":"code","difficulty":2,"needWeb":false,"summary":"mock"}`;
    else if (/Break the goal into/.test(sys)) out = PLAN;
    else if (/You QA another AI/.test(sys)) out = `{"pass":true,"score":9,"issues":[]}`; // a lenient reviewer: the app's own checks must still hold
    else if (/You assemble/.test(sys)) out = `${CLAIM}\n\n${stepText}`;
    else out = stepText;
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: out } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 40 } })}\n\n`);
    res.write("data: [DONE]\n\n"); res.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}
async function boot(m) {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_QA_TIMEOUT_MS: "1500", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BASE_URL_GROQ: `${m.base}/groq/v1`, CC_BASE_URL_MISTRAL: `${m.base}/mistral/v1`, XAI_API_KEY: "", GROQ_API_KEY: "", MISTRAL_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", DEEPSEEK_API_KEY: "", PERPLEXITY_API_KEY: "" } });
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
async function projectWith(s, dir) {
  const r = await s.api("/projects", { method: "POST", body: { name: "Everborn pages", categories: [{ id: "files", name: "Files", links: [{ title: "Folder", url: dir }] }] } });
  assert.equal(r.status, 200, r.text);
  return r.json.id;
}
const visibleText = (run) => [run.deliverable, ...(run.tasks || []).map((t) => t.output)].filter(Boolean).join("\n");

test("1. html block plus the AI's own 'File saved' line: the app writes the page, shows its own Wrote line, and the AI's line is gone", { timeout: 300000 }, async () => {
  const m = await mocks(`${CLAIM}\n\n\`\`\`html\n${HTML}\`\`\``);
  const s = await boot(m);
  const dir = tmp();
  try {
    const projectId = await projectWith(s, dir);
    const run = await runMission(s, { goal: GOAL, projectId, mode: "economy", qa: true, budgetUsd: 2 });
    const file = path.join(dir, PAGE);
    assert.ok(fs.existsSync(file), `the page is really on disk: ${JSON.stringify(run.savedFile)}`);
    assert.equal(fs.readFileSync(file, "utf8").trim(), HTML.trim());
    const text = visibleText(run);
    assert.doesNotMatch(text, /File saved:/, "the AI's own claim is stripped");
    assert.match(text, /Wrote [\w/.-]*book-a-listing-video\.html \(\d+ bytes\)/, "the app's own line");
    const claims = text.match(/\b(?:Wrote|Saved)\b[^\n]*book-a-listing-video\.html/g) || [];
    assert.ok(claims.length >= 1, text);
    assert.equal(new Set(claims.map((c) => c.replace(/^\W+/, ""))).size, 1, `one kind of saved claim: ${claims.join(" | ")}`);
    assert.equal(run.savedFile?.ok, true, JSON.stringify(run.savedFile));
  } finally { await s.stop(); await m.close(); rm(dir); }
});

test("2. same page with no project folder: filed under Unfiled with a real path (or 'Not saved'), and no AI 'File saved' line anywhere", { timeout: 300000 }, async () => {
  const m = await mocks(`${CLAIM}\n\n\`\`\`html\n${HTML}\`\`\``);
  const s = await boot(m);
  try {
    const run = await runMission(s, { goal: GOAL, mode: "economy", qa: true, budgetUsd: 2 });
    const text = visibleText(run);
    assert.doesNotMatch(text, /File saved:/);
    // with no project folder the app files the page under Unfiled. Either way the claim is backed by the disk:
    // a real file at the reported path, or a plain "Not saved" and a run that is not a green done.
    if (run.savedFile?.ok === true) {
      assert.ok(run.savedFile.path && fs.existsSync(run.savedFile.path), `the reported path is really on disk: ${JSON.stringify(run.savedFile)}`);
      assert.equal(fs.readFileSync(run.savedFile.path, "utf8").trim(), HTML.trim());
      assert.match(JSON.stringify(run.savedFile), /Unfiled/, "it says where the page went");
    } else {
      assert.match(`${text}\n${run.savedFile?.error || ""}\n${run.planNote || ""}`, /Not saved/);
      assert.notEqual(run.status, "done", "the run is not a plain green done");
    }
  } finally { await s.stop(); await m.close(); }
});

test("3. a plain-text 'File saved' claim with no code block is stripped or fails QA", () => {
  const out = `I built the page.\n${CLAIM}\nIt has a booking form.`;
  const stripped = stripSaveClaims(out);
  const check = claimCheck(out, []);
  const removed = !/File saved:/.test(stripped);
  const failed = check && check.ok === false;
  assert.ok(removed || failed, `stripped: ${JSON.stringify(stripped)} check: ${JSON.stringify(check)}`);
  assert.match(stripped, /It has a booking form\./, "the rest of the answer stays");
});

test("4. 'test output: all passed' with no tool record fails QA", () => {
  const check = claimCheck("Test output: all tests passed.", []);
  assert.equal(check.ok, false, JSON.stringify(check));
  assert.equal(check.kind, "run");
  assert.equal(check.reason, "Shows test output, but no tests were run.");
});
