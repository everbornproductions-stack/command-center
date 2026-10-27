// 0.4.21: the real Marketplace catalog source. Free listings that Everborn publishes in its own
// Supabase project (table market_listings, see supabase/marketplace_catalog.sql) are read with the
// publishable key. Paid listings are never read or shown. If the catalog cannot be reached, the
// last good copy kept on this computer is shown, and if there is none the bundled demo catalog
// stays. Network goes through an injectable fetch. Nothing is written to the internet.
//
// Signing: when a catalog public key is set (server/catalog-pubkey.json or CC_CATALOG_PUBKEY, an
// Ed25519 public key as base64 SPKI), every row must carry a valid signature over its canonical
// body, and unsigned or wrongly signed rows are dropped. With no key set yet, rows are still
// scanned like any template and show "Not signed yet".
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloud } from "./license.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_MS = 10 * 60 * 1000;
export const COLUMNS = "id,kind,title,category,promise,example,body,version,price_type,sig";

const canonical = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));

export function signedPart(row) {
  return canonical({ id: row.id, kind: row.kind, version: Number(row.version) || 1, title: row.title, body: row.body });
}

export function catalogPubkey(env = process.env) {
  const fromEnv = String(env.CC_CATALOG_PUBKEY || "").trim();
  if (fromEnv) return fromEnv;
  try { return String(JSON.parse(fs.readFileSync(path.join(HERE, "catalog-pubkey.json"), "utf8"))?.publicKey || "").trim(); } catch { return ""; }
}

export function verifyRow(row, pub) {
  if (!pub) return "unsigned";
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(signedPart(row)), key, Buffer.from(String(row.sig || ""), "base64")) ? "signed" : "bad";
  } catch { return "bad"; }
}

// Pulls the free listed rows. Returns { state: "live" | "off" | "offline", rows }.
export async function pullCatalog({ fetchImpl = globalThis.fetch, cfg = cloud() } = {}) {
  if (!cfg?.url || !cfg?.anonKey) return { state: "off", rows: [] };
  const headers = { apikey: cfg.anonKey, accept: "application/json" };
  if (String(cfg.anonKey).startsWith("eyJ")) headers.authorization = `Bearer ${cfg.anonKey}`;
  const q = `status=eq.listed&price_type=eq.free&select=${COLUMNS}&order=created_at.desc&limit=100`;
  try {
    const r = await fetchImpl(`${String(cfg.url).replace(/\/$/, "")}/rest/v1/market_listings?${q}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { state: "offline", rows: [] };
    const list = await r.json();
    return Array.isArray(list) ? { state: "live", rows: list } : { state: "offline", rows: [] };
  } catch { return { state: "offline", rows: [] }; }
}

// Keeps free rows with a usable body and a good signature (when a key is set). `build(row)` is the
// caller's own converter (it runs the same cleaning and scan as any template) and may throw.
export function acceptRows(rows, build, { pub = catalogPubkey() } = {}) {
  const out = [];
  for (const raw of rows || []) {
    if (!raw || raw.price_type !== "free") continue;
    if (!["pipeline", "agent", "prompt"].includes(raw.kind) || !raw.id || !raw.body) continue;
    const trust = verifyRow(raw, pub);
    if (trust === "bad" || (pub && trust !== "signed")) continue;
    try { out.push({ ...build(raw), signed: trust === "signed" }); } catch { /* a bad row is skipped, the rest still show */ }
  }
  return out;
}

export function remoteNote(state, count, savedAt) {
  if (state === "live") return `Catalog from Everborn: ${count} free ${count === 1 ? "item" : "items"}. Install copies the steps onto this computer. It does not run them.`;
  if (state === "saved") return `Everborn's catalog could not be reached, so this is the copy saved on this computer${savedAt ? ` on ${new Date(savedAt).toLocaleDateString("en-US")}` : ""}. It will refresh when you are online.`;
  if (state === "offline") return "Everborn's catalog could not be reached right now. The demo catalog is shown instead. Try again when you are online.";
  return "Local and demo catalog. Connect to Everborn's cloud in Settings to browse the shared catalog.";
}
