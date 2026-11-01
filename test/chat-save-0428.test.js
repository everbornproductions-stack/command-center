// 0.4.28 (persona panel item 2): a plain chat / single answer that names a file saves it, on every plan.
// "Write a week of posts... Save them as posts.md" from Simple chat or Expert Command in Single mode used to be a single
// answer with no file, no folder copy and no word about it. Now the finished answer goes through the same savers as a
// mission (server/save-named-files.js), says "Saved posts.md in ..." or "Not saved: ...", and the run keeps savedFile
// and askedFolder in the mission shape. Real server, demo AIs only, no key, nothing sent.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, chatRunId, runSettled, waitBudget, tmpDir, ROOT } from "./helpers.js";
import { saveFilesFromAnswer } from "../server/save-named-files.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function finished(s, id) {
  const t0 = Date.now(), done = runSettled(id);
  while (Date.now() - t0 < waitBudget(30000)) {
    if (done((await s.api("/state")).json)) return (await s.api(`/missions/${id}`)).json;
    await sleep(200);
  }
  throw new Error(`chat ${id} did not finish:\n${s.log.slice(-2000)}`);
}
const ATLAS = { provider: "demo-atlas", model: "atlas-pro" };
async function demoServer(opts) {
  const s = await startServer(opts);
  assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).json.demo, true);
  return s;
}

// ---------- the helper on its own ----------
test("the helper saves nothing and changes nothing when the prompt names no file", () => {
  assert.equal(saveFilesFromAnswer({ prompt: "Write a week of posts for my bakery", answer: "Monday: bread." }), null);
});

