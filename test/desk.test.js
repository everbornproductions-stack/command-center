// Workstream C: private mode, who reads a prompt, one-file backup, Do this again,
// home, project delete receipt, Double-check this, tone, plain credits, My chats,
// and which AI wrote an answer. Temp data dir. Local demo only. No real key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT, waitBudget } from "./helpers.js";

const DIR = tmpDir("cc-desk-unit-");
process.env.CC_DATA_DIR = DIR;
const store = await import("../server/store.js");
store.setDefaultContext(store.newContext("local", new store.FileStore(DIR)));
const desk = await import("../server/desk.js");
const gate = await import("../server/feature-gate.js");
const brain = await import("../server/brain.js");

const EM = "\u2014";
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

function seedChat(dir, extra = {}) {
  const missions = path.join(dir, "missions");
  fs.mkdirSync(missions, { recursive: true });
  const chat = {
    id: "s-seed",
    kind: "single",
    title: "Sky color",
    prompt: "What color is the sky?",
    projectId: "my-project",
    status: "done",
    provider: "demo-nova",
    model: "nova-lite",
    deliverable: "The sky is blue.",
    startedAt: Date.now() - 2000,
    finishedAt: Date.now() - 1000,
    cost: 0,
    ...extra,
  };
  fs.writeFileSync(path.join(missions, "s-seed.json"), JSON.stringify(chat));
  return chat;
}

