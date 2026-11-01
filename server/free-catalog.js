// Daily, bounded free AI catalog. Remote data can describe pages and retire known entries;
// executable helper commands and install packages remain part of the app release.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, putDoc } from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_URL = "https://github.com/everbornproductions-stack/command-center-releases/releases/latest/download/free-catalog.json";
export const CACHE_DOC = "free-catalog.cache";
export const ALLOWED_NPM = new Set(["@openai/codex", "opencode-ai", "freebuff", "@anthropic-ai/claude-code"]);
const MAX_BYTES = 200 * 1024;
const canonical = (v) => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const bundled = () => JSON.parse(fs.readFileSync(path.join(HERE, "free-catalog.json"), "utf8"));
const stringsShort = (v) => {
  if (typeof v === "string") return v.length <= 500;
  if (Array.isArray(v)) return v.every(stringsShort);
  if (v && typeof v === "object") return Object.values(v).every(stringsShort);
  return true;
};
const validDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
};

export function validateCatalog(c, { remote = false } = {}) {
  if (!c || c.version !== 1 || !validDate(c.updated) || !Array.isArray(c.entries) || c.entries.length > 200 || !stringsShort(c)) return false;
  const ids = new Set();
  for (const e of c.entries) {
    if (!e || !/^[a-z0-9-]{2,40}$/.test(e.id || "") || ids.has(e.id) || !["app", "key", "local"].includes(e.kind) || !["active", "retired"].includes(e.status) || typeof e.label !== "string" || !e.label || typeof e.good !== "string") return false;
    ids.add(e.id);
    for (const k of ["retiredNote", "replacedBy", "page", "npm", "bin", "signIn", "provider"]) if (e[k] != null && typeof e[k] !== "string") return false;
    if (e.freeTier != null && (!e.freeTier || typeof e.freeTier !== "object" || Array.isArray(e.freeTier))) return false;
    if (e.npm && !ALLOWED_NPM.has(e.npm)) return false;
    if (e.page && (!/^https:\/\//i.test(e.page) || e.page.length > 500)) return false;
    if (e.status === "retired" && (!e.retiredNote || (e.replacedBy && !/^[a-z0-9-]{2,40}$/.test(e.replacedBy)))) return false;
    if (remote && (e.bin || e.signIn || e.npm)) return false;
    if (["kind", "label", "status", "good", "page", "retiredNote", "replacedBy", "provider", "freeTier", "npm", "bin", "signIn"].some((k) => e[k] != null && !["string", "boolean", "object"].includes(typeof e[k]))) return false;
  }
  return true;
}

export function catalogPubkey(env = process.env) {
  const fromEnv = String(env.CC_FREE_CATALOG_PUBKEY || env.CC_CATALOG_PUBKEY || "").trim();
  if (fromEnv) return fromEnv;
  try { return String(JSON.parse(fs.readFileSync(path.join(HERE, "catalog-pubkey.json"), "utf8"))?.publicKey || "").trim(); } catch { return ""; }
}
function signed(c, pub = catalogPubkey()) {
  if (!pub) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(canonical({ version: c.version, updated: c.updated, entries: c.entries })), key, Buffer.from(c.signature || "", "base64"));
  } catch { return false; }
}
function cached() { try { return doc(CACHE_DOC, null); } catch { return null; } }
export function loadCatalog() {
  try {
    const base = bundled();
    const saved = cached();
    if (!saved || !validateCatalog(saved.catalog, { remote: true })) return { ...base, signed: false };
    const remote = saved.catalog;
    if (remote.updated < base.updated) return { ...base, signed: false };
    const rows = new Map(base.entries.map((e) => [e.id, { ...e }]));
    for (const e of remote.entries) {
      const old = rows.get(e.id);
      if (!old) continue;
      if (e.kind !== old.kind) continue;
      if (e.status === "retired") rows.set(e.id, { ...old, status: "retired", retiredNote: e.retiredNote, replacedBy: e.replacedBy });
      else {
        if (old.kind === "key" && e.kind === "key" && e.page) old.page = e.page;
        if (e.good) old.good = e.good;
        rows.set(e.id, old);
      }
    }
    // New entries may only be key pages or app download pages, never executable helpers.
    for (const e of remote.entries) if (!rows.has(e.id) && e.page && e.status === "active" && (e.kind === "key" || e.kind === "app")) rows.set(e.id, { ...e, npm: undefined, bin: undefined, signIn: undefined });
    return { version: 1, updated: remote.updated, entries: [...rows.values()], signed: signed({ ...remote, signature: saved.signature }) };
  } catch { try { return { ...bundled(), signed: false }; } catch { return { version: 1, updated: "1970-01-01", entries: [], signed: false }; } }
}

export async function refreshCatalog({ fetch: fetchImpl = globalThis.fetch, now = Date.now(), env = process.env, pub = catalogPubkey(env) } = {}) {
  let timer;
  try {
    const old = cached();
    if (old?.checkedAt && now - old.checkedAt < 86400000) return { ok: false, skipped: true, catalog: loadCatalog() };
    try { putDoc(CACHE_DOC, { ...(old || {}), checkedAt: now }); } catch { /* tests and hosted startup may not have a context yet */ }
    const target = String(env.CC_FREE_CATALOG_URL || CATALOG_URL);
    if (new URL(target).protocol !== "https:") return { ok: false, catalog: loadCatalog() };
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetchImpl(target, { redirect: "manual", signal: controller.signal, headers: { accept: "application/json" } });
    if (!response?.ok || response.status >= 300 || (response.url && new URL(response.url).host !== new URL(target).host)) return { ok: false, catalog: loadCatalog() };
    const len = Number(response.headers?.get?.("content-length") || 0);
    if (len > MAX_BYTES) return { ok: false, catalog: loadCatalog() };
    let raw;
    if (response.arrayBuffer) { const b = Buffer.from(await response.arrayBuffer()); if (b.length > MAX_BYTES) return { ok: false, catalog: loadCatalog() }; raw = b.toString("utf8"); }
    else { raw = await response.text(); if (Buffer.byteLength(raw) > MAX_BYTES) return { ok: false, catalog: loadCatalog() }; }
    const c = JSON.parse(raw);
    if (!validateCatalog(c, { remote: true }) || (pub && !signed(c, pub))) return { ok: false, catalog: loadCatalog() };
    if (old?.catalog?.updated && c.updated < old.catalog.updated) return { ok: false, catalog: loadCatalog() };
    // Only allow known-entry changes and new key pages. Signatures cover payload before this metadata.
    const clean = { version: c.version, updated: c.updated, entries: c.entries };
    try { putDoc(CACHE_DOC, { catalog: clean, signature: c.signature || "", checkedAt: now }); } catch { /* no active store context */ }
    return { ok: true, signed: !!pub, catalog: loadCatalog() };
  } catch { return { ok: false, catalog: loadCatalog() }; }
  finally { if (timer) clearTimeout(timer); }
}
