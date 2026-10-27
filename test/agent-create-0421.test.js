// Dogfood 11, item P-agent: one place to create a custom agent (name, job, when it runs, a monthly spend
// limit and the "Never send or post" switch), a real noSend setting with a run-time tool filter, and a
// Schedules Agent select that offers to create an agent instead of a dead option.
// The checks here are on the page sources (normalised for a Windows checkout) and on the local routes the
// box posts to. The server comes from test/helpers.js: temp data folder, stub addresses, no real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { filterSendTools, sendTool } from "../server/action-policy.js";
import { runOptions } from "../server/custom-agents.js";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");

test("the run-time filter drops send, post, publish, email, message, tweet and upload tools and keeps readers", () => {
  const out = [
    { name: "send_email", description: "Send an email to one person" },
    { name: "post_to_twitter", description: "Post a tweet to the account" },
    { name: "publish_story", description: "Publishes the story to the page" },
    { name: "upload_photo", description: "Upload a picture from disk" },
    { name: "send_message", description: "Sends a message to the channel" },
    { name: "email_contact", description: "Email one person on the list" },
    { name: "message_user", description: "Message the person in the app" },
    { name: "sendmail", description: "Mail from the desktop client" }, // one blob, caught by the stem
    { name: "sendMail", description: "Camel case name" },
    // the wrapped name and the wrapped description that server/mcp.js builds for every tool
    { name: "demo__send_email", description: "Send an email to one person (tool \"send_email\" from Demo)" },
    { name: "highlevel__send_sms", description: "Send an SMS to a contact", server: { id: "highlevel" }, tool: { name: "send_sms" } },
  ];
  const keep = [
    { name: "search_documents", description: "Find documents by a word" },
    { name: "list_files", description: "Lists the files in a folder" },
    { name: "read_file", description: "Read one file from disk" },
    { name: "word_count", description: "Counts the words in a text" },
    { name: "get_weather", description: "The weather right now" },
  ];
  for (const t of out) assert.equal(sendTool(t), true, `${t.name} is a sender`);
  for (const t of keep) assert.equal(sendTool(t), false, `${t.name} stays`);
  assert.deepEqual(filterSendTools([...out, ...keep]), keep, "senders out, readers still there");
  assert.deepEqual(filterSendTools(undefined), [], "no list is fine");
  // a reader whose name says read and whose description says nothing send-ish is never touched
  assert.deepEqual(filterSendTools(keep), keep);
});

// 0.4.22 panel row 69: the switch also keeps the tools that talk to people (dm, reply, forward,
// share, push, notify, slack, comment) while every read-only name stays in the list.
test("dm, reply, forward, share, push, slack and comment senders are filtered, readers stay", () => {
  const senders = [
    { name: "dm_user", description: "Send a direct message to one person" },
    { name: "reply_all", description: "Reply to everyone on the thread" },
    { name: "forward_mail", description: "Forward an email to another person" },
    { name: "share_file", description: "Share a file with the team" },
    { name: "push_notification", description: "Push a notification to the phone" },
    { name: "write_comment", description: "Write a comment on the post" },
    { name: "slack_notify", description: "Notify the channel in Slack" },
  ];
  const readers = [
    { name: "list_messages", description: "Lists the messages in a channel" },
    { name: "read_file", description: "Read one file from disk" },
    { name: "get_comment", description: "Reads one comment by its id" },
    { name: "search_slack", description: "Searches messages in a Slack workspace" },
    { name: "list_shared_files", description: "Lists the files shared with the team" },
    { name: "share_link_info", description: "Reads info about a shared link" },
    { name: "read_comment", description: "Reads one comment" },
    { name: "list_comments", description: "Lists the comments on a page" },
    { name: "get_notifications", description: "Reads the notifications for the account" },
  ];
  for (const t of senders) assert.equal(sendTool(t), true, `${t.name} is a sender`);
  for (const t of readers) assert.equal(sendTool(t), false, `${t.name} stays`);
  assert.deepEqual(filterSendTools([...senders, ...readers]), readers, "senders out, readers still there");
  // a reader name with a send word in its description is still judged by that description
  assert.equal(sendTool({ name: "list_messages", description: "Send a message to the channel" }), true);
});