async function until(fn, ms) {
  const budget = waitBudget(ms);
  const start = Date.now();
  while (Date.now() - start < budget) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

test("feature gate: Do this again is Pro, backup and double-check are free", () => {
  assert.equal(gate.featureById("repeats").tier, "pro");
  assert.equal(gate.featureById("repeats").label, "Do this again");
  assert.equal(gate.featureById("backup").tier, "free");
  assert.equal(gate.featureById("doubleCheck").tier, "free");
  assert.throws(() => gate.guardFeature("repeats", "free"), (e) => e.status === 402 && /Do this again is part of Pro/.test(e.message));
  assert.equal(gate.guardFeature("repeats", "pro").id, "repeats");
  assert.equal(gate.guardFeature("repeats", "owner").id, "repeats");
  assert.equal(gate.guardFeature("backup", "free").id, "backup");
  assert.equal(gate.guardFeature("doubleCheck", "free").id, "doubleCheck");
});

test("backup file has no keys, restore refuses a key, and a private run is not learned", () => {
  brain.resetBrain();
  brain.saveBrainSettings({ on: true, shareOptIn: false });
  const before = brain.brain().jobs || 0;
  const learned = brain.observe({ provider: "demo-nova", model: "nova-lite", capability: "writing", difficulty: 1, runId: "s-learn", ok: true, cost: 0, ms: 10, free: true });
  assert.ok(learned);
  assert.ok((brain.brain().jobs || 0) > before);
  brain.markPrivateRun("s-quiet");
  assert.equal(brain.observe({ provider: "demo-nova", model: "nova-lite", capability: "writing", difficulty: 1, runId: "s-quiet", ok: true, cost: 0, ms: 10, free: true }), null);

  const file = desk.backupDocument({
    projects: [{ id: "p1", name: "Keep me", categories: [] }],
    chats: [{ id: "s-1", kind: "single", title: "Hi", prompt: "Hello", private: true, deliverable: "Hi there" }],
    settings: { privateMode: true, name: "Ada", cloud: { url: "http://127.0.0.1", anonKey: "sb_publishable_test_not_a_key" }, apiKey: "sk-test-not-a-real-key-0000" },
  });
  assert.equal(file.format, "meldmind-backup");
  assert.equal(file.version, 1);
  assert.equal(file.includesKeys, false);
  const raw = JSON.stringify(file);
  assert.equal(raw.includes("sk-test"), false);
  assert.equal(raw.includes("sb_publishable"), false);
  assert.equal(raw.includes("anonKey"), false);
  assert.equal(file.settings.privateMode, true);
  assert.equal(file.chats[0].private, true);
  assert.throws(() => desk.readBackup({ ...file, includesKeys: true }), (e) => e.status === 400);
  const poisoned = JSON.parse(raw);
  poisoned.chats[0].deliverable = "sk-test-not-a-real-key-0000";
  assert.throws(() => desk.readBackup(poisoned), (e) => e.code === "keys");
  assert.deepEqual(desk.readBackup(raw).projects[0].name, "Keep me");
});

test("readers, receipt, repeat, tone, and the first council use plain words", () => {
  const readers = desk.readersFor({ mode: "council", names: ["Claude", "Gemini", "Claude"] });
  assert.match(readers.line, /These AIs will read your prompt: Claude, Gemini/);
  assert.equal(readers.readers.length, 2);
  assert.match(readers.toolsLine, /No tools are on/);
  assert.match(readers.servicesLine, /No connected service will receive this prompt/);
  const withTools = desk.readersFor({
    mode: "council",
    readers: [{ id: "anthropic", name: "Claude" }, { id: "google", name: "Gemini" }],
    tools: [{ name: "search_docs", server: "Docs" }],
    services: [{ id: "search", name: "Web search" }],
  });
  assert.equal(withTools.readers[0].id, "anthropic");
  assert.match(withTools.toolsLine, /search_docs \(Docs\)/);
  assert.match(withTools.servicesLine, /Web search/);
  const seated = desk.takeMembers(
    [{ provider: "a", model: "a1" }, { provider: "b", model: "b1" }, { provider: "c", model: "c1" }, { provider: "d", model: "d1" }, { provider: "e", model: "e1" }],
    { limit: 4, skip: ["b"] },
  );
  assert.deepEqual(seated.map((m) => m.provider), ["a", "c", "d"]);
  assert.deepEqual(desk.cleanSkip(["anthropic", "not-a-provider", "anthropic"]), ["anthropic"]);
  const mission = desk.readersFor({ mode: "mission", names: ["Nova", "Atlas"], planner: "Nova" });
  assert.match(mission.line, /Nova will read the full prompt/);
  assert.match(mission.line, /Atlas/);
  assert.match(desk.FIRST_COUNCIL, /several AIs at once/);
  assert.equal(desk.writerLine("Claude"), "Written by Claude.");
  const again = desk.repeatBody({ id: "s-1", kind: "single", prompt: "Hello", provider: "demo-nova", model: "nova-lite", private: true });
  assert.equal(again.kind, "single");
  assert.equal(again.body.private, true);
  assert.equal(desk.repeatBody(null).status, 404);
  const tone = desk.toneRequest({ id: "s-1", kind: "single", model: "nova-lite" }, "shorter");
  assert.match(tone.text, /shorter/);
  assert.match(tone.text, /next answer/);
  assert.equal(desk.toneRequest({ id: "s-1", kind: "single", model: "nova-lite" }, "nope").status, 400);
  const armed = desk.armTone(null, "shorter");
  assert.equal(armed.nextTone, "shorter");
  assert.match(armed.line, /does not send/);
  assert.equal(desk.armTone("shorter", "shorter").nextTone, null);
  assert.equal(desk.consumeTone({ nextTone: "plain", name: "Ada" }).settings.nextTone, null);
  assert.match(desk.toneAdd("Be brief.", "Write the next answer so it is shorter."), /shorter/);
  const credits = desk.plainCredits({ month: 0.2, today: 0.004, byProvider: { anthropic: { month: 0.2, calls: 2 } }, names: { anthropic: "Claude" } });
  assert.match(credits.line, /This month your AIs used about \$0\.20/);
  assert.match(credits.rows[0].line, /Claude used about \$0\.20/);
  assert.deepEqual(credits.left, []);
  const left = desk.plainCredits({
    names: { anthropic: "Claude", elevenlabs: "ElevenLabs", "demo-nova": "Nova (demo)" },
    balances: {
      anthropic: { left: 1.2, unit: "USD" },
      elevenlabs: { used: 0, limit: 10000, unit: "characters" },
      "demo-nova": null,
    },
  });
  assert.match(left.left.find((r) => r.id === "anthropic").line, /Claude has about \$1\.20 left/);
  assert.match(left.left.find((r) => r.id === "elevenlabs").line, /ElevenLabs has 10,000 characters left/);
  assert.match(left.left.find((r) => r.id === "demo-nova").line, /No remaining balance is reported for Nova \(demo\)/);
  const viewed = desk.creditsView({
    ledger: { month: 0, today: 0, byProvider: {} },
    statuses: { anthropic: { status: "green", balance: { left: 3, unit: "USD" } }, openai: { status: "grey", balance: null } },
    providers: { anthropic: { name: "Claude" }, openai: { name: "ChatGPT" } },
  });
  assert.equal(viewed.left.length, 1);
  assert.match(viewed.left[0].line, /Claude has about \$3\.00 left/);
  const home = desk.homeCard({ missions: [{ id: "s-1", kind: "single", title: "Hi", startedAt: 5 }], projects: [{ id: "p", name: "Site" }], onboarded: true, keyed: true });
  assert.equal(home.show, true);
  assert.equal(home.title, "Welcome back");
  assert.equal(home.chats[0].title, "Hi");
  assert.equal(desk.homeCard({ missions: [], projects: [], onboarded: false, keyed: false }).show, false);
  const other = desk.secondReader([{ provider: "demo-nova", model: "nova-lite" }, { provider: "demo-atlas", model: "atlas-lite" }], "demo-nova");
  assert.equal(other.provider, "demo-atlas");
  const receipt = desk.projectReceipt({
    project: { id: "p", name: "Site", categories: [{ links: [{}, {}] }] },
    runs: [{ title: "Sky color" }],
    files: ["notes.txt"],
    removed: true,
  });
  assert.match(receipt.lines.join("\n"), /2 links/);
  assert.match(receipt.lines.join("\n"), /stay in My chats/);
  assert.match(receipt.lines.join("\n"), /AI keys were not touched/);
  assert.equal(receipt.removed, true);
  const saved = desk.receiptFile(receipt);
  assert.equal(saved.name, "meldmind-receipt.txt");
  assert.match(saved.text, /AI keys were not touched/);
  assert.equal(read("web/app.js").includes("meldmind-receipt.txt"), true);
  for (const file of ["server/desk.js", "server/feature-gate.js", "server/plugins/desk.js", "web/features/desk.js", "web/app.js", "docs/help/getting-started.md", "docs/help/updates.md"]) {
    assert.equal(read(file).includes(EM), false, file);
  }
});

test("home, readers, backup, delete receipt, double-check, and the Pro repeat gate", async () => {
  const s = await startServer();
  try {
    seedChat(s.dir);
    const home = await s.api("/desk/home");
    assert.equal(home.status, 200);
    assert.equal(home.json.show, true);
    assert.equal(home.json.title, "Welcome back");
    assert.ok(home.json.chats.some((c) => c.title === "Sky color"));

    const chats = await s.api("/desk/chats");
    assert.ok(chats.json.chats.some((c) => c.id === "s-seed" && c.private === false));

    const demo = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(demo.status, 200);
    const readers = await s.api("/desk/readers", { method: "POST", body: { mode: "council", prompt: "Plan a week of posts for a bakery" } });
    assert.equal(readers.status, 200);
    assert.match(readers.json.line, /will read your prompt/);
    assert.ok(readers.json.readers.length >= 1);
    assert.ok(readers.json.readers[0].id);
    assert.match(readers.json.toolsLine, /No tools are on|These tools can be used/);
    assert.match(readers.json.servicesLine, /No connected service will receive this prompt|These connected services will receive the prompt/);
    assert.match(readers.json.explain, /several AIs at once/);
    await s.api("/settings", { method: "POST", body: { councilIntro: true, privateMode: true } });
    const again = await s.api("/desk/readers", { method: "POST", body: { mode: "council", prompt: "Plan a week of posts for a bakery" } });
    assert.equal(again.json.explain, undefined);
    assert.match(again.json.private, /Private mode is on/);

    const missionReaders = await s.api("/desk/readers", { method: "POST", body: { mode: "mission", prompt: "Plan a week of posts for a bakery" } });
    assert.match(missionReaders.json.line, /will read the full prompt/);

    const made = await s.api("/projects", { method: "POST", body: { name: "Receipt job", color: "#22d3ee", categories: [{ id: "links", name: "Links", links: [{ name: "Site", url: "https://example.com" }] }] } });
    assert.equal(made.status, 200);
    const preview = await s.api(`/desk/project-receipt?id=${encodeURIComponent(made.json.id)}`);
    assert.equal(preview.status, 200);
    assert.match(preview.json.lines.join("\n"), /AI keys were not touched/);
    assert.equal(preview.json.removed, false);
    const soft = await s.api(`/projects/${made.json.id}`, { method: "DELETE" });
    assert.equal(soft.status, 200);
    assert.equal(soft.json.soft, true, "the project bar keeps a deleted project in Recently Deleted");
    const deleted = await s.api(`/projects-deleted/${made.json.id}?confirm=yes`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.receipt.removed, true);
    assert.match(deleted.json.receipt.lines.join("\n"), /stay in My chats/);
    assert.equal(deleted.json.receipt.file.name, "meldmind-receipt.txt");
    assert.match(deleted.json.receipt.file.text, /AI keys were not touched/);
    const gone = await s.api(`/desk/project-receipt?id=${encodeURIComponent(made.json.id)}`);
    assert.equal(gone.status, 404);

    const backup = await s.api("/desk/backup");
    assert.equal(backup.status, 200);
    assert.equal(backup.json.includesKeys, false);
    assert.equal(backup.json.format, "meldmind-backup");
    assert.equal(JSON.stringify(backup.json).includes("sk-"), false);
    const poisoned = { ...backup.json, chats: backup.json.chats.map((c) => ({ ...c })) };
    poisoned.chats.push({ id: "s-bad", kind: "single", title: "nope", deliverable: "sk-test-not-a-real-key-0000" });
    const refused = await s.api("/desk/restore", { method: "POST", body: poisoned });
    assert.equal(refused.status, 400);

    const named = await s.api("/projects", { method: "POST", body: { name: "Drop me", color: "#22d3ee", categories: [] } });
    assert.equal(named.status, 200);
    const putBack = await s.api("/desk/restore", { method: "POST", body: backup.json });
    assert.equal(putBack.status, 200);
    assert.equal(putBack.json.includesKeys, false);
    const projects = await s.api("/state");
    assert.equal(projects.json.projects.some((p) => p.name === "Drop me"), false);

    const blocked = await s.api("/desk/repeat", { method: "POST", body: { id: "s-seed" } });
    assert.equal(blocked.status, 402);
    assert.match(blocked.json.error, /Do this again is part of Pro/);

    const credits = await s.api("/desk/credits");
    assert.equal(credits.status, 200);
    assert.match(credits.json.line, /This month your AIs used about/);
    assert.ok(Array.isArray(credits.json.left));
    assert.ok(credits.json.left.length >= 1);
    assert.match(credits.json.left.map((row) => row.line).join("\n"), /No remaining balance is reported/);

    const review = await s.api("/desk/review", { method: "POST", body: { id: "s-seed" } });
    assert.equal(review.status, 200, review.text);
    assert.match(review.json.review.line, /Written by/);
    assert.match(review.json.review.line, /Checked by/);
    assert.ok(review.json.review.text.length > 0);
    assert.notEqual(review.json.review.provider, "demo-nova");

    const tone = await s.api("/desk/tone", { method: "POST", body: { tone: "shorter" } });
    assert.equal(tone.status, 200);
    assert.equal(tone.json.tone, "shorter");
    assert.match(tone.json.line, /does not send/);
    const seed = await s.api("/missions/s-seed");
    assert.equal((seed.json.answerThread || []).some((t) => t.role === "assistant" && t.text), false);
    const armedNow = await s.api("/state");
    assert.equal(armedNow.json.settings.nextTone, "shorter");
    const cleared = await s.api("/desk/tone", { method: "POST", body: { tone: "shorter" } });
    assert.equal(cleared.json.tone, null);
    await s.api("/desk/tone", { method: "POST", body: { tone: "plain" } });
    const sent = await s.api("/chat", { method: "POST", body: { prompt: "Say hello in five words." } });
    assert.equal(sent.status, 202);
    const styled = await until(async () => {
      const row = await s.api(`/missions/${sent.json.runId}`);
      return row.json?.status && row.json.status !== "running" ? row.json : null;
    }, 25000);
    assert.equal(styled.tone, "plain");
    const after = await s.api("/state");
    assert.equal(after.json.settings.nextTone == null || after.json.settings.nextTone === "", true);
    const sent2 = await s.api("/chat", { method: "POST", body: { prompt: "Say goodbye in five words." } });
    const plain = await until(async () => {
      const row = await s.api(`/missions/${sent2.json.runId}`);
      return row.json?.status && row.json.status !== "running" ? row.json : null;
    }, 25000);
    assert.equal(plain.tone || null, null);
  } finally { await s.stop(); }
});

test("a Pro copy can open Do this again, and a missing chat is not a charge", async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1" } });
  try {
    const missing = await s.api("/desk/repeat", { method: "POST", body: { id: "s-missing" } });
    assert.equal(missing.status, 404);
    assert.match(missing.json.error, /not found/);
    assert.doesNotMatch(missing.json.error || "", /part of Pro/);
  } finally { await s.stop(); }
});
