// Hosted runs (Extreme) and the hosted web worker. A local mock worker only.
// No real key, no network, no data/ folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, ROOT } from "./helpers.js";
import { hostedRunsAllowed, gateHostedRuns } from "../server/feature-gate.js";
import { resolveTier, TIERS } from "../server/license.js";
import { publicWebConfig } from "../server/web-config.js";
import { createWorkerKeypair, sealSecret, sealSecrets, openSecret } from "../server/hosted-vault.js";
import { createQueue, budgetDecision } from "../server/hosted-queue.js";
import { createHostedWorker } from "../server/worker-service.js";
import { menuModel } from "../web/nav.js";
import { DESKTOP_ONLY, isDesktopOnly } from "../web/desktop-only.js";

const EM = "\u2014";
const SECRET = "sk-test-hosted-not-real";
const SERVICE = "do-not-leak-service";

test("feature gate: Extreme and owner only", () => {
  assert.equal(hostedRunsAllowed("extreme"), true);
  assert.equal(hostedRunsAllowed("owner"), true);
  assert.equal(hostedRunsAllowed("pro"), false);
  assert.equal(hostedRunsAllowed("studio"), false);
  assert.equal(hostedRunsAllowed("free"), false);
  assert.equal(hostedRunsAllowed(""), false);
  assert.throws(() => gateHostedRuns("pro"), (e) => e.status === 402 && e.code === "extreme_required");
  assert.equal(gateHostedRuns("extreme").feature, "hostedRuns");
  assert.equal(resolveTier({ lic: { tier: "extreme", status: "active", lastOkAt: Date.now() } }).tier, "extreme");
  assert.equal(TIERS.extreme.missions, true);
  assert.equal(TIERS.extreme.label, "Extreme");
  assert.equal(TIERS.pro.label, "Pro");
});

test("client seals a key and only the worker opens it", () => {
  const { publicKey, privateKey } = createWorkerKeypair();
  const envelope = sealSecret({ publicKey, userId: "user-a", provider: "openai", secret: SECRET });
  assert.equal(JSON.stringify(envelope).includes(SECRET), false);
  assert.equal(envelope.provider, "openai");
  assert.equal(openSecret({ privateKey, envelope }), SECRET);
  assert.throws(() => openSecret({ privateKey, envelope: { ...envelope, userId: "user-b" } }));
  const many = sealSecrets({ publicKey, userId: "user-a", secrets: { openai: { key: SECRET }, pool: { key: "nope", managed: true } } });
  assert.equal(many.length, 1);
  assert.equal(JSON.stringify(many).includes(SECRET), false);
});

test("queue: opt-in, budget, and per-user isolation", () => {
  const q = createQueue();
  assert.throws(() => q.add("a", { kind: "schedule", optIn: false, budgetUsd: 1 }), (e) => e.code === "opt_in");
  assert.equal(budgetDecision({ budgetUsd: 1, nextUsd: 2 }).ok, false);
  const stopped = q.add("a", { kind: "mission", optIn: true, budgetUsd: 1, estimateUsd: 5, refId: "m1", title: "Over" });
  assert.equal(stopped.status, "stopped");
  assert.match(stopped.text, /budget/);
  const job = q.add("a", { kind: "schedule", optIn: true, budgetUsd: 1, refId: "s1", title: "Mine" });
  assert.equal(job.status, "queued");
  q.add("b", { kind: "schedule", optIn: true, budgetUsd: 1, refId: "s2", title: "Theirs" });
  assert.deepEqual(q.list("a").map((j) => j.title), ["Over", "Mine"]);
  assert.deepEqual(q.list("b").map((j) => j.title), ["Theirs"]);
  const claimed = q.claimNext();
  assert.equal(claimed.userId, "a");
  assert.equal(claimed.title, "Mine");
  q.finish("a", claimed.id, { status: "done", cost: 5, text: `saw ${SECRET}` }, { openai: SECRET });
  const done = q.list("a").find((j) => j.id === claimed.id);
  assert.equal(done.status, "stopped");
  assert.equal(done.text.includes(SECRET), false);
  assert.match(done.text, /budget/);
  const synced = q.sync("a");
  assert.equal(synced.jobs.length, 2);
  assert.equal(q.sync("a").jobs.length, 0);
  assert.equal(q.sync("b").jobs.length, 0);
});

