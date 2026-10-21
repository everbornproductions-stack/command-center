// Hosted worker (Node). One process can serve the same web UI and run the
// job queue. Keys are opened only inside the job, then dropped.
// Standalone: node server/worker-service.js
// The desktop app posts sealed jobs here. It never sends a raw key.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { WEB_DIR } from "./paths.js";
import { VERSION } from "./update.js";
import { DESKTOP_ONLY } from "../web/desktop-only.js";
import { publicWebConfig } from "./web-config.js";
import { createWorkerKeypair, openSecret } from "./hosted-vault.js";
import { budgetDecision, createQueue, publicJob } from "./hosted-queue.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

const CLOUD_LABEL = "Running in the cloud";

export function defaultRunner({ secrets, job }) {
  const names = Object.keys(secrets || {});
  const what = job.kind === "mission" ? "Mission" : "Schedule";
  const cost = Math.min(Number(job.estimateUsd) || 0, Number(job.budgetUsd) || 0);
  return {
    status: "done",
    cost,
    text: `${what} "${job.title || job.refId}" ran on the hosted worker. ${names.length ? "Your keys were opened only for this job." : "No key was attached."}`,
  };
}

function tokenOk(presented, expected) {
  const a = Buffer.from(String(presented || ""));
  const b = Buffer.from(String(expected || ""));
  if (!expected || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 1024 * 1024) { reject(Object.assign(new Error("Body too large."), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error("Body must be JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

export function createHostedWorker(opts = {}) {
  const queue = opts.queue || createQueue();
  const keys = opts.publicKey && opts.privateKey
    ? { publicKey: opts.publicKey, privateKey: opts.privateKey }
    : (opts.keys || createWorkerKeypair());
  const runner = opts.runner || defaultRunner;
  const token = opts.token ?? process.env.CC_WORKER_TOKEN ?? "";
  let pumping = false;

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const job = queue.claimNext();
        if (!job) break;
        const secrets = {};
        try {
          for (const envelope of job.envelopes || []) {
            if (envelope.userId !== job.userId) throw new Error("wrong user");
            secrets[envelope.provider] = openSecret({ privateKey: keys.privateKey, envelope });
          }
          const decision = budgetDecision({ budgetUsd: job.budgetUsd, nextUsd: job.estimateUsd || 0 });
          if (!decision.ok) {
            queue.finish(job.userId, job.id, { status: "stopped", cost: 0, text: decision.reason }, secrets);
            continue;
          }
          const view = publicJob(job);
          const result = await runner({ userId: job.userId, secrets, job: { ...view, prompt: job.prompt, estimateUsd: job.estimateUsd } });
          queue.finish(job.userId, job.id, result, secrets);
        } catch {
          queue.finish(job.userId, job.id, { status: "failed", cost: 0, text: "The hosted worker could not finish this job." }, secrets);
        }
      }
    } finally {
      pumping = false;
    }
  }

  function kick() {
    setImmediate(() => { pump().catch(() => {}); });
  }

  async function handleApi(req, res, url) {
    const send = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
      res.end(text);
    };
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return send(200, { ok: true, app: "command-ai", mode: "hosted", surface: "web", worker: true, version: VERSION });
      }
      if (req.method === "GET" && url.pathname === "/api/config") {
        return send(200, publicWebConfig({
          hosted: true,
          version: VERSION,
          supabase: { url: process.env.CC_SUPABASE_URL || "", anonKey: process.env.CC_SUPABASE_ANON_KEY || "" },
          hub: process.env.CC_HUB_URL || null,
          sso: [],
        }));
      }
      if (req.method === "GET" && url.pathname === "/api/worker/public-key") {
        return send(200, { publicKey: keys.publicKey, alg: "RSA-OAEP-256" });
      }
      if (!url.pathname.startsWith("/api/worker/")) return false;
      if (!tokenOk(req.headers["x-cc-worker-token"], token)) return send(401, { error: "Worker token required.", code: "worker_token" });
      if (req.method === "GET" && url.pathname === "/api/worker/jobs") {
        const userId = url.searchParams.get("userId") || "";
        const jobs = queue.list(userId);
        const running = jobs.some((j) => j.status === "queued" || j.status === "running");
        return send(200, { jobs, running, label: running ? CLOUD_LABEL : null, desktopOnly: DESKTOP_ONLY });
      }
      const body = req.method === "POST" ? await readBody(req) : {};
      if (req.method === "POST" && url.pathname === "/api/worker/jobs") {
        const job = queue.add(body.userId, body);
        if (job.status === "queued") kick();
        const running = job.status === "queued" || job.status === "running";
        return send(202, { job, runningInCloud: running, label: running ? CLOUD_LABEL : null });
      }
      if (req.method === "POST" && url.pathname === "/api/worker/sync") {
        const out = queue.sync(body.userId);
        return send(200, { ...out, label: out.running ? CLOUD_LABEL : null });
      }
      return send(404, { error: "Not found." });
    } catch (e) {
      return send(e.status || 500, { error: e.message || "The worker could not do that.", code: e.code });
    }
  }

  function serveStatic(req, res, url) {
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    file = path.normalize(path.join(WEB_DIR, file));
    if ((file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": path.extname(file) === ".html" ? "no-store" : "no-cache",
      "content-length": body.length,
    });
    res.end(body);
  }

  function handle(req, res) {
    let url;
    try { url = new URL(req.url, "http://127.0.0.1/"); }
    catch { res.writeHead(400); res.end("bad url"); return; }
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url).then((done) => { if (done === false) serveStatic(req, res, url); }).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: e.message || "worker error" }));
        }
      });
      return;
    }
    serveStatic(req, res, url);
  }

  return {
    handle,
    handleApi,
    queue,
    publicKey: keys.publicKey,
    kick,
    start(port = 0) {
      const server = http.createServer(handle);
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
      });
    },
  };
}

export function isWorkerPath(pathname) {
  return pathname === "/api/worker" || String(pathname || "").startsWith("/api/worker/");
}

let shared = null;
export function sharedWorker() {
  if (!shared) shared = createHostedWorker();
  return shared;
}

export async function handleWorkerRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1/");
  await sharedWorker().handleApi(req, res, url);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 8080);
  const worker = sharedWorker();
  http.createServer(worker.handle).listen(port, "0.0.0.0", () => {
    console.log(`Meldmind hosted worker on :${port} (web UI and job queue)`);
  });
}
