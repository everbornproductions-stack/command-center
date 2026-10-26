// Together: team spaces (Phase 61), AI group chat (Phase 44), rooms and recipes (Phase 43),
// news and alerts (Phase 42). Local only. No hub, no Square, no real keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { seatCheck, EXTREME_TEAM_SEATS } from "../server/team-seat.js";
import { can, canManageMember, hashCode, validEmail, PERMISSIONS } from "../server/plugins/teamspaces.js";
import { SUPPORT_NOTE, PERSONAS, repliesFrom, MAX_AIS } from "../server/plugins/groupchat.js";
import { liveSnapshot, CATEGORIES } from "../server/plugins/rooms.js";
import { redact } from "../server/together-text.js";
import { spendItems, jobItem, updateItem } from "../server/plugins/newsfeed.js";

const SECRET = "sk-ant-fakefakefake";

test("seat gate matches the Extreme cap, and calls feature-gate when that module is passed in", async () => {
  assert.equal(EXTREME_TEAM_SEATS, 5);
  const free = await seatCheck(0, { tier: "free", gateMod: null });
  assert.equal(free.ok, false);
  assert.equal(free.code, "extreme_required");
  assert.equal(free.source, "fallback");
  assert.match(free.message, /Extreme/);
  assert.match(free.message, /5 seats/);
  const pro = await seatCheck(0, { tier: "pro", gateMod: null });
  assert.equal(pro.ok, false);
  const roomy = await seatCheck(4, { tier: "owner", gateMod: null });
  assert.equal(roomy.ok, true);
  assert.equal(roomy.limit, 5);
  const studio = await seatCheck(5, { tier: "studio", gateMod: null });
  assert.equal(studio.ok, false);
  assert.match(studio.message, /5 seats/);
  const extreme = await seatCheck(0, { tier: "extreme", gateMod: null });
  assert.equal(extreme.ok, true);

  let seen = null;
  const gateMod = {
    EXTREME_TEAM_SEATS: 5,
    LIMITS: {
      free: { teamSeats: 0, label: "Free" },
      extreme: { teamSeats: 5, label: "Extreme" },
      owner: { teamSeats: 5, label: "Owner" },
    },
    evaluateGate(limits, feature, info) {
      seen = { feature, seats: info.seats, limit: limits.teamSeats };
      if (info.seats < limits.teamSeats) return { ok: true, feature, message: "" };
      return { ok: false, feature, code: "extreme_required", message: "Team spaces are part of Extreme. Extreme includes 5 seats." };
    },
  };
  const opened = await seatCheck(0, { tier: "extreme", gateMod });
  assert.equal(opened.ok, true);
  assert.equal(opened.source, "feature-gate");
  assert.deepEqual(seen, { feature: "teamSeats", seats: 0, limit: 5 });
  const capped = await seatCheck(5, { tier: "extreme", gateMod });
  assert.equal(capped.ok, false);
  assert.equal(seen.seats, 5);
  assert.match(capped.message, /5 seats/);
});

test("roles, redaction, personas, live snapshot, and news rows", () => {
  assert.equal(can("owner", "space.delete"), true);
  assert.equal(can("admin", "space.delete"), false);
  assert.equal(can("viewer", "projects.view"), true);
  assert.equal(can("member", "members.invite"), false);
  assert.equal(canManageMember("admin", "member", "viewer"), true);
  assert.equal(canManageMember("admin", "member", "admin"), false);
  assert.equal(validEmail("a@b.co"), true);
  assert.equal(hashCode("abc").length, 64);
  assert.equal(Object.keys(PERMISSIONS).length >= 5, true);
  assert.equal(redact(`hello ${SECRET} there`).includes("fakefakefake"), false);
  assert.match(redact(`hello ${SECRET} there`), /\[hidden\]/);
  assert.equal(MAX_AIS, 4);
  assert.match(SUPPORT_NOTE, /988/);
  assert.match(SUPPORT_NOTE, /not a licensed therapist/);
  assert.match(PERSONAS.support.prompt, /not a licensed therapist/);
  assert.match(PERSONAS.support.prompt, /988/);
  const lines = repliesFrom(JSON.stringify({ replies: ["one", "two", "three", "four"] }));
  assert.equal(lines.length, 3);
  const snap = liveSnapshot({ id: "m-1", title: `Week ${SECRET}`, status: "running", prompt: `Goal ${SECRET}`, tasks: [{ title: `Draft ${SECRET}`, status: "running" }] });
  assert.equal(JSON.stringify(snap).includes("fakefakefake"), false);
  assert.equal(snap.step.includes("Draft"), true);
  assert.ok(CATEGORIES.includes("Marketing"));
  const spend = spendItems({ perProvider: { openai: { level: "amber", pct: 80 }, demo: { level: "ok", pct: 10 } } }, { openai: "OpenAI" });
  assert.equal(spend.length, 1);
  assert.match(spend[0].title, /OpenAI/);
  const job = jobItem({ id: "m-9", title: "Bakery", status: "done", finishedAt: 10 });
  assert.match(job.title, /Finished: Bakery/);
  const idle = updateItem({ current: "0.4.8", available: false });
  assert.match(idle.body, /No newer version/);
  const ready = updateItem({ current: "0.4.8", latest: "9.9.9", available: true });
  assert.match(ready.body, /Nothing downloads until you click/);
});

