// Phase 7: integrations. OAuth connect for Google Drive, Instagram (Meta Graph), HighLevel and Slack,
// tokens in the vault, and "Save to Drive", "Post to Instagram", "Schedule in HighLevel" and "Send to
// Slack", each only after a preview and a click. One local mock plays all four services on a random port;
// no real URL, account or key is ever used.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { startServer, freePort } from "./helpers.js";

const SECRET = { google: "gsec-TEST-1111", meta: "msec-TEST-2222", ghl: "hsec-TEST-3333", slack: "ssec-TEST-4444" };
const TOKENS = ["g-at-TEST", "g-rt-TEST", "m-user-TEST", "m-long-TEST", "m-page-TEST", "h-at-TEST", "h-at2-TEST", "h-rt-TEST", "s-at-TEST"];

let mock, hits = [], s, clip;
async function startMock() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (req, res) => {
    let raw = Buffer.alloc(0); for await (const c of req) raw = Buffer.concat([raw, c]);
    const u = new URL(req.url, base), body = raw.toString("utf8");
    const form = /x-www-form-urlencoded/.test(req.headers["content-type"] || "") ? Object.fromEntries(new URLSearchParams(body)) : null;
    let json = null; if (/json/.test(req.headers["content-type"] || "")) { try { json = JSON.parse(body); } catch {} }
    hits.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, form, json, body, size: raw.length });
    const send = (st, obj, h = {}) => { res.writeHead(st, { "content-type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
    const p = u.pathname, q = u.searchParams;
    // Google
    if (p === "/token") {
      if (form.grant_type === "refresh_token") return send(200, { access_token: "g-at-TEST", expires_in: 3600 });
      if (form.code === "wide") return send(200, { access_token: "g-wide", scope: "https://www.googleapis.com/auth/drive" });
      if (form.code !== "g-code" || !form.code_verifier || form.client_secret !== SECRET.google) return send(400, { error: "invalid_grant" });
      return send(200, { access_token: "g-at-TEST", refresh_token: "g-rt-TEST", expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.file" });
    }
    if (p === "/drive/v3/files" && req.method === "POST") return send(200, { id: "fold-1" });
    if (p === "/upload/drive/v3/files" && q.get("uploadType") === "multipart") return send(200, { id: "doc-1", name: "x.md", webViewLink: "https://drive.google.com/file/d/doc-1/view" });
    if (p === "/upload/drive/v3/files" && q.get("uploadType") === "resumable") return send(200, {}, { location: `${base}/upload-session/1` });
    if (p === "/upload-session/1" && req.method === "PUT") return send(200, { id: "vid-1", webViewLink: "https://drive.google.com/file/d/vid-1/view" });
    // Meta
    if (p === "/v21.0/oauth/access_token") {
      if (q.get("grant_type") === "fb_exchange_token") return q.get("fb_exchange_token") === "m-user-TEST" ? send(200, { access_token: "m-long-TEST" }) : send(400, { error: { message: "bad" } });
      if (q.get("code") !== "m-code" || q.get("client_secret") !== SECRET.meta) return send(400, { error: { message: "bad code" } });
      return send(200, { access_token: "m-user-TEST", token_type: "bearer" });
    }
    if (p === "/v21.0/me/accounts") return q.get("access_token") === "m-long-TEST" ? send(200, { data: [{ name: "No IG Page", access_token: "m-other" }, { name: "Everborn Page", access_token: "m-page-TEST", instagram_business_account: { id: "1784", username: "everborn" } }] }) : send(401, { error: { message: "bad token" } });
    if (p === "/v21.0/1784/media") return send(200, { id: "cont-1" });
    if (p === "/v21.0/1784/media_publish") return send(200, { id: "ig-post-1" });
    // HighLevel
    if (p === "/oauth/token") {
      if (form.user_type !== "Location" || form.client_secret !== SECRET.ghl) return send(400, { error: "invalid_request" });
      if (form.grant_type === "refresh_token") return form.refresh_token === "h-rt-TEST" ? send(200, { access_token: "h-at2-TEST", refresh_token: "h-rt-TEST", expires_in: 86399 }) : send(400, { error: "invalid_grant" });
      if (form.code !== "h-code") return send(400, { error: "invalid_grant" });
      return send(200, { access_token: "h-at-TEST", refresh_token: "h-rt-TEST", expires_in: 30, scope: "socialplanner/post.write socialplanner/account.readonly", locationId: "loc-1", userType: "Location" });
    }
    if (p === "/social-media-posting/loc-1/accounts") return send(200, { results: { accounts: [{ id: "acc-1", name: "Everborn IG", platform: "instagram" }] } });
    if (p === "/social-media-posting/loc-1/posts") return req.headers.authorization === "Bearer h-at2-TEST" ? send(201, { results: { post: { _id: "ghl-post-1" } } }) : send(401, { message: "expired" });
    // Slack
    if (p === "/api/oauth.v2.access") return form.code === "s-code" && form.client_secret === SECRET.slack ? send(200, { ok: true, access_token: "s-at-TEST", scope: "chat:write,channels:read", team: { id: "T1", name: "Everborn" } }) : send(200, { ok: false, error: "invalid_code" });
    if (p === "/api/conversations.list") return req.headers.authorization === "Bearer s-at-TEST" ? send(200, { ok: true, channels: [{ id: "C0TEAM001", name: "marketing", is_member: true }] }) : send(200, { ok: false, error: "invalid_auth" });
    if (p === "/api/chat.postMessage") return send(200, { ok: true, ts: "1700000000.0001", channel: json?.channel });
    if (p === "/api/chat.getPermalink") return send(200, { ok: true, permalink: "https://everborn.slack.com/archives/C0TEAM001/p17000000000001" });
    send(404, { error: "mock: no route " + p });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { base, close: () => new Promise((r) => server.close(r)) };
}

before(async () => {
  mock = await startMock();
  s = await startServer({
    env: {
      CC_DEV_OWNER: "1",
      CC_GOOGLE_AUTH_URL: mock.base, CC_GOOGLE_TOKEN_URL: mock.base, CC_DRIVE_API_URL: mock.base, CC_DRIVE_UPLOAD_URL: mock.base,
      CC_META_AUTH_URL: mock.base, CC_META_GRAPH_URL: mock.base, CC_GHL_AUTH_URL: mock.base, CC_GHL_API_URL: mock.base,
      CC_SLACK_AUTH_URL: mock.base, CC_SLACK_API_URL: `${mock.base}/api`,
    },
    seed: (dir) => {
      clip = path.join(dir, "projects", "unfiled", "media", "mj-int.mp4");
      fs.mkdirSync(path.dirname(clip), { recursive: true });
      fs.writeFileSync(clip, "fake-mp4-bytes");
      fs.writeFileSync(path.join(dir, "media.jobs.json"), JSON.stringify({ items: [{ id: "mj-int", provider: "kling", kind: "video", status: "done", outputs: [clip], params: { prompt: "clip" } }] }));
    },
  });
});
after(async () => { await s?.stop(); await mock?.close(); });

const connect = async (k, code, { cid = `${k}-client-id-1` } = {}) => {
  const c = await s.api(`/publish/connect/${k}/client`, { method: "POST", body: { clientId: cid, clientSecret: SECRET[k] } });
  assert.equal(c.status, 200, c.text);
  const st = await s.api(`/publish/connect/${k}/start`, { method: "POST", body: { origin: s.base } });
  assert.equal(st.status, 200, st.text);
  const fin = await s.api(`/publish/connect/${k}/finish`, { method: "POST", body: { code, state: st.json.state } });
  return { start: st.json, fin };
};
const hitsTo = (re) => hits.filter((h) => re.test(h.path));

test("connect: client ID first; sign-in links ask for least scopes; a wider grant or stale state saves nothing", async () => {
  const list = await s.api("/publish/connect");
  assert.deepEqual(list.json.map((c) => c.id), ["google", "meta", "ghl", "slack"]);
  assert.ok(list.json.every((c) => !c.connected));
  const noId = await s.api("/publish/connect/slack/start", { method: "POST", body: { origin: s.base } });
  assert.equal(noId.status, 400); assert.equal(noId.json.code, "client_id");
  assert.equal((await s.api("/publish/connect/nope/start", { method: "POST", body: { origin: s.base } })).status, 400);

  await s.api("/publish/connect/google/client", { method: "POST", body: { clientId: "google-client-id-1", clientSecret: SECRET.google } });
  const st = await s.api("/publish/connect/google/start", { method: "POST", body: { origin: s.base } });
  const u = new URL(st.json.url);
  assert.equal(u.origin, mock.base); assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256"); assert.ok(u.searchParams.get("code_challenge"));
  assert.equal(u.searchParams.get("redirect_uri"), `${s.base}/`); assert.match(st.json.state, /^pub-google-/);
  assert.equal((await s.api("/publish/connect/google/finish", { method: "POST", body: { code: "g-code", state: "pub-google-forged" } })).json.code, "state");
  const wide = await s.api("/publish/connect/google/finish", { method: "POST", body: { code: "wide", state: st.json.state } });
  assert.equal(wide.status, 400); assert.equal(wide.json.code, "scope");
  assert.equal((await s.api("/publish/connect")).json.find((c) => c.id === "google").connected, false, "nothing kept after a wider grant");
  const again = await s.api("/publish/connect/google/finish", { method: "POST", body: { code: "g-code", state: st.json.state } });
  assert.equal(again.json.code, "state", "a state is single use");

  for (const [k, scope, sep] of [["meta", "instagram_content_publish", ","], ["ghl", "socialplanner/post.write", " "], ["slack", "chat:write", ","]]) {
    await s.api(`/publish/connect/${k}/client`, { method: "POST", body: { clientId: `${k}-client-id-1` } });
    const x = new URL((await s.api(`/publish/connect/${k}/start`, { method: "POST", body: { origin: s.base } })).json.url);
    assert.equal(x.origin, mock.base); assert.ok(x.searchParams.get("scope").split(sep).includes(scope));
    assert.ok(!x.searchParams.get("scope").split(sep).some((v) => /write|publish/.test(v) && !/post\.write|content_publish|chat:write/.test(v)));
  }
});

test("connect all four: tokens to the vault, never back to the page; nothing is posted by connecting", async () => {
  hits = [];
  const g = await connect("google", "g-code");
  assert.equal(g.fin.status, 200, g.fin.text); assert.equal(g.fin.json.connected, true);
  const m = await connect("meta", "m-code");
  assert.equal(m.fin.status, 200, m.fin.text); assert.match(m.fin.json.account, /@everborn via Everborn Page/);
  const h = await connect("ghl", "h-code");
  assert.equal(h.fin.status, 200, h.fin.text); assert.match(h.fin.json.account, /loc-1/);
  const sl = await connect("slack", "s-code");
  assert.equal(sl.fin.status, 200, sl.fin.text); assert.match(sl.fin.json.account, /Everborn/);
  assert.ok(hitsTo(/media|posts$|postMessage|upload/).length === 0, "connecting posts nothing");

  const ch = (await s.api("/publish/channels")).json;
  for (const id of ["instagram", "ghl", "slack", "drive"]) assert.equal(ch.find((c) => c.id === id).ready, true, id);
  const out = JSON.stringify([(await s.api("/publish/connect")).text, JSON.stringify(ch)]);
  for (const t of [...TOKENS, ...Object.values(SECRET)]) assert.ok(!out.includes(t), `the page never sees ${t}`);
});

test("Post to Instagram, Send to Slack, Schedule in HighLevel, Save to Drive: only after preview and confirm", async () => {
  hits = [];
  // Instagram: the preview calls nothing; the click posts with the Page token
  const ig = await s.api("/publish/preview", { method: "POST", body: { channel: "instagram", title: "Launch", text: "New drop #sacramento", mediaUrl: "https://cdn.example/a.jpg" } });
  assert.equal(ig.json.ready, true); assert.deepEqual(ig.json.problems, []);
  assert.equal(hits.length, 0, "a preview never calls the service");
  const igPost = await s.api("/publish/post", { method: "POST", body: { previewId: ig.json.previewId, confirmed: true } });
  assert.equal(igPost.status, 200, igPost.text); assert.equal(igPost.json.status, "posted");
  const cont = hitsTo(/\/1784\/media$/)[0];
  assert.equal(new URLSearchParams(cont.body).get("access_token"), "m-page-TEST"); assert.equal(new URLSearchParams(cont.body).get("image_url"), "https://cdn.example/a.jpg");
  assert.equal(hitsTo(/media_publish$/).length, 1);

  // Slack: channel list, preview, click
  const rooms = await s.api("/publish/slack-channels");
  assert.deepEqual(rooms.json, [{ id: "C0TEAM001", name: "marketing", member: true }]);
  const bad = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", text: "hi" } });
  assert.ok(bad.json.problems.includes("Pick a Slack channel"));
  const badPost = await s.api("/publish/post", { method: "POST", body: { previewId: bad.json.previewId, confirmed: true } });
  assert.equal(badPost.json.code, "preview_problems");
  const sp = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", title: "Week plan", text: "Monday: reel", channelId: "C0TEAM001", channelName: "marketing" } });
  assert.match(sp.json.summary, /#marketing/);
  assert.equal(hitsTo(/postMessage/).length, 0);
  assert.equal((await s.api("/publish/post", { method: "POST", body: { previewId: sp.json.previewId } })).json.code, "confirm_required");
  const slPost = await s.api("/publish/post", { method: "POST", body: { previewId: sp.json.previewId, confirmed: true, text: "SWAPPED" } });
  assert.equal(slPost.json.status, "posted"); assert.match(slPost.json.result.url, /^https:\/\/everborn\.slack\.com\//);
  const msg = hitsTo(/postMessage/)[0];
  assert.equal(msg.headers.authorization, "Bearer s-at-TEST"); assert.equal(msg.json.channel, "C0TEAM001");
  assert.match(msg.json.text, /\*Week plan\*\n\nMonday: reel/); assert.ok(!/SWAPPED/.test(msg.json.text), "posts what was previewed");

  // HighLevel: the 30-second token is refreshed before the post
  const acc = await s.api("/publish/ghl-accounts");
  assert.equal(acc.json[0].id, "acc-1");
  const gp = await s.api("/publish/preview", { method: "POST", body: { channel: "ghl", text: "Big news", accountIds: ["acc-1"], when: Date.now() + 86400000 } });
  assert.deepEqual(gp.json.problems, []);
  const gPost = await s.api("/publish/post", { method: "POST", body: { previewId: gp.json.previewId, confirmed: true } });
  assert.equal(gPost.json.status, "posted", gPost.text);
  assert.ok(hitsTo(/^\/oauth\/token$/).some((x) => x.form.grant_type === "refresh_token"));
  const gh = hitsTo(/posts$/).at(-1);
  assert.equal(gh.headers.authorization, "Bearer h-at2-TEST"); assert.equal(gh.json.status, "scheduled"); assert.deepEqual(gh.json.accountIds, ["acc-1"]);

  // Google Drive: upload the deliverable and the media job's file into one app folder
  const dp = await s.api("/publish/preview", { method: "POST", body: { channel: "drive", title: "Week plan", text: "the plan", mediaJobId: "mj-int", files: [path.join(s.dir, "settings.json")] } });
  assert.match(dp.json.summary, /Google Drive, folder "Command AI"/); assert.equal(dp.json.media.files, 1);
  const dPost = await s.api("/publish/post", { method: "POST", body: { previewId: dp.json.previewId, confirmed: true } });
  assert.equal(dPost.json.status, "posted", dPost.text); assert.equal(dPost.json.result.via, "api");
  assert.equal(dPost.json.result.url, "https://drive.google.com/file/d/doc-1/view");
  const mp = hitsTo(/^\/upload\/drive\/v3\/files$/).find((x) => x.query.uploadType === "multipart");
  assert.equal(mp.headers.authorization, "Bearer g-at-TEST"); assert.match(mp.body, /"parents":\["fold-1"\]/); assert.match(mp.body, /# Week plan\n\nthe plan/);
  const put = hitsTo(/upload-session/)[0];
  assert.equal(put.size, "fake-mp4-bytes".length, "only the media job's own file went up");
  const dp2 = await s.api("/publish/preview", { method: "POST", body: { channel: "drive", title: "Second", text: "x" } });
  await s.api("/publish/post", { method: "POST", body: { previewId: dp2.json.previewId, confirmed: true } });
  assert.equal(hitsTo(/^\/drive\/v3\/files$/).length, 1, "the app folder is made once and reused");

  // history and ledger: one line each, cost 0
  const hist = (await s.api("/publish/history")).json;
  for (const ch of ["instagram", "slack", "ghl", "drive"]) assert.ok(hist.some((x) => x.channel === ch && x.status === "posted"), ch);
  const led = fs.readFileSync(path.join(s.dir, "ledger.jsonl"), "utf8");
  assert.match(led, /posted · Slack · Week plan/); assert.match(led, /posted · HighLevel social planner/);
});

test("disconnect removes the token; no token or client secret in any data file or the log", async () => {
  const off = await s.api("/publish/connect/slack", { method: "DELETE" });
  assert.equal(off.json.connected, false);
  assert.equal((await s.api("/publish/channels")).json.find((c) => c.id === "slack").ready, false);
  const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", text: "x", channelId: "C0TEAM001" } });
  assert.equal(pv.json.dryRun, true);
  const n = hitsTo(/postMessage/).length;
  const dry = await s.api("/publish/post", { method: "POST", body: { previewId: pv.json.previewId, confirmed: true } });
  assert.equal(dry.json.status, "dry-run"); assert.equal(hitsTo(/postMessage/).length, n, "not connected: nothing sent");

  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name !== "vault.bin") files.push(p); } };
  walk(s.dir);
  const all = files.map((f) => fs.readFileSync(f, "utf8")).join("\n") + s.log;
  for (const t of [...TOKENS, ...Object.values(SECRET)]) assert.ok(!all.includes(t), `${t} is not stored in plain files or logged`);
  assert.ok(fs.existsSync(path.join(s.dir, "vault.bin")));
});
