// Phase 13: organize my existing browser bookmarks. Pure checks on reading, the address clean-up, the apply
// plan and the import file, then the running server against a fake home folder (CC_BROWSER_HOME: fake Chrome,
// Edge and Firefox profiles in a temp folder, a fake process list) and one local mock playing xAI. No real
// browser profile, account, URL or key is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-bookmarks-");
const B = await import("../server/bookmarks.js");
let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

const FIXTURE = path.join(ROOT, "server", "bookmarks-demo.json");
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const ofUrl = (items, re) => items.filter((i) => re.test(i.url)).map((i) => i.id);

test("reading: every bookmark with its folder path, duplicates by exact address, addresses cleaned before any AI sees them", () => {
  const items = B.flattenChromium(fixture());
  assert.equal(items.length, 30);
  const menu = items.find((i) => i.title === "Sunrise Bakery menu PDF");
  assert.equal(menu.path, "Bookmarks bar / New folder (2) / old"); assert.equal(menu.root, "bookmark_bar");
  assert.deepEqual(B.duplicates(items).map((d) => d.url).sort(), ["https://www.canva.com/", "https://www.chase.com/"]);
  assert.equal(B.cleanUrl("https://user:pw@orders.example.com/admin?token=abc#x"), "https://orders.example.com/admin");
  assert.equal(B.cleanUrl("javascript:alert(document.cookie)"), "(bookmarklet)");
  assert.equal(B.cleanUrl("chrome://settings/"), "chrome:(local page)");
  const line = B.lineFor({ id: "n9", title: "A | B\nC", url: "https://x.example/p?q=secret" });
  assert.equal(line, "n9 | A B C | https://x.example/p");
  const ini = "[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n\n[Profile1]\nName=Other\nIsRelative=0\nPath=D:\\FF\\other\n\n[Install123]\nDefault=Profiles/abc\n";
  const ps = B.parseProfilesIni(ini, "/base");
  assert.deepEqual(ps.map((p) => p.name), ["default-release", "Other"]);
  assert.equal(ps[0].dir, path.join("/base", "Profiles", "abc.default-release")); assert.equal(ps[1].dir, "D:\\FF\\other");
  assert.equal(B.cleanName("  <b>Bank</b>\n stuff  "), "b Bank /b stuff");
});