test("mock worker: sealed key, budget, isolation, web UI, no service key", async () => {
  const seen = [];
  let calls = 0;
  const worker = createHostedWorker({
    token: "test-worker-token",
    runner: async ({ userId, secrets }) => {
      calls += 1;
      seen.push({ userId, opened: Object.values(secrets).includes(SECRET) });
      return { status: "done", cost: 0.02, text: "The worker opened a sealed key." };
    },
  });
  const prevService = process.env.CC_SUPABASE_SERVICE_KEY;
  const prevAnon = process.env.CC_SUPABASE_ANON_KEY;
  const prevUrl = process.env.CC_SUPABASE_URL;
  process.env.CC_SUPABASE_SERVICE_KEY = SERVICE;
  process.env.CC_SUPABASE_ANON_KEY = "sb_publishable_test";
  process.env.CC_SUPABASE_URL = "https://example.supabase.co";
  const live = await worker.start(0);
  const base = `http://127.0.0.1:${live.port}`;
  const call = (p, opts = {}) => fetch(base + p, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  try {
    const health = await (await call("/api/health")).json();
    assert.equal(health.ok, true);
    assert.equal(health.mode, "hosted");
    assert.equal(health.surface, "web");
    const cfg = await (await call("/api/config")).json();
    const raw = JSON.stringify(cfg);
    assert.equal(raw.includes(SERVICE), false);
    assert.equal(raw.includes("service_role"), false);
    assert.equal(cfg.supabase.anonKey, "sb_publishable_test");
    assert.equal(cfg.surface, "web");
    assert.ok(cfg.desktopOnly.includes("setup"));
    assert.ok(cfg.desktopOnly.includes("libraries"));
    const page = await (await call("/")).text();
    assert.match(page, /Meldmind/);
    assert.match(page, /an Everborn product/);
    assert.match(page, /Running in the cloud/);
    const pub = await (await call("/api/worker/public-key")).json();
    assert.match(pub.publicKey, /BEGIN PUBLIC KEY/);
    assert.equal(pub.publicKey.includes("PRIVATE"), false);
    const denied = await call("/api/worker/jobs", { method: "POST", body: "{}" });
    assert.equal(denied.status, 401);
    const headers = { "x-cc-worker-token": "test-worker-token" };
    const noOpt = await call("/api/worker/jobs", { method: "POST", headers, body: JSON.stringify({ userId: "a", kind: "schedule", budgetUsd: 1, optIn: false }) });
    assert.equal(noOpt.status, 403);
    const { publicKey, privateKey } = { publicKey: pub.publicKey, privateKey: null };
    assert.equal(privateKey, null);
    const envelope = sealSecret({ publicKey, userId: "user-a", provider: "openai", secret: SECRET });
    const over = await call("/api/worker/jobs", { method: "POST", headers, body: JSON.stringify({ userId: "user-b", kind: "mission", optIn: true, budgetUsd: 1, estimateUsd: 9, refId: "m-over", title: "Over budget", envelopes: [envelope] }) });
    const overJson = await over.json();
    assert.equal(over.status, 202);
    assert.equal(overJson.job.status, "stopped");
    assert.equal(overJson.runningInCloud, false);
    assert.equal(JSON.stringify(overJson).includes(SECRET), false);
    const posted = await call("/api/worker/jobs", { method: "POST", headers, body: JSON.stringify({ userId: "user-a", kind: "schedule", optIn: true, budgetUsd: 1, refId: "s-1", title: "Mine", envelopes: [envelope] }) });
    const postedJson = await posted.json();
    assert.equal(posted.status, 202);
    assert.equal(postedJson.runningInCloud, true);
    assert.equal(postedJson.label, "Running in the cloud");
    assert.equal(JSON.stringify(postedJson).includes(SECRET), false);
    const other = sealSecret({ publicKey, userId: "user-b", provider: "openai", secret: "other-test-key" });
    await call("/api/worker/jobs", { method: "POST", headers, body: JSON.stringify({ userId: "user-b", kind: "schedule", optIn: true, budgetUsd: 1, refId: "s-2", title: "Theirs", envelopes: [other] }) });
    let sync = null;
    for (let i = 0; i < 30 && !(sync && sync.jobs.some((j) => j.title === "Mine" && j.status === "done")); i++) {
      await new Promise((r) => setTimeout(r, 20));
      sync = await (await call("/api/worker/sync", { method: "POST", headers, body: JSON.stringify({ userId: "user-a" }) })).json();
    }
    assert.equal(sync.jobs.some((j) => j.title === "Theirs"), false);
    const mine = sync.jobs.find((j) => j.title === "Mine");
    assert.equal(mine.status, "done");
    assert.equal(mine.text, "The worker opened a sealed key.");
    assert.equal(JSON.stringify(sync).includes(SECRET), false);
    assert.equal(seen.some((s) => s.userId === "user-a" && s.opened), true);
    assert.equal(calls >= 1, true);
    const again = await (await call("/api/worker/sync", { method: "POST", headers, body: JSON.stringify({ userId: "user-a" }) })).json();
    assert.equal(again.jobs.length, 0);
    const listB = await (await call("/api/worker/jobs?userId=user-b", { headers })).json();
    assert.equal(listB.jobs.some((j) => j.title === "Mine"), false);
    const built = publicWebConfig({ hosted: true, version: "0.4.8", supabase: { url: "https://example.supabase.co", anonKey: "sb_publishable_test", serviceKey: SERVICE }, hub: null, sso: [] });
    assert.equal(JSON.stringify(built).includes(SERVICE), false);
    assert.equal(built.supabase.serviceKey, undefined);
  } finally {
    if (prevService === undefined) delete process.env.CC_SUPABASE_SERVICE_KEY; else process.env.CC_SUPABASE_SERVICE_KEY = prevService;
    if (prevAnon === undefined) delete process.env.CC_SUPABASE_ANON_KEY; else process.env.CC_SUPABASE_ANON_KEY = prevAnon;
    if (prevUrl === undefined) delete process.env.CC_SUPABASE_URL; else process.env.CC_SUPABASE_URL = prevUrl;
    await live.close();
  }
});

test("web surface hides desktop-only pages", () => {
  assert.equal(isDesktopOnly("libraries"), true);
  assert.equal(isDesktopOnly("setup"), true);
  assert.equal(isDesktopOnly("command"), false);
  const wide = menuModel(["command", "libraries", "setup", "settings", "help", "schedules"], "normal", { surface: "web" });
  const labels = wide.flatMap((g) => g.items.map((i) => i.label));
  assert.equal(labels.includes("Libraries"), false);
  assert.equal(labels.includes("Find my AIs"), false);
  assert.equal(labels.includes("Get everything connected"), false);
  assert.equal(labels.includes("Check for updates"), false);
  assert.equal(labels.includes("Take the tour"), true);
  assert.equal(labels.includes("Schedules"), true);
  const desktop = menuModel(["command", "libraries", "setup", "settings", "help"], "normal");
  const desktopLabels = desktop.flatMap((g) => g.items.map((i) => i.label));
  assert.equal(desktopLabels.includes("Libraries"), true);
  assert.equal(desktopLabels.includes("Get everything connected"), true);
  assert.ok(DESKTOP_ONLY.includes("hotkey"));
  const ui = fs.readFileSync(path.join(ROOT, "web", "features", "hosted-runs.js"), "utf8");
  const plugin = fs.readFileSync(path.join(ROOT, "server", "plugins", "hosted-runs.js"), "utf8");
  const gate = fs.readFileSync(path.join(ROOT, "server", "feature-gate.js"), "utf8");
  assert.match(ui, /Running in the cloud/);
  const html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  const pill = html.match(/<div class="pill" id="cloud-pill"[^>]*>.*?<\/div>/)[0];
  assert.match(pill, /<span id="cloud-txt"[^>]*>Cloud<\/span>/);
  assert.match(pill, /title="Running in the cloud"/);
  assert.match(pill, /aria-label="Running in the cloud"/);
  assert.match(ui, /text\.textContent = CLOUD_SHORT/);
  assert.match(ui, /pill\.setAttribute\("aria-label", full\)/);
  assert.match(plugin, /gateHostedRuns/);
  assert.match(gate, /extreme/);
  for (const file of [ui, plugin, gate, fs.readFileSync(path.join(ROOT, "web", "desktop-only.js"), "utf8")]) {
    assert.equal(file.includes(EM), false);
  }
  const app = fs.readFileSync(path.join(ROOT, "web", "app.js"), "utf8");
  assert.match(app, /\/auth\/v1\/otp/);
  assert.match(app, /CONFIG\.supabase\.anonKey/);
  assert.equal(app.includes("CC_SUPABASE_SERVICE_KEY"), false);
});

async function waitBack(api, title) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    last = await api("/hosted-runs/sync", { method: "POST" });
    if (last.json?.broughtBack?.some((j) => j.title === title)) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  return last;
}