test("the filter and the noSend flag are wired into the run, and both cards show the badge", () => {
  const opts = runOptions({ id: "ag-x", name: "Safe Runner", instructions: "Answer plainly.", noSend: true, tools: { mode: "all", allow: [] } }, { prompt: "hello" });
  assert.equal(opts.noSend, true, "the flag rides with the run");
  assert.equal(opts.sendMessages, false, "nothing it starts sends on its own");
  const plain = runOptions({ id: "ag-y", name: "Plain", instructions: "Answer plainly.", noSend: false, tools: { mode: "all", allow: [] } }, { prompt: "hello" });
  assert.equal(plain.noSend, undefined);
  assert.equal(plain.sendMessages, undefined);
  // the flag reaches chatWithTools, which is where the list is cut down
  assert.match(read("server/index.js"), /noSend: noSend === true/, "runChat passes the flag on");
  assert.match(read("server/fallback.js"), /noSend: run\.noSend === true/, "fallback passes the flag on");
  assert.match(read("server/mcp.js"), /run\.noSend === true \? filterSendTools\(tools\)/, "the tool list is filtered at run time");
  // badges
  assert.match(read("web/features/agents.js"), /Never sends or posts/, "the agent card says so");
  assert.match(read("web/features/schedules.js"), /Never sends or posts/, "the schedule card says so");
  assert.match(read("server/plugins/schedules.js"), /noSend: a\.noSend === true/, "the schedule page knows about the switch");
});