test("apply plan: only reorganizes, keeps each bookmark's own record, merges only ticked duplicates, drops the checksum", () => {
  const data = fixture();
  const items = B.flattenChromium(data);
  const d = { items };
  const bank = ofUrl(items, /chase|paypal|wellsfargo/), bakery = ofUrl(items, /sunrisebakery/);
  const unticked = items.find((i) => i.title === "Weather").id;
  // an existing folder name on the bar ("stuff") is reused instead of creating a second one
  const plan = B.checkPlan(d, { folders: [{ name: "Banking", items: bank }, { name: " Sunrise  Bakery ", items: bakery }, { name: "STUFF", items: ofUrl(items, /github/) }, { name: "", items: [] }], merge: ["https://www.chase.com/"] });
  assert.equal(plan.where, "bar"); assert.equal(plan.removeEmpty, true);
  assert.throws(() => B.checkPlan(d, { folders: [{ name: "X", items: bank }], merge: ["https://not-a-dupe.example/"] }), /Only listed duplicates/);
  assert.throws(() => B.checkPlan(d, { folders: [] }), /Nothing to apply/);
  assert.throws(() => B.checkPlan(d, { folders: [{ name: "", items: bank }] }), /needs a name/);
  const r = B.applyPlan(data, plan);
  assert.equal(r.merged, 1); assert.equal(r.moved, bank.length - 1 + bakery.length + 1);
  assert.ok(!("checksum" in r.data));
  const after = B.flattenChromium(r.data);
  assert.equal(after.length, 29, "one ticked duplicate merged, nothing else gone");
  const bar = r.data.roots.bookmark_bar.children;
  assert.deepEqual(bar.slice(0, 2).map((c) => c.name), ["Banking", "Sunrise Bakery"], "new folders first on the bar");
  assert.equal(bar.filter((c) => /^stuff$/i.test(c.name)).length, 1, "existing folder reused");
  assert.ok(bar.find((c) => c.name === "stuff").children.some((c) => c.url === "https://github.com/"));
  assert.equal(after.find((i) => i.id === unticked).path, "Other bookmarks", "an unticked bookmark stays where it was");
  // the moved node keeps its id, guid and dates
  const orig = JSON.stringify(data); const chase = JSON.parse(orig).roots.bookmark_bar.children[2].children[0];
  const moved = bar[0].children.find((c) => c.url === "https://www.chase.com/");
  assert.equal(moved.guid, chase.guid); assert.equal(moved.id, chase.id); assert.equal(moved.date_added, chase.date_added);
  // "old" was emptied by the move and is removed; "New folder (2)" still holds Facebook etc.
  assert.deepEqual(r.removedFolders, ["old"]);
  const ids = []; const walk = (n) => { ids.push(n.id); (n.children || []).forEach(walk); }; Object.values(r.data.roots).forEach(walk);
  assert.equal(new Set(ids).size, ids.length, "ids stay unique");
  assert.equal(JSON.stringify(data), orig, "the input object is not changed");
  // removeEmpty off keeps the emptied folder; "other" puts the folders under Other bookmarks
  const r2 = B.applyPlan(fixture(), B.checkPlan(d, { folders: [{ name: "Bakery", items: bakery }], removeEmpty: false, where: "other" }));
  assert.equal(r2.removedFolders.length, 0); assert.equal(r2.data.roots.other.children[0].name, "Bakery");
  // the import file: escaped, ticked items only, merged duplicates once
  const html = B.importHtml({ items: [...items, { id: "z1", title: "<x>", url: "https://e.example/?a=1&b=2" }] }, { folders: [{ name: "A&B", items: [...ofUrl(items, /chase/), "z1"] }], merge: [{ url: "https://www.chase.com/", items: ofUrl(items, /chase/) }] });
  assert.match(html, /<H3>A&amp;B<\/H3>/); assert.match(html, /HREF="https:\/\/e\.example\/\?a=1&amp;b=2">&lt;x&gt;</);
  assert.equal(html.match(/chase\.com/g).length, 1);
});