test("desktop handoff: opt-in, Extreme gate, cloud indicator, results come back", async () => {
  const seen = [];
  const worker = createHostedWorker({
    token: "test-worker-token",
    runner: async ({ secrets }) => {
      seen.push(Object.values(secrets).includes("demo-key"));
      return { status: "done", cost: 0.01, text: seen.at(-1) ? "The worker opened a sealed key." : "No sealed key." };
    },
  });
  const live = await worker.start(0);
  const s = await startServer({
    env: {
      CC_DEV_OWNER: "1",
      CC_WORKER_URL: `http://127.0.0.1:${live.port}`,
      CC_WORKER_TOKEN: "test-worker-token",
    },
    seed: (dir) => {
      fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
      fs.writeFileSync(path.join(dir, "missions", "m-cloud.json"), JSON.stringify({ id: "m-cloud", kind: "mission", prompt: "Plan a bakery week", title: "Bakery week", status: "done", startedAt: Date.now(), budgetUsd: 1 }));
    },
  });
  try {
    assert.equal((await s.api("/state")).json.license.tier, "owner");
    const blocked = await s.api("/hosted-runs/handoff", { method: "POST", body: { kind: "schedule", id: "missing", optIn: true, budgetUsd: 1 } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, "opt_in");
    const on = await s.api("/hosted-runs/opt-in", { method: "POST", body: { optIn: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.optIn, true);
    const still = await s.api("/hosted-runs/handoff", { method: "POST", body: { kind: "schedule", id: "missing", budgetUsd: 1 } });
    assert.equal(still.status, 403);
    assert.equal((await s.api("/demo", { method: "POST", body: { on: true } })).status, 200);
    const made = await s.api("/schedules", { method: "POST", body: { name: "Cloud note", target: { kind: "chat", text: "Write a two-line note" }, trigger: { type: "cron", cron: "0 9 * * 1-5" }, capUsd: 1, after: { action: "none" } } });
    assert.equal(made.status, 200);
    const id = made.json.schedule.id;
    const hand = await s.api("/hosted-runs/handoff", { method: "POST", body: { kind: "schedule", id, optIn: true, budgetUsd: 1 } });
    assert.equal(hand.status, 202);
    assert.equal(hand.json.runningInCloud, true);
    assert.equal(hand.json.label, "Running in the cloud");
    assert.equal(JSON.stringify(hand.json).includes("demo-key"), false);
    const back = await waitBack(s.api, "Cloud note");
    assert.equal(back.json.broughtBack.some((j) => j.title === "Cloud note" && j.text === "The worker opened a sealed key."), true);
    assert.equal(back.json.runningInCloud, false);
    assert.equal(JSON.stringify(back.json).includes("demo-key"), false);
    assert.equal(seen.some(Boolean), true);
    const over = await s.api("/hosted-runs/handoff", { method: "POST", body: { kind: "mission", id: "m-cloud", optIn: true, budgetUsd: 1, estimateUsd: 20 } });
    assert.equal(over.status, 202);
    assert.equal(over.json.job.status, "stopped");
    assert.match(over.json.job.text, /budget/);
    assert.equal(JSON.stringify(over.json).includes("demo-key"), false);
    const watch = fs.mkdtempSync(path.join(os.tmpdir(), "cc-watch-"));
    const folder = await s.api("/schedules", { method: "POST", body: { name: "Folder watch", target: { kind: "chat", text: "Read the file" }, trigger: { type: "folder", folder: watch, pattern: "*.txt" }, capUsd: 1, after: { action: "none" } } });
    assert.equal(folder.status, 200);
    const refused = await s.api("/hosted-runs/handoff", { method: "POST", body: { kind: "schedule", id: folder.json.schedule.id, optIn: true, budgetUsd: 1 } });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.code, "desktop");
  } finally {
    await s.stop();
    await live.close();
  }
});

test("free tier cannot hand off, and the desktop does not open worker keys", async () => {
  const s = await startServer();
  try {
    const opt = await s.api("/hosted-runs/opt-in", { method: "POST", body: { optIn: true } });
    assert.equal(opt.status, 402);
    assert.equal(opt.json.code, "extreme_required");
    assert.match(opt.json.error, /Extreme/);
    const hand = await s.api("/hosted-runs/handoff", { method: "POST", body: { kind: "mission", id: "m", optIn: true, budgetUsd: 1 } });
    assert.equal(hand.status, 402);
    assert.equal(hand.json.code, "extreme_required");
    const worker = await s.api("/worker/public-key");
    assert.equal(worker.status, 404);
  } finally { await s.stop(); }
});

test("an Extreme licence passes the same gate", async () => {
  const s = await startServer({
    cloud: { rpc: () => ({ ok: true, tier: "extreme", status: "active", email: "t@example.com", message: "ok" }) },
    seed: (dir) => fs.writeFileSync(path.join(dir, "license.json"), JSON.stringify({ key: "EVB-AAAA-BBBB-CCCC", deviceId: "dev1", tier: null, status: null })),
  });
  try {
    let tier = "";
    for (let i = 0; i < 40 && tier !== "extreme"; i++) {
      tier = (await s.api("/state")).json.license.tier;
      if (tier !== "extreme") await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(tier, "extreme");
    const on = await s.api("/hosted-runs/opt-in", { method: "POST", body: { optIn: true } });
    assert.equal(on.status, 200);
    assert.equal(on.json.tier, "extreme");
    assert.equal(on.json.optIn, true);
  } finally { await s.stop(); }
});
