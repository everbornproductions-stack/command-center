// Phase 5: PWA and web push (VAPID). A local mock push service on a random port stands in for the browser's
// push service; the test decrypts each message the way a browser would (RFC 8291) and checks the VAPID
// signature (RFC 8292). Opt-in only: job-done pushes stay off until turned on. Temp data dir, demo AIs only,
// no real push service, key or URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT, startServer } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

// A pretend browser: its own P-256 key pair and auth secret, like PushSubscription.toJSON().keys
function makeClient() {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}

function decrypt(client, body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = client.ecdh.computeSecret(serverPub);
  const ikm = hkdf(client.auth, shared, Buffer.concat([Buffer.from("WebPush: info\0"), client.ecdh.getPublicKey(), serverPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last record delimiter");
  return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
}

function verifyVapid(header, origin) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || "");
  assert.ok(m, "Authorization: vapid t=..., k=...");
  const [h, p, sig] = m[1].split(".");
  const pub = fromB64u(m[2]);
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, fromB64u(sig)), "the VAPID JWT is signed by the app's key");
  const claims = JSON.parse(fromB64u(p).toString("utf8"));
  assert.equal(claims.aud, origin);
  assert.ok(claims.exp > Date.now() / 1000);
  return m[2];
}

async function mockPushService() {
  const got = [];
  let answer = 201;
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(answer); res.end(); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  return { got, origin, setAnswer: (n) => { answer = n; }, close: () => new Promise((r) => srv.close(r)) };
}