test("the helper saves the named file, strips the AI's own save claim and adds the app line", () => {
  const calls = [];
  const dir = tmpDir("chatsave-unit-");
  const save = ({ name, text }) => { const p = path.join(dir, name); fs.writeFileSync(p, text); calls.push(name); return { ok: true, name, requested: name, path: p, bytes: Buffer.byteLength(text), ext: "md" }; };
  const r = saveFilesFromAnswer({ prompt: "Write a week of posts. Save them as posts.md", answer: "Monday: bread.\nSaved as posts.md in your folder.\n", save });
  assert.deepEqual(calls, ["posts.md"]);
  assert.equal(r.savedFile.ok, true);
  assert.doesNotMatch(r.deliverable, /Saved as posts\.md in your folder/);
  assert.match(r.deliverable, /Saved posts\.md in your project folder: /);
  assert.equal(r.askedFolder, null);
  // a code file with no code in the answer is never saved from prose
  const code = saveFilesFromAnswer({ prompt: "Write the script and save it as tidy.py", answer: "First, read the file. Then tidy it.", save });
  assert.equal(code.savedFile.ok, false);
  assert.match(code.deliverable, /Not saved: there was no code for tidy\.py/);
  assert.equal(calls.length, 1, "prose is never saved as code");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("no em-dashes in the new user-facing lines", () => {
  assert.equal(fs.readFileSync(path.join(ROOT, "server", "save-named-files.js"), "utf8").includes("\u2014"), false);
  const src = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
  const fn = src.slice(src.indexOf("function saveChatFiles("), src.indexOf("onSlotAnswer(\"single\""));
  assert.ok(fn.length > 100 && !fn.includes("\u2014"));
});

// ---------- the real server, demo AIs, Free plan ----------
test("a chat that names posts.md saves it in the project folder, says so, and never overwrites (Free plan)", async () => {
  const s = await demoServer();
  try {
    // this server is on the Free plan: missions are Pro, saving a file from a single answer is not
    const mission = await s.api("/mission", { method: "POST", body: { goal: "Plan a launch" } });
    assert.equal(mission.status, 402, "missions stay Pro");

    const prompt = "Write a week of Instagram posts for my bakery. Save them as posts.md";
    const m = await finished(s, await chatRunId(s.api, { prompt }));
    assert.equal(m.status, "done");
    assert.equal(m.savedFile?.ok, true, JSON.stringify(m.savedFile));
    assert.equal(m.savedFile.name, "posts.md");
    const media = path.join(s.dir, "projects", "unfiled", "media");
    assert.equal(path.dirname(m.savedFile.path), media, "saved in the project media folder");
    assert.ok(fs.statSync(m.savedFile.path).size > 20, "the file is on the disk");
    assert.match(fs.readFileSync(m.savedFile.path, "utf8"), /bakery/);
    assert.match(m.deliverable, /Saved posts\.md in .*posts\.md/);
    assert.equal(m.savedFiles.length, 1);

    // the same chat again: posts-2.md, the first file is kept
    const m2 = await finished(s, await chatRunId(s.api, { prompt }));
    assert.equal(m2.savedFile.name, "posts-2.md");
    assert.ok(fs.existsSync(path.join(media, "posts.md")) && fs.existsSync(path.join(media, "posts-2.md")));

    // a chat without a file name saves nothing and adds no line
    const before = fs.readdirSync(media).length;
    const plain = await finished(s, await chatRunId(s.api, { prompt: "Write a week of Instagram posts for my bakery" }));
    assert.equal(plain.status, "done");
    assert.equal(plain.savedFile ?? null, null);
    assert.equal(plain.askedFolder ?? null, null);
    assert.doesNotMatch(plain.deliverable, /Saved |Not saved/);
    assert.equal(fs.readdirSync(media).length, before);

    // a private chat saves the same way and stays marked private
    const priv = await finished(s, await chatRunId(s.api, { prompt: "Write a short note for my bakery. Save it as note.md", private: true }));
    assert.equal(priv.private, true);
    assert.equal(priv.savedFile?.ok, true);
  } finally { await s.stop(); }
});

test("a chat answer with a markdown table makes a real spreadsheet", async () => {
  const s = await demoServer();
  try {
    const m = await finished(s, await chatRunId(s.api, { ...ATLAS, prompt: "Make a 4 week plan for my bakery launch and save it as plan.xlsx" }));
    assert.equal(m.savedFile?.ok, true, JSON.stringify(m.savedFile) + "\n" + m.deliverable);
    assert.equal(m.savedFile.name, "plan.xlsx");
    const buf = fs.readFileSync(m.savedFile.path);
    assert.equal(buf.subarray(0, 2).toString("latin1"), "PK", "a real zip, not text with an .xlsx name");
    assert.ok(buf.includes(Buffer.from("xl/worksheets/sheet1.xml")), "it has a worksheet");
  } finally { await s.stop(); }
});

test("a chat that names a folder in the home folder copies the file there", { skip: process.platform !== "win32" ? "Windows paths only" : false }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "chatsave-home-"));
  const s = await demoServer({ env: { USERPROFILE: home, HOME: home } });
  try {
    const folder = path.join(home, "Desktop", "menus");
    const m = await finished(s, await chatRunId(s.api, { prompt: `Write a short menu for my bakery and save it as menu.md in ${folder}` }));
    assert.equal(m.savedFile?.ok, true, JSON.stringify(m.savedFile));
    assert.equal(m.askedFolder?.folder.toLowerCase(), folder.toLowerCase());
    assert.equal(path.dirname(m.savedFile.copiedTo).toLowerCase(), folder.toLowerCase());
    assert.ok(fs.statSync(path.join(folder, "menu.md")).size > 0, "the copy is in the asked folder");
    assert.ok(fs.existsSync(m.savedFile.path), "the project copy stays");
    assert.match(m.deliverable, new RegExp(`Saved menu\\.md in ${folder.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}`, "i"));
    // a second time: menu-2.md in the folder, the first copy is kept
    const m2 = await finished(s, await chatRunId(s.api, { prompt: `Write a short menu for my bakery and save it as menu.md in ${folder}` }));
    assert.equal(path.basename(m2.savedFile.copiedTo), "menu-2.md");
    assert.ok(fs.existsSync(path.join(folder, "menu.md")));
  } finally { await s.stop(); fs.rmSync(home, { recursive: true, force: true }); }
});