test("no em-dashes in the new user-facing files", () => {
  for (const f of ["server/bookmarks.js", "server/plugins/bookmarks.js", "web/features/bookmarks.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /—/, `${f}: no em-dashes`);
});

// ---------- a fake home folder with Chrome, Edge and Firefox ----------
function fakeHome() {
  const home = tmpDir("cc-bm-home-");
  const chrome = path.join(home, "Local", "Google", "Chrome", "User Data");
  fs.mkdirSync(path.join(chrome, "Default"), { recursive: true }); fs.mkdirSync(path.join(chrome, "Profile 1"), { recursive: true });
  fs.writeFileSync(path.join(chrome, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Work" }, "Profile 1": { name: "Home" } } } }));
  fs.copyFileSync(FIXTURE, path.join(chrome, "Default", "Bookmarks"));
  fs.writeFileSync(path.join(chrome, "Default", "Bookmarks.bak"), "chrome's own backup");
  fs.writeFileSync(path.join(chrome, "Profile 1", "Bookmarks"), JSON.stringify({ ...fixture(), sync_metadata: "c3luYw==" }, null, 3));
  const edge = path.join(home, "Local", "Microsoft", "Edge", "User Data", "Default");
  fs.mkdirSync(edge, { recursive: true }); fs.copyFileSync(FIXTURE, path.join(edge, "Bookmarks"));
  if (DatabaseSync) {
    const ff = path.join(home, "Roaming", "Mozilla", "Firefox");
    const prof = path.join(ff, "Profiles", "abc.default-release");
    fs.mkdirSync(prof, { recursive: true });
    fs.writeFileSync(path.join(ff, "profiles.ini"), "[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/abc.default-release\r\n");
    const db = new DatabaseSync(path.join(prof, "places.sqlite"));
    db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
      CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
      INSERT INTO moz_places VALUES (1,'https://sunrisebakery.example/','x'),(2,'https://www.chase.com/','y'),(3,'https://www.geico.com/','z');
      INSERT INTO moz_bookmarks VALUES (1,2,NULL,0,0,'','root________'),(2,2,NULL,1,0,'menu','menu________'),(3,2,NULL,1,1,'toolbar','toolbar_____'),(4,2,NULL,1,2,'tags','tags________'),(5,2,NULL,1,3,'unfiled','unfiled_____'),(6,2,NULL,1,4,'mobile','mobile______'),
        (7,2,NULL,3,0,'Work','fold1'),(8,2,NULL,4,0,'money','tag1'),
        (10,1,1,3,1,'Sunrise Bakery','b1'),(11,1,2,7,0,'Chase','b2'),(12,1,3,5,0,'Geico','b3'),(13,1,2,8,0,NULL,'t1');`);
    db.close();
  }
  return { home, chromeDefault: path.join(chrome, "Default", "Bookmarks"), chromeSynced: path.join(chrome, "Profile 1", "Bookmarks"), running: (list) => fs.writeFileSync(path.join(home, "running.txt"), list) };
}

const XAI_KEY = "xai-fakefakefakefakefake";
function sse(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 400, completion_tokens: 90 } })}\n\n`);
  res.write("data: [DONE]\n\n"); res.end();
}
async function mockAi() {
  const m = { sorts: [], other: [] };
  const srv = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    if (/\/models$/.test(req.url)) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "grok-4.3" }] })); }
    const j = JSON.parse(body || "{}");
    const sys = j.messages?.find((x) => x.role === "system")?.content || "";
    const user = (j.messages || []).filter((x) => x.role === "user").map((x) => x.content).join("\n");
    if (!/^You sort browser bookmarks/.test(sys)) { m.other.push(sys.slice(0, 60)); return sse(res, `{"capability":"writing","difficulty":1,"needWeb":false,"summary":"mock"}`); }
    m.sorts.push({ model: j.model, user });
    const rows = [...user.matchAll(/^(\S+) \| (.*) \| (.*)$/gm)].map((x) => ({ id: x[1], url: x[3] }));
    const bank = rows.filter((r) => /chase|paypal|wellsfargo/.test(r.url)).map((r) => r.id);
    const rest = rows.filter((r) => !bank.includes(r.id)).map((r) => r.id);
    // one id left out on purpose (lands in Other), one invented id (ignored), a name with markup (cleaned)
    return sse(res, "Here you go:\n```json\n" + JSON.stringify({ folders: [{ name: "Banking", items: [...bank, "n99999"] }, { name: "<i>Everything</i>", items: rest.slice(1) }] }) + "\n```");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  m.base = `http://127.0.0.1:${srv.address().port}`;
  m.close = () => new Promise((r) => srv.close(r));
  return m;
}
const NO_KEYS = { XAI_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", OPENROUTER_API_KEY: "", DEEPSEEK_API_KEY: "", MISTRAL_API_KEY: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", PERPLEXITY_API_KEY: "" };
const planFrom = (d, { untick = [] } = {}) => ({ folders: d.proposal.folders.map((f) => ({ name: f.name, items: f.items.filter((x) => !untick.includes(x)) })) });

