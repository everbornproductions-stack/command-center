// 0.4.23: the 0.4.22 panel and audit findings (CHRIS-NOTES-0423, section "0.4.22 panel and audit findings").
// X1 safety check false all-clear, X3 publish gate rescans the project folder, X4 page reader redirect re-check,
// X2 reply framing over a raw socket, C1 AI-written code fenced in, S15 splash cap, X5 Freebuff folder,
// X6 Electron window-open, X8 short bench, X13 title masker, X14 sign-in typo. Every case runs real app code.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { ROOT, tmpDir, startServer } from "./helpers.js";
import { runSafetyCheck, luhn } from "../server/safety-check.js";
import { gateForPost } from "../server/plugins/safety.js";
import { defaultFetcher, MAX_PAGE_BYTES } from "../server/page-reader.js";
import { isPublicHttpUrl } from "../server/safe-url.js";
import { runNodeTest, SANDBOX_NOT_RUN_LINE } from "../server/run-node-test.js";
import { allowedFolder } from "../server/plugins/freebuff.js";
import { prepareTask } from "../server/freebuff-agent.js";
import { hidePrivateInTitle } from "../web/finish-text.js";

// key shapes are built from parts so this file never holds a whole key-looking string
const STRIPE_LIVE = "sk_" + "live_" + "4eC39HqLyjWDarjtT1zdp7dcQ9xZ";
const SENDGRID = "SG." + "aB3dE5fG7hJ9kL1mN3pQ5r" + "." + "sT7uV9wX1yZ3aB5cD7eF9gH1jK3lM5nP7qR9sT1uV3w";

const one = (p, text) => runSafetyCheck({ files: [{ path: p, text }] });

test("X1: a Stripe live key is a live secret (red), also in dist/, *.min.js and a test/ folder", () => {
  for (const p of ["server.js", "dist/app.min.js", "build/main.js", "public/app.min.js", "test/setup.js"]) {
    const r = one(p, `const stripe = require("stripe")("${STRIPE_LIVE}");\n`);
    assert.equal(r.light, "red", p);
    assert.equal(r.hasLive, true, p);
    assert.equal(JSON.stringify(r).includes(STRIPE_LIVE), false, `value never comes back (${p})`);
  }
  assert.equal(one("app.js", `const k = "${SENDGRID}";`).light, "red", "SendGrid");
  // a Stripe publishable key is public on purpose, a test key stays low
  assert.equal(one("app.js", `const pk = "pk_live_4eC39HqLyjWDarjtT1zdp7dc";`).hasLive, false);
  assert.equal(one("app.js", `const k = "${"sk_" + "test_4eC39HqLyjWDarjtT1zdp7dcQ9xZ"}";`).hasLive, false, "a Stripe test key is not a live key");
});

test("X1: a Social Security or card number in words to send is red; a sample card in code is not", () => {
  assert.equal(luhn("4111111111111111"), true);
  const ssn = runSafetyCheck({ files: [{ path: "post.txt", text: "My SSN is 123-45-6789, thanks" }], outgoing: ["post.txt"] });
  assert.equal(ssn.light, "red"); assert.equal(ssn.hasPrivate, true);
  assert.equal(JSON.stringify(ssn).includes("123-45-6789"), false, "the number is masked");
  const card = runSafetyCheck({ files: [{ path: "post.txt", text: "Card 4111 1111 1111 1111 exp 02/29" }], outgoing: ["post.txt"] });
  assert.equal(card.light, "red");
  assert.equal(one("checkout.js", `const sample = "4242424242424242";`).hasPrivate, false);
  assert.equal(runSafetyCheck({ files: [{ path: "post.txt", text: "Call 555-123-4567 on 2026-10-27" }], outgoing: ["post.txt"] }).light, "green");
  assert.match(ssn.checkedLine, /Checked 1 file/);
});

function fakeH(dataDir) {
  const docs = {};
  return { DATA_DIR: dataDir, HOSTED: false, settings: () => ({}), doc: (k, d) => (docs[k] ??= d()), putDoc: (k, v) => { docs[k] = v; }, docs };
}

