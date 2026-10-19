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
import { readJson, writeJson } from "./paths.js";

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
export class FileStore {
  constructor(dir) { this.dir = dir; fs.mkdirSync(path.join(dir, "missions"), { recursive: true }); }
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
  appendLedger(e) { fs.appendFileSync(path.join(this.dir, "ledger.jsonl"), JSON.stringify(e) + "\n"); }
  saveMission(m) { writeJson(path.join(this.dir, "missions", m.id + ".json"), m); }
  listMissions(summarize) {
    const dir = path.join(this.dir, "missions"), out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const m = readJson(path.join(dir, f), null);
      if (m) out.push(summarize(m));
    }
    return out;
  }
  async getMission(id) { return readJson(path.join(this.dir, "missions", id + ".json"), null); }
  // secrets are handled by vault.js (DPAPI) in local mode
  putSecret() {}
}
