// Shared test plumbing: start the real server as a child process on a random free port with a
// temporary CC_DATA_DIR, demo mode only, no real keys, and every outbound address (licence server,
// update feed) pointed at a local stub. Nothing here touches data/ or the real Supabase project.
import { spawn, spawnSync, execFile } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every mock in this process closes its socket. Windows CI reuses a keep-alive
// socket after a finished reply, and the next provider call then waits forever.
const origWriteHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...args) {
  try { if (!this.headersSent) this.setHeader("Connection", "close"); } catch {}
  return origWriteHead.apply(this, args);
};

// server.close() waits for idle keep-alive sockets. On Windows that wait outlives
// the test, and the next file inherits the open port and the open child. Drop them.
const origClose = http.Server.prototype.close;
http.Server.prototype.close = function (cb) {
  try { this.closeAllConnections(); } catch {}
  return origClose.call(this, cb);
};

// A wait that is comfortable on Linux expires on a busy Windows runner while the
// chat is still finishing. The budget is only the ceiling. A finished run returns
// on the next poll, so a passing test is not slower.
export function waitBudget(ms) {
  if (process.platform !== "win32") return ms;
  return ms * 2;
}

const RUN_DONE = ["done", "done-with-errors", "failed"];

// A Windows runner can stamp a run a tick before Date.now() in the test process.
// Wait on the id /chat returns, not on startedAt > now.
export function runSettled(id) {
  return (st) => (st.missions || []).find((m) => m.id === id && RUN_DONE.includes(m.status));
}

export async function chatRunId(api, body) {
  const posted = await api("/chat", { method: "POST", body });
  if (posted.status !== 202 || !/^s-/.test(posted.json?.runId || "")) {
    throw new Error(`chat did not start (${posted.status})`);
  }
  return posted.json.runId;
}

// Council and mission do not return an id. Ignore runs that already existed.
export async function newKindPred(api, route, body, kind) {
  const before = new Set(((await api("/state")).json.missions || []).map((m) => m.id));
  const posted = await api(route, { method: "POST", body });
  if (posted.status !== 202) throw new Error(`${route} did not start (${posted.status})`);
  return (st) => (st.missions || []).find((m) => m.kind === kind && !before.has(m.id) && RUN_DONE.includes(m.status));
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export const tmpDir = (prefix = "cc-test-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// Raw HTTP request (lets a test set Host / Origin / content-type exactly). Returns { status, headers, text, json }.
// One socket per call, and the call gives up after a real pause so a wait loop can poll again.
export function raw({ port, host = "127.0.0.1", method = "GET", path: p = "/", headers = {}, body, timeout = 20000 }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const h = { connection: "close", ...headers };
    if (data !== null && h["content-length"] === undefined) h["content-length"] = Buffer.byteLength(data);
    const req = http.request({ host, port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`timed out after ${timeout}ms: ${method} ${p}`)));
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

function destroyPipes(child) {
  if (!child) return;
  for (const stream of [child.stdout, child.stderr, child.stdin]) {
    try { stream?.destroy(); } catch {}
  }
}

function killTree(child) {
  const pid = child?.pid;
  if (!pid) {
    try { child.kill("SIGKILL"); } catch {}
    return Promise.resolve();
  }
  // TerminateProcess does not stop grandchildren. The demo stdio server is one.
  // taskkill /F /T stops that tree. A graceful kill can sit on an open pipe.
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 3000 }, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try { child.kill("SIGKILL"); } catch {}
  return Promise.resolve();
}

const liveChildren = new Set();
function trackChild(child) {
  if (!child) return;
  liveChildren.add(child);
  child.once("exit", () => liveChildren.delete(child));
}
// force-exit still runs this. A child left behind keeps the next Windows job busy.
process.on("exit", () => {
  for (const child of liveChildren) {
    const pid = child?.pid;
    if (!pid) continue;
    if (process.platform === "win32") {
      try { spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 2000 }); } catch {}
    } else {
      try { child.kill("SIGKILL"); } catch {}
    }
  }
});

// Wait for the exit, then force the tree, then drop the pipes so a stuck child
// cannot keep the test process or the next test alive.
function reapChild(child) {
  return new Promise((resolve) => {
    if (!child) return resolve();
    let settled = false;
    let giveUp;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(giveUp);
      destroyPipes(child);
      resolve();
    };
    // The tree is already being killed. This is only so a stuck taskkill
    // cannot hold the next test. The exit hook kills anything still alive.
    giveUp = setTimeout(() => { try { child.unref(); } catch {} finish(); }, 5000);
    child.once("exit", finish);
    if (child.exitCode !== null || child.signalCode !== null) return finish();
    killTree(child).catch(() => {});
  });
}