test("an agent saved with Never send or post keeps the switch, and the schedule page sees it", { timeout: 120000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    const made = await s.api("/agents", { method: "POST", body: { name: "Safe Runner", instructions: "Answer plainly.", noSend: true } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.equal(made.json.noSend, true, "stored on the agent");
    const shown = (await s.api("/agents")).json.agents.find((a) => a.id === made.json.id);
    assert.equal(shown.noSend, true, "the page sees it");
    const plain = await s.api("/agents", { method: "POST", body: { name: "Plain Runner", instructions: "Answer plainly." } });
    assert.equal(plain.json.noSend, false, "off unless asked for");
    // editing the agent some other way keeps the switch, and it can be turned off and on
    const kept = await s.api(`/agents/${made.json.id}`, { method: "POST", body: { description: "Edited" } });
    assert.equal(kept.json.noSend, true, "a plain edit leaves it alone");
    assert.equal((await s.api(`/agents/${made.json.id}`, { method: "POST", body: { noSend: false } })).json.noSend, false);
    assert.equal((await s.api(`/agents/${made.json.id}`, { method: "POST", body: { noSend: true } })).json.noSend, true);
    // the Schedules page gets it with the agent list, for the badge on the schedule card
    const sched = await s.api("/schedules", { method: "POST", body: { name: "Safe schedule", target: { kind: "agent", agentId: made.json.id, text: "" }, trigger: { type: "cron", cron: "0 9 * * 1" }, capUsd: 1, after: { action: "none" } } });
    assert.equal(sched.status, 200, JSON.stringify(sched.json));
    const picked = (await s.api("/schedules")).json.agents.find((a) => a.id === made.json.id);
    assert.deepEqual(picked, { id: made.json.id, name: "Safe Runner", noSend: true });
    const card = (await s.api("/schedules")).json.items.find((x) => x.id === sched.json.schedule.id);
    assert.equal(card.target.kind, "agent");
    assert.equal(card.target.agentId, made.json.id);
  } finally { await s.stop(); }
});

test("the create box sits at the top of the Agents page with every field, not behind a details fold", () => {
  const src = read("web/features/agents.js");
  const box = src.slice(src.indexOf("function createBox"), src.indexOf("function wireCreate"));
  assert.ok(box.includes("Create your own agent"), "the box has its heading");
  assert.match(src, /\$\{createBox\(\)\}\$\{employeesPanel\(\)\}/, "the box renders first, above the page body");
  for (const id of ["ac-name", "ac-job", "ac-when", "ac-cap", "ac-nosend"]) assert.ok(box.includes(`id="${id}"`), `field ${id} is in the box`);
  assert.equal(box.includes("<details"), false, "nothing is folded away");
  assert.equal(/More options|Pro only|Upgrade/.test(box), false, "no More options fold and no Pro popup");
  assert.match(box, /id="ac-nosend" checked/, "Never send or post is checked by default");
  assert.match(box, /Never send or post/);
  assert.match(box, /value="1"/, "the spend limit starts at $1");
});

test("Create posts the agent to the existing route and, when days are picked, a schedule with that agent and the cap", () => {
  const src = read("web/features/agents.js");
  const wire = src.slice(src.indexOf("function wireCreate"), src.indexOf("// ---------- the tab"));
  assert.match(wire, /api\("\/agents", \{ method: "POST", body: \{ name, instructions: job/, "the agent route");
  assert.match(wire, /noSend: q\("#ac-nosend"\)\.checked/, "the switch goes with the agent");
  assert.match(wire, /api\("\/schedules", \{ method: "POST"/, "a schedule is created too");
  assert.match(wire, /kind: "agent", agentId: made\.id/, "the schedule runs that agent");
  assert.match(wire, /capUsd: cap/, "the schedule cap is the monthly spend limit");
  assert.match(wire, /Created \$\{made\.name\}\. It is in My agents/, "it says what was made and where it appears");
  // the when block reuses the Schedules form's day buttons and time box
  assert.match(src, /import \{ DAYS, whenHtml, readWhen, wireWhen \} from "\.\/schedules\.js"/, "shared day and time logic, not a second copy");
  const sched = read("web/features/schedules.js");
  assert.match(sched, /export const DAYS/, "the schedule form's helpers are exported for reuse");
  assert.match(sched, /export function whenHtml/, "the day buttons come from the schedule form");
  assert.match(sched, /export function readWhen/, "the cron is read the same way");
  assert.match(sched, /export function wireWhen/, "one wiring for both forms");
});

test("with no agents the Schedules form offers Create an agent... and opens the create box", () => {
  const sched = read("web/features/schedules.js");
  assert.equal(sched.includes("No agents yet (Agents tab)"), false, "the dead option is gone");
  assert.equal(sched.includes("No agents yet"), false, "no dead end left in the select");
  assert.match(sched, /<option value="__create">Create an agent\.\.\.<\/option>/, "the choice is to make one");
  assert.match(sched, /S\(\)\.openAgentCreate = true/, "it asks the Agents page to open the box");
  assert.match(sched, /window\.CC\.go\("agents"\)/, "and takes you there");
  const agents = read("web/features/agents.js");
  assert.match(agents, /S\(\)\.openAgentCreate/, "the Agents page reads the request");
  assert.match(agents, /const n = \$v\("#ac-name"\); n\?\.focus\(\)/, "the Name field is ready to type in");
});

test("the schedule route accepts what the box posts: target kind agent, that agent id, the cap", { timeout: 120000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  try {
    const made = await s.api("/agents", { method: "POST", body: { name: "Nightly report", instructions: "Write the nightly report." } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const body = {
      name: `${made.json.name} schedule`,
      target: { kind: "agent", agentId: made.json.id, text: "" },
      trigger: { type: "cron", cron: "0 9 * * 1,3,5" },
      capUsd: 1,
      after: { action: "none" },
    };
    const sch = await s.api("/schedules", { method: "POST", body });
    assert.equal(sch.status, 200, JSON.stringify(sch.json));
    assert.equal(sch.json.schedule.target.kind, "agent");
    assert.equal(sch.json.schedule.target.agentId, made.json.id);
    assert.equal(sch.json.schedule.capUsd, 1);
    const listed = (await s.api("/schedules")).json.items.find((x) => x.id === sch.json.schedule.id);
    assert.equal(listed.target.kind, "agent");
    assert.equal(listed.target.agentId, made.json.id);
    assert.equal(listed.capUsd, 1);
  } finally { await s.stop(); }
});
