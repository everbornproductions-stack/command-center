// 0.4.39 (Chris, 2026-11-02: "if someone selects an agent what happens? In the agent area shouldn't there be a way to see
// what agent is doing what for them and handling things they have assigned?"). The Agents page is the Team page and each
// agent has a desk. Pure checks of the task store, then the running server in a temp data dir with the demo AIs (local
// mock, no real key or URL): assign makes a run tagged with the agent and a task, finishing moves it to Ready for your
// OK or Done, approve / ask for changes / dismiss, a duty makes a schedule that runs the agent, nothing is sent, and no
// secret is kept in a task. Then the page in a real browser at 1366 x 800 and 390 x 844, light and dark.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { findBrowser } from "./pw-helpers.js";
import { bootMac } from "./mac-helpers.js";
import { wouldSend, dutyCron, titleFrom, countsFor, agentStatus } from "../server/agent-tasks.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");
const EM = String.fromCharCode(0x2014);
const SHOTS = path.resolve(ROOT, "..", "meldmind-dogfood");
const skipUi = findBrowser() ? false : "no Chrome installed";

async function waitTask(api, id, pred, ms = 90000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const r = await api(`/team/tasks/${id}`);
    last = r.json?.task;
    if (r.status === 200 && pred(last)) return r.json;
    await sleep(250);
  }
  throw new Error(`task ${id} never matched; last status ${last?.status} ${last?.error || ""}`);
}
const settled = (t) => ["review", "done", "failed"].includes(t?.status);

test("tasks: plain words, would-send rule, duty times, counts", () => {
  assert.equal(wouldSend({ kinds: ["post"] }), true, "a post waits for the OK");
  assert.equal(wouldSend({ kinds: ["report"], text: "Sum up last month's receipts" }), false, "a report is just done");
  assert.equal(wouldSend({ kinds: [], text: "Reply to the 3 new Google reviews" }), true, "a reply would be sent");
  assert.equal(dutyCron({ every: "day", time: "17:00" }), "0 17 * * *");
  assert.equal(dutyCron({ every: "week", day: 1, time: "08:30" }), "30 8 * * 1");
  assert.equal(dutyCron({ every: "month", day: 15, time: "09:00" }), "0 9 15 * *");
  assert.throws(() => dutyCron({ every: "week", day: 9, time: "09:00" }), /day of the week/);
  assert.throws(() => dutyCron({ every: "hour" }), /how often/);
  assert.equal(titleFrom("Write 5 posts for Valentine's week\nmore"), "Write 5 posts for Valentine's week");
  const c = countsFor([{ status: "working" }, { status: "review" }, { status: "review" }, { status: "done", finishedAt: Date.now() }, { status: "done", finishedAt: Date.now() - 3 * 86400000 }]);
  assert.deepEqual(c, { working: 1, review: 2, waiting: 0, failed: 0, doneToday: 1 });
  assert.deepEqual(agentStatus(c), { status: "review", label: "2 need OK" });
  assert.deepEqual(agentStatus({ working: 1 }), { status: "working", label: "Working" });
  assert.deepEqual(agentStatus({ doneToday: 2 }), { status: "done", label: "Done" });
  assert.deepEqual(agentStatus({}), { status: "free", label: "Free" });
});

