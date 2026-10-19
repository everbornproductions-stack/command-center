// ChatGPT and Claude history import, optional encrypted sync (Phase 23).
// Part 1 runs server/history-import.js and server/history-sync.js in this process against temp data folders:
// fixture export zips import with titles, dates and messages intact; bad zips fail with a clear message; the
// sync blobs held by a stand-in for the Supabase functions are ciphertext and open on a second client with
// the same passphrase only. Part 2 starts the real server in demo mode with a local Supabase stand-in.
// No real URL, key, account or the data/ folder is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, raw } from "./helpers.js";
import { makeZip, fixture, chatgptZip, claudeZip, MockSyncDb } from "./history-helpers.js";

const DIR_A = tmpDir("cc-hist-a-"), DIR_B = tmpDir("cc-hist-b-"), DIR_C = tmpDir("cc-hist-c-");
process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || DIR_A;
const store = await import("../server/store.js");
const A = store.newContext("local", new store.FileStore(DIR_A));
const B = store.newContext("local", new store.FileStore(DIR_B));
const C = store.newContext("local", new store.FileStore(DIR_C));
store.setDefaultContext(A);
const I = await import("../server/history-import.js");
const Y = await import("../server/history-sync.js");
const K = await import("../web/sync-crypto.js");
const as = (c, fn) => store.runAs(c, fn);
const missions = (dir) => fs.readdirSync(path.join(dir, "missions")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, "missions", f), "utf8")));