async function waitFor(fn, what, ms = 30000) {
  for (let t = 0; t < ms; t += 100) { const v = fn(); if (v) return v; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}

async function chat(s, prompt) {
  const before = new Set((await s.api("/missions")).json.map((m) => m.id));
  assert.equal((await s.api("/chat", { method: "POST", body: { prompt, provider: "demo-nova", model: "nova-lite" } })).status, 202);
  for (let i = 0; i < 240; i++) {
    const m = (await s.api("/missions")).json.find((x) => !before.has(x.id) && x.kind === "single" && ["done", "failed"].includes(x.status));
    if (m) return m;
    await sleep(250);
  }
  throw new Error("chat did not finish");
}

test("push: subscriptions are checked, messages are encrypted and VAPID-signed, job done is opt-in, gone devices drop off", { timeout: 180000 }, async () => {
  const push = await mockPushService();
  const s = await startServer();
  try {
    await s.api("/demo", { method: "POST", body: { on: true } });
    let st = (await s.api("/alerts/state")).json;
    assert.equal(st.pushDevices, 0, "no device until someone enables push on it");
    assert.equal(st.prefs.jobDoneOn, false, "job-done push is off by default");
    assert.match(st.vapidPublicKey, /^[A-Za-z0-9_-]{87}$/, "a P-256 public key for applicationServerKey");

    const client = makeClient();
    for (const bad of [
      { endpoint: "http://example.com/push/x", keys: client.keys },
      { endpoint: "ftp://127.0.0.1/x", keys: client.keys },
      { endpoint: "https://user:pw@push.example/x", keys: client.keys },
      { endpoint: "not a url", keys: client.keys },
      { endpoint: `${push.origin}/push/a`, keys: { p256dh: client.keys.p256dh } },
    ]) assert.equal((await s.api("/alerts/subscribe", { method: "POST", body: bad })).status, 400, `refused: ${bad.endpoint}`);
    assert.equal((await s.api("/alerts/subscribe", { method: "POST", body: { endpoint: `${push.origin}/push/a`, keys: client.keys }, noToken: true })).status, 401, "needs the session token");

    const sub = await s.api("/alerts/subscribe", { method: "POST", body: { endpoint: `${push.origin}/push/a`, keys: client.keys } });
    assert.equal(sub.status, 200);
    assert.equal(sub.json.devices, 1);
    assert.equal((await s.api("/alerts/subscribe", { method: "POST", body: { endpoint: `${push.origin}/push/a`, keys: client.keys } })).json.devices, 1, "the same device is not added twice");

    // a test alert: encrypted, signed, decryptable by the device only
    assert.equal((await s.api("/alerts/test", { method: "POST" })).status, 200);
    const first = await waitFor(() => push.got[0], "the test push");
    assert.equal(first.path, "/push/a");
    assert.equal(first.headers["content-encoding"], "aes128gcm");
    assert.equal(first.headers.ttl, "86400");
    assert.equal(verifyVapid(first.headers.authorization, push.origin), st.vapidPublicKey);
    assert.ok(!first.body.includes(Buffer.from("Test alert")), "the message is not readable in transit");
    assert.equal(decrypt(client, first.body).title, "Test alert");
    assert.throws(() => decrypt(makeClient(), first.body), "another device cannot read it");

    // job done is opt-in: a finished chat sends nothing while it is off
    const n0 = push.got.length;
    const off = await chat(s, "Write a one-line tagline for a bakery.");
    assert.equal(off.status, "done");
    await sleep(1500);
    assert.equal(push.got.length, n0, "no job-done push while it is off");

    const prefs = (await s.api("/alerts/prefs", { method: "POST", body: { jobDoneOn: true } })).json;
    assert.equal(prefs.jobDoneOn, true);
    assert.equal(prefs.pushOn, true, "other preferences stay");
    const on = await chat(s, "Write a one-line tagline for a florist.");
    const msg = await waitFor(() => push.got.slice(n0).map((g) => decrypt(client, g.body)).find((d) => d.tag === `cc-job-${on.id}`), "the job-done push");
    assert.equal(msg.title, "Chat done");
    assert.match(msg.body, /florist/);
    assert.equal(msg.url, undefined, "the push carries no link; a click opens the app itself");
    await sleep(800);
    assert.equal(push.got.slice(n0).map((g) => decrypt(client, g.body)).filter((d) => d.tag === `cc-job-${on.id}`).length, 1, "one push per finished run");

    // push off overall: nothing, even with job done on
    await s.api("/alerts/prefs", { method: "POST", body: { pushOn: false } });
    const n1 = push.got.length;
    await chat(s, "Write a one-line tagline for a gym.");
    await sleep(1500);
    assert.equal(push.got.length, n1, "push off means no push");
    await s.api("/alerts/prefs", { method: "POST", body: { pushOn: true } });

    // a device the push service says is gone (410) is removed
    push.setAnswer(410);
    await s.api("/alerts/test", { method: "POST" });
    for (let i = 0; i < 100 && (await s.api("/alerts/state")).json.pushDevices !== 0; i++) await sleep(100);
    assert.equal((await s.api("/alerts/state")).json.pushDevices, 0, "a 410 removes the device");
    push.setAnswer(201);

    // turn off push here: the device leaves the list
    const other = makeClient();
    assert.equal((await s.api("/alerts/subscribe", { method: "POST", body: { endpoint: `${push.origin}/push/b`, keys: other.keys } })).json.devices, 1);
    const un = await s.api("/alerts/unsubscribe", { method: "POST", body: { endpoint: `${push.origin}/push/b` } });
    assert.equal(un.json.removed, 1);
    assert.equal(un.json.devices, 0);
    assert.equal((await s.api("/alerts/unsubscribe", { method: "POST", body: { endpoint: "https://nope.example/x" } })).json.removed, 0);

    // the subscription keys and the VAPID private key are never in the log or the state
    const state = (await s.api("/alerts/state")).text;
    assert.ok(!state.includes(client.keys.auth) && !state.includes("privateKey"), "no device secrets or private key in the state");
    assert.ok(!s.log.includes(client.keys.auth), "no device secret in the log");
  } finally { await s.stop(); await push.close(); }
});

test("PWA: installable manifest, icons, served worker files, decisions kept", async () => {
  const manifest = JSON.parse(read("web", "manifest.webmanifest"));
  assert.equal(manifest.name, "Meldmind");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  for (const size of ["192x192", "512x512"]) assert.ok(manifest.icons.some((i) => i.sizes === size), `a ${size} icon`);
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "a maskable icon for Android");
  for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, "web", i.src)), `${i.src} exists`);
  const html = read("web", "index.html");
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);

  // decision 7: the shell worker never takes over on install, HTML is never cached, the desktop app has no worker
  const sw = read("web", "sw.js");
  assert.doesNotMatch(sw.split('addEventListener("message"')[0], /skipWaiting\(\)/);
  assert.match(sw, /mode === "navigate"/);
  const app = read("web", "app.js");
  assert.match(app, /window\.ccDesktop\?\.desktop\) \{\s*navigator\.serviceWorker\.getRegistrations\(\)/);

  // push worker: shows the notification, a click only ever opens the app's own page
  const psw = read("web", "features", "alerts-sw.js");
  assert.match(psw, /showNotification/);
  assert.match(psw, /openWindow\("\/"\)/);
  assert.doesNotMatch(psw, /openWindow\(d\./, "never a URL taken from the push message");
  // the desktop app explains push belongs on the phone instead of registering a worker it will delete
  const fe = read("web", "features", "alerts.js");
  assert.match(fe, /if \(window\.ccDesktop\?\.desktop\) throw new Error\(DESKTOP_PUSH\)/);
  assert.match(fe, /Turn off push here/);
  assert.match(fe, /Push is opt-in/);
  for (const f of ["web/features/alerts.js", "web/features/alerts-sw.js", "server/plugins/alerts.js", "web/features/voice.js"]) assert.ok(!read(f).includes("—"), `no em-dash in ${f}`);

  const s = await startServer();
  try {
    const m = await s.raw({ path: "/manifest.webmanifest" });
    assert.equal(m.status, 200);
    assert.equal(JSON.parse(m.text).short_name, "Meldmind");
    const w = await s.raw({ path: "/features/alerts-sw.js" });
    assert.equal(w.status, 200);
    assert.match(String(w.headers["content-type"]), /javascript/);
  } finally { await s.stop(); }
});