test("files: plain words, Together is in the menu, workspaces plugin is untouched in purpose", () => {
  const files = [
    "server/team-seat.js", "server/together-text.js", "server/moderation.js",
    "server/plugins/teamspaces.js", "server/plugins/groupchat.js", "server/plugins/rooms.js",
    "server/plugins/newsfeed.js", "server/plugins/moderation.js", "web/features/together.js",
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(text.includes("\u2014"), false, f);
    assert.equal(text.includes("\u2013"), false, f);
  }
  const ui = fs.readFileSync(path.join(ROOT, "web/features/together.js"), "utf8");
  assert.match(ui, /988/);
  assert.match(ui, /not a licensed therapist/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/perf/registry.js"), "utf8"), /"together"/);
  assert.match(fs.readFileSync(path.join(ROOT, "web/nav.js"), "utf8"), /together: "Together"/);
  const ws = fs.readFileSync(path.join(ROOT, "server/plugins/workspaces.js"), "utf8");
  assert.match(ws, /Phase 8/);
  assert.equal(ws.includes("teamspaces"), false);
});

test("free copy: team spaces stay closed, rooms and the news list still open", async () => {
  const s = await startServer();
  try {
    const g = await s.api("/teamspaces");
    assert.equal(g.status, 200);
    assert.equal(g.json.seats.open, false);
    assert.equal(g.json.seats.limit, 0);
    assert.match(g.json.seats.message, /5 people total/);
    const c = await s.api("/teamspaces", { method: "POST", body: { name: "Shop" } });
    assert.equal(c.status, 402);
    assert.equal(c.json.code, "extreme_required");
    const ws = await s.api("/workspaces");
    assert.equal(ws.status, 200);
    assert.equal(ws.json.studio, false);
    const room = await s.api("/rooms", { method: "POST", body: { name: "Lobby", category: "General" } });
    assert.equal(room.status, 200, JSON.stringify(room.json));
    fs.mkdirSync(path.join(s.dir, "missions"), { recursive: true });
    fs.writeFileSync(path.join(s.dir, "missions", "m-free.json"), JSON.stringify({
      id: "m-free", kind: "mission", title: "Window card", prompt: "Write a window card", status: "done", tasks: [{ title: "Write the card", status: "done" }],
    }));
    const shared = await s.api(`/rooms/${room.json.id}/live`, { method: "POST", body: { missionId: "m-free" } });
    assert.equal(shared.status, 200);
    const copied = await s.api(`/rooms/${room.json.id}/recipe`, { method: "POST", body: {} });
    assert.equal(copied.status, 200);
    const started = await s.api(`/rooms/recipes/${copied.json.recipe.id}/start`, { method: "POST", body: {} });
    assert.equal(started.status, 402);
    const feed = await s.api("/newsfeed");
    assert.equal(feed.status, 200);
    assert.ok(feed.json.items.some((i) => i.kind === "update"));
    assert.ok(feed.json.items.some((i) => i.kind === "job" && /Window card/.test(i.title)));
  } finally { await s.stop(); }
});

test("owner copy: five seats, group chat, live recipe, report and block, news rows", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const created = await s.api("/teamspaces", { method: "POST", body: { name: "Shop team" } });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const id = created.json.id;
    const emails = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    let link = "";
    for (const email of emails) {
      const inv = await s.api(`/teamspaces/${id}/members`, { method: "POST", body: { email, role: "member" } });
      assert.equal(inv.status, 200, JSON.stringify(inv.json));
      assert.equal(inv.json.emailed, false);
      link = inv.json.code;
    }
    const full = await s.api(`/teamspaces/${id}/members`, { method: "POST", body: { email: "e@example.com", role: "viewer" } });
    assert.equal(full.status, 402);
    assert.match(full.json.error, /5 people total/);
    const code = link;
    const stored = fs.readFileSync(path.join(s.dir, "teamspaces.json"), "utf8");
    assert.equal(stored.includes(code), false);
    assert.ok(stored.includes(hashCode(code)));
    const joined = await s.api("/teamspaces/join", { method: "POST", body: { code } });
    assert.equal(joined.status, 200);
    assert.equal(joined.json.emailed, false);
    const role = await s.api(`/teamspaces/${id}/members/${encodeURIComponent("a@example.com")}`, { method: "PATCH", body: { role: "viewer" } });
    assert.equal(role.status, 200);
    assert.equal(role.json.role, "viewer");
    assert.equal((await s.api(`/teamspaces/${id}/members/${encodeURIComponent("a@example.com")}`, { method: "PATCH", body: { role: "owner" } })).status, 400);
    const project = await s.api("/projects", { method: "POST", body: { name: "Client shelf" } });
    const shared = await s.api(`/teamspaces/${id}/projects`, { method: "POST", body: { projectId: project.json.id } });
    assert.equal(shared.status, 200);
    assert.equal(shared.json.project.name, "Client shelf");
    assert.equal((await s.api(`/teamspaces/${id}/projects`, { method: "POST", body: { projectId: "missing" } })).status, 404);
    await s.api("/moderation/block", { method: "POST", body: { key: "e@example.com" } });
    await s.api(`/teamspaces/${id}/members/${encodeURIComponent("d@example.com")}`, { method: "DELETE" });
    const blocked = await s.api(`/teamspaces/${id}/members`, { method: "POST", body: { email: "e@example.com", role: "member" } });
    assert.equal(blocked.status, 403);
    const again = await s.api(`/teamspaces/${id}/members`, { method: "POST", body: { email: "f@example.com", role: "admin" } });
    assert.equal(again.status, 200);
    const list = await s.api("/teamspaces");
    assert.equal(list.json.seats.used, 5);
    assert.equal(list.json.spaces[0].projects.length, 1);

    await s.api("/demo", { method: "POST", body: { on: true } });
    const before = fs.existsSync(path.join(s.dir, "ledger.jsonl")) ? fs.readFileSync(path.join(s.dir, "ledger.jsonl"), "utf8").length : 0;
    const chat = await s.api("/groupchat");
    assert.equal(chat.status, 200);
    assert.equal(chat.json.max, 4);
    assert.match(chat.json.supportNote, /988/);
    const afterGet = fs.existsSync(path.join(s.dir, "ledger.jsonl")) ? fs.readFileSync(path.join(s.dir, "ledger.jsonl"), "utf8").length : 0;
    assert.equal(afterGet, before, "opening the chat does not call an AI");
    const tooMany = await s.api("/groupchat/members", { method: "POST", body: { members: [1, 2, 3, 4, 5].map((n) => ({ provider: "demo-nova", persona: "fun", model: "x" + n })) } });
    assert.equal(tooMany.status, 400);
    const members = await s.api("/groupchat/members", { method: "POST", body: { members: [
      { provider: "demo-nova", model: "nova-lite", persona: "fun" },
      { provider: "demo-sage", model: "sage-mini", persona: "support" },
    ] } });
    assert.equal(members.status, 200, JSON.stringify(members.json));
    assert.match(members.json.supportNote, /not a licensed therapist/);
    const sent = await s.api("/groupchat/send", { method: "POST", body: { text: "Say hello in one short line." } });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.message.replies.length, 2);
    for (const reply of sent.json.message.replies) {
      assert.ok(reply.replies.length >= 2 && reply.replies.length <= 3, JSON.stringify(reply));
    }
    const support = sent.json.message.replies.find((r) => r.persona === "support");
    assert.match(support.replies.join(" "), /988/);
    assert.match(support.replies.join(" "), /not a licensed therapist/);
    const reported = await s.api("/groupchat/report", { method: "POST", body: { targetId: sent.json.message.id, reason: "Too sharp" } });
    assert.equal(reported.status, 200);
    assert.equal(reported.json.sent, false);

    const room = await s.api("/rooms", { method: "POST", body: { name: "Watch party", category: "Nope" } });
    assert.equal(room.status, 400);
    const okRoom = await s.api("/rooms", { method: "POST", body: { name: "Watch party", category: "Video" } });
    assert.equal(okRoom.status, 200);
    const rid = okRoom.json.id;
    const said = await s.api(`/rooms/${rid}/messages`, { method: "POST", body: { text: "Looking at the build." } });
    assert.equal(said.status, 200);
    assert.equal(said.json.sent, false);
    const who = await s.api(`/rooms/${rid}/members`, { method: "POST", body: { name: "Sam" } });
    assert.equal(who.status, 200);
    fs.writeFileSync(path.join(s.dir, "missions", "m-live.json"), JSON.stringify({
      id: "m-live", kind: "mission", title: "Bakery week", status: "running",
      prompt: `Plan the week. Token ${SECRET} stays out.`,
      tasks: [{ id: "t1", title: `Draft ${SECRET}`, status: "running" }, { id: "t2", title: "Schedule", status: "pending" }],
    }));
    const live = await s.api(`/rooms/${rid}/live`, { method: "POST", body: { missionId: "m-live" } });
    assert.equal(live.status, 200, JSON.stringify(live.json));
    assert.equal(JSON.stringify(live.json).includes("fakefakefake"), false);
    assert.match(live.json.live.step, /Draft/);
    const recipe = await s.api(`/rooms/${rid}/recipe`, { method: "POST", body: {} });
    assert.equal(recipe.status, 200);
    assert.equal(JSON.stringify(recipe.json).includes("fakefakefake"), false);
    assert.ok(recipe.json.recipe.steps.some((step) => /Draft/.test(step)));
    const emptyReport = await s.api(`/rooms/${rid}/report`, { method: "POST", body: { targetType: "message", targetId: said.json.message.id, reason: "  " } });
    assert.equal(emptyReport.status, 400);
    const report = await s.api(`/rooms/${rid}/report`, { method: "POST", body: { targetType: "message", targetId: said.json.message.id, reason: "Off topic" } });
    assert.equal(report.status, 200);
    assert.equal(report.json.sent, false);
    assert.equal((await s.api(`/rooms/${rid}/messages/${said.json.message.id}/hide`, { method: "POST", body: {} })).status, 200);
    const blockedWho = await s.api(`/rooms/${rid}/block`, { method: "POST", body: { key: who.json.member.id } });
    assert.equal(blockedWho.status, 200);
    const seen = await s.api(`/rooms/${rid}`);
    assert.equal(seen.json.messages.some((m) => m.id === said.json.message.id), false);
    assert.equal(seen.json.members.some((m) => m.id === who.json.member.id), false);
    assert.equal(seen.json.hub, false);

    fs.writeFileSync(path.join(s.dir, "missions", "m-done.json"), JSON.stringify({
      id: "m-done", kind: "mission", title: "Bakery plan", status: "done", finishedAt: Date.now(), tasks: [],
    }));
    const caps = await s.api("/alerts/caps", { method: "POST", body: { caps: { "demo-nova": 0.0000001 } } });
    assert.equal(caps.status, 200, JSON.stringify(caps.json));
    const note = await s.api("/newsfeed/model", { method: "POST", body: { title: "Example model 2", note: "A note only. No provider was called." } });
    assert.equal(note.status, 200);
    assert.equal(note.json.watched, false);
    const feed = await s.api("/newsfeed");
    const kinds = new Set(feed.json.items.map((i) => i.kind));
    for (const kind of ["job", "spend", "model", "update"]) assert.ok(kinds.has(kind), [...kinds].join(","));
    assert.ok(feed.json.items.some((i) => i.kind === "spend" && /demo-nova|Nova/.test(i.title)));
    assert.match(feed.json.note, /Nothing is sent/);
  } finally { await s.stop(); }
});
