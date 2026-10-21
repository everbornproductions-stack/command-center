// Refocus search: local roots from a temp home, category words, file text, Claude sessions,
// Grok Bot and other AI history, the "searched" list, and the Find button busy state.
// Temp folders only. The real home, real drives, and data/ are never read. No real URL is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";
import { localRoots, searchFiles, searchClaudeSessions, claudeSessionDirs, expandQuery, rank } from "../server/refocus-search.js";
import { assemble, fromGrokJob, fromHandoff, fromRun, publicItem } from "../server/refocus.js";

const EM = String.fromCharCode(0x2014);

function put(file, text = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// A fake PC: a home folder, a fake G: drive with "My Drive", and an app data folder that must stay unread.
function seedPc() {
  const base = tmpDir("cc-refocus-pc-");
  const home = path.join(base, "home");
  const g = path.join(base, "G");
  put(path.join(home, "Documents", "pulseb-notes.txt"), "Ideas for the launch.");
  put(path.join(home, "Videos", "I Loved You in the Dark.mp4"));
  put(path.join(home, "Downloads", "Snap That Credit (final).mov"));
  put(path.join(g, "My Drive", "Releases", "Lovergirl Fabulous.webm"));
  put(path.join(home, "Downloads", "SCF invoice March.pdf"));
  fs.mkdirSync(path.join(home, "Documents", "Clients", "HighLevel"), { recursive: true });
  put(path.join(home, "Desktop", "notes from tuesday.txt"), "Call the bank about the billing cycle for the shop.");
  put(path.join(home, "Desktop", "grocery list.txt"), "milk, eggs, bread");
  put(path.join(home, "OneDrive - Everborn", "Plans", "roadmap.md"), "Next quarter.");
  put(path.join(home, "GoogleDrive-chris@example.com", "My Drive", "shared.txt"), "hello");
  put(path.join(home, "Documents", "Claude", "pulseb plan.md"), "Pulse B outline.");
  put(path.join(home, "Documents", "node_modules", "pulseb-hidden.txt"), "skip me");
  const dataDir = path.join(home, "Documents", "AppData-copy");
  put(path.join(dataDir, "pulseb-secret.txt"), "never read");
  put(path.join(home, ".claude", "projects", "C--work-shop", "abc.jsonl"), [
    JSON.stringify({ type: "user", message: { role: "user", content: "Set up billing reminders for the shop" } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here is the billing reminder plan." }] } }),
  ].join("\n"));
  return { base, home, g, dataDir };
}

test("local roots come from the injected home, env, and drive list", () => {
  const pc = seedPc();
  try {
    const roots = localRoots({ home: pc.home, env: {}, drives: [pc.g], projectDirs: [path.join(pc.home, "Documents", "Clients")] });
    const labels = roots.map((r) => r.label);
    for (const want of ["Videos", "Downloads", "Desktop", "Documents", "OneDrive - Everborn", "Google Drive", "Documents/Claude"]) {
      assert.ok(labels.includes(want), `${want} in ${labels.join(", ")}`);
    }
    assert.ok(roots.some((r) => r.path === path.join(pc.g, "My Drive") && r.kind === "cloud"), "a drive with My Drive is a Google Drive root");
    assert.ok(roots.some((r) => r.kind === "project"), "project folders are roots");
    assert.equal(roots.find((r) => r.label === "Documents/Claude").madeBy, "Claude");
    assert.ok(!roots.some((r) => r.path === pc.home), "the whole home folder is only searched in the wider scope");
    const wide = localRoots({ home: pc.home, env: {}, drives: [pc.g], wide: true });
    assert.ok(wide.some((r) => r.path === pc.home));
    assert.ok(wide.some((r) => r.path === path.resolve(pc.g)));
    const viaEnv = localRoots({ env: { CC_REFOCUS_HOME: pc.home, CC_REFOCUS_DRIVES: pc.g } });
    assert.ok(viaEnv.some((r) => r.path === path.join(pc.g, "My Drive")));
    assert.deepEqual(claudeSessionDirs({ home: pc.home }), [path.join(pc.home, ".claude", "projects")]);
  } finally { fs.rmSync(pc.base, { recursive: true, force: true }); }
});

test("query words expand: music videos, billing, and plain words", () => {
  const mv = expandQuery("music videos");
  assert.deepEqual(mv.map((g) => g.word), ["music", "videos"]);
  assert.ok(mv[0].types.includes("audio") && mv[0].types.includes("video"));
  assert.ok(mv[1].alts.includes("mv") && mv[1].alts.includes("lyric"));
  const bill = expandQuery("billing").map((g) => g.alts)[0];
  for (const w of ["invoice", "receipt", "payment", "square", "highlevel", "subscription"]) assert.ok(bill.includes(w), w);
  assert.deepEqual(expandQuery("the pulseb").map((g) => g.word), ["pulseb"]);
  assert.deepEqual(expandQuery("the").map((g) => g.word), ["the"], "a query of only common words still searches");
});

test("files: pulseb, music videos, and billing are found by name, folder, and text", async () => {
  const pc = seedPc();
  try {
    const roots = localRoots({ home: pc.home, env: {}, drives: [pc.g] });
    const find = (topic) => searchFiles({ topic, roots, dataDir: pc.dataDir });

    const pulse = await find("pulseb");
    const pulseNames = pulse.items.map((i) => i.title);
    assert.ok(pulseNames.includes("pulseb-notes.txt"), pulseNames.join(", "));
    assert.ok(pulseNames.includes("pulseb plan.md"));
    assert.equal(pulse.items.find((i) => i.title === "pulseb plan.md").madeBy, "Claude");
    assert.equal(pulse.items.find((i) => i.title === "pulseb-notes.txt").madeBy, "This PC");
    assert.ok(!pulseNames.includes("pulseb-hidden.txt"), "node_modules is skipped");
    assert.ok(!pulseNames.includes("pulseb-secret.txt"), "the app data folder is never read");
    assert.equal(pulse.items.filter((i) => i.title === "pulseb plan.md").length, 1, "a nested root is walked once");

    const mv = await find("music videos");
    const mvNames = mv.items.map((i) => i.title);
    for (const n of ["I Loved You in the Dark.mp4", "Snap That Credit (final).mov", "Lovergirl Fabulous.webm"]) assert.ok(mvNames.includes(n), `${n} in ${mvNames.join(", ")}`);
    assert.ok(!mvNames.includes("grocery list.txt"));
    assert.ok(mv.items.find((i) => i.title === "Lovergirl Fabulous.webm").where.startsWith("Google Drive"));

    const bill = rank((await find("billing")).items);
    const billNames = bill.map((i) => i.title);
    assert.ok(billNames.includes("SCF invoice March.pdf"), billNames.join(", "));
    const folder = bill.find((i) => i.title === "HighLevel");
    assert.ok(folder, "the HighLevel folder is found");
    assert.equal(folder.fileType, "folder");
    assert.ok(billNames.includes("notes from tuesday.txt"), "a text file that mentions billing is found by its text");
    assert.ok(!billNames.includes("grocery list.txt"));

    const none = await find("zzqxv");
    assert.equal(none.items.length, 0);
    assert.ok(none.searched.length >= 5);
    for (const row of none.searched) { assert.equal(typeof row.place, "string"); assert.equal(row.count, 0); }
  } finally { fs.rmSync(pc.base, { recursive: true, force: true }); }
});

test("Claude sessions, Grok Bot, other agents, and chat history carry who made them", async () => {
  const pc = seedPc();
  try {
    const sessions = await searchClaudeSessions({ topic: "billing", dirs: claudeSessionDirs({ home: pc.home }) });
    assert.equal(sessions.items.length, 1);
    assert.equal(sessions.items[0].madeBy, "Claude");
    assert.match(sessions.items[0].title, /billing reminders/);

    const grok = fromGrokJob({ id: "g1", task: "Collect billing receipts", status: "done", text: "Saved to https://drive.google.com/drive/folders/abc123.", artifacts: [{ name: "receipts.pdf", url: "https://drive.google.com/file/d/xyz/view" }], updatedAt: 5 });
    assert.equal(grok.madeBy, "Grok Bot");
    assert.deepEqual(grok.links, ["https://drive.google.com/drive/folders/abc123", "https://drive.google.com/file/d/xyz/view"]);
    const cursor = fromHandoff({ agent: "cursor", name: "Cursor", jobId: "c1", status: "reported", task: "Fix the invoice page", result: "Done" });
    assert.equal(cursor.madeBy, "Cursor");
    const chat = fromRun({ id: "imp1", kind: "imported", source: "chatgpt", title: "Square billing questions", status: "done", updatedAt: 9, messages: [{ role: "assistant", text: "Use invoices." }] });
    assert.equal(chat.madeBy, "ChatGPT");

    const found = assemble({ runs: [chat], ai: [grok, cursor, ...sessions.items], topic: "billing" });
    const by = Object.fromEntries(found.results.map((r) => [r.id, publicItem(r).madeBy]));
    assert.equal(by.imp1, "ChatGPT");
    assert.equal(by["grokbot:g1"], "Grok Bot");
    assert.equal(by["agent:cursor:c1"], "Cursor");
    assert.equal(Object.values(by).filter((v) => v === "Claude").length, 1);
    assert.equal(publicItem(found.results.find((r) => r.id === "grokbot:g1")).links.length, 2);
  } finally { fs.rmSync(pc.base, { recursive: true, force: true }); }
});

function seedLicense(dir, tier) {
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier, status: "active", lastOkAt: now, checkedAt: now, lastError: null, email: "t@example.com" }));
}