test("source: Team page in its own files, nav says Team, Simple reaches it, Give to an agent, no em-dashes", () => {
  const team = read("web", "features", "team.js");
  for (const w of ["Your team", "need your OK", "done today", "Chat with it", "+ Give a task", "Assign", "Assigned to", "Done lately", "Duties", "How it works for you", "Ready for your OK", "Waiting to start", "Try again", "Watch", "Review", "Approve and copy", "Ask for changes", "Dismiss", "Give to an agent", "Hire an agent", "My agents", "Prompts"]) assert.ok(team.includes(w), w);
  for (const f of [["web", "features", "team.js"], ["web", "team.css"], ["server", "agent-tasks.js"], ["server", "team-runs.js"], ["server", "plugins", "team.js"], ["server", "team-chat.js"]]) assert.equal(read(...f).includes(EM), false, f.join("/"));
  assert.match(read("web", "nav.js"), /agents: "Team"/);
  assert.match(read("web", "features", "agents.js"), /tab: \{ label: "Team"/);
  assert.match(read("web", "mode.js"), /"community", "agents",/);
  assert.match(read("web", "features", "layout.js"), /data-menu-act="team">Team<\/button>/);
  assert.match(read("web", "app.js"), /data-sc-give data-turn/);
  assert.match(read("web", "features", "walkthrough.js"), /data-sp-assign/);
});

test("server: assign, run tagged with the agent, review, approve, changes, dismiss, duty, nothing sent, no secrets", { timeout: 300000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_TEAM_TICK_MS: "500" } });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const team = (await s.api("/team")).json;
    const ids = team.agents.map((a) => a.id);
    assert.ok(ids.includes("emp-social-content"), "employees on the team");
    assert.ok(ids.includes("grokbot") && ids.includes("browser-helper"), "the outside agents Meldmind knows");
    assert.ok(team.agents.every((a) => ["free", "working", "review", "done"].includes(a.status)));
    assert.deepEqual(Object.keys(team.counts).sort(), ["doneToday", "failed", "review", "waiting", "working"]);
    assert.equal(team.neverSends, "Never posts or sends: everything waits for your OK");

    // assign: a normal run, tagged with the agent, and a task that goes Working then Ready for your OK
    const a1 = await s.api("/team/assign", { method: "POST", body: { agentId: "emp-social-content", text: "Write 3 posts for Valentine's week for my bakery" } });
    assert.equal(a1.status, 202, JSON.stringify(a1.json));
    const t1 = a1.json.task;
    assert.equal(t1.agentId, "emp-social-content");
    assert.equal(t1.agentName, "Social media writer");
    assert.match(t1.runId, /^s-/);
    assert.ok(["working", "review"].includes(t1.status), t1.status);
    for (const k of ["id", "agentId", "title", "text", "status", "runId", "createdAt", "updatedAt", "approvedAt", "outcome"]) assert.ok(k in t1, k);
    const r1 = await waitTask(s.api, t1.id, settled);
    assert.equal(r1.task.status, "review", r1.task.error || "posts wait for the OK");
    assert.ok(r1.result.length > 20, "the result is there to review");
    const run1 = (await s.api(`/missions/${t1.runId}`)).json;
    assert.equal(run1.customAgent?.id, "emp-social-content", "the run is tagged with the agent");
    assert.deepEqual(run1.toolCalls, [], "no tool was called: nothing sent");

    // a report is just Done
    const a2 = await s.api("/team/assign", { method: "POST", body: { agentId: "emp-bookkeeper", text: "Sum up last month's receipts by category" } });
    assert.equal(a2.status, 202, JSON.stringify(a2.json));
    const r2 = await waitTask(s.api, a2.json.task.id, settled);
    assert.equal(r2.task.status, "done", r2.task.error);
    assert.equal(r2.task.outcome, "done");

    // approve: save to MindMedia (never send); approve again is refused
    const ap = await s.api(`/team/tasks/${t1.id}/approve`, { method: "POST", body: { how: "saved" } });
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    assert.equal(ap.json.task.status, "done");
    assert.equal(ap.json.task.outcome, "saved");
    assert.ok(ap.json.task.approvedAt > 0);
    assert.match(ap.json.task.outcomeLabel, /saved to MindMedia/);
    assert.equal(ap.json.sent, undefined, "approve never sends");
    assert.equal((await s.api(`/team/tasks/${t1.id}/approve`, { method: "POST", body: { how: "copied" } })).status, 409, "approved once");
    const ok2 = await s.api(`/team/tasks/${r2.task.id}/approve`, { method: "POST", body: { how: "copied" } });
    assert.equal(ok2.json.task.outcome, "copied", "a Done task can still be approved and copied");

    // ask for changes: a follow-up run to the same agent on the same task
    const a3 = await s.api("/team/assign", { method: "POST", body: { agentId: "emp-review-responder", text: "Reply to a 5-star review from Maria about the cupcakes" } });
    const r3 = await waitTask(s.api, a3.json.task.id, settled);
    assert.equal(r3.task.status, "review");
    const ch = await s.api(`/team/tasks/${r3.task.id}/changes`, { method: "POST", body: { text: "Make it shorter" } });
    assert.equal(ch.status, 202, JSON.stringify(ch.json));
    assert.notEqual(ch.json.task.runId, r3.task.runId, "a new run");
    const r3b = await waitTask(s.api, r3.task.id, (t) => settled(t) && t.round === 2);
    assert.equal(r3b.task.status, "review");
    const run3 = (await s.api(`/missions/${r3b.task.runId}`)).json;
    assert.equal(run3.customAgent?.id, "emp-review-responder", "the same agent");
    assert.match(run3.prompt, /Please change it like this: Make it shorter/);
    const dis = await s.api(`/team/tasks/${r3.task.id}/dismiss`, { method: "POST", body: {} });
    assert.equal(dis.json.task.status, "dismissed");
    assert.equal(dis.json.task.outcomeLabel, "Dismissed");

    // waiting to start: edit, then cancel
    const later = Date.now() + 3 * 3600000;
    const w = await s.api("/team/assign", { method: "POST", body: { agentId: "emp-social-content", text: "Spring menu launch teaser", startAt: later } });
    assert.equal(w.json.task.status, "waiting");
    assert.equal(w.json.task.startAt, later);
    const ed = await s.api(`/team/tasks/${w.json.task.id}`, { method: "POST", body: { title: "Spring teaser", startAt: later + 60000 } });
    assert.equal(ed.json.task.title, "Spring teaser");
    const cn = await s.api(`/team/tasks/${w.json.task.id}/cancel`, { method: "POST", body: {} });
    assert.equal(cn.json.task.status, "dismissed");
    assert.equal(cn.json.task.outcome, "cancelled");
    // a task set for a minute ago is started by the timer
    const soon = await s.api("/team/assign", { method: "POST", body: { agentId: "emp-bookkeeper", text: "Total this week's receipts", startAt: Date.now() + 31000 } });
    assert.equal(soon.json.task.status, "waiting");
    const startedLater = await waitTask(s.api, soon.json.task.id, settled, 120000);
    assert.equal(startedLater.task.status, "done", startedLater.task.error);

    // Use on the Hire tab lands on the desk too
    const use = await s.api("/agents/employees/support-agent/run", { method: "POST", body: { prompt: "Answer a customer asking about opening hours" } });
    assert.equal(use.status, 202);
    const used = (await s.api("/team/tasks?agent=emp-support-agent")).json.items.find((t) => t.runId === use.json.runId);
    assert.ok(used, "the Use run is a task");
    assert.equal(used.source, "use");

    // a custom agent works the same way, and Chat with it picks it for a chat
    const mine = (await s.api("/agents", { method: "POST", body: { name: "Listing writer", instructions: "Write home listings.", noSend: true } })).json;
    const a4 = await s.api("/team/assign", { method: "POST", body: { agentId: mine.id, text: "A listing for a 3 bed house with a big yard" } });
    assert.equal(a4.status, 202, JSON.stringify(a4.json));
    const r4 = await waitTask(s.api, a4.json.task.id, settled);
    assert.equal(r4.task.status, "done");
    assert.equal((await s.api(`/missions/${r4.task.runId}`)).json.customAgent?.id, mine.id);
    const chat = await s.api("/chat", { method: "POST", body: { prompt: "Hello, who are you?", employee: mine.id } });
    assert.equal(chat.status, 202, JSON.stringify(chat.json));
    const chat2 = await s.api("/chat", { method: "POST", body: { prompt: "Hello", employee: "emp-social-content" } });
    assert.equal(chat2.status, 202, JSON.stringify(chat2.json));

    // outside agents: a plain reason when they are not set up, and no task is made
    const gb = await s.api("/team/assign", { method: "POST", body: { agentId: "grokbot", text: "Find the invoice in Gmail" } });
    assert.equal(gb.status, 409);
    assert.match(gb.json.error, /Grok Bot is not set up/);
    assert.equal((await s.api("/team/tasks?agent=grokbot")).json.items.length, 0);
    assert.equal((await s.api("/team/assign", { method: "POST", body: { agentId: "nobody", text: "x" } })).status, 404);
    assert.equal((await s.api("/team/assign", { method: "POST", body: { agentId: "emp-seo", text: "  " } })).status, 400);

    // the cap per task
    assert.equal((await s.api("/team/agents/emp-seo/cap", { method: "POST", body: { cap: 0 } })).status, 400);
    assert.equal((await s.api("/team/agents/emp-seo/cap", { method: "POST", body: { cap: 0.5 } })).json.cap, 0.5);
    assert.equal((await s.api("/team")).json.agents.find((a) => a.id === "emp-seo").cap, 0.5);

    // a duty: a schedule that runs this agent; its run lands on the desk
    const du = await s.api("/team/agents/emp-social-content/duties", { method: "POST", body: { text: "Draft next week's 5 posts", every: "week", day: 1, time: "08:00", capUsd: 2 } });
    assert.equal(du.status, 200, JSON.stringify(du.json));
    assert.equal(du.json.duty.target.kind, "agent");
    assert.equal(du.json.duty.target.agentId, "emp-social-content");
    assert.equal(du.json.duty.trigger.cron, "0 8 * * 1");
    assert.equal(du.json.duty.after.action, "none", "a duty never sends its result anywhere");
    assert.equal(du.json.when, "every Monday at 8:00 AM");
    const duties = (await s.api("/team")).json.duties.filter((d) => d.agentId === "emp-social-content");
    assert.equal(duties.length, 1);
    assert.equal((await s.api("/team/agents/grokbot/duties", { method: "POST", body: { text: "x", every: "day", time: "09:00" } })).status, 400);
    const ran = await s.api(`/schedules/${du.json.duty.id}/run`, { method: "POST", body: {} });
    assert.equal(ran.status, 202, JSON.stringify(ran.json));
    const t0 = Date.now();
    let dutyTask = null;
    while (Date.now() - t0 < 90000) {
      dutyTask = (await s.api("/team/tasks?agent=emp-social-content")).json.items.find((t) => t.source === "duty");
      if (dutyTask && settled(dutyTask)) break;
      await sleep(300);
    }
    assert.ok(dutyTask, "the duty's run is on the desk");
    assert.equal(dutyTask.status, "review", dutyTask.error || "posts wait for the OK");
    assert.equal((await s.api(`/missions/${dutyTask.runId}`)).json.customAgent?.id, "emp-social-content", "the duty runs the employee");

    // no secret or private number is kept in a task
    const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV123456";
    const sec = await s.api("/team/assign", { method: "POST", body: { agentId: "emp-bookkeeper", text: `Use key ${key} and check SSN 123-45-6789 on the form` } });
    assert.equal(sec.status, 202, JSON.stringify(sec.json));
    assert.equal(sec.json.task.text.includes(key), false);
    assert.match(sec.json.task.text, /\[hidden\]/);
    assert.match(sec.json.task.text, /\*\*\*-\*\*-6789/);
    await waitTask(s.api, sec.json.task.id, settled);
    const all = JSON.stringify((await s.api("/team")).json);
    assert.equal(all.includes(key), false);
    assert.equal(all.includes("123-45-6789"), false);
    assert.equal((await s.api(`/missions/${sec.json.task.runId}`)).json.prompt.includes(key), false, "the run never saw the key either");
    const files = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/task/i.test(f.name) || /agents/i.test(f.name)) files.push(p); } };
    walk(s.dir);
    assert.ok(files.length > 0, "the task store is on disk in the data folder");
    for (const f of files) assert.equal(fs.readFileSync(f, "utf8").includes(key), false, f);
  } finally { await s.stop(); }
});

