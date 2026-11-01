import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FileStore, newContext, runAs } from "../server/store.js";
import * as store from "../server/store.js";
import { tmpDir } from "./helpers.js";
import { loadCatalog, refreshCatalog, validateCatalog } from "../server/free-catalog.js";
import { workerRow, workerUsable, pickWorker, DEFAULT_WORKERS } from "../server/worker-pool.js";
import { installHelper } from "../server/helper-install.js";
import { routes } from "../server/plugins/freecatalog.js";
import { FREE_TIERS } from "../server/fallback.js";

const response = (body, { len = null, status = 200 } = {}) => ({
  ok: status === 200, status, url: "",
  headers: { get: (k) => k === "content-length" ? (len ?? String(Buffer.byteLength(JSON.stringify(body)))) : null },
  arrayBuffer: async () => Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
});
const cat = (entries, updated = "2026-11-02") => ({ version: 1, updated, entries });
function context(t) {
  const dir = tmpDir("cc-free-cat-");
  const c = newContext(`test-${Math.random()}`, new FileStore(dir));
  store.setDefaultContext(c); t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return c;
}

test("bundled catalog loads and retires Gemini CLI with its replacement", (t) => {
  const c = context(t);
  const got = runAs(c, () => loadCatalog());
  assert.equal(got.version, 1);
  assert.equal(got.entries.find((e) => e.id === "gemini-cli").status, "retired");
  assert.equal(got.entries.find((e) => e.id === "gemini-cli").replacedBy, "antigravity");
  assert.equal(validateCatalog(got), true);
});

test("valid injected download is kept, merged and surfaced by the route", async (t) => {
  const c = context(t);
  await runAs(c, async () => {
    const result = await refreshCatalog({ now: Date.parse("2026-11-02T12:00:00Z"), env: { CC_FREE_CATALOG_URL: "https://github.com/everbornproductions-stack/command-center-releases/releases/latest/download/free-catalog.json" }, fetch: async () => response(cat([{ id: "new-ai", kind: "key", label: "New AI", status: "active", good: "Free access", page: "https://example.com/key", provider: "new-ai" }, { id: "new-app", kind: "app", label: "New app", status: "active", good: "Free desktop helper", page: "https://example.com/download" }, { id: "google", kind: "key", label: "Gemini", status: "active", good: "Better free Gemini", page: "https://aistudio.google.com/apikey", provider: "google" }])) });
    assert.equal(result.ok, true);
    assert.equal(result.catalog.entries.find((e) => e.id === "new-ai").page, "https://example.com/key");
    assert.equal(result.catalog.entries.find((e) => e.id === "new-app").page, "https://example.com/download");
    let body;
    await routes({ method: "GET" }, { }, new URL("http://local/api/free-catalog"), null, { json: (_res, _code, value) => { body = value; return true; } });
    assert.ok(body.keys.some((e) => e.id === "new-ai"));
    assert.ok(body.apps.some((e) => e.id === "new-app"));
  });
});

test("oversized, malformed, insecure pages and unknown npm packages are refused", async (t) => {
  const c = context(t);
  await runAs(c, async () => {
    const base = { id: "new-key", kind: "key", label: "New", status: "active", good: "Free", page: "https://example.com" };
    const opts = { now: Date.parse("2026-11-03T12:00:00Z"), env: { CC_FREE_CATALOG_URL: "https://example.com/catalog" }, fetch: async () => response(cat([base])) };
    assert.equal((await refreshCatalog({ ...opts, fetch: async () => response(cat([base]), { len: 200 * 1024 + 1 }) })).ok, false);
    assert.equal((await refreshCatalog({ ...opts, now: opts.now + 86400000, fetch: async () => response({ version: 2 }) })).ok, false);
    assert.equal((await refreshCatalog({ ...opts, now: opts.now + 2 * 86400000, fetch: async () => response(cat([{ ...base, page: "http://example.com" }])) })).ok, false);
    assert.equal((await refreshCatalog({ ...opts, now: opts.now + 3 * 86400000, fetch: async () => response(cat([{ ...base, npm: "evil-package" }])) })).ok, false);
    assert.equal(validateCatalog(cat([{ ...base, npm: "evil-package" }]), { remote: true }), false);
  });
});

test("retirement removes a key page and makes helper unusable and non-installable", async (t) => {
  const c = context(t);
  await runAs(c, async () => {
    const result = await refreshCatalog({ now: Date.parse("2026-11-04T12:00:00Z"), env: { CC_FREE_CATALOG_URL: "https://example.com/catalog" }, fetch: async () => response(cat([{ id: "google", kind: "key", label: "Gemini", status: "retired", good: "", retiredNote: "Google ended this free key page.", replacedBy: "groq" }, { id: "gemini-cli", kind: "app", label: "Gemini CLI", status: "retired", good: "", retiredNote: "Google retired it.", replacedBy: "antigravity" }])) });
    assert.equal(result.ok, true);
    assert.ok(!result.catalog.entries.some((e) => e.id === "google" && e.status === "active"));
    assert.equal(FREE_TIERS.google, undefined, "a retired key provider leaves free tier routing");
    const spec = DEFAULT_WORKERS.find((w) => w.id === "gemini-cli");
    const row = workerRow(spec, { installed: true, signedIn: true });
    assert.equal(row.status, "retired");
    assert.match(row.statusLabel, /Google retired it/);
    assert.equal(workerUsable("gemini-cli"), false);
    assert.equal(pickWorker([row]), null);
    assert.equal((await installHelper("gemini-cli")).code, "retired");
  });
});

test("refresh is limited to one attempt per day", async (t) => {
  const c = context(t);
  await runAs(c, async () => {
    let calls = 0;
    const opts = { now: Date.parse("2026-11-05T12:00:00Z"), env: { CC_FREE_CATALOG_URL: "https://example.com/catalog" }, fetch: async () => { calls++; return response(cat([])); } };
    assert.equal((await refreshCatalog(opts)).ok, true);
    assert.equal((await refreshCatalog({ ...opts, now: opts.now + 1000 })).skipped, true);
    assert.equal(calls, 1);
  });
});
