// Shared test plumbing: start the real server as a child process on a random free port with a
// temporary CC_DATA_DIR, demo mode only, no real keys, and every outbound address (licence server,
// update feed) pointed at a local stub. Nothing here touches data/ or the real Supabase project.
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export const tmpDir = (prefix = "cc-test-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// Raw HTTP request (lets a test set Host / Origin / content-type exactly). Returns { status, headers, text, json }.
export function raw({ port, host = "127.0.0.1", method = "GET", path: p = "/", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
    const h = { ...headers };
    if (data !== null && h["content-length"] === undefined) h["content-length"] = Buffer.byteLength(data);
    const req = http.request({ host, port, method, path: p, headers: h }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
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
export async function startServer({ env = {}, dataDir, cloud, seed } = {}) {
  const dir = dataDir || tmpDir();
  const port = await freePort();
  const demoPort = await freePort();
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
  };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === "" || childEnv[k] === undefined) delete childEnv[k];
  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (c) => (log += c));
  child.stderr.on("data", (c) => (log += c));
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 20000 && !up) {
    if (child.exitCode !== null) break;
    try { const r = await raw({ port, path: "/api/health" }); up = r.status === 200; } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) { child.kill(); await stub.close(); throw new Error("server did not start:\n" + log); }

  let token = "";
  const home = await raw({ port, path: "/" });
  const mt = home.text.match(/<meta name="cc-token" content="([^"]+)"/);
  if (mt) token = mt[1];

  const api = (p, { method = "GET", body, headers = {}, noToken = false } = {}) =>
    raw({ port, method, path: "/api" + p, headers: { "content-type": "application/json", ...(token && !noToken ? { "x-cc-token": token } : {}), ...headers }, body });

  return {
    port, dir, child, stub, token, base: `http://127.0.0.1:${port}`, api, raw: (o) => raw({ port, ...o }),
    get log() { return log; },
    async stop() { child.kill(); await new Promise((r) => { child.once("exit", r); setTimeout(r, 2000); }); await stub.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} },
  };
}