async function closeQuiet(close) {
  await Promise.race([
    Promise.resolve().then(() => close()).catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
}

// A tiny local stand-in for Supabase, the update feed and the OpenRouter models list (404 unless a test serves one). `rpc` decides what verify_license /
// redeem_promo answer; every request is recorded in `hits`.
export async function startStub({ rpc = () => ({ ok: false, tier: "free", status: "unknown", message: "stub: not found" }) } = {}) {
  const port = await freePort();
  const hits = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    hits.push({ method: req.method, path: url.pathname, headers: req.headers, body: body ? JSON.parse(body) : null });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (url.pathname === "/latest.json") return send(200, { version: "0.0.1", notes: "stub", url: null });
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m) { const out = rpc(m[1], body ? JSON.parse(body) : {}, req); return send(out?.httpStatus || 200, out?.rows ?? [out]); }
    send(404, { message: "stub: no route" });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { port, url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) };
}

// Start server/index.js in a child process. Returns helpers bound to that instance.
// Test files run in parallel, so a port that was free a moment ago can be taken by another test's
// server or mock before this child binds it. The child then exits, and a plain health check would get
// an answer from the OTHER test's server (the Phase 11 ECONNRESET flake when that test shut it down).
// So each child gets its own instance id, only a health answer echoing it counts (as the desktop app
// does, decision 6), and a lost race is retried on new ports.
export async function startServer(opts = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await startServerOnce(opts); }
    catch (e) { lastErr = e; if (!e.portRace) throw e; }
  }
  throw lastErr;
}

async function startServerOnce({ env = {}, dataDir, cloud, seed } = {}) {
  const dir = dataDir || tmpDir();
  const port = await freePort();
  const demoPort = await freePort();
  const instance = env.CC_INSTANCE || `test-${process.pid}-${port}-${Math.random().toString(36).slice(2, 10)}`;
  const stub = await startStub(cloud || {});
  const defaultsFile = path.join(dir, "cloud-defaults.test.json");
  // the shipped defaults are replaced by a stub so no test ever talks to the real project
  fs.writeFileSync(defaultsFile, JSON.stringify(cloud ? { url: stub.url, anonKey: "sb_publishable_test" } : { url: "", anonKey: "" }));
  if (typeof seed === "function") seed(dir);
  const childEnv = {
    ...process.env,
    CC_MODE: "", CC_DATA_DIR: dir, CC_PORT: String(port), CC_DEMO_PORT: String(demoPort),
    CC_UPDATE_FEED: `${stub.url}/latest.json`, CC_CLOUD_DEFAULTS_FILE: defaultsFile,
    CC_OPENROUTER_MODELS_URL: `${stub.url}/openrouter/models`, // live prices (Phase 24): never the real OpenRouter
    CC_SUPABASE_URL: "", CC_SUPABASE_ANON_KEY: "", CC_DEV_OWNER: "", CC_PACKAGED: "", CC_HQ_DIR: path.join(dir, "no-hq-here"),
    ...env,
    CC_CLI_SCAN: "0", CC_WIN_ENV_SCAN: "0", CC_CLI_CONNECTED: env.CC_CLI_CONNECTED || "",
    CC_INSTANCE: instance,
    CC_NET_TRACE: "1",
    NODE_OPTIONS: `${env.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? ""} --require ${path.join(ROOT, "test", "vault-shim.cjs")}`.trim(),
  };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === "" || childEnv[k] === undefined) delete childEnv[k];
  // Linux CI has no OS keychain. The preload seals the test vault; the app never loads it.
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(ROOT, "test", "vault-preload.mjs")).href, path.join(ROOT, "server", "index.js")], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  trackChild(child);
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  const t0 = Date.now();
  let up = false;
  const startBudget = waitBudget(20000);
  while (Date.now() - t0 < startBudget && !up) {
    if (child.exitCode !== null) break;
    try { const r = await raw({ port, path: "/api/health", timeout: 5000 }); up = r.status === 200 && r.json?.instance === instance; } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) {
    await reapChild(child); await closeQuiet(() => stub.close());
    const err = new Error("server did not start:\n" + log);
    err.portRace = /EADDRINUSE|port \d+ in use/i.test(log);
    if (err.portRace && !dataDir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
    throw err;
  }

  let token = "";
  const home = await raw({ port, path: "/" });
  const mt = home.text.match(/<meta name="cc-token" content="([^"]+)"/);
  if (mt) token = mt[1];

  const api = (p, { method = "GET", body, headers = {}, noToken = false } = {}) =>
    raw({ port, method, path: "/api" + p, headers: { "content-type": "application/json", ...(token && !noToken ? { "x-cc-token": token } : {}), ...headers }, body });

  return {
    port, dir, child, stub, token, base: `http://127.0.0.1:${port}`, api, raw: (o) => raw({ port, ...o }),
    get log() { return log; },
    async stop() {
      await reapChild(child);
      await closeQuiet(() => stub.close());
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}