// ---------- the page ----------
async function seedDesk(api) {
  await api("/demo", { body: { on: true } });
  const a = await api("/team/assign", { body: { agentId: "emp-social-content", text: "Write 5 posts for Valentine's week for my bakery" } });
  const b = await api("/team/assign", { body: { agentId: "emp-social-content", text: "Weekend hours post" } });
  await api("/team/assign", { body: { agentId: "emp-social-content", text: "Spring menu launch teaser", startAt: Date.now() + 20 * 3600000 } });
  await api("/team/assign", { body: { agentId: "emp-bookkeeper", text: "Sum up last month's receipts by category" } });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const items = (await api("/team/tasks")).json.items;
    if ([a.json.task.id, b.json.task.id].every((id) => items.find((t) => t.id === id && ["review", "done"].includes(t.status)))) break;
    await sleep(300);
  }
  await api(`/team/tasks/${b.json.task.id}/approve`, { body: { how: "copied" } });
  await api("/team/agents/emp-social-content/duties", { body: { text: "Draft next week's 5 posts", every: "week", day: 1, time: "08:00" } });
}
async function nothingHidden(page) {
  return page.evaluate(() => {
    const out = [];
    for (const sel of ["#tm-assign", "#tm-give", "#tm-tell-text", "[data-agent]"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 20), y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit))) out.push(`${sel} under ${hit?.id || hit?.className || hit?.tagName}`);
    }
    return { out, sx: document.documentElement.scrollWidth, iw: innerWidth };
  });
}