test("find route: this PC, chat history, Grok Bot, and the searched list when nothing is found", { timeout: 60000 }, async () => {
  const pc = seedPc();
  const s = await startServer({
    env: { CC_REFOCUS_HOME: pc.home, CC_REFOCUS_DRIVES: pc.g },
    seed: (dir) => {
      seedLicense(dir, "pro");
      fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
      fs.writeFileSync(path.join(dir, "missions", "imp-claude.json"), JSON.stringify({
        id: "imp-claude", kind: "imported", source: "claude", title: "Billing follow-up", status: "done", updatedAt: 1000, startedAt: 1000,
        messages: [{ role: "user", text: "How do I chase late billing?" }, { role: "assistant", text: "Send a friendly billing reminder." }],
      }));
      fs.writeFileSync(path.join(dir, "grokbot.jobs.json"), JSON.stringify([
        { id: "gb-1", task: "Pull the March billing receipts", status: "done", text: "Uploaded to https://drive.google.com/drive/folders/march", artifacts: [], createdAt: 2000, updatedAt: 2000 },
      ]));
    },
  });
  try {
    for (const demo of [false, true]) {
      await s.api("/demo", { method: "POST", body: { on: demo } });
      const pulse = await s.api("/refocus/find", { method: "POST", body: { topic: "pulseb" } });
      assert.equal(pulse.status, 200, pulse.text);
      assert.ok(pulse.json.items.some((i) => i.title === "pulseb-notes.txt" && i.madeBy === "This PC"), `demo ${demo}: ${pulse.text.slice(0, 400)}`);
    }
    const mv = await s.api("/refocus/find", { method: "POST", body: { topic: "music videos" } });
    const mvNames = mv.json.items.map((i) => i.title);
    for (const n of ["I Loved You in the Dark.mp4", "Snap That Credit (final).mov", "Lovergirl Fabulous.webm"]) assert.ok(mvNames.includes(n), n);

    const bill = await s.api("/refocus/find", { method: "POST", body: { topic: "billing" } });
    assert.equal(bill.status, 200, bill.text);
    const titles = bill.json.items.map((i) => i.title);
    for (const n of ["SCF invoice March.pdf", "HighLevel", "notes from tuesday.txt"]) assert.ok(titles.includes(n), `${n} in ${titles.join(", ")}`);
    const claudeChat = bill.json.items.find((i) => i.id === "imp-claude");
    assert.ok(claudeChat, "the imported Claude chat is found through the store");
    assert.equal(claudeChat.madeBy, "Claude");
    const grok = bill.json.items.find((i) => i.id === "grokbot:gb-1");
    assert.ok(grok, "the Grok Bot result is found");
    assert.equal(grok.madeBy, "Grok Bot");
    assert.deepEqual(grok.links, ["https://drive.google.com/drive/folders/march"]);
    assert.ok(bill.json.items.some((i) => i.madeBy === "Claude" && /billing reminders/.test(i.title)), "the Claude Code session is found");
    assert.equal(bill.json.results.length, bill.json.items.length);
    assert.equal(bill.json.count, bill.json.items.length);
    assert.equal(bill.json.sent, false);
    for (const i of bill.json.items) assert.equal(i.text, undefined);

    const none = await s.api("/refocus/find", { method: "POST", body: { topic: "zzqxv" } });
    assert.equal(none.status, 200);
    assert.deepEqual(none.json.items, []);
    assert.ok(Array.isArray(none.json.searched) && none.json.searched.length >= 6);
    const places = none.json.searched.map((r) => r.place);
    for (const p of ["Chats and missions in Meldmind", "Grok Bot results", "Videos", "Downloads", "Claude Code sessions"]) assert.ok(places.includes(p), `${p} in ${places.join(", ")}`);
    assert.ok(places.some((p) => p.startsWith("Google Drive (")));
    for (const r of none.json.searched) assert.equal(r.count, 0);
    assert.match(s.log, /\[refocus\] nothing found for "zzqxv"/);

    const wide = await s.api("/refocus/find", { method: "POST", body: { topic: "zzqxv", wide: true } });
    assert.equal(wide.json.wide, true);
    assert.ok(wide.json.searched.some((r) => r.place === "Home folder"));
  } finally {
    await s.stop();
    fs.rmSync(pc.base, { recursive: true, force: true });
  }
});

test("the Refocus page wires the Find button busy state and the nothing-found places", () => {
  const src = fs.readFileSync(path.join(ROOT, "web", "features", "refocus.js"), "utf8");
  assert.match(src, /function setBusy\(btn, on\)/);
  assert.match(src, /btn\.disabled = on/);
  assert.match(src, /classList\.toggle\("busy", on\)/);
  assert.match(src, /btn\.textContent = "Searching\.\.\."/);
  assert.match(src, /spinner/);
  assert.match(src, /setBusy\(btn, true\)[\s\S]*api\("\/refocus\/find"[\s\S]*setBusy\(btn, false\)/);
  assert.match(src, /Found \$\{n\} item/);
  assert.match(src, /Nothing found\. Here's where I looked: /);
  assert.match(src, /Search more places/);
  assert.match(src, /find\(view, \{ wide: true \}\)/);
  assert.match(src, /madeByChip/);
  for (const rel of ["web/features/refocus.js", "server/refocus-search.js", "server/refocus.js", "server/plugins/refocus.js", "test/refocus-search.test.js"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, rel), "utf8").includes(EM), false, rel);
  }
});