test("X3: the publish gate rescans the project folder on the server and ignores a stored last check", () => {
  const dir = tmpDir("cc-x3-");
  const h = fakeH(dir);
  const proj = path.join(dir, "projects", "p1");
  fs.mkdirSync(path.join(proj, "dist"), { recursive: true });
  fs.writeFileSync(path.join(proj, "index.html"), "<html><head></head><body>hi</body></html>");
  fs.writeFileSync(path.join(proj, "dist", "app.min.js"), `var s="${STRIPE_LIVE}";`);
  // the page posts a clean "last check" for this project; it must not count
  h.docs["safety.last"] = { p1: { light: "green", summary: "No problems", hasLive: false } };
  const g = gateForPost(h, { title: "Launch", text: "Our new site is live", projectId: "p1" });
  assert.equal(g.rescanned, true);
  assert.equal(g.light, "red");
  assert.equal(g.hasLive, true);
  assert.match(g.checkedLine, /project file/);
  const words = gateForPost(h, { title: "x", text: "SSN 123-45-6789" });
  assert.equal(words.hasPrivate, true);
});

test("X1: the server's Words to send paths: Safety check text is red for an SSN; Publish hides it before posting", async () => {
  const s = await startServer();
  try {
    const chk = await s.api("/safety/check", { method: "POST", body: { text: "Here is my SSN 123-45-6789", name: "words.txt" } });
    assert.equal(chk.status, 200, chk.text);
    assert.equal(chk.json.light, "red");
    assert.equal(chk.text.includes("123-45-6789"), false);
    const pv = await s.api("/publish/preview", { method: "POST", body: { channel: "slack", text: "Here is my SSN 123-45-6789" } });
    assert.equal(pv.status, 200, pv.text);
    assert.ok(pv.json.warnings.some((w) => w.rule === "private_numbers_hidden"));
    assert.equal(pv.text.includes("123-45-6789"), false);
  } finally { await s.stop(); }
});

test("X4: the page reader re-checks every redirect hop and caps the page size", async () => {
  const mk = (status, headers = {}, body = "") => ({ status, ok: status < 300, headers: new Headers(headers), body: null, text: async () => body });
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return u.includes("start") ? mk(302, { location: "http://169.254.169.254/latest/meta-data" }) : mk(200, {}, "secret"); };
  const r = await defaultFetcher("https://example.com/start", { fetchImpl });
  assert.equal(r.ok, false); assert.equal(r.status, 403); assert.equal(r.blockedRedirect, true);
  assert.deepEqual(calls, ["https://example.com/start"], "the private address is never fetched");
  const loop = await defaultFetcher("https://example.com/a", { fetchImpl: async (u) => mk(301, { location: u + "x" }) });
  assert.equal(loop.ok, false); assert.equal(loop.status, 508);
  const ok = await defaultFetcher("https://example.com/start", { fetchImpl: async (u) => (u.endsWith("start") ? mk(302, { location: "/page" }) : mk(200, { "content-type": "text/html" }, "<p>hello</p>")) });
  assert.equal(ok.ok, true); assert.equal(ok.url, "https://example.com/page");
  const big = await defaultFetcher("https://example.com/", { fetchImpl: async () => mk(200, {}, "x".repeat(MAX_PAGE_BYTES + 5000)) });
  assert.ok(big.body.length <= MAX_PAGE_BYTES);
  // loopback is refused by default on the desktop too
  assert.equal(isPublicHttpUrl("http://127.0.0.1:9/x"), false);
  assert.equal(isPublicHttpUrl("http://127.0.0.1:9/x", { allowLoopback: true }), true);
});

test("X2: JSON replies have an exact content-length and no transfer-encoding (raw socket)", async () => {
  const s = await startServer({ env: { CC_MCP_HOME: tmpDir("cc-x2-home-") } });
  try {
    for (const p of ["/api/bridge/mcp", "/api/bridge/clients", "/api/health", "/api/state", "/api/safety/status", "/api/look", "/api/nope-not-a-route"]) {
      const raw = await new Promise((resolve, reject) => {
        const c = net.connect(s.port, "127.0.0.1", () => c.write(`GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nx-cc-token: ${s.token}\r\nConnection: close\r\n\r\n`));
        const chunks = []; c.on("data", (d) => chunks.push(d)); c.on("end", () => resolve(Buffer.concat(chunks))); c.on("error", reject);
      });
      const at = raw.indexOf("\r\n\r\n");
      const head = raw.subarray(0, at).toString("latin1").toLowerCase();
      if (!/content-type: application\/json/.test(head)) continue;
      assert.doesNotMatch(head, /transfer-encoding/, p);
      const len = Number(/content-length: (\d+)/.exec(head)?.[1]);
      assert.equal(len, raw.length - at - 4, `${p}: content-length matches the body`);
    }
  } finally { await s.stop(); }
});

