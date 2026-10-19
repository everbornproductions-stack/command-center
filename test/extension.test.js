// Phase 24: Chrome / Edge extension. The extension folder (manifest, popup, worker) is checked statically; the
// app side runs for real in demo mode: a pairing code shown once (hash kept), the extension's messages
// accepted only with that code (no code, a wrong code, an unpaired code, the session token alone: 401), web
// origins refused, the Host pin kept, JSON only, "draft" waits in Marching orders, "chat" and "council" run on
// the demo AIs, too many wrong codes slow down. Nothing leaves the machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, tmpDir, ROOT } from "./helpers.js";

process.env.CC_DATA_DIR = process.env.CC_DATA_DIR || tmpDir("cc-extension-");
const EXT = path.join(ROOT, "extension");
const read = (f) => fs.readFileSync(path.join(EXT, f), "utf8");

test("extension files: Manifest V3, talks only to this PC, no secrets, no em-dashes", async () => {
  const man = JSON.parse(read("manifest.json"));
  assert.equal(man.manifest_version, 3);
  assert.equal(man.name, "Meldmind"); assert.match(man.description, /an Everborn product/);
  assert.deepEqual(man.host_permissions, ["http://127.0.0.1/*", "http://localhost/*"], "only this computer");
  assert.deepEqual(man.permissions.sort(), ["activeTab", "contextMenus", "scripting", "storage"]);
  assert.equal(man.content_scripts, undefined, "nothing is injected into pages until you click");
  for (const f of ["background.js", "shared.js", "popup.js", "popup.html", "manifest.json"]) {
    const src = read(f);
    for (const u of src.match(/https?:\/\/[^\s"'`)]+/g) || []) assert.match(u, /^http:\/\/(127\.0\.0\.1|localhost)[:/]/, `${f} calls only this PC (${u})`);
    assert.ok(!src.includes("—"), `${f} has no em-dash`);
  }
  const { parseCode, PORTS } = await import("../extension/shared.js");
  assert.deepEqual(parseCode(" cce.4748.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG "), { port: 4748, secret: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG", code: "cce.4748.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" });
  assert.throws(() => parseCode("sk-not-a-code"), /not a Meldmind pairing code/);
  assert.equal(PORTS[0], 4747);
  const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
  assert.match(yml, /- extension\/\*\*/); assert.match(yml, /asarUnpack:\s*\n\s*- extension\/\*\*/);
});

test("buildPrompt: instruction, title, address and the text in quotes, cut at 50,000 characters", async () => {
  const { buildPrompt } = await import("../server/plugins/extension.js");
  const p = buildPrompt({ kind: "selection", url: "https://example.com/a", title: "A page", text: "Rye needs a long proof." });
  assert.match(p, /^Here is a passage I selected/); assert.match(p, /From: A page \(https:\/\/example\.com\/a\)/); assert.match(p, /"""\nRye needs a long proof\.\n"""/);
  assert.match(buildPrompt({ kind: "page", text: "x", note: "Make three captions" }), /^Make three captions\n\nFrom: \(no title\)/);
  const long = buildPrompt({ kind: "page", text: "a".repeat(60000) });
  assert.match(long, /cut to the first 50000 characters/); assert.ok(long.length < 50500);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("server: pairing code once, messages only with it, origins, host, JSON, draft / chat / council, unpair, rate limit", { timeout: 120000 }, async () => {
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_STATUS_PAGES: "off" } });
  const ext = (route, { code, method, body, headers = {} } = {}) => s.raw({ method: method || (body ? "POST" : "GET"), path: `/api/ext/${route}`, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(code ? { authorization: `Bearer ${code}` } : {}), ...headers }, body });
  try {
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    assert.equal((await s.api("/extension/info", { noToken: true })).status, 401, "the app's own routes keep the session token");
    const info = (await s.api("/extension/info")).json;
    assert.equal(info.folder, EXT); assert.equal(info.port, s.port); assert.deepEqual(info.pairings, []);

    // pair: the code is shown once, only its hash is stored
    const pr = (await s.api("/extension/pairings", { method: "POST", body: { name: "Chrome on the laptop" } })).json;
    assert.match(pr.code, new RegExp(`^cce\\.${s.port}\\.[A-Za-z0-9_-]{43}$`));
    const secret = pr.code.split(".")[2];
    const stored = fs.readFileSync(path.join(s.dir, "extension.pairings.json"), "utf8");
    assert.ok(!stored.includes(secret), "the code itself is never stored"); assert.match(stored, /"hash": "[0-9a-f]{64}"/);
    const list = (await s.api("/extension/pairings")).json.pairings;
    assert.equal(list.length, 1); assert.equal(list[0].name, "Chrome on the laptop"); assert.equal(list[0].hash, undefined); assert.equal(list[0].code, undefined);

    // only with the pairing code
    assert.equal((await ext("ping")).status, 401);
    assert.equal((await ext("ping", { code: "cce.4747.wrongwrongwrongwrongwrongwrongwrongwrong123" })).status, 401);
    assert.equal((await ext("ping", { headers: { "x-cc-token": s.token } })).status, 401, "the session token alone is not a pairing");
    let r = await ext("ping", { code: pr.code });
    assert.equal(r.status, 200); assert.equal(r.json.app, "Meldmind"); assert.equal(r.json.name, "Chrome on the laptop"); assert.equal(r.json.port, s.port);
    assert.equal((await ext("ping", { code: secret })).status, 200, "the bare secret works too");

    // a web page cannot call it; the extension's own origin can; the Host pin stays
    r = await ext("ping", { code: pr.code, headers: { origin: "https://evil.example" } });
    assert.equal(r.status, 403); assert.equal(r.json.code, "origin");
    r = await ext("ping", { code: pr.code, headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" } });
    assert.equal(r.status, 200); assert.equal(r.headers["access-control-allow-origin"], "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
    assert.equal((await ext("ping", { code: pr.code, headers: { host: "evil.example:80" } })).status, 421);
    assert.equal((await ext("send", { code: pr.code, method: "POST", body: "text=hi", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await ext("nope", { code: pr.code })).status, 404);

    // draft: waits in Marching orders, nothing runs
    const before = (await s.api("/state")).json.missions.length;
    r = await ext("send", { code: pr.code, body: { action: "draft", kind: "selection", url: "https://example.com/bread?x=1", title: "Bread notes", text: "Rye needs a long proof." } });
    assert.equal(r.status, 202, r.text); assert.equal(r.json.action, "draft");
    const ib = (await s.api("/extension/inbox")).json.items;
    assert.equal(ib.length, 1); assert.equal(ib[0].title, "Bread notes"); assert.match(ib[0].prompt, /Rye needs a long proof/); assert.equal(ib[0].browser, "Chrome on the laptop");
    await sleep(300);
    assert.equal((await s.api("/state")).json.missions.length, before, "a draft starts nothing");
    assert.equal((await ext("send", { code: pr.code, body: { url: "javascript:alert(1)", text: "x" } })).status, 400);
    assert.equal((await ext("send", { code: pr.code, body: { text: "" } })).status, 400);
    assert.equal((await ext("send", { code: pr.code, body: "[1]" })).status, 400);

    // chat: runs on the demo AIs because the person clicked Send in the extension
    r = await ext("send", { code: pr.code, body: { action: "chat", kind: "page", url: "https://example.com/", title: "Example", text: "A page about sourdough starters." } });
    assert.equal(r.status, 202); assert.match(r.json.runId, /^s-/);
    let run = null; for (let i = 0; i < 100 && !(run?.status === "done"); i++) { await sleep(200); const g = await s.api(`/missions/${r.json.runId}`); if (g.status === 200) run = g.json; }
    assert.equal(run?.status, "done"); assert.match(run.prompt, /sourdough starters/); assert.ok(run.cost > 0);
    assert.ok((await s.api("/state")).json.ledger.recent.some((e) => e.missionId === r.json.runId), "the call is in the ledger");
    r = await ext("send", { code: pr.code, body: { action: "council", kind: "selection", text: "Which hook is best: A or B?" } });
    assert.equal(r.status, 202); assert.equal(r.json.action, "council");
    const used = (await s.api("/extension/pairings")).json.pairings[0];
    assert.equal(used.sends, 3); assert.ok(used.lastUsed);

    // unpair: the code stops working at once
    assert.equal((await s.api(`/extension/pairings/${pr.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await ext("ping", { code: pr.code })).status, 401);
    assert.equal((await s.api(`/extension/pairings/${pr.id}`, { method: "DELETE" })).status, 404);

    // too many wrong codes
    let last = null; for (let i = 0; i < 25; i++) last = await ext("ping", { code: `cce.1.wrong${String(i).padStart(40, "0")}` });
    assert.equal(last.status, 429);
  } finally { await s.stop(); }
});

test("Phase 24 extension files (app side): no em-dashes in user-facing text", () => {
  for (const f of ["server/plugins/extension.js", "web/features/extension.js"]) assert.ok(!fs.readFileSync(path.join(ROOT, f), "utf8").includes("—"), `${f} has no em-dash`);
});
