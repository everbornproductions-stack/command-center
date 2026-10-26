// 0.4.21 M-hub item 17: Remix publishes to Vercel and itch.io with the person's own token (mocked
// network), and the phone store button says "coming soon" on the button itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { tmpDir, startServer, ROOT } from "./helpers.js";
import { publishVercel, publishItch, collectFiles, liveApiAllowed, PHONE_SOON } from "../server/remix-publish.js";

const TOKEN = "vercel-test-token-0421";
const KEY = "itch-test-key-0421";

function project() {
  const dir = tmpDir("cc-rpub-");
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><h1>Hi</h1>");
  fs.writeFileSync(path.join(dir, "script.js"), "let a=1;");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "x.js"), "no");
  fs.writeFileSync(path.join(dir, ".env"), "SECRET=1");
  return dir;
}
const reply = (status, json) => ({ ok: status < 300, status, json: async () => json });

test("files: node_modules, .env and test output are not sent", () => {
  const dir = project();
  try { assert.deepEqual(collectFiles(dir).map((f) => f.file).sort(), ["index.html", "script.js"]); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Vercel: one deployment with the token in a header, files inline, URL returned", async () => {
  const dir = project();
  const calls = [];
  try {
    const out = await publishVercel({ token: TOKEN, folder: dir, name: "Luma Tiles!", env: {}, fetchImpl: async (url, o) => { calls.push({ url, o }); return reply(200, { id: "dpl_1", url: "luma-tiles-abc.vercel.app" }); } });
    assert.equal(out.ok, true);
    assert.equal(out.sent, true);
    assert.equal(out.url, "https://luma-tiles-abc.vercel.app");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.vercel\.com\/v13\/deployments/);
    assert.equal(calls[0].url.includes(TOKEN), false);
    assert.equal(calls[0].o.headers.authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(calls[0].o.body);
    assert.equal(body.name, "luma-tiles");
    assert.deepEqual(body.files.map((f) => f.file).sort(), ["index.html", "script.js"]);
    assert.equal(JSON.stringify(out).includes(TOKEN), false);
    const bad = await publishVercel({ token: TOKEN, folder: dir, env: {}, fetchImpl: async () => reply(403, { error: { message: "no" } }) });
    assert.equal(bad.ok, false); assert.equal(bad.code, "token"); assert.equal(bad.sent, false);
    const down = await publishVercel({ token: TOKEN, folder: dir, env: {}, fetchImpl: async () => { throw new Error("offline"); } });
    assert.equal(down.code, "network");
    assert.equal((await publishVercel({ token: "", folder: dir, fetchImpl: async () => { throw new Error("must not call"); } })).code, "token");
    assert.equal((await publishVercel({ token: TOKEN, folder: tmpDir(), fetchImpl: async () => { throw new Error("must not call"); } })).code, "files");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("itch.io: key checked, the draft page found, butler pushes with the key in its environment", async () => {
  const dir = project();
  try {
    const seen = [];
    const fetchImpl = async (url, o) => {
      seen.push({ url, auth: o.headers.authorization });
      if (url.endsWith("/me")) return reply(200, { user: { username: "pat" } });
      return reply(200, { games: [{ title: "Luma Tiles", url: "https://pat.itch.io/luma-tiles" }] });
    };
    const runs = [];
    const run = async (args, o) => { runs.push({ args, token: o.token }); return { code: 0 }; };
    const out = await publishItch({ token: KEY, folder: dir, name: "Luma Tiles", fetchImpl, run, env: {} });
    assert.equal(out.ok, true);
    assert.equal(out.url, "https://pat.itch.io/luma-tiles");
    assert.deepEqual(runs[0].args, ["push", dir, "pat/luma-tiles:html5"]);
    assert.equal(runs[0].token, KEY);
    assert.equal(seen.every((c) => !c.url.includes(KEY) && c.auth === `Bearer ${KEY}`), true);
    const none = await publishItch({ token: KEY, folder: dir, name: "Other Game", fetchImpl, run, env: {} });
    assert.equal(none.code, "no_page");
    assert.match(none.error, /itch\.io\/game\/new/);
    const badKey = await publishItch({ token: KEY, folder: dir, name: "Luma Tiles", fetchImpl: async () => reply(401, {}), run, env: {} });
    assert.equal(badKey.code, "token");
    const noButler = await publishItch({ token: KEY, folder: dir, name: "Luma Tiles", fetchImpl, run: async () => ({ code: -1, missing: true }), env: {} });
    assert.equal(noButler.code, "butler");
    assert.match(noButler.error, /butler/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("live posting is off in the test suite unless a stand-in address is set", () => {
  assert.equal(liveApiAllowed("CC_VERCEL_API_URL", { CC_NET_TRACE: "1" }), false);
  assert.equal(liveApiAllowed("CC_VERCEL_API_URL", { CC_NET_TRACE: "1", CC_VERCEL_API_URL: "http://127.0.0.1:1" }), true);
  assert.equal(liveApiAllowed("CC_VERCEL_API_URL", {}), true);
});

test("route: Publish to a website deploys to the stand-in Vercel, phone says coming soon", async () => {
  const hits = [];
  const mock = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => { b += d; });
    req.on("end", () => { hits.push({ url: req.url, auth: req.headers.authorization, body: b }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "dpl_9", url: "mock-site.vercel.app" })); });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const s = await startServer({ env: { CC_DEV_OWNER: "1", CC_VERCEL_API_URL: `http://127.0.0.1:${mock.address().port}` } });
  try {
    const body = { source: "screenshots", start: "screenshot", looks: "A calm board with large round tiles.", plays: "Tap a tile. A full line clears.", works: "Levels speed up.", appType: "app", own: { name: "Luma Tiles", characters: "Luma", look: "Night blue", ideas: "A calm puzzle", art: "" }, engineId: "scratch-page", packIds: [], confirm: true };
    const run = await s.api("/remix/run", { method: "POST", body });
    assert.equal(run.status, 200, run.json?.error || run.text);
    const pid = run.json.projectId;
    const posted = await s.api("/remix/publish", { method: "POST", body: { confirm: true, target: "vercel", token: TOKEN, projectId: pid, projectName: "Luma Tiles" } });
    assert.equal(posted.status, 200, posted.text);
    assert.equal(posted.json.sent, true);
    assert.equal(posted.json.url, "https://mock-site.vercel.app");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].auth, `Bearer ${TOKEN}`);
    assert.equal(posted.text.includes(TOKEN) || s.log.includes(TOKEN), false);
    const again = await s.api("/remix/publish", { method: "POST", body: { confirm: true, target: "vercel", projectId: pid } });
    assert.equal(again.json.sent, true, "the stored token is used next time");
    const quiet = await s.api("/remix/publish", { method: "POST", body: { target: "vercel", projectId: pid } });
    assert.equal(quiet.status, 400);
    assert.equal(hits.length, 2, "no click, no post");
    const phone = await s.api("/remix/publish", { method: "POST", body: { confirm: true, target: "phone", token: "x" } });
    assert.equal(phone.status, 400);
    assert.equal(phone.json.code, "coming_soon");
    assert.equal(phone.json.error, PHONE_SOON);
  } finally { await s.stop(); await new Promise((r) => mock.close(r)); }
});

test("the page: the phone choice is disabled and says coming soon; setup step is shown; no dashes", () => {
  const ui = fs.readFileSync(path.join(ROOT, "web/features/remix.js"), "utf8");
  assert.match(ui, /"A phone app \(coming soon\)"[^\n]*"disabled"/);
  assert.match(ui, /vercel\.com\/account\/tokens/);
  assert.match(ui, /itch\.io\/user\/settings\/api-keys/);
  assert.equal(/[–—]/.test(fs.readFileSync(path.join(ROOT, "server/remix-publish.js"), "utf8")), false);
  assert.equal(/[–—]/.test(PHONE_SOON), false);
});