test("server: allow first, sort with the picked AI only, preview plan, refuse while the browser runs, backup, apply, undo, synced and changed files, Firefox export", async () => {
  const fh = fakeHome();
  const m = await mockAi();
  const s = await startServer({ env: { ...NO_KEYS, CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BASE_URL_XAI: `${m.base}/xai/v1`, CC_BROWSER_HOME: fh.home, LOCALAPPDATA: path.join(fh.home, "Local"), APPDATA: path.join(fh.home, "Roaming") } });
  const original = fs.readFileSync(fh.chromeDefault);
  try {
    assert.equal((await s.api("/bookmarks", { noToken: true })).status, 401, "the routes need the session token");
    assert.ok((await s.api("/state")).json.plugins.includes("bookmarks"));
    let v = (await s.api("/bookmarks")).json;
    const src = v.sources.map((x) => `${x.browser}:${x.profile}:${x.name}`);
    assert.ok(src.includes("chrome:Default:Work") && src.includes("chrome:Profile 1:Home") && src.includes("edge:Default:Default"), src.join(", "));
    if (DatabaseSync) assert.ok(src.includes("firefox:abc.default-release:default-release"));
    assert.ok(!src.some((x) => x.startsWith("demo")), "no sample bookmarks outside demo mode");

    // nothing is read without the allow click; only listed profiles
    assert.equal((await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "Default" } })).status, 400);
    assert.equal((await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "..", allow: true } })).status, 400);
    assert.equal((await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "Profile 9", allow: true } })).status, 404);
    let d = (await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "Default", allow: true } })).json;
    assert.equal(d.count, 30); assert.equal(d.duplicates.length, 2); assert.equal(d.canApply, true); assert.equal(d.synced, false);

    // the AI list: only AIs with a key, with an estimate
    assert.equal((await s.api(`/bookmarks/models?draft=${d.id}`)).json.models.length, 0);
    assert.equal((await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: "xai", model: "grok-4.3" } })).status, 409, "no key yet");
    assert.equal((await s.api("/keys", { method: "POST", body: { provider: "xai", key: XAI_KEY } })).json.status.status, "green");
    const ms = (await s.api(`/bookmarks/models?draft=${d.id}`)).json;
    const pick = ms.models.find((x) => x.provider === "xai" && x.model === ms.suggested.model) || ms.models[0];
    assert.equal(pick.provider, "xai"); assert.ok(pick.estCost > 0, "an estimate before any spend");
    assert.equal((await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: "openai", model: "not-a-model" } })).status, 400);
    assert.equal((await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: "openai", model: "gpt-6-luna" } })).status, 409, "an AI without a key is refused");
    m.other.length = 0;
    d = (await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: "xai", model: pick.model, business: "Sunrise Bakery" } })).json;
    assert.equal(m.sorts.length, 1); assert.equal(m.other.length, 0, "no other AI call");
    const sent = m.sorts[0].user;
    assert.match(sent, /^BUSINESS: Sunrise Bakery$/m); assert.match(sent, /Sunrise Bakery orders \| https:\/\/orders\.sunrisebakery\.example\/admin$/m);
    assert.doesNotMatch(sent, /view=today|#inbox|void\(0\)/, "query strings, fragments and bookmarklet code never leave");
    assert.match(sent, /Save to notes \| \(bookmarklet\)/);
    const names = d.proposal.folders.map((f) => f.name);
    assert.deepEqual(names, ["Banking", "i Everything /i", "Other"]);
    assert.equal(d.proposal.unplaced, 1); assert.ok(!d.proposal.folders.flatMap((f) => f.items).includes("n99999"));
    assert.equal(d.proposal.folders.flatMap((f) => f.items).length, 30);
    assert.equal(d.proposal.by.provider, "xai");
    const ledger = fs.readFileSync(path.join(s.dir, "ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.role === "bookmarks");
    assert.equal(ledger.length, 1); assert.equal(ledger[0].provider, "xai"); assert.ok(ledger[0].cost > 0); assert.equal(ledger[0].missionId, d.id);
    assert.doesNotMatch(fs.readFileSync(path.join(s.dir, "ledger.jsonl"), "utf8"), /sunrisebakery|chase/i, "no titles or addresses in the ledger");

    // the person's edits: untick Weather, rename, merge one duplicate
    const weather = d.items.find((i) => i.title === "Weather").id;
    const plan = planFrom(d, { untick: [weather] });
    plan.folders[1].name = "Everyday";
    plan.merge = ["https://www.chase.com/"];
    // a running browser is refused and nothing is touched
    fh.running("chrome");
    let r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "browser_running"); assert.match(r.json.error, /Close every Google Chrome window/);
    assert.ok(fs.readFileSync(fh.chromeDefault).equals(original));
    assert.ok(!fs.readdirSync(path.dirname(fh.chromeDefault)).some((f) => /command-ai-backup/.test(f)), "no backup before a refusal");
    fh.running("msedge");
    r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan } });
    assert.equal(r.status, 200, r.text);
    const a = r.json.applied;
    assert.equal(a.merged, 1); assert.equal(a.folders, 3);
    assert.ok(fs.readFileSync(a.backupNext).equals(original), "backup next to the file"); assert.equal(path.dirname(a.backupNext), path.dirname(fh.chromeDefault));
    assert.ok(fs.readFileSync(a.backup).equals(original), "backup in the app data folder"); assert.ok(a.backup.startsWith(s.dir));
    const now = JSON.parse(fs.readFileSync(fh.chromeDefault, "utf8"));
    assert.ok(!("checksum" in now));
    const after = B.flattenChromium(now);
    assert.equal(after.length, 29);
    assert.equal(after.find((i) => i.id === weather).path, "Other bookmarks", "the unticked bookmark stayed put");
    assert.deepEqual(now.roots.bookmark_bar.children.slice(0, 3).map((c) => c.name), ["Banking", "Everyday", "Other"]);
    assert.equal(fs.readFileSync(path.join(path.dirname(fh.chromeDefault), "Bookmarks.bak"), "utf8"), "chrome's own backup");
    assert.equal((await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan } })).status, 404, "a draft applies once");
    v = (await s.api("/bookmarks")).json;
    assert.equal(v.history[0].id, a.id); assert.equal(v.history[0].undoneAt, null);
    assert.doesNotMatch(fs.readFileSync(path.join(s.dir, "bookmarks.history.json"), "utf8"), /sunrisebakery|chase\.com/i, "the history keeps counts, not bookmarks");

    // undo: refused while running, then the original bytes come back; twice is refused
    fh.running("chrome");
    assert.equal((await s.api("/bookmarks/undo", { method: "POST", body: { id: a.id } })).status, 409);
    fh.running("");
    r = await s.api("/bookmarks/undo", { method: "POST", body: { id: a.id } });
    assert.equal(r.status, 200, r.text);
    assert.ok(fs.readFileSync(fh.chromeDefault).equals(original), "undo restores the original file");
    assert.equal((await s.api("/bookmarks/undo", { method: "POST", body: { id: a.id } })).status, 409);

    // the file changed between reading and applying: refused
    d = (await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "Default", allow: true } })).json;
    d = (await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: "xai", model: pick.model } })).json;
    fs.appendFileSync(fh.chromeDefault, "\n");
    r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: planFrom(d) } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "changed");

    // changed after applying: undo asks first, then keeps a copy of the newer file
    const before2 = fs.readFileSync(fh.chromeDefault);
    d = (await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "Default", allow: true } })).json;
    d = (await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: "xai", model: pick.model } })).json;
    const a2 = (await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: planFrom(d) } })).json.applied;
    assert.equal(a2.merged, 0, "no duplicates merged unless ticked");
    assert.equal(B.flattenChromium(JSON.parse(fs.readFileSync(fh.chromeDefault, "utf8"))).length, 30);
    fs.appendFileSync(fh.chromeDefault, " ");
    r = await s.api("/bookmarks/undo", { method: "POST", body: { id: a2.id } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "changed_since");
    assert.equal((await s.api("/bookmarks/undo", { method: "POST", body: { id: a2.id, force: true } })).status, 200);
    assert.ok(fs.readFileSync(fh.chromeDefault).equals(before2));
    assert.ok(fs.readdirSync(path.dirname(fh.chromeDefault)).some((f) => /command-ai-before-undo/.test(f)));

    // a synced profile needs "apply anyway"
    const syncedBefore = fs.readFileSync(fh.chromeSynced);
    d = (await s.api("/bookmarks/read", { method: "POST", body: { browser: "chrome", profile: "Profile 1", allow: true } })).json;
    assert.equal(d.synced, true);
    r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: { folders: [{ name: "Banking", items: ofUrl(d.items, /chase/) }] } } });
    assert.equal(r.status, 409); assert.equal(r.json.code, "synced"); assert.ok(fs.readFileSync(fh.chromeSynced).equals(syncedBefore));
    r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: { folders: [{ name: "Banking", items: ofUrl(d.items, /chase/) }] }, allowSynced: true } });
    assert.equal(r.status, 200, r.text);
    const synced = JSON.parse(fs.readFileSync(fh.chromeSynced, "utf8"));
    assert.equal(synced.sync_metadata, "c3luYw==", "the sync data is left alone");

    // Firefox: read from a copy, tags skipped, export only
    if (DatabaseSync) {
      const ffFile = path.join(fh.home, "Roaming", "Mozilla", "Firefox", "Profiles", "abc.default-release", "places.sqlite");
      const ffBefore = fs.readFileSync(ffFile);
      d = (await s.api("/bookmarks/read", { method: "POST", body: { browser: "firefox", profile: "abc.default-release", allow: true } })).json;
      assert.equal(d.count, 3, "the tag entry is not a bookmark"); assert.equal(d.canApply, false);
      assert.deepEqual(d.items.map((i) => `${i.title}@${i.path}`).sort(), ["Chase@Bookmarks toolbar / Work", "Geico@Other bookmarks", "Sunrise Bakery@Bookmarks toolbar"]);
      const fplan = { folders: [{ name: "Money", items: ofUrl(d.items, /chase|geico/) }] };
      r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: fplan } });
      assert.equal(r.status, 409); assert.equal(r.json.code, "export_only");
      r = await s.api("/bookmarks/export", { method: "POST", body: { draft: d.id, plan: fplan } });
      assert.match(r.json.html, /<H3>Money<\/H3>/); assert.match(r.json.html, /www\.geico\.com/); assert.doesNotMatch(r.json.html, /sunrisebakery/);
      assert.ok(fs.readFileSync(ffFile).equals(ffBefore), "Firefox's database is never written");
    }
    assert.doesNotMatch(s.log, new RegExp(XAI_KEY));
  } finally {
    await s.stop(); await m.close();
    fs.rmSync(fh.home, { recursive: true, force: true });
  }
});