test("C1: AI-written code runs fenced in to the project folder", async (t) => {
  const dir = tmpDir("cc-c1-");
  const outside = path.join(os.tmpdir(), `cc-c1-outside-${process.pid}.txt`);
  fs.rmSync(outside, { force: true });
  fs.writeFileSync(path.join(dir, "evil.test.js"), `const fs=require("fs");let w="no";try{fs.writeFileSync(${JSON.stringify(outside)},"x");w="yes"}catch{}let c="no";try{require("child_process").execSync("echo hi");c="yes"}catch{}let r="no";try{fs.readFileSync(${JSON.stringify(path.join(ROOT, "package.json"))});r="yes"}catch{}console.log("WROTE="+w+" CHILD="+c+" READ="+r);`);
  const r = await runNodeTest({ cmd: "node evil.test.js", cwd: dir });
  if (!r.ran) { assert.equal(r.line, SANDBOX_NOT_RUN_LINE); t.diagnostic("this Node has no permission model; nothing ran"); return; }
  assert.match(r.output, /WROTE=no CHILD=no READ=no/);
  assert.equal(fs.existsSync(outside), false);
  // with no sandbox, nothing runs at all
  const none = await runNodeTest({ cmd: "node evil.test.js", cwd: dir, sandboxOk: () => false, spawn: () => { throw new Error("must not spawn"); } });
  assert.deepEqual(none, { ran: false, line: SANDBOX_NOT_RUN_LINE });
});

test("S15: the splash hold is counted from navigation and the 12 s cap is real; off and error paths fade", async () => {
  const js = fs.readFileSync(path.join(ROOT, "web/features/look.js"), "utf8");
  const consts = js.match(/const SPLASH_BASE_MS[^\n]*\n/)[0];
  const hold = new Function(`${consts}\n${js.match(/function splashHold[\s\S]*?\n}\n/)[0]}\n${js.match(/function splashLeft[\s\S]*?\n}\n/)[0]}\nreturn { splashHold, splashLeft };`)();
  assert.equal(hold.splashLeft(hold.splashHold(9000, false), 9000), 3000, "a 9 s start waits only 3 s more");
  assert.equal(hold.splashLeft(hold.splashHold(20000, false), 20000), 0, "past the cap: no extra wait");
  assert.equal(hold.splashLeft(hold.splashHold(100, false), 100), 5100);
  assert.match(js, /catch \{ fadeStartup\(\); return; \}/);
  assert.match(js, /if \(!cfg\?\.flag\) \{ fadeStartup\(\); return; \}/);
  const html = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
  assert.doesNotMatch(html, /16000\)/);
});

test("X5: Freebuff takes only a Meldmind folder and drops control characters", () => {
  const h = { DATA_DIR: tmpDir("cc-x5-") };
  assert.ok(allowedFolder(h, os.homedir()).error);
  assert.ok(allowedFolder(h, path.join(h.DATA_DIR, "projects", "..", "..")).error);
  assert.ok(allowedFolder(h, path.join(h.DATA_DIR, "projects", "a\u001b[2J")).error);
  assert.equal(allowedFolder(h, path.join(h.DATA_DIR, "projects", "p1")).folder, path.join(h.DATA_DIR, "projects", "p1"));
  assert.equal(allowedFolder(h, undefined).folder, undefined);
  assert.equal(prepareTask("fix\u001b[2J the bug\u0007\nline two"), "fix[2J the bug\nline two");
});

test("X6, X14, X8: window-open is exact-origin and deny by default; sign-in box typo fixed", () => {
  const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8");
  assert.match(main, /const ownOrigin = \(u\) =>/);
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{ if \(ownOrigin\(url\)\) return \{ action: "allow" \};[^\n]*return \{ action: "deny" \}; \}\);/);
  assert.doesNotMatch(main, /return \{ action: "deny" \}; \} return \{ action: "allow" \}/);
  const app = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  assert.doesNotMatch(app, /requiredplaceholder/);
  assert.match(app, /id="gate-email"[^>]*required placeholder=/);
});

test("X13: the title masker keeps spaces and plain numbers, still hides SSN and card numbers", () => {
  assert.equal(hidePrivateInTitle("Card number 4111 1111 1111 1111 for Bob"), "Card number [hidden] for Bob");
  assert.equal(hidePrivateInTitle("Years 2026 2027 2028 2029 plan"), "Years 2026 2027 2028 2029 plan");
  assert.equal(hidePrivateInTitle("SSN 123-45-6789 form"), "SSN [hidden] form");
});
