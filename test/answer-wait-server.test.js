// Backup when API credits run out, on the running server with the demo AIs. Sage (demo) answers like an API
// out of credits (HTTP 402). A council seat, a single chat and a side-by-side column wait instead of failing,
// and fill in place when the answer comes back (the Meldmind MCP tool submit_answer, or Paste reply).
// No real key, no network, no data/ folder. Helper-process test: run it on its own on Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, waitBudget, ROOT, tmpDir } from "./helpers.js";

const { McpClient } = await import("../server/mcp-client.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EM = String.fromCharCode(0x2014);
async function until(fn, ms = waitBudget(60000)) {
  const t0 = Date.now();
  // a dropped poll (this PC's ECONNRESET noise) is retried on the next tick
  while (Date.now() - t0 < ms) { let v = null; try { v = await fn(); } catch {} if (v) return v; await sleep(250); }
  return null;
}

test("a council with one out-of-credit member shows it waiting and fills it after submit_answer; single chat and side by side too", { timeout: waitBudget(240000) }, async () => {
  const home = tmpDir("cc-aw-home-");
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_DEMO_NO_CREDITS: "sage-mini", CC_SUBCLI_HOME: home, CC_SUBCLI_NO_PATH: "1", CC_AGY_BIN: path.join(home, "no-agy") } });
  const client = McpClient.for(
    { transport: "stdio", command: process.execPath, args: [path.join(ROOT, "server", "mcp-demo-server.js")] },
    { env: { MELDMIND_PORT: String(s.port), MELDMIND_TOKEN_FILE: path.join(s.dir, "bridge.token") } },
  );
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const view = (await s.api("/answerwait")).json;
    assert.equal(view.on, true, "the switch is on by default");
    assert.equal(view.chainLine, "1. Official apps on this PC, 2. Website (if you turned it on), 3. You copy it over");

    // ---- the council ----
    const members = [{ provider: "demo-nova", model: "nova-ultra" }, { provider: "demo-atlas", model: "atlas-pro" }, { provider: "demo-sage", model: "sage-mini" }];
    const before = new Set(((await s.api("/state")).json.missions || []).map((m) => m.id));
    const posted = await s.api("/council", { method: "POST", body: { prompt: "Name a bakery in three words.", members, chair: members[0], qa: true } });
    assert.equal(posted.status, 202, posted.text);
    const sum = await until(async () => ((await s.api("/state")).json.missions || []).find((m) => m.kind === "council" && !before.has(m.id) && m.status === "done"));
    assert.ok(sum, "the council finished with the other two members");
    let c = (await s.api(`/missions/${sum.id}`)).json;
    const seat = c.answers["sage-mini"];
    assert.ok(seat.waiting?.jobId, `sage's seat is waiting, not failed: ${JSON.stringify(seat)}`);
    assert.equal(seat.error, undefined);
    assert.equal(seat.waiting.headline, `Out of API credits. Answering through your ${seat.waiting.ai} subscription. Step 3 of 3.`);
    assert.ok(c.answers["nova-ultra"].text && c.answers["atlas-pro"].text);
    const jobId = seat.waiting.jobId;
    await until(async () => (await s.api("/answerwait")).json.jobs.find((j) => j.id === jobId && j.step === "copy"));

    // Continue in: the full prompt with the send-back block; nothing is sent from here
    const cont = (await s.api(`/answerwait/${jobId}`)).json;
    assert.match(cont.prompt, /Name a bakery in three words\./);
    assert.match(cont.prompt, /submit_answer/);
    assert.ok(cont.prompt.includes(`MELDMIND ANSWER ${jobId}`));
    assert.ok(!cont.prompt.includes(EM));

    // the bridge routes need the bridge token, the same as submit_job (Show agent setup makes it)
    assert.equal((await s.api("/services/agent-setup", { method: "POST", body: {} })).status, 200);
    const token = fs.readFileSync(path.join(s.dir, "bridge.token"), "utf8").trim();
    assert.equal((await s.api("/bridge/waiting", { noToken: true })).status, 401);
    assert.equal((await s.api("/bridge/answers", { method: "POST", noToken: true, body: { job_id: jobId, answer: "x" } })).status, 401);
    assert.equal((await s.api("/bridge/answers", { method: "POST", noToken: true, headers: { "x-meldmind-bridge": "wrong".padEnd(token.length, "x") }, body: { job_id: jobId, answer: "x" } })).status, 401);
    const bridged = (await s.api("/bridge/waiting", { noToken: true, headers: { "x-meldmind-bridge": token } })).json;
    assert.ok(bridged.jobs.some((j) => j.id === jobId && /Name a bakery/.test(j.prompt)));
    assert.equal((await s.api("/bridge/answers", { method: "POST", noToken: true, headers: { "x-meldmind-bridge": token }, body: { job_id: "ans-doesnotexist1", answer: "x" } })).status, 404);
    assert.equal((await s.api("/bridge/answers", { method: "POST", noToken: true, headers: { "x-meldmind-bridge": token }, body: { job_id: "bad id", answer: "x" } })).status, 400);

    // the real MCP tools, the way Claude Code or Antigravity calls them
    await client.connect();
    const names = (await client.listTools()).map((t) => t.name);
    assert.ok(names.includes("list_waiting") && names.includes("submit_answer"));
    const listed = await client.callTool("list_waiting", {});
    assert.equal(listed.isError, false, listed.text);
    assert.ok(listed.text.includes(jobId));
    assert.equal((await client.callTool("submit_answer", { job_id: jobId, answer: "" })).isError, true);
    const sent = await client.callTool("submit_answer", { job_id: jobId, answer: "Golden Crust Corner" });
    assert.equal(sent.isError, false, sent.text);
    assert.equal((await client.callTool("submit_answer", { job_id: jobId, answer: "again" })).isError, true, "a finished job takes no second answer");

    c = await until(async () => { const x = (await s.api(`/missions/${sum.id}`)).json; return x.answers["sage-mini"].text && x.verdict?.merged ? x : null; });
    assert.ok(c, "the seat filled and the chair wrote the verdict again with every answer");
    assert.equal(c.answers["sage-mini"].text, "Golden Crust Corner");
    assert.match(c.answers["sage-mini"].viaSubscription.tag, /^via .+ subscription$/);
    assert.ok(!c.answers["sage-mini"].waiting);
    assert.ok(!s.log.includes("Golden Crust Corner"), "the answer text is never logged");
    assert.match(s.log, new RegExp(`answer-wait ${jobId} answered-mcp`));

    // ---- a single chat ----
    // Nova and Atlas would stand in for Sage here (smart fallback first). With stand-ins off, Sage has no API
    // route left, which is the case this backup is for.
    assert.equal((await s.api("/fallback/settings", { method: "POST", body: { on: false } })).status, 200);
    const chat = await s.api("/chat", { method: "POST", body: { prompt: "Say hello to the bakery.", provider: "demo-sage", model: "sage-mini" } });
    assert.equal(chat.status, 202);
    const runId = chat.json.runId;
    let m = await until(async () => { const x = (await s.api(`/missions/${runId}`)).json; return x?.status === "waiting" && x.waiting?.jobId ? x : null; });
    assert.ok(m, "the chat waits instead of failing");
    assert.equal(m.error, undefined);
    const chatJob = m.waiting.jobId;
    assert.equal((await s.api(`/answerwait/${chatJob}/answer`, { method: "POST", body: { text: "Hi bakery" } })).status, 400, "Paste reply needs the Save click");
    const clip = await s.api(`/answerwait/${chatJob}/answer`, { method: "POST", body: { route: "clipboard", text: `copied page text\nMELDMIND ANSWER ${chatJob}\nHello, bakery!\nEND MELDMIND ANSWER\nmore page text` } });
    assert.equal(clip.status, 200, clip.text);
    m = await until(async () => { const x = (await s.api(`/missions/${runId}`)).json; return x?.status === "done" ? x : null; });
    assert.ok(m.deliverable.endsWith("Hello, bakery!"), m.deliverable);
    assert.match(m.deliverable, /^\*\*via .+ subscription\*\*/);
    assert.ok(!m.deliverable.includes("page text"), "only the block is kept");

    // ---- side by side: the column keeps its own AI and waits ----
    const cmp = await s.api("/compare", { method: "POST", body: { prompt: "One word for fresh bread?", columns: [{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-sage", model: "sage-mini" }] } });
    assert.equal(cmp.status, 202, cmp.text);
    const xid = cmp.json.id || cmp.json.run?.id;
    let run = await until(async () => { const x = (await s.api(`/compare/${xid}`)).json; const col = x?.columns?.find((k) => k.model === "sage-mini"); return x?.status !== "running" && col?.status === "waiting" ? x : null; });
    assert.ok(run, "the sage column waits");
    const colJob = run.columns.find((k) => k.model === "sage-mini").waiting.jobId;
    const pasted = await s.api(`/answerwait/${colJob}/answer`, { method: "POST", body: { text: "Crusty", confirm: true } });
    assert.equal(pasted.status, 200, pasted.text);
    run = await until(async () => { const x = (await s.api(`/compare/${xid}`)).json; return x.columns.find((k) => k.model === "sage-mini").status === "done" ? x : null; });
    const col = run.columns.find((k) => k.model === "sage-mini");
    assert.equal(col.text, "Crusty"); assert.match(col.note, /^via .+ subscription$/);

    // ---- the switch off: exactly as before, the slot fails ----
    await s.api("/answerwait/settings", { method: "POST", body: { on: false } });
    const off = await s.api("/chat", { method: "POST", body: { prompt: "Say bye.", provider: "demo-sage", model: "sage-mini" } });
    m = await until(async () => { const x = (await s.api(`/missions/${off.json.runId}`)).json; return x && ["failed", "done", "waiting"].includes(x.status) ? x : null; });
    assert.equal(m.status, "failed"); assert.equal(m.waiting, undefined);
  } catch (e) {
    console.error(`server log tail:\n${s.log.slice(-6000)}`);
    throw e;
  } finally {
    try { await client.close(); } catch {}
    await s.stop();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  }
});