test("demo mode with no keys: sample bookmarks sorted by the pretend AI, applied to a sandbox copy, undone", async () => {
  const fh = fakeHome();
  const s = await startServer({ env: { ...NO_KEYS, CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off", CC_BROWSER_HOME: fh.home } });
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    const v = (await s.api("/bookmarks")).json;
    assert.ok(v.sources.some((x) => x.browser === "demo"));
    let d = (await s.api("/bookmarks/read", { method: "POST", body: { browser: "demo", profile: "demo", allow: true } })).json;
    assert.equal(d.count, 30);
    const ms = (await s.api(`/bookmarks/models?draft=${d.id}`)).json;
    assert.ok(ms.suggested && ms.models.every((x) => x.demo));
    d = (await s.api("/bookmarks/categorize", { method: "POST", body: { draft: d.id, provider: ms.suggested.provider, model: ms.suggested.model } })).json;
    const names = d.proposal.folders.map((f) => f.name);
    for (const n of ["Sunrise Bakery", "Banking & Money", "Insurance", "Social", "AI"]) assert.ok(names.includes(n), `${n} in ${names}`);
    const biz = d.proposal.folders.find((f) => f.name === "Sunrise Bakery").items.map((x) => d.items.find((i) => i.id === x).title);
    assert.ok(biz.includes("Sunrise Bakery menu PDF") && biz.includes("Sunrise Bakery orders"));
    const file = path.join(s.dir, "bookmarks-demo", "Bookmarks");
    const before = fs.readFileSync(file);
    const r = await s.api("/bookmarks/apply", { method: "POST", body: { draft: d.id, plan: planFrom(d) } });
    assert.equal(r.status, 200, r.text);
    assert.ok(!fs.readFileSync(file).equals(before));
    assert.ok(fs.readFileSync(fh.chromeDefault).equals(fs.readFileSync(FIXTURE)), "no real (here: fake) browser profile touched in demo mode");
    assert.equal((await s.api("/bookmarks/undo", { method: "POST", body: { id: r.json.applied.id } })).status, 200);
    assert.ok(fs.readFileSync(file).equals(before));
  } finally { await s.stop(); fs.rmSync(fh.home, { recursive: true, force: true }); }
});
