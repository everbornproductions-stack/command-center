// Phase 11: server hardening. Static files revalidate with an ETag (304, no body) while HTML stays no-store;
// a taken port is a clear message and exit code 1; the demo AIs move to a free port when theirs is taken.
// (The test helper's own fix, an instance id per child and a retry on a lost port race, is in helpers.js.)
// Temp data dirs, demo mode only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { startServer, freePort, tmpDir, ROOT } from "./helpers.js";

const hold = (port) => new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(port, "127.0.0.1", () => resolve(s)); });

test("static files: ETag and 304 for scripts and styles, HTML never cached, nothing outside web/", async () => {
  const s = await startServer();
  try {
    const js = await s.raw({ path: "/app.js" });
    assert.equal(js.status, 200);
    assert.match(js.headers.etag || "", /^W\/"/);
    assert.equal(js.headers["cache-control"], "no-cache");
    assert.equal(Number(js.headers["content-length"]), Buffer.byteLength(js.text));
    const again = await s.raw({ path: "/app.js", headers: { "if-none-match": js.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.text, "");
    const stale = await s.raw({ path: "/app.js", headers: { "if-none-match": 'W/"old"' } });
    assert.equal(stale.status, 200, "a changed file is sent again");
    const css = await s.raw({ path: "/styles.css" });
    assert.ok(css.headers.etag);
    // decision 7: HTML is never cached
    const home = await s.raw({ path: "/" });
    assert.equal(home.headers["cache-control"], "no-store");
    assert.equal(home.headers.etag, undefined);
    const share = await s.raw({ path: "/share.html" });
    assert.equal(share.headers.etag, undefined);
    // nothing outside web/, including a sibling folder whose name starts with "web"
    for (const p of ["/../package.json", "/..%2fpackage.json", "/../web-other/x.js"]) assert.equal((await s.raw({ path: p })).status, 404, p);
  } finally { await s.stop(); }
});

test("a taken port: clear message and exit code 1, not a stack trace", async () => {
  const port = await freePort();
  const blocker = await hold(port);
  const dir = tmpDir();
  try {
    const env = { ...process.env, CC_DATA_DIR: dir, CC_PORT: String(port), CC_DEMO_PORT: String(await freePort()), CC_HQ_DIR: path.join(dir, "none"), CC_UPDATE_FEED: "http://127.0.0.1:9/latest.json", CC_CLOUD_DEFAULTS_FILE: path.join(dir, "cloud.json"), CC_OPENROUTER_MODELS_URL: "http://127.0.0.1:9/models", NODE_OPTIONS: `--require ${path.join(ROOT, "test", "vault-shim.cjs")}` };
    for (const k of ["CC_MODE", "CC_SUPABASE_URL", "CC_SUPABASE_ANON_KEY", "CC_DEV_OWNER", "CC_PACKAGED"]) delete env[k];
    fs.writeFileSync(env.CC_CLOUD_DEFAULTS_FILE, JSON.stringify({ url: "", anonKey: "" }));
    const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; child.stdout.on("data", (c) => (log += c)); child.stderr.on("data", (c) => (log += c));
    const code = await new Promise((r) => { const t = setTimeout(() => { child.kill(); r("timeout"); }, 20000); child.once("exit", (c) => { clearTimeout(t); r(c); }); });
    assert.equal(code, 1, log);
    assert.match(log, new RegExp(`port ${port} in use`));
    assert.doesNotMatch(log, /^\s+at /m, "no stack trace");
  } finally { blocker.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("demo AIs: a taken demo port moves them to a free one and they still answer", async () => {
  const demoPort = await freePort();
  const blocker = await hold(demoPort);
  const s = await startServer({ env: { CC_DEMO_PORT: String(demoPort) } });
  try {
    const on = await s.api("/demo", { method: "POST", body: { on: true } });
    assert.equal(on.status, 200, on.text);
    const r = await s.api(`/route?prompt=${encodeURIComponent("Write a short product description for a desk lamp.")}&mode=balanced`);
    assert.equal(r.status, 200, r.text);
    assert.notEqual(r.json.classification.source, "heuristic", "a demo AI answered the classification");
    assert.ok(r.json.ranked.some((m) => String(m.provider).startsWith("demo-")));
  } finally { await s.stop(); blocker.close(); }
});