test("ChatGPT export zip: titles, dates and the visible thread intact; edited branch, system and tool turns left out", () => {
  const p = I.parseExport(chatgptZip());
  assert.equal(p.source, "chatgpt");
  assert.equal(p.conversations.length, 2);
  assert.equal(p.skipped, 1); // the entry without a mapping
  const [a, b] = p.conversations;
  assert.equal(a.title, "Tagline ideas for a bakery");
  assert.equal(a.createdAt, 1760000000123); // seconds with fractions -> ms
  assert.equal(a.updatedAt, 1760000600500);
  assert.deepEqual(a.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(a.messages[0].text, "Give me three taglines for a sourdough bakery called Crumb & Co.");
  assert.equal(a.messages[1].text, "1. Slow dough, fast smiles.\n2. Wild yeast, warm hearts.\n3. Crumb & Co: worth the wait.");
  assert.equal(a.messages[1].model, "gpt-4o");
  assert.equal(a.messages[2].text, "[image]\n\nMake the second one punchier, here is our logo.");
  assert.equal(a.messages[1].at, 1760000005000);
  assert.ok(!JSON.stringify(p).includes("DROPPED BRANCH") && !JSON.stringify(p).includes("tool output"));
  assert.match(b.messages[1].text, /^```\nfor i, item in enumerate\(x\):/);
  assert.equal(b.messages[1].model, "o3");

  const r = as(A, () => I.fileChats(p, { projectId: "new", makeProject: (name) => (assert.equal(name, "Imported from ChatGPT"), "imp-proj"), findProject: () => null }));
  assert.equal(r.added, 2);
  const saved = missions(DIR_A).find((m) => m.title === "Tagline ideas for a bakery");
  assert.equal(saved.kind, "imported");
  assert.equal(saved.projectId, "imp-proj");
  assert.equal(saved.startedAt, 1760000000123);
  assert.equal(saved.finishedAt, 1760000600500);
  assert.deepEqual(saved.messages, a.messages);
  assert.match(saved.deliverable, /\*\*You\*\*[\s\S]*Crumb & Co: worth the wait/);
  // the same export again adds nothing; a newer copy of one chat updates only that chat
  assert.equal(as(A, () => I.fileChats(I.parseExport(chatgptZip()), { projectId: "new", makeProject: () => "imp-proj" })).unchanged, 2);
  const list = JSON.parse(fixture("chatgpt"));
  list[1].update_time += 100; list[1].mapping.b2.message.content.text = "for i, item in enumerate(x): pass";
  const r3 = as(A, () => I.fileChats(I.parseExport(makeZip([{ name: "conversations.json", data: JSON.stringify(list) }])), { projectId: "new", makeProject: () => "imp-proj" }));
  assert.deepEqual([r3.added, r3.updated, r3.unchanged], [0, 1, 1]);
  assert.equal(missions(DIR_A).filter((m) => m.kind === "imported").length, 2);
});

test("Claude export zip: names, ISO dates, content blocks, attachments, projects; folder and stored entries read", () => {
  const p = I.parseExport(claudeZip());
  assert.equal(p.source, "claude");
  assert.equal(p.conversations.length, 3);
  const [a, b, c] = p.conversations;
  assert.equal(a.title, "Quarterly plan outline");
  assert.equal(a.createdAt, Date.parse("2026-09-01T14:00:00Z"));
  assert.equal(a.projectName, "Studio ops");
  assert.deepEqual(a.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(a.messages[0].text, "Outline a quarterly plan for a two-person studio.\n\n[attached: goals.txt]");
  assert.equal(a.messages[1].text, "Month 1: pipeline. Month 2: delivery. Month 3: review and pricing.\n\n[used a tool: web_search]");
  assert.equal(a.messages[2].text, "Shorter, please. Ünïcode check: café, 東京, emoji 🍞.");
  assert.equal(b.title, "Untitled chat");
  assert.equal(c.messages.length, 0);
  const made = [];
  const r = as(A, () => I.fileChats(p, { projectId: "new", makeProject: (n) => { made.push(n); return `p${made.length}`; }, findProject: () => null }));
  assert.deepEqual([r.added, r.empty], [2, 1]);
  assert.deepEqual(made, ["Studio ops (from Claude)", "Imported from Claude"]);
  const saved = missions(DIR_A).find((m) => m.title === "Quarterly plan outline");
  assert.equal(saved.messages[2].text, "Shorter, please. Ünïcode check: café, 東京, emoji 🍞.");
  // a project the tier does not allow: imported without a project, with a note
  const p2 = I.parseExport(makeZip([{ name: "conversations.json", data: JSON.stringify([{ ...JSON.parse(fixture("claude"))[1], uuid: "other" }]) }]));
  const r2 = as(A, () => I.fileChats(p2, { projectId: "new", makeProject: () => { throw new Error("Free includes 1 project."); } }));
  assert.equal(r2.added, 1);
  assert.match(r2.notes[0], /Free includes 1 project\. The chats were imported without a project/);
});

test("bad files fail with a clear message, never a stack trace", () => {
  const conv = fixture("claude");
  const full = makeZip([{ name: "conversations.json", data: conv }]);
  const cases = [
    [Buffer.from("this is a text file, not a zip at all"), "not_zip", /not a zip file\. Pick the export \.zip/],
    [Buffer.alloc(0), "empty", /empty/],
    [full.subarray(0, full.length - 30), "truncated_zip", /cut off/],
    [makeZip([{ name: "photos/a.jpg", data: "x" }]), "no_conversations", /no conversations\.json in this zip/],
    [makeZip([{ name: "conversations.json", data: "{ not json" }]), "bad_json", /not valid JSON/],
    [makeZip([{ name: "conversations.json", data: '{"a":1}' }]), "unknown_format", /does not hold a list/],
    [makeZip([{ name: "conversations.json", data: '[{"foo":1}]' }]), "unknown_format", /not in the ChatGPT or Claude format/],
    [makeZip([{ name: "conversations.json", data: conv, encrypted: true }]), "encrypted_zip", /password protected/],
  ];
  // a deflate stream that is corrupt
  const broken = makeZip([{ name: "conversations.json", data: conv }]); broken.fill(0xff, 40, 60);
  cases.push([broken, "broken_zip", /damaged/]);
  for (const [buf, code, msg] of cases) {
    assert.throws(() => I.parseExport(buf), (e) => e.status === 400 && e.code === code && msg.test(e.message) && !/at .*\.js/.test(e.message), code);
  }
});

test("sync: the cloud holds ciphertext only, and it opens on a second client with the same passphrase only", async () => {
  const db = new MockSyncDb();
  Y.setTransport(db.transport());
  const PASS = "correct horse battery staple";
  // client A: a normal chat and the imported chats from the first tests
  const own = { id: "s-own1", kind: "single", prompt: "Plan a launch party for Crumb & Co.", deliverable: "Secret plan: sourdough tasting at 6pm.", status: "done", startedAt: 1, finishedAt: 2, provider: "demo-nova", model: "nova-1" };
  A.store.saveMission(own);
  await assert.rejects(as(A, () => Y.setup({ passphrase: "short" })), /at least 10 characters/);
  const setup = await as(A, () => Y.setup({ passphrase: PASS, remember: false }));
  assert.ok(K.validCode(setup.code));
  const r1 = await as(A, () => Y.syncNow());
  const nA = missions(DIR_A).filter((m) => ["single", "imported"].includes(m.kind)).length;
  assert.equal(r1.result.pushed, nA);
  assert.equal(db.items.size, nA);

  // everything the server holds: no titles, text, chat ids or passphrase, in the clear or base64-decoded
  const space = db.spaces.get(setup.code);
  const held = JSON.stringify([...db.spaces.values(), ...db.items.values()]);
  const heldDecoded = [...db.items.values()].map((r) => Buffer.from(r.blob, "base64").toString("latin1")).join("|") + Buffer.from(space.check_blob, "base64").toString("latin1");
  for (const secret of [PASS, "Crumb & Co", "Secret plan", "sourdough", "Quarterly plan outline", "Tagline ideas", "s-own1", "imp-", "gpt-4o"]) {
    assert.ok(!held.includes(secret), `server row contains ${secret}`);
    assert.ok(!heldDecoded.includes(secret), `decoded blob contains ${secret}`);
  }
  assert.ok([...db.items.values()].every((r) => /^[0-9a-f]{40}$/.test(r.item) && Buffer.from(r.blob, "base64").subarray(0, 2).toString() === "v1"));
  assert.equal(space.token_hash.length, 64); // only a hash of the token
  assert.ok(!db.calls.some((c) => JSON.stringify(c.args).includes(PASS)));

  // client B, same code and passphrase: every chat arrives with the same text
  const joined = await as(B, () => Y.setup({ passphrase: PASS, code: setup.code.toLowerCase().replace(/-/g, " "), remember: false }));
  assert.equal(joined.code, setup.code);
  const r2 = await as(B, () => Y.syncNow());
  assert.equal(r2.result.pulled, nA);
  const got = missions(DIR_B);
  const mine = got.find((m) => m.id === "s-own1");
  assert.equal(mine.messages[1].text, "Secret plan: sourdough tasting at 6pm.");
  assert.equal(mine.title, "Plan a launch party for Crumb & Co.");
  const qp = got.find((m) => m.title === "Quarterly plan outline");
  assert.equal(qp.messages[2].text, "Shorter, please. Ünïcode check: café, 東京, emoji 🍞.");
  assert.equal(qp.startedAt, Date.parse("2026-09-01T14:00:00Z"));
  // B does not send A's chats back, and a second round moves nothing
  const r3 = await as(B, () => Y.syncNow());
  assert.deepEqual([r3.result.pushed, r3.result.pulled], [0, 0]);
  // a chat made on B reaches A
  B.store.saveMission({ id: "s-fromb", kind: "single", prompt: "Hello from the phone", deliverable: "Hi back", status: "done", startedAt: 5, finishedAt: 6 });
  assert.equal((await as(B, () => Y.syncNow())).result.pushed, 1);
  assert.equal((await as(A, () => Y.syncNow())).result.pulled, 1);
  assert.equal(missions(DIR_A).find((m) => m.id === "s-fromb").messages[0].text, "Hello from the phone");

  // client C, wrong passphrase: refused before anything is pulled
  await assert.rejects(as(C, () => Y.setup({ passphrase: "wrong passphrase entirely", code: setup.code, remember: false })), (e) => e.code === "wrong_passphrase" && e.status === 401);
  // a key from the wrong passphrase cannot open a blob, and the service refuses its token
  const wrong = await K.keysFromRaw(await K.deriveRaw("wrong passphrase entirely", space.salt, space.kdf));
  const row = [...db.items.values()][0];
  await assert.rejects(K.open(wrong, row.blob, row.item), /wrong passphrase/);
  await assert.rejects(db.transport()("cc_sync_pull", { p_space: setup.code, p_token: wrong.token, p_since: 0, p_limit: 10 }), (e) => e.code === "bad_token");
  // the right key, but the blob moved to another row: refused (AAD binds it to its item id)
  const right = await K.keysFromRaw(await K.deriveRaw(PASS, space.salt, space.kdf));
  assert.ok(await K.open(right, row.blob, row.item));
  await assert.rejects(K.open(right, row.blob, "0".repeat(40)), /wrong passphrase, or the data was changed/);
  // a code nobody made
  await assert.rejects(as(C, () => Y.setup({ passphrase: PASS, code: "AAAAA-BBBBB-CCCCC-DDDDD", remember: false })), (e) => e.code === "no_space");
  // turning off with delete empties the space
  await as(A, () => Y.turnOff({ deleteRemote: true }));
  assert.equal(db.spaces.size, 0); assert.equal(db.items.size, 0);
  assert.equal(as(A, () => Y.status()).enabled, false);
  Y.setTransport(null);
});

test("real server: zip upload, preview, import into a project, refusals; sync between two app copies via a local Supabase stand-in", async () => {
  const db = new MockSyncDb();
  const s1 = await startServer({ cloud: { rpc: db.stubRpc() } });
  const s2 = await startServer({ cloud: { rpc: db.stubRpc() } });
  try {
    const up = async (srv, buf, ct = "application/zip") => {
      const r = await fetch(`${srv.base}/api/history/preview`, { method: "POST", headers: { "content-type": ct, "x-cc-token": srv.token }, body: buf });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    // raw upload of the zip bytes
    const pv = await up(s1, chatgptZip());
    assert.equal(pv.status, 200, pv.text);
    assert.equal(pv.json.source, "chatgpt"); assert.equal(pv.json.conversations, 2); assert.equal(pv.json.messages, 6);
    assert.equal(pv.json.sample[0].title, "Fix a Python loop");
    // nothing filed before Import
    assert.ok(!(await s1.api("/missions")).json.some((m) => m.kind === "imported"));
    // without the session token: refused
    assert.equal((await raw({ port: s1.port, method: "POST", path: "/api/history/preview", headers: { "content-type": "application/zip" }, body: "PK" })).status, 401);
    // bad zip: a clear message
    const bad = await up(s1, Buffer.from("not a zip"));
    assert.equal(bad.status, 400); assert.match(bad.json.error, /not a zip file/);
    // other routes still refuse non-JSON bodies
    assert.equal((await s1.api("/history/import", { headers: { "content-type": "application/zip" }, method: "POST", body: "x" })).status, 415);
    // by path; the app's data folder is refused
    const zp = path.join(s1.dir, "..", `cc-hist-export-${process.pid}.zip`); fs.writeFileSync(zp, claudeZip());
    const pv2 = await s1.api("/history/preview", { method: "POST", body: { path: zp } });
    fs.rmSync(zp, { force: true });
    assert.equal(pv2.status, 200, pv2.text); assert.equal(pv2.json.source, "claude"); assert.deepEqual(pv2.json.projects, ["Studio ops"]);
    assert.equal((await s1.api("/history/preview", { method: "POST", body: { path: path.join(s1.dir, "settings.json") } })).json.code, "data_folder");
    assert.equal((await s1.api("/history/preview", { method: "POST", body: { path: "relative.zip" } })).status, 400);
    // import into the existing project
    const projects = (await s1.api("/state")).json.projects;
    const imp = await s1.api("/history/import", { method: "POST", body: { token: pv.json.token, projectId: projects[0].id } });
    assert.equal(imp.status, 200, imp.text); assert.equal(imp.json.added, 2);
    assert.equal((await s1.api("/history/import", { method: "POST", body: { token: pv.json.token } })).status, 410); // a preview is used once
    const list = (await s1.api("/missions")).json.filter((m) => m.kind === "imported");
    assert.equal(list.length, 2);
    assert.ok(list.every((m) => m.projectId === projects[0].id));
    const one = (await s1.api(`/missions/${list.find((m) => m.title === "Tagline ideas for a bakery").id}`)).json;
    assert.equal(one.messages.length, 4); assert.equal(one.startedAt, 1760000000123);
    // "new project" on Free (one project already): imported without a project, with the note
    const imp2 = await s1.api("/history/import", { method: "POST", body: { token: pv2.json.token, projectId: "new" } });
    assert.equal(imp2.json.added, 2); assert.match(imp2.json.notes[0], /without a project/);
    assert.equal((await s1.api("/history")).json.imported, 4);

    // sync is off by default
    assert.equal((await s1.api("/history/sync")).json.enabled, false);
    assert.equal((await s1.api("/history/sync/now", { method: "POST" })).status, 400);
    const on = await s1.api("/history/sync/setup", { method: "POST", body: { passphrase: "a long shared passphrase", remember: false } });
    assert.equal(on.status, 200, on.text);
    const now1 = await s1.api("/history/sync/now", { method: "POST" });
    assert.equal(now1.status, 200, now1.text); assert.equal(now1.json.result.pushed, 4);
    const held = JSON.stringify([...db.items.values()]);
    for (const t of ["Tagline", "Crumb", "Quarterly", "a long shared passphrase"]) assert.ok(!held.includes(t));
    assert.ok(s1.stub.hits.filter((h) => h.path.startsWith("/rest/v1/rpc/cc_sync_")).every((h) => !JSON.stringify(h.body).includes("Crumb")));
    // second copy: wrong passphrase refused, right one pulls the chats
    assert.equal((await s2.api("/history/sync/setup", { method: "POST", body: { passphrase: "not the same passphrase", code: on.json.code, remember: false } })).status, 401);
    assert.equal((await s2.api("/history/sync/setup", { method: "POST", body: { passphrase: "a long shared passphrase", code: on.json.code, remember: false } })).status, 200);
    const now2 = await s2.api("/history/sync/now", { method: "POST" });
    assert.equal(now2.json.result.pulled, 4);
    const there = (await s2.api("/missions")).json.find((m) => m.title === "Quarterly plan outline");
    assert.ok(there);
    assert.equal((await s2.api(`/missions/${there.id}`)).json.messages[3].text, "Pipeline, delivery, review.");
  } finally { await s1.stop(); await s2.stop(); }
});