test("page: Team list with statuses and counts, a desk, Assign, Review, a duty, Give to an agent, 1366 and 390, light and dark", { skip: skipUi, timeout: 420000 }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const t = await bootMac({ width: 1366, height: 800, mode: "expert", env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    const { page, api } = t;
    await seedDesk(api);
    await page.evaluate(() => window.CC.go("agents"));
    await page.waitForSelector("#tm-page [data-agent]", { timeout: 30000 });
    const list = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll("#tm-page [data-team-tab]")].map((b) => b.textContent.trim()),
      names: [...document.querySelectorAll("#tm-page [data-agent] .tm-who b")].map((b) => b.textContent),
      statuses: [...document.querySelectorAll("#tm-page [data-agent] .tm-st")].map((b) => b.dataset.status),
      strip: document.getElementById("tm-today")?.innerText.replace(/\s+/g, " "),
      social: document.querySelector('[data-agent="emp-social-content"] .tm-st')?.textContent,
    }));
    assert.deepEqual(list.tabs, ["Team", "Hire an agent", "My agents", "Prompts"]);
    assert.ok(list.names.includes("Social media writer") && list.names.includes("Grok Bot") && list.names.includes("Browser helper"), list.names.join(", "));
    assert.ok(list.statuses.includes("review") && list.statuses.includes("free"), list.statuses.join(","));
    assert.match(list.strip, /working/);
    assert.match(list.strip, /need your OK/);
    assert.match(list.strip, /done today/);
    assert.match(list.social, /need(s)? OK/);

    // select an agent: its desk
    await page.click('[data-agent="emp-social-content"]');
    await page.waitForFunction(() => document.getElementById("tm-desk-name")?.textContent === "Social media writer", null, { timeout: 10000 });
    const desk = await page.evaluate(() => ({ text: document.getElementById("tm-desk").innerText, review: document.querySelectorAll("#tm-assigned [data-task-review]").length, waiting: document.querySelectorAll("#tm-assigned [data-task-edit]").length, done: document.querySelectorAll("#tm-donelately .tm-res").length, duty: document.querySelectorAll("#tm-duties .tm-duty").length }));
    for (const w of ["Chat with it", "+ Give a task", "Assign", "Assigned to Social media writer", "Ready for your OK", "Waiting to start", "Done lately", "Approved and copied", "Duties", "Every Monday at 8:00 AM", "How it works for you", "Never posts or sends: everything waits for your OK"]) assert.ok(desk.text.includes(w), w);
    assert.ok(desk.review >= 1 && desk.waiting === 1 && desk.done >= 1 && desk.duty === 1, JSON.stringify(desk));
    assert.equal(desk.text.includes(EM), false);
    await page.evaluate(() => document.getElementById("tm-page").scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(SHOTS, "team-0439-desk-1366.png") });
    assert.deepEqual((await nothingHidden(page)).out, []);

    // Assign from the one-line box: Working, then Ready for your OK (demo mode)
    await page.fill("#tm-tell-text", "Write a caption for the new cinnamon roll photo");
    await page.click("#tm-assign");
    await page.waitForFunction(() => [...document.querySelectorAll("#tm-assigned .tm-task")].some((r) => /cinnamon roll/.test(r.textContent)), null, { timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll("#tm-assigned .tm-task")].some((r) => /cinnamon roll/.test(r.textContent) && r.dataset.status === "review"), null, { timeout: 90000 });
    const feed = await page.evaluate(() => (window.CC.S.feed || []).map((e) => e.text || "").join("\n"));
    assert.match(feed, /Social media writer (started|finished) Write a caption/, "the Live feed says who did what");

    // Review: the result with Approve, Ask for changes, Dismiss
    await page.evaluate(() => { const r = [...document.querySelectorAll("#tm-assigned .tm-task")].find((x) => /cinnamon roll/.test(x.textContent)); r.querySelector("[data-task-review]").click(); });
    await page.waitForSelector(".tm-dlg #tr-result", { timeout: 10000 });
    const rv = await page.evaluate(() => ({ text: document.querySelector(".tm-dlg").innerText, result: document.querySelector("#tr-result").innerText.length }));
    for (const w of ["Approve and copy", "Approve and save to MindMedia", "Ask for changes", "Dismiss", "Nothing is sent or posted"]) assert.ok(rv.text.includes(w), w);
    assert.ok(rv.result > 20);
    await page.screenshot({ path: path.join(SHOTS, "team-0439-review-1366.png") });
    await page.click("#tr-save");
    await page.waitForFunction(() => !document.querySelector(".tm-dlg") && /saved to MindMedia/.test(document.getElementById("tm-donelately").innerText), null, { timeout: 15000 });

    // a duty can be added and shows
    await page.click("#tm-duty-add");
    await page.fill("#td-text", "Reply to new reviews");
    await page.selectOption("#td-every", "day");
    await page.fill("#td-time", "17:00");
    await page.click("#td-add");
    await page.waitForFunction(() => /Reply to new reviews/.test(document.getElementById("tm-duties").innerText) && /Every day at 5:00 PM/.test(document.getElementById("tm-duties").innerText), null, { timeout: 15000 });

    // Chat with it opens Chat with the agent picked, and the chat page says so
    await page.click("#tm-chat");
    await page.waitForFunction(() => window.CC.S.view === "command" && window.CC.S.employee?.id === "emp-social-content", null, { timeout: 10000 });
    await page.waitForFunction(() => /Chatting with Social media writer/.test(document.body.innerText), null, { timeout: 15000 });

    // Give to an agent from a chat answer: the answer and its request become a task on that desk
    await page.click("#tm-chat-stop");
    // 0.4.39 (merge with 0.4.38, where Send on an answered chat is a follow-up in the same chat): a new chat first, so
    // this question is the chat's own request
    await page.evaluate(() => window.CC.layout?.newChat?.());
    await page.waitForSelector("#view .ex-chat #orders", { timeout: 15000 });
    await page.fill("#orders", "Write a thank-you note for Mrs. Lee");
    await page.click("#go");
    await page.waitForFunction(() => String(window.CC.S.live?.mission?.prompt || "").includes("Mrs. Lee") && window.CC.S.live?.status === "done" && !!document.getElementById("tm-give-answer"), null, { timeout: 90000 });
    await page.evaluate(() => document.getElementById("tm-give-answer").click());
    await page.waitForSelector(".tm-dlg #tg-agent", { timeout: 10000 });
    assert.match(await page.inputValue("#tg-text"), /thank-you note for Mrs\. Lee/);
    await page.selectOption("#tg-agent", "emp-executive-assistant");
    await page.click("#tg-go");
    await page.waitForFunction(() => !document.querySelector(".tm-dlg"), null, { timeout: 15000 });
    const given = (await api("/team/tasks?agent=emp-executive-assistant")).json.items;
    assert.ok(given.some((x) => x.source === "chat" && /Mrs\. Lee/.test(x.text)), "the task is on that agent's desk");

    // dark
    await page.evaluate(() => { document.body.dataset.theme = "dark"; window.CC.go("agents"); });
    await page.waitForSelector("#tm-page [data-agent]", { timeout: 20000 });
    await page.click('[data-agent="emp-social-content"]');
    await page.waitForFunction(() => document.getElementById("tm-desk-name")?.textContent === "Social media writer", null, { timeout: 10000 });
    const dark = await page.evaluate(() => { const c = getComputedStyle(document.querySelector(".tm-wrap")); const tx = getComputedStyle(document.querySelector("#tm-desk-name")); return { bg: c.backgroundColor, tx: tx.color }; });
    assert.notEqual(dark.bg, dark.tx);
    await page.evaluate(() => document.getElementById("tm-page").scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(SHOTS, "team-0439-dark-1366.png") });
    const fit = await nothingHidden(page);
    assert.deepEqual(fit.out, []);
    assert.ok(fit.sx <= fit.iw + 1, `no sideways scroll (${fit.sx} > ${fit.iw})`);
    assert.deepEqual(t.errors.filter((e) => !/ResizeObserver/.test(e)), []);
  } finally { await t.close(); }
});

