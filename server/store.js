// Per-user context. Every module that used to keep module-level state (vault secrets, ledger,
// projects, subscriptions, skills, prices, rules, scheduled missions, health lights, settings)
// now reads it from the context of the current user, carried through AsyncLocalStorage so
// council/mission code did not have to change shape.
//
//   local mode  (default)        one context, "local", stored in the data/ folder exactly as before
//   hosted mode (CC_MODE=hosted) one context per signed-in Supabase user, stored in Supabase tables
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson, retrySync } from "./paths.js";

export const HOSTED = process.env.CC_MODE === "hosted";
export const als = new AsyncLocalStorage();
const contexts = new Map(); // userId -> context
let defaultContext = null;   // local mode only

// Persisted documents and the file each one maps to in local mode (names unchanged from v0.1).
export const DOC_FILES = { settings: "settings.json", projects: "projects.json", subscriptions: "subscriptions.json", skills: "skills.json", pricing: "pricing.json", rules: "pricing-rules.json", scheduled: "scheduled.json", license: "license.json" };

export function newContext(userId, store = null) {
  return {
    userId, email: null, token: null, store,
    docs: {},             // kind -> document (see DOC_FILES)
    secrets: {},          // providerId -> { key, secret? }
    ledger: [],           // ledger entries (local: whole file; hosted: last 35 days)
    missions: null,       // hosted: Map id -> summary (local: read from disk on demand)
    health: {},           // providerId -> status
    liveModels: {},       // providerId -> [model ids]
    scheduled: new Map(), // id -> { timer, mission, opts }
    lastRun: null,
    loading: null, ready: false, createdAt: Date.now(), lastSeen: Date.now(),
  };
}

export function setDefaultContext(c) { defaultContext = c; contexts.set(c.userId, c); }
export function ctx() {
  const c = als.getStore();
  if (c) return c;
  if (defaultContext) return defaultContext;
  throw new Error("No user context (hosted mode request without a signed-in user)");
}
export const currentUserId = () => als.getStore()?.userId || defaultContext?.userId || null;
export const getContext = (userId) => contexts.get(userId) || (HOSTED ? null : defaultContext);
export const allContexts = () => [...contexts.values()].filter((c) => c.ready);
export const registerContext = (c) => contexts.set(c.userId, c);
export const dropContext = (userId) => contexts.delete(userId);
export const runAs = (c, fn) => als.run(c, fn);

// ---- document helpers used by every module ----
export function doc(kind, init) {
  const c = ctx();
  if (c.docs[kind] === undefined || c.docs[kind] === null) {
    const v = typeof init === "function" ? init() : init;
    if (v !== undefined) { c.docs[kind] = v; c.store.putDoc(kind, v); }
  }
  return c.docs[kind];
}
export function putDoc(kind, value) {
  const c = ctx();
  c.docs[kind] = value;
  c.store.putDoc(kind, value);
  return value;
}

// ---- local store: the data/ folder ----
const LIST_TTL_MS = 30000;
export class FileStore {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(path.join(dir, "missions"), { recursive: true });
    this._memo = new WeakMap(); this._versions = new Map(); this._names = null; this._namesAt = 0;
  }
  async loadAll(c) {
    for (const [kind, file] of Object.entries(DOC_FILES)) {
      const v = readJson(path.join(this.dir, file), undefined);
      if (v !== undefined) c.docs[kind] = v;
    }
    // plugin documents are stored as <kind>.json (e.g. reports.latest.json); read them back too
    const mapped = new Set(Object.values(DOC_FILES));
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith(".json") || mapped.has(f) || f === "package.json") continue;
      const kind = f.slice(0, -5);
      if (c.docs[kind] === undefined) { const v = readJson(path.join(this.dir, f), undefined); if (v !== undefined) c.docs[kind] = v; }
    }
    c.ledger = [];
    const lf = path.join(this.dir, "ledger.jsonl");
    if (fs.existsSync(lf)) for (const line of fs.readFileSync(lf, "utf8").split("\n")) { if (!line.trim()) continue; try { c.ledger.push(JSON.parse(line)); } catch {} }
  }
  putDoc(kind, value) { writeJson(path.join(this.dir, DOC_FILES[kind] || `${kind}.json`), value); }
  appendLedger(e) { const line = JSON.stringify(e) + "\n"; retrySync(() => fs.appendFileSync(path.join(this.dir, "ledger.jsonl"), line)); }
  // 0.4.24: the engine shares the Electron main process, so reading and parsing every mission file on every
  // /api/state, websocket hello and history call froze the whole app (the watchdog's "engine stuck"). Results are
  // now remembered per summarizer function and per file, keyed by a version that saveMission bumps. The directory
  // listing is trusted for LIST_TTL_MS (missions are only written by this class), so a poll costs no disk reads.
  saveMission(m) {
    const file = m.id + ".json";
    writeJson(path.join(this.dir, "missions", file), m, { compact: true });
    this._versions.set(file, (this._versions.get(file) || 0) + 1);
    if (this._names && !this._names.includes(file)) this._names.push(file);
  }
  _missionNames() {
    const now = Date.now();
    if (!this._names || now - this._namesAt > LIST_TTL_MS) {
      this._names = fs.readdirSync(path.join(this.dir, "missions")).filter((f) => f.endsWith(".json"));
      this._namesAt = now;
    }
    return this._names;
  }
  listMissions(summarize) {
    const dir = path.join(this.dir, "missions"), out = [];
    let memo = this._memo.get(summarize);
    if (!memo) { memo = new Map(); this._memo.set(summarize, memo); }
    for (const f of this._missionNames()) {
      const ver = this._versions.get(f) || 0, hit = memo.get(f);
      if (hit && hit.ver === ver) { if (hit.value !== undefined) out.push(hit.value); continue; }
      const m = readJson(path.join(dir, f), null);
      const value = m ? summarize(m) : undefined;
      if (m) memo.set(f, { ver, value });
      if (value !== undefined) out.push(value);
    }
    return out;
  }
  // Fill the memo for a summarizer a few files at a time so the first page load does not parse everything in one block.
  async warmMissions(summarize, { chunk = 8 } = {}) {
    let n = 0;
    for (const f of [...this._missionNames()]) {
      let memo = this._memo.get(summarize);
      if (!memo) { memo = new Map(); this._memo.set(summarize, memo); }
      const ver = this._versions.get(f) || 0, hit = memo.get(f);
      if (!hit || hit.ver !== ver) {
        const m = readJson(path.join(this.dir, "missions", f), null);
        if (m) memo.set(f, { ver, value: summarize(m) });
      }
      if (++n % chunk === 0) await new Promise((r) => setImmediate(r));
    }
  }
  async getMission(id) { return readJson(path.join(this.dir, "missions", id + ".json"), null); }
  // secrets are handled by vault.js (DPAPI) in local mode
  putSecret() {}
}