test("page at 390 x 844: list then desk, nothing under the dock or the Talk bar, no sideways scroll", { skip: skipUi, timeout: 240000 }, async () => {
  const t = await bootMac({ width: 390, height: 844, mode: "expert", env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    const { page, api } = t;
    await seedDesk(api);
    await page.evaluate(() => window.CC.go("agents"));
    await page.waitForSelector("#tm-page [data-agent]", { timeout: 30000 });
    await page.click('[data-agent="emp-social-content"]');
    await page.waitForFunction(() => document.getElementById("tm-desk-name")?.textContent === "Social media writer", null, { timeout: 10000 });
    const fit = await nothingHidden(page);
    assert.deepEqual(fit.out, []);
    assert.ok(fit.sx <= fit.iw + 1, `no sideways scroll (${fit.sx} > ${fit.iw})`);
    await page.evaluate(() => document.getElementById("tm-desk").scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(SHOTS, "team-0439-desk-390.png") });
    // Assign works at phone width too
    await page.fill("#tm-tell-text", "Two captions for a cupcake photo");
    await page.click("#tm-assign");
    await page.waitForFunction(() => [...document.querySelectorAll("#tm-assigned .tm-task")].some((r) => /cupcake/.test(r.textContent) && r.dataset.status === "review"), null, { timeout: 90000 });
    await page.evaluate(() => { const r = [...document.querySelectorAll("#tm-assigned .tm-task")].find((x) => /cupcake/.test(x.textContent)); r.querySelector("[data-task-review]").click(); });
    await page.waitForSelector(".tm-dlg #tr-copy", { timeout: 10000 });
    const box = await page.evaluate(() => { const r = document.querySelector(".tm-dlg-box").getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
    assert.ok(box.l >= 0 && box.r <= box.w, "the review fits the phone");
    await page.screenshot({ path: path.join(SHOTS, "team-0439-review-390.png") });
    assert.deepEqual(t.errors.filter((e) => !/ResizeObserver/.test(e)), []);
  } finally { await t.close(); }
});

test("Simple: Team is in Settings and more, and opens the same page", { skip: skipUi, timeout: 180000 }, async () => {
  const t = await bootMac({ width: 1366, height: 800, mode: "simple", env: { CC_STATUS_PAGES: "off" } });
  try {
    const { page } = t;
    await page.waitForFunction(() => window.CC.featuresReady === true, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => window.CC.go("command"));
    await page.waitForSelector("#side-profile", { timeout: 20000 });
    await page.click("#side-profile");
    await page.waitForSelector("#side-menu:not([hidden]) #side-team", { timeout: 10000 });
    await page.click("#side-team");
    await page.waitForSelector("#tm-page [data-agent]", { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.CC.S.view), "agents");
    assert.match(await page.evaluate(() => document.getElementById("tm-page").innerText), /Your team/);
  } finally { await t.close(); }
});
